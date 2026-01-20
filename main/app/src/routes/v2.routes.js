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
      return reply.status(400).send({ error: 'price_inc_vat is required' });
    }

    const newPriceIncVat = parseFloat(price_inc_vat);
    if (isNaN(newPriceIncVat) || newPriceIncVat < 0) {
      return reply.status(400).send({ error: 'price_inc_vat must be a positive number' });
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

      return {
        listing_id: listingId,
        current: {
          price_inc_vat: currentEconomics.price_inc_vat,
          profit_ex_vat: currentEconomics.profit_ex_vat,
          margin: currentEconomics.margin,
        },
        proposed: {
          price_inc_vat: newEconomics.price_inc_vat,
          price_ex_vat: newEconomics.price_ex_vat,
          profit_ex_vat: newEconomics.profit_ex_vat,
          margin: newEconomics.margin,
          break_even_price_inc_vat: newEconomics.break_even_price_inc_vat,
        },
        impact: {
          price_change: newPriceIncVat - currentEconomics.price_inc_vat,
          price_change_pct: currentEconomics.price_inc_vat > 0
            ? (newPriceIncVat - currentEconomics.price_inc_vat) / currentEconomics.price_inc_vat
            : 0,
          profit_change: newEconomics.profit_ex_vat - currentEconomics.profit_ex_vat,
          margin_change: newEconomics.margin - currentEconomics.margin,
        },
        inventory: {
          available_quantity: availableQuantity,
          sales_velocity_30d: Math.round(salesVelocity * 100) / 100,
          days_of_cover: daysOfCover !== null ? Math.round(daysOfCover * 10) / 10 : null,
        },
        guardrails: guardrailsResult,
      };
    } catch (error) {
      if (error.message.includes('not found')) {
        return reply.status(404).send({ error: error.message });
      }
      return reply.status(500).send({ error: error.message });
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
      return reply.status(400).send({ error: 'price_inc_vat is required' });
    }
    if (!reason) {
      return reply.status(400).send({ error: 'reason is required' });
    }

    const newPriceIncVat = parseFloat(price_inc_vat);
    if (isNaN(newPriceIncVat) || newPriceIncVat < 0) {
      return reply.status(400).send({ error: 'price_inc_vat must be a positive number' });
    }

    try {
      const { query: dbQuery, transaction } = await import('../database/connection.js');
      const { validatePriceChange, calculateDaysOfCover } = await import('../services/guardrails.service.js');
      const jobRepo = await import('../repositories/job.repository.js');
      const listingEventRepo = await import('../repositories/listing-event.repository.js');

      // Get current listing data
      const listingResult = await dbQuery(
        'SELECT id, price_inc_vat, available_quantity FROM listings WHERE id = $1',
        [listingId]
      );

      if (listingResult.rows.length === 0) {
        return reply.status(404).send({ error: `Listing not found: ${listingId}` });
      }

      const listing = listingResult.rows[0];
      const currentPriceIncVat = parseFloat(listing.price_inc_vat) || 0;

      // Calculate economics for guardrails
      const newEconomics = await economicsService.calculateEconomics(listingId, {
        price_inc_vat: newPriceIncVat,
      });

      // Get sales data for days of cover
      const salesResult = await dbQuery(`
        SELECT COALESCE(SUM(units), 0) as total_units
        FROM listing_sales_daily
        WHERE listing_id = $1
          AND date >= CURRENT_DATE - INTERVAL '30 days'
      `, [listingId]);

      const totalUnits30d = parseInt(salesResult.rows[0]?.total_units || 0, 10);
      const salesVelocity = totalUnits30d / 30;
      const daysOfCover = calculateDaysOfCover(listing.available_quantity || 0, salesVelocity);

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
          error: 'Guardrails check failed',
          guardrails: guardrailsResult,
        });
      }

      // Create job and event atomically
      const result = await transaction(async (client) => {
        // Create listing event (DRAFTED)
        const eventResult = await client.query(`
          INSERT INTO listing_events (
            listing_id, event_type, before_json, after_json, reason, correlation_id, created_by
          ) VALUES ($1, 'PRICE_CHANGE_DRAFTED', $2, $3, $4, $5, 'user')
          RETURNING *
        `, [
          listingId,
          JSON.stringify({ price_inc_vat: currentPriceIncVat }),
          JSON.stringify({ price_inc_vat: newPriceIncVat }),
          reason,
          correlation_id || null,
        ]);

        const listingEvent = eventResult.rows[0];

        // Create publish job
        const jobResult = await client.query(`
          INSERT INTO jobs (
            job_type, scope_type, listing_id, status, input_json, created_by
          ) VALUES ('PUBLISH_PRICE_CHANGE', 'LISTING', $1, 'PENDING', $2, 'user')
          RETURNING *
        `, [
          listingId,
          JSON.stringify({
            price_inc_vat: newPriceIncVat,
            previous_price_inc_vat: currentPriceIncVat,
            reason,
            correlation_id: correlation_id || null,
            listing_event_id: listingEvent.id,
          }),
        ]);

        const job = jobResult.rows[0];

        // Update event with job_id
        await client.query(
          'UPDATE listing_events SET job_id = $1 WHERE id = $2',
          [job.id, listingEvent.id]
        );

        return {
          job_id: job.id,
          status: job.status,
          listing_id: listingId,
          listing_event_id: listingEvent.id,
        };
      });

      return reply.status(201).send(result);
    } catch (error) {
      console.error('Price publish error:', error);
      return reply.status(500).send({ error: error.message });
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
      return reply.status(400).send({ error: 'available_quantity is required' });
    }

    const newQuantity = parseInt(available_quantity, 10);
    if (isNaN(newQuantity) || newQuantity < 0) {
      return reply.status(400).send({ error: 'available_quantity must be a non-negative integer' });
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
        return reply.status(404).send({ error: `Listing not found: ${listingId}` });
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

      return {
        listing_id: listingId,
        current: {
          available_quantity: currentQuantity,
          days_of_cover: currentDaysOfCover !== null ? Math.round(currentDaysOfCover * 10) / 10 : null,
          stockout_risk: currentStockoutRisk,
        },
        proposed: {
          available_quantity: newQuantity,
          days_of_cover: newDaysOfCover !== null ? Math.round(newDaysOfCover * 10) / 10 : null,
          stockout_risk: newStockoutRisk,
        },
        impact: {
          quantity_change: newQuantity - currentQuantity,
          days_of_cover_change: currentDaysOfCover !== null && newDaysOfCover !== null
            ? Math.round((newDaysOfCover - currentDaysOfCover) * 10) / 10
            : null,
        },
        sales: {
          velocity_30d: Math.round(salesVelocity * 100) / 100,
          units_30d: totalUnits30d,
        },
        guardrails: guardrailsResult,
      };
    } catch (error) {
      return reply.status(500).send({ error: error.message });
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
      return reply.status(400).send({ error: 'available_quantity is required' });
    }
    if (!reason) {
      return reply.status(400).send({ error: 'reason is required' });
    }

    const newQuantity = parseInt(available_quantity, 10);
    if (isNaN(newQuantity) || newQuantity < 0) {
      return reply.status(400).send({ error: 'available_quantity must be a non-negative integer' });
    }

    try {
      const { query: dbQuery, transaction } = await import('../database/connection.js');

      // Get current listing
      const listingResult = await dbQuery(
        'SELECT id, available_quantity FROM listings WHERE id = $1',
        [listingId]
      );

      if (listingResult.rows.length === 0) {
        return reply.status(404).send({ error: `Listing not found: ${listingId}` });
      }

      const listing = listingResult.rows[0];
      const currentQuantity = listing.available_quantity || 0;

      // Create job and event atomically
      const result = await transaction(async (client) => {
        // Create listing event (DRAFTED)
        const eventResult = await client.query(`
          INSERT INTO listing_events (
            listing_id, event_type, before_json, after_json, reason, created_by
          ) VALUES ($1, 'STOCK_CHANGE_DRAFTED', $2, $3, $4, 'user')
          RETURNING *
        `, [
          listingId,
          JSON.stringify({ available_quantity: currentQuantity }),
          JSON.stringify({ available_quantity: newQuantity }),
          reason,
        ]);

        const listingEvent = eventResult.rows[0];

        // Create publish job
        const jobResult = await client.query(`
          INSERT INTO jobs (
            job_type, scope_type, listing_id, status, input_json, created_by
          ) VALUES ('PUBLISH_STOCK_CHANGE', 'LISTING', $1, 'PENDING', $2, 'user')
          RETURNING *
        `, [
          listingId,
          JSON.stringify({
            available_quantity: newQuantity,
            previous_quantity: currentQuantity,
            reason,
            listing_event_id: listingEvent.id,
          }),
        ]);

        const job = jobResult.rows[0];

        // Update event with job_id
        await client.query(
          'UPDATE listing_events SET job_id = $1 WHERE id = $2',
          [job.id, listingEvent.id]
        );

        return {
          job_id: job.id,
          status: job.status,
          listing_id: listingId,
          listing_event_id: listingEvent.id,
        };
      });

      return reply.status(201).send(result);
    } catch (error) {
      console.error('Stock publish error:', error);
      return reply.status(500).send({ error: error.message });
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

    return { jobs, counts };
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
      return reply.status(404).send({ error: 'Job not found' });
    }

    return job;
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
      return reply.status(400).send({ error: 'Job cannot be cancelled (not pending or running)' });
    }

    return { success: true };
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

    return { events };
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
    return { history };
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
    return { history };
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

    return { events };
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
    return { guardrails };
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
      return summary;
    } catch (error) {
      if (error.message.includes('not found')) {
        return reply.status(404).send({ error: error.message });
      }
      return reply.status(500).send({ error: error.message });
    }
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
