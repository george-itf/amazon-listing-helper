/**
 * Job Worker
 *
 * Processes pending jobs from the jobs queue.
 * Per SPEC §6 and DATA_CONTRACTS.md §10.
 *
 * IMPLEMENTATION STATUS:
 * ----------------------
 * FULLY IMPLEMENTED (requires SP-API credentials):
 * - PUBLISH_PRICE_CHANGE: Updates prices via SP-API Listings Items API (patchListingsItem)
 * - PUBLISH_STOCK_CHANGE: Updates inventory via SP-API Listings Items API (FBM only; FBA is Amazon-managed)
 * - SYNC_KEEPA_ASIN: Syncs Keepa data via Keepa API
 * - COMPUTE_FEATURES_LISTING: Computes and stores listing features
 * - COMPUTE_FEATURES_ASIN: Computes and stores ASIN features
 * - GENERATE_RECOMMENDATIONS_LISTING: Generates listing recommendations
 * - GENERATE_RECOMMENDATIONS_ASIN: Generates ASIN recommendations
 * - SYNC_AMAZON_OFFER: Syncs listing offers via amazonSync.syncListingOffers()
 * - SYNC_AMAZON_CATALOG: Syncs catalog items via amazonSync.syncCatalogItems()
 *
 * !IMPORTANT! SYNC_AMAZON_SALES has been REMOVED - requires Brand Analytics permissions we don't have.
 * Do NOT re-add this job type or attempt to use GET_SALES_AND_TRAFFIC_REPORT.
 *
 * AMAZON SYNC JOB DETAILS:
 * - If listing_id is set: targeted sync for that listing's ASIN only
 * - If input_json.asins is set: targeted sync for those specific ASINs
 * - Otherwise: global sync for all ASINs in listings table
 * - With no SP-API credentials: returns simulated success (no throw)
 *
 * DEVELOPMENT MODE:
 * - If SP-API credentials are not configured, sync and publish jobs return simulated success
 * - This allows local development without Amazon seller account
 *
 * @module JobWorker
 */

import { query, transaction } from '../database/connection.js';
import * as jobRepo from '../repositories/job.repository.js';
import {
  hasSpApiCredentials,
  getSpApiClientConfig,
  getSellerId,
  getDefaultMarketplaceId,
  isPublishEnabled,
  getWriteMode,
  shouldExecuteSpApiWrites,
  getPublishConfig,
  WRITE_MODE,
} from '../credentials-provider.js';
import SellingPartner from 'amazon-sp-api';
import { workerLogger, logJobEvent } from '../lib/logger.js';
import {
  recordPricePublishAudit,
  recordStockPublishAudit,
  AUDIT_OUTCOME,
} from '../services/audit.service.js';
import { recordJobEvent, updateJobQueueLength } from '../lib/metrics.js';
import { captureException } from '../lib/sentry.js';
// A.3.1: Per-job timeout support
import { withTimeout, getJobTimeout } from '../lib/job-timeout.js';
// C.1: Circuit breaker for external APIs
import { getCircuitBreaker } from '../lib/circuit-breaker.js';

// C.2: Track schema health issues detected during queries
const schemaIssues = new Set();

/**
 * Safe database query wrapper - handles table not exist errors with better logging
 * C.2 FIX: Now logs warnings with table name and tracks schema issues
 *
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @param {string} operation - Operation name for logging
 * @returns {Promise<{rows: Array, schemaError?: string}|null>}
 */
async function safeQuery(text, params = [], operation = 'query') {
  try {
    return await query(text, params);
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      // C.2 FIX: Extract table name and log meaningful warning
      const tableMatch = error.message.match(/relation "([^"]+)" does not exist/);
      const tableName = tableMatch ? tableMatch[1] : 'unknown';

      workerLogger.warn({
        operation,
        table: tableName,
        hint: 'Run migrations to create missing tables',
      }, `Schema issue in ${operation}: table "${tableName}" does not exist`);

      // Track the schema issue for health reporting
      schemaIssues.add(tableName);

      // Return a result object that indicates the schema error
      return { rows: [], schemaError: `Table ${tableName} does not exist` };
    }
    throw error;
  }
}

/**
 * Get current schema issues (for health endpoint)
 * @returns {string[]}
 */
export function getSchemaIssues() {
  return Array.from(schemaIssues);
}

// Worker configuration
const WORKER_POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS || '5000', 10);
const WORKER_BATCH_SIZE = parseInt(process.env.WORKER_BATCH_SIZE || '5', 10);
const WORKER_SHUTDOWN_TIMEOUT_MS = parseInt(process.env.WORKER_SHUTDOWN_TIMEOUT_MS || '30000', 10);

let isRunning = false;
let workerInterval = null;
// A.3.5: Track current job for graceful shutdown
let currentJobPromise = null;
let currentJobId = null;

/**
 * Process a single job based on its type
 * @param {Object} job
 * @returns {Promise<Object>} Result object
 */
async function processJob(job) {
  const startTime = Date.now();
  logJobEvent({ jobId: job.id, jobType: job.job_type, status: 'processing' });

  switch (job.job_type) {
    case 'PUBLISH_PRICE_CHANGE':
      return await processPriceChange(job);

    case 'PUBLISH_STOCK_CHANGE':
      return await processStockChange(job);

    case 'SYNC_KEEPA_ASIN':
      return await processSyncKeepaAsin(job);

    case 'COMPUTE_FEATURES_LISTING':
      return await processComputeFeaturesListing(job);

    case 'COMPUTE_FEATURES_ASIN':
      return await processComputeFeaturesAsin(job);

    case 'SYNC_AMAZON_OFFER':
    case 'SYNC_AMAZON_SALES':
    case 'SYNC_AMAZON_CATALOG':
      return await processSyncAmazon(job);

    case 'GENERATE_RECOMMENDATIONS_LISTING':
      return await processGenerateRecommendationsListing(job);

    case 'GENERATE_RECOMMENDATIONS_ASIN':
      return await processGenerateRecommendationsAsin(job);

    default:
      throw new Error(`Unknown job type: ${job.job_type}`);
  }
}

/**
 * Process PUBLISH_PRICE_CHANGE job
 *
 * Respects publish mode configuration:
 * - ENABLE_PUBLISH=false: Returns error, no changes made
 * - ENABLE_PUBLISH=true, AMAZON_WRITE_MODE=simulate: Validates and logs, updates local DB only
 * - ENABLE_PUBLISH=true, AMAZON_WRITE_MODE=live: Full SP-API write + local DB update
 *
 * @param {Object} job
 * @returns {Promise<Object>}
 */
async function processPriceChange(job) {
  const input = job.input_json;
  const listingId = job.listing_id;
  const newPrice = input.price_inc_vat;
  const publishConfig = getPublishConfig();
  const writeMode = getWriteMode();

  workerLogger.info({
    listingId,
    newPrice,
    publishEnabled: publishConfig.publish_enabled,
    writeMode,
  }, 'Processing price change job');

  // GATE 1: Check if publishing is enabled
  if (!isPublishEnabled()) {
    workerLogger.warn({ listingId }, 'Price change blocked: ENABLE_PUBLISH is not true');
    return {
      success: false,
      error: 'PUBLISH_DISABLED',
      message: 'Publishing is disabled. Set ENABLE_PUBLISH=true to allow publish operations.',
      ...publishConfig,
      publish_attempted: false,
      publish_succeeded: false,
      new_price: newPrice,
    };
  }

  // Record the publish attempt event
  await safeQuery(`
    INSERT INTO listing_events (listing_id, event_type, job_id, before_json, after_json, reason, created_by)
    VALUES ($1, 'PRICE_CHANGE_PUBLISHED', $2, $3, $4, $5, 'worker')
  `, [
    listingId,
    job.id,
    JSON.stringify({ price_inc_vat: input.previous_price_inc_vat }),
    JSON.stringify({ price_inc_vat: newPrice, write_mode: writeMode }),
    input.reason,
  ], 'record_price_published');

  // GATE 2: Check write mode - simulate vs live
  if (writeMode === WRITE_MODE.SIMULATE) {
    workerLogger.info({ listingId, newPrice }, 'Price change in SIMULATE mode - updating local DB only');

    const startTime = Date.now();

    // Update local database (simulated)
    await updateListingPrice(listingId, newPrice);

    // Record success event
    await recordPriceChangeSuccess(listingId, job.id, input);

    // Record audit event
    await recordPricePublishAudit({
      listingId,
      previousPrice: input.previous_price_inc_vat,
      newPrice,
      outcome: AUDIT_OUTCOME.SIMULATED,
      actorType: 'worker',
      correlationId: input.correlation_id,
      spApiCalled: false,
      durationMs: Date.now() - startTime,
    });

    return {
      success: true,
      ...publishConfig,
      publish_attempted: false,
      publish_succeeded: false,
      simulated: true,
      message: 'Price change simulated (AMAZON_WRITE_MODE=simulate). Local DB updated, SP-API not called.',
      new_price: newPrice,
    };
  }

  // GATE 3: Check SP-API credentials for live mode
  if (!hasSpApiCredentials()) {
    workerLogger.warn({ listingId }, 'Price change blocked: AMAZON_WRITE_MODE=live but no SP-API credentials');

    // Record blocked audit event
    await recordPricePublishAudit({
      listingId,
      previousPrice: input.previous_price_inc_vat,
      newPrice,
      outcome: AUDIT_OUTCOME.BLOCKED,
      actorType: 'worker',
      correlationId: input.correlation_id,
      spApiCalled: false,
      errorCode: 'NO_CREDENTIALS',
      errorMessage: 'SP-API credentials not configured',
    });

    return {
      success: false,
      error: 'NO_CREDENTIALS',
      message: 'Cannot execute live publish: SP-API credentials not configured.',
      ...publishConfig,
      publish_attempted: false,
      publish_succeeded: false,
      new_price: newPrice,
    };
  }

  // LIVE MODE: Execute actual SP-API call
  workerLogger.info({ listingId, newPrice }, 'Executing LIVE price change via SP-API');
  const startTime = Date.now();

  try {
    // Call SP-API to update price
    const spApiResult = await callSpApiUpdatePrice(listingId, newPrice);

    // Update local database
    await updateListingPrice(listingId, newPrice);

    // Record success event
    await recordPriceChangeSuccess(listingId, job.id, input);

    // Record audit event
    await recordPricePublishAudit({
      listingId,
      previousPrice: input.previous_price_inc_vat,
      newPrice,
      outcome: AUDIT_OUTCOME.SUCCESS,
      actorType: 'worker',
      correlationId: input.correlation_id,
      spApiCalled: true,
      spApiResponse: spApiResult,
      durationMs: Date.now() - startTime,
    });

    return {
      success: true,
      ...publishConfig,
      publish_attempted: true,
      publish_succeeded: true,
      sp_api_response: spApiResult,
      new_price: newPrice,
    };
  } catch (error) {
    // Record failure event
    await recordPriceChangeFailure(listingId, job.id, input, error.message);

    // Record audit event
    await recordPricePublishAudit({
      listingId,
      previousPrice: input.previous_price_inc_vat,
      newPrice,
      outcome: AUDIT_OUTCOME.FAILURE,
      actorType: 'worker',
      correlationId: input.correlation_id,
      spApiCalled: true,
      errorCode: error.code || 'SP_API_ERROR',
      errorMessage: error.message,
      durationMs: Date.now() - startTime,
    });

    // Return structured error instead of throwing
    return {
      success: false,
      ...publishConfig,
      publish_attempted: true,
      publish_succeeded: false,
      error: error.message,
      new_price: newPrice,
    };
  }
}

/**
 * Process PUBLISH_STOCK_CHANGE job
 *
 * Respects publish mode configuration:
 * - ENABLE_PUBLISH=false: Returns error, no changes made
 * - ENABLE_PUBLISH=true, AMAZON_WRITE_MODE=simulate: Validates and logs, updates local DB only
 * - ENABLE_PUBLISH=true, AMAZON_WRITE_MODE=live: Full SP-API write + local DB update
 *
 * @param {Object} job
 * @returns {Promise<Object>}
 */
async function processStockChange(job) {
  const input = job.input_json;
  const listingId = job.listing_id;
  const newQuantity = input.available_quantity;
  const publishConfig = getPublishConfig();
  const writeMode = getWriteMode();

  workerLogger.info({
    listingId,
    newQuantity,
    publishEnabled: publishConfig.publish_enabled,
    writeMode,
  }, 'Processing stock change job');

  // GATE 1: Check if publishing is enabled
  if (!isPublishEnabled()) {
    workerLogger.warn({ listingId }, 'Stock change blocked: ENABLE_PUBLISH is not true');
    return {
      success: false,
      error: 'PUBLISH_DISABLED',
      message: 'Publishing is disabled. Set ENABLE_PUBLISH=true to allow publish operations.',
      ...publishConfig,
      publish_attempted: false,
      publish_succeeded: false,
      new_quantity: newQuantity,
    };
  }

  // Record the publish attempt event
  await safeQuery(`
    INSERT INTO listing_events (listing_id, event_type, job_id, before_json, after_json, reason, created_by)
    VALUES ($1, 'STOCK_CHANGE_PUBLISHED', $2, $3, $4, $5, 'worker')
  `, [
    listingId,
    job.id,
    JSON.stringify({ available_quantity: input.previous_quantity }),
    JSON.stringify({ available_quantity: newQuantity, write_mode: writeMode }),
    input.reason,
  ], 'record_stock_published');

  // GATE 2: Check write mode - simulate vs live
  if (writeMode === WRITE_MODE.SIMULATE) {
    workerLogger.info({ listingId, newQuantity }, 'Stock change in SIMULATE mode - updating local DB only');
    const startTime = Date.now();

    // Update local database (simulated)
    await updateListingStock(listingId, newQuantity);

    // Record success event
    await recordStockChangeSuccess(listingId, job.id, input);

    // Record audit event
    await recordStockPublishAudit({
      listingId,
      previousQuantity: input.previous_quantity,
      newQuantity,
      outcome: AUDIT_OUTCOME.SIMULATED,
      actorType: 'worker',
      spApiCalled: false,
      durationMs: Date.now() - startTime,
    });

    return {
      success: true,
      ...publishConfig,
      publish_attempted: false,
      publish_succeeded: false,
      simulated: true,
      message: 'Stock change simulated (AMAZON_WRITE_MODE=simulate). Local DB updated, SP-API not called.',
      new_quantity: newQuantity,
    };
  }

  // GATE 3: Check SP-API credentials for live mode
  if (!hasSpApiCredentials()) {
    workerLogger.warn({ listingId }, 'Stock change blocked: AMAZON_WRITE_MODE=live but no SP-API credentials');

    // Record blocked audit event
    await recordStockPublishAudit({
      listingId,
      previousQuantity: input.previous_quantity,
      newQuantity,
      outcome: AUDIT_OUTCOME.BLOCKED,
      actorType: 'worker',
      spApiCalled: false,
      errorCode: 'NO_CREDENTIALS',
      errorMessage: 'SP-API credentials not configured',
    });

    return {
      success: false,
      error: 'NO_CREDENTIALS',
      message: 'Cannot execute live publish: SP-API credentials not configured.',
      ...publishConfig,
      publish_attempted: false,
      publish_succeeded: false,
      new_quantity: newQuantity,
    };
  }

  // LIVE MODE: Execute actual SP-API call
  workerLogger.info({ listingId, newQuantity }, 'Executing LIVE stock change via SP-API');
  const startTime = Date.now();

  try {
    // Call SP-API to update inventory
    const spApiResult = await callSpApiUpdateInventory(listingId, newQuantity);

    // Update local database
    await updateListingStock(listingId, newQuantity);

    // Record success event
    await recordStockChangeSuccess(listingId, job.id, input);

    // Record audit event
    await recordStockPublishAudit({
      listingId,
      previousQuantity: input.previous_quantity,
      newQuantity,
      outcome: AUDIT_OUTCOME.SUCCESS,
      actorType: 'worker',
      spApiCalled: true,
      spApiResponse: spApiResult,
      durationMs: Date.now() - startTime,
    });

    return {
      success: true,
      ...publishConfig,
      publish_attempted: true,
      publish_succeeded: true,
      sp_api_response: spApiResult,
      new_quantity: newQuantity,
    };
  } catch (error) {
    // Record failure event
    await recordStockChangeFailure(listingId, job.id, input, error.message);

    // Record audit event
    await recordStockPublishAudit({
      listingId,
      previousQuantity: input.previous_quantity,
      newQuantity,
      outcome: AUDIT_OUTCOME.FAILURE,
      actorType: 'worker',
      spApiCalled: true,
      errorCode: error.code || 'SP_API_ERROR',
      errorMessage: error.message,
      durationMs: Date.now() - startTime,
    });

    return {
      success: false,
      ...publishConfig,
      publish_attempted: true,
      publish_succeeded: false,
      error: error.message,
      new_quantity: newQuantity,
    };
  }
}

/**
 * Update listing price in local database
 * @param {number} listingId
 * @param {number} newPrice
 */
async function updateListingPrice(listingId, newPrice) {
  // Try new column name first, fallback to old column name
  try {
    await query(`
      UPDATE listings
      SET price_inc_vat = $2, "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [listingId, newPrice]);
  } catch (error) {
    if (error.message?.includes('column "price_inc_vat" does not exist')) {
      // Fallback to old column name
      await query(`
        UPDATE listings
        SET price = $2, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [listingId, newPrice]);
    } else {
      throw error;
    }
  }

  // Update listing_offer_current if exists (safe - table may not exist)
  await safeQuery(`
    INSERT INTO listing_offer_current (listing_id, price_inc_vat, observed_at)
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT (listing_id) DO UPDATE SET
      price_inc_vat = $2,
      observed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `, [listingId, newPrice], 'update_offer_price');
}

/**
 * Update listing stock in local database
 * @param {number} listingId
 * @param {number} newQuantity
 */
async function updateListingStock(listingId, newQuantity) {
  // Try new column name first, fallback to old column name
  try {
    await query(`
      UPDATE listings
      SET available_quantity = $2, "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [listingId, newQuantity]);
  } catch (error) {
    if (error.message?.includes('column "available_quantity" does not exist')) {
      // Fallback to old column name
      await query(`
        UPDATE listings
        SET quantity = $2, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [listingId, newQuantity]);
    } else {
      throw error;
    }
  }

  // Update listing_offer_current if exists (safe - table may not exist)
  await safeQuery(`
    INSERT INTO listing_offer_current (listing_id, available_quantity, observed_at)
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT (listing_id) DO UPDATE SET
      available_quantity = $2,
      observed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `, [listingId, newQuantity], 'update_offer_stock');
}

/**
 * Record price change success event and queue feature recompute
 */
async function recordPriceChangeSuccess(listingId, jobId, input) {
  await safeQuery(`
    INSERT INTO listing_events (listing_id, event_type, job_id, before_json, after_json, reason, created_by)
    VALUES ($1, 'PRICE_CHANGE_SUCCEEDED', $2, $3, $4, $5, 'worker')
  `, [
    listingId,
    jobId,
    JSON.stringify({ price_inc_vat: input.previous_price_inc_vat }),
    JSON.stringify({ price_inc_vat: input.price_inc_vat }),
    input.reason,
  ], 'record_price_success');

  // Queue feature recompute after price change (Addendum E)
  await queueFeatureRecompute(listingId, 'price_change');
}

/**
 * Record price change failure event
 */
async function recordPriceChangeFailure(listingId, jobId, input, errorMessage) {
  await safeQuery(`
    INSERT INTO listing_events (listing_id, event_type, job_id, before_json, after_json, reason, created_by)
    VALUES ($1, 'PRICE_CHANGE_FAILED', $2, $3, $4, $5, 'worker')
  `, [
    listingId,
    jobId,
    JSON.stringify({ price_inc_vat: input.previous_price_inc_vat }),
    JSON.stringify({ price_inc_vat: input.price_inc_vat, error: errorMessage }),
    input.reason,
  ], 'record_price_failure');
}

/**
 * Record stock change success event and queue feature recompute
 */
async function recordStockChangeSuccess(listingId, jobId, input) {
  await safeQuery(`
    INSERT INTO listing_events (listing_id, event_type, job_id, before_json, after_json, reason, created_by)
    VALUES ($1, 'STOCK_CHANGE_SUCCEEDED', $2, $3, $4, $5, 'worker')
  `, [
    listingId,
    jobId,
    JSON.stringify({ available_quantity: input.previous_quantity }),
    JSON.stringify({ available_quantity: input.available_quantity }),
    input.reason,
  ], 'record_stock_success');

  // Queue feature recompute after stock change (Addendum E)
  await queueFeatureRecompute(listingId, 'stock_change');
}

/**
 * Record stock change failure event
 */
async function recordStockChangeFailure(listingId, jobId, input, errorMessage) {
  await safeQuery(`
    INSERT INTO listing_events (listing_id, event_type, job_id, before_json, after_json, reason, created_by)
    VALUES ($1, 'STOCK_CHANGE_FAILED', $2, $3, $4, $5, 'worker')
  `, [
    listingId,
    jobId,
    JSON.stringify({ available_quantity: input.previous_quantity }),
    JSON.stringify({ available_quantity: input.available_quantity, error: errorMessage }),
    input.reason,
  ], 'record_stock_failure');
}

/**
 * Queue feature recompute job after listing change
 * Ensures features are fresh after price/stock updates (Addendum E)
 * @param {number} listingId
 * @param {string} reason - Trigger reason
 */
async function queueFeatureRecompute(listingId, reason) {
  try {
    // Check if there's already a pending feature compute job for this listing
    const existing = await safeQuery(`
      SELECT id FROM jobs
      WHERE listing_id = $1
        AND job_type = 'COMPUTE_FEATURES_LISTING'
        AND status = 'PENDING'
      LIMIT 1
    `, [listingId], 'check_pending_feature_job');

    if (existing && existing.rows.length > 0) {
      workerLogger.info(` Feature recompute already pending for listing ${listingId}`);
      return;
    }

    // Create low-priority feature recompute job (safe - jobs table may not exist)
    await safeQuery(`
      INSERT INTO jobs (
        job_type, scope_type, listing_id, status, priority, input_json, created_by
      ) VALUES ('COMPUTE_FEATURES_LISTING', 'LISTING', $1, 'PENDING', 3, $2, 'worker')
    `, [
      listingId,
      JSON.stringify({ trigger: reason, triggered_at: new Date().toISOString() }),
    ], 'queue_feature_recompute');

    workerLogger.info(` Queued feature recompute for listing ${listingId} (trigger: ${reason})`);
  } catch (error) {
    // Don't fail the main job if feature recompute queuing fails
    workerLogger.error(` Failed to queue feature recompute for listing ${listingId}:`, error.message);
  }
}

/**
 * Create SP-API client
 * @returns {SellingPartner} SP-API client
 */
function createSpApiClient() {
  const config = getSpApiClientConfig();
  return new SellingPartner({
    region: config.region,
    refresh_token: config.refresh_token,
    credentials: config.credentials,
    options: {
      ...config.options,
      debug_log: process.env.DEBUG === 'true',
    },
  });
}

/**
 * Call SP-API to update price using Listings Items API
 * Uses PATCH operation to update only the price attribute
 * @param {number} listingId
 * @param {number} newPrice
 * @returns {Promise<Object>}
 */
async function callSpApiUpdatePrice(listingId, newPrice) {
  // Get listing details
  const result = await query(
    'SELECT seller_sku, asin, "fulfillmentChannel" FROM listings WHERE id = $1',
    [listingId]
  );
  if (result.rows.length === 0) {
    throw new Error(`Listing not found: ${listingId}`);
  }

  const { seller_sku: sellerSku, fulfillmentChannel } = result.rows[0];
  const sellerId = getSellerId();
  const marketplaceId = getDefaultMarketplaceId();

  if (!sellerId) {
    throw new Error('SP_API_SELLER_ID not configured');
  }

  workerLogger.info(` Calling SP-API to update price for SKU ${sellerSku} to £${newPrice}`);

  const sp = createSpApiClient();

  // Use Listings Items API patchListingsItem operation
  // This updates only the specified attributes (price in this case)
  const patchBody = {
    productType: 'PRODUCT', // Generic product type
    patches: [
      {
        op: 'replace',
        path: '/attributes/purchasable_offer',
        value: [
          {
            marketplace_id: marketplaceId,
            currency: 'GBP',
            our_price: [
              {
                schedule: [
                  {
                    value_with_tax: newPrice,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  try {
    const response = await sp.callAPI({
      operation: 'patchListingsItem',
      endpoint: 'listingsItems',
      path: {
        sellerId: sellerId,
        sku: sellerSku,
      },
      query: {
        marketplaceIds: [marketplaceId],
      },
      body: patchBody,
    });

    workerLogger.info(` SP-API price update response:`, JSON.stringify(response));

    // Check for submission status
    const status = response?.status || 'UNKNOWN';
    const submissionId = response?.submissionId;

    if (status === 'ACCEPTED' || status === 'VALID') {
      return {
        status: 'success',
        seller_sku: sellerSku,
        new_price: newPrice,
        sp_api_status: status,
        submission_id: submissionId,
        timestamp: new Date().toISOString(),
      };
    } else if (status === 'INVALID') {
      const issues = response?.issues || [];
      throw new Error(`SP-API rejected price update: ${JSON.stringify(issues)}`);
    } else {
      // Pending or unknown - treat as success since we submitted
      return {
        status: 'pending',
        seller_sku: sellerSku,
        new_price: newPrice,
        sp_api_status: status,
        submission_id: submissionId,
        timestamp: new Date().toISOString(),
      };
    }
  } catch (error) {
    workerLogger.error(` SP-API price update failed for ${sellerSku}:`, error);

    // Extract error details
    const errorMessage = error.message || 'Unknown SP-API error';
    const errorCode = error.code || error.statusCode;

    throw new Error(`SP-API price update failed: ${errorMessage}${errorCode ? ` (${errorCode})` : ''}`);
  }
}

/**
 * Call SP-API to update inventory
 * Uses Listings Items API for MFN (FBM) or submits inventory feed for FBA
 * @param {number} listingId
 * @param {number} newQuantity
 * @returns {Promise<Object>}
 */
async function callSpApiUpdateInventory(listingId, newQuantity) {
  // Get listing details
  const result = await query(
    'SELECT seller_sku, asin, "fulfillmentChannel" FROM listings WHERE id = $1',
    [listingId]
  );
  if (result.rows.length === 0) {
    throw new Error(`Listing not found: ${listingId}`);
  }

  const { seller_sku: sellerSku, fulfillmentChannel } = result.rows[0];
  const sellerId = getSellerId();
  const marketplaceId = getDefaultMarketplaceId();

  if (!sellerId) {
    throw new Error('SP_API_SELLER_ID not configured');
  }

  workerLogger.info(` Calling SP-API to update inventory for SKU ${sellerSku} to ${newQuantity} units (${fulfillmentChannel})`);

  const sp = createSpApiClient();

  // For FBA listings, inventory is managed by Amazon - we can't update it directly
  // For FBM (MFN) listings, we use Listings Items API
  if (fulfillmentChannel === 'FBA') {
    workerLogger.info(` FBA listing ${sellerSku} - inventory managed by Amazon, skipping SP-API update`);
    return {
      status: 'skipped',
      reason: 'FBA inventory managed by Amazon',
      seller_sku: sellerSku,
      new_quantity: newQuantity,
      timestamp: new Date().toISOString(),
    };
  }

  // Use Listings Items API patchListingsItem operation for FBM/MFN inventory
  const patchBody = {
    productType: 'PRODUCT',
    patches: [
      {
        op: 'replace',
        path: '/attributes/fulfillment_availability',
        value: [
          {
            fulfillment_channel_code: 'DEFAULT', // MFN/FBM
            quantity: newQuantity,
          },
        ],
      },
    ],
  };

  try {
    const response = await sp.callAPI({
      operation: 'patchListingsItem',
      endpoint: 'listingsItems',
      path: {
        sellerId: sellerId,
        sku: sellerSku,
      },
      query: {
        marketplaceIds: [marketplaceId],
      },
      body: patchBody,
    });

    workerLogger.info(` SP-API inventory update response:`, JSON.stringify(response));

    // Check for submission status
    const status = response?.status || 'UNKNOWN';
    const submissionId = response?.submissionId;

    if (status === 'ACCEPTED' || status === 'VALID') {
      return {
        status: 'success',
        seller_sku: sellerSku,
        new_quantity: newQuantity,
        sp_api_status: status,
        submission_id: submissionId,
        timestamp: new Date().toISOString(),
      };
    } else if (status === 'INVALID') {
      const issues = response?.issues || [];
      throw new Error(`SP-API rejected inventory update: ${JSON.stringify(issues)}`);
    } else {
      // Pending or unknown - treat as success since we submitted
      return {
        status: 'pending',
        seller_sku: sellerSku,
        new_quantity: newQuantity,
        sp_api_status: status,
        submission_id: submissionId,
        timestamp: new Date().toISOString(),
      };
    }
  } catch (error) {
    workerLogger.error(` SP-API inventory update failed for ${sellerSku}:`, error);

    // Extract error details
    const errorMessage = error.message || 'Unknown SP-API error';
    const errorCode = error.code || error.statusCode;

    throw new Error(`SP-API inventory update failed: ${errorMessage}${errorCode ? ` (${errorCode})` : ''}`);
  }
}

// ============================================================================
// SLICE C: KEEPA & FEATURE STORE JOBS
// ============================================================================

/**
 * Process SYNC_KEEPA_ASIN job
 * @param {Object} job
 * @returns {Promise<Object>}
 */
async function processSyncKeepaAsin(job) {
  const input = job.input_json || {};
  const asin = input.asin;
  const marketplaceId = input.marketplace_id || 1; // Default to UK

  if (!asin) {
    throw new Error('ASIN is required for SYNC_KEEPA_ASIN job');
  }

  workerLogger.info(` Syncing Keepa data for ASIN ${asin}`);

  // Dynamic import to avoid circular dependencies
  const keepaService = await import('../services/keepa.service.js');

  const result = await keepaService.syncKeepaAsin(asin, marketplaceId);

  // Create listing event if this is for a listing (safe - table may not exist)
  if (job.listing_id) {
    await safeQuery(`
      INSERT INTO listing_events (listing_id, event_type, job_id, after_json, created_by)
      VALUES ($1, 'KEEPA_SYNC_COMPLETED', $2, $3, 'worker')
    `, [job.listing_id, job.id, JSON.stringify(result)], 'record_keepa_sync');
  }

  return result;
}

/**
 * Process COMPUTE_FEATURES_LISTING job
 * @param {Object} job
 * @returns {Promise<Object>}
 */
async function processComputeFeaturesListing(job) {
  const listingId = job.listing_id;

  if (!listingId) {
    throw new Error('listing_id is required for COMPUTE_FEATURES_LISTING job');
  }

  workerLogger.info(` Computing features for listing ${listingId}`);

  const featureStoreService = await import('../services/feature-store.service.js');

  const result = await featureStoreService.computeListingFeatures(listingId);

  // Create listing event (safe - table may not exist)
  await safeQuery(`
    INSERT INTO listing_events (listing_id, event_type, job_id, after_json, created_by)
    VALUES ($1, 'FEATURES_COMPUTED', $2, $3, 'worker')
  `, [listingId, job.id, JSON.stringify({ feature_store_id: result.feature_store_id })], 'record_features_computed');

  return result;
}

/**
 * Process COMPUTE_FEATURES_ASIN job
 * @param {Object} job
 * @returns {Promise<Object>}
 */
async function processComputeFeaturesAsin(job) {
  const input = job.input_json || {};
  const asinEntityId = input.asin_entity_id || job.asin_entity_id;

  if (!asinEntityId) {
    throw new Error('asin_entity_id is required for COMPUTE_FEATURES_ASIN job');
  }

  workerLogger.info(` Computing features for ASIN entity ${asinEntityId}`);

  const featureStoreService = await import('../services/feature-store.service.js');

  const result = await featureStoreService.computeAsinFeatures(asinEntityId);

  return result;
}

/**
 * Process SYNC_AMAZON_* jobs
 *
 * IMPLEMENTED JOB TYPES:
 * - SYNC_AMAZON_OFFER   -> calls amazonSync.syncListingOffers()
 * - SYNC_AMAZON_CATALOG -> calls amazonSync.syncCatalogItems()
 *
 * !IMPORTANT! SYNC_AMAZON_SALES has been REMOVED - requires Brand Analytics permissions.
 * Do NOT re-add this job type or use GET_SALES_AND_TRAFFIC_REPORT.
 *
 * TARGETED SYNC:
 * - If job.listing_id is set, syncs only that listing's ASIN
 * - If job.input_json.asins is set (array), syncs those ASINs
 * - Otherwise, runs global sync (all ASINs)
 *
 * @param {Object} job - The job object
 * @returns {Promise<Object>} Sync result
 */
async function processSyncAmazon(job) {
  const listingId = job.listing_id;
  const jobType = job.job_type;
  const inputJson = job.input_json || {};
  const startTime = Date.now();

  workerLogger.info(`[SyncAmazon] Processing ${jobType} (job_id=${job.id}, listing_id=${listingId || 'none'})`);

  // GATE 1: Check if we have SP-API credentials
  if (!hasSpApiCredentials()) {
    workerLogger.info(`[SyncAmazon] No SP-API credentials - simulating ${jobType}`);
    return {
      success: true,
      simulated: true,
      message: `${jobType} simulated (no SP-API credentials configured)`,
    };
  }

  // Dynamically import amazon-data-sync (same pattern as routes)
  const amazonSync = await import('../amazon-data-sync.js');

  // Ensure required tables exist
  await amazonSync.ensureTables();

  // Determine target ASINs for targeted sync
  let targetAsins = null;

  // Priority 1: Explicit ASINs in input_json
  if (inputJson.asins && Array.isArray(inputJson.asins) && inputJson.asins.length > 0) {
    targetAsins = [...new Set(inputJson.asins.filter(Boolean))];
    workerLogger.info(`[SyncAmazon] Using ${targetAsins.length} ASIN(s) from input_json`);
  }
  // Priority 2: Look up ASIN from listing_id
  else if (listingId) {
    const listingResult = await safeQuery(
      'SELECT asin FROM listings WHERE id = $1',
      [listingId],
      'get_listing_asin'
    );

    if (!listingResult || listingResult.rows.length === 0) {
      workerLogger.info(`[SyncAmazon] Listing ${listingId} not found - skipping`);
      return {
        success: true,
        skipped: true,
        message: `Listing ${listingId} not found; nothing to sync`,
      };
    }

    const asin = listingResult.rows[0].asin;
    if (!asin) {
      workerLogger.info(`[SyncAmazon] Listing ${listingId} has no ASIN - skipping`);
      return {
        success: true,
        skipped: true,
        message: `Listing ${listingId} has no ASIN; nothing to sync`,
      };
    }

    targetAsins = [asin];
    workerLogger.info(`[SyncAmazon] Targeting ASIN ${asin} from listing ${listingId}`);
  }

  // Build options for targeted sync
  const syncOptions = targetAsins ? { asins: targetAsins } : {};
  const syncMode = targetAsins ? 'targeted' : 'global';

  workerLogger.info(`[SyncAmazon] Executing ${jobType} in ${syncMode} mode...`);

  let result;

  try {
    switch (jobType) {
      case 'SYNC_AMAZON_OFFER':
        result = await amazonSync.syncListingOffers(syncOptions);
        break;

      // !IMPORTANT! SYNC_AMAZON_SALES case REMOVED - requires Brand Analytics permissions
      // Do NOT re-add this case or attempt to use syncSalesAndTraffic()

      case 'SYNC_AMAZON_CATALOG':
        result = await amazonSync.syncCatalogItems(syncOptions);
        break;

      default:
        throw new Error(`Unknown Amazon sync type: ${jobType}`);
    }
  } catch (error) {
    const durationMs = Date.now() - startTime;
    workerLogger.error(`[SyncAmazon] ${jobType} failed after ${durationMs}ms:`, error.message);

    // Re-throw to let job retry logic handle it
    throw error;
  }

  const durationMs = Date.now() - startTime;
  workerLogger.info(`[SyncAmazon] ${jobType} completed in ${durationMs}ms:`, JSON.stringify(result));

  return {
    ...result,
    job_id: job.id,
    job_type: jobType,
    duration_ms: durationMs,
    ...(targetAsins && { target_asins: targetAsins }),
  };
}

// ============================================================================
// SLICE D: RECOMMENDATION JOBS
// ============================================================================

/**
 * Process GENERATE_RECOMMENDATIONS_LISTING job
 * @param {Object} job
 * @returns {Promise<Object>}
 */
async function processGenerateRecommendationsListing(job) {
  const listingId = job.listing_id;

  if (!listingId) {
    throw new Error('listing_id is required for GENERATE_RECOMMENDATIONS_LISTING job');
  }

  workerLogger.info(` Generating recommendations for listing ${listingId}`);

  const recommendationService = await import('../services/recommendation.service.js');

  const result = await recommendationService.generateListingRecommendations(listingId, job.id);

  return result;
}

/**
 * Process GENERATE_RECOMMENDATIONS_ASIN job
 * @param {Object} job
 * @returns {Promise<Object>}
 */
async function processGenerateRecommendationsAsin(job) {
  const input = job.input_json || {};
  const asinEntityId = input.asin_entity_id || job.asin_entity_id;

  if (!asinEntityId) {
    throw new Error('asin_entity_id is required for GENERATE_RECOMMENDATIONS_ASIN job');
  }

  workerLogger.info(` Generating recommendations for ASIN entity ${asinEntityId}`);

  const recommendationService = await import('../services/recommendation.service.js');

  const result = await recommendationService.generateAsinRecommendations(asinEntityId, job.id);

  return result;
}

/**
 * Insert job into Dead Letter Queue
 * A.3.2 FIX: Records failed jobs for later inspection
 * @param {Object} job - The failed job
 * @param {string} errorMessage - Error message
 * @param {string} errorStack - Error stack trace
 */
async function insertIntoDLQ(job, errorMessage, errorStack) {
  try {
    await query(`
      INSERT INTO job_dead_letters (
        job_id, job_type, scope_type, listing_id, asin_entity_id,
        payload, attempts, last_error, error_stack
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      job.id,
      job.job_type,
      job.scope_type || 'LISTING',
      job.listing_id || null,
      job.asin_entity_id || null,
      JSON.stringify(job.input_json || {}),
      job.attempts || 0,
      errorMessage,
      errorStack || null,
    ]);
    workerLogger.info({ jobId: job.id, jobType: job.job_type }, 'Job added to Dead Letter Queue');
  } catch (dlqError) {
    // DLQ table might not exist yet
    if (!dlqError.message?.includes('does not exist')) {
      workerLogger.error({ jobId: job.id, err: dlqError }, 'Failed to insert job into DLQ');
    }
  }
}

/**
 * Main worker loop - process pending jobs
 *
 * A.3.1 FIX: Now wraps job processing with timeout
 * A.3.2 FIX: Inserts into DLQ when max attempts exceeded
 * A.3.5 FIX: Tracks current job for graceful shutdown
 */
async function processJobs() {
  if (!isRunning) return;

  try {
    // Get pending jobs
    const pendingJobs = await jobRepo.getPendingJobs(WORKER_BATCH_SIZE);

    for (const job of pendingJobs) {
      if (!isRunning) break;

      try {
        // Claim the job
        const claimedJob = await jobRepo.claimJob(job.id);
        if (!claimedJob) {
          // Job was claimed by another worker
          continue;
        }

        // A.3.5: Track current job for graceful shutdown
        currentJobId = claimedJob.id;

        // A.3.1 FIX: Process the job with timeout
        const timeoutMs = getJobTimeout(claimedJob.job_type);
        currentJobPromise = withTimeout(
          processJob(claimedJob),
          timeoutMs,
          `${claimedJob.job_type}:${claimedJob.id}`
        );

        const result = await currentJobPromise;

        // Clear tracking
        currentJobPromise = null;
        currentJobId = null;

        // Mark as succeeded
        await jobRepo.markSucceeded(job.id, result);
        const durationMs = Date.now() - Date.parse(job.created_at || job.createdAt);
        logJobEvent({ jobId: job.id, jobType: job.job_type, status: 'completed' });
        recordJobEvent({ type: job.job_type, status: 'success', durationMs });
        workerLogger.info({ jobId: job.id, jobType: job.job_type, durationMs }, 'Job succeeded');

        // Update linked recommendation to APPLIED if this was a publish job
        if (job.job_type === 'PUBLISH_PRICE_CHANGE' || job.job_type === 'PUBLISH_STOCK_CHANGE') {
          try {
            const recommendationService = await import('../services/recommendation.service.js');
            await recommendationService.markRecommendationApplied(job.id);
          } catch (recError) {
            workerLogger.warn({ jobId: job.id, err: recError }, 'Failed to update recommendation status');
          }
        }

      } catch (error) {
        // Clear tracking
        currentJobPromise = null;
        currentJobId = null;

        // Check if this is a timeout error
        const isTimeout = error.code === 'JOB_TIMEOUT';
        const errorCode = isTimeout ? 'JOB_TIMEOUT' : (error.code || 'JOB_ERROR');

        logJobEvent({ jobId: job.id, jobType: job.job_type, status: 'failed', error: error.message, code: errorCode });
        recordJobEvent({ type: job.job_type, status: 'failed', isRetry: job.attempts > 1, isTimeout });
        captureException(error, { jobId: job.id, jobType: job.job_type, errorCode });
        workerLogger.error({ jobId: job.id, err: error, code: errorCode }, 'Job failed');

        // Mark as failed (will retry if attempts < max_attempts)
        const updatedJob = await jobRepo.markFailed(job.id, error.message, {
          error: error.message,
          code: errorCode,
          stack: error.stack,
        });

        // A.3.2 FIX: Insert into DLQ if max attempts exceeded
        if (updatedJob && updatedJob.status === 'FAILED') {
          await insertIntoDLQ(updatedJob, error.message, error.stack);

          // Update linked recommendation to FAILED if this was a publish job
          if (job.job_type === 'PUBLISH_PRICE_CHANGE' || job.job_type === 'PUBLISH_STOCK_CHANGE') {
            try {
              const recommendationService = await import('../services/recommendation.service.js');
              await recommendationService.markRecommendationFailed(job.id, error.message);
            } catch (recError) {
              workerLogger.warn({ jobId: job.id, err: recError }, 'Failed to update recommendation status to FAILED');
            }
          }
        }
      }
    }

  } catch (error) {
    workerLogger.error('[Worker] Error in worker loop:', error);
  }
}

/**
 * Start the job worker
 */
export function startWorker() {
  if (isRunning) {
    workerLogger.info('[Worker] Already running');
    return;
  }

  workerLogger.info(` Starting (poll interval: ${WORKER_POLL_INTERVAL_MS}ms, batch size: ${WORKER_BATCH_SIZE})`);
  isRunning = true;

  // Process immediately, then set interval
  processJobs();
  workerInterval = setInterval(processJobs, WORKER_POLL_INTERVAL_MS);
}

/**
 * Stop the job worker
 *
 * A.3.5 FIX: Graceful shutdown - waits for in-progress job to complete
 *
 * @param {boolean} graceful - If true, wait for current job to complete
 * @returns {Promise<void>}
 */
export async function stopWorker(graceful = true) {
  if (!isRunning) {
    workerLogger.info('[Worker] Not running');
    return;
  }

  workerLogger.info('[Worker] Stopping...');
  isRunning = false;

  // Stop polling for new jobs
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }

  // A.3.5 FIX: Wait for in-progress job if graceful shutdown requested
  if (graceful && currentJobPromise) {
    workerLogger.info({ jobId: currentJobId }, '[Worker] Waiting for in-progress job to complete...');

    try {
      // Wait for current job with a deadline
      await Promise.race([
        currentJobPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Shutdown timeout')), WORKER_SHUTDOWN_TIMEOUT_MS)
        ),
      ]);
      workerLogger.info('[Worker] In-progress job completed');
    } catch (error) {
      if (error.message === 'Shutdown timeout') {
        workerLogger.warn({ jobId: currentJobId }, '[Worker] Shutdown timeout - job may still be running');
      } else {
        // Job failed during shutdown - that's ok, it will be retried
        workerLogger.warn({ jobId: currentJobId, err: error }, '[Worker] Job failed during shutdown');
      }
    }
  }

  currentJobPromise = null;
  currentJobId = null;
  workerLogger.info('[Worker] Stopped');
}

/**
 * Check if worker is running
 * @returns {boolean}
 */
export function isWorkerRunning() {
  return isRunning;
}

/**
 * Process jobs once (for testing)
 */
export async function processJobsOnce() {
  await processJobs();
}

export default {
  startWorker,
  stopWorker,
  isWorkerRunning,
  processJobsOnce,
};
