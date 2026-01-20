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
import { hasSpApiCredentials, getSpApiCredentials } from '../credentials-provider.js';

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
  console.log(`[Worker] Processing job ${job.id}: ${job.job_type}`);

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
    case 'GENERATE_RECOMMENDATIONS_ASIN':
      // TODO: Implement in Slice D
      throw new Error(`Job type ${job.job_type} not yet implemented`);

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

  console.log(`[Worker] Publishing price change for listing ${listingId}: £${newPrice}`);

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
    console.log(`[Worker] No SP-API credentials - simulating success`);

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

  console.log(`[Worker] Publishing stock change for listing ${listingId}: ${newQuantity} units`);

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
    console.log(`[Worker] No SP-API credentials - simulating success`);

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
    SET price_inc_vat = $2, updated_at = CURRENT_TIMESTAMP
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
    SET available_quantity = $2, updated_at = CURRENT_TIMESTAMP
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
 * Record price change success event
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
 * Record stock change success event
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
 * Call SP-API to update price
 * TODO: Implement actual SP-API call
 * @param {number} listingId
 * @param {number} newPrice
 * @returns {Promise<Object>}
 */
async function callSpApiUpdatePrice(listingId, newPrice) {
  // Get listing SKU
  const result = await query('SELECT seller_sku FROM listings WHERE id = $1', [listingId]);
  if (result.rows.length === 0) {
    throw new Error(`Listing not found: ${listingId}`);
  }

  const sellerSku = result.rows[0].seller_sku;
  const credentials = getSpApiCredentials();

  // TODO: Implement actual SP-API call using @sp-api-sdk or direct HTTP
  // For now, simulate success
  console.log(`[Worker] TODO: Call SP-API to update price for SKU ${sellerSku} to £${newPrice}`);

  return {
    status: 'simulated',
    seller_sku: sellerSku,
    new_price: newPrice,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Call SP-API to update inventory
 * TODO: Implement actual SP-API call
 * @param {number} listingId
 * @param {number} newQuantity
 * @returns {Promise<Object>}
 */
async function callSpApiUpdateInventory(listingId, newQuantity) {
  // Get listing SKU
  const result = await query('SELECT seller_sku FROM listings WHERE id = $1', [listingId]);
  if (result.rows.length === 0) {
    throw new Error(`Listing not found: ${listingId}`);
  }

  const sellerSku = result.rows[0].seller_sku;
  const credentials = getSpApiCredentials();

  // TODO: Implement actual SP-API call using @sp-api-sdk or direct HTTP
  // For now, simulate success
  console.log(`[Worker] TODO: Call SP-API to update inventory for SKU ${sellerSku} to ${newQuantity}`);

  return {
    status: 'simulated',
    seller_sku: sellerSku,
    new_quantity: newQuantity,
    timestamp: new Date().toISOString(),
  };
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

  console.log(`[Worker] Syncing Keepa data for ASIN ${asin}`);

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

  console.log(`[Worker] Computing features for listing ${listingId}`);

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

  console.log(`[Worker] Computing features for ASIN entity ${asinEntityId}`);

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

  console.log(`[Worker] Processing ${jobType} for listing ${listingId}`);

  // Check if we have SP-API credentials
  if (!hasSpApiCredentials()) {
    console.log(`[Worker] No SP-API credentials - simulating ${jobType}`);
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
        console.log(`[Worker] Job ${job.id} succeeded`);

      } catch (error) {
        console.error(`[Worker] Job ${job.id} failed:`, error.message);

        // Mark as failed (will retry if attempts < max_attempts)
        await jobRepo.markFailed(job.id, error.message, {
          error: error.message,
          stack: error.stack,
        });
      }
    }

  } catch (error) {
    console.error('[Worker] Error in worker loop:', error);
  }
}

/**
 * Start the job worker
 */
export function startWorker() {
  if (isRunning) {
    console.log('[Worker] Already running');
    return;
  }

  console.log(`[Worker] Starting (poll interval: ${WORKER_POLL_INTERVAL_MS}ms, batch size: ${WORKER_BATCH_SIZE})`);
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
    console.log('[Worker] Not running');
    return;
  }

  console.log('[Worker] Stopping');
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
