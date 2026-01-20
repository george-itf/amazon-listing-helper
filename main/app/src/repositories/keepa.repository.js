/**
 * Keepa Repository
 * Handles all database operations for Keepa competitive data
 */

import { query } from '../database/connection.js';

/**
 * Get Keepa data by ASIN
 * @param {string} asin - ASIN
 * @returns {Promise<Object|null>} Keepa data or null
 */
export async function getByAsin(asin) {
  const sql = `SELECT * FROM keepa_data WHERE asin = $1`;
  const result = await query(sql, [asin]);
  return result.rows[0] || null;
}

/**
 * Get all Keepa data
 * @param {number} limit - Maximum records to return (null for no limit)
 * @returns {Promise<Array>} Array of Keepa data
 */
export async function getAll(limit = null) {
  let sql = `
    SELECT * FROM keepa_data
    ORDER BY "lastSyncedAt" DESC
  `;
  const params = [];
  if (limit !== null) {
    sql += ` LIMIT $1`;
    params.push(limit);
  }
  const result = await query(sql, params);
  return result.rows;
}

/**
 * Get Keepa data with filters
 * @param {Object} filters - Filter options
 * @returns {Promise<Array>} Filtered Keepa data
 */
export async function getFiltered(filters = {}) {
  let sql = `SELECT * FROM keepa_data WHERE 1=1`;

  const params = [];
  let paramCount = 1;

  if (filters.minBSR !== undefined) {
    sql += ` AND "currentBSR" >= $${paramCount++}`;
    params.push(filters.minBSR);
  }

  if (filters.maxBSR !== undefined) {
    sql += ` AND "currentBSR" <= $${paramCount++}`;
    params.push(filters.maxBSR);
  }

  if (filters.minPrice !== undefined) {
    sql += ` AND "currentPrice" >= $${paramCount++}`;
    params.push(filters.minPrice);
  }

  if (filters.maxPrice !== undefined) {
    sql += ` AND "currentPrice" <= $${paramCount++}`;
    params.push(filters.maxPrice);
  }

  if (filters.minCompetitors !== undefined) {
    sql += ` AND "competitorCount" >= $${paramCount++}`;
    params.push(filters.minCompetitors);
  }

  if (filters.hasAmazon !== undefined) {
    sql += ` AND "amazonOnListing" = $${paramCount++}`;
    params.push(filters.hasAmazon);
  }

  sql += ` ORDER BY "lastSyncedAt" DESC`;

  if (filters.limit) {
    sql += ` LIMIT $${paramCount++}`;
    params.push(filters.limit);
  }

  const result = await query(sql, params);
  return result.rows;
}

/**
 * Upsert Keepa data (insert or update)
 * @param {Object} data - Keepa data
 * @returns {Promise<Object>} Upserted record
 */
export async function upsert(data) {
  const sql = `
    INSERT INTO keepa_data (
      asin, "currentPrice", "currentBSR", "avgPrice30", "avgBSR30",
      "competitorCount", "amazonOnListing", "buyBoxSeller", "buyBoxPrice",
      rating, "reviewCount", "priceHistory", "bsrHistory", "salesEstimate",
      "lastSyncedAt"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
    ON CONFLICT (asin) DO UPDATE SET
      "currentPrice" = EXCLUDED."currentPrice",
      "currentBSR" = EXCLUDED."currentBSR",
      "avgPrice30" = EXCLUDED."avgPrice30",
      "avgBSR30" = EXCLUDED."avgBSR30",
      "competitorCount" = EXCLUDED."competitorCount",
      "amazonOnListing" = EXCLUDED."amazonOnListing",
      "buyBoxSeller" = EXCLUDED."buyBoxSeller",
      "buyBoxPrice" = EXCLUDED."buyBoxPrice",
      rating = EXCLUDED.rating,
      "reviewCount" = EXCLUDED."reviewCount",
      "priceHistory" = EXCLUDED."priceHistory",
      "bsrHistory" = EXCLUDED."bsrHistory",
      "salesEstimate" = EXCLUDED."salesEstimate",
      "lastSyncedAt" = NOW()
    RETURNING *
  `;

  const result = await query(sql, [
    data.asin,
    data.currentPrice || null,
    data.currentBSR || null,
    data.avgPrice30 || null,
    data.avgBSR30 || null,
    data.competitorCount || 0,
    data.amazonOnListing || false,
    data.buyBoxSeller || null,
    data.buyBoxPrice || null,
    data.rating || null,
    data.reviewCount || null,
    JSON.stringify(data.priceHistory || []),
    JSON.stringify(data.bsrHistory || []),
    data.salesEstimate || null,
  ]);

  return result.rows[0];
}

/**
 * Bulk upsert Keepa data
 * @param {Array} items - Array of Keepa data
 * @returns {Promise<number>} Number of upserted records
 */
export async function bulkUpsert(items) {
  let count = 0;
  for (const item of items) {
    await upsert(item);
    count++;
  }
  return count;
}

/**
 * Delete Keepa data by ASIN
 * @param {string} asin - ASIN
 * @returns {Promise<boolean>} True if deleted
 */
export async function remove(asin) {
  const result = await query('DELETE FROM keepa_data WHERE asin = $1 RETURNING asin', [asin]);
  return result.rowCount > 0;
}

/**
 * Get stale Keepa data (not synced recently)
 * @param {number} hoursOld - Hours since last sync
 * @returns {Promise<Array>} Stale records
 */
export async function getStale(hoursOld = 24) {
  const sql = `
    SELECT * FROM keepa_data
    WHERE "lastSyncedAt" < NOW() - INTERVAL '${hoursOld} hours'
    ORDER BY "lastSyncedAt" ASC
  `;

  const result = await query(sql);
  return result.rows;
}

/**
 * Get ASINs that need syncing
 * @param {number} limit - Maximum ASINs to return
 * @param {number} hoursOld - Hours since last sync
 * @returns {Promise<Array<string>>} Array of ASINs
 */
export async function getAsinsToSync(limit = 50, hoursOld = 24) {
  const sql = `
    SELECT asin FROM keepa_data
    WHERE "lastSyncedAt" < NOW() - INTERVAL '${hoursOld} hours'
    ORDER BY "lastSyncedAt" ASC
    LIMIT $1
  `;

  const result = await query(sql, [limit]);
  return result.rows.map(row => row.asin);
}

/**
 * Get competitive statistics
 * @returns {Promise<Object>} Competitive statistics
 */
export async function getStatistics() {
  const sql = `
    SELECT
      COUNT(*) as total_tracked,
      AVG("currentPrice")::numeric(10,2) as avg_price,
      AVG("currentBSR")::numeric(10,0) as avg_bsr,
      AVG("competitorCount")::numeric(5,1) as avg_competitors,
      SUM(CASE WHEN "amazonOnListing" = true THEN 1 ELSE 0 END) as amazon_count,
      MIN("lastSyncedAt") as oldest_sync,
      MAX("lastSyncedAt") as newest_sync
    FROM keepa_data
  `;

  const result = await query(sql);
  return result.rows[0];
}

/**
 * Get top performing ASINs by BSR
 * @param {number} limit - Maximum records
 * @returns {Promise<Array>} Top ASINs
 */
export async function getTopByBSR(limit = 10) {
  const sql = `
    SELECT * FROM keepa_data
    WHERE "currentBSR" IS NOT NULL
    ORDER BY "currentBSR" ASC
    LIMIT $1
  `;

  const result = await query(sql, [limit]);
  return result.rows;
}

export default {
  getByAsin,
  getAll,
  getFiltered,
  upsert,
  bulkUpsert,
  remove,
  getStale,
  getAsinsToSync,
  getStatistics,
  getTopByBSR,
};
