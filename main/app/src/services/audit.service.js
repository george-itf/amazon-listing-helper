/**
 * Audit Service
 *
 * Records audit events for significant operations.
 * Provides comprehensive audit trail for debugging, compliance, and analytics.
 *
 * Event Types:
 * - Price/Stock publish operations (attempt, success, failure, simulated)
 * - Cost override changes
 * - BOM operations
 * - Settings updates
 * - Sync operations
 *
 * @module AuditService
 */

import { query } from '../database/connection.js';
import { logger } from '../lib/logger.js';
import { getWriteMode } from '../credentials-provider.js';

/**
 * Audit event types (must match DB enum)
 * @readonly
 * @enum {string}
 */
export const AUDIT_EVENT_TYPE = {
  // Price operations
  PRICE_PUBLISH_ATTEMPT: 'PRICE_PUBLISH_ATTEMPT',
  PRICE_PUBLISH_SUCCESS: 'PRICE_PUBLISH_SUCCESS',
  PRICE_PUBLISH_FAILURE: 'PRICE_PUBLISH_FAILURE',
  PRICE_PUBLISH_SIMULATED: 'PRICE_PUBLISH_SIMULATED',

  // Stock operations
  STOCK_PUBLISH_ATTEMPT: 'STOCK_PUBLISH_ATTEMPT',
  STOCK_PUBLISH_SUCCESS: 'STOCK_PUBLISH_SUCCESS',
  STOCK_PUBLISH_FAILURE: 'STOCK_PUBLISH_FAILURE',
  STOCK_PUBLISH_SIMULATED: 'STOCK_PUBLISH_SIMULATED',

  // Cost overrides
  COST_OVERRIDE_CREATED: 'COST_OVERRIDE_CREATED',
  COST_OVERRIDE_UPDATED: 'COST_OVERRIDE_UPDATED',
  COST_OVERRIDE_DELETED: 'COST_OVERRIDE_DELETED',

  // BOM operations
  BOM_CREATED: 'BOM_CREATED',
  BOM_UPDATED: 'BOM_UPDATED',
  BOM_ACTIVATED: 'BOM_ACTIVATED',

  // Settings
  SETTING_UPDATED: 'SETTING_UPDATED',
  GUARDRAIL_OVERRIDE: 'GUARDRAIL_OVERRIDE',

  // Sync operations
  AMAZON_SYNC_STARTED: 'AMAZON_SYNC_STARTED',
  AMAZON_SYNC_COMPLETED: 'AMAZON_SYNC_COMPLETED',
  AMAZON_SYNC_FAILED: 'AMAZON_SYNC_FAILED',
  KEEPA_SYNC_STARTED: 'KEEPA_SYNC_STARTED',
  KEEPA_SYNC_COMPLETED: 'KEEPA_SYNC_COMPLETED',
  KEEPA_SYNC_FAILED: 'KEEPA_SYNC_FAILED',
};

/**
 * Audit outcomes (must match DB enum)
 * @readonly
 * @enum {string}
 */
export const AUDIT_OUTCOME = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  SIMULATED: 'SIMULATED',
  BLOCKED: 'BLOCKED',
  PENDING: 'PENDING',
};

/**
 * Record an audit event
 *
 * @param {Object} params - Audit event parameters
 * @param {string} params.eventType - Type of event (from AUDIT_EVENT_TYPE)
 * @param {string} params.outcome - Outcome (from AUDIT_OUTCOME)
 * @param {string} [params.actorType='system'] - Type of actor ('system', 'api_key', 'user', 'worker')
 * @param {string} [params.actorId] - ID of the actor
 * @param {string} [params.entityType] - Type of entity affected
 * @param {number} [params.entityId] - ID of entity affected
 * @param {number} [params.listingId] - Listing ID if applicable
 * @param {string} [params.correlationId] - Client-provided correlation ID
 * @param {string} [params.requestId] - Server request ID
 * @param {Object} [params.before] - State before change
 * @param {Object} [params.after] - State after change
 * @param {string} [params.writeMode] - 'simulate' or 'live'
 * @param {boolean} [params.spApiCalled=false] - Whether SP-API was called
 * @param {Object} [params.spApiResponse] - SP-API response if called
 * @param {string} [params.errorCode] - Error code if failed
 * @param {string} [params.errorMessage] - Error message if failed
 * @param {Object} [params.metadata={}] - Additional metadata
 * @param {number} [params.durationMs] - Operation duration in milliseconds
 * @returns {Promise<number|null>} Audit event ID or null if recording failed
 */
export async function recordAuditEvent({
  eventType,
  outcome,
  actorType = 'system',
  actorId = null,
  entityType = null,
  entityId = null,
  listingId = null,
  correlationId = null,
  requestId = null,
  before = null,
  after = null,
  writeMode = null,
  spApiCalled = false,
  spApiResponse = null,
  errorCode = null,
  errorMessage = null,
  metadata = {},
  durationMs = null,
}) {
  try {
    // Auto-detect write mode if not provided
    const actualWriteMode = writeMode || getWriteMode();

    const result = await query(`
      INSERT INTO audit_events (
        event_type, outcome, actor_type, actor_id,
        entity_type, entity_id, listing_id,
        correlation_id, request_id,
        before_json, after_json,
        write_mode, sp_api_called, sp_api_response,
        error_code, error_message,
        metadata, duration_ms
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9,
        $10, $11,
        $12, $13, $14,
        $15, $16,
        $17, $18
      ) RETURNING id
    `, [
      eventType,
      outcome,
      actorType,
      actorId,
      entityType,
      entityId,
      listingId,
      correlationId,
      requestId,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      actualWriteMode,
      spApiCalled,
      spApiResponse ? JSON.stringify(spApiResponse) : null,
      errorCode,
      errorMessage,
      JSON.stringify(metadata),
      durationMs,
    ]);

    return result.rows[0]?.id || null;
  } catch (error) {
    // Don't let audit failures break the main operation
    // Log but don't throw
    if (error.message?.includes('does not exist')) {
      logger.warn('[Audit] audit_events table does not exist - run migration 007');
    } else {
      logger.error({ err: error, eventType }, '[Audit] Failed to record audit event');
    }
    return null;
  }
}

/**
 * Record a price publish audit event
 * Convenience wrapper for price operations
 */
export async function recordPricePublishAudit({
  listingId,
  previousPrice,
  newPrice,
  outcome,
  actorType = 'worker',
  correlationId = null,
  spApiCalled = false,
  spApiResponse = null,
  errorCode = null,
  errorMessage = null,
  durationMs = null,
}) {
  const eventType = outcome === AUDIT_OUTCOME.SUCCESS
    ? AUDIT_EVENT_TYPE.PRICE_PUBLISH_SUCCESS
    : outcome === AUDIT_OUTCOME.SIMULATED
      ? AUDIT_EVENT_TYPE.PRICE_PUBLISH_SIMULATED
      : AUDIT_EVENT_TYPE.PRICE_PUBLISH_FAILURE;

  return recordAuditEvent({
    eventType,
    outcome,
    actorType,
    entityType: 'listing',
    entityId: listingId,
    listingId,
    correlationId,
    before: { price_inc_vat: previousPrice },
    after: { price_inc_vat: newPrice },
    spApiCalled,
    spApiResponse,
    errorCode,
    errorMessage,
    durationMs,
  });
}

/**
 * Record a stock publish audit event
 * Convenience wrapper for stock operations
 */
export async function recordStockPublishAudit({
  listingId,
  previousQuantity,
  newQuantity,
  outcome,
  actorType = 'worker',
  correlationId = null,
  spApiCalled = false,
  spApiResponse = null,
  errorCode = null,
  errorMessage = null,
  durationMs = null,
}) {
  const eventType = outcome === AUDIT_OUTCOME.SUCCESS
    ? AUDIT_EVENT_TYPE.STOCK_PUBLISH_SUCCESS
    : outcome === AUDIT_OUTCOME.SIMULATED
      ? AUDIT_EVENT_TYPE.STOCK_PUBLISH_SIMULATED
      : AUDIT_EVENT_TYPE.STOCK_PUBLISH_FAILURE;

  return recordAuditEvent({
    eventType,
    outcome,
    actorType,
    entityType: 'listing',
    entityId: listingId,
    listingId,
    correlationId,
    before: { available_quantity: previousQuantity },
    after: { available_quantity: newQuantity },
    spApiCalled,
    spApiResponse,
    errorCode,
    errorMessage,
    durationMs,
  });
}

/**
 * Record a settings change audit event
 */
export async function recordSettingChangeAudit({
  settingKey,
  previousValue,
  newValue,
  actorType = 'api',
  actorId = null,
  requestId = null,
}) {
  return recordAuditEvent({
    eventType: AUDIT_EVENT_TYPE.SETTING_UPDATED,
    outcome: AUDIT_OUTCOME.SUCCESS,
    actorType,
    actorId,
    entityType: 'setting',
    requestId,
    before: { key: settingKey, value: previousValue },
    after: { key: settingKey, value: newValue },
    metadata: { setting_key: settingKey },
  });
}

/**
 * Record a cost override audit event
 */
export async function recordCostOverrideAudit({
  listingId,
  operation, // 'created', 'updated', 'deleted'
  previousOverrides = null,
  newOverrides = null,
  actorType = 'api',
  actorId = null,
}) {
  const eventTypeMap = {
    created: AUDIT_EVENT_TYPE.COST_OVERRIDE_CREATED,
    updated: AUDIT_EVENT_TYPE.COST_OVERRIDE_UPDATED,
    deleted: AUDIT_EVENT_TYPE.COST_OVERRIDE_DELETED,
  };

  return recordAuditEvent({
    eventType: eventTypeMap[operation] || AUDIT_EVENT_TYPE.COST_OVERRIDE_UPDATED,
    outcome: AUDIT_OUTCOME.SUCCESS,
    actorType,
    actorId,
    entityType: 'listing',
    entityId: listingId,
    listingId,
    before: previousOverrides,
    after: newOverrides,
  });
}

/**
 * Get recent audit events
 *
 * @param {Object} options - Query options
 * @param {string[]} [options.eventTypes] - Filter by event types
 * @param {string[]} [options.outcomes] - Filter by outcomes
 * @param {number} [options.listingId] - Filter by listing
 * @param {number} [options.limit=100] - Max results
 * @param {number} [options.offset=0] - Offset for pagination
 * @returns {Promise<Object[]>} Audit events
 */
export async function getRecentAuditEvents({
  eventTypes = null,
  outcomes = null,
  listingId = null,
  limit = 100,
  offset = 0,
} = {}) {
  try {
    let sql = `
      SELECT
        id, event_type, outcome, actor_type, actor_id,
        entity_type, entity_id, listing_id,
        correlation_id, request_id,
        before_json, after_json,
        write_mode, sp_api_called, sp_api_response,
        error_code, error_message,
        metadata, duration_ms, created_at
      FROM audit_events
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (eventTypes && eventTypes.length > 0) {
      sql += ` AND event_type = ANY($${paramIndex})`;
      params.push(eventTypes);
      paramIndex++;
    }

    if (outcomes && outcomes.length > 0) {
      sql += ` AND outcome = ANY($${paramIndex})`;
      params.push(outcomes);
      paramIndex++;
    }

    if (listingId) {
      sql += ` AND listing_id = $${paramIndex}`;
      params.push(listingId);
      paramIndex++;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    return result.rows;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      logger.warn('[Audit] audit_events table does not exist');
      return [];
    }
    throw error;
  }
}

/**
 * Get audit event counts by outcome for a time period
 */
export async function getAuditSummary(hours = 24) {
  try {
    const result = await query(`
      SELECT
        event_type,
        outcome,
        COUNT(*) as count
      FROM audit_events
      WHERE created_at >= NOW() - INTERVAL '${hours} hours'
      GROUP BY event_type, outcome
      ORDER BY event_type, outcome
    `);

    return result.rows;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      return [];
    }
    throw error;
  }
}

export default {
  AUDIT_EVENT_TYPE,
  AUDIT_OUTCOME,
  recordAuditEvent,
  recordPricePublishAudit,
  recordStockPublishAudit,
  recordSettingChangeAudit,
  recordCostOverrideAudit,
  getRecentAuditEvents,
  getAuditSummary,
};
