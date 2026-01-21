/**
 * Task Repository
 * Handles all database operations for tasks (Kanban board)
 */

import { query } from '../database/connection.js';

/**
 * Get all tasks with optional filters
 * @param {Object} filters - Filter options (stage, priority, archived, taskType)
 * @returns {Promise<Array>} Array of tasks
 */
export async function getAll(filters = {}) {
  let sql = `
    SELECT
      t.*,
      l.title as listing_title
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

  if (filters.taskType) {
    sql += ` AND t."taskType" = $${paramCount++}`;
    params.push(filters.taskType);
  }

  if (filters.sku) {
    sql += ` AND t.sku = $${paramCount++}`;
    params.push(filters.sku);
  }

  sql += ` ORDER BY
    CASE t.priority
      WHEN 'critical' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
    END,
    t."order" ASC,
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
      l.title as listing_title
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
      "listingId", sku, asin, title, description, "taskType", priority, stage,
      "dueDate", "order", "createdBy",
      "createdAt", "updatedAt"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
    RETURNING *
  `;

  const result = await query(sql, [
    data.listingId || null,
    data.sku || null,
    data.asin || null,
    data.title,
    data.description || null,
    data.taskType || data.type || 'optimization',
    data.priority || 'medium',
    data.stage || 'backlog',
    data.dueDate || null,
    data.order || 0,
    data.createdBy || 'system',
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

  // Map of field names to their DB column names (with quotes for camelCase)
  const fieldMappings = {
    'listingId': '"listingId"',
    'sku': 'sku',
    'asin': 'asin',
    'title': 'title',
    'description': 'description',
    'taskType': '"taskType"',
    'type': '"taskType"', // alias for backward compat
    'priority': 'priority',
    'stage': 'stage',
    'dueDate': '"dueDate"',
    'order': '"order"',
    'archived': 'archived',
    'completedAt': '"completedAt"',
    'createdBy': '"createdBy"'
  };

  for (const [inputField, dbField] of Object.entries(fieldMappings)) {
    if (data[inputField] !== undefined) {
      fields.push(`${dbField} = $${paramCount++}`);
      values.push(data[inputField]);
    }
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
      l.title as listing_title
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

/**
 * Get tasks grouped by stage for Kanban board
 * @returns {Promise<Object>} Tasks grouped by stage
 */
export async function getByStage() {
  const tasks = await getAll();

  // Group tasks by stage
  const stages = {
    backlog: [],
    todo: [],
    in_progress: [],
    review: [],
    done: []
  };

  for (const task of tasks) {
    const stage = task.stage || 'backlog';
    if (stages[stage]) {
      stages[stage].push(task);
    } else {
      stages.backlog.push(task);
    }
  }

  return stages;
}

/**
 * Get task statistics
 * @returns {Promise<Object>} Task statistics
 */
export async function getStats() {
  const sql = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN stage = 'done' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN stage != 'done' AND (archived = false OR archived IS NULL) THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN priority = 'high' OR priority = 'critical' THEN 1 ELSE 0 END) as high_priority,
      SUM(CASE WHEN "dueDate" < NOW() AND stage != 'done' THEN 1 ELSE 0 END) as overdue
    FROM tasks
    WHERE archived = false OR archived IS NULL
  `;

  const result = await query(sql);
  return result.rows[0];
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
  getByStage,
  getStats,
};
