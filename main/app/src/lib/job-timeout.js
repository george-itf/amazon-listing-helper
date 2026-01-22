/**
 * Job Timeout Module
 *
 * Provides timeout wrapping for job execution.
 * Per REPO_REVIEW_REPORT A.3.1 - Per-job timeout.
 *
 * @module JobTimeout
 */

/**
 * Wrap a promise with a timeout
 * @param {Promise} promise - The promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} jobId - Job identifier for error messages
 * @returns {Promise} - Resolves with promise result or rejects with timeout error
 */
export function withTimeout(promise, timeoutMs, jobId = 'unknown') {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`Job ${jobId} timed out after ${timeoutMs}ms`);
      error.code = 'JOB_TIMEOUT';
      error.jobId = jobId;
      error.timeoutMs = timeoutMs;
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([
    promise.then(result => {
      clearTimeout(timeoutId);
      return result;
    }).catch(error => {
      clearTimeout(timeoutId);
      throw error;
    }),
    timeoutPromise,
  ]);
}

/**
 * Create an abort controller with timeout
 * Useful for canceling HTTP requests on job timeout
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {{ controller: AbortController, timeoutId: NodeJS.Timeout }}
 */
export function createAbortableTimeout(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return {
    controller,
    timeoutId,
    clear: () => clearTimeout(timeoutId),
    signal: controller.signal,
  };
}

// Default job timeout from environment or 5 minutes
export const DEFAULT_JOB_TIMEOUT_MS = parseInt(process.env.JOB_TIMEOUT_MS || '300000', 10);

// Timeouts by job type (can be customized)
export const JOB_TIMEOUTS = {
  PUBLISH_PRICE_CHANGE: 60000,     // 1 minute
  PUBLISH_STOCK_CHANGE: 60000,     // 1 minute
  SYNC_KEEPA_ASIN: 120000,         // 2 minutes
  COMPUTE_FEATURES_LISTING: 30000, // 30 seconds
  COMPUTE_FEATURES_ASIN: 30000,    // 30 seconds
  SYNC_AMAZON_OFFER: 300000,       // 5 minutes
  SYNC_AMAZON_SALES: 300000,       // 5 minutes
  SYNC_AMAZON_CATALOG: 300000,     // 5 minutes
  GENERATE_RECOMMENDATIONS_LISTING: 60000, // 1 minute
  GENERATE_RECOMMENDATIONS_ASIN: 60000,    // 1 minute
  REFRESH_MATERIALIZED_VIEWS: 600000,      // 10 minutes
};

/**
 * Get timeout for a specific job type
 * @param {string} jobType - The job type
 * @returns {number} Timeout in milliseconds
 */
export function getJobTimeout(jobType) {
  return JOB_TIMEOUTS[jobType] || DEFAULT_JOB_TIMEOUT_MS;
}

export default {
  withTimeout,
  createAbortableTimeout,
  getJobTimeout,
  DEFAULT_JOB_TIMEOUT_MS,
  JOB_TIMEOUTS,
};
