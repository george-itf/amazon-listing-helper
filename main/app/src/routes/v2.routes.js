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
import * as listingRepo from '../repositories/listing.repository.js';
import * as economicsService from '../services/economics.service.js';
import * as listingService from '../services/listing.service.js';
import { query } from '../database/connection.js';

/**
 * Wrap response data in standard API response format
 * Frontend expects: { success: boolean, data?: T, error?: string }
 */
function wrapResponse(data) {
  return { success: true, data };
}

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
    return wrapResponse(suppliers);
  });

  fastify.get('/api/v2/suppliers/:id', async (request, reply) => {
    const supplier = await supplierRepo.findById(parseInt(request.params.id, 10));
    if (!supplier) {
      return reply.status(404).send({ success: false, error: 'Supplier not found' });
    }
    return wrapResponse(supplier);
  });

  fastify.post('/api/v2/suppliers', async (request, reply) => {
    const supplier = await supplierRepo.create(request.body);
    return reply.status(201).send(wrapResponse(supplier));
  });

  fastify.put('/api/v2/suppliers/:id', async (request, reply) => {
    const supplier = await supplierRepo.update(
      parseInt(request.params.id, 10),
      request.body
    );
    if (!supplier) {
      return reply.status(404).send({ success: false, error: 'Supplier not found' });
    }
    return wrapResponse(supplier);
  });

  fastify.delete('/api/v2/suppliers/:id', async (request, reply) => {
    const deleted = await supplierRepo.remove(parseInt(request.params.id, 10));
    if (!deleted) {
      return reply.status(404).send({ success: false, error: 'Supplier not found' });
    }
    return wrapResponse({ deleted: true });
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
    return wrapResponse(components);
  });

  fastify.get('/api/v2/components/categories', async (request, reply) => {
    const categories = await componentRepo.getCategories();
    return wrapResponse(categories);
  });

  fastify.get('/api/v2/components/:id', async (request, reply) => {
    const component = await componentRepo.findById(parseInt(request.params.id, 10));
    if (!component) {
      return reply.status(404).send({ success: false, error: 'Component not found' });
    }
    return wrapResponse(component);
  });

  fastify.post('/api/v2/components', async (request, reply) => {
    // Check for duplicate SKU
    const existing = await componentRepo.findBySku(request.body.component_sku);
    if (existing) {
      return reply.status(409).send({ success: false, error: 'Component SKU already exists' });
    }
    const component = await componentRepo.create(request.body);
    return reply.status(201).send(wrapResponse(component));
  });

  fastify.put('/api/v2/components/:id', async (request, reply) => {
    const component = await componentRepo.update(
      parseInt(request.params.id, 10),
      request.body
    );
    if (!component) {
      return reply.status(404).send({ success: false, error: 'Component not found' });
    }
    return wrapResponse(component);
  });

  fastify.delete('/api/v2/components/:id', async (request, reply) => {
    const deleted = await componentRepo.remove(parseInt(request.params.id, 10));
    if (!deleted) {
      return reply.status(404).send({ success: false, error: 'Component not found' });
    }
    return wrapResponse({ deleted: true });
  });

  /**
   * POST /api/v2/components/import
   * Import components from CSV
   * Expected body: { rows: [{ component_sku, name, description?, category?, unit_cost_ex_vat? }] }
   */
  fastify.post('/api/v2/components/import', async (request, reply) => {
    const { rows } = request.body;
    if (!Array.isArray(rows)) {
      return reply.status(400).send({ success: false, error: 'Expected rows array in body' });
    }
    const result = await componentRepo.importFromCsv(rows);
    return wrapResponse(result);
  });

  // ============================================================================
  // LISTINGS
  // ============================================================================

  /**
   * GET /api/v2/listings
   * Get all listings with optional filters
   */
  fastify.get('/api/v2/listings', async (request, reply) => {
    const { status, limit = '100', offset = '0' } = request.query;
    const filters = {
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    };
    if (status) filters.status = status;

    const listings = await listingRepo.getAll(filters);

    // Map to frontend expected format (DATA_CONTRACTS.md)
    const mapped = listings.map(l => ({
      id: l.id,
      seller_sku: l.sku,
      asin: l.asin || null,
      title: l.title || '',
      marketplace_id: 1, // Default UK marketplace
      status: (l.status || 'active').toUpperCase(),
      created_at: l.createdAt || l.created_at || new Date().toISOString(),
      updated_at: l.updatedAt || l.updated_at || new Date().toISOString(),
    }));

    return wrapResponse(mapped);
  });

  /**
   * GET /api/v2/listings/:id
   * Get a single listing by ID
   */
  fastify.get('/api/v2/listings/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const listing = await listingRepo.getById(id);

    if (!listing) {
      return reply.status(404).send({ success: false, error: 'Listing not found' });
    }

    // Map to frontend expected format
    return wrapResponse({
      id: listing.id,
      seller_sku: listing.sku,
      asin: listing.asin || null,
      title: listing.title || '',
      marketplace_id: 1, // Default UK marketplace
      status: (listing.status || 'active').toUpperCase(),
      created_at: listing.createdAt || listing.created_at || new Date().toISOString(),
      updated_at: listing.updatedAt || listing.updated_at || new Date().toISOString(),
    });
  });

  // ============================================================================
  // BOM (Bill of Materials)
  // ============================================================================

  /**
   * GET /api/v2/boms
   * Get all BOMs with optional filtering
   */
  fastify.get('/api/v2/boms', async (request, reply) => {
    const { listing_id, limit = '100', offset = '0' } = request.query;

    let sql = `
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
            'line_cost_ex_vat', bl.quantity * (1 + bl.wastage_rate) * c.unit_cost_ex_vat
          ) ORDER BY c.name
        ) FILTER (WHERE bl.id IS NOT NULL), '[]') as lines,
        COALESCE(SUM(bl.quantity * (1 + bl.wastage_rate) * c.unit_cost_ex_vat), 0) as total_cost_ex_vat
      FROM boms b
      LEFT JOIN bom_lines bl ON bl.bom_id = b.id
      LEFT JOIN components c ON c.id = bl.component_id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (listing_id) {
      sql += ` AND b.listing_id = $${paramCount++}`;
      params.push(parseInt(listing_id, 10));
    }

    sql += ` GROUP BY b.id ORDER BY b.created_at DESC`;
    sql += ` LIMIT $${paramCount++}`;
    params.push(parseInt(limit, 10));
    sql += ` OFFSET $${paramCount++}`;
    params.push(parseInt(offset, 10));

    const result = await query(sql, params);
    return wrapResponse(result.rows);
  });

  /**
   * POST /api/v2/boms
   * Create a new BOM
   * Body: { listing_id?, asin_entity_id?, scope_type, notes?, lines: [...] }
   */
  fastify.post('/api/v2/boms', async (request, reply) => {
    const { listing_id, asin_entity_id, scope_type, notes, lines } = request.body;

    if (!listing_id && !asin_entity_id) {
      return reply.status(400).send({ success: false, error: 'Either listing_id or asin_entity_id is required' });
    }

    if (!scope_type) {
      return reply.status(400).send({ success: false, error: 'scope_type is required' });
    }

    try {
      if (listing_id) {
        const bom = await bomRepo.createVersion(listing_id, { lines: lines || [], notes });
        return reply.status(201).send(wrapResponse(bom));
      } else {
        // For ASIN_SCENARIO BOMs, we need a different creation path
        return reply.status(400).send({ success: false, error: 'ASIN_SCENARIO BOMs must be created via cloning' });
      }
    } catch (error) {
      return reply.status(400).send({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/v2/boms/:bomId/activate
   * Activate a specific BOM version (deactivates others for same listing)
   */
  fastify.post('/api/v2/boms/:bomId/activate', async (request, reply) => {
    const bomId = parseInt(request.params.bomId, 10);

    try {
      const bom = await bomRepo.findById(bomId);
      if (!bom) {
        return reply.status(404).send({ success: false, error: 'BOM not found' });
      }

      if (bom.is_active) {
        return wrapResponse(bom); // Already active
      }

      // Deactivate current active and activate this one
      await query(`
        UPDATE boms SET is_active = false, effective_to = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE listing_id = $1 AND is_active = true AND scope_type = 'LISTING'
      `, [bom.listing_id]);

      await query(`
        UPDATE boms SET is_active = true, effective_from = CURRENT_TIMESTAMP, effective_to = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [bomId]);

      return wrapResponse(await bomRepo.findById(bomId));
    } catch (error) {
      return reply.status(400).send({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/v2/listings/:listingId/bom
   * Get active BOM for a listing
   */
  fastify.get('/api/v2/listings/:listingId/bom', async (request, reply) => {
    const listingId = parseInt(request.params.listingId, 10);
    const bom = await bomRepo.getActiveBom(listingId);
    // Return null for no BOM - frontend handles this
    return wrapResponse(bom || null);
  });

  /**
   * GET /api/v2/listings/:listingId/bom/history
   * Get all BOM versions for a listing
   */
  fastify.get('/api/v2/listings/:listingId/bom/history', async (request, reply) => {
    const listingId = parseInt(request.params.listingId, 10);
    const versions = await bomRepo.getVersionHistory(listingId);
    return wrapResponse(versions);
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
      return reply.status(201).send(wrapResponse(bom));
    } catch (error) {
      return reply.status(400).send({ success: false, error: error.message });
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
      return reply.status(404).send({ success: false, error: 'BOM not found' });
    }
    return wrapResponse(bom);
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
      return reply.status(400).send({ success: false, error: 'Expected lines array in body' });
    }

    try {
      const bom = await bomRepo.updateLines(bomId, lines);
      return wrapResponse(bom);
    } catch (error) {
      return reply.status(400).send({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/v2/boms/missing
   * Get listings without a BOM
   */
  fastify.get('/api/v2/boms/missing', async (request, reply) => {
    const { limit = '50' } = request.query;
    const listings = await bomRepo.getListingsWithoutBom(parseInt(limit, 10));
    return wrapResponse(listings);
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
      return wrapResponse(economics);
    } catch (error) {
      if (error.message.includes('not found')) {
        return reply.status(404).send({ success: false, error: error.message });
      }
      return reply.status(500).send({ success: false, error: error.message });
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
      return wrapResponse(economics);
    } catch (error) {
      if (error.message.includes('not found')) {
        return reply.status(404).send({ success: false, error: error.message });
      }
      return reply.status(500).send({ success: false, error: error.message });
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
      return reply.status(400).send({ success: false, error: 'Expected listing_ids array in body' });
    }

    const results = await economicsService.calculateBatchEconomics(listing_ids);
    return wrapResponse(results);
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
      return wrapResponse({
        listing_id: listingId,
        shipping_cost_ex_vat: 0,
        packaging_cost_ex_vat: 0,
        handling_cost_ex_vat: 0,
        other_cost_ex_vat: 0,
        notes: null,
      });
    }

    return wrapResponse(result.rows[0]);
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

    return wrapResponse(result.rows[0]);
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

    return wrapResponse(settings);
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

    return wrapResponse({ updated: true });
  });

  // ============================================================================
  // PRICE OPERATIONS (Slice B)
  // ============================================================================

  /**
   * POST /api/v2/listings/:listingId/price/preview
   * Preview price change with guardrails check
   * Body: { price_inc_vat }
   * Response: economics at new price + guardrails result
   */
  fastify.post('/api/v2/listings/:listingId/price/preview', async (request, reply) => {
    const listingId = parseInt(request.params.listingId, 10);
    const { price_inc_vat } = request.body;

    if (price_inc_vat === undefined || price_inc_vat === null) {
      return reply.status(400).send({ success: false, error: 'price_inc_vat is required' });
    }

    const newPriceIncVat = parseFloat(price_inc_vat);
    if (isNaN(newPriceIncVat) || newPriceIncVat < 0) {
      return reply.status(400).send({ success: false, error: 'price_inc_vat must be a positive number' });
    }

    try {
      const { validatePriceChange, calculateDaysOfCover } = await import('../services/guardrails.service.js');

      // Get current economics
      const currentEconomics = await economicsService.calculateEconomics(listingId);

      // Calculate new economics at proposed price
      const newEconomics = await economicsService.calculateEconomics(listingId, {
        price_inc_vat: newPriceIncVat,
      });

      // Get sales velocity for days of cover
      const { query: dbQuery } = await import('../database/connection.js');
      const salesResult = await dbQuery(`
        SELECT COALESCE(SUM(units), 0) as total_units
        FROM listing_sales_daily
        WHERE listing_id = $1
          AND date >= CURRENT_DATE - INTERVAL '30 days'
      `, [listingId]);

      const totalUnits30d = parseInt(salesResult.rows[0]?.total_units || 0, 10);
      const salesVelocity = totalUnits30d / 30;

      const listingResult = await dbQuery(
        'SELECT available_quantity FROM listings WHERE id = $1',
        [listingId]
      );
      const availableQuantity = listingResult.rows[0]?.available_quantity || 0;
      const daysOfCover = calculateDaysOfCover(availableQuantity, salesVelocity);

      // Validate against guardrails
      const guardrailsResult = await validatePriceChange({
        listingId,
        newPriceIncVat,
        currentPriceIncVat: currentEconomics.price_inc_vat,
        breakEvenPriceIncVat: newEconomics.break_even_price_inc_vat,
        newMargin: newEconomics.margin,
        daysOfCover,
        isPriceDecrease: newPriceIncVat < currentEconomics.price_inc_vat,
      });

      return wrapResponse({
        listing_id: listingId,
        current_price_inc_vat: currentEconomics.price_inc_vat,
        new_price_inc_vat: newPriceIncVat,
        economics: {
          price_inc_vat: newEconomics.price_inc_vat,
          price_ex_vat: newEconomics.price_ex_vat,
          profit_ex_vat: newEconomics.profit_ex_vat,
          margin: newEconomics.margin,
          break_even_price_inc_vat: newEconomics.break_even_price_inc_vat,
          bom_cost_ex_vat: newEconomics.bom_cost_ex_vat,
          total_cost_ex_vat: newEconomics.total_cost_ex_vat,
        },
        guardrails: guardrailsResult,
      });
    } catch (error) {
      if (error.message.includes('not found')) {
        return reply.status(404).send({ success: false, error: error.message });
      }
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/v2/listings/:listingId/price/publish
   * Publish price change - creates job and listing_event
   * Body: { price_inc_vat, reason, correlation_id? }
   * Response: { job_id, status, listing_event_id }
   */
  fastify.post('/api/v2/listings/:listingId/price/publish', async (request, reply) => {
    const listingId = parseInt(request.params.listingId, 10);
    const { price_inc_vat, reason, correlation_id } = request.body;

    // Validate required fields per DATA_CONTRACTS §5.1
    if (price_inc_vat === undefined || price_inc_vat === null) {
      return reply.status(400).send({ success: false, error: 'price_inc_vat is required' });
    }
    if (!reason) {
      return reply.status(400).send({ success: false, error: 'reason is required' });
    }

    const newPriceIncVat = parseFloat(price_inc_vat);
    if (isNaN(newPriceIncVat) || newPriceIncVat < 0) {
      return reply.status(400).send({ success: false, error: 'price_inc_vat must be a positive number' });
    }

    try {
      const { validatePriceChange, calculateDaysOfCover } = await import('../services/guardrails.service.js');

      // Get current listing data via service
      const listing = await listingService.getListingById(listingId);
      if (!listing) {
        return reply.status(404).send({ success: false, error: `Listing not found: ${listingId}` });
      }

      const currentPriceIncVat = parseFloat(listing.price_inc_vat) || 0;

      // Calculate economics for guardrails
      const newEconomics = await economicsService.calculateEconomics(listingId, {
        price_inc_vat: newPriceIncVat,
      });

      // Get days of cover via service
      const inventoryData = await listingService.getDaysOfCover(listingId);
      const daysOfCover = calculateDaysOfCover(
        listing.available_quantity || 0,
        inventoryData.sales_velocity_30d
      );

      // RE-COMPUTE guardrails (never trust UI)
      const guardrailsResult = await validatePriceChange({
        listingId,
        newPriceIncVat,
        currentPriceIncVat,
        breakEvenPriceIncVat: newEconomics.break_even_price_inc_vat,
        newMargin: newEconomics.margin,
        daysOfCover,
        isPriceDecrease: newPriceIncVat < currentPriceIncVat,
      });

      // Block publish if guardrails failed
      if (!guardrailsResult.passed) {
        return reply.status(400).send({
          success: false,
          error: 'Guardrails check failed',
          guardrails: guardrailsResult,
        });
      }

      // Create job and event atomically via service (with deduplication)
      const result = await listingService.createPublishJob({
        listingId,
        jobType: 'PUBLISH_PRICE_CHANGE',
        inputJson: {
          price_inc_vat: newPriceIncVat,
          previous_price_inc_vat: currentPriceIncVat,
          reason,
          correlation_id: correlation_id || null,
        },
        eventType: 'PRICE_CHANGE_DRAFTED',
        beforeJson: { price_inc_vat: currentPriceIncVat },
        afterJson: { price_inc_vat: newPriceIncVat },
        reason,
        correlationId: correlation_id,
      });

      return reply.status(201).send(wrapResponse(result));
    } catch (error) {
      console.error('Price publish error:', error);
      // Handle duplicate job error specifically
      if (error.message.includes('Duplicate job')) {
        return reply.status(409).send({ success: false, error: error.message });
      }
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // ============================================================================
  // STOCK OPERATIONS (Slice B)
  // ============================================================================

  /**
   * POST /api/v2/listings/:listingId/stock/preview
   * Preview stock change with guardrails check
   * Body: { available_quantity }
   */
  fastify.post('/api/v2/listings/:listingId/stock/preview', async (request, reply) => {
    const listingId = parseInt(request.params.listingId, 10);
    const { available_quantity } = request.body;

    if (available_quantity === undefined || available_quantity === null) {
      return reply.status(400).send({ success: false, error: 'available_quantity is required' });
    }

    const newQuantity = parseInt(available_quantity, 10);
    if (isNaN(newQuantity) || newQuantity < 0) {
      return reply.status(400).send({ success: false, error: 'available_quantity must be a non-negative integer' });
    }

    try {
      const { query: dbQuery } = await import('../database/connection.js');
      const { validateStockChange, calculateDaysOfCover, calculateStockoutRisk } = await import('../services/guardrails.service.js');

      // Get current listing
      const listingResult = await dbQuery(
        'SELECT id, available_quantity, price_inc_vat FROM listings WHERE id = $1',
        [listingId]
      );

      if (listingResult.rows.length === 0) {
        return reply.status(404).send({ success: false, error: `Listing not found: ${listingId}` });
      }

      const listing = listingResult.rows[0];
      const currentQuantity = listing.available_quantity || 0;

      // Get sales velocity
      const salesResult = await dbQuery(`
        SELECT COALESCE(SUM(units), 0) as total_units
        FROM listing_sales_daily
        WHERE listing_id = $1
          AND date >= CURRENT_DATE - INTERVAL '30 days'
      `, [listingId]);

      const totalUnits30d = parseInt(salesResult.rows[0]?.total_units || 0, 10);
      const salesVelocity = totalUnits30d / 30;

      const currentDaysOfCover = calculateDaysOfCover(currentQuantity, salesVelocity);
      const newDaysOfCover = calculateDaysOfCover(newQuantity, salesVelocity);

      const currentStockoutRisk = calculateStockoutRisk(currentDaysOfCover);
      const newStockoutRisk = calculateStockoutRisk(newDaysOfCover);

      // Validate against guardrails
      const guardrailsResult = await validateStockChange({
        listingId,
        newQuantity,
        currentQuantity,
        salesVelocity,
      });

      return wrapResponse({
        listing_id: listingId,
        current_quantity: currentQuantity,
        new_quantity: newQuantity,
        days_of_cover: newDaysOfCover !== null ? Math.round(newDaysOfCover * 10) / 10 : null,
        stockout_risk: newStockoutRisk,
        guardrails: guardrailsResult,
      });
    } catch (error) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/v2/listings/:listingId/stock/publish
   * Publish stock change - creates job and listing_event
   * Body: { available_quantity, reason }
   */
  fastify.post('/api/v2/listings/:listingId/stock/publish', async (request, reply) => {
    const listingId = parseInt(request.params.listingId, 10);
    const { available_quantity, reason } = request.body;

    // Validate required fields per DATA_CONTRACTS §5.2
    if (available_quantity === undefined || available_quantity === null) {
      return reply.status(400).send({ success: false, error: 'available_quantity is required' });
    }
    if (!reason) {
      return reply.status(400).send({ success: false, error: 'reason is required' });
    }

    const newQuantity = parseInt(available_quantity, 10);
    if (isNaN(newQuantity) || newQuantity < 0) {
      return reply.status(400).send({ success: false, error: 'available_quantity must be a non-negative integer' });
    }

    try {
      // Get current listing via service
      const listing = await listingService.getListingById(listingId);
      if (!listing) {
        return reply.status(404).send({ success: false, error: `Listing not found: ${listingId}` });
      }

      const currentQuantity = listing.available_quantity || 0;

      // Create job and event atomically via service (with deduplication)
      const result = await listingService.createPublishJob({
        listingId,
        jobType: 'PUBLISH_STOCK_CHANGE',
        inputJson: {
          available_quantity: newQuantity,
          previous_quantity: currentQuantity,
          reason,
        },
        eventType: 'STOCK_CHANGE_DRAFTED',
        beforeJson: { available_quantity: currentQuantity },
        afterJson: { available_quantity: newQuantity },
        reason,
      });

      return reply.status(201).send(wrapResponse(result));
    } catch (error) {
      console.error('Stock publish error:', error);
      // Handle duplicate job error specifically
      if (error.message.includes('Duplicate job')) {
        return reply.status(409).send({ success: false, error: error.message });
      }
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // ============================================================================
  // JOBS (Slice B)
  // ============================================================================

  /**
   * GET /api/v2/jobs
   * List recent jobs with optional filters
   */
  fastify.get('/api/v2/jobs', async (request, reply) => {
    const jobRepo = await import('../repositories/job.repository.js');
    const { types, statuses, limit = '50', offset = '0' } = request.query;

    const jobs = await jobRepo.findRecent({
      types: types ? types.split(',') : undefined,
      statuses: statuses ? statuses.split(',') : undefined,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    const counts = await jobRepo.countByStatus();

    return wrapResponse({ jobs, counts });
  });

  /**
   * GET /api/v2/jobs/:jobId
   * Get job by ID
   */
  fastify.get('/api/v2/jobs/:jobId', async (request, reply) => {
    const jobRepo = await import('../repositories/job.repository.js');
    const jobId = parseInt(request.params.jobId, 10);

    const job = await jobRepo.findById(jobId);
    if (!job) {
      return reply.status(404).send({ success: false, error: 'Job not found' });
    }

    return wrapResponse(job);
  });

  /**
   * POST /api/v2/jobs/:jobId/cancel
   * Cancel a pending job
   */
  fastify.post('/api/v2/jobs/:jobId/cancel', async (request, reply) => {
    const jobRepo = await import('../repositories/job.repository.js');
    const jobId = parseInt(request.params.jobId, 10);

    const cancelled = await jobRepo.cancel(jobId);
    if (!cancelled) {
      return reply.status(400).send({ success: false, error: 'Job cannot be cancelled (not pending or running)' });
    }

    return wrapResponse({ cancelled: true });
  });

  // ============================================================================
  // LISTING EVENTS (Slice B)
  // ============================================================================

  /**
   * GET /api/v2/listings/:listingId/events
   * Get events for a listing
   */
  fastify.get('/api/v2/listings/:listingId/events', async (request, reply) => {
    const listingEventRepo = await import('../repositories/listing-event.repository.js');
    const listingId = parseInt(request.params.listingId, 10);
    const { types, limit = '50' } = request.query;

    const events = await listingEventRepo.findByListing(listingId, {
      types: types ? types.split(',') : undefined,
      limit: parseInt(limit, 10),
    });

    return wrapResponse(events);
  });

  /**
   * GET /api/v2/listings/:listingId/price-history
   * Get price change history for a listing
   */
  fastify.get('/api/v2/listings/:listingId/price-history', async (request, reply) => {
    const listingEventRepo = await import('../repositories/listing-event.repository.js');
    const listingId = parseInt(request.params.listingId, 10);
    const { limit = '20' } = request.query;

    const history = await listingEventRepo.getPriceHistory(listingId, parseInt(limit, 10));
    return wrapResponse(history);
  });

  /**
   * GET /api/v2/listings/:listingId/stock-history
   * Get stock change history for a listing
   */
  fastify.get('/api/v2/listings/:listingId/stock-history', async (request, reply) => {
    const listingEventRepo = await import('../repositories/listing-event.repository.js');
    const listingId = parseInt(request.params.listingId, 10);
    const { limit = '20' } = request.query;

    const history = await listingEventRepo.getStockHistory(listingId, parseInt(limit, 10));
    return wrapResponse(history);
  });

  /**
   * GET /api/v2/events/recent
   * Get recent events across all listings
   */
  fastify.get('/api/v2/events/recent', async (request, reply) => {
    const listingEventRepo = await import('../repositories/listing-event.repository.js');
    const { types, limit = '100' } = request.query;

    const events = await listingEventRepo.findRecent({
      types: types ? types.split(',') : undefined,
      limit: parseInt(limit, 10),
    });

    return wrapResponse(events);
  });

  // ============================================================================
  // GUARDRAILS (Slice B)
  // ============================================================================

  /**
   * GET /api/v2/guardrails
   * Get current guardrails configuration
   */
  fastify.get('/api/v2/guardrails', async (request, reply) => {
    const { loadGuardrails } = await import('../services/guardrails.service.js');
    const guardrails = await loadGuardrails();
    return wrapResponse(guardrails);
  });

  /**
   * GET /api/v2/listings/:listingId/guardrails-summary
   * Get guardrails summary for a listing
   */
  fastify.get('/api/v2/listings/:listingId/guardrails-summary', async (request, reply) => {
    const { getGuardrailsSummary } = await import('../services/guardrails.service.js');
    const listingId = parseInt(request.params.listingId, 10);

    try {
      const summary = await getGuardrailsSummary(listingId);
      return wrapResponse(summary);
    } catch (error) {
      if (error.message.includes('not found')) {
        return reply.status(404).send({ success: false, error: error.message });
      }
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // ============================================================================
  // ASIN ENTITIES (Slice C)
  // ============================================================================

  /**
   * GET /api/v2/asins
   * List ASIN entities (research pool)
   */
  fastify.get('/api/v2/asins', async (request, reply) => {
    const { query: dbQuery } = await import('../database/connection.js');
    const { tracked_only = 'false', limit = '50', offset = '0' } = request.query;

    let whereClause = '';
    if (tracked_only === 'true') {
      whereClause = 'WHERE ae.is_tracked = true';
    }

    const result = await dbQuery(`
      SELECT ae.*, m.name as marketplace_name
      FROM asin_entities ae
      JOIN marketplaces m ON m.id = ae.marketplace_id
      ${whereClause}
      ORDER BY ae.updated_at DESC
      LIMIT $1 OFFSET $2
    `, [parseInt(limit, 10), parseInt(offset, 10)]);

    return wrapResponse(result.rows);
  });

  /**
   * GET /api/v2/asins/:id
   * Get ASIN entity by ID (asin_entity_id)
   */
  fastify.get('/api/v2/asins/:id', async (request, reply) => {
    const { query: dbQuery } = await import('../database/connection.js');
    const asinEntityId = parseInt(request.params.id, 10);

    const result = await dbQuery(`
      SELECT ae.*, m.name as marketplace_name, m.vat_rate
      FROM asin_entities ae
      JOIN marketplaces m ON m.id = ae.marketplace_id
      WHERE ae.id = $1
    `, [asinEntityId]);

    if (result.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'ASIN entity not found' });
    }

    // Get latest features
    const featureStoreService = await import('../services/feature-store.service.js');
    const features = await featureStoreService.getLatestFeatures('ASIN', asinEntityId);

    // Get latest Keepa snapshot
    const keepaService = await import('../services/keepa.service.js');
    const keepaResult = await dbQuery(`
      SELECT id, parsed_json, captured_at
      FROM keepa_snapshots
      WHERE asin_entity_id = $1
      ORDER BY captured_at DESC
      LIMIT 1
    `, [asinEntityId]);

    return wrapResponse({
      ...result.rows[0],
      features: features?.features_json || null,
      features_computed_at: features?.computed_at || null,
      latest_keepa: keepaResult.rows[0] || null,
    });
  });

  /**
   * POST /api/v2/asins/analyze
   * Analyze an ASIN (create entity and trigger sync)
   * Body: { asin, marketplace_id? }
   */
  fastify.post('/api/v2/asins/analyze', async (request, reply) => {
    const { asin, marketplace_id = 1 } = request.body;

    if (!asin) {
      return reply.status(400).send({ success: false, error: 'asin is required' });
    }

    const sanitizedAsin = asin.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);

    try {
      const keepaService = await import('../services/keepa.service.js');
      const { query: dbQuery } = await import('../database/connection.js');

      // Get or create ASIN entity
      const asinEntity = await keepaService.getOrCreateAsinEntity(sanitizedAsin, marketplace_id);

      // Create Keepa sync job
      const jobResult = await dbQuery(`
        INSERT INTO jobs (job_type, scope_type, asin_entity_id, input_json, created_by)
        VALUES ('SYNC_KEEPA_ASIN', 'ASIN', $1, $2, 'user')
        RETURNING *
      `, [asinEntity.id, JSON.stringify({ asin: sanitizedAsin, marketplace_id, asin_entity_id: asinEntity.id })]);

      return reply.status(201).send(wrapResponse({
        asin_entity_id: asinEntity.id,
        asin: sanitizedAsin,
        sync_job_id: jobResult.rows[0].id,
        message: 'ASIN analysis started',
      }));
    } catch (error) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/v2/asins/track
   * Track a new ASIN by ASIN string (frontend compatibility)
   * Body: { asin, marketplace_id? }
   */
  fastify.post('/api/v2/asins/track', async (request, reply) => {
    const { asin, marketplace_id = 1 } = request.body;

    if (!asin) {
      return reply.status(400).send({ success: false, error: 'asin is required' });
    }

    const sanitizedAsin = asin.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);

    try {
      const keepaService = await import('../services/keepa.service.js');
      const { query: dbQuery } = await import('../database/connection.js');

      // Get or create ASIN entity
      const asinEntity = await keepaService.getOrCreateAsinEntity(sanitizedAsin, marketplace_id);

      // Mark as tracked
      await dbQuery(`
        UPDATE asin_entities
        SET is_tracked = true, tracked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [asinEntity.id]);

      // Return the entity
      const result = await dbQuery(`
        SELECT ae.*, m.name as marketplace_name
        FROM asin_entities ae
        JOIN marketplaces m ON m.id = ae.marketplace_id
        WHERE ae.id = $1
      `, [asinEntity.id]);

      return reply.status(201).send(wrapResponse(result.rows[0]));
    } catch (error) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/v2/asins/:id/track
   * Add ASIN to research pool (tracked list)
   */
  fastify.post('/api/v2/asins/:id/track', async (request, reply) => {
    const { query: dbQuery } = await import('../database/connection.js');
    const asinEntityId = parseInt(request.params.id, 10);

    const result = await dbQuery(`
      UPDATE asin_entities
      SET is_tracked = true, tracked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [asinEntityId]);

    if (result.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'ASIN entity not found' });
    }

    return wrapResponse(result.rows[0]);
  });

  /**
   * DELETE /api/v2/asins/:id/track
   * Remove ASIN from research pool
   */
  fastify.delete('/api/v2/asins/:id/track', async (request, reply) => {
    const { query: dbQuery } = await import('../database/connection.js');
    const asinEntityId = parseInt(request.params.id, 10);

    const result = await dbQuery(`
      UPDATE asin_entities
      SET is_tracked = false, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [asinEntityId]);

    if (result.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'ASIN entity not found' });
    }

    return wrapResponse({ untracked: true });
  });

  // ============================================================================
  // KEEPA DATA (Slice C)
  // ============================================================================

  /**
   * GET /api/v2/asins/:id/keepa
   * Get Keepa data for an ASIN entity
   */
  fastify.get('/api/v2/asins/:id/keepa', async (request, reply) => {
    const { query: dbQuery } = await import('../database/connection.js');
    const asinEntityId = parseInt(request.params.id, 10);

    const result = await dbQuery(`
      SELECT ks.id, ks.asin, ks.parsed_json, ks.captured_at
      FROM keepa_snapshots ks
      WHERE ks.asin_entity_id = $1
      ORDER BY ks.captured_at DESC
      LIMIT 1
    `, [asinEntityId]);

    if (result.rows.length === 0) {
      return wrapResponse({ asin_entity_id: asinEntityId, keepa: null, message: 'No Keepa data available' });
    }

    return wrapResponse({
      asin_entity_id: asinEntityId,
      snapshot_id: result.rows[0].id,
      asin: result.rows[0].asin,
      data: result.rows[0].parsed_json,
      captured_at: result.rows[0].captured_at,
    });
  });

  /**
   * POST /api/v2/asins/:id/keepa/refresh
   * Trigger Keepa data refresh for an ASIN entity
   */
  fastify.post('/api/v2/asins/:id/keepa/refresh', async (request, reply) => {
    const { query: dbQuery } = await import('../database/connection.js');
    const asinEntityId = parseInt(request.params.id, 10);

    // Get ASIN entity
    const entityResult = await dbQuery(
      'SELECT asin, marketplace_id FROM asin_entities WHERE id = $1',
      [asinEntityId]
    );

    if (entityResult.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'ASIN entity not found' });
    }

    const entity = entityResult.rows[0];

    // Create sync job
    const jobResult = await dbQuery(`
      INSERT INTO jobs (job_type, scope_type, asin_entity_id, input_json, created_by)
      VALUES ('SYNC_KEEPA_ASIN', 'ASIN', $1, $2, 'user')
      RETURNING *
    `, [asinEntityId, JSON.stringify({
      asin: entity.asin,
      marketplace_id: entity.marketplace_id,
      asin_entity_id: asinEntityId,
    })]);

    return wrapResponse({ job_id: jobResult.rows[0].id, status: 'PENDING' });
  });

  /**
   * GET /api/v2/listings/:listingId/keepa
   * Get Keepa data for a listing (via its ASIN)
   */
  fastify.get('/api/v2/listings/:listingId/keepa', async (request, reply) => {
    const { query: dbQuery } = await import('../database/connection.js');
    const listingId = parseInt(request.params.listingId, 10);

    // Get listing ASIN
    const listingResult = await dbQuery(
      'SELECT asin, marketplace_id FROM listings WHERE id = $1',
      [listingId]
    );

    if (listingResult.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'Listing not found' });
    }

    const listing = listingResult.rows[0];

    if (!listing.asin) {
      return wrapResponse({ listing_id: listingId, keepa: null, message: 'Listing has no ASIN' });
    }

    // Get latest Keepa snapshot
    const result = await dbQuery(`
      SELECT ks.id, ks.asin, ks.parsed_json, ks.captured_at
      FROM keepa_snapshots ks
      WHERE ks.asin = $1 AND ks.marketplace_id = $2
      ORDER BY ks.captured_at DESC
      LIMIT 1
    `, [listing.asin, listing.marketplace_id]);

    if (result.rows.length === 0) {
      return wrapResponse({ listing_id: listingId, asin: listing.asin, keepa: null, message: 'No Keepa data available' });
    }

    return wrapResponse({
      listing_id: listingId,
      asin: listing.asin,
      snapshot_id: result.rows[0].id,
      data: result.rows[0].parsed_json,
      captured_at: result.rows[0].captured_at,
    });
  });

  // ============================================================================
  // FEATURE STORE (Slice C)
  // ============================================================================

  /**
   * GET /api/v2/listings/:listingId/features
   * Get computed features for a listing
   */
  fastify.get('/api/v2/listings/:listingId/features', async (request, reply) => {
    const listingId = parseInt(request.params.listingId, 10);
    const featureStoreService = await import('../services/feature-store.service.js');

    const features = await featureStoreService.getLatestFeatures('LISTING', listingId);

    if (!features) {
      return wrapResponse({ listing_id: listingId, features: null, message: 'No features computed yet' });
    }

    return wrapResponse({
      listing_id: listingId,
      feature_store_id: features.id,
      feature_version: features.feature_version,
      features: features.features_json,
      computed_at: features.computed_at,
    });
  });

  /**
   * POST /api/v2/listings/:listingId/features/refresh
   * Trigger feature computation for a listing
   */
  fastify.post('/api/v2/listings/:listingId/features/refresh', async (request, reply) => {
    const { query: dbQuery } = await import('../database/connection.js');
    const listingId = parseInt(request.params.listingId, 10);

    // Verify listing exists
    const listingResult = await dbQuery('SELECT id FROM listings WHERE id = $1', [listingId]);
    if (listingResult.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'Listing not found' });
    }

    // Create feature computation job
    const jobResult = await dbQuery(`
      INSERT INTO jobs (job_type, scope_type, listing_id, created_by)
      VALUES ('COMPUTE_FEATURES_LISTING', 'LISTING', $1, 'user')
      RETURNING *
    `, [listingId]);

    return wrapResponse({ job_id: jobResult.rows[0].id, status: 'PENDING' });
  });

  /**
   * GET /api/v2/asins/:id/features
   * Get computed features for an ASIN entity
   */
  fastify.get('/api/v2/asins/:id/features', async (request, reply) => {
    const asinEntityId = parseInt(request.params.id, 10);
    const featureStoreService = await import('../services/feature-store.service.js');

    const features = await featureStoreService.getLatestFeatures('ASIN', asinEntityId);

    if (!features) {
      return wrapResponse({ asin_entity_id: asinEntityId, features: null, message: 'No features computed yet' });
    }

    return wrapResponse({
      asin_entity_id: asinEntityId,
      feature_store_id: features.id,
      feature_version: features.feature_version,
      features: features.features_json,
      computed_at: features.computed_at,
    });
  });

  /**
   * POST /api/v2/asins/:id/features/refresh
   * Trigger feature computation for an ASIN entity
   */
  fastify.post('/api/v2/asins/:id/features/refresh', async (request, reply) => {
    const { query: dbQuery } = await import('../database/connection.js');
    const asinEntityId = parseInt(request.params.id, 10);

    // Verify entity exists
    const entityResult = await dbQuery('SELECT id FROM asin_entities WHERE id = $1', [asinEntityId]);
    if (entityResult.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'ASIN entity not found' });
    }

    // Create feature computation job
    const jobResult = await dbQuery(`
      INSERT INTO jobs (job_type, scope_type, asin_entity_id, input_json, created_by)
      VALUES ('COMPUTE_FEATURES_ASIN', 'ASIN', $1, $2, 'user')
      RETURNING *
    `, [asinEntityId, JSON.stringify({ asin_entity_id: asinEntityId })]);

    return wrapResponse({ job_id: jobResult.rows[0].id, status: 'PENDING' });
  });

  // ============================================================================
  // RECOMMENDATIONS (Slice D)
  // ============================================================================

  /**
   * GET /api/v2/recommendations
   * Get all pending recommendations
   */
  fastify.get('/api/v2/recommendations', async (request, reply) => {
    const recommendationService = await import('../services/recommendation.service.js');
    const { entity_type, type, limit = '50' } = request.query;

    const recommendations = await recommendationService.getPendingRecommendations({
      entityType: entity_type,
      type,
      limit: parseInt(limit, 10),
    });

    return wrapResponse(recommendations);
  });

  /**
   * GET /api/v2/recommendations/stats
   * Get recommendation summary statistics
   */
  fastify.get('/api/v2/recommendations/stats', async (request, reply) => {
    const { query: dbQuery } = await import('../database/connection.js');

    // Get counts by status
    const statusResult = await dbQuery(`
      SELECT status, COUNT(*)::int as count
      FROM recommendations
      GROUP BY status
    `);

    // Get counts by type
    const typeResult = await dbQuery(`
      SELECT type, COUNT(*)::int as count
      FROM recommendations
      WHERE status = 'PENDING'
      GROUP BY type
    `);

    // Get counts by severity
    const severityResult = await dbQuery(`
      SELECT severity, COUNT(*)::int as count
      FROM recommendations
      WHERE status = 'PENDING'
      GROUP BY severity
    `);

    // Get total pending
    const totalResult = await dbQuery(`
      SELECT COUNT(*)::int as total
      FROM recommendations
      WHERE status = 'PENDING'
    `);

    const by_status = {};
    statusResult.rows.forEach(row => { by_status[row.status] = row.count; });

    const by_type = {};
    typeResult.rows.forEach(row => { by_type[row.type] = row.count; });

    const by_severity = {};
    severityResult.rows.forEach(row => { by_severity[row.severity] = row.count; });

    return wrapResponse({
      total: totalResult.rows[0]?.total || 0,
      by_status,
      by_type,
      by_severity,
    });
  });

  /**
   * GET /api/v2/recommendations/:id
   * Get a specific recommendation
   */
  fastify.get('/api/v2/recommendations/:id', async (request, reply) => {
    const recommendationService = await import('../services/recommendation.service.js');
    const recommendationId = parseInt(request.params.id, 10);

    const recommendation = await recommendationService.getRecommendation(recommendationId);
    if (!recommendation) {
      return reply.status(404).send({ success: false, error: 'Recommendation not found' });
    }

    return wrapResponse(recommendation);
  });

  /**
   * POST /api/v2/recommendations/:id/accept
   * Accept a recommendation
   */
  fastify.post('/api/v2/recommendations/:id/accept', async (request, reply) => {
    const recommendationService = await import('../services/recommendation.service.js');
    const recommendationId = parseInt(request.params.id, 10);
    const { reason } = request.body || {};

    try {
      const result = await recommendationService.acceptRecommendation(recommendationId, reason);
      return wrapResponse(result);
    } catch (error) {
      return reply.status(400).send({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/v2/recommendations/:id/reject
   * Reject a recommendation
   */
  fastify.post('/api/v2/recommendations/:id/reject', async (request, reply) => {
    const recommendationService = await import('../services/recommendation.service.js');
    const recommendationId = parseInt(request.params.id, 10);
    const { reason } = request.body || {};

    try {
      const result = await recommendationService.rejectRecommendation(recommendationId, reason);
      return wrapResponse(result);
    } catch (error) {
      return reply.status(400).send({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/v2/recommendations/:id/snooze
   * Snooze a recommendation
   */
  fastify.post('/api/v2/recommendations/:id/snooze', async (request, reply) => {
    const recommendationService = await import('../services/recommendation.service.js');
    const recommendationId = parseInt(request.params.id, 10);
    const { days = 7, reason } = request.body || {};

    try {
      const result = await recommendationService.snoozeRecommendation(recommendationId, days, reason);
      return wrapResponse(result);
    } catch (error) {
      return reply.status(400).send({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/v2/listings/:listingId/recommendations
   * Get recommendations for a listing
   */
  fastify.get('/api/v2/listings/:listingId/recommendations', async (request, reply) => {
    const recommendationService = await import('../services/recommendation.service.js');
    const listingId = parseInt(request.params.listingId, 10);
    const { status, limit = '20' } = request.query;

    const recommendations = await recommendationService.getRecommendationsForEntity(
      'LISTING',
      listingId,
      { status, limit: parseInt(limit, 10) }
    );

    return wrapResponse(recommendations);
  });

  /**
   * POST /api/v2/listings/:listingId/recommendations/refresh
   * Trigger recommendation generation for a listing
   */
  fastify.post('/api/v2/listings/:listingId/recommendations/refresh', async (request, reply) => {
    const { query: dbQuery } = await import('../database/connection.js');
    const listingId = parseInt(request.params.listingId, 10);

    // Verify listing exists
    const listingResult = await dbQuery('SELECT id FROM listings WHERE id = $1', [listingId]);
    if (listingResult.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'Listing not found' });
    }

    // Create recommendation generation job
    const jobResult = await dbQuery(`
      INSERT INTO jobs (job_type, scope_type, listing_id, created_by)
      VALUES ('GENERATE_RECOMMENDATIONS_LISTING', 'LISTING', $1, 'user')
      RETURNING *
    `, [listingId]);

    return wrapResponse({ job_id: jobResult.rows[0].id, status: 'PENDING' });
  });

  /**
   * GET /api/v2/asins/:id/recommendations
   * Get recommendations for an ASIN entity
   */
  fastify.get('/api/v2/asins/:id/recommendations', async (request, reply) => {
    const recommendationService = await import('../services/recommendation.service.js');
    const asinEntityId = parseInt(request.params.id, 10);
    const { status, limit = '20' } = request.query;

    const recommendations = await recommendationService.getRecommendationsForEntity(
      'ASIN',
      asinEntityId,
      { status, limit: parseInt(limit, 10) }
    );

    return wrapResponse(recommendations);
  });

  /**
   * POST /api/v2/asins/:id/recommendations/refresh
   * Trigger recommendation generation for an ASIN entity
   */
  fastify.post('/api/v2/asins/:id/recommendations/refresh', async (request, reply) => {
    const { query: dbQuery } = await import('../database/connection.js');
    const asinEntityId = parseInt(request.params.id, 10);

    // Verify entity exists
    const entityResult = await dbQuery('SELECT id FROM asin_entities WHERE id = $1', [asinEntityId]);
    if (entityResult.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'ASIN entity not found' });
    }

    // Create recommendation generation job
    const jobResult = await dbQuery(`
      INSERT INTO jobs (job_type, scope_type, asin_entity_id, input_json, created_by)
      VALUES ('GENERATE_RECOMMENDATIONS_ASIN', 'ASIN', $1, $2, 'user')
      RETURNING *
    `, [asinEntityId, JSON.stringify({ asin_entity_id: asinEntityId })]);

    return wrapResponse({ job_id: jobResult.rows[0].id, status: 'PENDING' });
  });

  // ============================================================================
  // SLICE E: ASIN ANALYZER + RESEARCH POOL + CONVERT TO LISTING
  // ============================================================================

  /**
   * GET /api/v2/asins/:id/bom
   * Get scenario BOM for an ASIN entity
   */
  fastify.get('/api/v2/asins/:id/bom', async (request, reply) => {
    const { query: dbQuery } = await import('../database/connection.js');
    const asinEntityId = parseInt(request.params.id, 10);

    // Get active scenario BOM for this ASIN
    const bomResult = await dbQuery(`
      SELECT b.id, b.name, b.version, b.is_active, b.created_at, b.updated_at
      FROM boms b
      WHERE b.asin_entity_id = $1 AND b.scope_type = 'ASIN_SCENARIO' AND b.is_active = true
      ORDER BY b.version DESC
      LIMIT 1
    `, [asinEntityId]);

    if (bomResult.rows.length === 0) {
      return wrapResponse({ asin_entity_id: asinEntityId, bom: null, message: 'No scenario BOM exists' });
    }

    const bom = bomResult.rows[0];

    // Get BOM lines with component details
    const linesResult = await dbQuery(`
      SELECT bl.id, bl.component_id, bl.quantity, bl.wastage_rate, bl.notes,
             c.name as component_name, c.sku as component_sku, c.unit_cost_ex_vat,
             ROUND(bl.quantity * (1 + bl.wastage_rate) * c.unit_cost_ex_vat, 2) as line_cost_ex_vat
      FROM bom_lines bl
      JOIN components c ON c.id = bl.component_id
      WHERE bl.bom_id = $1
      ORDER BY c.name
    `, [bom.id]);

    const totalCost = linesResult.rows.reduce((sum, line) => sum + parseFloat(line.line_cost_ex_vat || 0), 0);

    return wrapResponse({
      asin_entity_id: asinEntityId,
      bom: {
        ...bom,
        lines: linesResult.rows,
        total_cost_ex_vat: Math.round(totalCost * 100) / 100,
      },
    });
  });

  /**
   * POST /api/v2/asins/:id/bom
   * Create or update scenario BOM for an ASIN entity
   * Body: { name?, lines: [{ component_id, quantity, wastage_rate?, notes? }] }
   */
  fastify.post('/api/v2/asins/:id/bom', async (request, reply) => {
    const { query: dbQuery, transaction } = await import('../database/connection.js');
    const asinEntityId = parseInt(request.params.id, 10);
    const { name, lines = [] } = request.body;

    // Verify ASIN entity exists
    const entityResult = await dbQuery(
      'SELECT id, asin FROM asin_entities WHERE id = $1',
      [asinEntityId]
    );

    if (entityResult.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'ASIN entity not found' });
    }

    const entity = entityResult.rows[0];

    try {
      const result = await transaction(async (client) => {
        // Get current active BOM version for this ASIN
        const currentBomResult = await client.query(`
          SELECT id, version FROM boms
          WHERE asin_entity_id = $1 AND scope_type = 'ASIN_SCENARIO' AND is_active = true
          ORDER BY version DESC
          LIMIT 1
        `, [asinEntityId]);

        let newVersion = 1;
        if (currentBomResult.rows.length > 0) {
          // Deactivate current BOM
          await client.query(
            'UPDATE boms SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
            [currentBomResult.rows[0].id]
          );
          newVersion = currentBomResult.rows[0].version + 1;
        }

        // Create new BOM
        const bomName = name || `Scenario BOM for ${entity.asin} v${newVersion}`;
        const newBomResult = await client.query(`
          INSERT INTO boms (asin_entity_id, scope_type, name, version, is_active, created_by)
          VALUES ($1, 'ASIN_SCENARIO', $2, $3, true, 'user')
          RETURNING *
        `, [asinEntityId, bomName, newVersion]);

        const newBom = newBomResult.rows[0];

        // Insert BOM lines
        const insertedLines = [];
        for (const line of lines) {
          if (!line.component_id || !line.quantity) continue;

          const lineResult = await client.query(`
            INSERT INTO bom_lines (bom_id, component_id, quantity, wastage_rate, notes)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
          `, [
            newBom.id,
            line.component_id,
            line.quantity,
            line.wastage_rate || 0,
            line.notes || null,
          ]);
          insertedLines.push(lineResult.rows[0]);
        }

        return { bom: newBom, lines: insertedLines };
      });

      // Calculate total cost
      const linesWithCost = await dbQuery(`
        SELECT bl.*, c.unit_cost_ex_vat,
               ROUND(bl.quantity * (1 + bl.wastage_rate) * c.unit_cost_ex_vat, 2) as line_cost_ex_vat
        FROM bom_lines bl
        JOIN components c ON c.id = bl.component_id
        WHERE bl.bom_id = $1
      `, [result.bom.id]);

      const totalCost = linesWithCost.rows.reduce((sum, line) => sum + parseFloat(line.line_cost_ex_vat || 0), 0);

      // Trigger feature recomputation
      await dbQuery(`
        INSERT INTO jobs (job_type, scope_type, asin_entity_id, input_json, created_by)
        VALUES ('COMPUTE_FEATURES_ASIN', 'ASIN', $1, $2, 'system')
      `, [asinEntityId, JSON.stringify({ asin_entity_id: asinEntityId, trigger: 'bom_update' })]);

      return reply.status(201).send(wrapResponse({
        asin_entity_id: asinEntityId,
        bom_id: result.bom.id,
        version: result.bom.version,
        lines_count: result.lines.length,
        total_cost_ex_vat: Math.round(totalCost * 100) / 100,
      }));
    } catch (error) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  /**
   * Convert ASIN to listing handler (shared between /convert and /convert-to-listing)
   */
  async function handleConvertAsinToListing(request, reply) {
    const { query: dbQuery, transaction } = await import('../database/connection.js');
    const asinEntityId = parseInt(request.params.id, 10);

    // Accept both backend field names and frontend field names
    const {
      sku,
      seller_sku,  // Frontend field name alias
      title,
      price_inc_vat,
      initial_price_inc_vat,  // Frontend field name alias
      available_quantity,
      initial_quantity,  // Frontend field name alias
      copy_scenario_bom,
      bom_id,  // Frontend sends bom_id, treat as truthy for copy_scenario_bom
    } = request.body;

    // Resolve field aliases (frontend names take precedence if both provided)
    const finalSku = seller_sku || sku;
    const finalPrice = initial_price_inc_vat ?? price_inc_vat;
    const finalQuantity = initial_quantity ?? available_quantity ?? 0;
    const shouldCopyBom = bom_id !== undefined ? !!bom_id : (copy_scenario_bom ?? true);

    if (!finalSku) {
      return reply.status(400).send({ success: false, error: 'SKU is required (use sku or seller_sku)' });
    }

    // Verify ASIN entity exists and get its data
    const entityResult = await dbQuery(`
      SELECT ae.*, m.vat_rate
      FROM asin_entities ae
      JOIN marketplaces m ON m.id = ae.marketplace_id
      WHERE ae.id = $1
    `, [asinEntityId]);

    if (entityResult.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'ASIN entity not found' });
    }

    const entity = entityResult.rows[0];

    // Check if listing already exists for this ASIN in this marketplace
    const existingListingResult = await dbQuery(`
      SELECT id, sku FROM listings
      WHERE asin = $1 AND marketplace_id = $2
    `, [entity.asin, entity.marketplace_id]);

    if (existingListingResult.rows.length > 0) {
      return reply.status(409).send({
        success: false,
        error: 'A listing already exists for this ASIN',
        existing_listing_id: existingListingResult.rows[0].id,
        existing_sku: existingListingResult.rows[0].sku,
      });
    }

    // Check if SKU already exists
    const existingSkuResult = await dbQuery(
      'SELECT id FROM listings WHERE sku = $1 AND marketplace_id = $2',
      [finalSku, entity.marketplace_id]
    );

    if (existingSkuResult.rows.length > 0) {
      return reply.status(409).send({
        success: false,
        error: 'SKU already exists in this marketplace',
        existing_listing_id: existingSkuResult.rows[0].id,
      });
    }

    try {
      const result = await transaction(async (client) => {
        // Get price from Keepa data if not provided
        let resolvedPrice = finalPrice;
        if (!resolvedPrice) {
          const keepaResult = await client.query(`
            SELECT parsed_json FROM keepa_snapshots
            WHERE asin_entity_id = $1
            ORDER BY captured_at DESC
            LIMIT 1
          `, [asinEntityId]);

          if (keepaResult.rows.length > 0 && keepaResult.rows[0].parsed_json?.metrics?.price_current) {
            resolvedPrice = keepaResult.rows[0].parsed_json.metrics.price_current;
          } else {
            resolvedPrice = 0; // Placeholder, user must edit
          }
        }

        // Create listing
        const listingResult = await client.query(`
          INSERT INTO listings (
            marketplace_id, sku, asin, title, price_inc_vat,
            available_quantity, status, created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', 'user')
          RETURNING *
        `, [
          entity.marketplace_id,
          finalSku,
          entity.asin,
          title || entity.title || `Listing for ${entity.asin}`,
          resolvedPrice,
          finalQuantity,
        ]);

        const listing = listingResult.rows[0];

        // Link ASIN entity to listing
        await client.query(`
          UPDATE asin_entities
          SET listing_id = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [listing.id, asinEntityId]);

        // Copy scenario BOM to listing BOM if requested
        let copiedBomId = null;
        if (shouldCopyBom) {
          const scenarioBomResult = await client.query(`
            SELECT id FROM boms
            WHERE asin_entity_id = $1 AND scope_type = 'ASIN_SCENARIO' AND is_active = true
            ORDER BY version DESC
            LIMIT 1
          `, [asinEntityId]);

          if (scenarioBomResult.rows.length > 0) {
            const scenarioBomId = scenarioBomResult.rows[0].id;

            // Create new BOM for listing
            const newBomResult = await client.query(`
              INSERT INTO boms (listing_id, scope_type, name, version, is_active, created_by)
              VALUES ($1, 'LISTING', $2, 1, true, 'user')
              RETURNING *
            `, [listing.id, `BOM for ${finalSku}`]);

            copiedBomId = newBomResult.rows[0].id;

            // Copy BOM lines
            await client.query(`
              INSERT INTO bom_lines (bom_id, component_id, quantity, wastage_rate, notes)
              SELECT $1, component_id, quantity, wastage_rate, notes
              FROM bom_lines
              WHERE bom_id = $2
            `, [copiedBomId, scenarioBomId]);
          }
        }

        return { listing, copiedBomId };
      });

      // Create jobs to compute features and economics
      await dbQuery(`
        INSERT INTO jobs (job_type, scope_type, listing_id, created_by)
        VALUES ('COMPUTE_FEATURES_LISTING', 'LISTING', $1, 'system')
      `, [result.listing.id]);

      // Return response matching frontend ConvertToListingResponse
      return reply.status(201).send(wrapResponse({
        listing_id: result.listing.id,
        seller_sku: result.listing.sku,
        asin: result.listing.asin,
        asin_entity_id: asinEntityId,
        bom_copied: result.copiedBomId !== null,
        bom_id: result.copiedBomId,
      }));
    } catch (error) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  }

  // Register both /convert and /convert-to-listing routes (frontend uses /convert)
  fastify.post('/api/v2/asins/:id/convert', handleConvertAsinToListing);
  fastify.post('/api/v2/asins/:id/convert-to-listing', handleConvertAsinToListing);

  /**
   * GET /api/v2/asins/:id/analysis
   * Get cached analysis for an ASIN entity (frontend compatibility)
   */
  fastify.get('/api/v2/asins/:id/analysis', async (request, reply) => {
    const { query: dbQuery } = await import('../database/connection.js');
    const asinEntityId = parseInt(request.params.id, 10);

    // Get ASIN entity
    const entityResult = await dbQuery(`
      SELECT ae.*, m.name as marketplace_name, m.vat_rate
      FROM asin_entities ae
      JOIN marketplaces m ON m.id = ae.marketplace_id
      WHERE ae.id = $1
    `, [asinEntityId]);

    if (entityResult.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'ASIN entity not found' });
    }

    const entity = entityResult.rows[0];

    // Get latest features
    const featureStoreService = await import('../services/feature-store.service.js');
    const features = await featureStoreService.getLatestFeatures('ASIN', asinEntityId);

    // Get latest Keepa snapshot
    const keepaResult = await dbQuery(`
      SELECT parsed_json, captured_at
      FROM keepa_snapshots
      WHERE asin_entity_id = $1
      ORDER BY captured_at DESC
      LIMIT 1
    `, [asinEntityId]);

    const keepaData = keepaResult.rows[0]?.parsed_json || {};
    const keepaMetrics = keepaData.metrics || {};
    const featuresJson = features?.features_json || {};

    // Build analysis response matching frontend AsinAnalysis interface
    const analysis = {
      asin_entity_id: asinEntityId,
      asin: entity.asin,
      market_data: {
        keepa_price_median_90d: keepaMetrics.price_median_90d || null,
        keepa_price_p25_90d: keepaMetrics.price_p25_90d || null,
        keepa_price_p75_90d: keepaMetrics.price_p75_90d || null,
        keepa_volatility_90d: keepaMetrics.volatility_90d || null,
        keepa_offers_count_current: keepaMetrics.offers_count_current || null,
        keepa_rank_trend_90d: keepaMetrics.rank_trend_90d || null,
      },
      economics_scenario: featuresJson.has_scenario_bom ? {
        suggested_price_inc_vat: keepaMetrics.price_current || 0,
        bom_cost_ex_vat: featuresJson.scenario_bom_cost_ex_vat || 0,
        estimated_fees_ex_vat: (keepaMetrics.price_current || 0) * 0.15, // ~15% Amazon fee estimate
        estimated_profit_ex_vat: featuresJson.opportunity_profit || 0,
        estimated_margin: featuresJson.opportunity_margin || 0,
      } : null,
      opportunity_score: featuresJson.opportunity_score || null,
      recommendation: featuresJson.recommendation || null,
      analyzed_at: features?.computed_at || keepaResult.rows[0]?.captured_at || new Date().toISOString(),
    };

    return wrapResponse(analysis);
  });

  /**
   * GET /api/v2/research-pool
   * Get research pool (tracked ASINs) with computed opportunity metrics
   */
  fastify.get('/api/v2/research-pool', async (request, reply) => {
    const { query: dbQuery } = await import('../database/connection.js');
    const { limit = '50', offset = '0', sort_by = 'opportunity_margin', sort_dir = 'desc' } = request.query;

    // Valid sort columns
    const validSortColumns = ['opportunity_margin', 'opportunity_profit', 'tracked_at', 'updated_at', 'asin'];
    const sortColumn = validSortColumns.includes(sort_by) ? sort_by : 'tracked_at';
    const sortDirection = sort_dir.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // Get tracked ASINs with their latest features
    const result = await dbQuery(`
      SELECT
        ae.id as asin_entity_id,
        ae.asin,
        ae.marketplace_id,
        ae.title,
        ae.brand,
        ae.category,
        ae.is_tracked,
        ae.tracked_at,
        ae.listing_id,
        ae.updated_at,
        m.name as marketplace_name,
        m.currency_code,
        fs.features_json,
        fs.computed_at as features_computed_at,
        ks.parsed_json as keepa_data,
        ks.captured_at as keepa_captured_at,
        -- Extract key metrics for sorting
        COALESCE((fs.features_json->>'opportunity_margin')::numeric, 0) as opportunity_margin,
        COALESCE((fs.features_json->>'opportunity_profit')::numeric, 0) as opportunity_profit,
        COALESCE((fs.features_json->>'scenario_bom_cost_ex_vat')::numeric, 0) as bom_cost,
        COALESCE(ks.parsed_json->'metrics'->>'price_current', '0')::numeric as current_price,
        COALESCE(ks.parsed_json->'metrics'->>'offers_count_current', '0')::int as competition_count
      FROM asin_entities ae
      JOIN marketplaces m ON m.id = ae.marketplace_id
      LEFT JOIN LATERAL (
        SELECT features_json, computed_at
        FROM feature_store
        WHERE entity_type = 'ASIN' AND entity_id = ae.id
        ORDER BY computed_at DESC
        LIMIT 1
      ) fs ON true
      LEFT JOIN LATERAL (
        SELECT parsed_json, captured_at
        FROM keepa_snapshots
        WHERE asin_entity_id = ae.id
        ORDER BY captured_at DESC
        LIMIT 1
      ) ks ON true
      WHERE ae.is_tracked = true
      ORDER BY ${sortColumn} ${sortDirection} NULLS LAST
      LIMIT $1 OFFSET $2
    `, [parseInt(limit, 10), parseInt(offset, 10)]);

    // Get total count
    const countResult = await dbQuery(
      'SELECT COUNT(*) as total FROM asin_entities WHERE is_tracked = true'
    );

    // Transform results to include computed opportunity metrics
    const items = result.rows.map(row => {
      const features = row.features_json || {};
      const keepaMetrics = row.keepa_data?.metrics || {};

      // Calculate opportunity score (simple weighted score)
      let opportunityScore = 0;
      if (features.opportunity_margin > 0.15) opportunityScore += 30;
      else if (features.opportunity_margin > 0.10) opportunityScore += 20;
      else if (features.opportunity_margin > 0.05) opportunityScore += 10;

      if (row.competition_count < 5) opportunityScore += 20;
      else if (row.competition_count < 10) opportunityScore += 10;

      if (features.has_scenario_bom) opportunityScore += 15;

      return {
        asin_entity_id: row.asin_entity_id,
        asin: row.asin,
        marketplace_id: row.marketplace_id,
        marketplace_name: row.marketplace_name,
        currency_code: row.currency_code,
        title: row.title,
        brand: row.brand,
        category: row.category,
        tracked_at: row.tracked_at,
        listing_id: row.listing_id,
        is_converted: row.listing_id !== null,

        // Keepa metrics
        current_price: keepaMetrics.price_current || null,
        price_median_90d: keepaMetrics.price_median_90d || null,
        competition_count: keepaMetrics.offers_count_current || null,
        sales_rank: keepaMetrics.sales_rank_current || null,

        // Scenario metrics
        has_scenario_bom: features.has_scenario_bom || false,
        scenario_bom_cost: features.scenario_bom_cost_ex_vat || null,
        opportunity_profit: features.opportunity_profit || null,
        opportunity_margin: features.opportunity_margin || null,

        // Computed score
        opportunity_score: opportunityScore,

        // Data freshness
        features_computed_at: row.features_computed_at,
        keepa_captured_at: row.keepa_captured_at,
      };
    });

    return wrapResponse({
      items,
      total: parseInt(countResult.rows[0].total, 10),
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
  });

  /**
   * GET /api/v2/research-pool/summary
   * Get summary statistics for the research pool
   */
  fastify.get('/api/v2/research-pool/summary', async (request, reply) => {
    const { query: dbQuery } = await import('../database/connection.js');

    const result = await dbQuery(`
      SELECT
        COUNT(*) as total_tracked,
        COUNT(CASE WHEN listing_id IS NOT NULL THEN 1 END) as converted_count,
        COUNT(CASE WHEN listing_id IS NULL THEN 1 END) as unconverted_count
      FROM asin_entities
      WHERE is_tracked = true
    `);

    // Get ASINs with high opportunity (margin > 15%)
    const opportunityResult = await dbQuery(`
      SELECT COUNT(*) as high_opportunity_count
      FROM asin_entities ae
      JOIN LATERAL (
        SELECT features_json
        FROM feature_store
        WHERE entity_type = 'ASIN' AND entity_id = ae.id
        ORDER BY computed_at DESC
        LIMIT 1
      ) fs ON true
      WHERE ae.is_tracked = true
        AND (fs.features_json->>'opportunity_margin')::numeric > 0.15
    `);

    // Get ASINs with scenario BOMs
    const bomResult = await dbQuery(`
      SELECT COUNT(DISTINCT asin_entity_id) as with_bom_count
      FROM boms
      WHERE scope_type = 'ASIN_SCENARIO' AND is_active = true AND asin_entity_id IS NOT NULL
    `);

    const stats = result.rows[0];

    return wrapResponse({
      total_tracked: parseInt(stats.total_tracked, 10),
      converted_count: parseInt(stats.converted_count, 10),
      unconverted_count: parseInt(stats.unconverted_count, 10),
      with_scenario_bom: parseInt(bomResult.rows[0].with_bom_count, 10),
      high_opportunity_count: parseInt(opportunityResult.rows[0].high_opportunity_count, 10),
    });
  });

  // ============================================================================
  // HEALTH CHECK
  // ============================================================================

  fastify.get('/api/v2/health', async (request, reply) => {
    const { testConnection } = await import('../database/connection.js');
    const { getCredentialsStatus } = await import('../credentials-provider.js');

    const dbHealthy = await testConnection();
    const credentials = getCredentialsStatus();

    return wrapResponse({
      status: dbHealthy ? 'healthy' : 'unhealthy',
      version: 'v2',
      timestamp: new Date().toISOString(),
      database: dbHealthy,
      credentials,
    });
  });
}

export default registerV2Routes;
