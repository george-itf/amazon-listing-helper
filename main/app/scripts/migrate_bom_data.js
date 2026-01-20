/**
 * BOM Data Migration Script (Slice A)
 *
 * Migrates data from JSON files to PostgreSQL tables:
 * - suppliers.json -> suppliers table
 * - components.json -> components table
 * - bom.json -> boms + bom_lines tables
 *
 * Per DEPRECATION_PLAN.md §14
 *
 * Usage: node scripts/migrate_bom_data.js
 */

import fs from 'fs';
import { query, transaction } from '../src/database/connection.js';

const DATA_DIR = process.env.DATA_DIR || '/opt/alh/data';

async function migrateBOM() {
  console.log('=== BOM Data Migration ===\n');

  // Load JSON files
  let suppliers = { suppliers: [] };
  let components = { components: [] };
  let boms = { bom: {} };

  try {
    const suppliersPath = `${DATA_DIR}/suppliers.json`;
    if (fs.existsSync(suppliersPath)) {
      suppliers = JSON.parse(fs.readFileSync(suppliersPath, 'utf8'));
      console.log(`Loaded ${suppliers.suppliers?.length || 0} suppliers from JSON`);
    } else {
      console.log('No suppliers.json found, skipping supplier migration');
    }
  } catch (e) {
    console.log('Could not load suppliers.json:', e.message);
  }

  try {
    const componentsPath = `${DATA_DIR}/components.json`;
    if (fs.existsSync(componentsPath)) {
      components = JSON.parse(fs.readFileSync(componentsPath, 'utf8'));
      console.log(`Loaded ${components.components?.length || 0} components from JSON`);
    } else {
      console.log('No components.json found, skipping component migration');
    }
  } catch (e) {
    console.log('Could not load components.json:', e.message);
  }

  try {
    const bomsPath = `${DATA_DIR}/bom.json`;
    if (fs.existsSync(bomsPath)) {
      boms = JSON.parse(fs.readFileSync(bomsPath, 'utf8'));
      console.log(`Loaded ${Object.keys(boms.bom || {}).length} BOMs from JSON`);
    } else {
      console.log('No bom.json found, skipping BOM migration');
    }
  } catch (e) {
    console.log('Could not load bom.json:', e.message);
  }

  let suppliersCreated = 0;
  let componentsCreated = 0;
  let bomsCreated = 0;
  let bomLinesCreated = 0;

  // Map old IDs to new IDs
  const supplierIdMap = new Map();
  const componentIdMap = new Map();

  await transaction(async (client) => {
    // 1. Migrate suppliers
    console.log('\n--- Migrating Suppliers ---');
    for (const s of suppliers.suppliers || []) {
      try {
        const result = await client.query(`
          INSERT INTO suppliers (name, contact_name, email, phone, website, currency_code, lead_time_days, notes, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT DO NOTHING
          RETURNING id
        `, [
          s.name,
          s.contactName || null,
          s.email || null,
          s.phone || null,
          s.website || null,
          s.currency || 'GBP',
          s.leadTimeDays || 7,
          s.notes || null,
          s.createdAt || new Date().toISOString()
        ]);

        if (result.rows.length > 0) {
          supplierIdMap.set(s.id, result.rows[0].id);
          suppliersCreated++;
        }
      } catch (e) {
        console.error(`  Error migrating supplier ${s.name}:`, e.message);
      }
    }
    console.log(`  Created ${suppliersCreated} suppliers`);

    // 2. Migrate components
    console.log('\n--- Migrating Components ---');
    for (const c of components.components || []) {
      try {
        // Map supplier ID if exists
        const newSupplierId = c.supplierId ? supplierIdMap.get(c.supplierId) : null;

        const result = await client.query(`
          INSERT INTO components (component_sku, name, description, category, supplier_id, unit_cost_ex_vat, unit_of_measure, pack_size, current_stock, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (component_sku) DO NOTHING
          RETURNING id
        `, [
          c.sku || c.id,  // Use sku or id as component_sku
          c.name,
          c.description || null,
          c.category || 'General',
          newSupplierId,
          c.unitCost || 0,
          c.unitOfMeasure || 'each',
          c.packSize || 1,
          c.currentStock || 0,
          c.createdAt || new Date().toISOString()
        ]);

        if (result.rows.length > 0) {
          componentIdMap.set(c.id, result.rows[0].id);
          componentsCreated++;
        }
      } catch (e) {
        console.error(`  Error migrating component ${c.name}:`, e.message);
      }
    }
    console.log(`  Created ${componentsCreated} components`);

    // 3. Migrate BOMs
    console.log('\n--- Migrating BOMs ---');
    for (const [sku, bom] of Object.entries(boms.bom || {})) {
      try {
        // Get listing ID by SKU
        const listingResult = await client.query(
          'SELECT id FROM listings WHERE seller_sku = $1 OR sku = $1',
          [sku]
        );

        if (listingResult.rows.length === 0) {
          console.log(`  Skipping BOM for SKU ${sku}: listing not found`);
          continue;
        }

        const listingId = listingResult.rows[0].id;

        // Check if BOM already exists for this listing
        const existingBom = await client.query(
          'SELECT id FROM boms WHERE listing_id = $1 AND is_active = true',
          [listingId]
        );

        if (existingBom.rows.length > 0) {
          console.log(`  Skipping BOM for listing ${listingId}: active BOM already exists`);
          continue;
        }

        // Create BOM version 1, is_active=true
        const bomResult = await client.query(`
          INSERT INTO boms (listing_id, scope_type, version, is_active, effective_from, notes, created_at)
          VALUES ($1, 'LISTING', 1, true, CURRENT_TIMESTAMP, $2, CURRENT_TIMESTAMP)
          RETURNING id
        `, [listingId, bom.notes || null]);

        const bomId = bomResult.rows[0].id;
        bomsCreated++;

        // Migrate BOM lines
        for (const line of bom.components || []) {
          const newComponentId = componentIdMap.get(line.componentId);
          if (!newComponentId) {
            console.log(`    Skipping line: component ${line.componentId} not found`);
            continue;
          }

          await client.query(`
            INSERT INTO bom_lines (bom_id, component_id, quantity, wastage_rate, created_at)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
          `, [bomId, newComponentId, line.quantity || 1, 0]);

          bomLinesCreated++;
        }
      } catch (e) {
        console.error(`  Error migrating BOM for SKU ${sku}:`, e.message);
      }
    }
    console.log(`  Created ${bomsCreated} BOMs with ${bomLinesCreated} lines`);
  });

  console.log('\n=== Migration Summary ===');
  console.log(`Suppliers created: ${suppliersCreated}`);
  console.log(`Components created: ${componentsCreated}`);
  console.log(`BOMs created: ${bomsCreated}`);
  console.log(`BOM lines created: ${bomLinesCreated}`);
  console.log('\nMigration complete!');
}

// Run migration
migrateBOM()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
