/**
 * API v2 Routes
 *
 * New API endpoints per SPEC.md and DATA_CONTRACTS.md.
 * These routes replace /api/v1 endpoints according to DEPRECATION_PLAN.md §2.
 *
 * @module V2Routes
 */

import * as supplierRepo from '../repositories/supplier.repository.js';
import * as componentRepo from '../repositories/component.repository.js';
import * as bomRepo from '../repositories/bom.repository.js';
import * as economicsService from '../services/economics.service.js';

/**
 * Register all v2 routes
 * @param {FastifyInstance} fastify
 */
export async function registerV2Routes(fastify) {

  // ============================================================================
  // SUPPLIERS
  // ============================================================================

  fastify.get('/api/v2/suppliers', async (request, reply) => {
    const { activeOnly = 'true', limit = '100', offset = '0' } = request.query;
    const suppliers = await supplierRepo.findAll({
      activeOnly: activeOnly === 'true',
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
    return { items: suppliers, total: await supplierRepo.count(activeOnly === 'true') };
  });

  fastify.get('/api/v2/suppliers/:id', async (request, reply) => {
    const supplier = await supplierRepo.findById(parseInt(request.params.id, 10));
    if (!supplier) {
      return reply.status(404).send({ error: 'Supplier not found' });
    }
    return supplier;
  });

  fastify.post('/api/v2/suppliers', async (request, reply) => {
    const supplier = await supplierRepo.create(request.body);
    return reply.status(201).send(supplier);
  });

  fastify.put('/api/v2/suppliers/:id', async (request, reply) => {
    const supplier = await supplierRepo.update(
      parseInt(request.params.id, 10),
      request.body
    );
    if (!supplier) {
      return reply.status(404).send({ error: 'Supplier not found' });
    }
    return supplier;
  });

  fastify.delete('/api/v2/suppliers/:id', async (request, reply) => {
    const deleted = await supplierRepo.remove(parseInt(request.params.id, 10));
    if (!deleted) {
      return reply.status(404).send({ error: 'Supplier not found' });
    }
    return { success: true };
  });

  // ============================================================================
  // COMPONENTS
  // ============================================================================

  fastify.get('/api/v2/components', async (request, reply) => {
    const { activeOnly = 'true', supplierId, category, limit = '100', offset = '0' } = request.query;
    const components = await componentRepo.findAll({
      activeOnly: activeOnly === 'true',
      supplierId: supplierId ? parseInt(supplierId, 10) : undefined,
      category,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
    return {
      items: components,
      total: await componentRepo.count(activeOnly === 'true'),
    };
  });

  fastify.get('/api/v2/components/categories', async (request, reply) => {
    const categories = await componentRepo.getCategories();
    return { categories };
  });

  fastify.get('/api/v2/components/:id', async (request, reply) => {
    const component = await componentRepo.findById(parseInt(request.params.id, 10));
    if (!component) {
      return reply.status(404).send({ error: 'Component not found' });
    }
    return component;
  });

  fastify.post('/api/v2/components', async (request, reply) => {
    // Check for duplicate SKU
    const existing = await componentRepo.findBySku(request.body.component_sku);
    if (existing) {
      return reply.status(409).send({ error: 'Component SKU already exists' });
    }
    const component = await componentRepo.create(request.body);
    return reply.status(201).send(component);
  });

  fastify.put('/api/v2/components/:id', async (request, reply) => {
    const component = await componentRepo.update(
      parseInt(request.params.id, 10),
      request.body
    );
    if (!component) {
      return reply.status(404).send({ error: 'Component not found' });
    }
    return component;
  });

  fastify.delete('/api/v2/components/:id', async (request, reply) => {
    const deleted = await componentRepo.remove(parseInt(request.params.id, 10));
    if (!deleted) {
      return reply.status(404).send({ error: 'Component not found' });
    }
    return { success: true };
  });

  /**
   * POST /api/v2/components/import
   * Import components from CSV
   * Expected body: { rows: [{ component_sku, name, description?, category?, unit_cost_ex_vat? }] }
   */
  fastify.post('/api/v2/components/import', async (request, reply) => {
    const { rows } = request.body;
    if (!Array.isArray(rows)) {
      return reply.status(400).send({ error: 'Expected rows array in body' });
    }
    const result = await componentRepo.importFromCsv(rows);
    return result;
  });

  // ============================================================================
  // BOM (Bill of Materials)
  // ============================================================================

  /**
   * GET /api/v2/listings/:listingId/bom
   * Get active BOM for a listing
   */
  fastify.get('/api/v2/listings/:listingId/bom', async (request, reply) => {
    const listingId = parseInt(request.params.listingId, 10);
    const bom = await bomRepo.getActiveBom(listingId);
    if (!bom) {
      return { listing_id: listingId, bom: null, message: 'No active BOM for this listing' };
    }
    return bom;
  });

  /**
   * GET /api/v2/listings/:listingId/bom/history
   * Get all BOM versions for a listing
   */
  fastify.get('/api/v2/listings/:listingId/bom/history', async (request, reply) => {
    const listingId = parseInt(request.params.listingId, 10);
    const versions = await bomRepo.getVersionHistory(listingId);
    return { listing_id: listingId, versions };
  });

  /**
   * POST /api/v2/listings/:listingId/bom
   * Create new BOM version for a listing
   * Body: { lines: [{ component_id, quantity, wastage_rate?, notes? }], notes? }
   */
  fastify.post('/api/v2/listings/:listingId/bom', async (request, reply) => {
    const listingId = parseInt(request.params.listingId, 10);
    try {
      const bom = await bomRepo.createVersion(listingId, request.body);
      return reply.status(201).send(bom);
    } catch (error) {
      return reply.status(400).send({ error: error.message });
    }
  });

  /**
   * GET /api/v2/boms/:bomId
   * Get a specific BOM by ID (any version)
   */
  fastify.get('/api/v2/boms/:bomId', async (request, reply) => {
    const bomId = parseInt(request.params.bomId, 10);
    const bom = await bomRepo.findById(bomId);
    if (!bom) {
      return reply.status(404).send({ error: 'BOM not found' });
    }
    return bom;
  });

  /**
   * PUT /api/v2/boms/:bomId/lines
   * Replace ALL lines in a BOM (creates new version per invariants)
   * Body: { lines: [{ component_id, quantity, wastage_rate?, notes? }] }
   */
  fastify.put('/api/v2/boms/:bomId/lines', async (request, reply) => {
    const bomId = parseInt(request.params.bomId, 10);
    const { lines } = request.body;

    if (!Array.isArray(lines)) {
      return reply.status(400).send({ error: 'Expected lines array in body' });
    }

    try {
      const bom = await bomRepo.updateLines(bomId, lines);
      return bom;
    } catch (error) {
      return reply.status(400).send({ error: error.message });
    }
  });

  /**
   * GET /api/v2/boms/missing
   * Get listings without a BOM
   */
  fastify.get('/api/v2/boms/missing', async (request, reply) => {
    const { limit = '50' } = request.query;
    const listings = await bomRepo.getListingsWithoutBom(parseInt(limit, 10));
    return { listings };
  });

  // ============================================================================
  // ECONOMICS
  // ============================================================================

  /**
   * GET /api/v2/listings/:listingId/economics
   * Get full economics for a listing (DATA_CONTRACTS.md §4)
   */
  fastify.get('/api/v2/listings/:listingId/economics', async (request, reply) => {
    const listingId = parseInt(request.params.listingId, 10);
    try {
      const economics = await economicsService.calculateEconomics(listingId);
      return economics;
    } catch (error) {
      if (error.message.includes('not found')) {
        return reply.status(404).send({ error: error.message });
      }
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /api/v2/listings/:listingId/economics/scenario
   * Calculate economics with scenario overrides
   * Body: { price_inc_vat?, bom_cost_multiplier? }
   */
  fastify.post('/api/v2/listings/:listingId/economics/scenario', async (request, reply) => {
    const listingId = parseInt(request.params.listingId, 10);
    try {
      const economics = await economicsService.calculateEconomics(listingId, request.body);
      return economics;
    } catch (error) {
      if (error.message.includes('not found')) {
        return reply.status(404).send({ error: error.message });
      }
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /api/v2/listings/:listingId/price/preview
   * Preview economics impact of a price change
   * Body: { price_inc_vat }
   */
  fastify.post('/api/v2/listings/:listingId/price/preview', async (request, reply) => {
    const listingId = parseInt(request.params.listingId, 10);
    const { price_inc_vat } = request.body;

    if (price_inc_vat === undefined || price_inc_vat === null) {
      return reply.status(400).send({ error: 'price_inc_vat is required' });
    }

    try {
      const preview = await economicsService.previewPriceChange(listingId, parseFloat(price_inc_vat));
      return preview;
    } catch (error) {
      if (error.message.includes('not found')) {
        return reply.status(404).send({ error: error.message });
      }
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /api/v2/economics/batch
   * Calculate economics for multiple listings
   * Body: { listing_ids: [1, 2, 3] }
   */
  fastify.post('/api/v2/economics/batch', async (request, reply) => {
    const { listing_ids } = request.body;

    if (!Array.isArray(listing_ids)) {
      return reply.status(400).send({ error: 'Expected listing_ids array in body' });
    }

    const results = await economicsService.calculateBatchEconomics(listing_ids);
    return { results };
  });

  // ============================================================================
  // COST OVERRIDES
  // ============================================================================

  /**
   * GET /api/v2/listings/:listingId/cost-overrides
   * Get cost overrides for a listing
   */
  fastify.get('/api/v2/listings/:listingId/cost-overrides', async (request, reply) => {
    const listingId = parseInt(request.params.listingId, 10);
    const { query: dbQuery } = await import('../database/connection.js');

    const result = await dbQuery(`
      SELECT * FROM listing_cost_overrides WHERE listing_id = $1
    `, [listingId]);

    if (result.rows.length === 0) {
      return {
        listing_id: listingId,
        shipping_cost_ex_vat: 0,
        packaging_cost_ex_vat: 0,
        handling_cost_ex_vat: 0,
        other_cost_ex_vat: 0,
        notes: null,
      };
    }

    return result.rows[0];
  });

  /**
   * PUT /api/v2/listings/:listingId/cost-overrides
   * Set cost overrides for a listing
   * Body: { shipping_cost_ex_vat?, packaging_cost_ex_vat?, handling_cost_ex_vat?, other_cost_ex_vat?, notes? }
   */
  fastify.put('/api/v2/listings/:listingId/cost-overrides', async (request, reply) => {
    const listingId = parseInt(request.params.listingId, 10);
    const { query: dbQuery } = await import('../database/connection.js');

    const {
      shipping_cost_ex_vat,
      packaging_cost_ex_vat,
      handling_cost_ex_vat,
      other_cost_ex_vat,
      notes,
    } = request.body;

    const result = await dbQuery(`
      INSERT INTO listing_cost_overrides (listing_id, shipping_cost_ex_vat, packaging_cost_ex_vat, handling_cost_ex_vat, other_cost_ex_vat, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (listing_id) DO UPDATE SET
        shipping_cost_ex_vat = COALESCE($2, listing_cost_overrides.shipping_cost_ex_vat),
        packaging_cost_ex_vat = COALESCE($3, listing_cost_overrides.packaging_cost_ex_vat),
        handling_cost_ex_vat = COALESCE($4, listing_cost_overrides.handling_cost_ex_vat),
        other_cost_ex_vat = COALESCE($5, listing_cost_overrides.other_cost_ex_vat),
        notes = COALESCE($6, listing_cost_overrides.notes),
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      listingId,
      shipping_cost_ex_vat ?? 0,
      packaging_cost_ex_vat ?? 0,
      handling_cost_ex_vat ?? 0,
      other_cost_ex_vat ?? 0,
      notes ?? null,
    ]);

    return result.rows[0];
  });

  // ============================================================================
  // SETTINGS
  // ============================================================================

  /**
   * GET /api/v2/settings
   * Get all settings
   */
  fastify.get('/api/v2/settings', async (request, reply) => {
    const { query: dbQuery } = await import('../database/connection.js');
    const result = await dbQuery('SELECT key, value, description FROM settings ORDER BY key');

    // Convert to object format
    const settings = {};
    for (const row of result.rows) {
      settings[row.key] = {
        value: row.value,
        description: row.description,
      };
    }

    return { settings };
  });

  /**
   * PUT /api/v2/settings
   * Update settings
   * Body: { key: value, ... }
   */
  fastify.put('/api/v2/settings', async (request, reply) => {
    const { query: dbQuery } = await import('../database/connection.js');
    const updates = request.body;

    for (const [key, value] of Object.entries(updates)) {
      await dbQuery(`
        INSERT INTO settings (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET
          value = $2,
          "updatedAt" = CURRENT_TIMESTAMP
      `, [key, JSON.stringify(value)]);
    }

    return { success: true };
  });

  // ============================================================================
  // HEALTH CHECK
  // ============================================================================

  fastify.get('/api/v2/health', async (request, reply) => {
    const { testConnection } = await import('../database/connection.js');
    const { getCredentialsStatus } = await import('../credentials-provider.js');

    const dbHealthy = await testConnection();
    const credentials = getCredentialsStatus();

    return {
      status: dbHealthy ? 'healthy' : 'unhealthy',
      version: 'v2',
      timestamp: new Date().toISOString(),
      database: dbHealthy,
      credentials,
    };
  });
}

export default registerV2Routes;
