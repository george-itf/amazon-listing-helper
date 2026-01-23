#!/usr/bin/env node
/**
 * SP-API Catalog Items Test Script
 *
 * Tests the searchCatalogItems API call with proper parameter formatting.
 * Run this to verify the fix for "Missing required 'identifiers' or 'keywords'" error.
 *
 * Usage:
 *   # Single ASIN test
 *   node scripts/test-spapi-catalog.js B001234567
 *
 *   # Multiple ASINs (comma-separated)
 *   node scripts/test-spapi-catalog.js B001234567,B009876543,B005555555
 *
 *   # Dry run (shows request shape without calling API)
 *   node scripts/test-spapi-catalog.js --dry-run B001234567,B009876543
 *
 * Environment variables required:
 *   SP_API_CLIENT_ID, SP_API_CLIENT_SECRET, SP_API_REFRESH_TOKEN, SP_API_REGION
 */

import 'dotenv/config';
import SellingPartner from 'amazon-sp-api';
import { hasSpApiCredentials, getSpApiClientConfig, getDefaultMarketplaceId } from '../src/credentials-provider.js';

// ASIN validation regex
const ASIN_REGEX = /^[A-Z0-9]{10}$/i;

/**
 * Normalize identifiers for SP-API (copy of worker logic for isolated testing)
 */
function normalizeIdentifiers(input, maxSize = 20) {
  if (input == null) {
    return { valid: false, identifiers: '', asinArray: [], error: 'Input is null or undefined' };
  }

  let rawArray;
  if (typeof input === 'string') {
    rawArray = input.split(',').map(s => s.trim());
  } else if (Array.isArray(input)) {
    rawArray = input;
  } else {
    return { valid: false, identifiers: '', asinArray: [], error: `Invalid input type: ${typeof input}` };
  }

  const seen = new Set();
  const validAsins = [];
  const skipped = [];

  for (const item of rawArray) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const asin = item.trim().toUpperCase();
    if (seen.has(asin)) continue;
    if (!ASIN_REGEX.test(asin)) {
      skipped.push(asin);
      continue;
    }
    seen.add(asin);
    validAsins.push(asin);
  }

  if (validAsins.length === 0) {
    return { valid: false, identifiers: '', asinArray: [], skipped, error: 'No valid ASINs after filtering' };
  }

  const slicedAsins = validAsins.slice(0, maxSize);
  return {
    valid: true,
    identifiers: slicedAsins.join(','),
    asinArray: slicedAsins,
    skipped,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const asinInput = args.filter(a => !a.startsWith('--'))[0];

  if (!asinInput) {
    console.error('Usage: node scripts/test-spapi-catalog.js [--dry-run] <ASIN1,ASIN2,...>');
    console.error('Example: node scripts/test-spapi-catalog.js B001234567,B009876543');
    process.exit(1);
  }

  // Normalize input
  const normalized = normalizeIdentifiers(asinInput);
  console.log('\n=== Input Normalization ===');
  console.log('Input:', asinInput);
  console.log('Valid:', normalized.valid);
  console.log('Identifiers (comma-string):', normalized.identifiers);
  console.log('ASIN Array:', normalized.asinArray);
  console.log('Skipped:', normalized.skipped);

  if (!normalized.valid) {
    console.error('\nError:', normalized.error);
    process.exit(1);
  }

  // Check credentials
  if (!hasSpApiCredentials()) {
    console.error('\nSP-API credentials not configured. Set environment variables:');
    console.error('  SP_API_CLIENT_ID, SP_API_CLIENT_SECRET, SP_API_REFRESH_TOKEN, SP_API_REGION');
    process.exit(1);
  }

  const config = getSpApiClientConfig();
  const marketplaceId = getDefaultMarketplaceId();

  // Build the exact request we'll send
  const requestShape = {
    operation: 'searchCatalogItems',
    endpoint: 'catalogItems',
    query: {
      identifiers: normalized.identifiers,           // COMMA-SEPARATED STRING
      identifiersType: 'ASIN',                       // Required with identifiers
      marketplaceIds: marketplaceId,                 // Single string, not array
      includedData: 'identifiers,images,salesRanks,productTypes,summaries',  // Comma-separated string
    },
  };

  console.log('\n=== SP-API Request Shape ===');
  console.log(JSON.stringify(requestShape, null, 2));

  if (dryRun) {
    console.log('\n[DRY RUN] Skipping actual API call.');
    console.log('\nExpected URL query string (approx):');
    const qs = new URLSearchParams(requestShape.query).toString();
    console.log(`  ?${qs}`);
    process.exit(0);
  }

  // Make the actual call
  console.log('\n=== Making SP-API Call ===');
  const sp = new SellingPartner({
    region: config.region,
    refresh_token: config.refresh_token,
    credentials: config.credentials,
  });

  try {
    const response = await sp.callAPI(requestShape);

    console.log('\n=== Response ===');
    console.log('Items returned:', response.items?.length || 0);

    if (response.items && response.items.length > 0) {
      console.log('\nFirst item:');
      const first = response.items[0];
      console.log('  ASIN:', first.asin);
      console.log('  Title:', first.summaries?.[0]?.itemName || 'N/A');
      console.log('  Brand:', first.summaries?.[0]?.brand || 'N/A');
    }

    console.log('\nFull response (truncated):');
    console.log(JSON.stringify(response, null, 2).slice(0, 2000));

    console.log('\n✓ SUCCESS - SP-API call completed without errors');

  } catch (error) {
    console.error('\n=== ERROR ===');
    console.error('Message:', error.message);
    console.error('Code:', error.code);
    console.error('Status:', error.statusCode);

    if (error.message.includes('identifiers') || error.message.includes('keywords')) {
      console.error('\n⚠ This is the "Missing required identifiers/keywords" error!');
      console.error('Check the request shape above - identifiers should be a comma-separated STRING.');
    }

    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
