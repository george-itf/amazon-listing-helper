/**
 * ASIN Ingestion Worker
 *
 * Scheduled job that fetches all ASIN data every 30 minutes.
 * Implements the canonical ASIN data model ingestion pipeline.
 *
 * Responsibilities:
 * - Read ASIN list (from asin_entities or listings)
 * - Generate ingestion_job_id (UUID)
 * - Fetch Keepa product data (UK domain)
 * - Fetch Amazon SP-API listing, price, inventory data
 * - Insert raw JSON into raw_payloads
 * - Trigger transform worker
 * - Log structured metrics
 * - Never block on one ASIN failing
 *
 * @module AsinIngestionWorker
 */

import { v4 as uuidv4 } from 'uuid';
import { query, transaction } from '../database/connection.js';
import * as rawPayloadRepo from '../repositories/raw-payload.repository.js';
import * as asinDataService from '../services/asin-data.service.js';
import { getKeepaRateLimiter } from '../lib/token-bucket.js';
import { createChildLogger } from '../lib/logger.js';
import { hasKeepaCredentials, getKeepaApiKey } from '../credentials-provider.js';
import { hasSpApiCredentials, getSpApiClientConfig, getDefaultMarketplaceId, getSellerId } from '../credentials-provider.js';
import SellingPartner from 'amazon-sp-api';

const logger = createChildLogger({ service: 'asin-ingestion' });

// Configuration
const CONFIG = {
  // Keepa settings
  keepaMaxBatchSize: parseInt(process.env.KEEPA_MAX_BATCH_SIZE || '10', 10),
  keepaDomainId: 2, // UK domain
  keepaStatsWindow: 90, // Days of stats

  // Ingestion settings
  ingestionIntervalMs: parseInt(process.env.ASIN_INGESTION_INTERVAL_MS || '1800000', 10), // 30 minutes
  defaultMarketplaceId: 1, // UK

  // Batch processing
  transformBatchSize: parseInt(process.env.TRANSFORM_BATCH_SIZE || '10', 10),

  // Retry settings
  maxRetries: 3,
  baseDelayMs: 2000,

  // Timeouts
  keepaTimeoutMs: 30000,
  spApiTimeoutMs: 30000,
};

// Worker state
let isRunning = false;
let ingestionInterval = null;

/**
 * Get all ASINs that should be ingested
 * Sources:
 * 1. asin_entities table (tracked ASINs)
 * 2. listings table (ASINs from our listings)
 *
 * @param {number} marketplaceId - Marketplace ID
 * @returns {Promise<string[]>} Array of unique ASINs
 */
async function getAsinsToIngest(marketplaceId) {
  const asins = new Set();

  // Get tracked ASINs from asin_entities
  try {
    const asinEntitiesResult = await query(`
      SELECT DISTINCT asin FROM asin_entities
      WHERE marketplace_id = $1 AND asin IS NOT NULL
    `, [marketplaceId]);

    for (const row of asinEntitiesResult.rows) {
      if (row.asin) asins.add(row.asin);
    }
  } catch (error) {
    if (!error.message?.includes('does not exist')) {
      throw error;
    }
  }

  // Get ASINs from listings
  try {
    const listingsResult = await query(`
      SELECT DISTINCT asin FROM listings
      WHERE asin IS NOT NULL AND asin != ''
    `);

    for (const row of listingsResult.rows) {
      if (row.asin) asins.add(row.asin);
    }
  } catch (error) {
    if (!error.message?.includes('does not exist')) {
      throw error;
    }
  }

  return Array.from(asins);
}

/**
 * Fetch Keepa data for a batch of ASINs
 *
 * @param {string[]} asins - ASINs to fetch
 * @param {string} ingestionJobId - Ingestion job UUID
 * @param {number} marketplaceId - Marketplace ID
 * @returns {Promise<Map<string, Object>>} Map of ASIN to raw payload
 */
async function fetchKeepaDataBatch(asins, ingestionJobId, marketplaceId) {
  const results = new Map();
  const rateLimiter = getKeepaRateLimiter();

  if (!hasKeepaCredentials()) {
    logger.warn('Keepa credentials not configured - skipping Keepa fetch');
    return results;
  }

  const apiKey = getKeepaApiKey();
  const KEEPA_API_BASE = 'https://api.keepa.com';

  // Split into batches
  const batches = [];
  for (let i = 0; i < asins.length; i += CONFIG.keepaMaxBatchSize) {
    batches.push(asins.slice(i, i + CONFIG.keepaMaxBatchSize));
  }

  logger.info({ asinCount: asins.length, batchCount: batches.length }, 'Fetching Keepa data in batches');

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];

    try {
      // Acquire rate limit tokens
      const acquired = await rateLimiter.acquireForAsins(batch.length);
      if (!acquired) {
        logger.warn({ batchIndex, batchSize: batch.length }, 'Failed to acquire rate limit tokens');
        continue;
      }

      // Build URL
      const params = new URLSearchParams({
        key: apiKey,
        domain: CONFIG.keepaDomainId.toString(),
        asin: batch.join(','),
        stats: CONFIG.keepaStatsWindow.toString(),
        history: '1',
        offers: '20',
      });

      // Fetch with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.keepaTimeoutMs);

      const response = await fetch(`${KEEPA_API_BASE}/product?${params.toString()}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Update rate limiter from headers
      const remaining = response.headers.get('X-Rl-RemainingTokens');
      if (remaining !== null) {
        rateLimiter.updateFromHeaders(parseInt(remaining, 10));
      }

      if (!response.ok) {
        logger.error({ batchIndex, status: response.status }, 'Keepa API error');
        continue;
      }

      const data = await response.json();

      if (data.products && Array.isArray(data.products)) {
        for (const product of data.products) {
          if (product.asin) {
            results.set(product.asin, { products: [product] });

            // Save raw payload
            await rawPayloadRepo.insert({
              asin: product.asin,
              marketplace_id: marketplaceId,
              source: 'keepa',
              ingestion_job_id: ingestionJobId,
              payload: { products: [product] },
            });
          }
        }
      }

      logger.debug({ batchIndex, successCount: results.size }, 'Keepa batch completed');

    } catch (error) {
      if (error.name === 'AbortError') {
        logger.error({ batchIndex }, 'Keepa request timed out');
      } else {
        logger.error({ batchIndex, error: error.message }, 'Keepa fetch error');
      }
      // Continue with next batch
    }

    // Small delay between batches
    if (batchIndex < batches.length - 1) {
      await sleep(500);
    }
  }

  return results;
}

/**
 * Fetch SP-API data for ASINs
 *
 * @param {string[]} asins - ASINs to fetch
 * @param {string} ingestionJobId - Ingestion job UUID
 * @param {number} marketplaceId - Marketplace ID
 * @returns {Promise<Map<string, Object>>} Map of ASIN to raw payload
 */
async function fetchSpApiDataBatch(asins, ingestionJobId, marketplaceId) {
  const results = new Map();

  if (!hasSpApiCredentials()) {
    logger.warn('SP-API credentials not configured - skipping SP-API fetch');
    return results;
  }

  const config = getSpApiClientConfig();
  const amazonMarketplaceId = getDefaultMarketplaceId();
  const sellerId = getSellerId();

  const sp = new SellingPartner({
    region: config.region,
    refresh_token: config.refresh_token,
    credentials: config.credentials,
  });

  logger.info({ asinCount: asins.length }, 'Fetching SP-API data');

  // Fetch catalog items (up to 20 at a time)
  const catalogBatchSize = 20;
  for (let i = 0; i < asins.length; i += catalogBatchSize) {
    const batch = asins.slice(i, i + catalogBatchSize);

    try {
      // Get catalog items
      // Note: 'attributes' is NOT valid for searchCatalogItems - only for getCatalogItem
      // Valid values: identifiers, images, productTypes, salesRanks, summaries, variations
      // Note: identifiers must be an array, not a comma-separated string
      const catalogResponse = await sp.callAPI({
        operation: 'searchCatalogItems',
        endpoint: 'catalogItems',
        query: {
          identifiers: batch,
          identifiersType: 'ASIN',
          marketplaceIds: [amazonMarketplaceId],
          includedData: ['identifiers', 'images', 'salesRanks', 'productTypes', 'summaries'],
        },
      });

      if (catalogResponse.items && Array.isArray(catalogResponse.items)) {
        for (const item of catalogResponse.items) {
          const itemAsin = item.asin || item.identifiers?.find(id => id.identifierType === 'ASIN')?.identifier;
          if (itemAsin) {
            results.set(itemAsin, { catalogItem: item });
          }
        }
      }

    } catch (error) {
      logger.error({ batchStart: i, error: error.message }, 'SP-API catalog fetch error');
    }

    await sleep(100); // Rate limit delay
  }

  // For each ASIN, try to get pricing and inventory
  for (const asin of asins) {
    const payload = results.get(asin) || {};

    try {
      // Get competitive pricing
      const pricingResponse = await sp.callAPI({
        operation: 'getCompetitivePricing',
        endpoint: 'productPricing',
        query: {
          MarketplaceId: amazonMarketplaceId,
          Asins: [asin],
          ItemType: 'Asin',
        },
      });

      if (pricingResponse) {
        payload.pricing = pricingResponse;
      }
    } catch (error) {
      // Pricing might not be available for all ASINs
      logger.debug({ asin, error: error.message }, 'SP-API pricing fetch skipped');
    }

    // Save raw payload if we got any data
    if (Object.keys(payload).length > 0) {
      await rawPayloadRepo.insert({
        asin,
        marketplace_id: marketplaceId,
        source: 'sp_api',
        ingestion_job_id: ingestionJobId,
        payload,
      });
      results.set(asin, payload);
    }

    await sleep(50); // Rate limit delay
  }

  return results;
}

/**
 * Run the transform for all ASINs in an ingestion job
 *
 * @param {string} ingestionJobId - Ingestion job UUID
 * @param {number} marketplaceId - Marketplace ID
 * @returns {Promise<{succeeded: number, failed: number}>}
 */
async function runTransform(ingestionJobId, marketplaceId) {
  // Get all unique ASINs from raw payloads
  const asinsToTransform = await rawPayloadRepo.getDistinctAsinsForJob(ingestionJobId);

  let succeeded = 0;
  let failed = 0;

  logger.info({ asinCount: asinsToTransform.length, ingestionJobId }, 'Starting transform');

  for (const { asin, marketplace_id } of asinsToTransform) {
    try {
      // Get raw payloads for this ASIN
      const rawPayloads = await rawPayloadRepo.getByJobAndAsin(ingestionJobId, asin, marketplace_id);

      // Find Keepa and SP-API payloads
      const keepaPayload = rawPayloads.find(p => p.source === 'keepa');
      const spApiPayload = rawPayloads.find(p => p.source === 'sp_api');

      // Get ASIN entity ID if exists
      let asinEntityId = null;
      try {
        const entityResult = await query(`
          SELECT id FROM asin_entities
          WHERE asin = $1 AND marketplace_id = $2
        `, [asin, marketplace_id]);
        asinEntityId = entityResult.rows[0]?.id;
      } catch {
        // Table might not exist
      }

      // Run transform
      const result = await asinDataService.transformAndSave(
        asin,
        marketplace_id,
        ingestionJobId,
        keepaPayload?.payload || null,
        spApiPayload?.payload || null,
        {
          asinEntityId,
          ourSellerId: getSellerId(),
        }
      );

      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }

    } catch (error) {
      logger.error({ asin, error: error.message }, 'Transform failed for ASIN');
      failed++;
    }
  }

  logger.info({ succeeded, failed, ingestionJobId }, 'Transform completed');

  return { succeeded, failed };
}

/**
 * Run a full ingestion cycle
 *
 * @returns {Promise<Object>} Ingestion result
 */
export async function runIngestionCycle() {
  const startTime = Date.now();
  const ingestionJobId = uuidv4();
  const marketplaceId = CONFIG.defaultMarketplaceId;

  logger.info({ ingestionJobId, marketplaceId }, 'Starting ingestion cycle');

  // Create ingestion job record
  const ingestionJob = await asinDataService.createIngestionJob('FULL_REFRESH', {
    marketplace_id: marketplaceId,
    started_at: new Date(),
  });

  await asinDataService.updateIngestionJob(ingestionJob.id, 'RUNNING', {
    started_at: new Date(),
  });

  try {
    // Get ASINs to ingest
    const asins = await getAsinsToIngest(marketplaceId);

    if (asins.length === 0) {
      logger.info('No ASINs to ingest');
      await asinDataService.updateIngestionJob(ingestionJob.id, 'SUCCEEDED', {
        asin_count: 0,
        asins_succeeded: 0,
        asins_failed: 0,
        completed_at: new Date(),
        duration_ms: Date.now() - startTime,
      });

      return {
        ingestion_job_id: ingestionJob.id,
        asin_count: 0,
        succeeded: 0,
        failed: 0,
        duration_ms: Date.now() - startTime,
      };
    }

    logger.info({ asinCount: asins.length }, 'ASINs to ingest');

    // Fetch data from both sources (in parallel where possible)
    const [keepaResults, spApiResults] = await Promise.all([
      fetchKeepaDataBatch(asins, ingestionJob.id, marketplaceId),
      fetchSpApiDataBatch(asins, ingestionJob.id, marketplaceId),
    ]);

    logger.info({
      keepaCount: keepaResults.size,
      spApiCount: spApiResults.size,
    }, 'Raw data fetch completed');

    // Run transform
    const transformResult = await runTransform(ingestionJob.id, marketplaceId);

    // Update job status
    const status = transformResult.failed > 0 ? 'PARTIAL' : 'SUCCEEDED';
    await asinDataService.updateIngestionJob(ingestionJob.id, status, {
      asin_count: asins.length,
      asins_succeeded: transformResult.succeeded,
      asins_failed: transformResult.failed,
      completed_at: new Date(),
      duration_ms: Date.now() - startTime,
    });

    const result = {
      ingestion_job_id: ingestionJob.id,
      asin_count: asins.length,
      succeeded: transformResult.succeeded,
      failed: transformResult.failed,
      duration_ms: Date.now() - startTime,
    };

    logger.info(result, 'Ingestion cycle completed');

    return result;

  } catch (error) {
    logger.error({ error: error.message, ingestionJobId: ingestionJob.id }, 'Ingestion cycle failed');

    await asinDataService.updateIngestionJob(ingestionJob.id, 'FAILED', {
      completed_at: new Date(),
      duration_ms: Date.now() - startTime,
      error_message: error.message,
      error_details: { stack: error.stack },
    });

    throw error;
  }
}

/**
 * Sleep utility
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Start the ingestion worker
 */
export function startWorker() {
  if (isRunning) {
    logger.info('Ingestion worker already running');
    return;
  }

  logger.info({ intervalMs: CONFIG.ingestionIntervalMs }, 'Starting ASIN ingestion worker');
  isRunning = true;

  // Run immediately, then set interval
  runIngestionCycle().catch(err => {
    logger.error({ error: err.message }, 'Initial ingestion cycle failed');
  });

  ingestionInterval = setInterval(async () => {
    if (!isRunning) return;

    try {
      await runIngestionCycle();
    } catch (error) {
      logger.error({ error: error.message }, 'Scheduled ingestion cycle failed');
    }
  }, CONFIG.ingestionIntervalMs);
}

/**
 * Stop the ingestion worker
 */
export function stopWorker() {
  if (!isRunning) {
    logger.info('Ingestion worker not running');
    return;
  }

  logger.info('Stopping ASIN ingestion worker');
  isRunning = false;

  if (ingestionInterval) {
    clearInterval(ingestionInterval);
    ingestionInterval = null;
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
 * Run a single ingestion cycle (for testing or manual trigger)
 */
export async function runOnce() {
  return runIngestionCycle();
}

export default {
  startWorker,
  stopWorker,
  isWorkerRunning,
  runOnce,
  runIngestionCycle,
  getAsinsToIngest,
};
