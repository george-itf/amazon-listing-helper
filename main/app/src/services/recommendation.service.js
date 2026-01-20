/**
 * Recommendation Service
 *
 * Generates and manages recommendations for listings and ASINs.
 * Per SPEC §10 and DATA_CONTRACTS.md.
 *
 * Recommendation Types:
 * - PRICE_DECREASE_REGAIN_BUYBOX: Lost Buy Box, price cut may help
 * - PRICE_INCREASE_MARGIN_OPPORTUNITY: Winning Buy Box with room to increase
 * - STOCK_INCREASE_STOCKOUT_RISK: Low days of cover
 * - STOCK_DECREASE_OVERSTOCK: Excess inventory tying up capital
 * - MARGIN_AT_RISK_COMPONENT_COST: Component costs increased
 * - ANOMALY_SALES_DROP: Significant sales decline detected
 * - ANOMALY_CONVERSION_DROP: Conversion rate anomaly
 * - ANOMALY_BUY_BOX_LOSS: Unexpected Buy Box loss
 * - OPPORTUNITY_CREATE_LISTING: ASIN opportunity identified
 *
 * @module RecommendationService
 */

import { query, transaction } from '../database/connection.js';
import * as featureStoreService from './feature-store.service.js';
import { loadGuardrails, validatePriceChange } from './guardrails.service.js';

/**
 * Generate recommendations for a listing
 * Implements GENERATE_RECOMMENDATIONS_LISTING job
 *
 * @param {number} listingId
 * @param {number} [jobId] - Optional job ID for tracking
 * @returns {Promise<Object>}
 */
export async function generateListingRecommendations(listingId, jobId = null) {
  console.log(`[Recommendations] Generating for listing ${listingId}`);

  // Get latest features
  const featuresRow = await featureStoreService.getLatestFeatures('LISTING', listingId);

  if (!featuresRow) {
    // Try to compute features first
    await featureStoreService.computeListingFeatures(listingId);
    const newFeatures = await featureStoreService.getLatestFeatures('LISTING', listingId);
    if (!newFeatures) {
      throw new Error(`Cannot generate recommendations: no features for listing ${listingId}`);
    }
  }

  const features = featuresRow?.features_json || (await featureStoreService.getLatestFeatures('LISTING', listingId))?.features_json;

  if (!features) {
    throw new Error(`Cannot generate recommendations: no features for listing ${listingId}`);
  }

  const recommendations = [];
  const guardrails = await loadGuardrails();

  // Expire old pending recommendations for this listing
  await expireOldRecommendations('LISTING', listingId);

  // 1. PRICE_DECREASE_REGAIN_BUYBOX
  if (features.buy_box_status === 'LOST' && features.keepa_price_p25_90d) {
    const rec = await generatePriceDecreaseBuyBoxRec(listingId, features, guardrails);
    if (rec) recommendations.push(rec);
  }

  // 2. PRICE_INCREASE_MARGIN_OPPORTUNITY
  if (features.buy_box_status === 'WON' && features.margin > guardrails.minMargin + 0.05) {
    const rec = await generatePriceIncreaseRec(listingId, features, guardrails);
    if (rec) recommendations.push(rec);
  }

  // 3. STOCK_INCREASE_STOCKOUT_RISK
  if (features.stockout_risk === 'HIGH' || features.stockout_risk === 'MEDIUM') {
    const rec = await generateStockIncreaseRec(listingId, features);
    if (rec) recommendations.push(rec);
  }

  // 4. MARGIN_AT_RISK_COMPONENT_COST
  if (features.margin < guardrails.minMargin) {
    const rec = await generateMarginAtRiskRec(listingId, features, guardrails);
    if (rec) recommendations.push(rec);
  }

  // 5. ANOMALY_SALES_DROP
  if (features.sales_anomaly_score > 0.7) {
    const rec = await generateSalesAnomalyRec(listingId, features);
    if (rec) recommendations.push(rec);
  }

  // Save recommendations
  const savedRecs = [];
  for (const rec of recommendations) {
    const saved = await saveRecommendation(rec, jobId);
    savedRecs.push(saved);
  }

  return {
    listing_id: listingId,
    recommendations_generated: savedRecs.length,
    recommendations: savedRecs,
  };
}

/**
 * Generate recommendations for an ASIN entity
 * Implements GENERATE_RECOMMENDATIONS_ASIN job
 *
 * @param {number} asinEntityId
 * @param {number} [jobId]
 * @returns {Promise<Object>}
 */
export async function generateAsinRecommendations(asinEntityId, jobId = null) {
  console.log(`[Recommendations] Generating for ASIN entity ${asinEntityId}`);

  // Get latest features
  const featuresRow = await featureStoreService.getLatestFeatures('ASIN', asinEntityId);
  const features = featuresRow?.features_json;

  if (!features) {
    throw new Error(`Cannot generate recommendations: no features for ASIN entity ${asinEntityId}`);
  }

  const recommendations = [];

  // Expire old pending recommendations
  await expireOldRecommendations('ASIN', asinEntityId);

  // OPPORTUNITY_CREATE_LISTING
  if (features.opportunity_margin && features.opportunity_margin > 0.20) {
    const rec = await generateOpportunityRec(asinEntityId, features);
    if (rec) recommendations.push(rec);
  }

  // Save recommendations
  const savedRecs = [];
  for (const rec of recommendations) {
    const saved = await saveRecommendation(rec, jobId);
    savedRecs.push(saved);
  }

  return {
    asin_entity_id: asinEntityId,
    recommendations_generated: savedRecs.length,
    recommendations: savedRecs,
  };
}

/**
 * Generate PRICE_DECREASE_REGAIN_BUYBOX recommendation
 */
async function generatePriceDecreaseBuyBoxRec(listingId, features, guardrails) {
  // Suggest price at 25th percentile of market
  const suggestedPrice = features.keepa_price_p25_90d;
  const currentPrice = features.price_inc_vat;

  if (!suggestedPrice || suggestedPrice >= currentPrice) {
    return null; // No decrease needed
  }

  // Calculate new margin at suggested price
  const priceExVat = suggestedPrice / (1 + features.vat_rate);
  const totalCost = features.bom_cost_ex_vat + features.shipping_cost_ex_vat +
                    features.packaging_cost_ex_vat + features.amazon_fees_ex_vat;
  const newProfit = priceExVat - totalCost;
  const newMargin = priceExVat > 0 ? newProfit / priceExVat : 0;

  // Don't suggest if it would violate minimum margin
  if (newMargin < guardrails.minMargin) {
    return null;
  }

  const priceChange = suggestedPrice - currentPrice;
  const confidence = determinePriceConfidence(features);

  return {
    recommendation_type: 'PRICE_DECREASE_REGAIN_BUYBOX',
    entity_type: 'LISTING',
    entity_id: listingId,
    action_payload_json: {
      action: 'CHANGE_PRICE',
      suggested_price_inc_vat: roundMoney(suggestedPrice),
      current_price_inc_vat: currentPrice,
      price_change: roundMoney(priceChange),
    },
    evidence_json: {
      buy_box_status: features.buy_box_status,
      buy_box_percentage_30d: features.buy_box_percentage_30d,
      keepa_price_p25_90d: features.keepa_price_p25_90d,
      keepa_price_median_90d: features.keepa_price_median_90d,
      competitor_price_position: features.competitor_price_position,
      notes: 'Price is above market 25th percentile. Reducing price may help regain Buy Box.',
    },
    guardrails_json: {
      passed: true,
      new_margin: roundMoney(newMargin),
      min_margin: guardrails.minMargin,
    },
    impact_json: {
      estimated_margin_change: roundMoney(newMargin - features.margin),
      estimated_profit_change: roundMoney(newProfit - features.profit_ex_vat),
      buy_box_recovery_likelihood: confidence === 'HIGH' ? 'LIKELY' : confidence === 'MEDIUM' ? 'POSSIBLE' : 'UNCERTAIN',
    },
    confidence,
    confidence_score: confidence === 'HIGH' ? 0.85 : confidence === 'MEDIUM' ? 0.65 : 0.45,
  };
}

/**
 * Generate PRICE_INCREASE_MARGIN_OPPORTUNITY recommendation
 */
async function generatePriceIncreaseRec(listingId, features, guardrails) {
  // Suggest price increase up to market median
  const suggestedPrice = features.keepa_price_median_90d;
  const currentPrice = features.price_inc_vat;

  if (!suggestedPrice || suggestedPrice <= currentPrice) {
    return null;
  }

  // Limit increase to max allowed per day
  const maxIncrease = currentPrice * guardrails.maxPriceChangePctPerDay;
  const actualSuggested = Math.min(suggestedPrice, currentPrice + maxIncrease);

  if (actualSuggested <= currentPrice * 1.01) {
    return null; // Less than 1% increase not worth it
  }

  const priceExVat = actualSuggested / (1 + features.vat_rate);
  const totalCost = features.bom_cost_ex_vat + features.shipping_cost_ex_vat +
                    features.packaging_cost_ex_vat + features.amazon_fees_ex_vat;
  const newProfit = priceExVat - totalCost;
  const newMargin = priceExVat > 0 ? newProfit / priceExVat : 0;

  return {
    recommendation_type: 'PRICE_INCREASE_MARGIN_OPPORTUNITY',
    entity_type: 'LISTING',
    entity_id: listingId,
    action_payload_json: {
      action: 'CHANGE_PRICE',
      suggested_price_inc_vat: roundMoney(actualSuggested),
      current_price_inc_vat: currentPrice,
      price_change: roundMoney(actualSuggested - currentPrice),
    },
    evidence_json: {
      buy_box_status: features.buy_box_status,
      current_margin: features.margin,
      keepa_price_median_90d: features.keepa_price_median_90d,
      competitor_price_position: features.competitor_price_position,
      notes: 'Currently winning Buy Box with price below market median. Room to increase margin.',
    },
    guardrails_json: {
      passed: true,
      new_margin: roundMoney(newMargin),
    },
    impact_json: {
      estimated_margin_change: roundMoney(newMargin - features.margin),
      estimated_profit_change: roundMoney(newProfit - features.profit_ex_vat),
      buy_box_risk: 'LOW',
    },
    confidence: 'MEDIUM',
    confidence_score: 0.60,
  };
}

/**
 * Generate STOCK_INCREASE_STOCKOUT_RISK recommendation
 */
async function generateStockIncreaseRec(listingId, features) {
  const velocity = features.sales_velocity_units_per_day_30d;
  const daysOfCover = features.days_of_cover;
  const leadTime = features.lead_time_days || 14;

  // Suggest stock to cover 2x lead time
  const targetDays = leadTime * 2;
  const suggestedStock = Math.ceil(velocity * targetDays);
  const currentStock = features.available_quantity;

  if (suggestedStock <= currentStock) {
    return null;
  }

  return {
    recommendation_type: 'STOCK_INCREASE_STOCKOUT_RISK',
    entity_type: 'LISTING',
    entity_id: listingId,
    action_payload_json: {
      action: 'CHANGE_STOCK',
      suggested_quantity: suggestedStock,
      current_quantity: currentStock,
      quantity_change: suggestedStock - currentStock,
    },
    evidence_json: {
      current_stock: currentStock,
      days_of_cover: daysOfCover,
      sales_velocity_30d: velocity,
      lead_time_days: leadTime,
      stockout_risk: features.stockout_risk,
      notes: `Only ${daysOfCover?.toFixed(1) || 'N/A'} days of cover with ${leadTime} day lead time.`,
    },
    guardrails_json: null,
    impact_json: {
      prevented_stockout_days: Math.max(0, targetDays - (daysOfCover || 0)),
      estimated_revenue_protected: roundMoney(velocity * (targetDays - (daysOfCover || 0)) * features.price_inc_vat),
    },
    confidence: features.stockout_risk === 'HIGH' ? 'HIGH' : 'MEDIUM',
    confidence_score: features.stockout_risk === 'HIGH' ? 0.90 : 0.70,
  };
}

/**
 * Generate MARGIN_AT_RISK_COMPONENT_COST recommendation
 */
async function generateMarginAtRiskRec(listingId, features, guardrails) {
  return {
    recommendation_type: 'MARGIN_AT_RISK_COMPONENT_COST',
    entity_type: 'LISTING',
    entity_id: listingId,
    action_payload_json: {
      action: 'REVIEW_COSTS',
      current_margin: features.margin,
      min_margin: guardrails.minMargin,
      break_even_price_inc_vat: features.break_even_price_inc_vat,
    },
    evidence_json: {
      current_margin: features.margin,
      min_margin_threshold: guardrails.minMargin,
      bom_cost_ex_vat: features.bom_cost_ex_vat,
      total_cost_ex_vat: features.bom_cost_ex_vat + features.shipping_cost_ex_vat +
                         features.packaging_cost_ex_vat + features.amazon_fees_ex_vat,
      notes: 'Current margin is below minimum threshold. Review BOM costs or consider price increase.',
    },
    guardrails_json: {
      violation: 'min_margin',
      actual: features.margin,
      threshold: guardrails.minMargin,
    },
    impact_json: {
      margin_gap: roundMoney(guardrails.minMargin - features.margin),
      price_increase_needed: roundMoney(features.break_even_price_inc_vat * (1 + guardrails.minMargin) - features.price_inc_vat),
    },
    confidence: 'HIGH',
    confidence_score: 0.95,
  };
}

/**
 * Generate ANOMALY_SALES_DROP recommendation
 */
async function generateSalesAnomalyRec(listingId, features) {
  return {
    recommendation_type: 'ANOMALY_SALES_DROP',
    entity_type: 'LISTING',
    entity_id: listingId,
    action_payload_json: {
      action: 'INVESTIGATE',
      anomaly_type: 'SALES_DROP',
    },
    evidence_json: {
      sales_anomaly_score: features.sales_anomaly_score,
      units_7d: features.units_7d,
      units_30d: features.units_30d,
      sales_velocity_30d: features.sales_velocity_units_per_day_30d,
      buy_box_status: features.buy_box_status,
      notes: 'Significant drop in sales velocity detected. Investigate potential causes.',
    },
    guardrails_json: null,
    impact_json: {
      urgency: 'HIGH',
      potential_causes: ['Buy Box loss', 'Stock out', 'Price increase', 'Competitor action', 'Seasonal decline'],
    },
    confidence: 'MEDIUM',
    confidence_score: 0.70,
  };
}

/**
 * Generate OPPORTUNITY_CREATE_LISTING recommendation for ASIN
 */
async function generateOpportunityRec(asinEntityId, features) {
  return {
    recommendation_type: 'OPPORTUNITY_CREATE_LISTING',
    entity_type: 'ASIN',
    entity_id: asinEntityId,
    action_payload_json: {
      action: 'CREATE_LISTING',
      asin: features.asin,
      estimated_margin: features.opportunity_margin,
      estimated_profit: features.opportunity_profit,
    },
    evidence_json: {
      asin: features.asin,
      title: features.title,
      brand: features.brand,
      category: features.category,
      price_current: features.price_current,
      scenario_bom_cost_ex_vat: features.scenario_bom_cost_ex_vat,
      sales_rank_current: features.sales_rank_current,
      offers_count_current: features.offers_count_current,
      notes: 'ASIN shows profitable opportunity based on scenario BOM analysis.',
    },
    guardrails_json: null,
    impact_json: {
      estimated_margin: features.opportunity_margin,
      estimated_profit_per_unit: features.opportunity_profit,
    },
    confidence: features.opportunity_margin > 0.30 ? 'HIGH' : 'MEDIUM',
    confidence_score: features.opportunity_margin > 0.30 ? 0.80 : 0.60,
  };
}

/**
 * Determine confidence level for price recommendations
 */
function determinePriceConfidence(features) {
  // High confidence if we have recent Keepa data and clear Buy Box status
  if (features.keepa_volatility_90d !== null && features.keepa_volatility_90d < 0.1) {
    return 'HIGH';
  }
  if (features.keepa_volatility_90d !== null && features.keepa_volatility_90d < 0.2) {
    return 'MEDIUM';
  }
  return 'LOW';
}

/**
 * Save a recommendation to the database
 */
async function saveRecommendation(rec, jobId = null) {
  const result = await query(`
    INSERT INTO recommendations (
      recommendation_type, entity_type, entity_id, status,
      action_payload_json, evidence_json, guardrails_json, impact_json,
      confidence, confidence_score, generation_job_id, expires_at
    ) VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP + INTERVAL '7 days')
    RETURNING *
  `, [
    rec.recommendation_type,
    rec.entity_type,
    rec.entity_id,
    JSON.stringify(rec.action_payload_json),
    JSON.stringify(rec.evidence_json),
    rec.guardrails_json ? JSON.stringify(rec.guardrails_json) : null,
    JSON.stringify(rec.impact_json),
    rec.confidence,
    rec.confidence_score,
    jobId,
  ]);

  const saved = result.rows[0];

  // Create GENERATED event
  await query(`
    INSERT INTO recommendation_events (recommendation_id, event_type, job_id, created_by)
    VALUES ($1, 'GENERATED', $2, 'system')
  `, [saved.id, jobId]);

  return saved;
}

/**
 * Expire old pending recommendations for an entity
 */
async function expireOldRecommendations(entityType, entityId) {
  await query(`
    UPDATE recommendations
    SET status = 'SUPERSEDED', updated_at = CURRENT_TIMESTAMP
    WHERE entity_type = $1 AND entity_id = $2 AND status = 'PENDING'
  `, [entityType, entityId]);
}

/**
 * Accept a recommendation
 * @param {number} recommendationId
 * @param {string} [reason]
 * @returns {Promise<Object>}
 */
export async function acceptRecommendation(recommendationId, reason = null) {
  const rec = await getRecommendation(recommendationId);
  if (!rec) {
    throw new Error(`Recommendation not found: ${recommendationId}`);
  }

  if (rec.status !== 'PENDING') {
    throw new Error(`Cannot accept recommendation in status: ${rec.status}`);
  }

  // Update status
  const result = await query(`
    UPDATE recommendations
    SET status = 'ACCEPTED', accepted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
  `, [recommendationId]);

  // Create event
  await query(`
    INSERT INTO recommendation_events (recommendation_id, event_type, reason, created_by)
    VALUES ($1, 'ACCEPTED', $2, 'user')
  `, [recommendationId, reason]);

  return result.rows[0];
}

/**
 * Reject a recommendation
 */
export async function rejectRecommendation(recommendationId, reason = null) {
  const rec = await getRecommendation(recommendationId);
  if (!rec) {
    throw new Error(`Recommendation not found: ${recommendationId}`);
  }

  if (rec.status !== 'PENDING') {
    throw new Error(`Cannot reject recommendation in status: ${rec.status}`);
  }

  const result = await query(`
    UPDATE recommendations
    SET status = 'REJECTED', rejected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
  `, [recommendationId]);

  await query(`
    INSERT INTO recommendation_events (recommendation_id, event_type, reason, created_by)
    VALUES ($1, 'REJECTED', $2, 'user')
  `, [recommendationId, reason]);

  return result.rows[0];
}

/**
 * Snooze a recommendation
 */
export async function snoozeRecommendation(recommendationId, days = 7, reason = null) {
  const rec = await getRecommendation(recommendationId);
  if (!rec) {
    throw new Error(`Recommendation not found: ${recommendationId}`);
  }

  if (rec.status !== 'PENDING') {
    throw new Error(`Cannot snooze recommendation in status: ${rec.status}`);
  }

  const result = await query(`
    UPDATE recommendations
    SET status = 'SNOOZED', snoozed_until = CURRENT_TIMESTAMP + $2 * INTERVAL '1 day', updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
  `, [recommendationId, days]);

  await query(`
    INSERT INTO recommendation_events (recommendation_id, event_type, details_json, reason, created_by)
    VALUES ($1, 'SNOOZED', $2, $3, 'user')
  `, [recommendationId, JSON.stringify({ snooze_days: days }), reason]);

  return result.rows[0];
}

/**
 * Get a recommendation by ID
 */
export async function getRecommendation(recommendationId) {
  const result = await query(`
    SELECT r.*,
           CASE WHEN r.entity_type = 'LISTING' THEN l.seller_sku ELSE NULL END as listing_sku,
           CASE WHEN r.entity_type = 'ASIN' THEN ae.asin ELSE NULL END as asin
    FROM recommendations r
    LEFT JOIN listings l ON r.entity_type = 'LISTING' AND l.id = r.entity_id
    LEFT JOIN asin_entities ae ON r.entity_type = 'ASIN' AND ae.id = r.entity_id
    WHERE r.id = $1
  `, [recommendationId]);

  return result.rows[0] || null;
}

/**
 * Get recommendations for an entity
 */
export async function getRecommendationsForEntity(entityType, entityId, options = {}) {
  const { status, limit = 20 } = options;
  const params = [entityType, entityId];
  let whereClause = 'WHERE r.entity_type = $1 AND r.entity_id = $2';
  let paramIndex = 3;

  if (status) {
    whereClause += ` AND r.status = $${paramIndex}`;
    params.push(status);
    paramIndex++;
  }

  params.push(limit);

  const result = await query(`
    SELECT r.*
    FROM recommendations r
    ${whereClause}
    ORDER BY r.generated_at DESC
    LIMIT $${paramIndex}
  `, params);

  return result.rows;
}

/**
 * Get all pending recommendations
 */
export async function getPendingRecommendations(options = {}) {
  const { entityType, type, limit = 50 } = options;
  const params = [];
  const conditions = ["r.status = 'PENDING'"];
  let paramIndex = 1;

  if (entityType) {
    conditions.push(`r.entity_type = $${paramIndex}`);
    params.push(entityType);
    paramIndex++;
  }

  if (type) {
    conditions.push(`r.recommendation_type = $${paramIndex}`);
    params.push(type);
    paramIndex++;
  }

  params.push(limit);

  const result = await query(`
    SELECT r.*,
           CASE WHEN r.entity_type = 'LISTING' THEN l.seller_sku ELSE NULL END as listing_sku,
           CASE WHEN r.entity_type = 'LISTING' THEN l.title ELSE NULL END as listing_title,
           CASE WHEN r.entity_type = 'ASIN' THEN ae.asin ELSE NULL END as asin,
           CASE WHEN r.entity_type = 'ASIN' THEN ae.title ELSE NULL END as asin_title
    FROM recommendations r
    LEFT JOIN listings l ON r.entity_type = 'LISTING' AND l.id = r.entity_id
    LEFT JOIN asin_entities ae ON r.entity_type = 'ASIN' AND ae.id = r.entity_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY r.confidence DESC, r.generated_at DESC
    LIMIT $${paramIndex}
  `, params);

  return result.rows;
}

/**
 * Round money to 2 decimal places
 */
function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

export default {
  generateListingRecommendations,
  generateAsinRecommendations,
  acceptRecommendation,
  rejectRecommendation,
  snoozeRecommendation,
  getRecommendation,
  getRecommendationsForEntity,
  getPendingRecommendations,
};
