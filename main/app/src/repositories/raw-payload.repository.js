/**
 * Raw Payload Repository
 *
 * CRUD operations for raw_payloads table.
 * This table is write-only except for transform workers.
 *
 * Per canonical ASIN data model specification:
 * - Immutable landing zone for exact raw responses from external APIs
 * - One row per (asin, source, ingestion_job_id)
 * - Sources: keepa, sp_api
 * - Store entire JSON payload unmodified
 *
 * @module RawPayloadRepository
 */

import { query, transaction } from '../database/connection.js';

/**
 * Insert a raw payload (write-only operation)
 *
 * @param {Object} data
 * @param {string} data.asin - ASIN
 * @param {number} data.marketplace_id - Marketplace ID
 * @param {string} data.source - Data source ('keepa' or 'sp_api')
 * @param {string} data.ingestion_job_id - UUID of the ingestion job
 * @param {Object} data.payload - Raw JSON payload from API
 * @returns {Promise<Object|null>} Created row or null if table doesn't exist
 */
export async function insert(data) {
  try {
    const result = await query(`
      INSERT INTO raw_payloads (asin, marketplace_id, source, ingestion_job_id, payload, captured_at)
      VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_TIMESTAMP))
      RETURNING *
    `, [
      data.asin,
      data.marketplace_id,
      data.source,
      data.ingestion_job_id,
      JSON.stringify(data.payload),
      data.captured_at || null,
    ]);

    return result.rows[0];
  } catch (error) {
    // Handle missing table gracefully
    if (error.message?.includes('does not exist')) {
      console.warn('[RawPayload] raw_payloads table does not exist');
      return null;
    }
    // Handle unique constraint violation (idempotent)
    if (error.message?.includes('raw_payloads_unique')) {
      console.warn('[RawPayload] Payload already exists for this ASIN/source/job');
      return null;
    }
    throw error;
  }
}

/**
 * Bulk insert raw payloads (efficient for batch operations)
 *
 * @param {Array<Object>} payloads - Array of payload data
 * @returns {Promise<{inserted: number, skipped: number}>}
 */
export async function bulkInsert(payloads) {
  if (!payloads || payloads.length === 0) {
    return { inserted: 0, skipped: 0 };
  }

  try {
    // Prepare arrays for UNNEST
    const asins = [];
    const marketplaceIds = [];
    const sources = [];
    const ingestionJobIds = [];
    const payloadJsons = [];
    const capturedAts = [];

    for (const p of payloads) {
      asins.push(p.asin);
      marketplaceIds.push(p.marketplace_id);
      sources.push(p.source);
      ingestionJobIds.push(p.ingestion_job_id);
      payloadJsons.push(JSON.stringify(p.payload));
      capturedAts.push(p.captured_at || new Date());
    }

    const result = await query(`
      INSERT INTO raw_payloads (asin, marketplace_id, source, ingestion_job_id, payload, captured_at)
      SELECT * FROM UNNEST(
        $1::text[], $2::integer[], $3::text[], $4::uuid[], $5::jsonb[], $6::timestamp[]
      ) AS t(asin, marketplace_id, source, ingestion_job_id, payload, captured_at)
      ON CONFLICT (asin, marketplace_id, source, ingestion_job_id) DO NOTHING
      RETURNING id
    `, [asins, marketplaceIds, sources, ingestionJobIds, payloadJsons, capturedAts]);

    const inserted = result.rows.length;
    const skipped = payloads.length - inserted;

    return { inserted, skipped };
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[RawPayload] raw_payloads table does not exist');
      return { inserted: 0, skipped: payloads.length };
    }
    throw error;
  }
}

/**
 * Get raw payloads by ingestion job ID and ASIN
 * Used by transform worker to get all raw data for a single ASIN
 *
 * @param {string} ingestionJobId - UUID of the ingestion job
 * @param {string} asin - ASIN
 * @param {number} marketplaceId - Marketplace ID
 * @returns {Promise<Object[]>} Array of raw payloads
 */
export async function getByJobAndAsin(ingestionJobId, asin, marketplaceId) {
  try {
    const result = await query(`
      SELECT * FROM raw_payloads
      WHERE ingestion_job_id = $1 AND asin = $2 AND marketplace_id = $3
      ORDER BY source
    `, [ingestionJobId, asin, marketplaceId]);

    return result.rows;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[RawPayload] raw_payloads table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Get all unique ASINs for an ingestion job
 * Used by transform worker to iterate over all ASINs
 *
 * @param {string} ingestionJobId - UUID of the ingestion job
 * @returns {Promise<Array<{asin: string, marketplace_id: number}>>}
 */
export async function getDistinctAsinsForJob(ingestionJobId) {
  try {
    const result = await query(`
      SELECT DISTINCT asin, marketplace_id
      FROM raw_payloads
      WHERE ingestion_job_id = $1
      ORDER BY asin
    `, [ingestionJobId]);

    return result.rows;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[RawPayload] raw_payloads table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Get latest raw payload for an ASIN by source
 *
 * @param {string} asin - ASIN
 * @param {number} marketplaceId - Marketplace ID
 * @param {string} source - Data source ('keepa' or 'sp_api')
 * @returns {Promise<Object|null>}
 */
export async function getLatestByAsinAndSource(asin, marketplaceId, source) {
  try {
    const result = await query(`
      SELECT * FROM raw_payloads
      WHERE asin = $1 AND marketplace_id = $2 AND source = $3
      ORDER BY captured_at DESC
      LIMIT 1
    `, [asin, marketplaceId, source]);

    return result.rows[0] || null;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[RawPayload] raw_payloads table does not exist');
      return null;
    }
    throw error;
  }
}

/**
 * Count raw payloads by ingestion job
 *
 * @param {string} ingestionJobId - UUID of the ingestion job
 * @returns {Promise<{total: number, by_source: Object}>}
 */
export async function countByJob(ingestionJobId) {
  try {
    const result = await query(`
      SELECT source, COUNT(*) as count
      FROM raw_payloads
      WHERE ingestion_job_id = $1
      GROUP BY source
    `, [ingestionJobId]);

    const bySource = {};
    let total = 0;
    for (const row of result.rows) {
      bySource[row.source] = parseInt(row.count, 10);
      total += parseInt(row.count, 10);
    }

    return { total, by_source: bySource };
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[RawPayload] raw_payloads table does not exist');
      return { total: 0, by_source: {} };
    }
    throw error;
  }
}

/**
 * Delete old raw payloads (for cleanup jobs)
 * Keeps only the last N days of raw data
 *
 * @param {number} retentionDays - Number of days to retain
 * @returns {Promise<number>} Number of deleted rows
 */
export async function deleteOlderThan(retentionDays) {
  try {
    const result = await query(`
      DELETE FROM raw_payloads
      WHERE captured_at < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day')
      RETURNING id
    `, [retentionDays]);

    return result.rowCount;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[RawPayload] raw_payloads table does not exist');
      return 0;
    }
    throw error;
  }
}

export default {
  insert,
  bulkInsert,
  getByJobAndAsin,
  getDistinctAsinsForJob,
  getLatestByAsinAndSource,
  countByJob,
  deleteOlderThan,
};
