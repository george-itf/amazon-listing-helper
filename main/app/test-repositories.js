#!/usr/bin/env node

/**
 * Test script for repositories
 * Verifies that all repositories can connect and query the database
 *
 * Usage: node app/test-repositories.js
 */

import {
  listingRepository,
  scoreRepository,
  taskRepository,
  alertRepository,
  keepaRepository,
  settingsRepository,
} from './src/repositories/index.js';

import { testConnection, close } from './src/database/connection.js';

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║          Repository Layer Test Suite                          ║');
console.log('╚════════════════════════════════════════════════════════════════╝');
console.log('');

const results = {
  passed: 0,
  failed: 0,
};

async function runTest(name, testFn) {
  try {
    await testFn();
    console.log(`  ✅ ${name}: PASSED`);
    results.passed++;
  } catch (error) {
    console.log(`  ❌ ${name}: FAILED`);
    console.log(`  Error: ${error.message}`);
    results.failed++;
  }
}

async function main() {
  // Test database connection first
  console.log('🔌 Testing Database Connection...');
  const connected = await testConnection();

  if (!connected) {
    console.log('');
    console.log('❌ Cannot connect to database. Please ensure:');
    console.log('   1. Docker containers are running: docker-compose up -d');
    console.log('   2. Database is accessible on localhost:5432');
    console.log('   3. Credentials in .env are correct');
    process.exit(1);
  }

  console.log('');

  // Test Listing Repository
  console.log('📦 Testing Listing Repository...');
  await runTest('Listing Repository', async () => {
    const listings = await listingRepository.getAll({ limit: 5 });
    console.log(`     Found ${listings.length} listings`);

    const stats = await listingRepository.getCountByStatus();
    console.log(`     Status counts:`, stats);
  });

  // Test Score Repository
  console.log('');
  console.log('📊 Testing Score Repository...');
  await runTest('Score Repository', async () => {
    const scores = await scoreRepository.getAllLatest({ status: 'active' });
    console.log(`     Found ${scores.length} latest scores`);

    const stats = await scoreRepository.getStatistics();
    console.log(`     Average score: ${stats.avg_score || 'N/A'}`);

    const distribution = await scoreRepository.getDistribution();
    console.log(`     Distribution:`, distribution.map(d => `${d.bucket}: ${d.count}`).join(', '));
  });

  // Test Task Repository
  console.log('');
  console.log('📋 Testing Task Repository...');
  await runTest('Task Repository', async () => {
    const tasks = await taskRepository.getAll({ limit: 5 });
    console.log(`     Found ${tasks.length} tasks`);

    const counts = await taskRepository.getCountByStage();
    console.log(`     Stage counts:`, counts);

    const overdue = await taskRepository.getOverdue();
    console.log(`     Overdue tasks: ${overdue.length}`);
  });

  // Test Alert Repository
  console.log('');
  console.log('🚨 Testing Alert Repository...');
  await runTest('Alert Repository', async () => {
    const alerts = await alertRepository.getAll({ limit: 5 });
    console.log(`     Found ${alerts.length} alerts`);

    const unreadCount = await alertRepository.getUnreadCount();
    console.log(`     Unread alerts: ${unreadCount}`);

    const grouped = await alertRepository.getGroupedByType();
    console.log(`     Alert types: ${grouped.length} different types`);
  });

  // Test Keepa Repository
  console.log('');
  console.log('🔍 Testing Keepa Repository...');
  await runTest('Keepa Repository', async () => {
    const keepaData = await keepaRepository.getAll(5);
    console.log(`     Found ${keepaData.length} Keepa records`);

    const stats = await keepaRepository.getStatistics();
    console.log(`     Total tracked: ${stats.total_tracked || 0}`);
    console.log(`     Avg price: £${stats.avg_price || 'N/A'}`);

    const stale = await keepaRepository.getStale(48);
    console.log(`     Stale records (>48h): ${stale.length}`);
  });

  // Test Settings Repository
  console.log('');
  console.log('⚙️  Testing Settings Repository...');
  await runTest('Settings Repository', async () => {
    const allSettings = await settingsRepository.getAll();
    console.log(`     Found ${allSettings.length} settings`);

    const weights = await settingsRepository.getScoringWeights();
    console.log(`     Scoring weights:`, weights);

    const spApi = await settingsRepository.getSpApiCredentials();
    console.log(`     SP-API credentials: ${spApi ? 'Configured' : 'Not configured'}`);
  });

  // Summary
  console.log('');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Test Results: ${results.passed} passed, ${results.failed} failed`);

  if (results.failed === 0) {
    console.log('');
    console.log('🎉 All tests passed! Repository layer is working correctly.');
  } else {
    console.log('');
    console.log('❌ Some tests failed. Please review the errors above.');
  }

  // Close connection pool
  await close();

  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error('Fatal error:', error);
  await close();
  process.exit(1);
});
