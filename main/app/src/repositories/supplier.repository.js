/**
 * Supplier Repository
 *
 * CRUD operations for suppliers table.
 *
 * @module SupplierRepository
 */

import { query, transaction } from '../database/connection.js';

/**
 * Get all suppliers
 * @param {Object} options
 * @param {boolean} [options.activeOnly=true] - Only return active suppliers
 * @param {number} [options.limit=100]
 * @param {number} [options.offset=0]
 * @returns {Promise<Object[]>}
 */
export async function findAll({ activeOnly = true, limit = 100, offset = 0 } = {}) {
  const whereClause = activeOnly ? 'WHERE is_active = true' : '';
  const result = await query(`
    SELECT * FROM suppliers
    ${whereClause}
    ORDER BY name ASC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);

  return result.rows;
}

/**
 * Get supplier by ID
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
export async function findById(id) {
  const result = await query(
    'SELECT * FROM suppliers WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Create a new supplier
 * @param {Object} data
 * @returns {Promise<Object>}
 */
export async function create(data) {
  const result = await query(`
    INSERT INTO suppliers (
      name, contact_name, email, phone, website, address,
      currency_code, lead_time_days, minimum_order_value,
      payment_terms, notes, rating, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `, [
    data.name,
    data.contact_name || null,
    data.email || null,
    data.phone || null,
    data.website || null,
    data.address || null,
    data.currency_code || 'GBP',
    data.lead_time_days || 7,
    data.minimum_order_value || 0,
    data.payment_terms || null,
    data.notes || null,
    data.rating || null,
    data.is_active !== false,
  ]);

  return result.rows[0];
}

/**
 * Update a supplier
 * @param {number} id
 * @param {Object} data
 * @returns {Promise<Object|null>}
 */
export async function update(id, data) {
  const fields = [];
  const values = [];
  let paramIndex = 1;

  const allowedFields = [
    'name', 'contact_name', 'email', 'phone', 'website', 'address',
    'currency_code', 'lead_time_days', 'minimum_order_value',
    'payment_terms', 'notes', 'rating', 'is_active'
  ];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      fields.push(`${field} = $${paramIndex}`);
      values.push(data[field]);
      paramIndex++;
    }
  }

  if (fields.length === 0) {
    return findById(id);
  }

  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  const result = await query(`
    UPDATE suppliers
    SET ${fields.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `, values);

  return result.rows[0] || null;
}

/**
 * Delete (soft delete) a supplier
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function remove(id) {
  const result = await query(`
    UPDATE suppliers
    SET is_active = false, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING id
  `, [id]);

  return result.rows.length > 0;
}

/**
 * Hard delete a supplier (use with caution)
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function hardDelete(id) {
  const result = await query(
    'DELETE FROM suppliers WHERE id = $1 RETURNING id',
    [id]
  );
  return result.rows.length > 0;
}

/**
 * Count suppliers
 * @param {boolean} activeOnly
 * @returns {Promise<number>}
 */
export async function count(activeOnly = true) {
  const whereClause = activeOnly ? 'WHERE is_active = true' : '';
  const result = await query(`SELECT COUNT(*) as count FROM suppliers ${whereClause}`);
  return parseInt(result.rows[0].count, 10);
}

export default {
  findAll,
  findById,
  create,
  update,
  remove,
  hardDelete,
  count,
};
