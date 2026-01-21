/**
 * Listing Event Repository
 *
 * Audit trail for all listing-related changes.
 * Per SPEC §4.15 and DATA_CONTRACTS.md.
 *
 * @module ListingEventRepository
 */

import { query } from '../database/connection.js';

/**
 * Create a listing event
 * @param {Object} data
 * @param {number} data.listing_id
 * @param {string} data.event_type
 * @param {number} [data.job_id]
 * @param {Object} [data.before_json]
 * @param {Object} [data.after_json]
 * @param {string} [data.reason]
 * @param {string} [data.correlation_id]
 * @param {string} [data.created_by='system']
 * @returns {Promise<Object>}
 */
export async function create(data) {
  const result = await query(`
    INSERT INTO listing_events (
      listing_id, event_type, job_id,
      before_json, after_json, reason,
      correlation_id, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [
    data.listing_id,
    data.event_type,
    data.job_id || null,
    data.before_json ? JSON.stringify(data.before_json) : null,
    data.after_json ? JSON.stringify(data.after_json) : null,
    data.reason || null,
    data.correlation_id || null,
    data.created_by || 'system',
  ]);

  return result.rows[0];
}

/**
 * Get events by listing
 * @param {number} listingId
 * @param {Object} [options]
 * @param {string[]} [options.types] - Filter by event types
 * @param {number} [options.limit=50]
 * @param {number} [options.offset=0]
 * @returns {Promise<Object[]>}
 */
export async function findByListing(listingId, options = {}) {
  const { types, limit = 50, offset = 0 } = options;
  const params = [listingId];
  let whereClause = 'WHERE le.listing_id = $1';
  let paramIndex = 2;

  if (types && types.length > 0) {
    whereClause += ` AND le.event_type = ANY($${paramIndex}::listing_event_type[])`;
    params.push(types);
    paramIndex++;
  }

  params.push(limit, offset);

  const result = await query(`
    SELECT le.*, j.status as job_status, j.job_type
    FROM listing_events le
    LEFT JOIN jobs j ON j.id = le.job_id
    ${whereClause}
    ORDER BY le.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `, params);

  return result.rows;
}

/**
 * Get event by ID
 * @param {number} eventId
 * @returns {Promise<Object|null>}
 */
export async function findById(eventId) {
  const result = await query(`
    SELECT le.*, j.status as job_status, j.job_type
    FROM listing_events le
    LEFT JOIN jobs j ON j.id = le.job_id
    WHERE le.id = $1
  `, [eventId]);

  return result.rows[0] || null;
}

/**
 * Get events by job
 * @param {number} jobId
 * @returns {Promise<Object[]>}
 */
export async function findByJob(jobId) {
  const result = await query(`
    SELECT * FROM listing_events
    WHERE job_id = $1
    ORDER BY created_at ASC
  `, [jobId]);

  return result.rows;
}

/**
 * Get recent events across all listings
 * @param {Object} [options]
 * @param {string[]} [options.types]
 * @param {number} [options.limit=100]
 * @returns {Promise<Object[]>}
 */
export async function findRecent(options = {}) {
  const { types, limit = 100 } = options;
  const params = [];
  let whereClause = '';
  let paramIndex = 1;

  if (types && types.length > 0) {
    whereClause = `WHERE le.event_type = ANY($${paramIndex}::listing_event_type[])`;
    params.push(types);
    paramIndex++;
  }

  params.push(limit);

  const result = await query(`
    SELECT le.*, l.seller_sku, l.title as listing_title,
           j.status as job_status, j.job_type
    FROM listing_events le
    JOIN listings l ON l.id = le.listing_id
    LEFT JOIN jobs j ON j.id = le.job_id
    ${whereClause}
    ORDER BY le.created_at DESC
    LIMIT $${paramIndex}
  `, params);

  return result.rows;
}

/**
 * Get price change history for a listing
 * @param {number} listingId
 * @param {number} limit
 * @returns {Promise<Object[]>}
 */
export async function getPriceHistory(listingId, limit = 20) {
  const result = await query(`
    SELECT * FROM listing_events
    WHERE listing_id = $1
      AND event_type IN (
        'PRICE_CHANGE_DRAFTED',
        'PRICE_CHANGE_PUBLISHED',
        'PRICE_CHANGE_SUCCEEDED',
        'PRICE_CHANGE_FAILED'
      )
    ORDER BY created_at DESC
    LIMIT $2
  `, [listingId, limit]);

  return result.rows;
}

/**
 * Get stock change history for a listing
 * @param {number} listingId
 * @param {number} limit
 * @returns {Promise<Object[]>}
 */
export async function getStockHistory(listingId, limit = 20) {
  const result = await query(`
    SELECT * FROM listing_events
    WHERE listing_id = $1
      AND event_type IN (
        'STOCK_CHANGE_DRAFTED',
        'STOCK_CHANGE_PUBLISHED',
        'STOCK_CHANGE_SUCCEEDED',
        'STOCK_CHANGE_FAILED'
      )
    ORDER BY created_at DESC
    LIMIT $2
  `, [listingId, limit]);

  return result.rows;
}

export default {
  create,
  findByListing,
  findById,
  findByJob,
  findRecent,
  getPriceHistory,
  getStockHistory,
};
