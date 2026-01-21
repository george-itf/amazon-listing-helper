/**
 * Component Repository
 *
 * CRUD operations for components table.
 *
 * @module ComponentRepository
 */

import { query, transaction } from '../database/connection.js';

/**
 * Get all components
 * @param {Object} options
 * @param {boolean} [options.activeOnly=true]
 * @param {number} [options.supplierId]
 * @param {string} [options.category]
 * @param {number} [options.limit=100]
 * @param {number} [options.offset=0]
 * @returns {Promise<Object[]>}
 */
export async function findAll({
  activeOnly = true,
  supplierId,
  category,
  limit = 100,
  offset = 0
} = {}) {
  try {
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (activeOnly) {
      conditions.push('c.is_active = true');
    }
    if (supplierId) {
      conditions.push(`c.supplier_id = $${paramIndex}`);
      params.push(supplierId);
      paramIndex++;
    }
    if (category) {
      conditions.push(`c.category = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit, offset);

    const result = await query(`
      SELECT c.*, s.name as supplier_name
      FROM components c
      LEFT JOIN suppliers s ON s.id = c.supplier_id
      ${whereClause}
      ORDER BY c.name ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, params);

    return result.rows;
  } catch (error) {
    // Handle missing table gracefully
    if (error.message?.includes('does not exist')) {
      console.warn('[Components] components table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Get component by ID
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
export async function findById(id) {
  const result = await query(`
    SELECT c.*, s.name as supplier_name
    FROM components c
    LEFT JOIN suppliers s ON s.id = c.supplier_id
    WHERE c.id = $1
  `, [id]);
  return result.rows[0] || null;
}

/**
 * Get component by SKU
 * @param {string} componentSku
 * @returns {Promise<Object|null>}
 */
export async function findBySku(componentSku) {
  const result = await query(`
    SELECT c.*, s.name as supplier_name
    FROM components c
    LEFT JOIN suppliers s ON s.id = c.supplier_id
    WHERE c.component_sku = $1
  `, [componentSku]);
  return result.rows[0] || null;
}

/**
 * Create a new component
 * @param {Object} data
 * @returns {Promise<Object>}
 */
export async function create(data) {
  const result = await query(`
    INSERT INTO components (
      component_sku, name, description, category, supplier_id, supplier_sku,
      unit_cost_ex_vat, unit_of_measure, pack_size, weight_grams, dimensions_cm,
      min_stock_level, current_stock, reorder_point, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *
  `, [
    data.component_sku,
    data.name,
    data.description || null,
    data.category || 'General',
    data.supplier_id || null,
    data.supplier_sku || null,
    data.unit_cost_ex_vat || 0,
    data.unit_of_measure || 'each',
    data.pack_size || 1,
    data.weight_grams || null,
    data.dimensions_cm ? JSON.stringify(data.dimensions_cm) : null,
    data.min_stock_level || 0,
    data.current_stock || 0,
    data.reorder_point || 0,
    data.is_active !== false,
  ]);

  return result.rows[0];
}

/**
 * Update a component
 * @param {number} id
 * @param {Object} data
 * @returns {Promise<Object|null>}
 */
export async function update(id, data) {
  // Get current component for price history tracking
  const current = await findById(id);
  if (!current) return null;

  // Track price changes
  let priceHistory = current.price_history || [];
  if (data.unit_cost_ex_vat !== undefined &&
      parseFloat(data.unit_cost_ex_vat) !== parseFloat(current.unit_cost_ex_vat)) {
    priceHistory.push({
      cost: parseFloat(data.unit_cost_ex_vat),
      date: new Date().toISOString(),
      supplier_id: data.supplier_id || current.supplier_id,
    });
  }

  const fields = [];
  const values = [];
  let paramIndex = 1;

  const allowedFields = [
    'component_sku', 'name', 'description', 'category', 'supplier_id', 'supplier_sku',
    'unit_cost_ex_vat', 'unit_of_measure', 'pack_size', 'weight_grams',
    'min_stock_level', 'current_stock', 'reorder_point', 'is_active'
  ];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      fields.push(`${field} = $${paramIndex}`);
      values.push(data[field]);
      paramIndex++;
    }
  }

  // Handle dimensions_cm separately (needs JSON conversion)
  if (data.dimensions_cm !== undefined) {
    fields.push(`dimensions_cm = $${paramIndex}`);
    values.push(JSON.stringify(data.dimensions_cm));
    paramIndex++;
  }

  // Update price history
  fields.push(`price_history = $${paramIndex}`);
  values.push(JSON.stringify(priceHistory));
  paramIndex++;

  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  const result = await query(`
    UPDATE components
    SET ${fields.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `, values);

  return result.rows[0] || null;
}

/**
 * Delete (soft delete) a component
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function remove(id) {
  const result = await query(`
    UPDATE components
    SET is_active = false, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING id
  `, [id]);

  return result.rows.length > 0;
}

/**
 * Import components from CSV data
 * @param {Object[]} rows - Array of component data
 * @returns {Promise<Object>} Import results
 */
export async function importFromCsv(rows) {
  let created = 0;
  let updated = 0;
  let errors = [];

  await transaction(async (client) => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        if (!row.component_sku || !row.name) {
          errors.push({ row: i + 1, error: 'Missing required field: component_sku or name' });
          continue;
        }

        // Check if component exists
        const existing = await client.query(
          'SELECT id FROM components WHERE component_sku = $1',
          [row.component_sku]
        );

        if (existing.rows.length > 0) {
          // Update existing
          await client.query(`
            UPDATE components SET
              name = $2,
              description = COALESCE($3, description),
              category = COALESCE($4, category),
              unit_cost_ex_vat = COALESCE($5, unit_cost_ex_vat),
              updated_at = CURRENT_TIMESTAMP
            WHERE component_sku = $1
          `, [
            row.component_sku,
            row.name,
            row.description,
            row.category,
            row.unit_cost_ex_vat,
          ]);
          updated++;
        } else {
          // Create new
          await client.query(`
            INSERT INTO components (component_sku, name, description, category, unit_cost_ex_vat)
            VALUES ($1, $2, $3, $4, $5)
          `, [
            row.component_sku,
            row.name,
            row.description || null,
            row.category || 'General',
            row.unit_cost_ex_vat || 0,
          ]);
          created++;
        }
      } catch (error) {
        errors.push({ row: i + 1, error: error.message });
      }
    }
  });

  return { created, updated, errors };
}

/**
 * Get distinct categories
 * @returns {Promise<string[]>}
 */
export async function getCategories() {
  try {
    const result = await query(`
      SELECT DISTINCT category FROM components
      WHERE is_active = true AND category IS NOT NULL
      ORDER BY category
    `);
    return result.rows.map(r => r.category);
  } catch (error) {
    // Handle missing table gracefully
    if (error.message?.includes('does not exist')) {
      console.warn('[Components] components table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Count components
 * @param {boolean} activeOnly
 * @returns {Promise<number>}
 */
export async function count(activeOnly = true) {
  const whereClause = activeOnly ? 'WHERE is_active = true' : '';
  const result = await query(`SELECT COUNT(*) as count FROM components ${whereClause}`);
  return parseInt(result.rows[0].count, 10);
}

export default {
  findAll,
  findById,
  findBySku,
  create,
  update,
  remove,
  importFromCsv,
  getCategories,
  count,
};
