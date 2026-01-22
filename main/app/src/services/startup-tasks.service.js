/**
 * Startup Tasks Service
 *
 * Runs automatic data sync and feature computation on server startup.
 * Ensures listings have fresh data without manual intervention.
 *
 * @module StartupTasksService
 */

import { query } from '../database/connection.js';
import { logger } from '../lib/logger.js';

const FEATURE_STALENESS_HOURS = 24; // Consider features stale after 24 hours
const KEEPA_STALENESS_DAYS = 7; // Consider Keepa data stale after 7 days

/**
 * Safe database query - returns null on table not exist errors
 */
async function safeQuery(text, params = [], operation = 'query') {
  try {
    return await query(text, params);
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      logger.warn({ operation }, `[Startup] Skipping ${operation}: table does not exist`);
      return null;
    }
    throw error;
  }
}

/**
 * Queue feature computation jobs for listings with stale/missing features
 * @returns {Promise<{queued: number, skipped: number}>}
 */
export async function queueStaleFeatureJobs() {
  try {
    // Find listings without recent features
    const result = await safeQuery(`
      SELECT l.id as listing_id
      FROM listings l
      LEFT JOIN LATERAL (
        SELECT computed_at
        FROM feature_store fs
        WHERE fs.entity_type = 'LISTING' AND fs.entity_id = l.id
        ORDER BY fs.computed_at DESC
        LIMIT 1
      ) latest_fs ON true
      WHERE l.status = 'active'
        AND (
          latest_fs.computed_at IS NULL
          OR latest_fs.computed_at < NOW() - INTERVAL '${FEATURE_STALENESS_HOURS} hours'
        )
    `, [], 'find_stale_features');

    if (!result || result.rows.length === 0) {
      logger.info('[Startup] All listings have fresh features');
      return { queued: 0, skipped: 0 };
    }

    const listingIds = result.rows.map(r => r.listing_id);
    logger.info({ count: listingIds.length }, '[Startup] Found listings needing feature computation');

    // Check which listings already have pending feature jobs
    const existingJobs = await safeQuery(`
      SELECT DISTINCT listing_id
      FROM jobs
      WHERE job_type = 'COMPUTE_FEATURES_LISTING'
        AND status = 'PENDING'
        AND listing_id = ANY($1)
    `, [listingIds], 'check_existing_jobs');

    const existingJobListingIds = new Set(existingJobs?.rows.map(r => r.listing_id) || []);
    const listingsToQueue = listingIds.filter(id => !existingJobListingIds.has(id));

    if (listingsToQueue.length === 0) {
      logger.info('[Startup] All stale listings already have pending feature jobs');
      return { queued: 0, skipped: listingIds.length };
    }

    // Batch insert jobs using UNNEST
    await safeQuery(`
      INSERT INTO jobs (job_type, scope_type, listing_id, status, priority, input_json, created_by)
      SELECT
        'COMPUTE_FEATURES_LISTING',
        'LISTING',
        unnest($1::integer[]),
        'PENDING',
        5,
        '{"trigger": "startup", "triggered_at": "${new Date().toISOString()}"}'::jsonb,
        'startup'
    `, [listingsToQueue], 'queue_feature_jobs');

    logger.info({ queued: listingsToQueue.length, skipped: existingJobListingIds.size }, '[Startup] Queued feature computation jobs');
    return { queued: listingsToQueue.length, skipped: existingJobListingIds.size };
  } catch (error) {
    logger.error({ err: error }, '[Startup] Failed to queue feature jobs');
    return { queued: 0, skipped: 0, error: error.message };
  }
}

/**
 * Queue Keepa sync jobs for listings with stale/missing Keepa data
 * @returns {Promise<{queued: number, skipped: number}>}
 */
export async function queueStaleKeepaJobs() {
  // Check if Keepa API key is configured
  if (!process.env.KEEPA_API_KEY) {
    logger.info('[Startup] Keepa API key not configured - skipping Keepa sync');
    return { queued: 0, skipped: 0, reason: 'no_api_key' };
  }

  try {
    // Find listings without recent Keepa data
    const result = await safeQuery(`
      SELECT l.id as listing_id, l.asin
      FROM listings l
      LEFT JOIN LATERAL (
        SELECT observed_at
        FROM keepa_snapshots ks
        WHERE ks.asin = l.asin
        ORDER BY ks.observed_at DESC
        LIMIT 1
      ) latest_ks ON true
      WHERE l.status = 'active'
        AND l.asin IS NOT NULL
        AND (
          latest_ks.observed_at IS NULL
          OR latest_ks.observed_at < NOW() - INTERVAL '${KEEPA_STALENESS_DAYS} days'
        )
    `, [], 'find_stale_keepa');

    if (!result || result.rows.length === 0) {
      logger.info('[Startup] All listings have fresh Keepa data');
      return { queued: 0, skipped: 0 };
    }

    const listings = result.rows;
    logger.info({ count: listings.length }, '[Startup] Found listings needing Keepa sync');

    // Check which ASINs already have pending Keepa jobs
    const asins = listings.map(l => l.asin);
    const existingJobs = await safeQuery(`
      SELECT DISTINCT input_json->>'asin' as asin
      FROM jobs
      WHERE job_type = 'SYNC_KEEPA_ASIN'
        AND status = 'PENDING'
        AND input_json->>'asin' = ANY($1)
    `, [asins], 'check_existing_keepa_jobs');

    const existingJobAsins = new Set(existingJobs?.rows.map(r => r.asin) || []);
    const listingsToQueue = listings.filter(l => !existingJobAsins.has(l.asin));

    if (listingsToQueue.length === 0) {
      logger.info('[Startup] All stale listings already have pending Keepa jobs');
      return { queued: 0, skipped: listings.length };
    }

    // Queue Keepa sync jobs
    for (const listing of listingsToQueue) {
      await safeQuery(`
        INSERT INTO jobs (job_type, scope_type, listing_id, status, priority, input_json, created_by)
        VALUES ('SYNC_KEEPA_ASIN', 'LISTING', $1, 'PENDING', 4, $2, 'startup')
      `, [
        listing.listing_id,
        JSON.stringify({
          asin: listing.asin,
          marketplace_id: 1, // UK
          trigger: 'startup',
          triggered_at: new Date().toISOString(),
        }),
      ], 'queue_keepa_job');
    }

    logger.info({ queued: listingsToQueue.length, skipped: existingJobAsins.size }, '[Startup] Queued Keepa sync jobs');
    return { queued: listingsToQueue.length, skipped: existingJobAsins.size };
  } catch (error) {
    logger.error({ err: error }, '[Startup] Failed to queue Keepa jobs');
    return { queued: 0, skipped: 0, error: error.message };
  }
}

/**
 * Run all startup tasks
 * Called from server.js after worker starts
 * Non-blocking - runs in background
 */
export async function runStartupTasks() {
  logger.info('[Startup] Running startup tasks...');

  try {
    // Run tasks in parallel
    const [featureResult, keepaResult] = await Promise.all([
      queueStaleFeatureJobs(),
      queueStaleKeepaJobs(),
    ]);

    logger.info({
      features: featureResult,
      keepa: keepaResult,
    }, '[Startup] Startup tasks completed');

    return {
      features: featureResult,
      keepa: keepaResult,
    };
  } catch (error) {
    logger.error({ err: error }, '[Startup] Startup tasks failed');
    return { error: error.message };
  }
}

export default {
  runStartupTasks,
  queueStaleFeatureJobs,
  queueStaleKeepaJobs,
};
