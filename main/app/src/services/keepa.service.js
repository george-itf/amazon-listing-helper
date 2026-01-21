/**
 * Keepa Service
 *
 * Handles Keepa API integration for ASIN data enrichment.
 * Per SPEC §5.2 and DATA_CONTRACTS.md §8.1.
 *
 * Features:
 * - Batching: Up to 10 ASINs per request
 * - Exponential backoff with jitter for 429/5xx errors
 * - Rate-limit header parsing and preemptive throttling
 * - Configurable historical windows (7d, 30d, 90d)
 * - TTL-based caching to prevent duplicate requests
 *
 * @module KeepaService
 */

import { query, transaction } from '../database/connection.js';
import { hasKeepaCredentials, getKeepaApiKey } from '../credentials-provider.js';

const KEEPA_API_BASE = 'https://api.keepa.com';
const UK_KEEPA_DOMAIN_ID = 2; // UK domain ID for Keepa

// Configuration (can be overridden via environment)
const config = {
  maxBatchSize: parseInt(process.env.KEEPA_MAX_BATCH_SIZE || '10', 10),
  defaultStatsWindow: parseInt(process.env.KEEPA_STATS_WINDOW || '90', 10),
  cacheTtlMs: parseInt(process.env.KEEPA_CACHE_TTL_MS || '3600000', 10), // 1 hour default
  maxRetries: parseInt(process.env.KEEPA_MAX_RETRIES || '6', 10),
  baseDelayMs: parseInt(process.env.KEEPA_BASE_DELAY_MS || '2000', 10),
  maxDelayMs: parseInt(process.env.KEEPA_MAX_DELAY_MS || '64000', 10),
  quotaThreshold: parseInt(process.env.KEEPA_QUOTA_THRESHOLD || '10', 10), // Pause when quota below this
};

// Rate limit state (in-memory)
let rateLimitState = {
  tokensRemaining: null,
  resetTime: null,
  lastUpdated: null,
};

/**
 * Sleep utility
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Add jitter to a delay value
 * @param {number} delay - Base delay in ms
 * @returns {number} Delay with jitter
 */
function addJitter(delay) {
  // Add up to 25% random jitter
  const jitter = Math.random() * 0.25 * delay;
  return Math.round(delay + jitter);
}

/**
 * Calculate exponential backoff delay
 * @param {number} attempt - Current attempt number (0-based)
 * @returns {number} Delay in milliseconds
 */
function calculateBackoffDelay(attempt) {
  const delay = Math.min(
    config.baseDelayMs * Math.pow(2, attempt),
    config.maxDelayMs
  );
  return addJitter(delay);
}

/**
 * Check if an error is retryable
 * @param {Error} error - The error object
 * @param {number} statusCode - HTTP status code
 * @returns {boolean} True if the request should be retried
 */
function isRetryableError(error, statusCode) {
  // Retry on rate limits
  if (statusCode === 429) return true;

  // Retry on server errors
  if (statusCode >= 500 && statusCode < 600) return true;

  // Retry on network errors
  if (error.message?.includes('ECONNRESET')) return true;
  if (error.message?.includes('ETIMEDOUT')) return true;
  if (error.message?.includes('fetch failed')) return true;

  return false;
}

/**
 * Parse rate limit headers from Keepa response
 * @param {Response} response - Fetch response object
 */
function parseRateLimitHeaders(response) {
  const remaining = response.headers.get('X-Rl-RemainingTokens') ||
                    response.headers.get('X-Rate-Limit-Remaining');
  const reset = response.headers.get('X-Rl-Reset') ||
                response.headers.get('Retry-After');

  if (remaining !== null) {
    rateLimitState.tokensRemaining = parseInt(remaining, 10);
    rateLimitState.lastUpdated = Date.now();
  }

  if (reset !== null) {
    // Reset can be seconds until reset or a date
    const resetValue = parseInt(reset, 10);
    if (!isNaN(resetValue)) {
      rateLimitState.resetTime = Date.now() + (resetValue * 1000);
    }
  }
}

/**
 * Check if we should preemptively throttle based on quota
 * @returns {Promise<void>}
 */
async function checkQuotaAndThrottle() {
  if (rateLimitState.tokensRemaining !== null &&
      rateLimitState.tokensRemaining < config.quotaThreshold) {
    const waitTime = rateLimitState.resetTime
      ? Math.max(0, rateLimitState.resetTime - Date.now())
      : 30000; // Default 30s wait

    console.log(`[Keepa] Quota low (${rateLimitState.tokensRemaining}), waiting ${waitTime}ms`);
    await sleep(Math.min(waitTime, 60000)); // Cap at 60s
  }
}

/**
 * Fetch ASIN data from Keepa API with retry logic
 * Supports batching up to 10 ASINs per request
 *
 * @param {string|string[]} asins - Single ASIN or array of ASINs (max 10)
 * @param {Object} options - Fetch options
 * @param {number} [options.domainId=2] - Keepa domain ID (2 = UK)
 * @param {number} [options.statsWindow=90] - Stats window in days (7, 30, or 90)
 * @param {boolean} [options.history=true] - Include price history
 * @param {number} [options.offers=20] - Number of offers to include
 * @returns {Promise<Object>} Raw Keepa response
 */
export async function fetchKeepaData(asins, options = {}) {
  if (!hasKeepaCredentials()) {
    throw new Error('Keepa API credentials not configured');
  }

  // Normalize asins to array
  const asinArray = Array.isArray(asins) ? asins : [asins];

  if (asinArray.length === 0) {
    throw new Error('At least one ASIN is required');
  }

  if (asinArray.length > config.maxBatchSize) {
    throw new Error(`Maximum ${config.maxBatchSize} ASINs per batch request`);
  }

  const {
    domainId = UK_KEEPA_DOMAIN_ID,
    statsWindow = config.defaultStatsWindow,
    history = true,
    offers = 20,
  } = options;

  const apiKey = getKeepaApiKey();

  const params = new URLSearchParams({
    key: apiKey,
    domain: domainId.toString(),
    asin: asinArray.join(','),
    stats: statsWindow.toString(),
    history: history ? '1' : '0',
    offers: offers.toString(),
  });

  let lastError = null;
  let lastStatusCode = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      // Check quota before making request
      await checkQuotaAndThrottle();

      const response = await fetch(`${KEEPA_API_BASE}/product?${params.toString()}`);

      // Parse rate limit headers
      parseRateLimitHeaders(response);

      lastStatusCode = response.status;

      if (response.status === 429) {
        // Rate limited - calculate wait time
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : calculateBackoffDelay(attempt);

        console.log(`[Keepa] Rate limited (429), attempt ${attempt + 1}/${config.maxRetries + 1}, waiting ${waitTime}ms`);

        if (attempt < config.maxRetries) {
          await sleep(waitTime);
          continue;
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Keepa API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(`Keepa API error: ${data.error.message || data.error}`);
      }

      // Log tokens remaining for monitoring
      if (rateLimitState.tokensRemaining !== null) {
        console.log(`[Keepa] Request successful, tokens remaining: ${rateLimitState.tokensRemaining}`);
      }

      return data;

    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (isRetryableError(error, lastStatusCode) && attempt < config.maxRetries) {
        const delay = calculateBackoffDelay(attempt);
        console.log(`[Keepa] Retryable error, attempt ${attempt + 1}/${config.maxRetries + 1}, waiting ${delay}ms: ${error.message}`);
        await sleep(delay);
        continue;
      }

      // Non-retryable error or max retries exceeded
      throw error;
    }
  }

  // Should not reach here, but just in case
  throw lastError || new Error('Keepa request failed after max retries');
}

/**
 * Fetch data for multiple ASINs, automatically batching into groups of 10
 *
 * @param {string[]} asins - Array of ASINs
 * @param {Object} options - Fetch options (same as fetchKeepaData)
 * @returns {Promise<Map<string, Object>>} Map of ASIN to product data
 */
export async function fetchKeepaDataBatched(asins, options = {}) {
  const results = new Map();

  // Dedupe and validate
  const uniqueAsins = [...new Set(asins.filter(a => a && typeof a === 'string'))];

  if (uniqueAsins.length === 0) {
    return results;
  }

  // Split into batches of maxBatchSize
  const batches = [];
  for (let i = 0; i < uniqueAsins.length; i += config.maxBatchSize) {
    batches.push(uniqueAsins.slice(i, i + config.maxBatchSize));
  }

  console.log(`[Keepa] Fetching ${uniqueAsins.length} ASINs in ${batches.length} batch(es)`);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    console.log(`[Keepa] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} ASINs)`);

    try {
      const response = await fetchKeepaData(batch, options);

      if (response.products && Array.isArray(response.products)) {
        for (const product of response.products) {
          if (product.asin) {
            results.set(product.asin, product);
          }
        }
      }

      // Small delay between batches to be nice to the API
      if (batchIndex < batches.length - 1) {
        await sleep(500);
      }

    } catch (error) {
      console.error(`[Keepa] Batch ${batchIndex + 1} failed: ${error.message}`);
      // Continue with other batches, mark failed ASINs
      for (const asin of batch) {
        results.set(asin, { error: error.message, failed: true });
      }
    }
  }

  return results;
}

/**
 * Check if a cached snapshot is still valid
 * @param {string} asin
 * @param {number} marketplaceId
 * @param {number} [ttlMs] - Time-to-live in milliseconds
 * @returns {Promise<Object|null>} Cached snapshot if valid, null otherwise
 */
export async function getCachedSnapshot(asin, marketplaceId, ttlMs = config.cacheTtlMs) {
  const result = await query(`
    SELECT * FROM keepa_snapshots
    WHERE asin = $1 AND marketplace_id = $2
      AND captured_at > NOW() - INTERVAL '1 millisecond' * $3
    ORDER BY captured_at DESC
    LIMIT 1
  `, [asin, marketplaceId, ttlMs]);

  return result.rows[0] || null;
}

/**
 * Check which ASINs need refresh (not in cache or expired)
 * @param {string[]} asins
 * @param {number} marketplaceId
 * @param {number} [ttlMs] - Time-to-live in milliseconds
 * @returns {Promise<string[]>} ASINs that need refresh
 */
export async function getAsinsNeedingRefresh(asins, marketplaceId, ttlMs = config.cacheTtlMs) {
  if (asins.length === 0) return [];

  const result = await query(`
    SELECT DISTINCT asin FROM keepa_snapshots
    WHERE asin = ANY($1) AND marketplace_id = $2
      AND captured_at > NOW() - INTERVAL '1 millisecond' * $3
  `, [asins, marketplaceId, ttlMs]);

  const cachedAsins = new Set(result.rows.map(r => r.asin));
  return asins.filter(asin => !cachedAsins.has(asin));
}

/**
 * Parse Keepa response into structured metrics
 * @param {Object} rawData - Raw Keepa API response
 * @param {string} [targetAsin] - Specific ASIN to extract (for batch responses)
 * @returns {Object} Parsed metrics
 */
export function parseKeepaResponse(rawData, targetAsin = null) {
  if (!rawData.products || rawData.products.length === 0) {
    return {
      found: false,
      metrics: null,
    };
  }

  // Find the target product (for batch responses)
  let product;
  if (targetAsin) {
    product = rawData.products.find(p => p.asin === targetAsin);
    if (!product) {
      return { found: false, metrics: null };
    }
  } else {
    product = rawData.products[0];
  }

  const stats = product.stats || {};
  const csv = product.csv || [];

  // Keepa price history indices:
  // 0: Amazon price, 1: New price, 2: Used price, 3: Sales rank, etc.
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

  // Guard against division by zero
  if (firstAvg === 0) return null;

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
 * Sync Keepa data for an ASIN (with caching)
 * Main entry point for SYNC_KEEPA_ASIN job
 *
 * @param {string} asin
 * @param {number} marketplaceId
 * @param {Object} options
 * @param {boolean} [options.skipCache=false] - Skip cache check and force refresh
 * @returns {Promise<Object>}
 */
export async function syncKeepaAsin(asin, marketplaceId, options = {}) {
  console.log(`[Keepa] Syncing ASIN ${asin} for marketplace ${marketplaceId}`);

  // Check cache unless skipCache is true
  if (!options.skipCache) {
    const cached = await getCachedSnapshot(asin, marketplaceId);
    if (cached) {
      console.log(`[Keepa] Using cached snapshot for ${asin} (age: ${Date.now() - new Date(cached.captured_at).getTime()}ms)`);
      return {
        asin_entity_id: cached.asin_entity_id,
        snapshot_id: cached.id,
        found: cached.parsed_json?.found ?? true,
        metrics: cached.parsed_json?.metrics,
        cached: true,
      };
    }
  }

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
    cached: false,
  };
}

/**
 * Sync Keepa data for multiple ASINs (batched)
 * Uses batching to minimize API calls
 *
 * @param {string[]} asins - Array of ASINs
 * @param {number} marketplaceId
 * @param {Object} options
 * @param {boolean} [options.skipCache=false] - Skip cache check
 * @returns {Promise<Map<string, Object>>} Map of ASIN to sync result
 */
export async function syncKeepaAsinsBatched(asins, marketplaceId, options = {}) {
  const results = new Map();

  if (asins.length === 0) {
    return results;
  }

  console.log(`[Keepa] Batch syncing ${asins.length} ASINs for marketplace ${marketplaceId}`);

  // Check which ASINs need refresh (not in cache)
  let asinsToFetch = asins;
  if (!options.skipCache) {
    asinsToFetch = await getAsinsNeedingRefresh(asins, marketplaceId);
    console.log(`[Keepa] ${asins.length - asinsToFetch.length} ASINs served from cache, ${asinsToFetch.length} need fetch`);

    // Get cached results
    for (const asin of asins) {
      if (!asinsToFetch.includes(asin)) {
        const cached = await getCachedSnapshot(asin, marketplaceId);
        if (cached) {
          results.set(asin, {
            asin_entity_id: cached.asin_entity_id,
            snapshot_id: cached.id,
            found: cached.parsed_json?.found ?? true,
            metrics: cached.parsed_json?.metrics,
            cached: true,
          });
        }
      }
    }
  }

  // Fetch remaining ASINs in batches
  if (asinsToFetch.length > 0 && hasKeepaCredentials()) {
    const fetchResults = await fetchKeepaDataBatched(asinsToFetch);

    // Process and save each result
    for (const [asin, productData] of fetchResults) {
      try {
        if (productData.failed) {
          results.set(asin, { error: productData.error, failed: true });
          continue;
        }

        // Create raw data structure
        const rawData = { products: [productData] };
        const parsedData = parseKeepaResponse(rawData);

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

        results.set(asin, {
          asin_entity_id: asinEntity.id,
          snapshot_id: snapshot.id,
          found: parsedData.found,
          metrics: parsedData.metrics,
          cached: false,
        });

      } catch (error) {
        console.error(`[Keepa] Error saving ${asin}: ${error.message}`);
        results.set(asin, { error: error.message, failed: true });
      }
    }
  } else if (asinsToFetch.length > 0) {
    // No credentials - stub mode
    console.log('[Keepa] No API key - using stub data for remaining ASINs');
    for (const asin of asinsToFetch) {
      results.set(asin, { found: false, metrics: null, stub: true });
    }
  }

  return results;
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

/**
 * Get rate limit status for monitoring
 * @returns {Object} Current rate limit state
 */
export function getRateLimitStatus() {
  return {
    tokensRemaining: rateLimitState.tokensRemaining,
    resetTime: rateLimitState.resetTime,
    lastUpdated: rateLimitState.lastUpdated,
  };
}

/**
 * Get Keepa service configuration
 * @returns {Object} Current configuration
 */
export function getConfig() {
  return { ...config };
}

export default {
  fetchKeepaData,
  fetchKeepaDataBatched,
  parseKeepaResponse,
  saveKeepaSnapshot,
  getOrCreateAsinEntity,
  syncKeepaAsin,
  syncKeepaAsinsBatched,
  getLatestKeepaSnapshot,
  getKeepaSnapshotHistory,
  getCachedSnapshot,
  getAsinsNeedingRefresh,
  getRateLimitStatus,
  getConfig,
};
