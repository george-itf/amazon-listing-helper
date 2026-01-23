/**
 * Keepa Rate Limiter Unit Tests
 *
 * Tests for KeepaRateLimiter class:
 * - Token bucket algorithm (capacity, refill rate)
 * - 429 error handling with exponential backoff
 * - Header synchronization
 * - Token wait logic
 */

import { TokenBucket, KeepaRateLimiter } from '../lib/token-bucket.js';

// Mock the database query function
jest.mock('../database/connection.js', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
}));

describe('TokenBucket', () => {
  describe('basic operations', () => {
    it('starts with initial tokens', () => {
      const bucket = new TokenBucket({
        name: 'test_bucket',
        capacity: 10,
        refillRate: 1, // 1 token per second
        initialTokens: 5,
        persist: false,
      });

      expect(bucket.getTokens()).toBe(5);
    });

    it('starts with capacity if initialTokens not specified', () => {
      const bucket = new TokenBucket({
        name: 'test_bucket',
        capacity: 10,
        refillRate: 1,
        persist: false,
      });

      expect(bucket.getTokens()).toBe(10);
    });

    it('tryAcquire succeeds when tokens available', () => {
      const bucket = new TokenBucket({
        name: 'test_bucket',
        capacity: 10,
        refillRate: 1,
        initialTokens: 5,
        persist: false,
      });

      const result = bucket.tryAcquire(3);

      expect(result).toBe(true);
      expect(bucket.getTokens()).toBeCloseTo(2, 1);
    });

    it('tryAcquire fails when not enough tokens', () => {
      const bucket = new TokenBucket({
        name: 'test_bucket',
        capacity: 10,
        refillRate: 1,
        initialTokens: 2,
        persist: false,
      });

      const result = bucket.tryAcquire(5);

      expect(result).toBe(false);
      expect(bucket.getTokens()).toBeCloseTo(2, 1); // Tokens unchanged
    });

    it('refills tokens over time', async () => {
      const bucket = new TokenBucket({
        name: 'test_bucket',
        capacity: 10,
        refillRate: 10, // 10 tokens per second
        initialTokens: 0,
        persist: false,
      });

      // Wait 500ms - should add ~5 tokens
      await new Promise(resolve => setTimeout(resolve, 500));

      const tokens = bucket.getTokens();
      expect(tokens).toBeGreaterThan(4);
      expect(tokens).toBeLessThan(7);
    });

    it('does not exceed capacity on refill', async () => {
      const bucket = new TokenBucket({
        name: 'test_bucket',
        capacity: 10,
        refillRate: 100, // Very fast refill
        initialTokens: 8,
        persist: false,
      });

      // Wait for refill
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(bucket.getTokens()).toBe(10); // Capped at capacity
    });
  });

  describe('acquire with waiting', () => {
    it('waits for tokens when not immediately available', async () => {
      const bucket = new TokenBucket({
        name: 'test_bucket',
        capacity: 10,
        refillRate: 10, // 10 tokens per second = 100ms per token
        initialTokens: 0,
        persist: false,
      });

      const startTime = Date.now();
      const result = await bucket.acquire(2, 5000);
      const elapsed = Date.now() - startTime;

      expect(result).toBe(true);
      expect(elapsed).toBeGreaterThan(100); // Waited for tokens
      expect(elapsed).toBeLessThan(500); // But not too long
    });

    it('returns false if wait exceeds maxWaitMs', async () => {
      const bucket = new TokenBucket({
        name: 'test_bucket',
        capacity: 10,
        refillRate: 0.1, // Very slow: 0.1 tokens per second
        initialTokens: 0,
        persist: false,
      });

      const result = await bucket.acquire(5, 100); // Only wait 100ms

      expect(result).toBe(false);
    });
  });

  describe('getWaitTime', () => {
    it('returns 0 when tokens available', () => {
      const bucket = new TokenBucket({
        name: 'test_bucket',
        capacity: 10,
        refillRate: 1,
        initialTokens: 5,
        persist: false,
      });

      expect(bucket.getWaitTime(3)).toBe(0);
    });

    it('returns correct wait time when tokens not available', () => {
      const bucket = new TokenBucket({
        name: 'test_bucket',
        capacity: 10,
        refillRate: 2, // 2 tokens per second = 500ms per token
        initialTokens: 0,
        persist: false,
      });

      const waitTime = bucket.getWaitTime(2);

      // Need 2 tokens at 0.5s per token = 1000ms
      expect(waitTime).toBeGreaterThan(900);
      expect(waitTime).toBeLessThan(1100);
    });
  });

  describe('metrics', () => {
    it('tracks request counts', () => {
      const bucket = new TokenBucket({
        name: 'test_bucket',
        capacity: 10,
        refillRate: 1,
        initialTokens: 10,
        persist: false,
      });

      bucket.tryAcquire(1);
      bucket.tryAcquire(1);
      bucket.tryAcquire(1);

      const metrics = bucket.getMetrics();

      expect(metrics.totalRequests).toBe(3);
      expect(metrics.name).toBe('test_bucket');
      expect(metrics.capacity).toBe(10);
    });
  });
});

describe('KeepaRateLimiter', () => {
  describe('configuration', () => {
    it('has correct Keepa settings', () => {
      const limiter = new KeepaRateLimiter();

      expect(limiter.capacity).toBe(20);
      expect(limiter.refillRate).toBeCloseTo(20 / 60, 4); // 0.333 tokens/sec
      expect(limiter.tokens).toBe(0); // Starts empty (conservative)
    });
  });

  describe('acquireForAsins', () => {
    it('acquires tokens for batch of ASINs', async () => {
      const limiter = new KeepaRateLimiter();
      limiter.tokens = 15; // Set some tokens
      limiter.stateLoaded = true;

      const result = await limiter.acquireForAsins(10);

      expect(result).toBe(true);
      expect(limiter.getTokens()).toBeCloseTo(5, 1);
    });

    it('waits for tokens when not available', async () => {
      const limiter = new KeepaRateLimiter();
      limiter.tokens = 0;
      limiter.stateLoaded = true;

      const startTime = Date.now();
      const result = await limiter.acquireForAsins(1, 5000);
      const elapsed = Date.now() - startTime;

      expect(result).toBe(true);
      expect(elapsed).toBeGreaterThan(2000); // Had to wait ~3 seconds for 1 token
    }, 10000);
  });

  describe('updateFromHeaders', () => {
    it('syncs tokens from API response', () => {
      const limiter = new KeepaRateLimiter();
      limiter.tokens = 5;
      limiter.consecutive429Count = 3;
      limiter.stateLoaded = true;

      limiter.updateFromHeaders(15);

      expect(limiter.tokens).toBe(15);
      expect(limiter.consecutive429Count).toBe(0); // Reset on success
    });

    it('caps tokens at capacity', () => {
      const limiter = new KeepaRateLimiter();
      limiter.stateLoaded = true;

      limiter.updateFromHeaders(100); // More than capacity

      expect(limiter.tokens).toBe(20); // Capped at capacity
    });
  });

  describe('handleRateLimitError', () => {
    it('sets tokens to 0 and calculates wait time', () => {
      const limiter = new KeepaRateLimiter();
      limiter.tokens = 5;
      limiter.stateLoaded = true;

      const { waitMs, shouldRetry } = limiter.handleRateLimitError({
        tokensRemaining: 0,
        tokensNeeded: 10,
      });

      expect(limiter.tokens).toBe(0);
      expect(waitMs).toBeGreaterThan(25000); // ~30s for 10 tokens at 0.333/s
      expect(shouldRetry).toBe(true);
    });

    it('uses Retry-After header when provided', () => {
      const limiter = new KeepaRateLimiter();
      limiter.stateLoaded = true;

      const { waitMs } = limiter.handleRateLimitError({
        tokensRemaining: 0,
        retryAfterSeconds: 60,
        tokensNeeded: 10,
      });

      // Should use Retry-After header (60s) with some jitter
      expect(waitMs).toBeGreaterThan(60000);
      expect(waitMs).toBeLessThan(70000);
    });

    it('applies exponential backoff on consecutive 429s', () => {
      const limiter = new KeepaRateLimiter();
      limiter.stateLoaded = true;

      // First 429
      const first = limiter.handleRateLimitError({ tokensNeeded: 10 });
      expect(limiter.consecutive429Count).toBe(1);

      // Second 429
      const second = limiter.handleRateLimitError({ tokensNeeded: 10 });
      expect(limiter.consecutive429Count).toBe(2);
      expect(second.waitMs).toBeGreaterThan(first.waitMs * 1.5); // Exponential

      // Third 429
      const third = limiter.handleRateLimitError({ tokensNeeded: 10 });
      expect(limiter.consecutive429Count).toBe(3);
      expect(third.waitMs).toBeGreaterThan(second.waitMs * 1.5);
    });

    it('stops recommending retry after too many consecutive 429s', () => {
      const limiter = new KeepaRateLimiter();
      limiter.stateLoaded = true;
      limiter.consecutive429Count = 5;

      const { shouldRetry } = limiter.handleRateLimitError({ tokensNeeded: 10 });

      expect(shouldRetry).toBe(false);
    });

    it('caps wait time at 5 minutes', () => {
      const limiter = new KeepaRateLimiter();
      limiter.stateLoaded = true;
      limiter.consecutive429Count = 10; // Many consecutive errors

      const { waitMs } = limiter.handleRateLimitError({ tokensNeeded: 10 });

      expect(waitMs).toBeLessThanOrEqual(5 * 60 * 1000);
    });
  });

  describe('waitForTokens', () => {
    it('returns immediately if tokens available', async () => {
      const limiter = new KeepaRateLimiter();
      limiter.tokens = 10;
      limiter.stateLoaded = true;

      const startTime = Date.now();
      await limiter.waitForTokens(5);
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(50);
    });

    it('waits until tokens refill', async () => {
      const limiter = new KeepaRateLimiter();
      limiter.tokens = 0;
      limiter.stateLoaded = true;

      const startTime = Date.now();
      await limiter.waitForTokens(1);
      const elapsed = Date.now() - startTime;

      // 1 token at 0.333 tokens/sec = ~3 seconds
      expect(elapsed).toBeGreaterThan(2500);
      expect(elapsed).toBeLessThan(4000);
    }, 10000);
  });

  describe('resetErrorCount', () => {
    it('resets consecutive 429 counter', () => {
      const limiter = new KeepaRateLimiter();
      limiter.consecutive429Count = 5;

      limiter.resetErrorCount();

      expect(limiter.consecutive429Count).toBe(0);
    });
  });

  describe('getOptimalBatchSize', () => {
    it('returns maxBatchSize when plenty of tokens', () => {
      const limiter = new KeepaRateLimiter();
      limiter.tokens = 20;
      limiter.stateLoaded = true;

      const batchSize = limiter.getOptimalBatchSize(50, 10);

      expect(batchSize).toBe(10);
    });

    it('returns available tokens when less than maxBatchSize', () => {
      const limiter = new KeepaRateLimiter();
      limiter.tokens = 5;
      limiter.stateLoaded = true;

      const batchSize = limiter.getOptimalBatchSize(50, 10);

      expect(batchSize).toBe(5);
    });

    it('returns maxBatchSize when no tokens (to wait once)', () => {
      const limiter = new KeepaRateLimiter();
      limiter.tokens = 0;
      limiter.stateLoaded = true;

      const batchSize = limiter.getOptimalBatchSize(50, 10);

      expect(batchSize).toBe(10);
    });

    it('respects totalAsins when smaller than maxBatchSize', () => {
      const limiter = new KeepaRateLimiter();
      limiter.tokens = 20;
      limiter.stateLoaded = true;

      const batchSize = limiter.getOptimalBatchSize(5, 10);

      expect(batchSize).toBe(5);
    });
  });
});
