/**
 * Task Repository
 * Handles all database operations for tasks (Kanban board)
 */

import { query } from '../database/connection.js';

/**
 * Get all tasks with optional filters
 * @param {Object} filters - Filter options (stage, priority, archived)
 * @returns {Promise<Array>} Array of tasks
 */
export async function getAll(filters = {}) {
  let sql = `
    SELECT
      t.*,
      l.title as listing_title,
      l.sku as listing_sku
    FROM tasks t
    LEFT JOIN listings l ON t."listingId" = l.id
    WHERE 1=1
  `;

  const params = [];
  let paramCount = 1;

  // Default to non-archived
  if (filters.archived === undefined) {
    sql += ` AND (t.archived = false OR t.archived IS NULL)`;
  } else if (filters.archived === true) {
    sql += ` AND t.archived = true`;
  }

  if (filters.stage) {
    sql += ` AND t.stage = $${paramCount++}`;
    params.push(filters.stage);
  }

  if (filters.priority) {
    sql += ` AND t.priority = $${paramCount++}`;
    params.push(filters.priority);
  }

  if (filters.listingId) {
    sql += ` AND t."listingId" = $${paramCount++}`;
    params.push(filters.listingId);
  }

  if (filters.type) {
    sql += ` AND t.type = $${paramCount++}`;
    params.push(filters.type);
  }

  if (filters.assignedTo) {
    sql += ` AND t."assignedTo" = $${paramCount++}`;
    params.push(filters.assignedTo);
  }

  sql += ` ORDER BY
    CASE t.priority
      WHEN 'critical' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
    END,
    t."createdAt" DESC
  `;

  if (filters.limit) {
    sql += ` LIMIT $${paramCount++}`;
    params.push(filters.limit);
  }

  const result = await query(sql, params);
  return result.rows;
}

/**
 * Get a task by ID
 * @param {string} id - Task ID
 * @returns {Promise<Object|null>} Task object or null
 */
export async function getById(id) {
  const sql = `
    SELECT
      t.*,
      l.title as listing_title,
      l.sku as listing_sku
    FROM tasks t
    LEFT JOIN listings l ON t."listingId" = l.id
    WHERE t.id = $1
  `;

  const result = await query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Create a new task
 * @param {Object} data - Task data
 * @returns {Promise<Object>} Created task
 */
export async function create(data) {
  const sql = `
    INSERT INTO tasks (
      "listingId", title, description, type, priority, stage,
      "dueDate", "assignedTo", tags, metadata,
      "createdAt", "updatedAt"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
    RETURNING *
  `;

  const result = await query(sql, [
    data.listingId || null,
    data.title,
    data.description || null,
    data.type || 'manual',
    data.priority || 'medium',
    data.stage || 'backlog',
    data.dueDate || null,
    data.assignedTo || null,
    JSON.stringify(data.tags || []),
    JSON.stringify(data.metadata || {}),
  ]);

  return result.rows[0];
}

/**
 * Update a task
 * @param {string} id - Task ID
 * @param {Object} data - Updated data
 * @returns {Promise<Object>} Updated task
 */
export async function update(id, data) {
  const fields = [];
  const values = [];
  let paramCount = 1;

  const allowedFields = [
    'listingId', 'title', 'description', 'type', 'priority',
    'stage', 'dueDate', 'assignedTo', 'archived', 'completedAt'
  ];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      const dbField = ['listingId', 'dueDate', 'assignedTo', 'completedAt'].includes(field)
        ? `"${field}"`
        : field;
      fields.push(`${dbField} = $${paramCount++}`);
      values.push(data[field]);
    }
  }

  // Handle JSON fields
  if (data.tags !== undefined) {
    fields.push(`tags = $${paramCount++}`);
    values.push(JSON.stringify(data.tags));
  }

  if (data.metadata !== undefined) {
    fields.push(`metadata = $${paramCount++}`);
    values.push(JSON.stringify(data.metadata));
  }

  if (fields.length === 0) {
    return getById(id);
  }

  fields.push(`"updatedAt" = NOW()`);
  values.push(id);

  const sql = `
    UPDATE tasks
    SET ${fields.join(', ')}
    WHERE id = $${paramCount}
    RETURNING *
  `;

  const result = await query(sql, values);
  return result.rows[0];
}

/**
 * Move task to a different stage
 * @param {string} id - Task ID
 * @param {string} stage - New stage
 * @returns {Promise<Object>} Updated task
 */
export async function moveToStage(id, stage) {
  const completedAt = stage === 'done' ? 'NOW()' : 'NULL';

  const sql = `
    UPDATE tasks
    SET stage = $1, "completedAt" = ${completedAt}, "updatedAt" = NOW()
    WHERE id = $2
    RETURNING *
  `;

  const result = await query(sql, [stage, id]);
  return result.rows[0];
}

/**
 * Delete a task
 * @param {string} id - Task ID
 * @returns {Promise<boolean>} True if deleted
 */
export async function remove(id) {
  const result = await query('DELETE FROM tasks WHERE id = $1 RETURNING id', [id]);
  return result.rowCount > 0;
}

/**
 * Archive a task
 * @param {string} id - Task ID
 * @returns {Promise<Object>} Archived task
 */
export async function archive(id) {
  return update(id, { archived: true });
}

/**
 * Get task counts by stage
 * @returns {Promise<Object>} Counts by stage
 */
export async function getCountByStage() {
  const sql = `
    SELECT stage, COUNT(*) as count
    FROM tasks
    WHERE archived = false OR archived IS NULL
    GROUP BY stage
  `;

  const result = await query(sql);
  return result.rows.reduce((acc, row) => {
    acc[row.stage] = parseInt(row.count);
    return acc;
  }, {});
}

/**
 * Get overdue tasks
 * @returns {Promise<Array>} Overdue tasks
 */
export async function getOverdue() {
  const sql = `
    SELECT
      t.*,
      l.title as listing_title,
      l.sku as listing_sku
    FROM tasks t
    LEFT JOIN listings l ON t."listingId" = l.id
    WHERE t."dueDate" < NOW()
    AND t.stage != 'done'
    AND (t.archived = false OR t.archived IS NULL)
    ORDER BY t."dueDate" ASC
  `;

  const result = await query(sql);
  return result.rows;
}

/**
 * Get tasks for a specific listing
 * @param {string} listingId - Listing ID
 * @returns {Promise<Array>} Tasks for the listing
 */
export async function getByListingId(listingId) {
  return getAll({ listingId });
}

export default {
  getAll,
  getById,
  create,
  update,
  moveToStage,
  remove,
  archive,
  getCountByStage,
  getOverdue,
  getByListingId,
};
