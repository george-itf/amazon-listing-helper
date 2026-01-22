/**
 * Job Repository
 *
 * CRUD operations for jobs table.
 * Implements job lifecycle per DATA_CONTRACTS.md §10.
 *
 * @module JobRepository
 */

import { query, transaction } from '../database/connection.js';

/**
 * Create a new job
 * @param {Object} data
 * @param {string} data.job_type
 * @param {string} [data.scope_type='LISTING']
 * @param {number} [data.listing_id]
 * @param {number} [data.asin_entity_id]
 * @param {Object} [data.input_json]
 * @param {number} [data.priority=5]
 * @param {string} [data.created_by='system']
 * @returns {Promise<Object|null>}
 */
export async function create(data) {
  try {
    const result = await query(`
      INSERT INTO jobs (
        job_type, scope_type, listing_id, asin_entity_id,
        input_json, priority, created_by, scheduled_for
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, CURRENT_TIMESTAMP))
      RETURNING *
    `, [
      data.job_type,
      data.scope_type || 'LISTING',
      data.listing_id || null,
      data.asin_entity_id || null,
      data.input_json ? JSON.stringify(data.input_json) : null,
      data.priority || 5,
      data.created_by || 'system',
      data.scheduled_for || null,
    ]);

    return result.rows[0];
  } catch (error) {
    // Handle missing table or enum gracefully
    if (error.message?.includes('does not exist')) {
      console.warn('[Jobs] jobs table or enum does not exist');
      return null;
    }
    throw error;
  }
}

/**
 * Get job by ID
 * @param {number} jobId
 * @returns {Promise<Object|null>}
 */
export async function findById(jobId) {
  try {
    const result = await query(`
      SELECT j.*, l.seller_sku as listing_sku
      FROM jobs j
      LEFT JOIN listings l ON l.id = j.listing_id
      WHERE j.id = $1
    `, [jobId]);

    return result.rows[0] || null;
  } catch (error) {
    // Handle missing table gracefully
    if (error.message?.includes('does not exist')) {
      console.warn('[Jobs] jobs table does not exist');
      return null;
    }
    throw error;
  }
}

/**
 * Get pending jobs ready to execute
 * @param {number} limit
 * @returns {Promise<Object[]>}
 */
export async function getPendingJobs(limit = 10) {
  try {
    const result = await query(`
      SELECT j.*, l.seller_sku as listing_sku
      FROM jobs j
      LEFT JOIN listings l ON l.id = j.listing_id
      WHERE j.status = 'PENDING'
        AND j.scheduled_for <= CURRENT_TIMESTAMP
        AND j.attempts < j.max_attempts
      ORDER BY j.priority DESC, j.scheduled_for ASC
      LIMIT $1
      FOR UPDATE OF j SKIP LOCKED
    `, [limit]);

    return result.rows;
  } catch (error) {
    // Handle missing table gracefully
    if (error.message?.includes('does not exist')) {
      console.warn('[Jobs] jobs table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Claim a job for execution (atomic update to RUNNING)
 * @param {number} jobId
 * @returns {Promise<Object|null>}
 */
export async function claimJob(jobId) {
  const result = await query(`
    UPDATE jobs
    SET
      status = 'RUNNING',
      started_at = CURRENT_TIMESTAMP,
      attempts = attempts + 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
      AND status = 'PENDING'
    RETURNING *
  `, [jobId]);

  return result.rows[0] || null;
}

/**
 * Mark job as succeeded
 * @param {number} jobId
 * @param {Object} result - Job result data
 * @returns {Promise<Object|null>}
 */
export async function markSucceeded(jobId, resultData = {}) {
  const result = await query(`
    UPDATE jobs
    SET
      status = 'SUCCEEDED',
      finished_at = CURRENT_TIMESTAMP,
      result_json = $2,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
  `, [jobId, JSON.stringify(resultData)]);

  return result.rows[0] || null;
}

/**
 * Calculate exponential backoff with full jitter
 * A.3.3 FIX: Replaces linear backoff with exponential + jitter
 *
 * Formula: min(MAX_BACKOFF, BASE * 2^attempt) * random(0.5, 1.5)
 *
 * @param {number} attempt - Current attempt number (1-based)
 * @returns {number} Backoff time in seconds
 */
function computeBackoffSeconds(attempt) {
  const BASE_SECONDS = 30;      // 30 seconds base
  const MAX_SECONDS = 3600;     // 1 hour max
  const JITTER_FACTOR = 0.5;    // ±50% jitter

  // Exponential: BASE * 2^(attempt-1)
  // attempt 1: 30s, attempt 2: 60s, attempt 3: 120s, etc.
  const exponentialBackoff = Math.min(MAX_SECONDS, BASE_SECONDS * Math.pow(2, attempt - 1));

  // Add jitter: random between 0.5x and 1.5x
  const jitter = 1 - JITTER_FACTOR + (Math.random() * JITTER_FACTOR * 2);

  return Math.round(exponentialBackoff * jitter);
}

/**
 * Mark job as failed
 *
 * A.3.3 FIX: Now uses exponential backoff with jitter instead of linear
 *
 * @param {number} jobId
 * @param {string} errorMessage
 * @param {Object} [logEntry]
 * @returns {Promise<Object|null>}
 */
export async function markFailed(jobId, errorMessage, logEntry = null) {
  // Get current job to append to log
  const current = await findById(jobId);
  if (!current) return null;

  const logs = current.log_json || [];
  if (logEntry) {
    logs.push({
      ...logEntry,
      timestamp: new Date().toISOString(),
    });
  }

  // A.3.3 FIX: Calculate exponential backoff with jitter
  const backoffSeconds = computeBackoffSeconds(current.attempts);

  const result = await query(`
    UPDATE jobs
    SET
      status = CASE
        WHEN attempts >= max_attempts THEN 'FAILED'::job_status
        ELSE 'PENDING'::job_status
      END,
      finished_at = CASE
        WHEN attempts >= max_attempts THEN CURRENT_TIMESTAMP
        ELSE NULL
      END,
      error_message = $2,
      log_json = $3,
      scheduled_for = CASE
        WHEN attempts < max_attempts THEN CURRENT_TIMESTAMP + ($4 * INTERVAL '1 second')
        ELSE scheduled_for
      END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
  `, [jobId, errorMessage, JSON.stringify(logs), backoffSeconds]);

  return result.rows[0] || null;
}

/**
 * Cancel a job
 * @param {number} jobId
 * @returns {Promise<boolean>}
 */
export async function cancel(jobId) {
  const result = await query(`
    UPDATE jobs
    SET
      status = 'CANCELLED',
      finished_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
      AND status IN ('PENDING', 'RUNNING')
    RETURNING id
  `, [jobId]);

  return result.rows.length > 0;
}

/**
 * Append log entry to job
 * @param {number} jobId
 * @param {Object} logEntry
 * @returns {Promise<void>}
 */
export async function appendLog(jobId, logEntry) {
  await query(`
    UPDATE jobs
    SET
      log_json = COALESCE(log_json, '[]'::jsonb) || $2::jsonb,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
  `, [jobId, JSON.stringify([{
    ...logEntry,
    timestamp: new Date().toISOString(),
  }])]);
}

/**
 * Get jobs by listing
 * @param {number} listingId
 * @param {Object} [options]
 * @param {string[]} [options.types]
 * @param {string[]} [options.statuses]
 * @param {number} [options.limit=20]
 * @returns {Promise<Object[]>}
 */
export async function findByListing(listingId, options = {}) {
  const { types, statuses, limit = 20 } = options;
  const params = [listingId];
  let whereClause = 'WHERE j.listing_id = $1';
  let paramIndex = 2;

  if (types && types.length > 0) {
    whereClause += ` AND j.job_type = ANY($${paramIndex}::job_type[])`;
    params.push(types);
    paramIndex++;
  }

  if (statuses && statuses.length > 0) {
    whereClause += ` AND j.status = ANY($${paramIndex}::job_status[])`;
    params.push(statuses);
    paramIndex++;
  }

  params.push(limit);

  const result = await query(`
    SELECT j.*
    FROM jobs j
    ${whereClause}
    ORDER BY j.created_at DESC
    LIMIT $${paramIndex}
  `, params);

  return result.rows;
}

/**
 * Get recent jobs with optional filters
 * @param {Object} options
 * @param {string[]} [options.types]
 * @param {string[]} [options.statuses]
 * @param {number} [options.limit=50]
 * @param {number} [options.offset=0]
 * @returns {Promise<Object[]>}
 */
export async function findRecent(options = {}) {
  try {
    const { types, statuses, limit = 50, offset = 0 } = options;
    const params = [];
    const conditions = [];
    let paramIndex = 1;

    if (types && types.length > 0) {
      conditions.push(`j.job_type = ANY($${paramIndex}::job_type[])`);
      params.push(types);
      paramIndex++;
    }

    if (statuses && statuses.length > 0) {
      conditions.push(`j.status = ANY($${paramIndex}::job_status[])`);
      params.push(statuses);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit, offset);

    const result = await query(`
      SELECT j.*, l.seller_sku as listing_sku
      FROM jobs j
      LEFT JOIN listings l ON l.id = j.listing_id
      ${whereClause}
      ORDER BY j.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, params);

    return result.rows;
  } catch (error) {
    // Handle missing table gracefully
    if (error.message?.includes('does not exist')) {
      console.warn('[Jobs] jobs table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Count jobs by status
 * @returns {Promise<Object>}
 */
export async function countByStatus() {
  const defaultCounts = {
    PENDING: 0,
    RUNNING: 0,
    SUCCEEDED: 0,
    FAILED: 0,
    CANCELLED: 0,
  };

  try {
    const result = await query(`
      SELECT status, COUNT(*) as count
      FROM jobs
      GROUP BY status
    `);

    const counts = { ...defaultCounts };

    for (const row of result.rows) {
      counts[row.status] = parseInt(row.count, 10);
    }

    return counts;
  } catch (error) {
    // Handle missing table gracefully
    if (error.message?.includes('does not exist')) {
      console.warn('[Jobs] jobs table does not exist');
      return defaultCounts;
    }
    throw error;
  }
}

export default {
  create,
  findById,
  getPendingJobs,
  claimJob,
  markSucceeded,
  markFailed,
  cancel,
  appendLog,
  findByListing,
  findRecent,
  countByStatus,
};
