#!/usr/bin/env node
/**
 * Keepa Rate Limiter Test Script
 *
 * Tests the Keepa rate limiter with real or simulated API calls.
 * Run this to verify the fix for 429 rate limiting errors.
 *
 * Usage:
 *   # Dry run - simulate rate limiting without API calls
 *   node scripts/test-keepa-rate-limiter.js --dry-run
 *
 *   # Test single ASIN
 *   node scripts/test-keepa-rate-limiter.js B001234567
 *
 *   # Test multiple ASINs (comma-separated)
 *   node scripts/test-keepa-rate-limiter.js B001234567,B009876543,B005555555
 *
 *   # Test burst of requests (stress test)
 *   node scripts/test-keepa-rate-limiter.js --burst 50
 *
 *   # Show rate limiter state
 *   node scripts/test-keepa-rate-limiter.js --status
 *
 * Environment variables:
 *   KEEPA_API_KEY - Required for actual API calls
 */

import 'dotenv/config';
import { KeepaRateLimiter, getKeepaRateLimiter } from '../src/lib/token-bucket.js';
import { hasKeepaCredentials, getKeepaApiKey } from '../src/credentials-provider.js';

// ASIN validation regex
const ASIN_REGEX = /^[A-Z0-9]{10}$/i;

/**
 * Format milliseconds as human-readable duration
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Show current rate limiter status
 */
async function showStatus() {
  const limiter = getKeepaRateLimiter();
  await limiter.loadState();

  console.log('\n=== Keepa Rate Limiter Status ===');
  const metrics = limiter.getMetrics();
  console.log(`Name: ${metrics.name}`);
  console.log(`Tokens: ${metrics.tokens.toFixed(2)} / ${metrics.capacity}`);
  console.log(`Refill Rate: ${(metrics.refillRate * 60).toFixed(1)} tokens/minute`);
  console.log(`Total Requests: ${metrics.totalRequests}`);
  console.log(`Throttled Requests: ${metrics.throttledRequests}`);
  console.log(`Avg Wait Time: ${formatDuration(metrics.avgWaitTime)}`);
  console.log(`Consecutive 429s: ${limiter.consecutive429Count}`);

  const waitFor10 = limiter.getWaitTime(10);
  console.log(`\nTime until 10 tokens available: ${formatDuration(waitFor10)}`);
}

/**
 * Dry run - simulate rate limiting behavior
 */
async function dryRun() {
  console.log('\n=== Dry Run: Simulating Rate Limiting ===\n');

  const limiter = new KeepaRateLimiter();
  limiter.persist = false; // Don't save to DB

  console.log('Starting with 0 tokens (conservative startup)');
  console.log(`Capacity: ${limiter.capacity}, Refill: ${(limiter.refillRate * 60).toFixed(1)} tokens/min\n`);

  // Simulate batch processing
  const batches = [10, 10, 10, 10, 10]; // 50 ASINs in 5 batches
  let totalWaitTime = 0;

  for (let i = 0; i < batches.length; i++) {
    const batchSize = batches[i];
    const tokensAvailable = limiter.getTokens();
    const waitTime = limiter.getWaitTime(batchSize);

    console.log(`Batch ${i + 1}/${batches.length} (${batchSize} ASINs):`);
    console.log(`  Tokens available: ${tokensAvailable.toFixed(2)}`);
    console.log(`  Wait time needed: ${formatDuration(waitTime)}`);

    if (waitTime > 0) {
      totalWaitTime += waitTime;
      console.log(`  Waiting...`);
      await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 3000))); // Cap at 3s for demo
    }

    // Acquire tokens
    limiter.tokens = Math.max(0, limiter.tokens - batchSize);
    limiter._refill();

    console.log(`  After acquire: ${limiter.getTokens().toFixed(2)} tokens\n`);
  }

  console.log(`Total estimated wait time: ${formatDuration(totalWaitTime)}`);
  console.log('(Actual waits were capped at 3s for demo)\n');

  // Simulate 429 handling
  console.log('=== Simulating 429 Error Handling ===\n');

  limiter.tokens = 0;
  limiter.consecutive429Count = 0;

  for (let i = 0; i < 4; i++) {
    const { waitMs, shouldRetry } = limiter.handleRateLimitError({
      tokensRemaining: 0,
      tokensNeeded: 10,
    });

    console.log(`429 #${i + 1}:`);
    console.log(`  Consecutive 429s: ${limiter.consecutive429Count}`);
    console.log(`  Backoff wait: ${formatDuration(waitMs)}`);
    console.log(`  Should retry: ${shouldRetry}\n`);
  }
}

/**
 * Test burst of requests
 */
async function testBurst(count) {
  console.log(`\n=== Testing Burst of ${count} ASINs ===\n`);

  const limiter = getKeepaRateLimiter();
  await limiter.loadState();

  const startTime = Date.now();
  const batchSize = 10;
  const batches = Math.ceil(count / batchSize);

  console.log(`Splitting into ${batches} batches of ${batchSize} ASINs each`);
  console.log(`Initial tokens: ${limiter.getTokens().toFixed(2)}\n`);

  let totalWaitTime = 0;
  let throttledBatches = 0;

  for (let i = 0; i < batches; i++) {
    const batchStart = Date.now();
    const waitTime = limiter.getWaitTime(batchSize);

    if (waitTime > 0) {
      throttledBatches++;
      console.log(`Batch ${i + 1}: Waiting ${formatDuration(waitTime)} for tokens...`);
      totalWaitTime += waitTime;
    }

    // Wait for tokens
    await limiter.waitForTokens(batchSize);

    // Acquire tokens (simulate request)
    const acquired = await limiter.acquireForAsins(batchSize, 120000);

    const batchElapsed = Date.now() - batchStart;
    console.log(`Batch ${i + 1}: ${acquired ? 'OK' : 'FAILED'} (${formatDuration(batchElapsed)}), tokens left: ${limiter.getTokens().toFixed(2)}`);

    if (!acquired) {
      console.log('  Failed to acquire tokens - stopping');
      break;
    }

    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const totalElapsed = Date.now() - startTime;
  console.log(`\n=== Burst Test Complete ===`);
  console.log(`Total time: ${formatDuration(totalElapsed)}`);
  console.log(`Throttled batches: ${throttledBatches}/${batches}`);
  console.log(`Total wait time: ${formatDuration(totalWaitTime)}`);
}

/**
 * Make actual Keepa API call
 */
async function testRealApi(asinInput) {
  if (!hasKeepaCredentials()) {
    console.error('\nKeepa API key not configured. Set KEEPA_API_KEY environment variable.');
    process.exit(1);
  }

  const asins = asinInput.split(',').map(a => a.trim().toUpperCase()).filter(a => ASIN_REGEX.test(a));

  if (asins.length === 0) {
    console.error('\nNo valid ASINs provided.');
    process.exit(1);
  }

  console.log(`\n=== Testing Keepa API with ${asins.length} ASIN(s) ===\n`);

  const limiter = getKeepaRateLimiter();
  await limiter.loadState();

  console.log(`Initial tokens: ${limiter.getTokens().toFixed(2)}`);

  // Wait for tokens
  const waitTime = limiter.getWaitTime(asins.length);
  if (waitTime > 0) {
    console.log(`Waiting ${formatDuration(waitTime)} for tokens...`);
    await limiter.waitForTokens(asins.length);
  }

  // Acquire tokens
  const acquired = await limiter.acquireForAsins(asins.length);
  if (!acquired) {
    console.error('Failed to acquire rate limit tokens');
    process.exit(1);
  }

  console.log(`Tokens acquired. Making API call...`);

  // Make the actual API call
  const apiKey = getKeepaApiKey();
  const params = new URLSearchParams({
    key: apiKey,
    domain: '2', // UK
    asin: asins.join(','),
    stats: '90',
  });

  const startTime = Date.now();

  try {
    const response = await fetch(`https://api.keepa.com/product?${params.toString()}`);
    const elapsed = Date.now() - startTime;

    // Read headers
    const remaining = response.headers.get('X-Rl-RemainingTokens');
    const retryAfter = response.headers.get('Retry-After');

    console.log(`\n=== Response (${elapsed}ms) ===`);
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Tokens remaining (header): ${remaining}`);
    console.log(`Retry-After (header): ${retryAfter || 'N/A'}`);

    if (remaining !== null) {
      limiter.updateFromHeaders(parseInt(remaining, 10));
      console.log(`Rate limiter synced to: ${limiter.getTokens().toFixed(2)} tokens`);
    }

    if (response.status === 429) {
      console.log('\n*** 429 RATE LIMITED ***');
      const { waitMs, shouldRetry } = limiter.handleRateLimitError({
        tokensRemaining: remaining ? parseInt(remaining, 10) : 0,
        retryAfterSeconds: retryAfter ? parseInt(retryAfter, 10) : null,
        tokensNeeded: asins.length,
      });
      console.log(`Backoff wait: ${formatDuration(waitMs)}`);
      console.log(`Should retry: ${shouldRetry}`);
    } else if (response.ok) {
      const data = await response.json();
      console.log(`\nProducts returned: ${data.products?.length || 0}`);

      if (data.products && data.products.length > 0) {
        const first = data.products[0];
        console.log(`\nFirst product:`);
        console.log(`  ASIN: ${first.asin}`);
        console.log(`  Title: ${first.title?.substring(0, 60)}...`);
      }

      limiter.resetErrorCount();
      console.log('\n OK - Request successful');
    } else {
      console.log(`\n ERROR - HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(`\n NETWORK ERROR: ${error.message}`);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--status')) {
    await showStatus();
    return;
  }

  if (args.includes('--dry-run')) {
    await dryRun();
    return;
  }

  const burstIndex = args.indexOf('--burst');
  if (burstIndex !== -1) {
    const count = parseInt(args[burstIndex + 1] || '50', 10);
    await testBurst(count);
    return;
  }

  const asinInput = args.filter(a => !a.startsWith('--'))[0];
  if (asinInput) {
    await testRealApi(asinInput);
    return;
  }

  // Default: show status
  console.log('Usage:');
  console.log('  node scripts/test-keepa-rate-limiter.js --status        # Show rate limiter status');
  console.log('  node scripts/test-keepa-rate-limiter.js --dry-run       # Simulate rate limiting');
  console.log('  node scripts/test-keepa-rate-limiter.js --burst 50      # Test burst of 50 ASINs');
  console.log('  node scripts/test-keepa-rate-limiter.js B001234567      # Test with real API');
  console.log('');
  await showStatus();
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
