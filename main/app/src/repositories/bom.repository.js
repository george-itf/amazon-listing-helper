/**
 * BOM (Bill of Materials) Repository
 *
 * CRUD operations for boms and bom_lines tables.
 * Implements BOM invariants per DEPRECATION_PLAN.md §12 and DATA_CONTRACTS.md §7.
 *
 * Invariants:
 * 1. BOMs are versioned - each BOM has a version integer starting at 1
 * 2. Versions are immutable - once created, a BOM version's lines cannot be modified
 * 3. One active BOM per listing - enforced by partial unique index
 * 4. Atomic line updates - PUT replaces ALL lines
 *
 * @module BomRepository
 */

import { query, transaction } from '../database/connection.js';

/**
 * Get active BOM for a listing
 * @param {number} listingId
 * @returns {Promise<Object|null>}
 */
export async function getActiveBom(listingId) {
  try {
    const result = await query(`
      SELECT b.*,
        COALESCE(json_agg(
          json_build_object(
            'id', bl.id,
            'component_id', bl.component_id,
            'component_sku', c.component_sku,
            'component_name', c.name,
            'quantity', bl.quantity,
            'wastage_rate', bl.wastage_rate,
            'unit_cost_ex_vat', c.unit_cost_ex_vat,
            'line_cost_ex_vat', bl.quantity * (1 + bl.wastage_rate) * c.unit_cost_ex_vat,
            'notes', bl.notes
          ) ORDER BY c.name
        ) FILTER (WHERE bl.id IS NOT NULL), '[]') as lines
      FROM boms b
      LEFT JOIN bom_lines bl ON bl.bom_id = b.id
      LEFT JOIN components c ON c.id = bl.component_id
      WHERE b.listing_id = $1
        AND b.is_active = true
        AND b.scope_type = 'LISTING'
      GROUP BY b.id
    `, [listingId]);

    return result.rows[0] || null;
  } catch (error) {
    // Handle missing table gracefully
    if (error.message?.includes('does not exist')) {
      console.warn('[BOM] boms/bom_lines/components table does not exist');
      return null;
    }
    throw error;
  }
}

/**
 * Get BOM by ID (any version)
 * @param {number} bomId
 * @returns {Promise<Object|null>}
 */
export async function findById(bomId) {
  const result = await query(`
    SELECT b.*,
      COALESCE(json_agg(
        json_build_object(
          'id', bl.id,
          'component_id', bl.component_id,
          'component_sku', c.component_sku,
          'component_name', c.name,
          'quantity', bl.quantity,
          'wastage_rate', bl.wastage_rate,
          'unit_cost_ex_vat', c.unit_cost_ex_vat,
          'line_cost_ex_vat', bl.quantity * (1 + bl.wastage_rate) * c.unit_cost_ex_vat,
          'notes', bl.notes
        ) ORDER BY c.name
      ) FILTER (WHERE bl.id IS NOT NULL), '[]') as lines
    FROM boms b
    LEFT JOIN bom_lines bl ON bl.bom_id = b.id
    LEFT JOIN components c ON c.id = bl.component_id
    WHERE b.id = $1
    GROUP BY b.id
  `, [bomId]);

  return result.rows[0] || null;
}

/**
 * Get all BOM versions for a listing
 * @param {number} listingId
 * @returns {Promise<Object[]>}
 */
export async function getVersionHistory(listingId) {
  try {
    const result = await query(`
      SELECT b.id, b.version, b.is_active, b.effective_from, b.effective_to,
             b.notes, b.created_at,
             COUNT(bl.id) as line_count,
             COALESCE(SUM(bl.quantity * (1 + bl.wastage_rate) * c.unit_cost_ex_vat), 0) as total_cost
      FROM boms b
      LEFT JOIN bom_lines bl ON bl.bom_id = b.id
      LEFT JOIN components c ON c.id = bl.component_id
      WHERE b.listing_id = $1 AND b.scope_type = 'LISTING'
      GROUP BY b.id
      ORDER BY b.version DESC
    `, [listingId]);

    return result.rows;
  } catch (error) {
    // Handle missing table gracefully
    if (error.message?.includes('does not exist')) {
      console.warn('[BOM] boms/bom_lines/components table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Create a new BOM version
 * This deactivates any existing active BOM and creates a new version.
 *
 * @param {number} listingId
 * @param {Object} data
 * @param {Object[]} data.lines - Array of { component_id, quantity, wastage_rate?, notes? }
 * @param {string} [data.notes]
 * @returns {Promise<Object>}
 */
export async function createVersion(listingId, data) {
  return transaction(async (client) => {
    // Get next version number
    const versionResult = await client.query(`
      SELECT COALESCE(MAX(version), 0) + 1 as next_version
      FROM boms WHERE listing_id = $1 AND scope_type = 'LISTING'
    `, [listingId]);
    const nextVersion = versionResult.rows[0].next_version;

    // Deactivate current active BOM
    await client.query(`
      UPDATE boms
      SET is_active = false, effective_to = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE listing_id = $1 AND is_active = true AND scope_type = 'LISTING'
    `, [listingId]);

    // Create new BOM
    const bomResult = await client.query(`
      INSERT INTO boms (listing_id, scope_type, version, is_active, effective_from, notes)
      VALUES ($1, 'LISTING', $2, true, CURRENT_TIMESTAMP, $3)
      RETURNING *
    `, [listingId, nextVersion, data.notes || null]);

    const bom = bomResult.rows[0];

    // Insert lines (batch validation + batch insert to avoid N+1)
    if (data.lines && data.lines.length > 0) {
      // Extract all component IDs for batch validation
      const componentIds = data.lines.map(l => l.component_id);

      // Batch validate: get all valid component IDs in one query
      const validComponentsResult = await client.query(
        'SELECT id FROM components WHERE id = ANY($1)',
        [componentIds]
      );
      const validComponentIds = new Set(validComponentsResult.rows.map(r => r.id));

      // Validate all lines before inserting
      const bomIds = [];
      const lineComponentIds = [];
      const quantities = [];
      const wastageRates = [];
      const notes = [];

      for (const line of data.lines) {
        // Validate component exists
        if (!validComponentIds.has(line.component_id)) {
          throw new Error(`Component not found: ${line.component_id}`);
        }

        // Validate quantity
        if (!line.quantity || line.quantity <= 0) {
          throw new Error(`Invalid quantity for component ${line.component_id}`);
        }

        // Validate wastage rate
        const wastageRate = line.wastage_rate || 0;
        if (wastageRate < 0 || wastageRate >= 1) {
          throw new Error(`Invalid wastage_rate for component ${line.component_id}: must be >= 0 and < 1`);
        }

        // Collect data for batch insert
        bomIds.push(bom.id);
        lineComponentIds.push(line.component_id);
        quantities.push(line.quantity);
        wastageRates.push(wastageRate);
        notes.push(line.notes || null);
      }

      // Batch insert all lines in single query
      await client.query(`
        INSERT INTO bom_lines (bom_id, component_id, quantity, wastage_rate, notes)
        SELECT * FROM UNNEST($1::integer[], $2::integer[], $3::numeric[], $4::numeric[], $5::text[])
      `, [bomIds, lineComponentIds, quantities, wastageRates, notes]);
    }

    // Return the complete BOM with lines
    return findById(bom.id);
  });
}

/**
 * Update BOM lines atomically (replaces ALL lines)
 * Per DATA_CONTRACTS.md §7.3: Atomic line replacement
 *
 * Note: This creates a NEW version rather than modifying existing.
 * Per invariant: versions are immutable.
 *
 * @param {number} bomId
 * @param {Object[]} lines - New lines array
 * @returns {Promise<Object>}
 */
export async function updateLines(bomId, lines) {
  const existingBom = await findById(bomId);
  if (!existingBom) {
    throw new Error(`BOM not found: ${bomId}`);
  }

  // Enforce BOM immutability - can only update from the ACTIVE version (Addendum C)
  if (!existingBom.is_active) {
    throw new Error(`Cannot update inactive BOM (version ${existingBom.version}). Only the active BOM can be updated.`);
  }

  // Create new version with updated lines
  return createVersion(existingBom.listing_id, {
    lines,
    notes: `Updated from version ${existingBom.version}`,
  });
}

/**
 * Clone a BOM to create a scenario BOM for ASIN analysis
 * @param {number} sourceBomId
 * @param {number} asinEntityId
 * @returns {Promise<Object>}
 */
export async function cloneForAsinScenario(sourceBomId, asinEntityId) {
  return transaction(async (client) => {
    const source = await findById(sourceBomId);
    if (!source) {
      throw new Error(`Source BOM not found: ${sourceBomId}`);
    }

    // Create scenario BOM
    const bomResult = await client.query(`
      INSERT INTO boms (asin_entity_id, scope_type, version, is_active, notes)
      VALUES ($1, 'ASIN_SCENARIO', 1, true, $2)
      RETURNING *
    `, [asinEntityId, `Cloned from BOM ${sourceBomId}`]);

    const bom = bomResult.rows[0];

    // Batch copy lines (avoids N+1)
    if (source.lines && source.lines.length > 0) {
      const bomIds = [];
      const componentIds = [];
      const quantities = [];
      const wastageRates = [];
      const notes = [];

      for (const line of source.lines) {
        bomIds.push(bom.id);
        componentIds.push(line.component_id);
        quantities.push(line.quantity);
        wastageRates.push(line.wastage_rate || 0);
        notes.push(line.notes || null);
      }

      await client.query(`
        INSERT INTO bom_lines (bom_id, component_id, quantity, wastage_rate, notes)
        SELECT * FROM UNNEST($1::integer[], $2::integer[], $3::numeric[], $4::numeric[], $5::text[])
      `, [bomIds, componentIds, quantities, wastageRates, notes]);
    }

    return findById(bom.id);
  });
}

/**
 * Calculate total BOM cost
 * @param {number} bomId
 * @returns {Promise<number>}
 */
export async function calculateTotalCost(bomId) {
  const result = await query(`
    SELECT COALESCE(SUM(
      bl.quantity * (1 + bl.wastage_rate) * c.unit_cost_ex_vat
    ), 0) as total_cost
    FROM bom_lines bl
    JOIN components c ON c.id = bl.component_id
    WHERE bl.bom_id = $1
  `, [bomId]);

  return parseFloat(result.rows[0].total_cost);
}

/**
 * Get listings without a BOM
 * @param {number} limit
 * @returns {Promise<Object[]>}
 */
export async function getListingsWithoutBom(limit = 50) {
  const result = await query(`
    SELECT l.id, l.seller_sku, l.title
    FROM listings l
    LEFT JOIN boms b ON b.listing_id = l.id AND b.is_active = true AND b.scope_type = 'LISTING'
    WHERE b.id IS NULL AND l.status = 'active'
    ORDER BY l.seller_sku
    LIMIT $1
  `, [limit]);

  return result.rows;
}

/**
 * Delete a BOM version (soft delete by marking inactive)
 * Active BOMs cannot be deleted; must create new version instead.
 * @param {number} bomId
 * @returns {Promise<boolean>}
 */
export async function remove(bomId) {
  const bom = await findById(bomId);
  if (!bom) return false;

  if (bom.is_active) {
    throw new Error('Cannot delete active BOM. Create a new version instead.');
  }

  // For inactive BOMs, we can mark them as having ended
  await query(`
    UPDATE boms
    SET effective_to = COALESCE(effective_to, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
  `, [bomId]);

  return true;
}

export default {
  getActiveBom,
  findById,
  getVersionHistory,
  createVersion,
  updateLines,
  cloneForAsinScenario,
  calculateTotalCost,
  getListingsWithoutBom,
  remove,
};
