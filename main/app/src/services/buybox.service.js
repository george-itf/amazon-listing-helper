/**
 * Buy Box Service
 *
 * Manages Buy Box status tracking per DATA_CONTRACTS.md §11.
 * Provides stubs for Buy Box status retrieval and recording.
 *
 * Buy Box Status ENUM (canonical values):
 * - WON: Seller owns the Buy Box (>=50% win rate or confirmed winner)
 * - LOST: Seller lost the Buy Box to competitor (0% win rate)
 * - PARTIAL: Seller has some Buy Box share but not majority (1-49%)
 * - UNKNOWN: Status not yet determined (no data)
 *
 * @module BuyBoxService
 */

import { query } from '../database/connection.js';
import { getSellerId } from '../credentials-provider.js';

/**
 * Safe parseFloat - returns defaultValue on NaN
 */
function safeParseFloat(value, defaultValue = null) {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Buy Box status values (canonical enum - matches feature_store derivation)
 * @readonly
 * @enum {string}
 */
export const BUY_BOX_STATUS = {
  WON: 'WON',
  LOST: 'LOST',
  PARTIAL: 'PARTIAL',
  UNKNOWN: 'UNKNOWN',
};

/**
 * Get Buy Box status for a listing
 * @param {number} listingId
 * @returns {Promise<Object>} Buy Box status data
 */
export async function getBuyBoxStatusByListing(listingId) {
  const defaultResult = {
    listing_id: listingId,
    status: BUY_BOX_STATUS.UNKNOWN,
    price_inc_vat: null,
    buy_box_price_inc_vat: null,
    buy_box_percentage_30d: null,
    is_buy_box_winner: null,
    observed_at: null,
    source: 'none',
  };

  // Try to get from listing_offer_current table (schema per 002_slice_b_schema.sql)
  let result;
  try {
    result = await query(`
      SELECT
        buy_box_status,
        price_inc_vat,
        buy_box_price,
        buy_box_percentage_30d,
        is_buy_box_winner,
        observed_at
      FROM listing_offer_current
      WHERE listing_id = $1
    `, [listingId]);
  } catch (error) {
    // Handle missing table gracefully
    if (error.message?.includes('does not exist')) {
      return defaultResult;
    }
    throw error;
  }

  if (result.rows.length === 0) {
    return defaultResult;
  }

  const row = result.rows[0];

  // Derive status from percentage if status is UNKNOWN but we have data
  let status = row.buy_box_status || BUY_BOX_STATUS.UNKNOWN;
  if (status === 'UNKNOWN' && row.buy_box_percentage_30d !== null) {
    const pct = safeParseFloat(row.buy_box_percentage_30d, null);
    if (pct !== null) {
      if (pct >= 50) status = BUY_BOX_STATUS.WON;
      else if (pct === 0) status = BUY_BOX_STATUS.LOST;
      else status = BUY_BOX_STATUS.PARTIAL;
    }
  }

  return {
    listing_id: listingId,
    status,
    price_inc_vat: safeParseFloat(row.price_inc_vat, null),
    buy_box_price_inc_vat: safeParseFloat(row.buy_box_price, null),
    buy_box_percentage_30d: safeParseFloat(row.buy_box_percentage_30d, null),
    is_buy_box_winner: row.is_buy_box_winner,
    observed_at: row.observed_at,
    source: 'listing_offer_current',
  };
}

/**
 * Get Buy Box status for an ASIN entity
 * @param {number} asinEntityId
 * @returns {Promise<Object>} Buy Box status data
 */
export async function getBuyBoxStatusByAsin(asinEntityId) {
  const defaultResult = {
    asin_entity_id: asinEntityId,
    status: BUY_BOX_STATUS.UNKNOWN,
    owner: null,
    price_inc_vat: null,
    is_amazon: null,
    captured_at: null,
    source: 'none',
  };

  // Get ASIN entity info and latest Keepa snapshot
  // Buy box data is stored in parsed_json JSONB column
  let result;
  try {
    result = await query(`
      SELECT
        ae.id as asin_entity_id,
        ae.asin,
        ae.listing_id,
        ks.parsed_json,
        ks.captured_at
      FROM asin_entities ae
      LEFT JOIN LATERAL (
        SELECT parsed_json, captured_at
        FROM keepa_snapshots
        WHERE asin_entity_id = ae.id
        ORDER BY captured_at DESC
        LIMIT 1
      ) ks ON true
      WHERE ae.id = $1
    `, [asinEntityId]);
  } catch (error) {
    // Handle missing tables gracefully
    if (error.message?.includes('does not exist')) {
      return defaultResult;
    }
    throw error;
  }

  if (result.rows.length === 0) {
    return defaultResult;
  }

  const row = result.rows[0];
  const keepaMetrics = row.parsed_json?.metrics || {};

  // Extract buy box data from Keepa parsed_json
  const buyBoxPrice = keepaMetrics.buy_box_price ?? null;
  const buyBoxSeller = keepaMetrics.buy_box_seller ?? null;
  const buyBoxIsAmazon = keepaMetrics.buy_box_is_amazon ?? false;

  // Get our seller ID for comparison
  const ourSellerId = getSellerId();

  // Determine status using the determineBuyBoxStatus function
  // For ASIN-level, we typically don't have percentage data from Keepa
  const status = determineBuyBoxStatus({
    buyBoxPrice,
    buyBoxSeller,
    ourSellerId,
    buyBoxPercentage: null, // Keepa doesn't provide percentage data
  });

  return {
    asin_entity_id: asinEntityId,
    asin: row.asin,
    status,
    buy_box_seller: buyBoxSeller,
    buy_box_price_inc_vat: buyBoxPrice,
    is_amazon: buyBoxIsAmazon,
    captured_at: row.captured_at,
    source: row.parsed_json ? 'keepa_snapshots' : 'none',
  };
}

/**
 * Determine Buy Box status based on data
 * Uses canonical WON/LOST/PARTIAL/UNKNOWN values
 *
 * @param {Object} params
 * @param {number|null} params.buyBoxPrice - Current Buy Box winner price
 * @param {string|null} params.buyBoxSeller - Current Buy Box winner seller ID
 * @param {string|null} params.ourSellerId - Our seller ID
 * @param {number|null} params.buyBoxPercentage - Our Buy Box win percentage (0-100)
 * @returns {string} Buy Box status
 */
export function determineBuyBoxStatus({ buyBoxPrice, buyBoxSeller, ourSellerId, buyBoxPercentage }) {
  // If we have percentage data, use that for most accurate status
  if (buyBoxPercentage !== null && buyBoxPercentage !== undefined) {
    if (buyBoxPercentage >= 50) return BUY_BOX_STATUS.WON;
    if (buyBoxPercentage === 0) return BUY_BOX_STATUS.LOST;
    if (buyBoxPercentage > 0) return BUY_BOX_STATUS.PARTIAL;
  }

  // Fallback to seller comparison if we have seller data
  if (ourSellerId && buyBoxSeller) {
    return buyBoxSeller === ourSellerId ? BUY_BOX_STATUS.WON : BUY_BOX_STATUS.LOST;
  }

  // No data available
  return BUY_BOX_STATUS.UNKNOWN;
}

/**
 * Record a Buy Box snapshot for a listing
 * Uses schema-aligned column names per 002_slice_b_schema.sql
 *
 * @param {Object} params
 * @param {number} params.listingId
 * @param {string} params.buyBoxStatus - WON, LOST, PARTIAL, or UNKNOWN
 * @param {number|null} params.priceIncVat - Our current price
 * @param {number|null} params.buyBoxPrice - Buy Box winner price
 * @param {number|null} params.buyBoxPercentage30d - Our Buy Box win percentage
 * @param {boolean|null} params.isBuyBoxWinner - Are we the current winner?
 * @returns {Promise<Object>} Created/updated record
 */
export async function recordBuyBoxSnapshot({
  listingId,
  buyBoxStatus,
  priceIncVat,
  buyBoxPrice,
  buyBoxPercentage30d,
  isBuyBoxWinner,
}) {
  // L.2 FIX: DB enum now includes PARTIAL (migration 006), store directly
  const dbStatus = buyBoxStatus;

  const result = await query(`
    INSERT INTO listing_offer_current (
      listing_id,
      buy_box_status,
      price_inc_vat,
      buy_box_price,
      buy_box_percentage_30d,
      is_buy_box_winner,
      observed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    ON CONFLICT (listing_id) DO UPDATE SET
      buy_box_status = EXCLUDED.buy_box_status,
      price_inc_vat = EXCLUDED.price_inc_vat,
      buy_box_price = EXCLUDED.buy_box_price,
      buy_box_percentage_30d = EXCLUDED.buy_box_percentage_30d,
      is_buy_box_winner = EXCLUDED.is_buy_box_winner,
      observed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `, [listingId, dbStatus, priceIncVat, buyBoxPrice, buyBoxPercentage30d, isBuyBoxWinner]);

  return result.rows[0];
}

/**
 * Get Buy Box history for a listing
 * @param {number} listingId
 * @param {number} [days=30]
 * @returns {Promise<Object[]>} Historical Buy Box data
 */
export async function getBuyBoxHistory(listingId, days = 30) {
  // This would query from a history table if we had one
  // For now, return current status only
  const current = await getBuyBoxStatusByListing(listingId);
  return [current];
}

/**
 * Check if we own the Buy Box for a listing
 * @param {number} listingId
 * @returns {Promise<boolean>}
 */
export async function ownsBuyBox(listingId) {
  const status = await getBuyBoxStatusByListing(listingId);
  return status.status === BUY_BOX_STATUS.WON;
}

/**
 * Get Buy Box competitive metrics
 * @param {number} listingId
 * @returns {Promise<Object>} Competitive metrics
 */
export async function getBuyBoxCompetitiveMetrics(listingId) {
  const status = await getBuyBoxStatusByListing(listingId);

  // Get our current price from listings table
  const listingResult = await query(
    'SELECT price_inc_vat FROM listings WHERE id = $1',
    [listingId]
  );

  const ourPrice = safeParseFloat(listingResult.rows[0]?.price_inc_vat, null);
  const buyBoxPrice = status.buy_box_price_inc_vat;

  let priceDelta = null;
  let priceDeltaPct = null;

  if (ourPrice !== null && buyBoxPrice !== null) {
    priceDelta = ourPrice - buyBoxPrice;
    priceDeltaPct = buyBoxPrice > 0 ? (priceDelta / buyBoxPrice) : 0;
  }

  return {
    listing_id: listingId,
    buy_box_status: status.status,
    buy_box_percentage_30d: status.buy_box_percentage_30d,
    our_price_inc_vat: ourPrice,
    buy_box_price_inc_vat: buyBoxPrice,
    price_delta: priceDelta !== null ? Math.round(priceDelta * 100) / 100 : null,
    price_delta_pct: priceDeltaPct !== null ? Math.round(priceDeltaPct * 10000) / 10000 : null,
    is_competitive: priceDelta !== null ? priceDelta <= 0 : null,
    is_buy_box_winner: status.is_buy_box_winner,
  };
}

export default {
  BUY_BOX_STATUS,
  getBuyBoxStatusByListing,
  getBuyBoxStatusByAsin,
  determineBuyBoxStatus,
  recordBuyBoxSnapshot,
  getBuyBoxHistory,
  ownsBuyBox,
  getBuyBoxCompetitiveMetrics,
};
