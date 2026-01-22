#!/usr/bin/env node

/**
 * Data Migration Script
 * Migrates data from JSON files to PostgreSQL database
 *
 * Usage: node app/migrate-data.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, testConnection, close } from './src/database/connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data directory relative to app folder
const DATA_DIR = path.join(__dirname, '..', 'data');

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║          Data Migration: JSON → PostgreSQL                    ║');
console.log('╚════════════════════════════════════════════════════════════════╝');
console.log('');

// Helper to read JSON files
function readJsonFile(filename) {
  const filepath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.log(`  ⚠️  File not found: ${filename}`);
    return null;
  }
  const content = fs.readFileSync(filepath, 'utf-8');
  return JSON.parse(content);
}

// Parse date from various formats
function parseDate(dateStr) {
  if (!dateStr) return null;

  // Handle "30/10/2025 16:03:08 GMT" format
  const ukMatch = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (ukMatch) {
    const [, day, month, year, hour, min, sec] = ukMatch;
    return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`);
  }

  // Try ISO format
  return new Date(dateStr);
}

async function migrateListings() {
  console.log('📦 Migrating Listings...');

  const data = readJsonFile('listings.json');
  if (!data || !data.items) {
    console.log('  ❌ No listings data found');
    return 0;
  }

  let count = 0;
  for (const item of data.items) {
    try {
      // NOTE: Uses new column names per 001_slice_a_schema.sql:
      // - seller_sku (was: sku)
      // - price_inc_vat (was: price)
      // - available_quantity (was: quantity)
      // - fulfillmentChannel (was: fulfillment)
      const sql = `
        INSERT INTO listings (seller_sku, asin, title, price_inc_vat, available_quantity, status, "fulfillmentChannel", "openDate", "imageUrl")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (seller_sku) DO UPDATE SET
          asin = EXCLUDED.asin,
          title = EXCLUDED.title,
          price_inc_vat = EXCLUDED.price_inc_vat,
          available_quantity = EXCLUDED.available_quantity,
          status = EXCLUDED.status,
          "fulfillmentChannel" = EXCLUDED."fulfillmentChannel",
          "openDate" = EXCLUDED."openDate",
          "imageUrl" = EXCLUDED."imageUrl",
          "updatedAt" = NOW()
        RETURNING id
      `;

      await query(sql, [
        item.sku || item.seller_sku,
        item.asin,
        item.title,
        item.price || item.price_inc_vat || null,
        item.quantity || item.available_quantity || 0,
        item.status?.toLowerCase() || 'active',
        item.fulfillment || item.fulfillmentChannel || 'FBM',
        parseDate(item.openDate),
        item.imageUrl || null,
      ]);
      count++;
    } catch (error) {
      console.log(`  ⚠️  Error migrating listing ${item.sku || item.seller_sku}: ${error.message}`);
    }
  }

  console.log(`  ✅ Migrated ${count} listings`);
  return count;
}

async function migrateScores() {
  console.log('📊 Migrating Scores...');

  const data = readJsonFile('scores.json');
  if (!data) {
    console.log('  ❌ No scores data found');
    return 0;
  }

  // Get listing ID lookup
  const listingsResult = await query('SELECT id, seller_sku FROM listings');
  const listingMap = {};
  for (const row of listingsResult.rows) {
    listingMap[row.seller_sku] = row.id;
  }

  let count = 0;
  for (const [sku, scoreData] of Object.entries(data)) {
    const listingId = listingMap[sku];
    if (!listingId) {
      // console.log(`  ⚠️  No listing found for SKU: ${sku}`);
      continue;
    }

    try {
      // Extract component scores
      const components = scoreData.components || {};

      const sql = `
        INSERT INTO listing_scores (
          "listingId", "totalScore", "seoScore", "contentScore",
          "imageScore", "competitiveScore", "complianceScore",
          "seoViolations", "contentViolations", "imageViolations",
          "competitiveViolations", "complianceViolations",
          breakdown, recommendations, "calculatedAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
        RETURNING id
      `;

      // Gather all recommendations
      const allRecommendations = [];
      for (const [type, comp] of Object.entries(components)) {
        if (comp.recommendations) {
          allRecommendations.push(...comp.recommendations);
        }
      }

      await query(sql, [
        listingId,
        scoreData.totalScore || 0,
        components.seo?.score || null,
        components.content?.score || null,
        components.images?.score || null,
        components.competitive?.score || null,
        components.compliance?.score || null,
        JSON.stringify(components.seo?.violations || []),
        JSON.stringify(components.content?.violations || []),
        JSON.stringify(components.images?.violations || []),
        JSON.stringify(components.competitive?.violations || []),
        JSON.stringify(components.compliance?.violations || []),
        JSON.stringify(components),
        JSON.stringify(allRecommendations),
      ]);

      // Update denormalized score on listing
      await query(
        `UPDATE listings SET "currentScore" = $1, "scoreUpdatedAt" = NOW() WHERE id = $2`,
        [scoreData.totalScore, listingId]
      );

      count++;
    } catch (error) {
      console.log(`  ⚠️  Error migrating score for ${sku}: ${error.message}`);
    }
  }

  console.log(`  ✅ Migrated ${count} scores`);
  return count;
}

async function migrateTasks() {
  console.log('📋 Migrating Tasks...');

  const data = readJsonFile('tasks.json');
  if (!data || !data.tasks) {
    console.log('  ❌ No tasks data found');
    return 0;
  }

  // Get listing ID lookup
  const listingsResult = await query('SELECT id, seller_sku FROM listings');
  const listingMap = {};
  for (const row of listingsResult.rows) {
    listingMap[row.seller_sku] = row.id;
  }

  let count = 0;
  for (const task of data.tasks) {
    try {
      const listingId = task.sku ? listingMap[task.sku] : null;

      const sql = `
        INSERT INTO tasks (
          title, description, "taskType", stage, priority,
          sku, asin, "listingId", "dueDate", "order", archived,
          "createdBy", "completedAt", "createdAt", "updatedAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING id
      `;

      await query(sql, [
        task.title,
        task.description || null,
        task.taskType || 'optimization',
        task.stage || 'backlog',
        task.priority || 'medium',
        task.sku || null,
        task.asin || null,
        listingId,
        task.dueDate ? new Date(task.dueDate) : null,
        task.order || 0,
        task.archived || false,
        task.createdBy || 'system',
        task.completedAt ? new Date(task.completedAt) : null,
        task.createdAt ? new Date(task.createdAt) : new Date(),
        task.updatedAt ? new Date(task.updatedAt) : new Date(),
      ]);
      count++;
    } catch (error) {
      console.log(`  ⚠️  Error migrating task "${task.title}": ${error.message}`);
    }
  }

  console.log(`  ✅ Migrated ${count} tasks`);
  return count;
}

async function migrateAlerts() {
  console.log('🚨 Migrating Alerts...');

  const data = readJsonFile('alerts.json');
  if (!data || !Array.isArray(data)) {
    console.log('  ❌ No alerts data found');
    return 0;
  }

  // Get listing ID lookup by SKU
  const listingsResult = await query('SELECT id, seller_sku FROM listings');
  const listingMap = {};
  for (const row of listingsResult.rows) {
    listingMap[row.seller_sku] = row.id;
  }

  let count = 0;
  for (const alert of data) {
    try {
      // Try to link to listing by SKU
      const listingId = alert.sku ? listingMap[alert.sku] : null;

      const sql = `
        INSERT INTO alerts (
          "ruleId", "ruleName", "listingId", sku, asin, title,
          type, message, severity, metadata, read, "createdAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
      `;

      await query(sql, [
        alert.ruleId || 'unknown',
        alert.ruleName || 'Alert',
        listingId,
        alert.sku || null,
        alert.asin || null,
        alert.title || null,
        alert.type || alert.ruleId || 'general',
        alert.message || '',
        alert.severity || 'medium',
        JSON.stringify(alert.metadata || {}),
        alert.read || false,
        alert.timestamp ? new Date(alert.timestamp) : new Date(),
      ]);
      count++;
    } catch (error) {
      console.log(`  ⚠️  Error migrating alert: ${error.message}`);
    }
  }

  console.log(`  ✅ Migrated ${count} alerts`);
  return count;
}

async function migrateKeepa() {
  console.log('🔍 Migrating Keepa Data...');

  const data = readJsonFile('keepa.json');
  if (!data || !data.data) {
    console.log('  ❌ No Keepa data found');
    return 0;
  }

  let count = 0;
  for (const [asin, keepaData] of Object.entries(data.data)) {
    try {
      const sql = `
        INSERT INTO keepa_data (
          asin, "currentBSR", "buyBoxPrice", "competitorCount",
          rating, "reviewCount"
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (asin) DO UPDATE SET
          "currentBSR" = EXCLUDED."currentBSR",
          "buyBoxPrice" = EXCLUDED."buyBoxPrice",
          "competitorCount" = EXCLUDED."competitorCount",
          rating = EXCLUDED.rating,
          "reviewCount" = EXCLUDED."reviewCount",
          "lastSyncedAt" = NOW()
        RETURNING id
      `;

      await query(sql, [
        asin,
        keepaData.salesRank || null,
        keepaData.buyBoxPrice || null,
        keepaData.competitorCount || 0,
        keepaData.rating || null,
        keepaData.reviewCount || null,
      ]);
      count++;
    } catch (error) {
      console.log(`  ⚠️  Error migrating Keepa data for ${asin}: ${error.message}`);
    }
  }

  console.log(`  ✅ Migrated ${count} Keepa records`);
  return count;
}

async function main() {
  // Test database connection
  console.log('🔌 Testing Database Connection...');
  const connected = await testConnection();

  if (!connected) {
    console.log('');
    console.log('❌ Cannot connect to database. Please ensure:');
    console.log('   1. Docker containers are running: docker compose up -d');
    console.log('   2. Database is accessible on localhost:5432');
    console.log('   3. Local PostgreSQL is stopped: brew services stop postgresql@15');
    process.exit(1);
  }

  console.log('');

  // Run migrations
  const results = {
    listings: 0,
    scores: 0,
    tasks: 0,
    alerts: 0,
    keepa: 0,
  };

  try {
    results.listings = await migrateListings();
    console.log('');

    results.scores = await migrateScores();
    console.log('');

    results.tasks = await migrateTasks();
    console.log('');

    results.alerts = await migrateAlerts();
    console.log('');

    results.keepa = await migrateKeepa();
    console.log('');
  } catch (error) {
    console.error('Migration error:', error);
  }

  // Summary
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Migration Summary:');
  console.log(`  📦 Listings: ${results.listings}`);
  console.log(`  📊 Scores: ${results.scores}`);
  console.log(`  📋 Tasks: ${results.tasks}`);
  console.log(`  🚨 Alerts: ${results.alerts}`);
  console.log(`  🔍 Keepa: ${results.keepa}`);
  console.log('');
  console.log('🎉 Migration complete!');

  await close();
  process.exit(0);
}

main().catch(async (error) => {
  console.error('Fatal error:', error);
  await close();
  process.exit(1);
});
