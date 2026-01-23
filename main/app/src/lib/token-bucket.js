/**
 * Token Bucket Rate Limiter
 *
 * Implements the token bucket algorithm for rate limiting API calls.
 * Designed for Keepa's 20 tokens/minute limit but generic enough for any API.
 *
 * Features:
 * - Token bucket with configurable capacity and refill rate
 * - Persistent state (saves/loads from database)
 * - Staggered request scheduling to avoid bursts
 * - Support for waiting until tokens are available
 *
 * @module TokenBucket
 */

import { query } from '../database/connection.js';

/**
 * Token Bucket Rate Limiter
 */
export class TokenBucket {
  /**
   * Create a new token bucket
   *
   * @param {Object} config
   * @param {string} config.name - Unique name for this bucket (for persistence)
   * @param {number} config.capacity - Maximum tokens the bucket can hold
   * @param {number} config.refillRate - Tokens added per second
   * @param {number} [config.initialTokens] - Starting tokens (default: capacity)
   * @param {boolean} [config.persist=true] - Whether to persist state to database
   */
  constructor(config) {
    this.name = config.name;
    this.capacity = config.capacity;
    this.refillRate = config.refillRate;
    this.tokens = config.initialTokens ?? config.capacity;
    this.lastRefillTime = Date.now();
    this.persist = config.persist !== false;
    this.stateLoaded = false;

    // For metrics
    this.totalRequests = 0;
    this.totalWaitTime = 0;
    this.throttledRequests = 0;
  }

  /**
   * Refill tokens based on elapsed time
   * @private
   */
  _refill() {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillTime;
    const elapsedSeconds = elapsedMs / 1000;

    // Calculate tokens to add
    const tokensToAdd = elapsedSeconds * this.refillRate;

    // Update tokens (capped at capacity)
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefillTime = now;
  }

  /**
   * Try to acquire a token without waiting
   *
   * @param {number} [count=1] - Number of tokens to acquire
   * @returns {boolean} True if tokens were acquired
   */
  tryAcquire(count = 1) {
    this._refill();

    if (this.tokens >= count) {
      this.tokens -= count;
      this.totalRequests++;
      return true;
    }

    return false;
  }

  /**
   * Acquire tokens, waiting if necessary
   *
   * @param {number} [count=1] - Number of tokens to acquire
   * @param {number} [maxWaitMs=60000] - Maximum time to wait (default: 60s)
   * @returns {Promise<boolean>} True if tokens were acquired
   */
  async acquire(count = 1, maxWaitMs = 60000) {
    this._refill();

    // If we have enough tokens, acquire immediately
    if (this.tokens >= count) {
      this.tokens -= count;
      this.totalRequests++;
      return true;
    }

    // Calculate wait time
    const tokensNeeded = count - this.tokens;
    const waitTimeMs = (tokensNeeded / this.refillRate) * 1000;

    // Check if wait time exceeds maximum
    if (waitTimeMs > maxWaitMs) {
      return false;
    }

    // Wait for tokens to become available
    this.throttledRequests++;
    const waitStartTime = Date.now();

    await this._sleep(Math.ceil(waitTimeMs));

    // Refill and acquire
    this._refill();
    this.tokens -= count;
    this.totalRequests++;
    this.totalWaitTime += Date.now() - waitStartTime;

    return true;
  }

  /**
   * Get time until a token will be available
   *
   * @param {number} [count=1] - Number of tokens needed
   * @returns {number} Milliseconds until token available (0 if available now)
   */
  getWaitTime(count = 1) {
    this._refill();

    if (this.tokens >= count) {
      return 0;
    }

    const tokensNeeded = count - this.tokens;
    return Math.ceil((tokensNeeded / this.refillRate) * 1000);
  }

  /**
   * Get current token count
   * @returns {number}
   */
  getTokens() {
    this._refill();
    return this.tokens;
  }

  /**
   * Get metrics
   * @returns {Object}
   */
  getMetrics() {
    return {
      name: this.name,
      tokens: this.getTokens(),
      capacity: this.capacity,
      refillRate: this.refillRate,
      totalRequests: this.totalRequests,
      throttledRequests: this.throttledRequests,
      totalWaitTime: this.totalWaitTime,
      avgWaitTime: this.throttledRequests > 0 ? this.totalWaitTime / this.throttledRequests : 0,
    };
  }

  /**
   * Load state from database
   * @returns {Promise<boolean>}
   */
  async loadState() {
    if (!this.persist || this.stateLoaded) {
      return true;
    }

    try {
      const result = await query(`
        SELECT tokens, last_refill_time
        FROM rate_limit_buckets
        WHERE name = $1
      `, [this.name]);

      if (result.rows.length > 0) {
        const row = result.rows[0];
        this.tokens = parseFloat(row.tokens);
        this.lastRefillTime = new Date(row.last_refill_time).getTime();
        this._refill(); // Apply any tokens that accumulated while offline
      }

      this.stateLoaded = true;
      return true;
    } catch (error) {
      // Table might not exist - create it
      if (error.message?.includes('does not exist')) {
        try {
          await this._ensureTable();
          this.stateLoaded = true;
          return true;
        } catch {
          // Non-critical - continue without persistence
        }
      }
      console.warn(`[TokenBucket] Failed to load state for ${this.name}:`, error.message);
      this.stateLoaded = true;
      return false;
    }
  }

  /**
   * Save state to database
   * @returns {Promise<boolean>}
   */
  async saveState() {
    if (!this.persist) {
      return true;
    }

    try {
      await query(`
        INSERT INTO rate_limit_buckets (name, tokens, last_refill_time, updated_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        ON CONFLICT (name) DO UPDATE SET
          tokens = EXCLUDED.tokens,
          last_refill_time = EXCLUDED.last_refill_time,
          updated_at = CURRENT_TIMESTAMP
      `, [this.name, this.tokens, new Date(this.lastRefillTime)]);

      return true;
    } catch (error) {
      if (error.message?.includes('does not exist')) {
        try {
          await this._ensureTable();
          return this.saveState(); // Retry
        } catch {
          // Non-critical
        }
      }
      console.warn(`[TokenBucket] Failed to save state for ${this.name}:`, error.message);
      return false;
    }
  }

  /**
   * Ensure the rate_limit_buckets table exists
   * @private
   */
  async _ensureTable() {
    await query(`
      CREATE TABLE IF NOT EXISTS rate_limit_buckets (
        name VARCHAR(100) PRIMARY KEY,
        tokens NUMERIC(10, 4) NOT NULL,
        last_refill_time TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  /**
   * Sleep for a given duration
   * @private
   * @param {number} ms
   * @returns {Promise<void>}
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Keepa-specific rate limiter
 * Pre-configured for Keepa's 20 tokens/minute limit
 */
export class KeepaRateLimiter extends TokenBucket {
  constructor() {
    super({
      name: 'keepa_api',
      capacity: 20,                    // Max 20 tokens
      refillRate: 20 / 60,             // 20 tokens per 60 seconds = 0.333 tokens/second
      initialTokens: 0,                // Start EMPTY - conservative to avoid 429 on startup
      persist: true,
    });

    // Track consecutive 429 errors for exponential backoff
    this.consecutive429Count = 0;
    this.lastRequestTime = 0;
  }

  /**
   * Acquire tokens for a Keepa API request
   * Accounts for the number of ASINs in the batch (1 token per ASIN)
   *
   * @param {number} asinCount - Number of ASINs in the request
   * @param {number} [maxWaitMs=120000] - Max wait time (default: 2 minutes)
   * @returns {Promise<boolean>}
   */
  async acquireForAsins(asinCount, maxWaitMs = 120000) {
    // Keepa charges 1 token per ASIN
    const tokensNeeded = asinCount;

    // Load state on first use
    if (!this.stateLoaded) {
      await this.loadState();
    }

    const acquired = await this.acquire(tokensNeeded, maxWaitMs);

    // Save state after each request
    if (acquired) {
      // Fire and forget - don't block on save
      this.saveState().catch(() => {});
    }

    return acquired;
  }

  /**
   * Update tokens from Keepa response headers
   *
   * @param {number} tokensRemaining - Tokens remaining from X-Rl-RemainingTokens header
   * @param {number} [resetTimeSeconds] - Seconds until reset from header
   */
  updateFromHeaders(tokensRemaining, resetTimeSeconds = null) {
    // Trust the API's reported remaining tokens
    if (tokensRemaining !== null && tokensRemaining !== undefined) {
      this.tokens = Math.min(tokensRemaining, this.capacity);
      this.lastRefillTime = Date.now();

      // Reset consecutive 429 count on successful header update
      this.consecutive429Count = 0;
    }

    // Save updated state
    this.saveState().catch(() => {});
  }

  /**
   * Handle a 429 rate limit error from Keepa
   * Sets tokens to 0 and calculates required wait time
   *
   * IMPORTANT: After a 429, our local token bucket state is WRONG - we thought
   * we had tokens but Keepa says we don't. The safest approach is to wait for
   * a FULL refill period (60 seconds) to guarantee tokens are available, rather
   * than trusting our (incorrect) local state calculations.
   *
   * @param {Object} options - Options from the error response
   * @param {number} [options.tokensRemaining] - X-Rl-RemainingTokens header value
   * @param {number} [options.retryAfterSeconds] - Retry-After header value in seconds
   * @param {number} [options.tokensNeeded=1] - Tokens needed for the failed request
   * @returns {{ waitMs: number, shouldRetry: boolean }} Wait time and retry recommendation
   */
  handleRateLimitError(options = {}) {
    const {
      tokensRemaining = 0,
      retryAfterSeconds = null,
      tokensNeeded = 1,
    } = options;

    // Track consecutive 429s for exponential backoff
    this.consecutive429Count++;

    // CRITICAL: Force tokens to 0 - our local state is demonstrably wrong
    // Don't trust tokensRemaining from header either, assume worst case
    this.tokens = 0;
    this.lastRefillTime = Date.now();

    // Calculate wait time
    let waitMs;

    if (retryAfterSeconds !== null && retryAfterSeconds > 0) {
      // Trust Retry-After header if Keepa provides it
      waitMs = retryAfterSeconds * 1000;
    } else {
      // FULL REFILL STRATEGY: Wait for complete bucket refill (60+ seconds)
      // This is more conservative but avoids cascading 429s.
      // Our local state calculation was WRONG (we got a 429), so waiting
      // for a full refill period guarantees tokens will be available.
      const fullRefillMs = 65 * 1000; // 65 seconds (slightly more than 60s for safety margin)

      // For consecutive 429s, add more time: 1st: 65s, 2nd: 95s, 3rd: 125s
      const additionalWaitMs = Math.min((this.consecutive429Count - 1) * 30000, 60000);
      waitMs = fullRefillMs + additionalWaitMs;
    }

    // Add small jitter (3%) to avoid thundering herd
    const jitter = waitMs * 0.03 * Math.random();
    waitMs = Math.ceil(waitMs + jitter);

    // Only retry up to 3 times - if we're still getting 429s after 3 attempts
    // with full refill waits, something else is wrong
    const shouldRetry = this.consecutive429Count <= 3;

    // Save updated state
    this.saveState().catch(() => {});

    console.log(`[KeepaRateLimiter] 429 received. Consecutive: ${this.consecutive429Count}, Wait: ${Math.round(waitMs / 1000)}s, Retry: ${shouldRetry}`);

    return { waitMs, shouldRetry };
  }

  /**
   * Wait until tokens are available (blocking)
   * Use this after a 429 to ensure we don't immediately retry
   *
   * @param {number} tokensNeeded - Tokens needed for next request
   * @returns {Promise<void>}
   */
  async waitForTokens(tokensNeeded = 1) {
    this._refill();

    if (this.tokens >= tokensNeeded) {
      return; // Already have enough
    }

    const tokensToWait = tokensNeeded - this.tokens;
    const waitMs = Math.ceil((tokensToWait / this.refillRate) * 1000);

    console.log(`[KeepaRateLimiter] Waiting ${waitMs}ms for ${tokensToWait} tokens`);
    await this._sleep(waitMs);
    this._refill();
  }

  /**
   * Reset 429 counter (call after successful request)
   */
  resetErrorCount() {
    this.consecutive429Count = 0;
  }

  /**
   * Calculate optimal batch size based on available tokens
   *
   * @param {number} totalAsins - Total ASINs to process
   * @param {number} maxBatchSize - Maximum batch size (Keepa's limit is 10)
   * @returns {number} Optimal batch size
   */
  getOptimalBatchSize(totalAsins, maxBatchSize = 10) {
    const availableTokens = Math.floor(this.getTokens());

    if (availableTokens >= maxBatchSize) {
      return Math.min(maxBatchSize, totalAsins);
    }

    if (availableTokens > 0) {
      return Math.min(availableTokens, totalAsins, maxBatchSize);
    }

    // No tokens available - return max batch size to wait just once
    return Math.min(maxBatchSize, totalAsins);
  }
}

// Singleton instance for Keepa
let keepaRateLimiterInstance = null;

/**
 * Get the singleton Keepa rate limiter instance
 * @returns {KeepaRateLimiter}
 */
export function getKeepaRateLimiter() {
  if (!keepaRateLimiterInstance) {
    keepaRateLimiterInstance = new KeepaRateLimiter();
  }
  return keepaRateLimiterInstance;
}

/**
 * SP-API rate limiter
 * Configured for Amazon SP-API's typical burst/refill limits.
 *
 * SP-API has per-endpoint rate limits, but for simplicity we use a conservative
 * overall limit. The Catalog/Pricing APIs typically allow ~10 requests/second
 * with burst capacity.
 *
 * Configure conservatively: 5 requests/second with burst of 20.
 */
export class SpApiRateLimiter extends TokenBucket {
  constructor(options = {}) {
    super({
      name: options.name || 'sp_api',
      capacity: options.capacity || 20,        // Burst capacity
      refillRate: options.refillRate || 5,     // 5 tokens per second (conservative)
      initialTokens: options.initialTokens ?? 10, // Start with some tokens
      persist: false,                          // SP-API limits reset fast; no need to persist
    });

    // Track 429 errors
    this.throttleCount = 0;
    this.lastThrottleTime = 0;
    this.totalWaitTimeMs = 0;
    this.totalRequests = 0;
  }

  /**
   * Acquire a token for an SP-API request
   * Logs when waiting for tokens (observability)
   *
   * @param {string} [operation] - Operation name for logging
   * @param {number} [maxWaitMs=30000] - Max wait time (default: 30s)
   * @returns {Promise<boolean>}
   */
  async acquireForRequest(operation = 'unknown', maxWaitMs = 30000) {
    this.totalRequests++;

    const waitTime = this.getWaitTime(1);

    if (waitTime > 0) {
      console.log(`[SpApiRateLimiter] Waiting ${waitTime}ms for token before ${operation}`);
      this.totalWaitTimeMs += waitTime;
    }

    const acquired = await this.acquire(1, maxWaitMs);

    if (!acquired) {
      console.warn(`[SpApiRateLimiter] Failed to acquire token for ${operation} after ${maxWaitMs}ms`);
    }

    return acquired;
  }

  /**
   * Handle a 429 throttle response from SP-API
   *
   * @param {number} [retryAfterMs] - Retry-After value in milliseconds
   * @returns {{ waitMs: number, shouldRetry: boolean }}
   */
  handleThrottle(retryAfterMs = null) {
    this.throttleCount++;
    this.lastThrottleTime = Date.now();

    // Drain tokens to 0
    this.tokens = 0;
    this.lastRefillTime = Date.now();

    // Calculate wait time
    let waitMs;
    if (retryAfterMs && retryAfterMs > 0) {
      waitMs = retryAfterMs;
    } else {
      // Default: wait for half capacity to refill
      const tokensToWait = this.capacity / 2;
      waitMs = Math.ceil((tokensToWait / this.refillRate) * 1000);
    }

    // Add jitter
    const jitter = waitMs * 0.1 * Math.random();
    waitMs = Math.ceil(waitMs + jitter);

    console.log(`[SpApiRateLimiter] 429 received. Throttle count: ${this.throttleCount}, Wait: ${waitMs}ms`);

    // Allow up to 5 retries
    const shouldRetry = this.throttleCount <= 5;

    return { waitMs, shouldRetry };
  }

  /**
   * Reset throttle count (call after successful request)
   */
  resetThrottleCount() {
    this.throttleCount = 0;
  }

  /**
   * Get rate limiter metrics for observability
   * @returns {Object}
   */
  getMetrics() {
    return {
      ...super.getMetrics(),
      throttleCount: this.throttleCount,
      lastThrottleTime: this.lastThrottleTime,
      totalWaitTimeMs: this.totalWaitTimeMs,
    };
  }
}

// Singleton instance for SP-API
let spApiRateLimiterInstance = null;

/**
 * Get the singleton SP-API rate limiter instance
 * @returns {SpApiRateLimiter}
 */
export function getSpApiRateLimiter() {
  if (!spApiRateLimiterInstance) {
    spApiRateLimiterInstance = new SpApiRateLimiter();
  }
  return spApiRateLimiterInstance;
}

export default {
  TokenBucket,
  KeepaRateLimiter,
  getKeepaRateLimiter,
  SpApiRateLimiter,
  getSpApiRateLimiter,
};
