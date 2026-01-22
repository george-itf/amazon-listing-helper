/**
 * Guardrails Service
 *
 * Server-side enforcement of business rules for price and stock changes.
 * Per DATA_CONTRACTS.md §11 - Guardrails Enforcement Contract.
 *
 * CRITICAL: Backend RE-COMPUTES guardrails on publish (never trusts UI).
 *
 * @module GuardrailsService
 */

import { query } from '../database/connection.js';

// P.5 FIX: Cache guardrails to avoid DB hit on every request
// TTL configurable via env, default 60 seconds
const GUARDRAILS_CACHE_TTL_MS = parseInt(process.env.GUARDRAILS_CACHE_TTL_MS || '60000', 10);
let guardrailsCache = null;
let guardrailsCacheExpiry = 0;

/**
 * Safe parseFloat - returns default on NaN
 */
function safeParseFloat(value, defaultValue = 0) {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Safe parseInt - returns default on NaN
 */
function safeParseInt(value, defaultValue = 0) {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * @typedef {Object} GuardrailViolation
 * @property {string} rule - e.g., "min_margin"
 * @property {number} threshold - e.g., 0.15
 * @property {number} actual - e.g., 0.12
 * @property {string} message - Human-readable explanation
 */

/**
 * @typedef {Object} GuardrailsResult
 * @property {boolean} passed
 * @property {GuardrailViolation[]} violations
 */

/**
 * Load guardrail settings from database
 *
 * P.5 FIX: Uses a simple in-memory cache to avoid DB hit on every request
 *
 * @param {boolean} [forceRefresh=false] - Force cache refresh
 * @returns {Promise<Object>} Guardrails configuration
 */
export async function loadGuardrails(forceRefresh = false) {
  // P.5 FIX: Return cached value if valid and not forcing refresh
  const now = Date.now();
  if (!forceRefresh && guardrailsCache && now < guardrailsCacheExpiry) {
    return guardrailsCache;
  }

  const guardrails = {
    minMargin: 0.15,
    maxPriceChangePctPerDay: 0.05,
    minDaysOfCoverBeforePriceChange: 7,
    minStockThreshold: 5,
    allowPriceBelowBreakEven: false,
  };

  let result;
  try {
    result = await query(`
      SELECT key, value FROM settings
      WHERE key LIKE 'guardrails.%'
    `);
  } catch (error) {
    // Handle missing settings table - use defaults
    if (error.message?.includes('does not exist')) {
      // Cache the defaults too
      guardrailsCache = guardrails;
      guardrailsCacheExpiry = now + GUARDRAILS_CACHE_TTL_MS;
      return guardrails;
    }
    throw error;
  }

  for (const row of result.rows) {
    const key = row.key.replace('guardrails.', '');
    let value;

    try {
      value = JSON.parse(row.value);
    } catch {
      value = row.value;
    }

    switch (key) {
      case 'min_margin':
        guardrails.minMargin = safeParseFloat(value, 0.15);
        break;
      case 'max_price_change_pct_per_day':
        guardrails.maxPriceChangePctPerDay = safeParseFloat(value, 0.05);
        break;
      case 'min_days_of_cover_before_price_change':
        guardrails.minDaysOfCoverBeforePriceChange = safeParseInt(value, 7);
        break;
      case 'min_stock_threshold':
        guardrails.minStockThreshold = safeParseInt(value, 5);
        break;
      case 'allow_price_below_break_even':
        guardrails.allowPriceBelowBreakEven = value === 'true' || value === true;
        break;
    }
  }

  // P.5 FIX: Update cache
  guardrailsCache = guardrails;
  guardrailsCacheExpiry = now + GUARDRAILS_CACHE_TTL_MS;

  return guardrails;
}

/**
 * Invalidate the guardrails cache
 * Call this when settings are updated
 */
export function invalidateGuardrailsCache() {
  guardrailsCache = null;
  guardrailsCacheExpiry = 0;
}

/**
 * Validate price change against guardrails
 *
 * @param {Object} params
 * @param {number} params.listingId
 * @param {number} params.newPriceIncVat - Proposed new price
 * @param {number} params.currentPriceIncVat - Current price
 * @param {number} params.breakEvenPriceIncVat - Break-even price
 * @param {number} params.newMargin - Margin at new price
 * @param {number} params.daysOfCover - Days of stock cover
 * @param {boolean} params.isPriceDecrease - Is this a price decrease?
 * @returns {Promise<GuardrailsResult>}
 */
export async function validatePriceChange({
  listingId,
  newPriceIncVat,
  currentPriceIncVat,
  breakEvenPriceIncVat,
  newMargin,
  daysOfCover,
  isPriceDecrease,
}) {
  const guardrails = await loadGuardrails();
  const violations = [];

  // 1. Minimum margin check
  if (newMargin < guardrails.minMargin) {
    violations.push({
      rule: 'min_margin',
      threshold: guardrails.minMargin,
      actual: newMargin,
      message: `Margin ${(newMargin * 100).toFixed(1)}% is below minimum ${(guardrails.minMargin * 100).toFixed(1)}%`,
    });
  }

  // 2. Break-even check (unless explicitly allowed)
  if (!guardrails.allowPriceBelowBreakEven && newPriceIncVat < breakEvenPriceIncVat) {
    violations.push({
      rule: 'price_below_break_even',
      threshold: breakEvenPriceIncVat,
      actual: newPriceIncVat,
      message: `Price £${newPriceIncVat.toFixed(2)} is below break-even £${breakEvenPriceIncVat.toFixed(2)}`,
    });
  }

  // 3. Maximum price change per day
  if (currentPriceIncVat > 0) {
    const priceChangePct = Math.abs(newPriceIncVat - currentPriceIncVat) / currentPriceIncVat;
    if (priceChangePct > guardrails.maxPriceChangePctPerDay) {
      violations.push({
        rule: 'max_price_change_pct_per_day',
        threshold: guardrails.maxPriceChangePctPerDay,
        actual: priceChangePct,
        message: `Price change ${(priceChangePct * 100).toFixed(1)}% exceeds maximum ${(guardrails.maxPriceChangePctPerDay * 100).toFixed(1)}% per day`,
      });
    }
  }

  // 4. Minimum days of cover before price cut (only for decreases)
  if (isPriceDecrease && daysOfCover !== null && daysOfCover < guardrails.minDaysOfCoverBeforePriceChange) {
    violations.push({
      rule: 'min_days_of_cover_before_price_change',
      threshold: guardrails.minDaysOfCoverBeforePriceChange,
      actual: daysOfCover,
      message: `Only ${daysOfCover.toFixed(1)} days of stock cover; minimum ${guardrails.minDaysOfCoverBeforePriceChange} days required before price decrease`,
    });
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

/**
 * Validate stock change against guardrails
 *
 * P.3 FIX: Add severity to violations and check for critical failures
 *
 * @param {Object} params
 * @param {number} params.listingId
 * @param {number} params.newQuantity - Proposed new quantity
 * @param {number} params.currentQuantity - Current quantity
 * @param {number} params.salesVelocity - Units per day
 * @returns {Promise<GuardrailsResult>}
 */
export async function validateStockChange({
  listingId,
  newQuantity,
  currentQuantity,
  salesVelocity,
}) {
  const guardrails = await loadGuardrails();
  const violations = [];

  // P.3 FIX: Check for invalid (negative) quantity - this is a critical failure
  if (newQuantity < 0) {
    violations.push({
      rule: 'invalid_quantity',
      threshold: 0,
      actual: newQuantity,
      message: 'Stock quantity cannot be negative',
      severity: 'critical',
    });
  }

  // 1. Minimum stock threshold warning (not a hard block, but a violation)
  if (newQuantity < guardrails.minStockThreshold && newQuantity > 0) {
    violations.push({
      rule: 'min_stock_threshold',
      threshold: guardrails.minStockThreshold,
      actual: newQuantity,
      message: `Stock ${newQuantity} is below minimum threshold ${guardrails.minStockThreshold}`,
      severity: 'warning',
    });
  }

  // 2. Zero stock warning
  if (newQuantity === 0) {
    violations.push({
      rule: 'zero_stock',
      threshold: 1,
      actual: 0,
      message: 'Setting stock to zero will mark listing as out of stock',
      severity: 'warning',
    });
  }

  // P.3 FIX: Check for critical violations - fail if any critical violations exist
  const hasCriticalViolation = violations.some(v => v.severity === 'critical');

  return {
    passed: !hasCriticalViolation,
    violations,
  };
}

/**
 * Calculate days of stock cover
 * @param {number} quantity - Current stock quantity
 * @param {number} salesVelocity - Units per day
 * @returns {number|null} Days of cover, or null if velocity is 0
 */
export function calculateDaysOfCover(quantity, salesVelocity) {
  if (!salesVelocity || salesVelocity <= 0) {
    return null;
  }
  return quantity / salesVelocity;
}

/**
 * Calculate stockout risk level
 * @param {number|null} daysOfCover
 * @param {number} leadTimeDays
 * @returns {'LOW'|'MEDIUM'|'HIGH'}
 */
export function calculateStockoutRisk(daysOfCover, leadTimeDays = 14) {
  if (daysOfCover === null) {
    return 'LOW'; // No velocity, no risk
  }

  if (daysOfCover <= leadTimeDays * 0.5) {
    return 'HIGH';
  }

  if (daysOfCover <= leadTimeDays) {
    return 'MEDIUM';
  }

  return 'LOW';
}

/**
 * Get guardrails summary for a listing
 * @param {number} listingId
 * @returns {Promise<Object>} Summary of guardrails state
 */
export async function getGuardrailsSummary(listingId) {
  const guardrails = await loadGuardrails();

  // Get listing data
  const listingResult = await query(`
    SELECT
      l.id,
      l.price_inc_vat,
      l.available_quantity,
      loc.price_inc_vat as offer_price,
      loc.available_quantity as offer_quantity
    FROM listings l
    LEFT JOIN listing_offer_current loc ON loc.listing_id = l.id
    WHERE l.id = $1
  `, [listingId]);

  if (listingResult.rows.length === 0) {
    throw new Error(`Listing not found: ${listingId}`);
  }

  const listing = listingResult.rows[0];

  // Get 30-day sales for velocity calculation
  let totalUnits30d = 0;
  try {
    const salesResult = await query(`
      SELECT COALESCE(SUM(units), 0) as total_units
      FROM listing_sales_daily
      WHERE listing_id = $1
        AND date >= CURRENT_DATE - INTERVAL '30 days'
    `, [listingId]);
    totalUnits30d = safeParseInt(salesResult.rows[0]?.total_units || 0, 0);
  } catch (error) {
    // Handle missing table gracefully
    if (!error.message?.includes('does not exist')) {
      throw error;
    }
  }
  const salesVelocity = totalUnits30d / 30;
  const daysOfCover = calculateDaysOfCover(listing.available_quantity || 0, salesVelocity);
  const stockoutRisk = calculateStockoutRisk(daysOfCover);

  return {
    listing_id: listingId,
    guardrails,
    current_state: {
      price_inc_vat: safeParseFloat(listing.price_inc_vat, 0),
      available_quantity: listing.available_quantity || 0,
      sales_velocity_30d: Math.round(salesVelocity * 100) / 100,
      days_of_cover: daysOfCover !== null ? Math.round(daysOfCover * 10) / 10 : null,
      stockout_risk: stockoutRisk,
    },
  };
}

export default {
  loadGuardrails,
  invalidateGuardrailsCache,
  validatePriceChange,
  validateStockChange,
  calculateDaysOfCover,
  calculateStockoutRisk,
  getGuardrailsSummary,
};
