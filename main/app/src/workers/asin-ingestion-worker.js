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
import * as dqIssueRepo from '../repositories/dq-issue.repository.js';
import * as asinDataService from '../services/asin-data.service.js';
import { getKeepaRateLimiter, getSpApiRateLimiter } from '../lib/token-bucket.js';
import { createChildLogger } from '../lib/logger.js';
import { hasKeepaCredentials, getKeepaApiKey } from '../credentials-provider.js';
import { hasSpApiCredentials, getSpApiClientConfig, getDefaultMarketplaceId, getSellerId } from '../credentials-provider.js';
import SellingPartner from 'amazon-sp-api';

const logger = createChildLogger({ service: 'asin-ingestion' });

// =============================================================================
// SP-API BATCH NORMALIZER - Defensive input handling for identifiers
// =============================================================================

/**
 * ASIN validation regex - standard 10-character alphanumeric
 * @type {RegExp}
 */
const ASIN_REGEX = /^[A-Z0-9]{10}$/i;

/**
 * Normalize and validate a batch of ASINs for SP-API searchCatalogItems.
 *
 * Accepts: array of strings, comma-separated string, or mixed input.
 * Returns: { valid: boolean, identifiers: string, asinArray: string[], skipped: string[] }
 *
 * SP-API searchCatalogItems requires:
 * - identifiers: comma-separated string (NOT array)
 * - identifiersType: 'ASIN' (required when using identifiers)
 * - marketplaceIds: comma-separated string
 *
 * @param {string|string[]|null|undefined} input - Raw batch input
 * @param {Object} options - Configuration options
 * @param {number} [options.maxSize=20] - Max identifiers per batch (SP-API limit)
 * @returns {{ valid: boolean, identifiers: string, asinArray: string[], skipped: string[], error?: string }}
 */
export function normalizeSpApiIdentifiers(input, options = {}) {
  const { maxSize = 20 } = options;

  // Handle null/undefined/empty
  if (input == null) {
    return { valid: false, identifiers: '', asinArray: [], skipped: [], error: 'Input is null or undefined' };
  }

  // Convert to array
  let rawArray;
  if (typeof input === 'string') {
    // Split comma-separated string
    rawArray = input.split(',').map(s => s.trim());
  } else if (Array.isArray(input)) {
    rawArray = input;
  } else {
    return { valid: false, identifiers: '', asinArray: [], skipped: [], error: `Invalid input type: ${typeof input}` };
  }

  // Filter, dedupe, validate ASINs
  const seen = new Set();
  const validAsins = [];
  const skipped = [];

  for (const item of rawArray) {
    // Skip non-strings, empty, whitespace-only
    if (typeof item !== 'string' || !item.trim()) {
      if (item !== '' && item != null) skipped.push(String(item));
      continue;
    }

    const asin = item.trim().toUpperCase();

    // Skip duplicates
    if (seen.has(asin)) {
      continue;
    }

    // Validate ASIN format
    if (!ASIN_REGEX.test(asin)) {
      skipped.push(asin);
      continue;
    }

    seen.add(asin);
    validAsins.push(asin);
  }

  // Check for empty result
  if (validAsins.length === 0) {
    return { valid: false, identifiers: '', asinArray: [], skipped, error: 'No valid ASINs after filtering' };
  }

  // Slice to max size
  const slicedAsins = validAsins.slice(0, maxSize);
  if (validAsins.length > maxSize) {
    logger.warn({
      requested: validAsins.length,
      maxSize,
      sliced: slicedAsins.length,
    }, 'ASIN batch exceeds maxSize, slicing');
  }

  // Return comma-separated string (SP-API requirement)
  return {
    valid: true,
    identifiers: slicedAsins.join(','),
    asinArray: slicedAsins,
    skipped,
  };
}

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
 * Implements robust rate limiting with:
 * - Token bucket pre-check (wait for tokens before request)
 * - 429 response handling with exponential backoff
 * - Retry logic for failed batches
 * - Header-based token synchronization
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
  const MAX_RETRIES_PER_BATCH = 3;

  // Split into batches
  const batches = [];
  for (let i = 0; i < asins.length; i += CONFIG.keepaMaxBatchSize) {
    batches.push(asins.slice(i, i + CONFIG.keepaMaxBatchSize));
  }

  logger.info({ asinCount: asins.length, batchCount: batches.length }, 'Fetching Keepa data in batches');

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    let retryCount = 0;
    let batchSuccess = false;

    while (!batchSuccess && retryCount < MAX_RETRIES_PER_BATCH) {
      try {
        // CRITICAL: Wait for tokens BEFORE making request
        // This ensures we don't hit Keepa when we don't have tokens
        await rateLimiter.waitForTokens(batch.length);

        // Acquire rate limit tokens (should succeed after waitForTokens)
        const acquired = await rateLimiter.acquireForAsins(batch.length);
        if (!acquired) {
          logger.warn({
            batchIndex,
            batchSize: batch.length,
            retryCount,
          }, 'Failed to acquire rate limit tokens after waiting - will retry');
          retryCount++;
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

        // Always try to read remaining tokens from headers
        const remaining = response.headers.get('X-Rl-RemainingTokens');
        const retryAfterHeader = response.headers.get('Retry-After');

        // Handle rate limit (429) error with proper backoff
        if (response.status === 429) {
          const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;
          const tokensRemaining = remaining !== null ? parseInt(remaining, 10) : 0;

          const { waitMs, shouldRetry } = rateLimiter.handleRateLimitError({
            tokensRemaining,
            retryAfterSeconds,
            tokensNeeded: batch.length,
          });

          logger.warn({
            batchIndex,
            retryCount,
            waitMs,
            shouldRetry,
            tokensRemaining,
            retryAfterSeconds,
          }, 'Keepa 429 rate limit - backing off');

          if (shouldRetry && retryCount < MAX_RETRIES_PER_BATCH - 1) {
            await sleep(waitMs);
            retryCount++;
            continue; // Retry this batch
          } else {
            logger.error({ batchIndex }, 'Keepa rate limit - max retries exceeded, skipping batch');
            break; // Skip this batch
          }
        }

        // Update rate limiter from headers on success
        if (remaining !== null) {
          rateLimiter.updateFromHeaders(parseInt(remaining, 10));
        }

        if (!response.ok) {
          logger.error({
            batchIndex,
            status: response.status,
            statusText: response.statusText,
          }, 'Keepa API error (non-429)');
          break; // Don't retry non-429 errors
        }

        const data = await response.json();

        if (data.products && Array.isArray(data.products)) {
          const capturedAt = new Date(); // Record exact capture time for freshness tracking
          for (const product of data.products) {
            if (product.asin) {
              results.set(product.asin, { products: [product] });

              // Save raw payload with captured_at for freshness tracking
              await rawPayloadRepo.insert({
                asin: product.asin,
                marketplace_id: marketplaceId,
                source: 'keepa',
                ingestion_job_id: ingestionJobId,
                payload: { products: [product] },
                captured_at: capturedAt,
              });
            }
          }
        }

        // Success - reset error count and mark batch complete
        rateLimiter.resetErrorCount();
        batchSuccess = true;
        logger.debug({ batchIndex, successCount: results.size }, 'Keepa batch completed');

      } catch (error) {
        if (error.name === 'AbortError') {
          logger.error({ batchIndex, retryCount }, 'Keepa request timed out');
        } else {
          logger.error({ batchIndex, retryCount, error: error.message }, 'Keepa fetch error');
        }

        retryCount++;
        if (retryCount < MAX_RETRIES_PER_BATCH) {
          // Exponential backoff for network errors
          const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 30000);
          await sleep(backoffMs);
        }
      }
    }

    // Small delay between batches (even on success) to be respectful
    if (batchIndex < batches.length - 1) {
      await sleep(500);
    }
  }

  // Log rate limiter metrics at end of batch
  const limiterMetrics = rateLimiter.getMetrics();
  logger.info({
    totalAsins: asins.length,
    successCount: results.size,
    batchCount: batches.length,
    tokensRemaining: limiterMetrics.tokens,
    totalWaitTimeMs: limiterMetrics.totalWaitTime,
    throttledRequests: limiterMetrics.throttledRequests,
  }, 'Keepa fetch completed with rate limiter');

  return results;
}

/**
 * Fetch SP-API data for ASINs
 *
 * Uses getCatalogItem (singular) for each ASIN rather than searchCatalogItems (batch)
 * because the amazon-sp-api library has issues with searchCatalogItems parameter handling.
 * This approach is proven to work in amazon-data-sync.js.
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

  // Pre-validate all ASINs
  const normalizedAll = normalizeSpApiIdentifiers(asins, { maxSize: asins.length });
  if (!normalizedAll.valid) {
    logger.error({ error: normalizedAll.error, skipped: normalizedAll.skipped }, 'No valid ASINs to fetch from SP-API');
    return results;
  }

  const validAsins = normalizedAll.asinArray;

  logger.info({
    asinCount: validAsins.length,
    skippedCount: normalizedAll.skipped.length,
  }, 'Fetching SP-API catalog data (individual requests)');

  // Fetch catalog items using getCatalogItem (individual) instead of searchCatalogItems (batch)
  // The amazon-sp-api library has issues with searchCatalogItems parameter serialization
  // This pattern is proven to work in amazon-data-sync.js
  let successCount = 0;
  let errorCount = 0;
  let throttleCount = 0;
  const spApiLimiter = getSpApiRateLimiter();

  for (let i = 0; i < validAsins.length; i++) {
    const asin = validAsins[i];

    // Acquire rate limit token before making request
    await spApiLimiter.acquireForRequest('getCatalogItem');

    try {
      // Use getCatalogItem (singular) - proven working pattern from amazon-data-sync.js
      const catalogResponse = await sp.callAPI({
        operation: 'getCatalogItem',
        endpoint: 'catalogItems',
        path: { asin },
        query: {
          marketplaceIds: amazonMarketplaceId,
          includedData: 'identifiers,images,salesRanks,productTypes,summaries',
        },
      });

      if (catalogResponse) {
        results.set(asin, { catalogItem: catalogResponse });
        successCount++;
        spApiLimiter.resetThrottleCount();
      }

    } catch (error) {
      errorCount++;

      // Handle 429 throttle
      if (error.code === 'QuotaExceeded' || error.statusCode === 429) {
        throttleCount++;
        const { waitMs, shouldRetry } = spApiLimiter.handleThrottle(error.retryAfter);
        if (shouldRetry) {
          logger.warn({ asin, waitMs }, 'SP-API throttled, waiting before retry');
          await sleep(waitMs);
          i--; // Retry this ASIN
          continue;
        }
      }

      // Only log first few errors to avoid log spam
      if (errorCount <= 5) {
        logger.debug({
          asin,
          error: error.message,
          errorCode: error.code,
        }, 'SP-API getCatalogItem skipped');
      }
    }

    // Log progress every 20 ASINs
    if ((i + 1) % 20 === 0 || i === validAsins.length - 1) {
      logger.debug({
        progress: i + 1,
        total: validAsins.length,
        successCount,
        errorCount,
        throttleCount,
      }, 'SP-API catalog fetch progress');
    }
  }

  logger.info({
    totalAsins: validAsins.length,
    successCount,
    errorCount,
  }, 'SP-API catalog fetch completed');

  // For each ASIN, try to get pricing and inventory
  for (const asin of asins) {
    const payload = results.get(asin) || {};

    // Acquire rate limit token before pricing request
    await spApiLimiter.acquireForRequest('getCompetitivePricing');

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
        spApiLimiter.resetThrottleCount();
      }
    } catch (error) {
      // Handle 429 throttle for pricing
      if (error.code === 'QuotaExceeded' || error.statusCode === 429) {
        const { waitMs } = spApiLimiter.handleThrottle(error.retryAfter);
        logger.warn({ asin, waitMs }, 'SP-API pricing throttled');
        await sleep(waitMs);
        // Don't retry pricing - just skip it
      }
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
        captured_at: new Date(), // Record capture time for freshness tracking
      });
      results.set(asin, payload);
    }
  }

  // Log rate limiter metrics at end of batch
  const limiterMetrics = spApiLimiter.getMetrics();
  logger.info({
    totalAsins: asins.length,
    successCount,
    errorCount,
    throttleCount,
    totalWaitTimeMs: limiterMetrics.totalWaitTimeMs,
  }, 'SP-API fetch completed with rate limiter');

  return results;
}

/**
 * Run the transform for all ASINs in an ingestion job
 *
 * IMPORTANT: This function now compares the target ASIN list (what we intended to fetch)
 * against the raw_payloads that actually landed. Any "vanishing" ASINs (in target but
 * not in raw_payloads) get a DQ issue created and are counted as failed.
 *
 * @param {string} ingestionJobId - Ingestion job UUID
 * @param {number} marketplaceId - Marketplace ID
 * @param {string[]} targetAsins - Original list of ASINs we intended to ingest
 * @returns {Promise<{succeeded: number, failed: number, missing: string[]}>}
 */
async function runTransform(ingestionJobId, marketplaceId, targetAsins = []) {
  // Get all unique ASINs from raw payloads
  const asinsToTransform = await rawPayloadRepo.getDistinctAsinsForJob(ingestionJobId);
  const receivedAsins = new Set(asinsToTransform.map(r => r.asin));

  let succeeded = 0;
  let failed = 0;

  // CRITICAL: Detect "vanishing" ASINs - those we targeted but got no raw payloads for
  const targetSet = new Set(targetAsins);
  const missingAsins = targetAsins.filter(asin => !receivedAsins.has(asin));

  if (missingAsins.length > 0) {
    logger.warn({
      missingCount: missingAsins.length,
      missing: missingAsins.slice(0, 10), // Log first 10
      ingestionJobId,
    }, 'Detected vanishing ASINs - no raw payloads received');

    // Create DQ issues for missing ASINs
    const missingIssues = missingAsins.map(asin => ({
      asin,
      marketplace_id: marketplaceId,
      ingestion_job_id: ingestionJobId,
      issue_type: dqIssueRepo.DQ_ISSUE_TYPE.API_ERROR,
      field_name: 'raw_payload',
      severity: dqIssueRepo.DQ_SEVERITY.CRITICAL,
      message: 'ASIN was targeted for ingestion but no raw payloads were received from any source',
      details: {
        targeted: true,
        keepa_received: false,
        spapi_received: false,
      },
    }));

    await dqIssueRepo.bulkCreate(missingIssues);

    // Count missing ASINs as failed
    failed += missingAsins.length;
  }

  logger.info({
    asinCount: asinsToTransform.length,
    targetCount: targetAsins.length,
    missingCount: missingAsins.length,
    ingestionJobId,
  }, 'Starting transform');

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

      // Run transform - pass captured_at times for freshness tracking
      const result = await asinDataService.transformAndSave(
        asin,
        marketplace_id,
        ingestionJobId,
        keepaPayload?.payload || null,
        spApiPayload?.payload || null,
        {
          asinEntityId,
          ourSellerId: getSellerId(),
          keepaCapturedAt: keepaPayload?.captured_at || null,
          spApiCapturedAt: spApiPayload?.captured_at || null,
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

  logger.info({ succeeded, failed, missingCount: missingAsins.length, ingestionJobId }, 'Transform completed');

  return { succeeded, failed, missing: missingAsins };
}

// Advisory lock ID for ingestion cycle (consistent across all instances)
// Using a fixed int for pg_try_advisory_lock - this ensures only one instance runs at a time
const INGESTION_LOCK_ID = 8675309; // "ASIN_INGEST" as a memorable number

/**
 * Try to acquire a DB advisory lock for ingestion
 * Returns true if lock acquired, false if another instance holds it
 *
 * @returns {Promise<boolean>}
 */
async function tryAcquireIngestionLock() {
  try {
    const result = await query('SELECT pg_try_advisory_lock($1) AS acquired', [INGESTION_LOCK_ID]);
    return result.rows[0]?.acquired === true;
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to acquire ingestion lock');
    return false;
  }
}

/**
 * Release the DB advisory lock for ingestion
 *
 * @returns {Promise<void>}
 */
async function releaseIngestionLock() {
  try {
    await query('SELECT pg_advisory_unlock($1)', [INGESTION_LOCK_ID]);
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to release ingestion lock');
  }
}

/**
 * Run a full ingestion cycle
 *
 * Uses a PostgreSQL advisory lock to ensure only one ingestion cycle runs at a time
 * across all service instances. If another instance is already running, this returns
 * immediately with a "skipped" status.
 *
 * @returns {Promise<Object>} Ingestion result
 */
export async function runIngestionCycle() {
  const startTime = Date.now();
  const ingestionJobId = uuidv4();
  const marketplaceId = CONFIG.defaultMarketplaceId;

  // CONCURRENCY GUARD: Try to acquire advisory lock
  // Only one instance can run ingestion at a time
  const lockAcquired = await tryAcquireIngestionLock();
  if (!lockAcquired) {
    logger.info({ ingestionJobId, marketplaceId }, 'Ingestion cycle skipped - another instance is running');
    return {
      ingestion_job_id: null,
      status: 'SKIPPED',
      reason: 'Another ingestion cycle is already running',
      duration_ms: Date.now() - startTime,
    };
  }

  logger.info({ ingestionJobId, marketplaceId }, 'Starting ingestion cycle (lock acquired)');

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

    // Run transform - pass target ASINs to detect "vanishing" ASINs
    const transformResult = await runTransform(ingestionJob.id, marketplaceId, asins);

    // Determine job status based on outcomes:
    // - SUCCEEDED: all target ASINs were processed successfully
    // - PARTIAL: some ASINs succeeded, some failed (including vanishing ASINs)
    // - FAILED: no ASINs succeeded (would be caught by outer try/catch)
    const hasVanishing = transformResult.missing && transformResult.missing.length > 0;
    const hasFailures = transformResult.failed > 0;
    const status = (hasFailures || hasVanishing) ? 'PARTIAL' : 'SUCCEEDED';

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
      missing: transformResult.missing?.length || 0,
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
  } finally {
    // ALWAYS release the advisory lock, even on error
    await releaseIngestionLock();
    logger.debug('Ingestion lock released');
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
