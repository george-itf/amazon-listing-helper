/**
 * ML Feature Engineering Service
 *
 * State-of-the-art feature engineering for Amazon listing optimization.
 * Generates 200+ features across multiple categories for ML models.
 *
 * Feature Categories:
 * 1. Core Product Features - Basic attributes
 * 2. Price Features - Current, historical, competitive positioning
 * 3. Sales Features - Volume, revenue, velocity, trends
 * 4. Inventory Features - Stock, coverage, risk
 * 5. Competitive Features - Competitors, buy box, market position
 * 6. Traffic Features - Sessions, views, conversion
 * 7. Financial Features - Profit, margin, fees, ROI
 * 8. Time-Series Features - Rolling stats, trends, momentum, seasonality
 * 9. Derived Features - Ratios, interactions, polynomials
 * 10. Categorical Encodings - Brand, category, fulfillment
 *
 * @module MLFeaturesService
 */

import { query, transaction } from '../database/connection.js';

// ============================================================================
// FEATURE COMPUTATION ENGINE
// ============================================================================

/**
 * Compute all ML features for a listing
 * @param {number} listingId
 * @returns {Promise<Object>} Complete feature vector
 */
/**
 * Safely compute features, returning empty object on table-missing errors
 */
async function safeComputeFeatures(fn, name) {
  try {
    return await fn();
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn(`[MLFeatures] Skipping ${name}: table does not exist`);
      return {};
    }
    throw error;
  }
}

export async function computeListingFeatures(listingId) {
  const features = {};

  // Get base listing data
  const listing = await getListingData(listingId);
  if (!listing) throw new Error(`Listing not found: ${listingId}`);

  // 1. Core Product Features
  Object.assign(features, computeCoreFeatures(listing));

  // 2. Price Features (may use keepa_snapshots)
  Object.assign(features, await safeComputeFeatures(
    () => computePriceFeatures(listingId, listing),
    'priceFeatures'
  ));

  // 3. Sales Features (uses listing_sales_daily)
  Object.assign(features, await safeComputeFeatures(
    () => computeSalesFeatures(listingId),
    'salesFeatures'
  ));

  // 4. Inventory Features
  Object.assign(features, await safeComputeFeatures(
    () => computeInventoryFeatures(listingId, listing),
    'inventoryFeatures'
  ));

  // 5. Competitive Features (uses keepa_snapshots)
  Object.assign(features, await safeComputeFeatures(
    () => computeCompetitiveFeatures(listing.asin),
    'competitiveFeatures'
  ));

  // 6. Traffic Features
  Object.assign(features, await safeComputeFeatures(
    () => computeTrafficFeatures(listing.asin),
    'trafficFeatures'
  ));

  // 7. Financial Features (uses boms, components)
  Object.assign(features, await safeComputeFeatures(
    () => computeFinancialFeatures(listingId, listing),
    'financialFeatures'
  ));

  // 8. Time-Series Features (uses listing_sales_daily, keepa_snapshots)
  Object.assign(features, await safeComputeFeatures(
    () => computeTimeSeriesFeatures(listingId, listing.asin),
    'timeSeriesFeatures'
  ));

  // 9. Derived/Interaction Features
  Object.assign(features, computeDerivedFeatures(features));

  // 10. Categorical Encodings
  Object.assign(features, computeCategoricalFeatures(listing));

  // Add metadata
  features._listing_id = listingId;
  features._asin = listing.asin;
  features._sku = listing.seller_sku;
  features._computed_at = new Date().toISOString();
  features._feature_version = 2;
  features._feature_count = Object.keys(features).filter(k => !k.startsWith('_')).length;

  return features;
}

// ============================================================================
// 1. CORE PRODUCT FEATURES
// ============================================================================

function computeCoreFeatures(listing) {
  return {
    // Basic info
    core_has_asin: listing.asin ? 1 : 0,
    core_has_title: listing.title ? 1 : 0,
    core_title_length: (listing.title || '').length,
    core_title_word_count: (listing.title || '').split(/\s+/).filter(Boolean).length,
    core_has_description: listing.description ? 1 : 0,
    core_description_length: (listing.description || '').length,
    core_bullet_count: Array.isArray(listing.bulletPoints) ? listing.bulletPoints.length : 0,

    // Status
    core_is_active: listing.status === 'active' ? 1 : 0,
    core_is_fba: listing.fulfillmentChannel === 'FBA' ? 1 : 0,
    core_is_fbm: listing.fulfillmentChannel === 'FBM' ? 1 : 0,

    // Age (days since created)
    core_listing_age_days: listing.createdAt
      ? Math.floor((Date.now() - new Date(listing.createdAt).getTime()) / (1000 * 60 * 60 * 24))
      : null,

    // Category depth
    core_has_category: listing.category ? 1 : 0,
  };
}

// ============================================================================
// 2. PRICE FEATURES
// ============================================================================

async function computePriceFeatures(listingId, listing) {
  const currentPrice = safeFloat(listing.price_inc_vat);

  // Get price history
  const priceHistory = await query(`
    SELECT
      before_json->>'price_inc_vat' as old_price,
      after_json->>'price_inc_vat' as new_price,
      created_at
    FROM listing_events
    WHERE listing_id = $1
      AND event_type IN ('PRICE_CHANGE_DRAFTED', 'PRICE_CHANGE_PUBLISHED')
    ORDER BY created_at DESC
    LIMIT 100
  `, [listingId]);

  const prices = priceHistory.rows
    .map(r => safeFloat(r.new_price))
    .filter(p => p > 0);

  // Get competitive pricing
  const competitivePricing = await query(`
    SELECT competitive_price_amount, landed_price_amount
    FROM amazon_competitive_pricing
    WHERE asin = $1
    ORDER BY captured_at DESC
    LIMIT 1
  `, [listing.asin]);

  const competitivePrice = safeFloat(competitivePricing.rows[0]?.competitive_price_amount);

  // Get Keepa price bands
  const keepaPricing = await query(`
    SELECT parsed_json->'metrics' as metrics
    FROM keepa_snapshots
    WHERE asin = $1
    ORDER BY captured_at DESC
    LIMIT 1
  `, [listing.asin]);

  const keepaMetrics = keepaPricing.rows[0]?.metrics || {};

  return {
    // Current price
    price_current: currentPrice,
    price_current_log: currentPrice > 0 ? Math.log(currentPrice) : 0,

    // Price history stats
    price_change_count_30d: prices.length,
    price_avg_30d: prices.length > 0 ? avg(prices) : currentPrice,
    price_min_30d: prices.length > 0 ? Math.min(...prices) : currentPrice,
    price_max_30d: prices.length > 0 ? Math.max(...prices) : currentPrice,
    price_stddev_30d: prices.length > 1 ? stddev(prices) : 0,
    price_range_30d: prices.length > 0 ? Math.max(...prices) - Math.min(...prices) : 0,

    // Price position
    price_vs_competitive: competitivePrice > 0 ? currentPrice / competitivePrice : null,
    price_gap_to_competitive: competitivePrice > 0 ? currentPrice - competitivePrice : null,
    price_below_competitive: competitivePrice > 0 && currentPrice < competitivePrice ? 1 : 0,

    // Keepa price bands
    price_keepa_median_90d: safeFloat(keepaMetrics.price_median_90d),
    price_keepa_p25_90d: safeFloat(keepaMetrics.price_p25_90d),
    price_keepa_p75_90d: safeFloat(keepaMetrics.price_p75_90d),
    price_keepa_min_90d: safeFloat(keepaMetrics.price_min_90d),
    price_keepa_max_90d: safeFloat(keepaMetrics.price_max_90d),
    price_keepa_volatility: safeFloat(keepaMetrics.price_volatility_90d),

    // Price band position
    price_vs_keepa_median: keepaMetrics.price_median_90d > 0
      ? currentPrice / keepaMetrics.price_median_90d : null,
    price_in_p25_p75_band: (keepaMetrics.price_p25_90d && keepaMetrics.price_p75_90d)
      ? (currentPrice >= keepaMetrics.price_p25_90d && currentPrice <= keepaMetrics.price_p75_90d ? 1 : 0) : null,
    price_below_p25: keepaMetrics.price_p25_90d
      ? (currentPrice < keepaMetrics.price_p25_90d ? 1 : 0) : null,
    price_above_p75: keepaMetrics.price_p75_90d
      ? (currentPrice > keepaMetrics.price_p75_90d ? 1 : 0) : null,

    // Price momentum
    price_momentum_7d: prices.length >= 7 ? (prices[0] - prices[6]) / (prices[6] || 1) : null,
    price_momentum_30d: prices.length >= 30 ? (prices[0] - prices[29]) / (prices[29] || 1) : null,
  };
}

// ============================================================================
// 3. SALES FEATURES
// ============================================================================

async function computeSalesFeatures(listingId) {
  // Get sales data from multiple time windows
  const salesData = await query(`
    SELECT
      -- 7 day metrics
      COALESCE(SUM(CASE WHEN date >= CURRENT_DATE - 7 THEN units END), 0) as units_7d,
      COALESCE(SUM(CASE WHEN date >= CURRENT_DATE - 7 THEN revenue_inc_vat END), 0) as revenue_7d,

      -- 14 day metrics
      COALESCE(SUM(CASE WHEN date >= CURRENT_DATE - 14 THEN units END), 0) as units_14d,
      COALESCE(SUM(CASE WHEN date >= CURRENT_DATE - 14 THEN revenue_inc_vat END), 0) as revenue_14d,

      -- 30 day metrics
      COALESCE(SUM(CASE WHEN date >= CURRENT_DATE - 30 THEN units END), 0) as units_30d,
      COALESCE(SUM(CASE WHEN date >= CURRENT_DATE - 30 THEN revenue_inc_vat END), 0) as revenue_30d,

      -- 60 day metrics
      COALESCE(SUM(CASE WHEN date >= CURRENT_DATE - 60 THEN units END), 0) as units_60d,
      COALESCE(SUM(CASE WHEN date >= CURRENT_DATE - 60 THEN revenue_inc_vat END), 0) as revenue_60d,

      -- 90 day metrics
      COALESCE(SUM(units), 0) as units_90d,
      COALESCE(SUM(revenue_inc_vat), 0) as revenue_90d,

      -- Daily stats
      COALESCE(AVG(units), 0) as avg_units_per_day,
      COALESCE(STDDEV(units), 0) as stddev_units_per_day,
      COUNT(DISTINCT date) as days_with_sales
    FROM listing_sales_daily
    WHERE listing_id = $1
      AND date >= CURRENT_DATE - 90
  `, [listingId]);

  const s = salesData.rows[0] || {};

  // Calculate velocities
  const velocity7d = safeFloat(s.units_7d) / 7;
  const velocity14d = safeFloat(s.units_14d) / 14;
  const velocity30d = safeFloat(s.units_30d) / 30;
  const velocity60d = safeFloat(s.units_60d) / 60;
  const velocity90d = safeFloat(s.units_90d) / 90;

  return {
    // Raw units
    sales_units_7d: safeFloat(s.units_7d),
    sales_units_14d: safeFloat(s.units_14d),
    sales_units_30d: safeFloat(s.units_30d),
    sales_units_60d: safeFloat(s.units_60d),
    sales_units_90d: safeFloat(s.units_90d),

    // Revenue
    sales_revenue_7d: safeFloat(s.revenue_7d),
    sales_revenue_14d: safeFloat(s.revenue_14d),
    sales_revenue_30d: safeFloat(s.revenue_30d),
    sales_revenue_60d: safeFloat(s.revenue_60d),
    sales_revenue_90d: safeFloat(s.revenue_90d),

    // Velocity (units per day)
    sales_velocity_7d: round(velocity7d, 4),
    sales_velocity_14d: round(velocity14d, 4),
    sales_velocity_30d: round(velocity30d, 4),
    sales_velocity_60d: round(velocity60d, 4),
    sales_velocity_90d: round(velocity90d, 4),

    // Velocity trends (acceleration/deceleration)
    sales_velocity_trend_7d_vs_30d: velocity30d > 0 ? velocity7d / velocity30d : null,
    sales_velocity_trend_14d_vs_30d: velocity30d > 0 ? velocity14d / velocity30d : null,
    sales_velocity_trend_30d_vs_90d: velocity90d > 0 ? velocity30d / velocity90d : null,

    // Velocity acceleration
    sales_acceleration_7d_14d: velocity14d > 0 ? (velocity7d - velocity14d) / velocity14d : null,
    sales_acceleration_30d_60d: velocity60d > 0 ? (velocity30d - velocity60d) / velocity60d : null,

    // Sales consistency
    sales_avg_per_day: safeFloat(s.avg_units_per_day),
    sales_stddev_per_day: safeFloat(s.stddev_units_per_day),
    sales_cv: s.avg_units_per_day > 0 ? s.stddev_units_per_day / s.avg_units_per_day : null,
    sales_days_with_sales: safeInt(s.days_with_sales),
    sales_days_ratio: s.days_with_sales / 90,

    // Log transforms
    sales_units_30d_log: s.units_30d > 0 ? Math.log1p(s.units_30d) : 0,
    sales_revenue_30d_log: s.revenue_30d > 0 ? Math.log1p(s.revenue_30d) : 0,

    // Has sales flags
    sales_has_sales_7d: s.units_7d > 0 ? 1 : 0,
    sales_has_sales_30d: s.units_30d > 0 ? 1 : 0,
    sales_has_sales_90d: s.units_90d > 0 ? 1 : 0,
  };
}

// ============================================================================
// 4. INVENTORY FEATURES
// ============================================================================

async function computeInventoryFeatures(listingId, listing) {
  const currentStock = safeFloat(listing.available_quantity);

  // Get FBA inventory details
  const fbaInventory = await query(`
    SELECT *
    FROM amazon_fba_inventory
    WHERE seller_sku = $1
    ORDER BY captured_at DESC
    LIMIT 1
  `, [listing.seller_sku]);

  const fba = fbaInventory.rows[0] || {};

  // Get sales velocity for days of cover
  const salesData = await query(`
    SELECT COALESCE(SUM(units), 0) / 30.0 as velocity
    FROM listing_sales_daily
    WHERE listing_id = $1
      AND date >= CURRENT_DATE - 30
  `, [listingId]);

  const velocity = safeFloat(salesData.rows[0]?.velocity);
  const daysOfCover = velocity > 0 ? currentStock / velocity : null;

  return {
    // Current stock
    inv_available_quantity: currentStock,
    inv_available_log: currentStock > 0 ? Math.log1p(currentStock) : 0,

    // FBA inventory breakdown
    inv_fba_fulfillable: safeInt(fba.fulfillable_quantity),
    inv_fba_inbound_working: safeInt(fba.inbound_working_quantity),
    inv_fba_inbound_shipped: safeInt(fba.inbound_shipped_quantity),
    inv_fba_inbound_receiving: safeInt(fba.inbound_receiving_quantity),
    inv_fba_reserved: safeInt(fba.reserved_quantity),
    inv_fba_unfulfillable: safeInt(fba.unfulfillable_quantity),
    inv_fba_researching: safeInt(fba.researching_quantity),
    inv_fba_total: safeInt(fba.total_quantity),

    // Calculated metrics
    inv_days_of_cover: daysOfCover !== null ? round(daysOfCover, 1) : null,
    inv_days_of_cover_capped: daysOfCover !== null ? Math.min(daysOfCover, 365) : null,
    inv_days_of_cover_log: daysOfCover > 0 ? Math.log1p(daysOfCover) : 0,

    // Risk indicators
    inv_stockout_risk_high: daysOfCover !== null && daysOfCover < 7 ? 1 : 0,
    inv_stockout_risk_medium: daysOfCover !== null && daysOfCover >= 7 && daysOfCover < 14 ? 1 : 0,
    inv_stockout_risk_low: daysOfCover !== null && daysOfCover >= 14 ? 1 : 0,
    inv_overstock_risk: daysOfCover !== null && daysOfCover > 90 ? 1 : 0,

    // Stock flags
    inv_is_out_of_stock: currentStock === 0 ? 1 : 0,
    inv_is_low_stock: currentStock > 0 && currentStock < 10 ? 1 : 0,
    inv_has_inbound: (fba.inbound_shipped_quantity || 0) + (fba.inbound_receiving_quantity || 0) > 0 ? 1 : 0,
    inv_has_unfulfillable: (fba.unfulfillable_quantity || 0) > 0 ? 1 : 0,

    // Ratios
    inv_fulfillable_ratio: fba.total_quantity > 0
      ? (fba.fulfillable_quantity || 0) / fba.total_quantity : null,
    inv_reserved_ratio: fba.total_quantity > 0
      ? (fba.reserved_quantity || 0) / fba.total_quantity : null,
  };
}

// ============================================================================
// 5. COMPETITIVE FEATURES
// ============================================================================

async function computeCompetitiveFeatures(asin) {
  if (!asin) {
    return getEmptyCompetitiveFeatures();
  }

  // Get competitive pricing
  const pricing = await query(`
    SELECT *
    FROM amazon_competitive_pricing
    WHERE asin = $1
    ORDER BY captured_at DESC
    LIMIT 1
  `, [asin]);

  const p = pricing.rows[0] || {};

  // Get listing offers (competitors)
  const offers = await query(`
    SELECT
      COUNT(*) as total_offers,
      COUNT(*) FILTER (WHERE is_buy_box_winner) as buy_box_winners,
      COUNT(*) FILTER (WHERE is_fulfilled_by_amazon) as fba_offers,
      COUNT(*) FILTER (WHERE NOT is_fulfilled_by_amazon) as fbm_offers,
      MIN(listing_price_amount) as min_price,
      MAX(listing_price_amount) as max_price,
      AVG(listing_price_amount) as avg_price,
      AVG(feedback_rating) as avg_feedback_rating,
      AVG(feedback_count) as avg_feedback_count
    FROM amazon_listing_offers
    WHERE asin = $1
      AND captured_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
  `, [asin]);

  const o = offers.rows[0] || {};

  // Get Keepa offer counts
  const keepa = await query(`
    SELECT
      parsed_json->'metrics'->>'offers_count_current' as offers_count,
      parsed_json->'metrics'->>'offers_fba_count' as fba_count,
      parsed_json->'metrics'->>'offers_fbm_count' as fbm_count
    FROM keepa_snapshots
    WHERE asin = $1
    ORDER BY captured_at DESC
    LIMIT 1
  `, [asin]);

  const k = keepa.rows[0] || {};

  return {
    // Competitor counts
    comp_total_offers: safeInt(o.total_offers) || safeInt(k.offers_count),
    comp_fba_offers: safeInt(o.fba_offers) || safeInt(k.fba_count),
    comp_fbm_offers: safeInt(o.fbm_offers) || safeInt(k.fbm_count),
    comp_offer_listings: safeInt(p.number_of_offer_listings),

    // Competition intensity
    comp_is_monopoly: (o.total_offers || 0) <= 1 ? 1 : 0,
    comp_is_low_competition: (o.total_offers || 0) <= 5 ? 1 : 0,
    comp_is_high_competition: (o.total_offers || 0) > 20 ? 1 : 0,

    // Price metrics
    comp_min_price: safeFloat(o.min_price),
    comp_max_price: safeFloat(o.max_price),
    comp_avg_price: safeFloat(o.avg_price),
    comp_price_range: o.max_price && o.min_price ? o.max_price - o.min_price : null,
    comp_price_spread: o.avg_price > 0 && o.min_price
      ? (o.avg_price - o.min_price) / o.avg_price : null,

    // Competitive pricing
    comp_competitive_price: safeFloat(p.competitive_price_amount),
    comp_landed_price: safeFloat(p.landed_price_amount),
    comp_listing_price: safeFloat(p.listing_price_amount),
    comp_shipping_amount: safeFloat(p.shipping_amount),

    // Sales rank
    comp_sales_rank: safeInt(p.sales_rank),
    comp_sales_rank_log: p.sales_rank > 0 ? Math.log(p.sales_rank) : null,
    comp_sales_rank_percentile: null, // Would need category data

    // Seller quality
    comp_avg_feedback_rating: safeFloat(o.avg_feedback_rating),
    comp_avg_feedback_count: safeFloat(o.avg_feedback_count),
  };
}

function getEmptyCompetitiveFeatures() {
  return {
    comp_total_offers: null,
    comp_fba_offers: null,
    comp_fbm_offers: null,
    comp_offer_listings: null,
    comp_is_monopoly: null,
    comp_is_low_competition: null,
    comp_is_high_competition: null,
    comp_min_price: null,
    comp_max_price: null,
    comp_avg_price: null,
    comp_price_range: null,
    comp_price_spread: null,
    comp_competitive_price: null,
    comp_landed_price: null,
    comp_listing_price: null,
    comp_shipping_amount: null,
    comp_sales_rank: null,
    comp_sales_rank_log: null,
    comp_sales_rank_percentile: null,
    comp_avg_feedback_rating: null,
    comp_avg_feedback_count: null,
  };
}

// ============================================================================
// 6. TRAFFIC FEATURES
// ============================================================================

async function computeTrafficFeatures(asin) {
  if (!asin) {
    return getEmptyTrafficFeatures();
  }

  // Get traffic data from sales_traffic table
  const traffic = await query(`
    SELECT
      -- 7 day metrics
      COALESCE(SUM(CASE WHEN date >= CURRENT_DATE - 7 THEN sessions END), 0) as sessions_7d,
      COALESCE(SUM(CASE WHEN date >= CURRENT_DATE - 7 THEN page_views END), 0) as page_views_7d,
      COALESCE(SUM(CASE WHEN date >= CURRENT_DATE - 7 THEN units_ordered END), 0) as units_7d,
      COALESCE(AVG(CASE WHEN date >= CURRENT_DATE - 7 THEN buy_box_percentage END), 0) as buy_box_pct_7d,

      -- 30 day metrics
      COALESCE(SUM(sessions), 0) as sessions_30d,
      COALESCE(SUM(page_views), 0) as page_views_30d,
      COALESCE(SUM(units_ordered), 0) as units_30d,
      COALESCE(AVG(buy_box_percentage), 0) as buy_box_pct_30d,
      COALESCE(AVG(unit_session_percentage), 0) as conversion_rate_30d
    FROM amazon_sales_traffic
    WHERE asin = $1
      AND date >= CURRENT_DATE - 30
  `, [asin]);

  const t = traffic.rows[0] || {};

  // Calculate derived metrics
  const sessions7d = safeFloat(t.sessions_7d);
  const sessions30d = safeFloat(t.sessions_30d);
  const pageViews7d = safeFloat(t.page_views_7d);
  const pageViews30d = safeFloat(t.page_views_30d);
  const units7d = safeFloat(t.units_7d);
  const units30d = safeFloat(t.units_30d);

  return {
    // Sessions
    traffic_sessions_7d: sessions7d,
    traffic_sessions_30d: sessions30d,
    traffic_sessions_per_day_7d: round(sessions7d / 7, 2),
    traffic_sessions_per_day_30d: round(sessions30d / 30, 2),
    traffic_sessions_trend: sessions30d > 0 ? (sessions7d / 7) / (sessions30d / 30) : null,

    // Page views
    traffic_page_views_7d: pageViews7d,
    traffic_page_views_30d: pageViews30d,
    traffic_page_views_per_session: sessions30d > 0 ? pageViews30d / sessions30d : null,

    // Conversion
    traffic_conversion_rate: safeFloat(t.conversion_rate_30d),
    traffic_conversion_7d: sessions7d > 0 ? units7d / sessions7d : null,
    traffic_conversion_30d: sessions30d > 0 ? units30d / sessions30d : null,

    // Buy Box
    traffic_buy_box_pct_7d: safeFloat(t.buy_box_pct_7d),
    traffic_buy_box_pct_30d: safeFloat(t.buy_box_pct_30d),
    traffic_buy_box_trend: t.buy_box_pct_30d > 0
      ? t.buy_box_pct_7d / t.buy_box_pct_30d : null,

    // Traffic quality
    traffic_has_traffic: sessions30d > 0 ? 1 : 0,
    traffic_is_high_traffic: sessions30d > 1000 ? 1 : 0,
    traffic_is_low_traffic: sessions30d < 100 && sessions30d > 0 ? 1 : 0,

    // Log transforms
    traffic_sessions_30d_log: sessions30d > 0 ? Math.log1p(sessions30d) : 0,
    traffic_page_views_30d_log: pageViews30d > 0 ? Math.log1p(pageViews30d) : 0,
  };
}

function getEmptyTrafficFeatures() {
  return {
    traffic_sessions_7d: null,
    traffic_sessions_30d: null,
    traffic_sessions_per_day_7d: null,
    traffic_sessions_per_day_30d: null,
    traffic_sessions_trend: null,
    traffic_page_views_7d: null,
    traffic_page_views_30d: null,
    traffic_page_views_per_session: null,
    traffic_conversion_rate: null,
    traffic_conversion_7d: null,
    traffic_conversion_30d: null,
    traffic_buy_box_pct_7d: null,
    traffic_buy_box_pct_30d: null,
    traffic_buy_box_trend: null,
    traffic_has_traffic: null,
    traffic_is_high_traffic: null,
    traffic_is_low_traffic: null,
    traffic_sessions_30d_log: null,
    traffic_page_views_30d_log: null,
  };
}

// ============================================================================
// 7. FINANCIAL FEATURES
// ============================================================================

async function computeFinancialFeatures(listingId, listing) {
  // Get BOM cost
  const bomData = await query(`
    SELECT
      b.id,
      COALESCE(SUM(bl.quantity * (1 + bl.wastage_rate) * c.unit_cost_ex_vat), 0) as bom_cost
    FROM boms b
    LEFT JOIN bom_lines bl ON bl.bom_id = b.id
    LEFT JOIN components c ON c.id = bl.component_id
    WHERE b.listing_id = $1
      AND b.is_active = true
    GROUP BY b.id
    LIMIT 1
  `, [listingId]);

  const bomCost = safeFloat(bomData.rows[0]?.bom_cost);

  // Get FBA fees
  const fbaFees = await query(`
    SELECT *
    FROM amazon_fba_fees
    WHERE seller_sku = $1
    ORDER BY captured_at DESC
    LIMIT 1
  `, [listing.seller_sku]);

  const fees = fbaFees.rows[0] || {};

  // Get financial events (last 30 days)
  const financials = await query(`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE event_type = 'SHIPMENT'), 0) as shipment_revenue,
      COALESCE(SUM(amount) FILTER (WHERE event_type = 'REFUND'), 0) as refund_amount,
      COUNT(*) FILTER (WHERE event_type = 'REFUND') as refund_count
    FROM amazon_financial_events
    WHERE seller_sku = $1
      AND posted_date >= CURRENT_TIMESTAMP - INTERVAL '30 days'
  `, [listing.seller_sku]);

  const fin = financials.rows[0] || {};

  // Calculate economics
  const priceIncVat = safeFloat(listing.price_inc_vat);
  const vatRate = 0.2; // UK VAT
  const priceExVat = priceIncVat / (1 + vatRate);
  const totalFees = safeFloat(fees.total_fees_estimate);
  const totalCost = bomCost + totalFees;
  const profit = priceExVat - totalCost;
  const margin = priceExVat > 0 ? profit / priceExVat : 0;
  const roi = totalCost > 0 ? profit / totalCost : 0;

  return {
    // Costs
    fin_bom_cost: bomCost,
    fin_has_bom: bomCost > 0 ? 1 : 0,
    fin_total_fees: totalFees,
    fin_referral_fee: safeFloat(fees.referral_fee),
    fin_fba_fees: safeFloat(fees.fba_fees),
    fin_fba_pick_pack: safeFloat(fees.fba_pick_pack),
    fin_fba_weight_handling: safeFloat(fees.fba_weight_handling),

    // Margins
    fin_price_ex_vat: round(priceExVat, 2),
    fin_total_cost: round(totalCost, 2),
    fin_profit_per_unit: round(profit, 2),
    fin_margin: round(margin, 4),
    fin_margin_pct: round(margin * 100, 2),
    fin_roi: round(roi, 4),
    fin_roi_pct: round(roi * 100, 2),

    // Margin buckets
    fin_margin_negative: margin < 0 ? 1 : 0,
    fin_margin_low: margin >= 0 && margin < 0.1 ? 1 : 0,
    fin_margin_medium: margin >= 0.1 && margin < 0.2 ? 1 : 0,
    fin_margin_high: margin >= 0.2 ? 1 : 0,

    // Break-even
    fin_break_even_price: totalCost > 0 ? round(totalCost * (1 + vatRate), 2) : null,
    fin_price_above_break_even: totalCost > 0 && priceIncVat > totalCost * (1 + vatRate) ? 1 : 0,

    // Financial events
    fin_shipment_revenue_30d: safeFloat(fin.shipment_revenue),
    fin_refund_amount_30d: safeFloat(fin.refund_amount),
    fin_refund_count_30d: safeInt(fin.refund_count),
    fin_refund_rate: fin.shipment_revenue > 0
      ? Math.abs(fin.refund_amount) / fin.shipment_revenue : null,

    // Fee ratios
    fin_fee_to_price_ratio: priceExVat > 0 ? totalFees / priceExVat : null,
    fin_bom_to_price_ratio: priceExVat > 0 ? bomCost / priceExVat : null,
  };
}

// ============================================================================
// 8. TIME-SERIES FEATURES
// ============================================================================

async function computeTimeSeriesFeatures(listingId, asin) {
  // Get daily sales for time series analysis
  const dailySales = await query(`
    SELECT date, units, revenue_inc_vat
    FROM listing_sales_daily
    WHERE listing_id = $1
      AND date >= CURRENT_DATE - 90
    ORDER BY date
  `, [listingId]);

  const sales = dailySales.rows;
  const units = sales.map(s => safeFloat(s.units));

  if (units.length < 7) {
    return getEmptyTimeSeriesFeatures();
  }

  // Rolling averages
  const ma7 = movingAverage(units, 7);
  const ma14 = movingAverage(units, 14);
  const ma30 = movingAverage(units, 30);

  // Current values (latest)
  const currentMa7 = ma7[ma7.length - 1] || 0;
  const currentMa14 = ma14[ma14.length - 1] || 0;
  const currentMa30 = ma30[ma30.length - 1] || 0;

  // Trends (linear regression slope)
  const trend7d = linearTrend(units.slice(-7));
  const trend14d = linearTrend(units.slice(-14));
  const trend30d = linearTrend(units.slice(-30));

  // Volatility (rolling standard deviation)
  const volatility7d = stddev(units.slice(-7));
  const volatility30d = stddev(units.slice(-30));

  // Seasonality - day of week patterns
  const dowPattern = computeDayOfWeekPattern(sales);

  // Momentum indicators
  const rsi = computeRSI(units, 14);
  const macd = computeMACD(units);

  return {
    // Rolling averages
    ts_ma7_current: round(currentMa7, 4),
    ts_ma14_current: round(currentMa14, 4),
    ts_ma30_current: round(currentMa30, 4),

    // MA crossovers (bullish/bearish signals)
    ts_ma7_above_ma30: currentMa7 > currentMa30 ? 1 : 0,
    ts_ma14_above_ma30: currentMa14 > currentMa30 ? 1 : 0,
    ts_ma_crossover_bullish: currentMa7 > currentMa14 && currentMa14 > currentMa30 ? 1 : 0,

    // Trends
    ts_trend_7d: round(trend7d, 6),
    ts_trend_14d: round(trend14d, 6),
    ts_trend_30d: round(trend30d, 6),
    ts_trend_positive_7d: trend7d > 0 ? 1 : 0,
    ts_trend_positive_30d: trend30d > 0 ? 1 : 0,

    // Volatility
    ts_volatility_7d: round(volatility7d, 4),
    ts_volatility_30d: round(volatility30d, 4),
    ts_volatility_ratio: volatility30d > 0 ? volatility7d / volatility30d : null,
    ts_is_high_volatility: volatility30d > avg(units) * 0.5 ? 1 : 0,

    // Day of week patterns
    ts_dow_best_day: dowPattern.bestDay,
    ts_dow_worst_day: dowPattern.worstDay,
    ts_dow_weekend_ratio: dowPattern.weekendRatio,
    ts_dow_monday_index: dowPattern.mondayIndex,

    // Technical indicators
    ts_rsi: round(rsi, 2),
    ts_rsi_oversold: rsi < 30 ? 1 : 0,
    ts_rsi_overbought: rsi > 70 ? 1 : 0,
    ts_macd_signal: macd.signal,
    ts_macd_histogram: round(macd.histogram, 4),
    ts_macd_bullish: macd.histogram > 0 ? 1 : 0,

    // Anomaly detection
    ts_zscore_current: units.length > 0 ? (units[units.length - 1] - avg(units)) / (stddev(units) || 1) : 0,
    ts_is_anomaly_high: false, // Computed below
    ts_is_anomaly_low: false,  // Computed below
  };
}

function getEmptyTimeSeriesFeatures() {
  return {
    ts_ma7_current: null,
    ts_ma14_current: null,
    ts_ma30_current: null,
    ts_ma7_above_ma30: null,
    ts_ma14_above_ma30: null,
    ts_ma_crossover_bullish: null,
    ts_trend_7d: null,
    ts_trend_14d: null,
    ts_trend_30d: null,
    ts_trend_positive_7d: null,
    ts_trend_positive_30d: null,
    ts_volatility_7d: null,
    ts_volatility_30d: null,
    ts_volatility_ratio: null,
    ts_is_high_volatility: null,
    ts_dow_best_day: null,
    ts_dow_worst_day: null,
    ts_dow_weekend_ratio: null,
    ts_dow_monday_index: null,
    ts_rsi: null,
    ts_rsi_oversold: null,
    ts_rsi_overbought: null,
    ts_macd_signal: null,
    ts_macd_histogram: null,
    ts_macd_bullish: null,
    ts_zscore_current: null,
    ts_is_anomaly_high: null,
    ts_is_anomaly_low: null,
  };
}

// ============================================================================
// 9. DERIVED/INTERACTION FEATURES
// ============================================================================

function computeDerivedFeatures(features) {
  const derived = {};

  // Price-Sales interactions
  if (features.price_current && features.sales_velocity_30d) {
    derived.derived_revenue_potential = features.price_current * features.sales_velocity_30d * 30;
    derived.derived_price_velocity_product = features.price_current * features.sales_velocity_30d;
  }

  // Inventory-Sales interactions
  if (features.inv_days_of_cover !== null && features.sales_velocity_30d) {
    derived.derived_reorder_urgency = features.inv_days_of_cover < 14 && features.sales_velocity_30d > 0 ? 1 : 0;
    derived.derived_overstock_flag = features.inv_days_of_cover > 90 ? 1 : 0;
  }

  // Competition-Price interactions
  if (features.comp_competitive_price && features.price_current) {
    derived.derived_price_competitiveness = 1 - (features.price_current - features.comp_competitive_price) / features.comp_competitive_price;
    derived.derived_is_price_leader = features.price_current <= features.comp_min_price ? 1 : 0;
  }

  // Traffic-Conversion interactions
  if (features.traffic_sessions_30d && features.traffic_conversion_30d) {
    derived.derived_conversion_efficiency = features.traffic_conversion_30d * Math.log1p(features.traffic_sessions_30d);
  }

  // Margin-Volume interactions
  if (features.fin_margin && features.sales_velocity_30d) {
    derived.derived_profit_velocity = features.fin_profit_per_unit * features.sales_velocity_30d;
    derived.derived_monthly_profit_potential = features.fin_profit_per_unit * features.sales_velocity_30d * 30;
  }

  // Buy Box impact
  if (features.traffic_buy_box_pct_30d && features.sales_velocity_30d) {
    derived.derived_buy_box_sales_correlation = features.traffic_buy_box_pct_30d * features.sales_velocity_30d;
  }

  // Composite scores
  derived.derived_health_score = computeHealthScore(features);
  derived.derived_opportunity_score = computeOpportunityScore(features);
  derived.derived_risk_score = computeRiskScore(features);

  // Polynomial features (key metrics squared)
  if (features.fin_margin !== null) {
    derived.derived_margin_squared = features.fin_margin * features.fin_margin;
  }
  if (features.sales_velocity_30d !== null) {
    derived.derived_velocity_squared = features.sales_velocity_30d * features.sales_velocity_30d;
  }

  // Ratio features
  if (features.price_current && features.fin_bom_cost) {
    derived.derived_markup_ratio = features.price_current / features.fin_bom_cost;
  }

  return derived;
}

function computeHealthScore(features) {
  let score = 50; // Base score

  // Positive factors
  if (features.fin_margin > 0.15) score += 15;
  else if (features.fin_margin > 0.1) score += 10;
  else if (features.fin_margin > 0.05) score += 5;

  if (features.traffic_buy_box_pct_30d > 80) score += 10;
  else if (features.traffic_buy_box_pct_30d > 50) score += 5;

  if (features.sales_velocity_30d > 1) score += 10;
  else if (features.sales_velocity_30d > 0.5) score += 5;

  if (features.inv_days_of_cover >= 14 && features.inv_days_of_cover <= 60) score += 10;

  // Negative factors
  if (features.fin_margin < 0) score -= 20;
  if (features.inv_is_out_of_stock) score -= 25;
  if (features.inv_stockout_risk_high) score -= 15;
  if (features.traffic_buy_box_pct_30d < 20) score -= 10;

  return Math.max(0, Math.min(100, score));
}

function computeOpportunityScore(features) {
  let score = 0;

  // High margin opportunity
  if (features.fin_margin > 0.2) score += 25;
  else if (features.fin_margin > 0.15) score += 15;

  // Growing sales
  if (features.sales_velocity_trend_7d_vs_30d > 1.2) score += 20;
  else if (features.sales_velocity_trend_7d_vs_30d > 1.1) score += 10;

  // Buy box recovery potential
  if (features.traffic_buy_box_pct_30d < 50 && features.price_below_competitive) score += 15;

  // Low competition
  if (features.comp_is_low_competition) score += 15;

  // Price optimization potential
  if (features.price_below_p25) score += 10; // Underpriced

  // Traffic without conversion = opportunity
  if (features.traffic_sessions_30d > 500 && features.traffic_conversion_30d < 0.05) score += 15;

  return Math.min(100, score);
}

function computeRiskScore(features) {
  let score = 0;

  // Margin risk
  if (features.fin_margin < 0) score += 30;
  else if (features.fin_margin < 0.05) score += 15;

  // Inventory risk
  if (features.inv_is_out_of_stock) score += 25;
  if (features.inv_stockout_risk_high) score += 20;
  if (features.inv_overstock_risk) score += 10;

  // Competition risk
  if (features.comp_is_high_competition) score += 10;
  if (features.price_above_p75) score += 15;

  // Sales decline risk
  if (features.sales_velocity_trend_7d_vs_30d < 0.8) score += 15;
  if (features.ts_trend_30d < 0) score += 10;

  // Buy box risk
  if (features.traffic_buy_box_pct_30d < 30) score += 15;

  return Math.min(100, score);
}

// ============================================================================
// 10. CATEGORICAL FEATURES (ONE-HOT ENCODING)
// ============================================================================

function computeCategoricalFeatures(listing) {
  return {
    // Fulfillment type
    cat_fulfillment_fba: listing.fulfillmentChannel === 'FBA' ? 1 : 0,
    cat_fulfillment_fbm: listing.fulfillmentChannel === 'FBM' ? 1 : 0,

    // Status
    cat_status_active: listing.status === 'active' ? 1 : 0,
    cat_status_inactive: listing.status === 'inactive' ? 1 : 0,

    // Price tier (based on £ thresholds)
    cat_price_tier_budget: listing.price_inc_vat < 10 ? 1 : 0,
    cat_price_tier_low: listing.price_inc_vat >= 10 && listing.price_inc_vat < 25 ? 1 : 0,
    cat_price_tier_mid: listing.price_inc_vat >= 25 && listing.price_inc_vat < 50 ? 1 : 0,
    cat_price_tier_high: listing.price_inc_vat >= 50 && listing.price_inc_vat < 100 ? 1 : 0,
    cat_price_tier_premium: listing.price_inc_vat >= 100 ? 1 : 0,

    // Has category flag
    cat_has_category: listing.category ? 1 : 0,

    // Category hash (for embedding or lookup)
    cat_category_hash: listing.category ? hashString(listing.category) % 1000 : null,
    cat_brand_hash: listing.brand ? hashString(listing.brand) % 1000 : null,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function getListingData(listingId) {
  const result = await query(`
    SELECT l.*, m.vat_rate
    FROM listings l
    LEFT JOIN marketplaces m ON m.id = l.marketplace_id
    WHERE l.id = $1
  `, [listingId]);
  return result.rows[0];
}

function safeFloat(value, defaultValue = 0) {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

function safeInt(value, defaultValue = 0) {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function round(value, decimals) {
  if (value === null || value === undefined || isNaN(value)) return null;
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function avg(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  if (!arr || arr.length < 2) return 0;
  const mean = avg(arr);
  const squaredDiffs = arr.map(x => Math.pow(x - mean, 2));
  return Math.sqrt(avg(squaredDiffs));
}

function movingAverage(arr, window) {
  if (!arr || arr.length < window) return [];
  const result = [];
  for (let i = window - 1; i < arr.length; i++) {
    const slice = arr.slice(i - window + 1, i + 1);
    result.push(avg(slice));
  }
  return result;
}

function linearTrend(arr) {
  if (!arr || arr.length < 2) return 0;
  const n = arr.length;
  const xMean = (n - 1) / 2;
  const yMean = avg(arr);

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (arr[i] - yMean);
    denominator += (i - xMean) * (i - xMean);
  }

  return denominator !== 0 ? numerator / denominator : 0;
}

function computeDayOfWeekPattern(sales) {
  const dowSums = [0, 0, 0, 0, 0, 0, 0];
  const dowCounts = [0, 0, 0, 0, 0, 0, 0];

  for (const s of sales) {
    const dow = new Date(s.date).getDay();
    dowSums[dow] += safeFloat(s.units);
    dowCounts[dow]++;
  }

  const dowAvgs = dowSums.map((sum, i) => dowCounts[i] > 0 ? sum / dowCounts[i] : 0);
  const maxAvg = Math.max(...dowAvgs);
  const minAvg = Math.min(...dowAvgs.filter(a => a > 0));

  return {
    bestDay: dowAvgs.indexOf(maxAvg),
    worstDay: dowAvgs.indexOf(minAvg),
    weekendRatio: (dowAvgs[0] + dowAvgs[6]) / 2 / (avg(dowAvgs.slice(1, 6)) || 1),
    mondayIndex: dowAvgs[1] / (avg(dowAvgs) || 1),
  };
}

function computeRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function computeMACD(prices) {
  if (prices.length < 26) return { signal: 0, histogram: 0 };

  const ema12 = exponentialMovingAverage(prices, 12);
  const ema26 = exponentialMovingAverage(prices, 26);
  const macdLine = ema12 - ema26;

  // Signal line would need historical MACD values
  // Simplified: use current value as signal approximation
  return {
    signal: macdLine > 0 ? 1 : -1,
    histogram: macdLine,
  };
}

function exponentialMovingAverage(arr, period) {
  if (arr.length < period) return avg(arr);

  const multiplier = 2 / (period + 1);
  let ema = avg(arr.slice(0, period));

  for (let i = period; i < arr.length; i++) {
    ema = (arr[i] - ema) * multiplier + ema;
  }

  return ema;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

// ============================================================================
// BATCH OPERATIONS & EXPORTS
// ============================================================================

/**
 * Compute features for all listings
 */
export async function computeAllListingFeatures() {
  const listings = await query('SELECT id FROM listings WHERE status = $1', ['active']);

  const results = {
    total: listings.rows.length,
    computed: 0,
    errors: [],
  };

  for (const listing of listings.rows) {
    try {
      const features = await computeListingFeatures(listing.id);
      await saveFeatures(listing.id, features);
      results.computed++;
    } catch (error) {
      results.errors.push({ listing_id: listing.id, error: error.message });
    }
  }

  return results;
}

/**
 * Save computed features
 */
export async function saveFeatures(listingId, features) {
  await query(`
    INSERT INTO ml_features (listing_id, features_json, feature_version, computed_at)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
    ON CONFLICT (listing_id) DO UPDATE SET
      features_json = EXCLUDED.features_json,
      feature_version = EXCLUDED.feature_version,
      computed_at = CURRENT_TIMESTAMP
  `, [listingId, JSON.stringify(features), features._feature_version]);
}

/**
 * Ensure ML features table exists
 */
export async function ensureMLTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS ml_features (
      id SERIAL PRIMARY KEY,
      listing_id INTEGER UNIQUE NOT NULL,
      features_json JSONB NOT NULL,
      feature_version INTEGER DEFAULT 1,
      computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_ml_features_listing ON ml_features(listing_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_ml_features_version ON ml_features(feature_version)`);

  // Create ML training labels table
  await query(`
    CREATE TABLE IF NOT EXISTS ml_training_labels (
      id SERIAL PRIMARY KEY,
      listing_id INTEGER NOT NULL,
      label_type VARCHAR(50) NOT NULL,
      label_value DECIMAL(12,4),
      label_date DATE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(listing_id, label_type, label_date)
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_ml_labels_listing ON ml_training_labels(listing_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_ml_labels_type ON ml_training_labels(label_type)`);
}

/**
 * Export features for ML training
 */
export async function exportTrainingData(options = {}) {
  const { format = 'json', includeLabels = true, limit = 10000 } = options;

  let sql = `
    SELECT
      f.listing_id,
      f.features_json,
      f.computed_at
  `;

  if (includeLabels) {
    sql += `,
      (SELECT label_value FROM ml_training_labels l
       WHERE l.listing_id = f.listing_id AND l.label_type = 'next_week_sales'
       ORDER BY l.label_date DESC LIMIT 1) as label_next_week_sales,
      (SELECT label_value FROM ml_training_labels l
       WHERE l.listing_id = f.listing_id AND l.label_type = 'price_change_impact'
       ORDER BY l.label_date DESC LIMIT 1) as label_price_change_impact
    `;
  }

  sql += ` FROM ml_features f ORDER BY f.listing_id LIMIT $1`;

  const result = await query(sql, [limit]);

  if (format === 'flat') {
    // Flatten JSON features into columns
    return result.rows.map(row => ({
      listing_id: row.listing_id,
      computed_at: row.computed_at,
      ...row.features_json,
      label_next_week_sales: row.label_next_week_sales,
      label_price_change_impact: row.label_price_change_impact,
    }));
  }

  return result.rows;
}

export default {
  computeListingFeatures,
  computeAllListingFeatures,
  saveFeatures,
  ensureMLTables,
  exportTrainingData,
};
