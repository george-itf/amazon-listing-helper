/**
 * Alert Repository
 * Handles all database operations for alerts
 */

import { query } from '../database/connection.js';

/**
 * Get all alerts with optional filters
 * @param {Object} filters - Filter options (read, severity, type)
 * @returns {Promise<Array>} Array of alerts
 */
export async function getAll(filters = {}) {
  let sql = `
    SELECT a.*, l.title as listing_title, l.sku as listing_sku
    FROM alerts a
    LEFT JOIN listings l ON a."listingId" = l.id
    WHERE 1=1
  `;

  const params = [];
  let paramCount = 1;

  if (filters.read !== undefined) {
    sql += ` AND a.read = $${paramCount++}`;
    params.push(filters.read);
  }

  if (filters.severity) {
    sql += ` AND a.severity = $${paramCount++}`;
    params.push(filters.severity);
  }

  if (filters.type) {
    sql += ` AND a.type = $${paramCount++}`;
    params.push(filters.type);
  }

  if (filters.listingId) {
    sql += ` AND a."listingId" = $${paramCount++}`;
    params.push(filters.listingId);
  }

  if (filters.dismissed !== undefined) {
    sql += ` AND a.dismissed = $${paramCount++}`;
    params.push(filters.dismissed);
  }

  sql += ` ORDER BY a."createdAt" DESC`;

  if (filters.limit) {
    sql += ` LIMIT $${paramCount++}`;
    params.push(filters.limit);
  }

  const result = await query(sql, params);
  return result.rows;
}

/**
 * Get unread alerts count
 * @returns {Promise<number>} Count of unread alerts
 */
export async function getUnreadCount() {
  const sql = `
    SELECT COUNT(*) as count
    FROM alerts
    WHERE read = false AND (dismissed = false OR dismissed IS NULL)
  `;

  const result = await query(sql);
  return parseInt(result.rows[0].count);
}

/**
 * Get an alert by ID
 * @param {string} id - Alert ID
 * @returns {Promise<Object|null>} Alert object or null
 */
export async function getById(id) {
  const sql = `
    SELECT a.*, l.title as listing_title, l.sku as listing_sku
    FROM alerts a
    LEFT JOIN listings l ON a."listingId" = l.id
    WHERE a.id = $1
  `;

  const result = await query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Create a new alert
 * @param {Object} data - Alert data
 * @returns {Promise<Object>} Created alert
 */
export async function create(data) {
  const sql = `
    INSERT INTO alerts (
      "listingId", type, severity, title, message,
      metadata, read, dismissed, "createdAt"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    RETURNING *
  `;

  const result = await query(sql, [
    data.listingId || null,
    data.type,
    data.severity || 'info',
    data.title,
    data.message || null,
    JSON.stringify(data.metadata || {}),
    false,
    false,
  ]);

  return result.rows[0];
}

/**
 * Mark an alert as read
 * @param {string} id - Alert ID
 * @returns {Promise<Object>} Updated alert
 */
export async function markAsRead(id) {
  const sql = `
    UPDATE alerts
    SET read = true, "readAt" = NOW()
    WHERE id = $1
    RETURNING *
  `;

  const result = await query(sql, [id]);
  return result.rows[0];
}

/**
 * Mark all alerts as read
 * @returns {Promise<number>} Number of updated alerts
 */
export async function markAllAsRead() {
  const sql = `
    UPDATE alerts
    SET read = true, "readAt" = NOW()
    WHERE read = false
  `;

  const result = await query(sql);
  return result.rowCount;
}

/**
 * Dismiss an alert
 * @param {string} id - Alert ID
 * @returns {Promise<Object>} Dismissed alert
 */
export async function dismiss(id) {
  const sql = `
    UPDATE alerts
    SET dismissed = true, "dismissedAt" = NOW()
    WHERE id = $1
    RETURNING *
  `;

  const result = await query(sql, [id]);
  return result.rows[0];
}

/**
 * Delete an alert
 * @param {string} id - Alert ID
 * @returns {Promise<boolean>} True if deleted
 */
export async function remove(id) {
  const result = await query('DELETE FROM alerts WHERE id = $1 RETURNING id', [id]);
  return result.rowCount > 0;
}

/**
 * Delete old alerts
 * @param {number} daysOld - Delete alerts older than this many days
 * @returns {Promise<number>} Number of deleted alerts
 */
export async function pruneOldAlerts(daysOld = 30) {
  const sql = `
    DELETE FROM alerts
    WHERE "createdAt" < NOW() - INTERVAL '${daysOld} days'
    AND dismissed = true
  `;

  const result = await query(sql);
  return result.rowCount;
}

/**
 * Get alerts grouped by type
 * @returns {Promise<Array>} Alerts grouped by type with counts
 */
export async function getGroupedByType() {
  const sql = `
    SELECT type, severity, COUNT(*) as count
    FROM alerts
    WHERE dismissed = false OR dismissed IS NULL
    GROUP BY type, severity
    ORDER BY
      CASE severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END,
      count DESC
  `;

  const result = await query(sql);
  return result.rows;
}

/**
 * Get alerts for a specific listing
 * @param {string} listingId - Listing ID
 * @returns {Promise<Array>} Alerts for the listing
 */
export async function getByListingId(listingId) {
  return getAll({ listingId });
}

export default {
  getAll,
  getUnreadCount,
  getById,
  create,
  markAsRead,
  markAllAsRead,
  dismiss,
  remove,
  pruneOldAlerts,
  getGroupedByType,
  getByListingId,
};
