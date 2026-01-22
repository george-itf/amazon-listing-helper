/**
 * Economics Service
 *
 * Single source of truth for all profit/margin calculations.
 * Implements DATA_CONTRACTS.md §4 Economics DTO Contract.
 *
 * All money values use NUMERIC(12,2) with HALF_UP rounding.
 * VAT semantics per DATA_CONTRACTS.md §2.
 *
 * @module EconomicsService
 */

import { query } from '../database/connection.js';

/**
 * Safely parse a numeric value, returning 0 for invalid/NaN inputs
 * @param {unknown} value
 * @returns {number}
 */
function safeParseFloat(value) {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Round money to 2 decimal places using HALF_UP
 * @param {number} value
 * @returns {number}
 */
function roundMoney(value) {
  if (isNaN(value) || !isFinite(value)) return 0;  // Guard against NaN and Infinity propagation
  const result = Math.round(value * 100) / 100;
  // Use Object.is() to detect negative zero (strict equality doesn't catch it)
  return Object.is(result, -0) ? 0 : result;
}

/**
 * Round percentage/margin to specified decimal places (default 4 = 0.01% precision)
 * Used for margin, percentages, and ratios - NOT for currency
 * @param {number} value
 * @param {number} decimalPlaces - Default 4 (e.g., 0.3333 = 33.33%)
 * @returns {number}
 */
export function roundPercentage(value, decimalPlaces = 4) {
  if (isNaN(value) || !isFinite(value)) return 0;
  const multiplier = Math.pow(10, decimalPlaces);
  const result = Math.round(value * multiplier) / multiplier;
  return Object.is(result, -0) ? 0 : result;
}

/**
 * Format margin for API response display
 * @param {number} margin - Raw margin value (e.g., 0.3333)
 * @returns {number} - Rounded margin (e.g., 0.3333)
 */
export function formatMarginForDisplay(margin) {
  return roundPercentage(margin, 4);
}

/**
 * Calculate price excluding VAT from price including VAT
 * @param {number} priceIncVat
 * @param {number} vatRate - e.g., 0.20 for 20%
 * @returns {number}
 */
function calculatePriceExVat(priceIncVat, vatRate) {
  return roundMoney(priceIncVat / (1 + vatRate));
}

/**
 * Calculate break-even price (inc VAT) where profit = 0
 * @param {number} totalCostExVat
 * @param {number} vatRate
 * @returns {number}
 */
function calculateBreakEvenPriceIncVat(totalCostExVat, vatRate) {
  // At break-even: price_ex_vat = total_cost_ex_vat
  // price_inc_vat = price_ex_vat * (1 + vat_rate)
  return roundMoney(totalCostExVat * (1 + vatRate));
}

/**
 * Get BOM cost for a listing
 * @param {number} listingId
 * @returns {Promise<number>} Total BOM cost ex VAT
 */
async function getBomCostExVat(listingId) {
  try {
    const result = await query(`
      SELECT COALESCE(SUM(
        bl.quantity * (1 + bl.wastage_rate) * c.unit_cost_ex_vat
      ), 0) as bom_cost
      FROM boms b
      JOIN bom_lines bl ON bl.bom_id = b.id
      JOIN components c ON c.id = bl.component_id
      WHERE b.listing_id = $1
        AND b.is_active = true
        AND b.scope_type = 'LISTING'
    `, [listingId]);

    return roundMoney(safeParseFloat(result.rows[0]?.bom_cost));
  } catch (error) {
    // Handle missing tables gracefully
    if (error.message?.includes('does not exist')) {
      return 0;
    }
    throw error;
  }
}

/**
 * Get cost overrides for a listing
 * @param {number} listingId
 * @returns {Promise<Object>}
 */
async function getCostOverrides(listingId) {
  const defaultCosts = {
    shipping_cost_ex_vat: 0,
    packaging_cost_ex_vat: 0,
    handling_cost_ex_vat: 0,
    other_cost_ex_vat: 0,
  };

  try {
    const result = await query(`
      SELECT
        COALESCE(shipping_cost_ex_vat, 0) as shipping_cost_ex_vat,
        COALESCE(packaging_cost_ex_vat, 0) as packaging_cost_ex_vat,
        COALESCE(handling_cost_ex_vat, 0) as handling_cost_ex_vat,
        COALESCE(other_cost_ex_vat, 0) as other_cost_ex_vat
      FROM listing_cost_overrides
      WHERE listing_id = $1
    `, [listingId]);

    if (result.rows.length === 0) {
      return defaultCosts;
    }

    return {
      shipping_cost_ex_vat: roundMoney(parseFloat(result.rows[0].shipping_cost_ex_vat)),
      packaging_cost_ex_vat: roundMoney(parseFloat(result.rows[0].packaging_cost_ex_vat)),
      handling_cost_ex_vat: roundMoney(parseFloat(result.rows[0].handling_cost_ex_vat)),
      other_cost_ex_vat: roundMoney(parseFloat(result.rows[0].other_cost_ex_vat)),
    };
  } catch (error) {
    // Handle missing table gracefully
    if (error.message?.includes('does not exist')) {
      return defaultCosts;
    }
    throw error;
  }
}

/**
 * Calculate Amazon fees for a listing
 * Uses standard FBA/FBM fee structure.
 *
 * A.2.1 FIX: Amazon referral fees are calculated on VAT-EXCLUSIVE price
 * per DATA_CONTRACTS.md §4 and SPEC.md VAT semantics.
 *
 * TODO: Integrate with Amazon Fee Preview API for accuracy
 *
 * @param {number} priceIncVat - Price including VAT
 * @param {string} fulfillmentChannel - 'FBA' or 'FBM'
 * @param {string} category
 * @param {number} vatRate - VAT rate (e.g., 0.20 for 20%)
 * @returns {number} Fees ex VAT
 */
function calculateAmazonFeesExVat(priceIncVat, fulfillmentChannel = 'FBM', category = 'General', vatRate = 0.20) {
  // A.2.1 FIX: Calculate price ex VAT first - Amazon fees are on VAT-exclusive price
  const priceExVat = roundMoney(priceIncVat / (1 + vatRate));

  // Referral fee: typically 15% of sale price (ex VAT)
  const referralRate = 0.15;
  const referralFee = roundMoney(priceExVat * referralRate);

  // FBA fulfillment fee (if applicable)
  let fulfillmentFee = 0;
  if (fulfillmentChannel === 'FBA') {
    // Simplified FBA fee - in reality depends on size/weight
    fulfillmentFee = 2.50; // Base small item fee
  }

  // Per-item fee for media categories (books, music, etc.)
  let perItemFee = 0;
  const mediaCategories = ['Books', 'Music', 'Video', 'DVD', 'Software'];
  if (mediaCategories.includes(category)) {
    perItemFee = 0.50;
  }

  return roundMoney(referralFee + fulfillmentFee + perItemFee);
}

/**
 * Get VAT rate for a marketplace
 * @param {number} marketplaceId
 * @returns {Promise<number>}
 */
async function getVatRate(marketplaceId) {
  if (!marketplaceId) {
    return 0.20; // Default UK VAT
  }

  const result = await query(`
    SELECT vat_rate FROM marketplaces WHERE id = $1
  `, [marketplaceId]);

  return parseFloat(result.rows[0]?.vat_rate || 0.20);
}

/**
 * Get active BOM version for a listing
 * @param {number} listingId
 * @returns {Promise<number|null>}
 */
async function getActiveBomVersion(listingId) {
  const result = await query(`
    SELECT version FROM boms
    WHERE listing_id = $1 AND is_active = true AND scope_type = 'LISTING'
  `, [listingId]);

  return result.rows[0]?.version || null;
}

/**
 * Calculate full economics for a listing
 * Implements DATA_CONTRACTS.md §4.2 Economics DTO Contract
 *
 * A.4.2 FIX: Optimized to use fewer DB queries via a combined query with JOINs
 *
 * @param {number} listingId
 * @param {Object} [scenario] - Optional scenario overrides
 * @param {number} [scenario.price_inc_vat] - Override current price
 * @param {number} [scenario.bom_cost_multiplier] - e.g., 1.10 for +10%
 * @returns {Promise<Object>} Economics DTO per DATA_CONTRACTS.md §4.2
 */
export async function calculateEconomics(listingId, scenario = {}) {
  // A.4.2 FIX: Combined query to reduce DB round trips from 4 to 1
  const combinedResult = await query(`
    SELECT
      l.id,
      l.price_inc_vat,
      l.marketplace_id,
      l."fulfillmentChannel" as fulfillment_channel,
      l.category,
      COALESCE(m.vat_rate, 0.20) as vat_rate,
      COALESCE((
        SELECT SUM(bl.quantity * (1 + bl.wastage_rate) * c.unit_cost_ex_vat)
        FROM boms b
        JOIN bom_lines bl ON bl.bom_id = b.id
        JOIN components c ON c.id = bl.component_id
        WHERE b.listing_id = l.id
          AND b.is_active = true
          AND b.scope_type = 'LISTING'
      ), 0) as bom_cost,
      COALESCE(lco.shipping_cost_ex_vat, 0) as shipping_cost_ex_vat,
      COALESCE(lco.packaging_cost_ex_vat, 0) as packaging_cost_ex_vat,
      COALESCE(lco.handling_cost_ex_vat, 0) as handling_cost_ex_vat,
      COALESCE(lco.other_cost_ex_vat, 0) as other_cost_ex_vat,
      (
        SELECT version FROM boms
        WHERE listing_id = l.id AND is_active = true AND scope_type = 'LISTING'
        LIMIT 1
      ) as bom_version
    FROM listings l
    LEFT JOIN marketplaces m ON m.id = l.marketplace_id
    LEFT JOIN listing_cost_overrides lco ON lco.listing_id = l.id
    WHERE l.id = $1
  `, [listingId]);

  if (combinedResult.rows.length === 0) {
    throw new Error(`Listing not found: ${listingId}`);
  }

  const data = combinedResult.rows[0];
  const vatRate = parseFloat(data.vat_rate || 0.20);

  // Apply scenario overrides
  const priceIncVat = scenario.price_inc_vat ?? parseFloat(data.price_inc_vat || 0);

  // Get BOM cost (with optional multiplier)
  let bomCostExVat = roundMoney(safeParseFloat(data.bom_cost));
  if (scenario.bom_cost_multiplier) {
    bomCostExVat = roundMoney(bomCostExVat * scenario.bom_cost_multiplier);
  }

  // A.2.1 FIX: Pass vatRate to calculateAmazonFeesExVat
  const amazonFeesExVat = calculateAmazonFeesExVat(
    priceIncVat,
    data.fulfillment_channel,
    data.category,
    vatRate  // A.2.1: Now correctly calculates on VAT-exclusive price
  );

  // Calculate derived values per DATA_CONTRACTS.md §4.2
  const priceExVat = calculatePriceExVat(priceIncVat, vatRate);
  const shippingCostExVat = roundMoney(parseFloat(data.shipping_cost_ex_vat));
  const packagingCostExVat = roundMoney(parseFloat(data.packaging_cost_ex_vat));
  const handlingCostExVat = roundMoney(parseFloat(data.handling_cost_ex_vat));
  const otherCostExVat = roundMoney(parseFloat(data.other_cost_ex_vat));

  const totalCostExVat = roundMoney(
    bomCostExVat +
    shippingCostExVat +
    packagingCostExVat +
    handlingCostExVat +
    otherCostExVat +
    amazonFeesExVat
  );

  const netRevenueExVat = priceExVat;
  const profitExVat = roundMoney(netRevenueExVat - totalCostExVat);
  // Store raw margin value (full precision) - only round for display
  const margin = netRevenueExVat > 0 ? profitExVat / netRevenueExVat : 0;
  const breakEvenPriceIncVat = calculateBreakEvenPriceIncVat(totalCostExVat, vatRate);

  return {
    listing_id: listingId,
    marketplace_id: data.marketplace_id,
    vat_rate: vatRate,

    // Price fields (SPEC §2)
    price_inc_vat: roundMoney(priceIncVat),
    price_ex_vat: priceExVat,

    // Cost fields (all VAT-exclusive)
    bom_cost_ex_vat: bomCostExVat,
    shipping_cost_ex_vat: shippingCostExVat,
    packaging_cost_ex_vat: packagingCostExVat,
    amazon_fees_ex_vat: amazonFeesExVat,
    total_cost_ex_vat: totalCostExVat,

    // Derived fields (SPEC §2.2)
    net_revenue_ex_vat: netRevenueExVat,
    profit_ex_vat: profitExVat,
    margin: margin,
    break_even_price_inc_vat: breakEvenPriceIncVat,

    // Metadata
    computed_at: new Date().toISOString(),
    bom_version: data.bom_version || null,
    fee_snapshot_id: null, // TODO: Implement fee snapshots
  };
}

/**
 * Calculate economics for a price change preview
 * @param {number} listingId
 * @param {number} newPriceIncVat
 * @returns {Promise<Object>} Economics comparison
 */
export async function previewPriceChange(listingId, newPriceIncVat) {
  const current = await calculateEconomics(listingId);
  const proposed = await calculateEconomics(listingId, { price_inc_vat: newPriceIncVat });

  return {
    current,
    proposed,
    diff: {
      price_inc_vat: roundMoney(proposed.price_inc_vat - current.price_inc_vat),
      profit_ex_vat: roundMoney(proposed.profit_ex_vat - current.profit_ex_vat),
      margin: roundPercentage(proposed.margin - current.margin),
    },
  };
}

/**
 * Run async functions in parallel with a concurrency limit
 * @param {Array} items - Items to process
 * @param {number} concurrency - Max concurrent operations
 * @param {Function} fn - Async function to call for each item
 * @returns {Promise<Array>} Results in same order as input
 */
async function parallelLimit(items, concurrency, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      try {
        results[currentIndex] = await fn(items[currentIndex]);
      } catch (error) {
        results[currentIndex] = { error: error.message };
      }
    }
  }

  // Start workers up to concurrency limit
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

/**
 * Batch calculate economics for multiple listings
 *
 * A.4.1 FIX: Now runs in parallel with concurrency limit (was sequential)
 * This dramatically improves performance for large batches.
 *
 * @param {number[]} listingIds
 * @param {number} [concurrency=10] - Max concurrent calculations
 * @returns {Promise<Object[]>}
 */
export async function calculateBatchEconomics(listingIds, concurrency = 10) {
  // A.4.1 FIX: Parallel execution with concurrency limit
  const results = await parallelLimit(listingIds, concurrency, async (listingId) => {
    const economics = await calculateEconomics(listingId);
    return economics;
  });

  // Add listing_id to error results for consistency
  return results.map((result, idx) => {
    if (result.error) {
      return { listing_id: listingIds[idx], error: result.error };
    }
    return result;
  });
}

// Named exports for testing
export {
  roundMoney,
  calculatePriceExVat,
  calculateBreakEvenPriceIncVat,
  calculateAmazonFeesExVat,
};

export default {
  calculateEconomics,
  previewPriceChange,
  calculateBatchEconomics,
  roundMoney,
  calculatePriceExVat,
  calculateBreakEvenPriceIncVat,
  calculateAmazonFeesExVat,
};
