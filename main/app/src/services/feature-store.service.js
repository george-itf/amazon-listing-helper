/**
 * Feature Store Service
 *
 * Computes and stores derived features for listings and ASINs.
 * Per SPEC §8 and DATA_CONTRACTS.md §9.
 *
 * Features are computed from:
 * - Economics data (BOM, costs, margins)
 * - Sales data (velocity, revenue, sessions)
 * - Keepa data (price bands, rank trends, offers)
 * - Inventory data (stock levels, days of cover)
 *
 * @module FeatureStoreService
 */

import { query, transaction } from '../database/connection.js';
import * as economicsService from './economics.service.js';
import { calculateDaysOfCover, calculateStockoutRisk } from './guardrails.service.js';

const FEATURE_VERSION = 1;

/**
 * Compute features for a listing
 * Implements COMPUTE_FEATURES_LISTING job
 *
 * @param {number} listingId
 * @returns {Promise<Object>}
 */
export async function computeListingFeatures(listingId) {
  console.log(`[FeatureStore] Computing features for listing ${listingId}`);

  // Get base listing data
  const listingResult = await query(`
    SELECT l.*, m.vat_rate, m.currency_code
    FROM listings l
    JOIN marketplaces m ON m.id = l.marketplace_id
    WHERE l.id = $1
  `, [listingId]);

  if (listingResult.rows.length === 0) {
    throw new Error(`Listing not found: ${listingId}`);
  }

  const listing = listingResult.rows[0];

  // Get economics
  let economics;
  try {
    economics = await economicsService.calculateEconomics(listingId);
  } catch (e) {
    economics = {
      price_inc_vat: parseFloat(listing.price_inc_vat) || 0,
      price_ex_vat: 0,
      bom_cost_ex_vat: 0,
      shipping_cost_ex_vat: 0,
      packaging_cost_ex_vat: 0,
      amazon_fees_ex_vat: 0,
      profit_ex_vat: 0,
      margin: 0,
      break_even_price_inc_vat: 0,
    };
  }

  // Get sales data (7-day and 30-day)
  const salesResult = await query(`
    SELECT
      COALESCE(SUM(CASE WHEN date >= CURRENT_DATE - INTERVAL '7 days' THEN units ELSE 0 END), 0) as units_7d,
      COALESCE(SUM(CASE WHEN date >= CURRENT_DATE - INTERVAL '7 days' THEN revenue_inc_vat ELSE 0 END), 0) as revenue_7d,
      COALESCE(SUM(units), 0) as units_30d,
      COALESCE(SUM(revenue_inc_vat), 0) as revenue_30d,
      COALESCE(SUM(sessions), 0) as sessions_30d,
      COALESCE(AVG(conversion_rate), 0) as avg_conversion_rate_30d
    FROM listing_sales_daily
    WHERE listing_id = $1
      AND date >= CURRENT_DATE - INTERVAL '30 days'
  `, [listingId]);

  const sales = salesResult.rows[0];
  const salesVelocity = parseFloat(sales.units_30d) / 30;
  const availableQuantity = listing.available_quantity || 0;
  const daysOfCover = calculateDaysOfCover(availableQuantity, salesVelocity);

  // Get Buy Box status from listing_offer_current
  const offerResult = await query(`
    SELECT buy_box_status, buy_box_percentage_30d, buy_box_price, is_buy_box_winner
    FROM listing_offer_current
    WHERE listing_id = $1
  `, [listingId]);

  const offer = offerResult.rows[0] || {};
  const buyBoxStatus = offer.buy_box_status || 'UNKNOWN';

  // Get latest Keepa data if ASIN is available
  let keepaFeatures = {
    keepa_price_median_90d: null,
    keepa_price_p25_90d: null,
    keepa_price_p75_90d: null,
    keepa_volatility_90d: null,
    keepa_offers_count_current: null,
    keepa_offers_trend_30d: null,
    keepa_rank_trend_90d: null,
  };

  if (listing.asin) {
    const keepaResult = await query(`
      SELECT parsed_json
      FROM keepa_snapshots
      WHERE asin = $1 AND marketplace_id = $2
      ORDER BY captured_at DESC
      LIMIT 1
    `, [listing.asin, listing.marketplace_id]);

    if (keepaResult.rows.length > 0) {
      const keepa = keepaResult.rows[0].parsed_json;
      if (keepa && keepa.metrics) {
        keepaFeatures = {
          keepa_price_median_90d: keepa.metrics.price_median_90d,
          keepa_price_p25_90d: keepa.metrics.price_p25_90d,
          keepa_price_p75_90d: keepa.metrics.price_p75_90d,
          keepa_volatility_90d: keepa.metrics.price_volatility_90d,
          keepa_offers_count_current: keepa.metrics.offers_count_current,
          keepa_offers_trend_30d: keepa.metrics.offers_trend_30d,
          keepa_rank_trend_90d: keepa.metrics.sales_rank_trend_90d,
        };
      }
    }
  }

  // Calculate competitor price position
  let competitorPricePosition = null;
  if (keepaFeatures.keepa_price_p25_90d && keepaFeatures.keepa_price_p75_90d) {
    const currentPrice = economics.price_inc_vat;
    if (currentPrice < keepaFeatures.keepa_price_p25_90d) {
      competitorPricePosition = 'BELOW_BAND';
    } else if (currentPrice > keepaFeatures.keepa_price_p75_90d) {
      competitorPricePosition = 'ABOVE_BAND';
    } else {
      competitorPricePosition = 'IN_BAND';
    }
  }

  // Calculate Buy Box risk
  let buyBoxRisk = 'UNKNOWN';
  if (buyBoxStatus === 'WON') {
    buyBoxRisk = 'LOW';
  } else if (buyBoxStatus === 'LOST') {
    buyBoxRisk = 'HIGH';
  }

  // Calculate anomaly scores (simple Z-score based)
  const salesAnomalyScore = calculateSalesAnomalyScore(salesVelocity, listing.id);

  // Build features object per DATA_CONTRACTS.md §9.3
  const features = {
    // Economics
    vat_rate: parseFloat(listing.vat_rate),
    price_inc_vat: economics.price_inc_vat,
    price_ex_vat: economics.price_ex_vat,
    bom_cost_ex_vat: economics.bom_cost_ex_vat,
    shipping_cost_ex_vat: economics.shipping_cost_ex_vat,
    packaging_cost_ex_vat: economics.packaging_cost_ex_vat,
    amazon_fees_ex_vat: economics.amazon_fees_ex_vat,
    profit_ex_vat: economics.profit_ex_vat,
    margin: economics.margin,
    break_even_price_inc_vat: economics.break_even_price_inc_vat,

    // Sales/Performance
    units_7d: parseInt(sales.units_7d, 10),
    units_30d: parseInt(sales.units_30d, 10),
    revenue_inc_vat_7d: parseFloat(sales.revenue_7d),
    revenue_inc_vat_30d: parseFloat(sales.revenue_30d),
    sessions_30d: parseInt(sales.sessions_30d, 10) || null,
    conversion_rate_30d: parseFloat(sales.avg_conversion_rate_30d) || null,
    sales_velocity_units_per_day_30d: Math.round(salesVelocity * 100) / 100,

    // Inventory
    available_quantity: availableQuantity,
    days_of_cover: daysOfCover !== null ? Math.round(daysOfCover * 10) / 10 : null,
    lead_time_days: 14, // Default, could be from settings
    stockout_risk: calculateStockoutRisk(daysOfCover),

    // Buy Box
    buy_box_status: buyBoxStatus,
    buy_box_percentage_30d: offer.buy_box_percentage_30d ? parseFloat(offer.buy_box_percentage_30d) : null,
    buy_box_risk: buyBoxRisk,
    competitor_price_position: competitorPricePosition,

    // Keepa Signals
    ...keepaFeatures,

    // Anomaly Signals
    sales_anomaly_score: salesAnomalyScore,
    conversion_anomaly_score: null, // Would need historical conversion data
    buy_box_anomaly_score: null, // Would need historical buy box data
  };

  // Save to feature store
  const saved = await saveFeatures('LISTING', listingId, features);

  return {
    listing_id: listingId,
    feature_store_id: saved.id,
    feature_version: FEATURE_VERSION,
    features,
    computed_at: saved.computed_at,
  };
}

/**
 * Compute features for an ASIN entity
 * Implements COMPUTE_FEATURES_ASIN job
 *
 * @param {number} asinEntityId
 * @returns {Promise<Object>}
 */
export async function computeAsinFeatures(asinEntityId) {
  console.log(`[FeatureStore] Computing features for ASIN entity ${asinEntityId}`);

  // Get ASIN entity data
  const entityResult = await query(`
    SELECT ae.*, m.vat_rate, m.currency_code
    FROM asin_entities ae
    JOIN marketplaces m ON m.id = ae.marketplace_id
    WHERE ae.id = $1
  `, [asinEntityId]);

  if (entityResult.rows.length === 0) {
    throw new Error(`ASIN entity not found: ${asinEntityId}`);
  }

  const entity = entityResult.rows[0];

  // Get latest Keepa data
  const keepaResult = await query(`
    SELECT parsed_json
    FROM keepa_snapshots
    WHERE asin_entity_id = $1
    ORDER BY captured_at DESC
    LIMIT 1
  `, [asinEntityId]);

  let keepaMetrics = null;
  if (keepaResult.rows.length > 0 && keepaResult.rows[0].parsed_json) {
    keepaMetrics = keepaResult.rows[0].parsed_json.metrics;
  }

  // Get scenario BOM if exists
  const bomResult = await query(`
    SELECT b.id, COALESCE(SUM(bl.quantity * (1 + bl.wastage_rate) * c.unit_cost_ex_vat), 0) as total_cost
    FROM boms b
    LEFT JOIN bom_lines bl ON bl.bom_id = b.id
    LEFT JOIN components c ON c.id = bl.component_id
    WHERE b.asin_entity_id = $1
      AND b.is_active = true
      AND b.scope_type = 'ASIN_SCENARIO'
    GROUP BY b.id
  `, [asinEntityId]);

  const scenarioBomCost = bomResult.rows.length > 0 ? parseFloat(bomResult.rows[0].total_cost) : null;

  // Build ASIN features
  const features = {
    // Basic info
    asin: entity.asin,
    marketplace_id: entity.marketplace_id,
    title: entity.title,
    brand: entity.brand,
    category: entity.category,

    // Keepa metrics
    price_current: keepaMetrics?.price_current || null,
    price_median_90d: keepaMetrics?.price_median_90d || null,
    price_p25_90d: keepaMetrics?.price_p25_90d || null,
    price_p75_90d: keepaMetrics?.price_p75_90d || null,
    price_volatility_90d: keepaMetrics?.price_volatility_90d || null,
    sales_rank_current: keepaMetrics?.sales_rank_current || null,
    sales_rank_trend_90d: keepaMetrics?.sales_rank_trend_90d || null,
    offers_count_current: keepaMetrics?.offers_count_current || null,
    buy_box_price: keepaMetrics?.buy_box_price || null,

    // Scenario BOM
    scenario_bom_cost_ex_vat: scenarioBomCost,
    has_scenario_bom: scenarioBomCost !== null,

    // Opportunity metrics (computed if we have price and BOM)
    opportunity_margin: null,
    opportunity_profit: null,
  };

  // Calculate opportunity metrics if we have scenario BOM and price data
  if (scenarioBomCost !== null && keepaMetrics?.price_current) {
    const priceIncVat = keepaMetrics.price_current;
    const priceExVat = priceIncVat / (1 + parseFloat(entity.vat_rate));
    const estimatedFees = priceExVat * 0.15; // Rough estimate
    const estimatedProfit = priceExVat - scenarioBomCost - estimatedFees;
    const estimatedMargin = priceExVat > 0 ? estimatedProfit / priceExVat : 0;

    features.opportunity_profit = Math.round(estimatedProfit * 100) / 100;
    features.opportunity_margin = Math.round(estimatedMargin * 1000) / 1000;
  }

  // Save to feature store
  const saved = await saveFeatures('ASIN', asinEntityId, features);

  return {
    asin_entity_id: asinEntityId,
    feature_store_id: saved.id,
    feature_version: FEATURE_VERSION,
    features,
    computed_at: saved.computed_at,
  };
}

/**
 * Save features to feature store
 * @param {string} entityType - 'LISTING' or 'ASIN'
 * @param {number} entityId
 * @param {Object} features
 * @returns {Promise<Object>}
 */
export async function saveFeatures(entityType, entityId, features) {
  const result = await query(`
    INSERT INTO feature_store (entity_type, entity_id, feature_version, features_json, computed_at)
    VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
    RETURNING *
  `, [entityType, entityId, FEATURE_VERSION, JSON.stringify(features)]);

  return result.rows[0];
}

/**
 * Get latest features for an entity
 * @param {string} entityType
 * @param {number} entityId
 * @returns {Promise<Object|null>}
 */
export async function getLatestFeatures(entityType, entityId) {
  const result = await query(`
    SELECT * FROM feature_store
    WHERE entity_type = $1 AND entity_id = $2
    ORDER BY computed_at DESC
    LIMIT 1
  `, [entityType, entityId]);

  return result.rows[0] || null;
}

/**
 * Get feature history for an entity
 * @param {string} entityType
 * @param {number} entityId
 * @param {number} limit
 * @returns {Promise<Object[]>}
 */
export async function getFeatureHistory(entityType, entityId, limit = 30) {
  const result = await query(`
    SELECT id, feature_version, features_json, computed_at
    FROM feature_store
    WHERE entity_type = $1 AND entity_id = $2
    ORDER BY computed_at DESC
    LIMIT $3
  `, [entityType, entityId, limit]);

  return result.rows;
}

/**
 * Calculate sales anomaly score
 * Simple implementation - would be more sophisticated in production
 *
 * @param {number} currentVelocity
 * @param {number} listingId
 * @returns {number} Anomaly score (0-1, higher = more anomalous)
 */
function calculateSalesAnomalyScore(currentVelocity, listingId) {
  // For a proper implementation, we would:
  // 1. Get historical velocity data
  // 2. Calculate rolling average and std dev
  // 3. Compute Z-score
  // 4. Convert to 0-1 score

  // Simple placeholder: return low score
  return 0;
}

export default {
  computeListingFeatures,
  computeAsinFeatures,
  saveFeatures,
  getLatestFeatures,
  getFeatureHistory,
};
