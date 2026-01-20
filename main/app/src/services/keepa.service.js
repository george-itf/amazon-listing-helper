/**
 * Keepa Service
 *
 * Handles Keepa API integration for ASIN data enrichment.
 * Per SPEC §5.2 and DATA_CONTRACTS.md §8.1.
 *
 * @module KeepaService
 */

import { query, transaction } from '../database/connection.js';
import { hasKeepaCredentials, getKeepaApiKey } from '../credentials-provider.js';

const KEEPA_API_BASE = 'https://api.keepa.com';
const UK_KEEPA_DOMAIN_ID = 2; // UK domain ID for Keepa

/**
 * Fetch ASIN data from Keepa API
 * @param {string} asin
 * @param {number} [domainId=2] - Keepa domain ID (2 = UK)
 * @returns {Promise<Object>} Raw Keepa response
 */
export async function fetchKeepaData(asin, domainId = UK_KEEPA_DOMAIN_ID) {
  if (!hasKeepaCredentials()) {
    throw new Error('Keepa API credentials not configured');
  }

  const apiKey = getKeepaApiKey();

  const params = new URLSearchParams({
    key: apiKey,
    domain: domainId.toString(),
    asin: asin,
    stats: '90', // 90-day stats
    history: '1', // Include price history
    offers: '20', // Include up to 20 offers
  });

  const response = await fetch(`${KEEPA_API_BASE}/product?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Keepa API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Keepa API error: ${data.error.message || data.error}`);
  }

  return data;
}

/**
 * Parse Keepa response into structured metrics
 * @param {Object} rawData - Raw Keepa API response
 * @returns {Object} Parsed metrics
 */
export function parseKeepaResponse(rawData) {
  if (!rawData.products || rawData.products.length === 0) {
    return {
      found: false,
      metrics: null,
    };
  }

  const product = rawData.products[0];
  const stats = product.stats || {};
  const csv = product.csv || [];

  // Keepa price history indices:
  // 0: Amazon price, 1: New price, 2: Used price, 3: Sales rank, etc.
  const amazonPriceHistory = csv[0] || [];
  const newPriceHistory = csv[1] || [];

  // Calculate price statistics from 90-day window
  const priceStats = calculatePriceStats(newPriceHistory, 90);

  // Extract current offers
  const offers = product.offers || [];
  const fbaOffers = offers.filter(o => o.isFBA);
  const fbmOffers = offers.filter(o => !o.isFBA);

  return {
    found: true,
    metrics: {
      // Basic product info
      asin: product.asin,
      title: product.title,
      brand: product.brand,
      category: product.categoryTree?.[0]?.name,
      subcategory: product.categoryTree?.[1]?.name,
      mainImageUrl: product.imagesCSV?.split(',')[0],

      // Price statistics (in pence, convert to pounds)
      price_current: stats.current?.[1] ? stats.current[1] / 100 : null,
      price_amazon: stats.current?.[0] ? stats.current[0] / 100 : null,
      price_median_90d: priceStats.median ? priceStats.median / 100 : null,
      price_p25_90d: priceStats.p25 ? priceStats.p25 / 100 : null,
      price_p75_90d: priceStats.p75 ? priceStats.p75 / 100 : null,
      price_min_90d: priceStats.min ? priceStats.min / 100 : null,
      price_max_90d: priceStats.max ? priceStats.max / 100 : null,
      price_volatility_90d: priceStats.volatility,

      // Sales rank
      sales_rank_current: stats.current?.[3] || null,
      sales_rank_avg_90d: stats.avg90?.[3] || null,
      sales_rank_trend_90d: calculateTrend(csv[3], 90),

      // Offers
      offers_count_current: offers.length,
      offers_fba_count: fbaOffers.length,
      offers_fbm_count: fbmOffers.length,
      offers_trend_30d: null, // Would need historical offers data

      // Buy Box
      buy_box_price: stats.buyBoxPrice ? stats.buyBoxPrice / 100 : null,
      buy_box_seller: product.buyBoxSellerIdHistory?.[0] || null,
      buy_box_is_amazon: product.buyBoxIsFBA === true,

      // Rating
      rating: product.rating ? product.rating / 10 : null,
      rating_count: product.reviewCount || null,

      // Out of stock info
      out_of_stock_percentage_90d: stats.outOfStockPercentage90?.[1] || null,

      // Timestamps
      last_update: product.lastUpdate ? new Date(product.lastUpdate * 1000).toISOString() : null,
      last_price_change: product.lastPriceChange ? new Date(product.lastPriceChange * 1000).toISOString() : null,
    },
  };
}

/**
 * Calculate price statistics from Keepa price history
 * @param {Array} priceHistory - Keepa CSV price array [timestamp, price, timestamp, price, ...]
 * @param {number} days - Number of days to analyze
 * @returns {Object} Price statistics
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

    if (timestamp >= cutoffTime && price > 0) {
      prices.push(price);
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
  const volatility = mean > 0 ? Math.round((stdDev / mean) * 1000) / 1000 : 0;

  return { median, p25, p75, min, max, volatility };
}

/**
 * Calculate percentile from sorted array
 * @param {number[]} sortedArray
 * @param {number} p - Percentile (0-100)
 * @returns {number}
 */
function percentile(sortedArray, p) {
  const index = (p / 100) * (sortedArray.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sortedArray[lower];
  }

  return sortedArray[lower] + (sortedArray[upper] - sortedArray[lower]) * (index - lower);
}

/**
 * Calculate trend from Keepa CSV data
 * @param {Array} csvData - Keepa CSV array
 * @param {number} days - Number of days
 * @returns {number|null} Trend value (positive = increasing)
 */
function calculateTrend(csvData, days = 90) {
  if (!csvData || csvData.length < 4) return null;

  const now = Date.now();
  const cutoffTime = now - (days * 24 * 60 * 60 * 1000);
  const midpointTime = now - ((days / 2) * 24 * 60 * 60 * 1000);

  const firstHalf = [];
  const secondHalf = [];

  for (let i = 0; i < csvData.length; i += 2) {
    const timestamp = (csvData[i] + 21564000) * 60 * 1000;
    const value = csvData[i + 1];

    if (timestamp >= cutoffTime && value > 0) {
      if (timestamp < midpointTime) {
        firstHalf.push(value);
      } else {
        secondHalf.push(value);
      }
    }
  }

  if (firstHalf.length === 0 || secondHalf.length === 0) return null;

  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

  return Math.round((secondAvg - firstAvg) / firstAvg * 1000) / 1000;
}

/**
 * Save Keepa snapshot to database
 * @param {string} asin
 * @param {number} marketplaceId
 * @param {Object} rawData
 * @param {Object} parsedData
 * @param {number} [asinEntityId]
 * @returns {Promise<Object>}
 */
export async function saveKeepaSnapshot(asin, marketplaceId, rawData, parsedData, asinEntityId = null) {
  const result = await query(`
    INSERT INTO keepa_snapshots (asin, marketplace_id, asin_entity_id, raw_json, parsed_json, captured_at)
    VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
    RETURNING *
  `, [
    asin,
    marketplaceId,
    asinEntityId,
    JSON.stringify(rawData),
    JSON.stringify(parsedData),
  ]);

  return result.rows[0];
}

/**
 * Get or create ASIN entity
 * @param {string} asin
 * @param {number} marketplaceId
 * @param {Object} [data] - Optional data to update
 * @returns {Promise<Object>}
 */
export async function getOrCreateAsinEntity(asin, marketplaceId, data = {}) {
  // Try to get existing
  const existing = await query(`
    SELECT * FROM asin_entities
    WHERE asin = $1 AND marketplace_id = $2
  `, [asin, marketplaceId]);

  if (existing.rows.length > 0) {
    // Update if new data provided
    if (Object.keys(data).length > 0) {
      const result = await query(`
        UPDATE asin_entities
        SET title = COALESCE($3, title),
            brand = COALESCE($4, brand),
            category = COALESCE($5, category),
            main_image_url = COALESCE($6, main_image_url),
            updated_at = CURRENT_TIMESTAMP
        WHERE asin = $1 AND marketplace_id = $2
        RETURNING *
      `, [asin, marketplaceId, data.title, data.brand, data.category, data.mainImageUrl]);
      return result.rows[0];
    }
    return existing.rows[0];
  }

  // Create new
  const result = await query(`
    INSERT INTO asin_entities (asin, marketplace_id, title, brand, category, main_image_url)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [asin, marketplaceId, data.title || null, data.brand || null, data.category || null, data.mainImageUrl || null]);

  return result.rows[0];
}

/**
 * Sync Keepa data for an ASIN
 * Main entry point for SYNC_KEEPA_ASIN job
 *
 * @param {string} asin
 * @param {number} marketplaceId
 * @returns {Promise<Object>}
 */
export async function syncKeepaAsin(asin, marketplaceId) {
  console.log(`[Keepa] Syncing ASIN ${asin} for marketplace ${marketplaceId}`);

  // Fetch from Keepa API
  let rawData;
  let parsedData;

  if (hasKeepaCredentials()) {
    rawData = await fetchKeepaData(asin);
    parsedData = parseKeepaResponse(rawData);
  } else {
    // Stub mode - create mock data for development
    console.log('[Keepa] No API key - using stub data');
    rawData = { products: [], stub: true };
    parsedData = { found: false, metrics: null, stub: true };
  }

  // Get or create ASIN entity
  const asinEntity = await getOrCreateAsinEntity(asin, marketplaceId, parsedData.metrics || {});

  // Save snapshot
  const snapshot = await saveKeepaSnapshot(
    asin,
    marketplaceId,
    rawData,
    parsedData,
    asinEntity.id
  );

  return {
    asin_entity_id: asinEntity.id,
    snapshot_id: snapshot.id,
    found: parsedData.found,
    metrics: parsedData.metrics,
  };
}

/**
 * Get latest Keepa snapshot for an ASIN
 * @param {string} asin
 * @param {number} marketplaceId
 * @returns {Promise<Object|null>}
 */
export async function getLatestKeepaSnapshot(asin, marketplaceId) {
  const result = await query(`
    SELECT * FROM keepa_snapshots
    WHERE asin = $1 AND marketplace_id = $2
    ORDER BY captured_at DESC
    LIMIT 1
  `, [asin, marketplaceId]);

  return result.rows[0] || null;
}

/**
 * Get Keepa snapshot history for an ASIN
 * @param {string} asin
 * @param {number} marketplaceId
 * @param {number} limit
 * @returns {Promise<Object[]>}
 */
export async function getKeepaSnapshotHistory(asin, marketplaceId, limit = 30) {
  const result = await query(`
    SELECT id, asin, parsed_json, captured_at
    FROM keepa_snapshots
    WHERE asin = $1 AND marketplace_id = $2
    ORDER BY captured_at DESC
    LIMIT $3
  `, [asin, marketplaceId, limit]);

  return result.rows;
}

export default {
  fetchKeepaData,
  parseKeepaResponse,
  saveKeepaSnapshot,
  getOrCreateAsinEntity,
  syncKeepaAsin,
  getLatestKeepaSnapshot,
  getKeepaSnapshotHistory,
};
