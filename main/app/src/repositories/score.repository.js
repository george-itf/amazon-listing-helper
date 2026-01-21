/**
 * Score Repository
 * Handles all database operations for listing scores
 */

import { query, transaction } from '../database/connection.js';

/**
 * Get the latest score for a listing
 * @param {string} listingId - Listing ID
 * @returns {Promise<Object|null>} Score object or null
 */
export async function getLatestByListingId(listingId) {
  const sql = `
    SELECT * FROM listing_scores
    WHERE "listingId" = $1
    ORDER BY "calculatedAt" DESC
    LIMIT 1
  `;

  const result = await query(sql, [listingId]);
  return result.rows[0] || null;
}

/**
 * Get all scores for a listing (history)
 * @param {string} listingId - Listing ID
 * @param {number} limit - Maximum records to return
 * @returns {Promise<Array>} Array of scores
 */
export async function getHistoryByListingId(listingId, limit = 30) {
  const sql = `
    SELECT * FROM listing_scores
    WHERE "listingId" = $1
    ORDER BY "calculatedAt" DESC
    LIMIT $2
  `;

  const result = await query(sql, [listingId, limit]);
  return result.rows;
}

/**
 * Get all latest scores with listing details
 * @param {Object} filters - Filter options
 * @returns {Promise<Array>} Array of scores with listings
 */
export async function getAllLatest(filters = {}) {
  let sql = `
    SELECT DISTINCT ON (ls."listingId")
      ls.*,
      l.title,
      l.sku,
      l.asin,
      l.status
    FROM listing_scores ls
    INNER JOIN listings l ON ls."listingId" = l.id
    WHERE 1=1
  `;

  const params = [];
  let paramCount = 1;

  if (filters.minScore !== undefined) {
    sql += ` AND ls."totalScore" >= $${paramCount++}`;
    params.push(filters.minScore);
  }

  if (filters.maxScore !== undefined) {
    sql += ` AND ls."totalScore" <= $${paramCount++}`;
    params.push(filters.maxScore);
  }

  if (filters.status) {
    sql += ` AND l.status = $${paramCount++}`;
    params.push(filters.status);
  }

  sql += ` ORDER BY ls."listingId", ls."calculatedAt" DESC`;

  const result = await query(sql, params);
  return result.rows;
}

/**
 * Create a new score
 * @param {Object} data - Score data
 * @returns {Promise<Object>} Created score
 */
export async function create(data) {
  const sql = `
    INSERT INTO listing_scores (
      "listingId", "totalScore",
      "seoScore", "contentScore", "imageScore", "competitiveScore", "complianceScore",
      "seoViolations", "contentViolations", "imageViolations", "competitiveViolations", "complianceViolations",
      recommendations,
      "calculatedAt"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
    RETURNING *
  `;

  const result = await query(sql, [
    data.listingId,
    data.totalScore,
    data.seoScore || 0,
    data.contentScore || 0,
    data.imageScore || 0,
    data.competitiveScore || 0,
    data.complianceScore || 0,
    JSON.stringify(data.seoViolations || []),
    JSON.stringify(data.contentViolations || []),
    JSON.stringify(data.imageViolations || []),
    JSON.stringify(data.competitiveViolations || []),
    JSON.stringify(data.complianceViolations || []),
    JSON.stringify(data.recommendations || []),
  ]);

  return result.rows[0];
}

/**
 * Update a score
 * @param {string} id - Score ID
 * @param {Object} data - Updated data
 * @returns {Promise<Object>} Updated score
 */
export async function update(id, data) {
  const fields = [];
  const values = [];
  let paramCount = 1;

  const allowedFields = [
    'totalScore', 'seoScore', 'contentScore', 'imageScore',
    'competitiveScore', 'complianceScore'
  ];

  const jsonFields = [
    'seoViolations', 'contentViolations', 'imageViolations',
    'competitiveViolations', 'complianceViolations', 'recommendations'
  ];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      const dbField = field.includes('Score') ? `"${field}"` : field;
      fields.push(`${dbField} = $${paramCount++}`);
      values.push(data[field]);
    }
  }

  for (const field of jsonFields) {
    if (data[field] !== undefined) {
      fields.push(`"${field}" = $${paramCount++}`);
      values.push(JSON.stringify(data[field]));
    }
  }

  if (fields.length === 0) {
    return getById(id);
  }

  values.push(id);

  const sql = `
    UPDATE listing_scores
    SET ${fields.join(', ')}
    WHERE id = $${paramCount}
    RETURNING *
  `;

  const result = await query(sql, values);
  return result.rows[0];
}

/**
 * Get a score by ID
 * @param {string} id - Score ID
 * @returns {Promise<Object|null>} Score object or null
 */
export async function getById(id) {
  const sql = 'SELECT * FROM listing_scores WHERE id = $1';
  const result = await query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Delete old scores (keep only latest N per listing)
 * @param {number} keep - Number of scores to keep per listing
 * @returns {Promise<number>} Number of deleted records
 */
export async function pruneOldScores(keep = 30) {
  const sql = `
    DELETE FROM listing_scores
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
          ROW_NUMBER() OVER (PARTITION BY "listingId" ORDER BY "calculatedAt" DESC) as rn
        FROM listing_scores
      ) ranked
      WHERE rn > $1
    )
  `;

  const result = await query(sql, [keep]);
  return result.rowCount;
}

/**
 * Get score statistics
 * @returns {Promise<Object>} Score statistics
 */
export async function getStatistics() {
  const sql = `
    SELECT
      COUNT(DISTINCT "listingId") as total_listings,
      AVG("totalScore")::numeric(5,2) as avg_score,
      MIN("totalScore") as min_score,
      MAX("totalScore") as max_score,
      AVG("seoScore")::numeric(5,2) as avg_seo,
      AVG("contentScore")::numeric(5,2) as avg_content,
      AVG("imageScore")::numeric(5,2) as avg_image,
      AVG("competitiveScore")::numeric(5,2) as avg_competitive,
      AVG("complianceScore")::numeric(5,2) as avg_compliance
    FROM (
      SELECT DISTINCT ON ("listingId") *
      FROM listing_scores
      ORDER BY "listingId", "calculatedAt" DESC
    ) latest_scores
  `;

  const result = await query(sql);
  return result.rows[0];
}

/**
 * Get score distribution
 * @returns {Promise<Array>} Score distribution buckets
 */
export async function getDistribution() {
  const sql = `
    SELECT bucket, COUNT(*) as count
    FROM (
      SELECT
        CASE
          WHEN "totalScore" >= 90 THEN 'excellent'
          WHEN "totalScore" >= 70 THEN 'good'
          WHEN "totalScore" >= 50 THEN 'fair'
          ELSE 'poor'
        END as bucket
      FROM (
        SELECT DISTINCT ON ("listingId") *
        FROM listing_scores
        ORDER BY "listingId", "calculatedAt" DESC
      ) latest_scores
    ) bucketed_scores
    GROUP BY bucket
    ORDER BY
      CASE bucket
        WHEN 'excellent' THEN 1
        WHEN 'good' THEN 2
        WHEN 'fair' THEN 3
        ELSE 4
      END
  `;

  const result = await query(sql);
  return result.rows;
}

export default {
  getLatestByListingId,
  getHistoryByListingId,
  getAllLatest,
  getById,
  create,
  update,
  pruneOldScores,
  getStatistics,
  getDistribution,
};
