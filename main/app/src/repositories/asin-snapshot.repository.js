/**
 * ASIN Snapshot Repository
 *
 * CRUD operations for asin_snapshot table.
 * This table is append-only - never update rows, only insert.
 *
 * Per canonical ASIN data model specification:
 * - Historical record of what we knew about an ASIN at a point in time
 * - Each row represents one ASIN, one ingestion run, one flattened view
 * - Full raw payloads attached for provenance
 *
 * @module AsinSnapshotRepository
 */

import { query, transaction } from '../database/connection.js';
import { generateFingerprint } from '../lib/fingerprint.js';

// Current transform version - increment when transform logic changes
export const TRANSFORM_VERSION = 1;

/**
 * Insert a new ASIN snapshot (append-only)
 *
 * @param {Object} data - Snapshot data
 * @returns {Promise<Object|null>} Created snapshot or null if table doesn't exist
 */
export async function insert(data) {
  try {
    // Generate fingerprint if not provided
    const fingerprintHash = data.fingerprint_hash || generateFingerprint({
      asin: data.asin,
      marketplace_id: data.marketplace_id,
      price_inc_vat: data.price_inc_vat,
      total_stock: data.total_stock,
      buy_box_seller_id: data.buy_box_seller_id,
      keepa_price_p25_90d: data.keepa_price_p25_90d,
      seller_count: data.seller_count,
    });

    const result = await query(`
      INSERT INTO asin_snapshot (
        asin, marketplace_id, asin_entity_id, ingestion_job_id,
        title, brand, category_path,
        price_inc_vat, price_ex_vat, list_price,
        buy_box_price, buy_box_seller_id, buy_box_is_fba, seller_count,
        total_stock, fulfillment_channel, units_7d, units_30d, units_90d, days_of_cover,
        keepa_has_data, keepa_last_update, keepa_price_p25_90d, keepa_price_median_90d,
        keepa_price_p75_90d, keepa_lowest_90d, keepa_highest_90d,
        keepa_sales_rank_latest, keepa_new_offers, keepa_used_offers,
        gross_margin_pct, profit_per_unit, breakeven_price,
        is_buy_box_lost, is_out_of_stock, price_volatility_score,
        amazon_raw, keepa_raw, fingerprint_hash, transform_version, snapshot_time
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
        $37, $38, $39, $40, COALESCE($41, CURRENT_TIMESTAMP)
      )
      RETURNING *
    `, [
      data.asin,
      data.marketplace_id,
      data.asin_entity_id || null,
      data.ingestion_job_id,
      data.title || null,
      data.brand || null,
      data.category_path || null,
      data.price_inc_vat || null,
      data.price_ex_vat || null,
      data.list_price || null,
      data.buy_box_price || null,
      data.buy_box_seller_id || null,
      data.buy_box_is_fba || null,
      data.seller_count || null,
      data.total_stock || null,
      data.fulfillment_channel || null,
      data.units_7d || null,
      data.units_30d || null,
      data.units_90d || null,
      data.days_of_cover || null,
      data.keepa_has_data || false,
      data.keepa_last_update || null,
      data.keepa_price_p25_90d || null,
      data.keepa_price_median_90d || null,
      data.keepa_price_p75_90d || null,
      data.keepa_lowest_90d || null,
      data.keepa_highest_90d || null,
      data.keepa_sales_rank_latest || null,
      data.keepa_new_offers || null,
      data.keepa_used_offers || null,
      data.gross_margin_pct || null,
      data.profit_per_unit || null,
      data.breakeven_price || null,
      data.is_buy_box_lost || null,
      data.is_out_of_stock || null,
      data.price_volatility_score || null,
      data.amazon_raw ? JSON.stringify(data.amazon_raw) : null,
      data.keepa_raw ? JSON.stringify(data.keepa_raw) : null,
      fingerprintHash,
      data.transform_version || TRANSFORM_VERSION,
      data.snapshot_time || null,
    ]);

    return result.rows[0];
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[AsinSnapshot] asin_snapshot table does not exist');
      return null;
    }
    throw error;
  }
}

/**
 * Get the latest snapshot for an ASIN
 *
 * @param {string} asin - ASIN
 * @param {number} marketplaceId - Marketplace ID
 * @returns {Promise<Object|null>}
 */
export async function getLatest(asin, marketplaceId) {
  try {
    const result = await query(`
      SELECT * FROM asin_snapshot
      WHERE asin = $1 AND marketplace_id = $2
      ORDER BY snapshot_time DESC
      LIMIT 1
    `, [asin, marketplaceId]);

    return result.rows[0] || null;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[AsinSnapshot] asin_snapshot table does not exist');
      return null;
    }
    throw error;
  }
}

/**
 * Get snapshot by ID
 *
 * @param {number} snapshotId - Snapshot ID
 * @returns {Promise<Object|null>}
 */
export async function getById(snapshotId) {
  try {
    const result = await query(`
      SELECT * FROM asin_snapshot WHERE id = $1
    `, [snapshotId]);

    return result.rows[0] || null;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[AsinSnapshot] asin_snapshot table does not exist');
      return null;
    }
    throw error;
  }
}

/**
 * Get snapshot history for an ASIN
 *
 * @param {string} asin - ASIN
 * @param {number} marketplaceId - Marketplace ID
 * @param {number} [limit=30] - Maximum number of snapshots to return
 * @returns {Promise<Object[]>}
 */
export async function getHistory(asin, marketplaceId, limit = 30) {
  try {
    const result = await query(`
      SELECT id, asin, marketplace_id, ingestion_job_id,
             title, brand, price_inc_vat, buy_box_price, seller_count,
             total_stock, keepa_has_data, keepa_sales_rank_latest,
             is_buy_box_lost, is_out_of_stock, fingerprint_hash, snapshot_time
      FROM asin_snapshot
      WHERE asin = $1 AND marketplace_id = $2
      ORDER BY snapshot_time DESC
      LIMIT $3
    `, [asin, marketplaceId, limit]);

    return result.rows;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[AsinSnapshot] asin_snapshot table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Get snapshots by fingerprint hash
 * Useful for finding duplicate/unchanged snapshots
 *
 * @param {string} fingerprintHash - Fingerprint hash
 * @param {number} [limit=10] - Maximum number of results
 * @returns {Promise<Object[]>}
 */
export async function getByFingerprint(fingerprintHash, limit = 10) {
  try {
    const result = await query(`
      SELECT id, asin, marketplace_id, snapshot_time, fingerprint_hash
      FROM asin_snapshot
      WHERE fingerprint_hash = $1
      ORDER BY snapshot_time DESC
      LIMIT $2
    `, [fingerprintHash, limit]);

    return result.rows;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[AsinSnapshot] asin_snapshot table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Get snapshots for an ingestion job
 *
 * @param {string} ingestionJobId - UUID of the ingestion job
 * @returns {Promise<Object[]>}
 */
export async function getByIngestionJob(ingestionJobId) {
  try {
    const result = await query(`
      SELECT id, asin, marketplace_id, fingerprint_hash, snapshot_time
      FROM asin_snapshot
      WHERE ingestion_job_id = $1
      ORDER BY asin
    `, [ingestionJobId]);

    return result.rows;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[AsinSnapshot] asin_snapshot table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Count snapshots for an ingestion job
 *
 * @param {string} ingestionJobId - UUID of the ingestion job
 * @returns {Promise<number>}
 */
export async function countByIngestionJob(ingestionJobId) {
  try {
    const result = await query(`
      SELECT COUNT(*) as count FROM asin_snapshot
      WHERE ingestion_job_id = $1
    `, [ingestionJobId]);

    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[AsinSnapshot] asin_snapshot table does not exist');
      return 0;
    }
    throw error;
  }
}

/**
 * Get snapshots with changed fingerprints compared to previous
 * Useful for identifying ASINs that have changed
 *
 * @param {string} ingestionJobId - UUID of the ingestion job
 * @returns {Promise<Object[]>}
 */
export async function getChangedSnapshots(ingestionJobId) {
  try {
    const result = await query(`
      WITH current_snapshots AS (
        SELECT s.*,
               LAG(s.fingerprint_hash) OVER (
                 PARTITION BY s.asin, s.marketplace_id
                 ORDER BY s.snapshot_time
               ) as previous_fingerprint
        FROM asin_snapshot s
      )
      SELECT cs.*
      FROM current_snapshots cs
      WHERE cs.ingestion_job_id = $1
        AND (cs.previous_fingerprint IS NULL
             OR cs.fingerprint_hash != cs.previous_fingerprint)
    `, [ingestionJobId]);

    return result.rows;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[AsinSnapshot] asin_snapshot table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Get price history for an ASIN
 * Returns time series data for charting
 *
 * @param {string} asin - ASIN
 * @param {number} marketplaceId - Marketplace ID
 * @param {number} [days=90] - Number of days of history
 * @returns {Promise<Object[]>}
 */
export async function getPriceHistory(asin, marketplaceId, days = 90) {
  try {
    const result = await query(`
      SELECT snapshot_time, price_inc_vat, buy_box_price,
             keepa_price_median_90d, seller_count
      FROM asin_snapshot
      WHERE asin = $1 AND marketplace_id = $2
        AND snapshot_time > CURRENT_TIMESTAMP - ($3 * INTERVAL '1 day')
      ORDER BY snapshot_time ASC
    `, [asin, marketplaceId, days]);

    return result.rows;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[AsinSnapshot] asin_snapshot table does not exist');
      return [];
    }
    throw error;
  }
}

export default {
  TRANSFORM_VERSION,
  insert,
  getLatest,
  getById,
  getHistory,
  getByFingerprint,
  getByIngestionJob,
  countByIngestionJob,
  getChangedSnapshots,
  getPriceHistory,
};
