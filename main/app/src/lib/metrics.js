/**
 * Metrics Module
 *
 * Provides Prometheus metrics for observability using prom-client.
 *
 * Exposes metrics at /metrics endpoint for scraping.
 *
 * Usage:
 *   import { metrics, recordApiCall, recordJobEvent } from './lib/metrics.js';
 *
 * @module Metrics
 */

import client from 'prom-client';

// Create a Registry
const register = new client.Registry();

// Add default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({ register });

// ============================================================================
// KEEPA METRICS
// ============================================================================

export const keepaApiCalls = new client.Counter({
  name: 'keepa_api_calls_total',
  help: 'Total number of Keepa API calls',
  labelNames: ['status', 'batched'],
  registers: [register],
});

export const keepaApiLatency = new client.Histogram({
  name: 'keepa_api_latency_seconds',
  help: 'Keepa API call latency in seconds',
  labelNames: ['status'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

export const keepaRateLimitEvents = new client.Counter({
  name: 'keepa_rate_limit_events_total',
  help: 'Number of Keepa rate limit (429) responses',
  registers: [register],
});

export const keepaTokensRemaining = new client.Gauge({
  name: 'keepa_tokens_remaining',
  help: 'Remaining Keepa API tokens (quota)',
  registers: [register],
});

export const keepaCacheHits = new client.Counter({
  name: 'keepa_cache_hits_total',
  help: 'Number of Keepa cache hits',
  registers: [register],
});

export const keepaCacheMisses = new client.Counter({
  name: 'keepa_cache_misses_total',
  help: 'Number of Keepa cache misses',
  registers: [register],
});

// ============================================================================
// SP-API METRICS
// ============================================================================

export const spApiCalls = new client.Counter({
  name: 'spapi_calls_total',
  help: 'Total number of SP-API calls',
  labelNames: ['api', 'operation', 'status'],
  registers: [register],
});

export const spApiLatency = new client.Histogram({
  name: 'spapi_latency_seconds',
  help: 'SP-API call latency in seconds',
  labelNames: ['api', 'operation'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [register],
});

export const spApiErrors = new client.Counter({
  name: 'spapi_errors_total',
  help: 'Total number of SP-API errors',
  labelNames: ['api', 'error_type'],
  registers: [register],
});

export const spApiRateLimitEvents = new client.Counter({
  name: 'spapi_rate_limit_events_total',
  help: 'Number of SP-API rate limit (429) responses',
  labelNames: ['api'],
  registers: [register],
});

export const spApiFeedStatus = new client.Counter({
  name: 'spapi_feed_status_total',
  help: 'Feed processing status counts',
  labelNames: ['status'],
  registers: [register],
});

// ============================================================================
// JOB METRICS
// ============================================================================

export const jobsTotal = new client.Counter({
  name: 'jobs_total',
  help: 'Total number of jobs processed',
  labelNames: ['type', 'status'],
  registers: [register],
});

export const jobDuration = new client.Histogram({
  name: 'job_duration_seconds',
  help: 'Job processing duration in seconds',
  labelNames: ['type'],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300],
  registers: [register],
});

export const jobRetries = new client.Counter({
  name: 'job_retries_total',
  help: 'Total number of job retries',
  labelNames: ['type'],
  registers: [register],
});

export const jobQueueLength = new client.Gauge({
  name: 'job_queue_length',
  help: 'Current number of jobs in queue',
  labelNames: ['status'],
  registers: [register],
});

// ============================================================================
// TOKEN HEALTH METRICS
// ============================================================================

export const tokenExpirySeconds = new client.Gauge({
  name: 'spapi_token_expiry_seconds',
  help: 'Seconds until SP-API access token expires',
  registers: [register],
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Record a Keepa API call
 * @param {Object} opts - Options
 * @param {boolean} opts.success - Whether the call succeeded
 * @param {boolean} opts.batched - Whether this was a batch call
 * @param {number} opts.durationMs - Duration in milliseconds
 * @param {boolean} [opts.rateLimited] - Whether the call was rate limited
 * @param {number} [opts.tokensRemaining] - Remaining tokens after call
 * @param {boolean} [opts.cacheHit] - Whether this was a cache hit
 */
export function recordKeepaCall(opts) {
  const { success, batched, durationMs, rateLimited, tokensRemaining, cacheHit } = opts;

  keepaApiCalls.inc({ status: success ? 'success' : 'error', batched: batched ? 'true' : 'false' });
  keepaApiLatency.observe({ status: success ? 'success' : 'error' }, durationMs / 1000);

  if (rateLimited) {
    keepaRateLimitEvents.inc();
  }

  if (tokensRemaining !== undefined) {
    keepaTokensRemaining.set(tokensRemaining);
  }

  if (cacheHit === true) {
    keepaCacheHits.inc();
  } else if (cacheHit === false) {
    keepaCacheMisses.inc();
  }
}

/**
 * Record an SP-API call
 * @param {Object} opts - Options
 * @param {string} opts.api - API name (e.g., 'listings', 'orders', 'reports')
 * @param {string} opts.operation - Operation name
 * @param {boolean} opts.success - Whether the call succeeded
 * @param {number} opts.durationMs - Duration in milliseconds
 * @param {string} [opts.errorType] - Error type if failed
 * @param {boolean} [opts.rateLimited] - Whether the call was rate limited
 */
export function recordSpApiCall(opts) {
  const { api, operation, success, durationMs, errorType, rateLimited } = opts;

  spApiCalls.inc({ api, operation, status: success ? 'success' : 'error' });
  spApiLatency.observe({ api, operation }, durationMs / 1000);

  if (!success && errorType) {
    spApiErrors.inc({ api, error_type: errorType });
  }

  if (rateLimited) {
    spApiRateLimitEvents.inc({ api });
  }
}

/**
 * Record a job event
 * @param {Object} opts - Options
 * @param {string} opts.type - Job type
 * @param {string} opts.status - Job status ('success', 'failed', 'retry')
 * @param {number} [opts.durationMs] - Duration in milliseconds
 * @param {boolean} [opts.isRetry] - Whether this was a retry
 */
export function recordJobEvent(opts) {
  const { type, status, durationMs, isRetry } = opts;

  jobsTotal.inc({ type, status });

  if (durationMs !== undefined) {
    jobDuration.observe({ type }, durationMs / 1000);
  }

  if (isRetry) {
    jobRetries.inc({ type });
  }
}

/**
 * Update job queue length
 * @param {string} status - Queue status (e.g., 'pending', 'processing')
 * @param {number} length - Current queue length
 */
export function updateJobQueueLength(status, length) {
  jobQueueLength.set({ status }, length);
}

/**
 * Record feed processing status
 * @param {string} status - Feed status ('done', 'error', 'cancelled')
 */
export function recordFeedStatus(status) {
  spApiFeedStatus.inc({ status });
}

/**
 * Update token expiry gauge
 * @param {number} expiresInSeconds - Seconds until token expires
 */
export function updateTokenExpiry(expiresInSeconds) {
  tokenExpirySeconds.set(expiresInSeconds);
}

/**
 * Get the metrics registry
 * @returns {client.Registry} Prometheus registry
 */
export function getRegistry() {
  return register;
}

/**
 * Get metrics as string (for /metrics endpoint)
 * @returns {Promise<string>} Metrics in Prometheus format
 */
export async function getMetrics() {
  return register.metrics();
}

/**
 * Get metrics content type
 * @returns {string} Content type for metrics response
 */
export function getContentType() {
  return register.contentType;
}

export default {
  // Metrics
  keepaApiCalls,
  keepaApiLatency,
  keepaRateLimitEvents,
  keepaTokensRemaining,
  keepaCacheHits,
  keepaCacheMisses,
  spApiCalls,
  spApiLatency,
  spApiErrors,
  spApiRateLimitEvents,
  spApiFeedStatus,
  jobsTotal,
  jobDuration,
  jobRetries,
  jobQueueLength,
  tokenExpirySeconds,
  // Helpers
  recordKeepaCall,
  recordSpApiCall,
  recordJobEvent,
  updateJobQueueLength,
  recordFeedStatus,
  updateTokenExpiry,
  getRegistry,
  getMetrics,
  getContentType,
};
