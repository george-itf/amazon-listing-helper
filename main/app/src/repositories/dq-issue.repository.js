/**
 * DQ (Data Quality) Issue Repository
 *
 * CRUD operations for dq_issues table.
 * Tracks data quality problems for visibility and remediation.
 *
 * Per canonical ASIN data model specification:
 * - Insert rows when required fields missing
 * - Insert rows when values are impossible (negative stock, zero price)
 * - Insert rows when data is stale (e.g., Keepa not updated > 72h)
 * - Severity: WARN or CRITICAL
 *
 * @module DqIssueRepository
 */

import { query, transaction } from '../database/connection.js';

/**
 * DQ Issue types
 */
export const DQ_ISSUE_TYPE = {
  MISSING_FIELD: 'MISSING_FIELD',           // Required field is null/empty
  INVALID_VALUE: 'INVALID_VALUE',           // Value is impossible (negative, etc.)
  STALE_DATA: 'STALE_DATA',                 // Data hasn't been updated recently
  INCONSISTENT_DATA: 'INCONSISTENT_DATA',   // Values don't match across sources
  TRANSFORM_ERROR: 'TRANSFORM_ERROR',       // Error during transformation
  API_ERROR: 'API_ERROR',                   // Error fetching from API
  DUPLICATE_DATA: 'DUPLICATE_DATA',         // Unexpected duplicates
  OUT_OF_RANGE: 'OUT_OF_RANGE',             // Value outside expected bounds
};

/**
 * DQ Severity levels
 */
export const DQ_SEVERITY = {
  WARN: 'WARN',
  CRITICAL: 'CRITICAL',
};

/**
 * DQ Status values
 */
export const DQ_STATUS = {
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESOLVED: 'RESOLVED',
  IGNORED: 'IGNORED',
};

/**
 * Create a new DQ issue
 *
 * @param {Object} data
 * @param {string} data.asin - ASIN
 * @param {number} data.marketplace_id - Marketplace ID
 * @param {number} [data.asin_entity_id] - ASIN entity ID
 * @param {string} [data.ingestion_job_id] - Ingestion job UUID
 * @param {number} [data.snapshot_id] - Snapshot ID
 * @param {string} data.issue_type - Type of issue
 * @param {string} [data.field_name] - Field with the issue
 * @param {string} data.severity - 'WARN' or 'CRITICAL'
 * @param {string} data.message - Human-readable description
 * @param {Object} [data.details] - Additional context
 * @returns {Promise<Object|null>}
 */
export async function create(data) {
  try {
    const result = await query(`
      INSERT INTO dq_issues (
        asin, marketplace_id, asin_entity_id, ingestion_job_id, snapshot_id,
        issue_type, field_name, severity, status, message, details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'OPEN', $9, $10)
      RETURNING *
    `, [
      data.asin,
      data.marketplace_id,
      data.asin_entity_id || null,
      data.ingestion_job_id || null,
      data.snapshot_id || null,
      data.issue_type,
      data.field_name || null,
      data.severity || DQ_SEVERITY.WARN,
      data.message,
      data.details ? JSON.stringify(data.details) : null,
    ]);

    return result.rows[0];
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[DqIssue] dq_issues table does not exist');
      return null;
    }
    throw error;
  }
}

/**
 * Bulk create DQ issues
 *
 * @param {Array<Object>} issues - Array of issue data
 * @returns {Promise<{inserted: number}>}
 */
export async function bulkCreate(issues) {
  if (!issues || issues.length === 0) {
    return { inserted: 0 };
  }

  try {
    const asins = [];
    const marketplaceIds = [];
    const asinEntityIds = [];
    const ingestionJobIds = [];
    const snapshotIds = [];
    const issueTypes = [];
    const fieldNames = [];
    const severities = [];
    const messages = [];
    const details = [];

    for (const issue of issues) {
      asins.push(issue.asin);
      marketplaceIds.push(issue.marketplace_id);
      asinEntityIds.push(issue.asin_entity_id || null);
      ingestionJobIds.push(issue.ingestion_job_id || null);
      snapshotIds.push(issue.snapshot_id || null);
      issueTypes.push(issue.issue_type);
      fieldNames.push(issue.field_name || null);
      severities.push(issue.severity || DQ_SEVERITY.WARN);
      messages.push(issue.message);
      details.push(issue.details ? JSON.stringify(issue.details) : null);
    }

    const result = await query(`
      INSERT INTO dq_issues (
        asin, marketplace_id, asin_entity_id, ingestion_job_id, snapshot_id,
        issue_type, field_name, severity, status, message, details
      )
      SELECT
        asin, marketplace_id, asin_entity_id, ingestion_job_id, snapshot_id,
        issue_type, field_name, severity, 'OPEN'::dq_status, message, details
      FROM UNNEST(
        $1::text[], $2::integer[], $3::integer[], $4::uuid[], $5::integer[],
        $6::text[], $7::text[], $8::dq_severity[],
        $9::text[], $10::jsonb[]
      ) AS t(
        asin, marketplace_id, asin_entity_id, ingestion_job_id, snapshot_id,
        issue_type, field_name, severity, message, details
      )
      RETURNING id
    `, [
      asins, marketplaceIds, asinEntityIds, ingestionJobIds, snapshotIds,
      issueTypes, fieldNames, severities, messages, details,
    ]);

    return { inserted: result.rows.length };
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[DqIssue] dq_issues table does not exist');
      return { inserted: 0 };
    }
    throw error;
  }
}

/**
 * Get DQ issue by ID
 *
 * @param {number} issueId - Issue ID
 * @returns {Promise<Object|null>}
 */
export async function getById(issueId) {
  try {
    const result = await query(`
      SELECT * FROM dq_issues WHERE id = $1
    `, [issueId]);

    return result.rows[0] || null;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[DqIssue] dq_issues table does not exist');
      return null;
    }
    throw error;
  }
}

/**
 * Get open DQ issues for an ASIN
 *
 * @param {string} asin - ASIN
 * @param {number} marketplaceId - Marketplace ID
 * @returns {Promise<Object[]>}
 */
export async function getOpenByAsin(asin, marketplaceId) {
  try {
    const result = await query(`
      SELECT * FROM dq_issues
      WHERE asin = $1 AND marketplace_id = $2 AND status = 'OPEN'
      ORDER BY severity DESC, detected_at DESC
    `, [asin, marketplaceId]);

    return result.rows;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[DqIssue] dq_issues table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Get all open issues with filters
 *
 * @param {Object} [filters] - Filter options
 * @param {string} [filters.severity] - Filter by severity
 * @param {string} [filters.issue_type] - Filter by issue type
 * @param {number} [filters.marketplace_id] - Filter by marketplace
 * @param {number} [filters.limit=100] - Maximum results
 * @param {number} [filters.offset=0] - Offset for pagination
 * @returns {Promise<Object[]>}
 */
export async function getOpen(filters = {}) {
  try {
    const params = [];
    const conditions = ["status = 'OPEN'"];
    let paramIndex = 1;

    if (filters.severity) {
      conditions.push(`severity = $${paramIndex++}`);
      params.push(filters.severity);
    }

    if (filters.issue_type) {
      conditions.push(`issue_type = $${paramIndex++}`);
      params.push(filters.issue_type);
    }

    if (filters.marketplace_id) {
      conditions.push(`marketplace_id = $${paramIndex++}`);
      params.push(filters.marketplace_id);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const limit = filters.limit || 100;
    const offset = filters.offset || 0;

    params.push(limit, offset);

    const result = await query(`
      SELECT * FROM dq_issues
      ${whereClause}
      ORDER BY severity DESC, detected_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `, params);

    return result.rows;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[DqIssue] dq_issues table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Get critical open issues
 *
 * @param {number} [limit=50] - Maximum results
 * @returns {Promise<Object[]>}
 */
export async function getCriticalOpen(limit = 50) {
  try {
    const result = await query(`
      SELECT * FROM dq_issues
      WHERE severity = 'CRITICAL' AND status = 'OPEN'
      ORDER BY detected_at DESC
      LIMIT $1
    `, [limit]);

    return result.rows;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[DqIssue] dq_issues table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Acknowledge an issue
 *
 * @param {number} issueId - Issue ID
 * @param {string} acknowledgedBy - Who acknowledged it
 * @returns {Promise<Object|null>}
 */
export async function acknowledge(issueId, acknowledgedBy) {
  try {
    const result = await query(`
      UPDATE dq_issues
      SET status = 'ACKNOWLEDGED',
          acknowledged_at = CURRENT_TIMESTAMP,
          acknowledged_by = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [issueId, acknowledgedBy]);

    return result.rows[0] || null;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[DqIssue] dq_issues table does not exist');
      return null;
    }
    throw error;
  }
}

/**
 * Resolve an issue
 *
 * @param {number} issueId - Issue ID
 * @param {string} [resolutionNotes] - Notes about resolution
 * @returns {Promise<Object|null>}
 */
export async function resolve(issueId, resolutionNotes = null) {
  try {
    const result = await query(`
      UPDATE dq_issues
      SET status = 'RESOLVED',
          resolved_at = CURRENT_TIMESTAMP,
          resolution_notes = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [issueId, resolutionNotes]);

    return result.rows[0] || null;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[DqIssue] dq_issues table does not exist');
      return null;
    }
    throw error;
  }
}

/**
 * Ignore an issue
 *
 * @param {number} issueId - Issue ID
 * @param {string} [resolutionNotes] - Reason for ignoring
 * @returns {Promise<Object|null>}
 */
export async function ignore(issueId, resolutionNotes = null) {
  try {
    const result = await query(`
      UPDATE dq_issues
      SET status = 'IGNORED',
          resolved_at = CURRENT_TIMESTAMP,
          resolution_notes = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [issueId, resolutionNotes]);

    return result.rows[0] || null;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[DqIssue] dq_issues table does not exist');
      return null;
    }
    throw error;
  }
}

/**
 * Auto-resolve issues for an ASIN when data is fixed
 * Used by transform worker after successful data refresh
 *
 * @param {string} asin - ASIN
 * @param {number} marketplaceId - Marketplace ID
 * @param {string[]} [issueTypes] - Types of issues to resolve (optional, all if not specified)
 * @returns {Promise<number>} Number of resolved issues
 */
export async function autoResolve(asin, marketplaceId, issueTypes = null) {
  try {
    let sql = `
      UPDATE dq_issues
      SET status = 'RESOLVED',
          resolved_at = CURRENT_TIMESTAMP,
          resolution_notes = 'Auto-resolved after successful data refresh',
          updated_at = CURRENT_TIMESTAMP
      WHERE asin = $1 AND marketplace_id = $2 AND status = 'OPEN'
    `;

    const params = [asin, marketplaceId];

    if (issueTypes && issueTypes.length > 0) {
      sql += ` AND issue_type = ANY($3)`;
      params.push(issueTypes);
    }

    sql += ' RETURNING id';

    const result = await query(sql, params);
    return result.rowCount;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[DqIssue] dq_issues table does not exist');
      return 0;
    }
    throw error;
  }
}

/**
 * Get issue counts by status and severity
 *
 * @param {number} [marketplaceId] - Filter by marketplace (optional)
 * @returns {Promise<Object>}
 */
export async function getCounts(marketplaceId = null) {
  try {
    let sql = `
      SELECT
        status,
        severity,
        COUNT(*) as count
      FROM dq_issues
    `;

    const params = [];
    if (marketplaceId) {
      sql += ' WHERE marketplace_id = $1';
      params.push(marketplaceId);
    }

    sql += ' GROUP BY status, severity';

    const result = await query(sql, params);

    const counts = {
      total: 0,
      by_status: { OPEN: 0, ACKNOWLEDGED: 0, RESOLVED: 0, IGNORED: 0 },
      by_severity: { WARN: 0, CRITICAL: 0 },
      critical_open: 0,
    };

    for (const row of result.rows) {
      const count = parseInt(row.count, 10);
      counts.total += count;
      counts.by_status[row.status] = (counts.by_status[row.status] || 0) + count;
      counts.by_severity[row.severity] = (counts.by_severity[row.severity] || 0) + count;

      if (row.status === 'OPEN' && row.severity === 'CRITICAL') {
        counts.critical_open = count;
      }
    }

    return counts;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[DqIssue] dq_issues table does not exist');
      return {
        total: 0,
        by_status: { OPEN: 0, ACKNOWLEDGED: 0, RESOLVED: 0, IGNORED: 0 },
        by_severity: { WARN: 0, CRITICAL: 0 },
        critical_open: 0,
      };
    }
    throw error;
  }
}

/**
 * Get issues by ingestion job
 *
 * @param {string} ingestionJobId - Ingestion job UUID
 * @returns {Promise<Object[]>}
 */
export async function getByIngestionJob(ingestionJobId) {
  try {
    const result = await query(`
      SELECT * FROM dq_issues
      WHERE ingestion_job_id = $1
      ORDER BY severity DESC, detected_at DESC
    `, [ingestionJobId]);

    return result.rows;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.warn('[DqIssue] dq_issues table does not exist');
      return [];
    }
    throw error;
  }
}

export default {
  DQ_ISSUE_TYPE,
  DQ_SEVERITY,
  DQ_STATUS,
  create,
  bulkCreate,
  getById,
  getOpenByAsin,
  getOpen,
  getCriticalOpen,
  acknowledge,
  resolve,
  ignore,
  autoResolve,
  getCounts,
  getByIngestionJob,
};
