#!/usr/bin/env node

/**
 * Smoke Test Script
 *
 * Verifies core API functionality after deployment.
 * Used in CI pipeline to catch critical regressions.
 *
 * Exit codes:
 * - 0: All tests passed
 * - 1: One or more tests failed
 *
 * Usage:
 *   API_BASE_URL=http://localhost:4000 node scripts/smoke-test.js
 *
 * @module SmokeTest
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';
const ENABLE_PUBLISH = process.env.ENABLE_PUBLISH === 'true';

// Test results tracking
const results = {
  passed: 0,
  failed: 0,
  tests: [],
};

/**
 * Make HTTP request with timeout
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

/**
 * Run a single test
 */
async function runTest(name, testFn) {
  const startTime = Date.now();
  try {
    await testFn();
    const duration = Date.now() - startTime;
    results.passed++;
    results.tests.push({ name, status: 'PASS', duration });
    console.log(`✅ PASS: ${name} (${duration}ms)`);
  } catch (error) {
    const duration = Date.now() - startTime;
    results.failed++;
    results.tests.push({ name, status: 'FAIL', duration, error: error.message });
    console.log(`❌ FAIL: ${name} (${duration}ms)`);
    console.log(`   Error: ${error.message}`);
  }
}

/**
 * Assert condition with custom message
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// ============================================================================
// SMOKE TESTS
// ============================================================================

/**
 * Test 1: Health endpoint returns success
 */
async function testHealthEndpoint() {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/v2/health`);
  assert(response.ok, `Expected 200, got ${response.status}`);

  const data = await response.json();
  assert(data.success === true, 'Response should have success: true');
  assert(data.data.status === 'healthy' || data.data.status === 'unhealthy', 'Should have status field');
  assert(data.data.checks, 'Should have checks object');
  assert(data.data.checks.database, 'Should have database check');
  assert(data.data.checks.publish, 'Should have publish check');
}

/**
 * Test 2: Listings endpoint returns valid shape
 */
async function testListingsEndpoint() {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/v2/listings?limit=1`);
  assert(response.ok, `Expected 200, got ${response.status}`);

  const data = await response.json();
  assert(data.success === true, 'Response should have success: true');
  assert(Array.isArray(data.data), 'Data should be an array');

  // If there are listings, verify shape
  if (data.data.length > 0) {
    const listing = data.data[0];
    assert(listing.id !== undefined, 'Listing should have id');
    assert(listing.seller_sku !== undefined, 'Listing should have seller_sku');
  }
}

/**
 * Test 3: Settings endpoint works
 */
async function testSettingsEndpoint() {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/v2/settings`);
  assert(response.ok, `Expected 200, got ${response.status}`);

  const data = await response.json();
  assert(data.success === true, 'Response should have success: true');
  assert(typeof data.data === 'object', 'Data should be an object');
}

/**
 * Test 4: Components endpoint works (BOM)
 */
async function testComponentsEndpoint() {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/v2/components`);
  assert(response.ok, `Expected 200, got ${response.status}`);

  const data = await response.json();
  assert(data.success === true, 'Response should have success: true');
  assert(Array.isArray(data.data), 'Data should be an array');
}

/**
 * Test 5: Publish endpoint returns 403 when ENABLE_PUBLISH=false
 */
async function testPublishDisabled() {
  if (ENABLE_PUBLISH) {
    console.log('   (Skipped: ENABLE_PUBLISH is true)');
    return;
  }

  // Try to publish a price change (should fail with 403)
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/v2/listings/1/price/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      price_inc_vat: 10.00,
      reason: 'smoke test',
    }),
  });

  // Should return 403 (forbidden) or 404 (listing not found)
  assert(
    response.status === 403 || response.status === 404,
    `Expected 403 or 404, got ${response.status}`
  );

  if (response.status === 403) {
    const data = await response.json();
    assert(data.error === 'PUBLISH_DISABLED', 'Should have PUBLISH_DISABLED error');
    assert(data.publish_config, 'Should include publish_config');
  }
}

/**
 * Test 6: Jobs endpoint works
 */
async function testJobsEndpoint() {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/v2/jobs?limit=5`);
  assert(response.ok, `Expected 200, got ${response.status}`);

  const data = await response.json();
  assert(data.success === true, 'Response should have success: true');
  assert(data.data.jobs !== undefined, 'Should have jobs array');
  assert(data.data.counts !== undefined, 'Should have counts object');
}

/**
 * Test 7: Metrics endpoint works
 */
async function testMetricsEndpoint() {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/v2/metrics`);
  assert(response.ok, `Expected 200, got ${response.status}`);

  // Metrics can be text (Prometheus format) or JSON
  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('text') || contentType.includes('json'),
    'Should return text or JSON'
  );
}

/**
 * Test 8: BOMs endpoint works
 */
async function testBomsEndpoint() {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/v2/boms`);
  // May return 200 or empty array depending on data
  assert(response.ok, `Expected 200, got ${response.status}`);

  const data = await response.json();
  assert(data.success === true, 'Response should have success: true');
  assert(Array.isArray(data.data), 'Data should be an array');
}

/**
 * Test 9: Recommendations endpoint works
 */
async function testRecommendationsEndpoint() {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/v2/recommendations?limit=5`);
  assert(response.ok, `Expected 200, got ${response.status}`);

  const data = await response.json();
  assert(data.success === true, 'Response should have success: true');
  assert(Array.isArray(data.data), 'Data should be an array');
}

/**
 * Test 10: Invalid endpoint returns 404
 */
async function testInvalidEndpoint() {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/v2/this-endpoint-does-not-exist`);
  assert(response.status === 404, `Expected 404, got ${response.status}`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    SMOKE TESTS                               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`API Base URL: ${API_BASE_URL}`);
  console.log(`ENABLE_PUBLISH: ${ENABLE_PUBLISH}`);
  console.log('');
  console.log('Running tests...');
  console.log('');

  // Run all tests
  await runTest('Health endpoint returns success', testHealthEndpoint);
  await runTest('Listings endpoint returns valid shape', testListingsEndpoint);
  await runTest('Settings endpoint works', testSettingsEndpoint);
  await runTest('Components endpoint works', testComponentsEndpoint);
  await runTest('Publish endpoint blocked when disabled', testPublishDisabled);
  await runTest('Jobs endpoint works', testJobsEndpoint);
  await runTest('Metrics endpoint works', testMetricsEndpoint);
  await runTest('BOMs endpoint works', testBomsEndpoint);
  await runTest('Recommendations endpoint works', testRecommendationsEndpoint);
  await runTest('Invalid endpoint returns 404', testInvalidEndpoint);

  // Summary
  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`Results: ${results.passed} passed, ${results.failed} failed`);
  console.log('════════════════════════════════════════════════════════════════');

  // Exit with appropriate code
  if (results.failed > 0) {
    console.log('');
    console.log('❌ SMOKE TESTS FAILED');
    console.log('');
    console.log('Failed tests:');
    results.tests
      .filter(t => t.status === 'FAIL')
      .forEach(t => console.log(`  - ${t.name}: ${t.error}`));
    process.exit(1);
  } else {
    console.log('');
    console.log('✅ ALL SMOKE TESTS PASSED');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('');
  console.error('❌ SMOKE TEST SCRIPT ERROR:', error.message);
  process.exit(1);
});
