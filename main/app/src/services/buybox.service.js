/**
 * Buy Box Service
 *
 * Manages Buy Box status tracking per DATA_CONTRACTS.md §11.
 * Provides stubs for Buy Box status retrieval and recording.
 *
 * Buy Box Status ENUM:
 * - OWNED: Seller owns the Buy Box
 * - LOST: Seller lost the Buy Box to competitor
 * - SUPPRESSED: Buy Box is suppressed (no eligible sellers)
 * - NO_OFFER: No offer from this seller on the listing
 * - UNKNOWN: Status not yet determined
 *
 * @module BuyBoxService
 */

import { query } from '../database/connection.js';

/**
 * Buy Box status values
 * @readonly
 * @enum {string}
 */
export const BUY_BOX_STATUS = {
  OWNED: 'OWNED',
  LOST: 'LOST',
  SUPPRESSED: 'SUPPRESSED',
  NO_OFFER: 'NO_OFFER',
  UNKNOWN: 'UNKNOWN',
};

/**
 * Get Buy Box status for a listing
 * @param {number} listingId
 * @returns {Promise<Object>} Buy Box status data
 */
export async function getBuyBoxStatusByListing(listingId) {
  // Try to get from listing_offer_current table
  const result = await query(`
    SELECT
      buy_box_status,
      buy_box_price_inc_vat,
      buy_box_seller,
      is_our_offer,
      captured_at
    FROM listing_offer_current
    WHERE listing_id = $1
    ORDER BY captured_at DESC
    LIMIT 1
  `, [listingId]);

  if (result.rows.length === 0) {
    return {
      listing_id: listingId,
      status: BUY_BOX_STATUS.UNKNOWN,
      owner: null,
      price_inc_vat: null,
      is_ours: null,
      captured_at: null,
      source: 'none',
    };
  }

  const row = result.rows[0];
  return {
    listing_id: listingId,
    status: row.buy_box_status || BUY_BOX_STATUS.UNKNOWN,
    owner: row.buy_box_seller,
    price_inc_vat: row.buy_box_price_inc_vat ? parseFloat(row.buy_box_price_inc_vat) : null,
    is_ours: row.is_our_offer,
    captured_at: row.captured_at,
    source: 'listing_offer_current',
  };
}

/**
 * Get Buy Box status for an ASIN entity
 * @param {number} asinEntityId
 * @returns {Promise<Object>} Buy Box status data
 */
export async function getBuyBoxStatusByAsin(asinEntityId) {
  // Try to get from keepa_snapshots for ASIN
  const result = await query(`
    SELECT
      ae.id as asin_entity_id,
      ae.asin,
      ks.buy_box_price_inc_vat,
      ks.buy_box_seller_id,
      ks.fetched_at
    FROM asin_entities ae
    LEFT JOIN keepa_snapshots ks ON ks.asin_entity_id = ae.id
    WHERE ae.id = $1
    ORDER BY ks.fetched_at DESC NULLS LAST
    LIMIT 1
  `, [asinEntityId]);

  if (result.rows.length === 0) {
    return {
      asin_entity_id: asinEntityId,
      status: BUY_BOX_STATUS.UNKNOWN,
      owner: null,
      price_inc_vat: null,
      captured_at: null,
      source: 'none',
    };
  }

  const row = result.rows[0];
  const hasBuyBoxData = row.buy_box_price_inc_vat !== null;

  return {
    asin_entity_id: asinEntityId,
    asin: row.asin,
    status: hasBuyBoxData ? BUY_BOX_STATUS.UNKNOWN : BUY_BOX_STATUS.UNKNOWN, // Would need seller comparison
    owner: row.buy_box_seller_id,
    price_inc_vat: row.buy_box_price_inc_vat ? parseFloat(row.buy_box_price_inc_vat) : null,
    captured_at: row.fetched_at,
    source: 'keepa_snapshots',
  };
}

/**
 * Determine Buy Box status based on data
 * @param {Object} params
 * @param {number|null} params.buyBoxPrice
 * @param {string|null} params.buyBoxSeller
 * @param {string|null} params.ourSellerId
 * @param {number|null} params.ourPrice
 * @returns {string} Buy Box status
 */
export function determineBuyBoxStatus({ buyBoxPrice, buyBoxSeller, ourSellerId, ourPrice }) {
  if (buyBoxPrice === null || buyBoxPrice === undefined) {
    return BUY_BOX_STATUS.SUPPRESSED;
  }

  if (ourSellerId && buyBoxSeller === ourSellerId) {
    return BUY_BOX_STATUS.OWNED;
  }

  if (ourPrice === null || ourPrice === undefined) {
    return BUY_BOX_STATUS.NO_OFFER;
  }

  return BUY_BOX_STATUS.LOST;
}

/**
 * Record a Buy Box snapshot for a listing
 * @param {Object} params
 * @param {number} params.listingId
 * @param {string} params.buyBoxStatus
 * @param {number|null} params.buyBoxPriceIncVat
 * @param {string|null} params.buyBoxSeller
 * @param {boolean} params.isOurOffer
 * @param {string} [params.source='api']
 * @returns {Promise<Object>} Created snapshot record
 */
export async function recordBuyBoxSnapshot({
  listingId,
  buyBoxStatus,
  buyBoxPriceIncVat,
  buyBoxSeller,
  isOurOffer,
  source = 'api',
}) {
  const result = await query(`
    INSERT INTO listing_offer_current (
      listing_id,
      buy_box_status,
      buy_box_price_inc_vat,
      buy_box_seller,
      is_our_offer,
      captured_at
    ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
    ON CONFLICT (listing_id) DO UPDATE SET
      buy_box_status = EXCLUDED.buy_box_status,
      buy_box_price_inc_vat = EXCLUDED.buy_box_price_inc_vat,
      buy_box_seller = EXCLUDED.buy_box_seller,
      is_our_offer = EXCLUDED.is_our_offer,
      captured_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `, [listingId, buyBoxStatus, buyBoxPriceIncVat, buyBoxSeller, isOurOffer]);

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
  return status.status === BUY_BOX_STATUS.OWNED;
}

/**
 * Get Buy Box competitive metrics
 * @param {number} listingId
 * @returns {Promise<Object>} Competitive metrics
 */
export async function getBuyBoxCompetitiveMetrics(listingId) {
  const status = await getBuyBoxStatusByListing(listingId);

  // Get our current price
  const listingResult = await query(
    'SELECT price_inc_vat FROM listings WHERE id = $1',
    [listingId]
  );

  const ourPrice = listingResult.rows[0]?.price_inc_vat
    ? parseFloat(listingResult.rows[0].price_inc_vat)
    : null;

  const buyBoxPrice = status.price_inc_vat;
  let priceDelta = null;
  let priceDeltaPct = null;

  if (ourPrice !== null && buyBoxPrice !== null) {
    priceDelta = ourPrice - buyBoxPrice;
    priceDeltaPct = buyBoxPrice > 0 ? (priceDelta / buyBoxPrice) : 0;
  }

  return {
    listing_id: listingId,
    buy_box_status: status.status,
    our_price_inc_vat: ourPrice,
    buy_box_price_inc_vat: buyBoxPrice,
    price_delta: priceDelta !== null ? Math.round(priceDelta * 100) / 100 : null,
    price_delta_pct: priceDeltaPct !== null ? Math.round(priceDeltaPct * 10000) / 10000 : null,
    is_competitive: priceDelta !== null ? priceDelta <= 0 : null,
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
