/**
 * ASIN Current Repository
 *
 * CRUD operations for asin_current table.
 * This is the materialized "spreadsheet" view - exactly one row per ASIN.
 * Uses upsert semantics only.
 *
 * Per canonical ASIN data model specification:
 * - Fast, queryable latest state per ASIN
 * - Exactly one row per ASIN
 * - Always points to the latest asin_snapshot
 * - This is what the UI, charts, and recommendation engine will read
 *
 * @module AsinCurrentRepository
 */

import { query, transaction } from '../database/connection.js';
import { toInteger, toNumber, toBoolean, toDate, toNullish } from '../lib/coerce.js';

/**
 * Upsert an ASIN current record
 * Creates or updates the record for the given ASIN
 *
 * @param {Object} data - Current state data (from snapshot)
 * @param {Object} [options] - Options
 * @param {pg.PoolClient} [options.client] - Optional transaction client for atomic operations
 * @returns {Promise<Object|null>} Upserted row or null if table doesn't exist
 */
export async function upsert(data, options = {}) {
  const { client = null } = options;
  try {
    const result = await query(`
      INSERT INTO asin_current (
        asin, marketplace_id, asin_entity_id, latest_snapshot_id,
        title, brand, category_path,
        price_inc_vat, price_ex_vat, list_price,
        buy_box_price, buy_box_seller_id, buy_box_is_fba, seller_count,
        total_stock, fulfillment_channel, units_7d, units_30d, units_90d, days_of_cover,
        keepa_has_data, keepa_last_update, keepa_price_p25_90d, keepa_price_median_90d,
        keepa_price_p75_90d, keepa_lowest_90d, keepa_highest_90d,
        keepa_sales_rank_latest, keepa_new_offers, keepa_used_offers,
        gross_margin_pct, profit_per_unit, breakeven_price,
        is_buy_box_lost, is_out_of_stock, price_volatility_score,
        fingerprint_hash, last_ingestion_job_id, last_snapshot_time,
        first_seen_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24,
        $25, $26, $27,
        $28, $29, $30,
        $31, $32, $33,
        $34, $35, $36,
        $37, $38, $39,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT (asin, marketplace_id) DO UPDATE SET
        asin_entity_id = COALESCE(EXCLUDED.asin_entity_id, asin_current.asin_entity_id),
        latest_snapshot_id = EXCLUDED.latest_snapshot_id,
        title = COALESCE(EXCLUDED.title, asin_current.title),
        brand = COALESCE(EXCLUDED.brand, asin_current.brand),
        category_path = COALESCE(EXCLUDED.category_path, asin_current.category_path),
        price_inc_vat = EXCLUDED.price_inc_vat,
        price_ex_vat = EXCLUDED.price_ex_vat,
        list_price = EXCLUDED.list_price,
        buy_box_price = EXCLUDED.buy_box_price,
        buy_box_seller_id = EXCLUDED.buy_box_seller_id,
        buy_box_is_fba = EXCLUDED.buy_box_is_fba,
        seller_count = EXCLUDED.seller_count,
        total_stock = EXCLUDED.total_stock,
        fulfillment_channel = EXCLUDED.fulfillment_channel,
        units_7d = EXCLUDED.units_7d,
        units_30d = EXCLUDED.units_30d,
        units_90d = EXCLUDED.units_90d,
        days_of_cover = EXCLUDED.days_of_cover,
        keepa_has_data = EXCLUDED.keepa_has_data,
        keepa_last_update = EXCLUDED.keepa_last_update,
        keepa_price_p25_90d = EXCLUDED.keepa_price_p25_90d,
        keepa_price_median_90d = EXCLUDED.keepa_price_median_90d,
        keepa_price_p75_90d = EXCLUDED.keepa_price_p75_90d,
        keepa_lowest_90d = EXCLUDED.keepa_lowest_90d,
        keepa_highest_90d = EXCLUDED.keepa_highest_90d,
        keepa_sales_rank_latest = EXCLUDED.keepa_sales_rank_latest,
        keepa_new_offers = EXCLUDED.keepa_new_offers,
        keepa_used_offers = EXCLUDED.keepa_used_offers,
        gross_margin_pct = EXCLUDED.gross_margin_pct,
        profit_per_unit = EXCLUDED.profit_per_unit,
        breakeven_price = EXCLUDED.breakeven_price,
        is_buy_box_lost = EXCLUDED.is_buy_box_lost,
        is_out_of_stock = EXCLUDED.is_out_of_stock,
        price_volatility_score = EXCLUDED.price_volatility_score,
        fingerprint_hash = EXCLUDED.fingerprint_hash,
        last_ingestion_job_id = EXCLUDED.last_ingestion_job_id,
        last_snapshot_time = EXCLUDED.last_snapshot_time,
        updated_at = CURRENT_TIMESTAMP
      -- FRESHNESS GUARD: Only update if incoming data is newer or equal
      -- Prevents out-of-order transforms from overwriting fresher data
      WHERE asin_current.last_snapshot_time IS NULL
         OR EXCLUDED.last_snapshot_time >= asin_current.last_snapshot_time
      RETURNING *, (xmax = 0) AS is_insert
    `, [
      data.asin,
      data.marketplace_id,
      toNullish(data.asin_entity_id),
      data.latest_snapshot_id,
      toNullish(data.title),
      toNullish(data.brand),
      toNullish(data.category_path),
      toNumber(data.price_inc_vat),
      toNumber(data.price_ex_vat),
      toNumber(data.list_price),
      toNumber(data.buy_box_price),
      toNullish(data.buy_box_seller_id),
      toBoolean(data.buy_box_is_fba),       // CRITICAL: preserves false
      toInteger(data.seller_count),          // CRITICAL: preserves 0
      toInteger(data.total_stock),           // CRITICAL: preserves 0
      toNullish(data.fulfillment_channel),
      toInteger(data.units_7d),              // CRITICAL: preserves 0
      toInteger(data.units_30d),             // CRITICAL: preserves 0
      toInteger(data.units_90d),             // CRITICAL: preserves 0
      toNumber(data.days_of_cover),
      toBoolean(data.keepa_has_data) ?? false,
      toDate(data.keepa_last_update),
      toInteger(data.keepa_price_p25_90d),
      toInteger(data.keepa_price_median_90d),
      toInteger(data.keepa_price_p75_90d),
      toInteger(data.keepa_lowest_90d),
      toInteger(data.keepa_highest_90d),
      toInteger(data.keepa_sales_rank_latest),
      toInteger(data.keepa_new_offers),      // CRITICAL: preserves 0
      toInteger(data.keepa_used_offers),     // CRITICAL: preserves 0
      toNumber(data.gross_margin_pct),
      toNumber(data.profit_per_unit),
      toNumber(data.breakeven_price),
      toBoolean(data.is_buy_box_lost),       // CRITICAL: preserves false
      toBoolean(data.is_out_of_stock),       // CRITICAL: preserves false
      toNumber(data.price_volatility_score),
      data.fingerprint_hash,
      data.last_ingestion_job_id,
      toDate(data.last_snapshot_time) ?? new Date(),
    ], client);

    return result.rows[0];
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[AsinCurrent] asin_current table does not exist');
      return null;
    }
    throw error;
  }
}

/**
 * Get current state for an ASIN
 *
 * @param {string} asin - ASIN
 * @param {number} marketplaceId - Marketplace ID
 * @returns {Promise<Object|null>}
 */
export async function getByAsin(asin, marketplaceId) {
  try {
    const result = await query(`
      SELECT * FROM asin_current
      WHERE asin = $1 AND marketplace_id = $2
    `, [asin, marketplaceId]);

    return result.rows[0] || null;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[AsinCurrent] asin_current table does not exist');
      return null;
    }
    throw error;
  }
}

/**
 * Get current state by ID
 *
 * @param {number} id - Record ID
 * @returns {Promise<Object|null>}
 */
export async function getById(id) {
  try {
    const result = await query(`
      SELECT * FROM asin_current WHERE id = $1
    `, [id]);

    return result.rows[0] || null;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[AsinCurrent] asin_current table does not exist');
      return null;
    }
    throw error;
  }
}

/**
 * Get all current ASINs with filters
 *
 * @param {Object} [filters] - Filter options
 * @param {string} [filters.brand] - Filter by brand
 * @param {boolean} [filters.is_buy_box_lost] - Filter by buy box status
 * @param {boolean} [filters.is_out_of_stock] - Filter by stock status
 * @param {boolean} [filters.keepa_has_data] - Filter by Keepa data presence
 * @param {number} [filters.min_margin] - Minimum margin percentage
 * @param {number} [filters.max_margin] - Maximum margin percentage
 * @param {number} [filters.limit=100] - Maximum results
 * @param {number} [filters.offset=0] - Offset for pagination
 * @param {string} [filters.order_by='updated_at'] - Sort column
 * @param {string} [filters.order='DESC'] - Sort direction
 * @returns {Promise<Object[]>}
 */
export async function getAll(filters = {}) {
  try {
    const params = [];
    const conditions = [];
    let paramIndex = 1;

    if (filters.brand) {
      conditions.push(`brand ILIKE $${paramIndex++}`);
      params.push(`%${filters.brand}%`);
    }

    if (filters.is_buy_box_lost !== undefined) {
      conditions.push(`is_buy_box_lost = $${paramIndex++}`);
      params.push(filters.is_buy_box_lost);
    }

    if (filters.is_out_of_stock !== undefined) {
      conditions.push(`is_out_of_stock = $${paramIndex++}`);
      params.push(filters.is_out_of_stock);
    }

    if (filters.keepa_has_data !== undefined) {
      conditions.push(`keepa_has_data = $${paramIndex++}`);
      params.push(filters.keepa_has_data);
    }

    if (filters.min_margin !== undefined) {
      conditions.push(`gross_margin_pct >= $${paramIndex++}`);
      params.push(filters.min_margin);
    }

    if (filters.max_margin !== undefined) {
      conditions.push(`gross_margin_pct <= $${paramIndex++}`);
      params.push(filters.max_margin);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Validate order_by to prevent SQL injection
    const validOrderBy = ['updated_at', 'asin', 'brand', 'price_inc_vat', 'gross_margin_pct', 'seller_count'];
    const orderBy = validOrderBy.includes(filters.order_by) ? filters.order_by : 'updated_at';
    const order = filters.order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const limit = filters.limit || 100;
    const offset = filters.offset || 0;

    params.push(limit, offset);

    const result = await query(`
      SELECT * FROM asin_current
      ${whereClause}
      ORDER BY ${orderBy} ${order}
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `, params);

    return result.rows;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[AsinCurrent] asin_current table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Get count of all ASINs
 *
 * @param {Object} [filters] - Same filters as getAll
 * @returns {Promise<number>}
 */
export async function count(filters = {}) {
  try {
    const params = [];
    const conditions = [];
    let paramIndex = 1;

    if (filters.brand) {
      conditions.push(`brand ILIKE $${paramIndex++}`);
      params.push(`%${filters.brand}%`);
    }

    if (filters.is_buy_box_lost !== undefined) {
      conditions.push(`is_buy_box_lost = $${paramIndex++}`);
      params.push(filters.is_buy_box_lost);
    }

    if (filters.is_out_of_stock !== undefined) {
      conditions.push(`is_out_of_stock = $${paramIndex++}`);
      params.push(filters.is_out_of_stock);
    }

    if (filters.keepa_has_data !== undefined) {
      conditions.push(`keepa_has_data = $${paramIndex++}`);
      params.push(filters.keepa_has_data);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(`
      SELECT COUNT(*) as count FROM asin_current ${whereClause}
    `, params);

    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[AsinCurrent] asin_current table does not exist');
      return 0;
    }
    throw error;
  }
}

/**
 * Get ASINs that need refresh (stale data)
 *
 * @param {number} maxAgeMinutes - Maximum age in minutes
 * @param {number} [limit=100] - Maximum results
 * @returns {Promise<Object[]>}
 */
export async function getStale(maxAgeMinutes, limit = 100) {
  try {
    const result = await query(`
      SELECT * FROM asin_current
      WHERE last_snapshot_time < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 minute')
      ORDER BY last_snapshot_time ASC
      LIMIT $2
    `, [maxAgeMinutes, limit]);

    return result.rows;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[AsinCurrent] asin_current table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Get ASINs by fingerprint hash
 * Useful for finding ASINs with identical state
 *
 * @param {string} fingerprintHash - Fingerprint hash
 * @returns {Promise<Object[]>}
 */
export async function getByFingerprint(fingerprintHash) {
  try {
    const result = await query(`
      SELECT * FROM asin_current
      WHERE fingerprint_hash = $1
    `, [fingerprintHash]);

    return result.rows;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[AsinCurrent] asin_current table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Get ASINs with buy box lost
 *
 * @param {number} marketplaceId - Marketplace ID
 * @param {number} [limit=100] - Maximum results
 * @returns {Promise<Object[]>}
 */
export async function getBuyBoxLost(marketplaceId, limit = 100) {
  try {
    const result = await query(`
      SELECT * FROM asin_current
      WHERE marketplace_id = $1 AND is_buy_box_lost = true
      ORDER BY updated_at DESC
      LIMIT $2
    `, [marketplaceId, limit]);

    return result.rows;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[AsinCurrent] asin_current table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Get ASINs that are out of stock
 *
 * @param {number} marketplaceId - Marketplace ID
 * @param {number} [limit=100] - Maximum results
 * @returns {Promise<Object[]>}
 */
export async function getOutOfStock(marketplaceId, limit = 100) {
  try {
    const result = await query(`
      SELECT * FROM asin_current
      WHERE marketplace_id = $1 AND is_out_of_stock = true
      ORDER BY updated_at DESC
      LIMIT $2
    `, [marketplaceId, limit]);

    return result.rows;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[AsinCurrent] asin_current table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Get summary statistics
 *
 * @param {number} marketplaceId - Marketplace ID
 * @returns {Promise<Object>}
 */
export async function getSummary(marketplaceId) {
  try {
    const result = await query(`
      SELECT
        COUNT(*) as total_asins,
        COUNT(*) FILTER (WHERE is_buy_box_lost = true) as buy_box_lost_count,
        COUNT(*) FILTER (WHERE is_out_of_stock = true) as out_of_stock_count,
        COUNT(*) FILTER (WHERE keepa_has_data = true) as with_keepa_data,
        AVG(gross_margin_pct) FILTER (WHERE gross_margin_pct IS NOT NULL) as avg_margin,
        AVG(seller_count) FILTER (WHERE seller_count IS NOT NULL) as avg_sellers
      FROM asin_current
      WHERE marketplace_id = $1
    `, [marketplaceId]);

    const row = result.rows[0];
    return {
      total_asins: parseInt(row.total_asins, 10),
      buy_box_lost_count: parseInt(row.buy_box_lost_count, 10),
      out_of_stock_count: parseInt(row.out_of_stock_count, 10),
      with_keepa_data: parseInt(row.with_keepa_data, 10),
      avg_margin: row.avg_margin ? parseFloat(row.avg_margin) : null,
      avg_sellers: row.avg_sellers ? parseFloat(row.avg_sellers) : null,
    };
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[AsinCurrent] asin_current table does not exist');
      return {
        total_asins: 0,
        buy_box_lost_count: 0,
        out_of_stock_count: 0,
        with_keepa_data: 0,
        avg_margin: null,
        avg_sellers: null,
      };
    }
    throw error;
  }
}

export default {
  upsert,
  getByAsin,
  getById,
  getAll,
  count,
  getStale,
  getByFingerprint,
  getBuyBoxLost,
  getOutOfStock,
  getSummary,
};
