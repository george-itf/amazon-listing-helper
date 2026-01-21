/**
 * Job Worker
 *
 * Processes pending jobs from the jobs queue.
 * Per SPEC §6 and DATA_CONTRACTS.md §10.
 *
 * This worker handles:
 * - PUBLISH_PRICE_CHANGE: Publish price changes to Amazon
 * - PUBLISH_STOCK_CHANGE: Publish stock changes to Amazon
 * - (Future) SYNC_AMAZON_*, SYNC_KEEPA_*, COMPUTE_FEATURES_*, GENERATE_RECOMMENDATIONS_*
 *
 * @module JobWorker
 */

import { query, transaction } from '../database/connection.js';
import * as jobRepo from '../repositories/job.repository.js';
import { hasSpApiCredentials, getSpApiClientConfig, getSellerId, getDefaultMarketplaceId } from '../credentials-provider.js';
import SellingPartner from 'amazon-sp-api';
import { workerLogger, logJobEvent } from '../lib/logger.js';
import { recordJobEvent, updateJobQueueLength } from '../lib/metrics.js';
import { captureException } from '../lib/sentry.js';

// Worker configuration
const WORKER_POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS || '5000', 10);
const WORKER_BATCH_SIZE = parseInt(process.env.WORKER_BATCH_SIZE || '5', 10);

let isRunning = false;
let workerInterval = null;

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
 * @param {Object} job
 * @returns {Promise<Object>}
 */
async function processPriceChange(job) {
  const input = job.input_json;
  const listingId = job.listing_id;
  const newPrice = input.price_inc_vat;
  const listingEventId = input.listing_event_id;

  workerLogger.info({ listingId, newPrice }, 'Publishing price change');

  // Update listing_event to PUBLISHED
  await query(`
    INSERT INTO listing_events (listing_id, event_type, job_id, before_json, after_json, reason, created_by)
    VALUES ($1, 'PRICE_CHANGE_PUBLISHED', $2, $3, $4, $5, 'worker')
  `, [
    listingId,
    job.id,
    JSON.stringify({ price_inc_vat: input.previous_price_inc_vat }),
    JSON.stringify({ price_inc_vat: newPrice }),
    input.reason,
  ]);

  // Check if we have SP-API credentials
  if (!hasSpApiCredentials()) {
    // STUB: No credentials, simulate success for development
    workerLogger.warn('No SP-API credentials - simulating success');

    // Update local database
    await updateListingPrice(listingId, newPrice);

    // Record success event
    await recordPriceChangeSuccess(listingId, job.id, input);

    return {
      success: true,
      simulated: true,
      message: 'Price change simulated (no SP-API credentials)',
      new_price: newPrice,
    };
  }

  // TODO: Implement actual SP-API call
  // For now, we'll update local database and mark as success
  try {
    // Call SP-API to update price
    const spApiResult = await callSpApiUpdatePrice(listingId, newPrice);

    // Update local database
    await updateListingPrice(listingId, newPrice);

    // Record success event
    await recordPriceChangeSuccess(listingId, job.id, input);

    return {
      success: true,
      sp_api_response: spApiResult,
      new_price: newPrice,
    };
  } catch (error) {
    // Record failure event
    await recordPriceChangeFailure(listingId, job.id, input, error.message);
    throw error;
  }
}

/**
 * Process PUBLISH_STOCK_CHANGE job
 * @param {Object} job
 * @returns {Promise<Object>}
 */
async function processStockChange(job) {
  const input = job.input_json;
  const listingId = job.listing_id;
  const newQuantity = input.available_quantity;
  const listingEventId = input.listing_event_id;

  workerLogger.info(` Publishing stock change for listing ${listingId}: ${newQuantity} units`);

  // Update listing_event to PUBLISHED
  await query(`
    INSERT INTO listing_events (listing_id, event_type, job_id, before_json, after_json, reason, created_by)
    VALUES ($1, 'STOCK_CHANGE_PUBLISHED', $2, $3, $4, $5, 'worker')
  `, [
    listingId,
    job.id,
    JSON.stringify({ available_quantity: input.previous_quantity }),
    JSON.stringify({ available_quantity: newQuantity }),
    input.reason,
  ]);

  // Check if we have SP-API credentials
  if (!hasSpApiCredentials()) {
    // STUB: No credentials, simulate success for development
    workerLogger.warn('No SP-API credentials - simulating success');

    // Update local database
    await updateListingStock(listingId, newQuantity);

    // Record success event
    await recordStockChangeSuccess(listingId, job.id, input);

    return {
      success: true,
      simulated: true,
      message: 'Stock change simulated (no SP-API credentials)',
      new_quantity: newQuantity,
    };
  }

  // TODO: Implement actual SP-API call
  try {
    // Call SP-API to update inventory
    const spApiResult = await callSpApiUpdateInventory(listingId, newQuantity);

    // Update local database
    await updateListingStock(listingId, newQuantity);

    // Record success event
    await recordStockChangeSuccess(listingId, job.id, input);

    return {
      success: true,
      sp_api_response: spApiResult,
      new_quantity: newQuantity,
    };
  } catch (error) {
    // Record failure event
    await recordStockChangeFailure(listingId, job.id, input, error.message);
    throw error;
  }
}

/**
 * Update listing price in local database
 * @param {number} listingId
 * @param {number} newPrice
 */
async function updateListingPrice(listingId, newPrice) {
  await query(`
    UPDATE listings
    SET price_inc_vat = $2, "updatedAt" = CURRENT_TIMESTAMP
    WHERE id = $1
  `, [listingId, newPrice]);

  // Update listing_offer_current if exists
  await query(`
    INSERT INTO listing_offer_current (listing_id, price_inc_vat, observed_at)
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT (listing_id) DO UPDATE SET
      price_inc_vat = $2,
      observed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `, [listingId, newPrice]);
}

/**
 * Update listing stock in local database
 * @param {number} listingId
 * @param {number} newQuantity
 */
async function updateListingStock(listingId, newQuantity) {
  await query(`
    UPDATE listings
    SET available_quantity = $2, "updatedAt" = CURRENT_TIMESTAMP
    WHERE id = $1
  `, [listingId, newQuantity]);

  // Update listing_offer_current if exists
  await query(`
    INSERT INTO listing_offer_current (listing_id, available_quantity, observed_at)
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT (listing_id) DO UPDATE SET
      available_quantity = $2,
      observed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `, [listingId, newQuantity]);
}

/**
 * Record price change success event and queue feature recompute
 */
async function recordPriceChangeSuccess(listingId, jobId, input) {
  await query(`
    INSERT INTO listing_events (listing_id, event_type, job_id, before_json, after_json, reason, created_by)
    VALUES ($1, 'PRICE_CHANGE_SUCCEEDED', $2, $3, $4, $5, 'worker')
  `, [
    listingId,
    jobId,
    JSON.stringify({ price_inc_vat: input.previous_price_inc_vat }),
    JSON.stringify({ price_inc_vat: input.price_inc_vat }),
    input.reason,
  ]);

  // Queue feature recompute after price change (Addendum E)
  await queueFeatureRecompute(listingId, 'price_change');
}

/**
 * Record price change failure event
 */
async function recordPriceChangeFailure(listingId, jobId, input, errorMessage) {
  await query(`
    INSERT INTO listing_events (listing_id, event_type, job_id, before_json, after_json, reason, created_by)
    VALUES ($1, 'PRICE_CHANGE_FAILED', $2, $3, $4, $5, 'worker')
  `, [
    listingId,
    jobId,
    JSON.stringify({ price_inc_vat: input.previous_price_inc_vat }),
    JSON.stringify({ price_inc_vat: input.price_inc_vat, error: errorMessage }),
    input.reason,
  ]);
}

/**
 * Record stock change success event and queue feature recompute
 */
async function recordStockChangeSuccess(listingId, jobId, input) {
  await query(`
    INSERT INTO listing_events (listing_id, event_type, job_id, before_json, after_json, reason, created_by)
    VALUES ($1, 'STOCK_CHANGE_SUCCEEDED', $2, $3, $4, $5, 'worker')
  `, [
    listingId,
    jobId,
    JSON.stringify({ available_quantity: input.previous_quantity }),
    JSON.stringify({ available_quantity: input.available_quantity }),
    input.reason,
  ]);

  // Queue feature recompute after stock change (Addendum E)
  await queueFeatureRecompute(listingId, 'stock_change');
}

/**
 * Record stock change failure event
 */
async function recordStockChangeFailure(listingId, jobId, input, errorMessage) {
  await query(`
    INSERT INTO listing_events (listing_id, event_type, job_id, before_json, after_json, reason, created_by)
    VALUES ($1, 'STOCK_CHANGE_FAILED', $2, $3, $4, $5, 'worker')
  `, [
    listingId,
    jobId,
    JSON.stringify({ available_quantity: input.previous_quantity }),
    JSON.stringify({ available_quantity: input.available_quantity, error: errorMessage }),
    input.reason,
  ]);
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
    const existing = await query(`
      SELECT id FROM jobs
      WHERE listing_id = $1
        AND job_type = 'COMPUTE_FEATURES_LISTING'
        AND status = 'PENDING'
      LIMIT 1
    `, [listingId]);

    if (existing.rows.length > 0) {
      workerLogger.info(` Feature recompute already pending for listing ${listingId}`);
      return;
    }

    // Create low-priority feature recompute job
    await query(`
      INSERT INTO jobs (
        job_type, scope_type, listing_id, status, priority, input_json, created_by
      ) VALUES ('COMPUTE_FEATURES_LISTING', 'LISTING', $1, 'PENDING', 3, $2, 'worker')
    `, [
      listingId,
      JSON.stringify({ trigger: reason, triggered_at: new Date().toISOString() }),
    ]);

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

  // Create listing event if this is for a listing
  if (job.listing_id) {
    await query(`
      INSERT INTO listing_events (listing_id, event_type, job_id, after_json, created_by)
      VALUES ($1, 'KEEPA_SYNC_COMPLETED', $2, $3, 'worker')
    `, [job.listing_id, job.id, JSON.stringify(result)]);
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

  // Create listing event
  await query(`
    INSERT INTO listing_events (listing_id, event_type, job_id, after_json, created_by)
    VALUES ($1, 'FEATURES_COMPUTED', $2, $3, 'worker')
  `, [listingId, job.id, JSON.stringify({ feature_store_id: result.feature_store_id })]);

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
 * Process SYNC_AMAZON_* jobs (stub implementation)
 * @param {Object} job
 * @returns {Promise<Object>}
 */
async function processSyncAmazon(job) {
  const listingId = job.listing_id;
  const jobType = job.job_type;

  workerLogger.info(` Processing ${jobType} for listing ${listingId}`);

  // Check if we have SP-API credentials
  if (!hasSpApiCredentials()) {
    workerLogger.info(` No SP-API credentials - simulating ${jobType}`);
    return {
      success: true,
      simulated: true,
      message: `${jobType} simulated (no SP-API credentials)`,
    };
  }

  // TODO: Implement actual SP-API calls
  // For now, return success with simulation flag
  switch (jobType) {
    case 'SYNC_AMAZON_OFFER':
      // Would call SP-API to get current offer data
      return {
        success: true,
        simulated: true,
        message: 'Offer sync not yet implemented',
      };

    case 'SYNC_AMAZON_SALES':
      // Would call SP-API to get sales data
      return {
        success: true,
        simulated: true,
        message: 'Sales sync not yet implemented',
      };

    case 'SYNC_AMAZON_CATALOG':
      // Would call SP-API to get catalog data
      return {
        success: true,
        simulated: true,
        message: 'Catalog sync not yet implemented',
      };

    default:
      throw new Error(`Unknown Amazon sync type: ${jobType}`);
  }
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
 * Main worker loop - process pending jobs
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

        // Process the job
        const result = await processJob(claimedJob);

        // Mark as succeeded
        await jobRepo.markSucceeded(job.id, result);
        const durationMs = Date.now() - Date.parse(job.created_at || job.createdAt);
        logJobEvent({ jobId: job.id, jobType: job.job_type, status: 'completed' });
        recordJobEvent({ type: job.job_type, status: 'success', durationMs });
        workerLogger.info({ jobId: job.id, jobType: job.job_type, durationMs }, 'Job succeeded');

      } catch (error) {
        logJobEvent({ jobId: job.id, jobType: job.job_type, status: 'failed', error: error.message });
        recordJobEvent({ type: job.job_type, status: 'failed', isRetry: job.attempt > 1 });
        captureException(error, { jobId: job.id, jobType: job.job_type });
        workerLogger.error({ jobId: job.id, err: error }, 'Job failed');

        // Mark as failed (will retry if attempts < max_attempts)
        await jobRepo.markFailed(job.id, error.message, {
          error: error.message,
          stack: error.stack,
        });
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
 */
export function stopWorker() {
  if (!isRunning) {
    workerLogger.info('[Worker] Not running');
    return;
  }

  workerLogger.info('[Worker] Stopping');
  isRunning = false;

  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
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
