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

/**
 * Safe parseFloat - returns defaultValue on NaN
 */
function safeParseFloat(value, defaultValue = 0) {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Safe parseInt - returns defaultValue on NaN
 */
function safeParseInt(value, defaultValue = 0) {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

const FEATURE_VERSION = 1;

/**
 * Compute features for a listing
 * Implements COMPUTE_FEATURES_LISTING job
 *
 * A.2.4 FIX: Uses advisory lock to prevent concurrent feature computations
 *
 * @param {number} listingId
 * @returns {Promise<Object>}
 */
export async function computeListingFeatures(listingId) {
  console.log(`[FeatureStore] Computing features for listing ${listingId}`);

  // A.2.4 FIX: Acquire advisory lock to prevent concurrent computation for same listing
  // Lock key: 300000000 + listingId (namespace for feature computations)
  const lockKey = 300000000 + listingId;
  const lockResult = await query('SELECT pg_try_advisory_lock($1) as acquired', [lockKey]);

  if (!lockResult.rows[0].acquired) {
    console.log(`[FeatureStore] Skipping listing ${listingId} - concurrent computation in progress`);
    // Return existing features instead of skipping entirely
    const existing = await getLatestFeatures('LISTING', listingId);
    if (existing) {
      return {
        listing_id: listingId,
        feature_store_id: existing.id,
        feature_version: existing.feature_version,
        features: existing.features_json,
        computed_at: existing.computed_at,
        skipped: true,
        reason: 'Concurrent computation in progress',
      };
    }
    throw new Error(`Cannot compute features: concurrent computation in progress and no existing features`);
  }

  try {
    return await doComputeListingFeatures(listingId);
  } finally {
    // A.2.4: Always release the lock
    await query('SELECT pg_advisory_unlock($1)', [lockKey]);
  }
}

/**
 * Internal implementation of feature computation
 * A.2.3 FIX: Derives lead_time_days from BOM components instead of hardcoded 14 days
 * @private
 */
async function doComputeListingFeatures(listingId) {
  // Get base listing data (LEFT JOIN to handle listings without marketplace)
  const listingResult = await query(`
    SELECT l.*, COALESCE(m.vat_rate, 0.20) as vat_rate, COALESCE(m.currency_code, 'GBP') as currency_code
    FROM listings l
    LEFT JOIN marketplaces m ON m.id = l.marketplace_id
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
      price_inc_vat: safeParseFloat(listing.price_inc_vat, 0),
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

  // Get sales data (7-day and 30-day) - safe if table doesn't exist
  let sales = {
    units_7d: 0, units_30d: 0, revenue_7d: 0, revenue_30d: 0,
    sessions_30d: 0, avg_conversion_rate_30d: 0
  };
  try {
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
    sales = salesResult.rows[0];
  } catch (error) {
    if (!error.message?.includes('does not exist')) throw error;
  }
  const salesVelocity = safeParseFloat(sales.units_30d, 0) / 30;
  const availableQuantity = listing.available_quantity || 0;
  const daysOfCover = calculateDaysOfCover(availableQuantity, salesVelocity);

  // A.2.3 FIX: Get max lead time from BOM components instead of hardcoded 14 days
  let leadTimeDays = 14; // Default fallback
  try {
    const leadTimeResult = await query(`
      SELECT COALESCE(MAX(c.lead_time_days), 0) as max_lead_time
      FROM boms b
      JOIN bom_lines bl ON bl.bom_id = b.id
      JOIN components c ON c.id = bl.component_id
      WHERE b.listing_id = $1
        AND b.is_active = true
        AND b.scope_type = 'LISTING'
    `, [listingId]);
    const maxLeadTime = safeParseInt(leadTimeResult.rows[0]?.max_lead_time, 0);
    if (maxLeadTime > 0) {
      leadTimeDays = maxLeadTime;
    }
  } catch (error) {
    // Table might not exist - use default
    if (!error.message?.includes('does not exist')) throw error;
  }

  // Get Buy Box status - try multiple sources
  let offer = {};
  let buyBoxPercentage30d = null;

  // Source 1: listing_offer_current (primary)
  try {
    const offerResult = await query(`
      SELECT buy_box_status, buy_box_percentage_30d, buy_box_price, is_buy_box_winner
      FROM listing_offer_current
      WHERE listing_id = $1
    `, [listingId]);
    offer = offerResult.rows[0] || {};
  } catch (error) {
    if (!error.message?.includes('does not exist')) throw error;
  }

  // Source 2: amazon_sales_traffic (fallback - uses ASIN to get buy_box_percentage)
  if (!offer.buy_box_status && listing.asin) {
    try {
      const trafficResult = await query(`
        SELECT AVG(buy_box_percentage) as avg_buy_box_percentage
        FROM amazon_sales_traffic
        WHERE asin = $1
          AND date >= CURRENT_DATE - INTERVAL '30 days'
      `, [listing.asin]);
      if (trafficResult.rows[0]?.avg_buy_box_percentage != null) {
        buyBoxPercentage30d = safeParseFloat(trafficResult.rows[0].avg_buy_box_percentage, null);
      }
    } catch (error) {
      if (!error.message?.includes('does not exist')) throw error;
    }
  }

  // Determine Buy Box status from available data
  let buyBoxStatus = offer.buy_box_status || 'UNKNOWN';
  if (buyBoxStatus === 'UNKNOWN' && buyBoxPercentage30d !== null) {
    // Derive status from buy_box_percentage: >50% = WON, 0% = LOST, otherwise PARTIAL
    if (buyBoxPercentage30d >= 50) {
      buyBoxStatus = 'WON';
    } else if (buyBoxPercentage30d === 0) {
      buyBoxStatus = 'LOST';
    } else {
      buyBoxStatus = 'PARTIAL'; // We have some buy box share but not majority
    }
  }

  // Use buy_box_percentage from either source
  const finalBuyBoxPercentage = safeParseFloat(offer.buy_box_percentage_30d, null) ?? buyBoxPercentage30d;

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
    try {
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
    } catch (error) {
      if (!error.message?.includes('does not exist')) throw error;
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
  } else if (buyBoxStatus === 'PARTIAL') {
    buyBoxRisk = 'MEDIUM';
  }

  // Calculate anomaly scores using Z-score analysis
  const salesAnomalyScore = await calculateSalesAnomalyScore(salesVelocity, listing.id);

  // Build features object per DATA_CONTRACTS.md §9.3
  const features = {
    // Economics
    vat_rate: safeParseFloat(listing.vat_rate, 0.2),
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
    units_7d: safeParseInt(sales.units_7d, 0),
    units_30d: safeParseInt(sales.units_30d, 0),
    revenue_inc_vat_7d: safeParseFloat(sales.revenue_7d, 0),
    revenue_inc_vat_30d: safeParseFloat(sales.revenue_30d, 0),
    sessions_30d: safeParseInt(sales.sessions_30d, 0) || null,
    conversion_rate_30d: safeParseFloat(sales.avg_conversion_rate_30d, 0) || null,
    sales_velocity_units_per_day_30d: Math.round(salesVelocity * 100) / 100,

    // Inventory
    available_quantity: availableQuantity,
    days_of_cover: daysOfCover !== null ? Math.round(daysOfCover * 10) / 10 : null,
    lead_time_days: leadTimeDays, // A.2.3 FIX: Derived from BOM component max lead time
    stockout_risk: calculateStockoutRisk(daysOfCover),

    // Buy Box
    buy_box_status: buyBoxStatus,
    buy_box_percentage_30d: finalBuyBoxPercentage,
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

  // Get ASIN entity data (LEFT JOIN to handle entities without marketplace)
  const entityResult = await query(`
    SELECT ae.*, COALESCE(m.vat_rate, 0.20) as vat_rate, COALESCE(m.currency_code, 'GBP') as currency_code
    FROM asin_entities ae
    LEFT JOIN marketplaces m ON m.id = ae.marketplace_id
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

  const scenarioBomCost = bomResult.rows.length > 0 ? safeParseFloat(bomResult.rows[0].total_cost, null) : null;

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
    const vatRate = safeParseFloat(entity.vat_rate, 0.2);
    const priceExVat = priceIncVat / (1 + vatRate);
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
 * Implements duplicate suppression by comparing feature hash (Addendum D)
 *
 * @param {string} entityType - 'LISTING' or 'ASIN'
 * @param {number} entityId
 * @param {Object} features
 * @returns {Promise<Object>}
 */
export async function saveFeatures(entityType, entityId, features) {
  const newFeaturesJson = JSON.stringify(features);

  // Check for existing features to avoid duplicates (Addendum D)
  const existing = await getLatestFeatures(entityType, entityId);
  if (existing) {
    const existingFeaturesJson = JSON.stringify(existing.features_json);
    if (existingFeaturesJson === newFeaturesJson) {
      console.log(`[FeatureStore] Skipping duplicate features for ${entityType} ${entityId}`);
      return existing; // Return existing row, no new insert
    }
  }

  try {
    const result = await query(`
      INSERT INTO feature_store (entity_type, entity_id, feature_version, features_json, computed_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      RETURNING *
    `, [entityType, entityId, FEATURE_VERSION, newFeaturesJson]);

    return result.rows[0];
  } catch (error) {
    // Handle missing table gracefully - return a mock result
    if (error.message?.includes('does not exist')) {
      console.warn('[FeatureStore] feature_store table does not exist, returning unsaved features');
      return {
        id: null,
        entity_type: entityType,
        entity_id: entityId,
        feature_version: FEATURE_VERSION,
        features_json: features,
        computed_at: new Date().toISOString(),
      };
    }
    throw error;
  }
}

/**
 * Get latest features for an entity
 * @param {string} entityType
 * @param {number} entityId
 * @returns {Promise<Object|null>}
 */
export async function getLatestFeatures(entityType, entityId) {
  try {
    const result = await query(`
      SELECT * FROM feature_store
      WHERE entity_type = $1 AND entity_id = $2
      ORDER BY computed_at DESC
      LIMIT 1
    `, [entityType, entityId]);

    return result.rows[0] || null;
  } catch (error) {
    // Handle missing table gracefully
    if (error.message?.includes('does not exist')) {
      console.warn('[FeatureStore] feature_store table does not exist');
      return null;
    }
    throw error;
  }
}

/**
 * Get feature history for an entity
 * @param {string} entityType
 * @param {number} entityId
 * @param {number} limit
 * @returns {Promise<Object[]>}
 */
export async function getFeatureHistory(entityType, entityId, limit = 30) {
  try {
    const result = await query(`
      SELECT id, feature_version, features_json, computed_at
      FROM feature_store
      WHERE entity_type = $1 AND entity_id = $2
      ORDER BY computed_at DESC
      LIMIT $3
    `, [entityType, entityId, limit]);

    return result.rows;
  } catch (error) {
    // Handle missing table gracefully
    if (error.message?.includes('does not exist')) {
      console.warn('[FeatureStore] feature_store table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Calculate sales anomaly score using Z-score analysis
 * Compares recent sales velocity against historical average
 *
 * @param {number} currentVelocity - Current daily sales velocity
 * @param {number} listingId - Listing ID to get historical data
 * @returns {Promise<number>} Anomaly score (0-1, higher = more anomalous)
 */
async function calculateSalesAnomalyScore(currentVelocity, listingId) {
  try {
    // Get historical daily sales for the past 90 days
    const result = await query(`
      SELECT
        AVG(units)::numeric as avg_units,
        STDDEV(units)::numeric as stddev_units,
        COUNT(*) as days_count
      FROM listing_sales_daily
      WHERE listing_id = $1
        AND date >= CURRENT_DATE - INTERVAL '90 days'
        AND date < CURRENT_DATE - INTERVAL '7 days'
    `, [listingId]);

    const stats = result.rows[0];
    const avgUnits = safeParseFloat(stats.avg_units, 0);
    const stddevUnits = safeParseFloat(stats.stddev_units, 0);
    const daysCount = safeParseInt(stats.days_count, 0);

    // Need at least 14 days of history for meaningful stats
    if (daysCount < 14 || stddevUnits === 0) {
      return 0; // Not enough data to detect anomalies
    }

    // Calculate Z-score: how many standard deviations from mean
    const zScore = (currentVelocity - avgUnits) / stddevUnits;

    // Convert Z-score to 0-1 anomaly score
    // We care about negative anomalies (sales drops) more than positive
    // Z-score of -2 or lower = high anomaly (0.8+)
    // Z-score of -1 to -2 = moderate anomaly (0.4-0.8)
    // Z-score of 0 to -1 = low anomaly (0-0.4)
    // Positive Z-scores (sales increases) = 0 (not an anomaly)

    if (zScore >= 0) {
      return 0; // Sales are normal or above average
    }

    // Normalize negative Z-score to 0-1 range
    // Z=-1 maps to ~0.3, Z=-2 maps to ~0.7, Z=-3 maps to ~0.9
    const absZ = Math.abs(zScore);
    const anomalyScore = Math.min(1, 1 - Math.exp(-absZ * 0.5));

    return Math.round(anomalyScore * 100) / 100;
  } catch (error) {
    console.warn('[FeatureStore] Error calculating anomaly score:', error.message);
    return 0; // Default to no anomaly on error
  }
}

export default {
  computeListingFeatures,
  computeAsinFeatures,
  saveFeatures,
  getLatestFeatures,
  getFeatureHistory,
};
