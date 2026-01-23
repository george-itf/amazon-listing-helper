/**
 * ASIN Data Service
 *
 * Core service for the canonical ASIN data model.
 * Handles data flattening, transformation, DQ checks, and coordination.
 *
 * This is the central orchestrator for:
 * - Fetching raw data from Keepa and SP-API
 * - Transforming raw data into flattened snapshots
 * - Running data quality checks
 * - Updating the materialized current view
 *
 * @module AsinDataService
 */

import { v4 as uuidv4 } from 'uuid';
import { query, transaction } from '../database/connection.js';
import * as rawPayloadRepo from '../repositories/raw-payload.repository.js';
import * as asinSnapshotRepo from '../repositories/asin-snapshot.repository.js';
import * as asinCurrentRepo from '../repositories/asin-current.repository.js';
import * as dqIssueRepo from '../repositories/dq-issue.repository.js';
import { generateFingerprint } from '../lib/fingerprint.js';
import { getKeepaRateLimiter } from '../lib/token-bucket.js';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ service: 'asin-data' });

// Transform version - increment when transform logic changes
export const TRANSFORM_VERSION = 1;

// VAT rate for UK
const UK_VAT_RATE = 0.20;

/**
 * Flatten Keepa data into standardized fields
 *
 * @param {Object} keepaPayload - Raw Keepa API response
 * @returns {Object} Flattened Keepa fields
 */
export function flattenKeepaData(keepaPayload) {
  if (!keepaPayload || !keepaPayload.products || keepaPayload.products.length === 0) {
    return {
      keepa_has_data: false,
      keepa_last_update: null,
      keepa_price_p25_90d: null,
      keepa_price_median_90d: null,
      keepa_price_p75_90d: null,
      keepa_lowest_90d: null,
      keepa_highest_90d: null,
      keepa_sales_rank_latest: null,
      keepa_new_offers: null,
      keepa_used_offers: null,
      title: null,
      brand: null,
      category_path: null,
    };
  }

  const product = keepaPayload.products[0];
  const stats = product.stats || {};
  const csv = product.csv || [];

  // Price history is in CSV index 1 (new price)
  const priceStats = calculatePriceStats(csv[1], 90);

  // Build category path from tree
  let categoryPath = null;
  if (product.categoryTree && product.categoryTree.length > 0) {
    categoryPath = product.categoryTree.map(c => c.name).join(' > ');
  }

  // Get current offers count
  const offers = product.offers || [];
  const newOffers = offers.filter(o => o.condition === 1).length; // Condition 1 = New
  const usedOffers = offers.filter(o => o.condition !== 1).length;

  return {
    keepa_has_data: true,
    keepa_last_update: product.lastUpdate ? new Date(product.lastUpdate * 1000) : null,
    keepa_price_p25_90d: priceStats.p25,
    keepa_price_median_90d: priceStats.median,
    keepa_price_p75_90d: priceStats.p75,
    keepa_lowest_90d: priceStats.min,
    keepa_highest_90d: priceStats.max,
    keepa_sales_rank_latest: stats.current?.[3] || null,
    keepa_new_offers: newOffers || (stats.current?.[11] ?? null), // Index 11 is new offer count
    keepa_used_offers: usedOffers || null,
    price_volatility_score: priceStats.volatility,
    title: product.title || null,
    brand: product.brand || null,
    category_path: categoryPath,
    // Buy box info from Keepa
    buy_box_price: stats.buyBoxPrice ? stats.buyBoxPrice / 100 : null,
    buy_box_seller_id: product.buyBoxSellerIdHistory?.[product.buyBoxSellerIdHistory.length - 1] || null,
    buy_box_is_fba: product.buyBoxIsFBA ?? null,
    seller_count: stats.current?.[11] ?? null, // Total offer count
  };
}

/**
 * Flatten SP-API data into standardized fields
 *
 * @param {Object} spApiPayload - Raw SP-API response (catalog, pricing, inventory)
 * @returns {Object} Flattened SP-API fields
 */
export function flattenSpApiData(spApiPayload) {
  if (!spApiPayload) {
    return {
      title: null,
      brand: null,
      price_inc_vat: null,
      price_ex_vat: null,
      list_price: null,
      total_stock: null,
      fulfillment_channel: null,
      units_7d: null,
      units_30d: null,
      units_90d: null,
    };
  }

  // Extract from different SP-API response types
  const catalogItem = spApiPayload.catalogItem || spApiPayload;
  const pricingInfo = spApiPayload.pricing || {};
  const inventoryInfo = spApiPayload.inventory || {};
  const salesInfo = spApiPayload.sales || {};

  // Title and brand from catalog
  const attributes = catalogItem.attributes || {};
  const title = attributes.item_name?.[0]?.value || catalogItem.title || null;
  const brand = attributes.brand?.[0]?.value || catalogItem.brand || null;

  // Price from pricing API
  let priceIncVat = null;
  let listPrice = null;
  if (pricingInfo.offers && pricingInfo.offers.length > 0) {
    const myOffer = pricingInfo.offers.find(o => o.isMine) || pricingInfo.offers[0];
    priceIncVat = myOffer?.listingPrice?.amount || null;
    listPrice = myOffer?.regularPrice?.amount || null;
  }

  // Calculate ex-VAT price
  const priceExVat = priceIncVat ? roundMoney(priceIncVat / (1 + UK_VAT_RATE)) : null;

  // Stock from inventory
  let totalStock = null;
  let fulfillmentChannel = null;
  if (inventoryInfo.fulfillmentAvailability) {
    totalStock = inventoryInfo.fulfillmentAvailability.reduce(
      (sum, fa) => sum + (fa.quantity || 0),
      0
    );
    fulfillmentChannel = inventoryInfo.fulfillmentAvailability[0]?.fulfillmentChannelCode || 'FBM';
  }

  // Sales from sales report (if available)
  const units7d = salesInfo.unitsOrdered7d ?? null;
  const units30d = salesInfo.unitsOrdered30d ?? null;
  const units90d = salesInfo.unitsOrdered90d ?? null;

  return {
    title,
    brand,
    price_inc_vat: priceIncVat,
    price_ex_vat: priceExVat,
    list_price: listPrice,
    total_stock: totalStock,
    fulfillment_channel: fulfillmentChannel,
    units_7d: units7d,
    units_30d: units30d,
    units_90d: units90d,
  };
}

/**
 * Calculate price statistics from Keepa CSV data
 * @private
 */
function calculatePriceStats(priceHistory, days = 90) {
  if (!priceHistory || priceHistory.length === 0) {
    return { median: null, p25: null, p75: null, min: null, max: null, volatility: null };
  }

  const now = Date.now();
  const cutoffTime = now - (days * 24 * 60 * 60 * 1000);

  // Extract prices within the time window
  // Keepa format: [timestamp, price, timestamp, price, ...]
  const prices = [];
  for (let i = 0; i < priceHistory.length; i += 2) {
    const timestamp = (priceHistory[i] + 21564000) * 60 * 1000; // Keepa time to Unix
    const price = priceHistory[i + 1];

    if (timestamp >= cutoffTime && price > 0 && price < 100000000) { // Filter out -1 (unavailable) and unreasonable values
      prices.push(price); // Keep in pence
    }
  }

  if (prices.length === 0) {
    return { median: null, p25: null, p75: null, min: null, max: null, volatility: null };
  }

  // Sort for percentiles
  prices.sort((a, b) => a - b);

  const min = prices[0];
  const max = prices[prices.length - 1];
  const median = percentile(prices, 50);
  const p25 = percentile(prices, 25);
  const p75 = percentile(prices, 75);

  // Calculate volatility (coefficient of variation)
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
  const stdDev = Math.sqrt(variance);
  const volatility = mean > 0 ? Math.round((stdDev / mean) * 10000) / 10000 : 0;

  return { median, p25, p75, min, max, volatility };
}

/**
 * Calculate percentile from sorted array
 * @private
 */
function percentile(sortedArray, p) {
  const index = (p / 100) * (sortedArray.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sortedArray[lower];
  }

  return Math.round(sortedArray[lower] + (sortedArray[upper] - sortedArray[lower]) * (index - lower));
}

/**
 * Round to 2 decimal places
 * @private
 */
function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Merge Keepa and SP-API data with preference rules
 *
 * @param {Object} keepaData - Flattened Keepa data
 * @param {Object} spApiData - Flattened SP-API data
 * @returns {Object} Merged data
 */
export function mergeData(keepaData, spApiData) {
  // SP-API takes precedence for our own listing data
  // Keepa takes precedence for market/competitor data
  return {
    // Identity - prefer SP-API, fallback to Keepa
    title: spApiData.title || keepaData.title,
    brand: spApiData.brand || keepaData.brand,
    category_path: keepaData.category_path, // Keepa has better category info

    // Pricing - SP-API for our price, Keepa for market prices
    price_inc_vat: spApiData.price_inc_vat,
    price_ex_vat: spApiData.price_ex_vat,
    list_price: spApiData.list_price || keepaData.list_price,

    // Buy box - from Keepa (market data)
    buy_box_price: keepaData.buy_box_price,
    buy_box_seller_id: keepaData.buy_box_seller_id,
    buy_box_is_fba: keepaData.buy_box_is_fba,
    seller_count: keepaData.seller_count,

    // Inventory - from SP-API (our data)
    total_stock: spApiData.total_stock,
    fulfillment_channel: spApiData.fulfillment_channel,

    // Sales - from SP-API
    units_7d: spApiData.units_7d,
    units_30d: spApiData.units_30d,
    units_90d: spApiData.units_90d,

    // Keepa metrics
    keepa_has_data: keepaData.keepa_has_data,
    keepa_last_update: keepaData.keepa_last_update,
    keepa_price_p25_90d: keepaData.keepa_price_p25_90d,
    keepa_price_median_90d: keepaData.keepa_price_median_90d,
    keepa_price_p75_90d: keepaData.keepa_price_p75_90d,
    keepa_lowest_90d: keepaData.keepa_lowest_90d,
    keepa_highest_90d: keepaData.keepa_highest_90d,
    keepa_sales_rank_latest: keepaData.keepa_sales_rank_latest,
    keepa_new_offers: keepaData.keepa_new_offers,
    keepa_used_offers: keepaData.keepa_used_offers,

    // Derived
    price_volatility_score: keepaData.price_volatility_score,
  };
}

/**
 * Calculate derived fields (flags, economics)
 *
 * @param {Object} data - Merged data
 * @param {string} ourSellerId - Our Amazon seller ID (for buy box comparison)
 * @returns {Object} Data with derived fields added
 */
export function calculateDerivedFields(data, ourSellerId = null) {
  const derived = { ...data };

  // Days of cover calculation
  if (derived.total_stock !== null && derived.units_30d !== null && derived.units_30d > 0) {
    const dailySales = derived.units_30d / 30;
    derived.days_of_cover = roundMoney(derived.total_stock / dailySales);
  } else {
    derived.days_of_cover = null;
  }

  // Is out of stock flag
  derived.is_out_of_stock = derived.total_stock !== null && derived.total_stock <= 0;

  // Is buy box lost flag
  if (ourSellerId && derived.buy_box_seller_id) {
    derived.is_buy_box_lost = derived.buy_box_seller_id !== ourSellerId;
  } else {
    derived.is_buy_box_lost = null;
  }

  // Economics (best effort - requires BOM data for accurate calculation)
  // For now, we estimate based on typical margins
  if (derived.price_inc_vat !== null && derived.price_ex_vat !== null) {
    // Estimate Amazon fees (15% referral)
    const amazonFees = derived.price_ex_vat * 0.15;
    // Estimate gross margin (without BOM - placeholder)
    derived.gross_margin_pct = null; // Set to null - requires BOM integration
    derived.profit_per_unit = null;  // Set to null - requires BOM integration
    derived.breakeven_price = null;  // Set to null - requires BOM integration
  }

  return derived;
}

/**
 * Run data quality checks on snapshot data
 *
 * @param {Object} data - Snapshot data
 * @param {string} asin - ASIN
 * @param {number} marketplaceId - Marketplace ID
 * @param {string} ingestionJobId - Ingestion job UUID
 * @returns {Array<Object>} Array of DQ issues found
 */
export function runDqChecks(data, asin, marketplaceId, ingestionJobId) {
  const issues = [];
  const { DQ_ISSUE_TYPE, DQ_SEVERITY } = dqIssueRepo;

  // Check for missing required fields
  const requiredFields = ['title'];
  for (const field of requiredFields) {
    if (!data[field]) {
      issues.push({
        asin,
        marketplace_id: marketplaceId,
        ingestion_job_id: ingestionJobId,
        issue_type: DQ_ISSUE_TYPE.MISSING_FIELD,
        field_name: field,
        severity: DQ_SEVERITY.WARN,
        message: `Required field '${field}' is missing`,
        details: { field, value: data[field] },
      });
    }
  }

  // Check for invalid values
  if (data.total_stock !== null && data.total_stock < 0) {
    issues.push({
      asin,
      marketplace_id: marketplaceId,
      ingestion_job_id: ingestionJobId,
      issue_type: DQ_ISSUE_TYPE.INVALID_VALUE,
      field_name: 'total_stock',
      severity: DQ_SEVERITY.CRITICAL,
      message: 'Stock cannot be negative',
      details: { field: 'total_stock', value: data.total_stock, expected: '>= 0' },
    });
  }

  if (data.price_inc_vat !== null && data.price_inc_vat <= 0) {
    issues.push({
      asin,
      marketplace_id: marketplaceId,
      ingestion_job_id: ingestionJobId,
      issue_type: DQ_ISSUE_TYPE.INVALID_VALUE,
      field_name: 'price_inc_vat',
      severity: DQ_SEVERITY.WARN,
      message: 'Price should be positive',
      details: { field: 'price_inc_vat', value: data.price_inc_vat, expected: '> 0' },
    });
  }

  if (data.seller_count !== null && data.seller_count < 0) {
    issues.push({
      asin,
      marketplace_id: marketplaceId,
      ingestion_job_id: ingestionJobId,
      issue_type: DQ_ISSUE_TYPE.INVALID_VALUE,
      field_name: 'seller_count',
      severity: DQ_SEVERITY.WARN,
      message: 'Seller count cannot be negative',
      details: { field: 'seller_count', value: data.seller_count, expected: '>= 0' },
    });
  }

  // Check for stale Keepa data (> 72 hours old)
  if (data.keepa_has_data && data.keepa_last_update) {
    const keepaAge = Date.now() - new Date(data.keepa_last_update).getTime();
    const maxAgeMs = 72 * 60 * 60 * 1000; // 72 hours

    if (keepaAge > maxAgeMs) {
      issues.push({
        asin,
        marketplace_id: marketplaceId,
        ingestion_job_id: ingestionJobId,
        issue_type: DQ_ISSUE_TYPE.STALE_DATA,
        field_name: 'keepa_last_update',
        severity: DQ_SEVERITY.WARN,
        message: 'Keepa data is older than 72 hours',
        details: {
          field: 'keepa_last_update',
          value: data.keepa_last_update,
          age_hours: Math.round(keepaAge / (60 * 60 * 1000)),
          max_age_hours: 72,
        },
      });
    }
  }

  // Check for missing Keepa data (warning only)
  if (!data.keepa_has_data) {
    issues.push({
      asin,
      marketplace_id: marketplaceId,
      ingestion_job_id: ingestionJobId,
      issue_type: DQ_ISSUE_TYPE.MISSING_FIELD,
      field_name: 'keepa_data',
      severity: DQ_SEVERITY.WARN,
      message: 'No Keepa data available for this ASIN',
      details: { keepa_has_data: false },
    });
  }

  // Check for price volatility (high volatility might need attention)
  if (data.price_volatility_score !== null && data.price_volatility_score > 0.5) {
    issues.push({
      asin,
      marketplace_id: marketplaceId,
      ingestion_job_id: ingestionJobId,
      issue_type: DQ_ISSUE_TYPE.OUT_OF_RANGE,
      field_name: 'price_volatility_score',
      severity: DQ_SEVERITY.WARN,
      message: 'High price volatility detected (>50%)',
      details: {
        field: 'price_volatility_score',
        value: data.price_volatility_score,
        threshold: 0.5,
      },
    });
  }

  return issues;
}

/**
 * Transform raw payloads into a snapshot
 * Main transformation pipeline
 *
 * IMPORTANT: All persistence operations (snapshot insert, DQ issues, current upsert)
 * are wrapped in a single transaction to ensure atomicity. If any write fails,
 * all writes are rolled back.
 *
 * @param {string} asin - ASIN
 * @param {number} marketplaceId - Marketplace ID
 * @param {string} ingestionJobId - Ingestion job UUID
 * @param {Object} keepaRaw - Raw Keepa payload (or null)
 * @param {Object} spApiRaw - Raw SP-API payload (or null)
 * @param {Object} [options] - Transform options
 * @param {string} [options.ourSellerId] - Our Amazon seller ID
 * @param {number} [options.asinEntityId] - Existing ASIN entity ID
 * @param {Date} [options.keepaCapturedAt] - When Keepa payload was captured (for freshness)
 * @param {Date} [options.spApiCapturedAt] - When SP-API payload was captured (for freshness)
 * @returns {Promise<Object>} Transform result with snapshot and DQ issues
 */
export async function transformAndSave(
  asin,
  marketplaceId,
  ingestionJobId,
  keepaRaw,
  spApiRaw,
  options = {}
) {
  const startTime = Date.now();

  // FRESHNESS FIX: snapshot_time should be the max of payload capture times,
  // NOT the transform time. This ensures late transforms don't mark old data as fresh.
  const capturedTimes = [];
  if (options.keepaCapturedAt) capturedTimes.push(new Date(options.keepaCapturedAt));
  if (options.spApiCapturedAt) capturedTimes.push(new Date(options.spApiCapturedAt));
  const snapshotTime = capturedTimes.length > 0
    ? new Date(Math.max(...capturedTimes.map(d => d.getTime())))
    : new Date(); // Fallback to now if no capture times provided

  // Flatten data from each source
  const keepaFlat = flattenKeepaData(keepaRaw);
  const spApiFlat = flattenSpApiData(spApiRaw);

  // Merge data sources
  const merged = mergeData(keepaFlat, spApiFlat);

  // Calculate derived fields
  const withDerived = calculateDerivedFields(merged, options.ourSellerId);

  // Generate fingerprint
  const fingerprintHash = generateFingerprint({
    asin,
    marketplace_id: marketplaceId,
    price_inc_vat: withDerived.price_inc_vat,
    total_stock: withDerived.total_stock,
    buy_box_seller_id: withDerived.buy_box_seller_id,
    keepa_price_p25_90d: withDerived.keepa_price_p25_90d,
    seller_count: withDerived.seller_count,
  });

  // Run DQ checks
  const dqIssues = runDqChecks(withDerived, asin, marketplaceId, ingestionJobId);

  // Prepare snapshot data
  const snapshotData = {
    asin,
    marketplace_id: marketplaceId,
    asin_entity_id: options.asinEntityId || null,
    ingestion_job_id: ingestionJobId,
    ...withDerived,
    amazon_raw: spApiRaw,
    keepa_raw: keepaRaw,
    fingerprint_hash: fingerprintHash,
    transform_version: TRANSFORM_VERSION,
    snapshot_time: snapshotTime, // Use max(captured_at) from payloads, not transform time
  };

  // Execute all persistence in a single transaction for atomicity
  // If any write fails, all are rolled back
  let snapshot = null;

  try {
    snapshot = await transaction(async (client) => {
      // 1. Insert snapshot (append-only)
      const snap = await asinSnapshotRepo.insert(snapshotData, { client });

      if (!snap) {
        // Table might not exist - return null but don't throw
        return null;
      }

      // 2. Insert DQ issues with snapshot_id
      if (dqIssues.length > 0) {
        const issuesWithSnapshot = dqIssues.map(issue => ({
          ...issue,
          snapshot_id: snap.id,
        }));
        await dqIssueRepo.bulkCreate(issuesWithSnapshot, { client });
      }

      // 3. Upsert current view
      const currentData = {
        ...snapshotData,
        latest_snapshot_id: snap.id,
        last_ingestion_job_id: ingestionJobId,
        last_snapshot_time: snap.snapshot_time,
      };
      await asinCurrentRepo.upsert(currentData, { client });

      // 4. Auto-resolve stale data issues
      await dqIssueRepo.autoResolve(asin, marketplaceId, [
        dqIssueRepo.DQ_ISSUE_TYPE.STALE_DATA,
        dqIssueRepo.DQ_ISSUE_TYPE.API_ERROR,
      ], { client });

      return snap;
    });
  } catch (error) {
    // Log but don't throw - allow the caller to handle partial success
    logger.error({
      asin,
      marketplaceId,
      error: error.message,
    }, 'Transform transaction failed - rolled back');
  }

  const durationMs = Date.now() - startTime;

  logger.debug({
    asin,
    marketplaceId,
    snapshotId: snapshot?.id,
    dqIssueCount: dqIssues.length,
    durationMs,
  }, 'Transform completed');

  return {
    asin,
    marketplace_id: marketplaceId,
    snapshot_id: snapshot?.id || null,
    fingerprint_hash: fingerprintHash,
    dq_issues: dqIssues,
    duration_ms: durationMs,
    success: !!snapshot,
  };
}

/**
 * Get the canonical current state for an ASIN
 * This is the main query interface for consumers
 *
 * @param {string} asin - ASIN
 * @param {number} marketplaceId - Marketplace ID
 * @returns {Promise<Object|null>}
 */
export async function getCurrentState(asin, marketplaceId) {
  return asinCurrentRepo.getByAsin(asin, marketplaceId);
}

/**
 * Get snapshot history for an ASIN
 *
 * @param {string} asin - ASIN
 * @param {number} marketplaceId - Marketplace ID
 * @param {number} [limit=30] - Maximum snapshots
 * @returns {Promise<Object[]>}
 */
export async function getSnapshotHistory(asin, marketplaceId, limit = 30) {
  return asinSnapshotRepo.getHistory(asin, marketplaceId, limit);
}

/**
 * Get ASINs that need refresh (stale data)
 *
 * @param {number} maxAgeMinutes - Maximum age in minutes
 * @param {number} [limit=100] - Maximum results
 * @returns {Promise<string[]>} Array of ASINs needing refresh
 */
export async function getAsinsNeedingRefresh(maxAgeMinutes, limit = 100) {
  const staleRecords = await asinCurrentRepo.getStale(maxAgeMinutes, limit);
  return staleRecords.map(r => r.asin);
}

/**
 * Create a new ingestion job
 *
 * @param {string} jobType - Job type ('FULL_REFRESH', 'INCREMENTAL', etc.)
 * @param {Object} [metadata] - Additional metadata
 * @returns {Promise<Object>} Created ingestion job
 */
export async function createIngestionJob(jobType, metadata = {}) {
  try {
    const result = await query(`
      INSERT INTO ingestion_jobs (job_type, status, metadata)
      VALUES ($1, 'PENDING', $2)
      RETURNING *
    `, [jobType, JSON.stringify(metadata)]);

    return result.rows[0];
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      // Return a mock job if table doesn't exist
      return {
        id: uuidv4(),
        job_type: jobType,
        status: 'PENDING',
        metadata,
        created_at: new Date(),
      };
    }
    throw error;
  }
}

/**
 * Update ingestion job status
 *
 * @param {string} jobId - Job UUID
 * @param {string} status - New status
 * @param {Object} [updates] - Additional updates
 * @returns {Promise<Object|null>}
 */
export async function updateIngestionJob(jobId, status, updates = {}) {
  try {
    const setClauses = ['status = $2', 'updated_at = CURRENT_TIMESTAMP'];
    const params = [jobId, status];
    let paramIndex = 3;

    if (updates.asin_count !== undefined) {
      setClauses.push(`asin_count = $${paramIndex++}`);
      params.push(updates.asin_count);
    }

    if (updates.asins_succeeded !== undefined) {
      setClauses.push(`asins_succeeded = $${paramIndex++}`);
      params.push(updates.asins_succeeded);
    }

    if (updates.asins_failed !== undefined) {
      setClauses.push(`asins_failed = $${paramIndex++}`);
      params.push(updates.asins_failed);
    }

    if (updates.started_at !== undefined) {
      setClauses.push(`started_at = $${paramIndex++}`);
      params.push(updates.started_at);
    }

    if (updates.completed_at !== undefined) {
      setClauses.push(`completed_at = $${paramIndex++}`);
      params.push(updates.completed_at);
    }

    if (updates.duration_ms !== undefined) {
      setClauses.push(`duration_ms = $${paramIndex++}`);
      params.push(updates.duration_ms);
    }

    if (updates.error_message !== undefined) {
      setClauses.push(`error_message = $${paramIndex++}`);
      params.push(updates.error_message);
    }

    if (updates.error_details !== undefined) {
      setClauses.push(`error_details = $${paramIndex++}`);
      params.push(JSON.stringify(updates.error_details));
    }

    const result = await query(`
      UPDATE ingestion_jobs
      SET ${setClauses.join(', ')}
      WHERE id = $1
      RETURNING *
    `, params);

    return result.rows[0] || null;
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      return null;
    }
    throw error;
  }
}

export default {
  TRANSFORM_VERSION,
  flattenKeepaData,
  flattenSpApiData,
  mergeData,
  calculateDerivedFields,
  runDqChecks,
  transformAndSave,
  getCurrentState,
  getSnapshotHistory,
  getAsinsNeedingRefresh,
  createIngestionJob,
  updateIngestionJob,
};
