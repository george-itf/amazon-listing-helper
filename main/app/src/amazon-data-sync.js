/**
 * Amazon Data Sync Service
 * Comprehensive data fetching from ALL available Amazon SP-API endpoints
 *
 * J.1-J.6 FIX: Improved rate limiting, timeouts, error handling, and config
 *
 * Supported APIs:
 * - Reports API (listings, inventory, orders, sales)
 * - Orders API (real-time order data)
 * - Product Pricing API (competitive pricing, offers)
 * - Product Fees API (FBA fee estimates)
 * - FBA Inventory API (inventory summaries)
 * - Catalog Items API (product details)
 * - Finances API (financial events)
 */

import SellingPartner from 'amazon-sp-api';
import { getSpApiClientConfig, hasSpApiCredentials, getDefaultMarketplaceId, getSellerId } from './credentials-provider.js';
import { query, transaction } from './database/connection.js';
import { syncListings } from './listings-sync.js';
import { safeFetch } from './lib/safe-fetch.js';
import { createChildLogger } from './lib/logger.js';

// J.5 FIX: Structured logging
const syncLogger = createChildLogger({ service: 'amazon-sync' });

// J.6 FIX: Centralized sync configuration
const SYNC_CONFIG = {
  // Rate limiting delays (ms)
  delays: {
    pagination: parseInt(process.env.SYNC_PAGINATION_DELAY_MS, 10) || 500,
    perItem: parseInt(process.env.SYNC_PER_ITEM_DELAY_MS, 10) || 200,
    batchDelay: parseInt(process.env.SYNC_BATCH_DELAY_MS, 10) || 1000,
    reportPoll: parseInt(process.env.SYNC_REPORT_POLL_DELAY_MS, 10) || 5000,
  },
  // J.2 FIX: Report timeout (15 minutes default, env configurable)
  reportTimeoutMs: parseInt(process.env.SYNC_REPORT_TIMEOUT_MS, 10) || 900000,
  // Batch sizes
  batchSizes: {
    pricing: 20,  // API limit for competitive pricing
    orderItems: 50, // Batch for order items upsert
  },
};

// J.1 FIX: Centralized rate limiter for SP-API calls
class SpApiRateLimiter {
  constructor() {
    // Rate limits per endpoint (requests per second)
    this.limits = {
      orders: { rps: 0.5, lastCall: 0 },       // 1 request per 2 seconds
      fbaInventory: { rps: 2, lastCall: 0 },   // 2 requests per second
      productPricing: { rps: 0.5, lastCall: 0 }, // Rate-limited endpoint
      productFees: { rps: 1, lastCall: 0 },
      catalogItems: { rps: 2, lastCall: 0 },
      finances: { rps: 0.5, lastCall: 0 },
      reports: { rps: 0.25, lastCall: 0 },     // Very rate-limited
      default: { rps: 1, lastCall: 0 },
    };
    this.pendingRequests = new Map();
  }

  async waitForSlot(endpoint) {
    const config = this.limits[endpoint] || this.limits.default;
    const minInterval = 1000 / config.rps;
    const now = Date.now();
    const timeSinceLastCall = now - config.lastCall;

    if (timeSinceLastCall < minInterval) {
      const waitTime = minInterval - timeSinceLastCall;
      syncLogger.debug({ endpoint, waitTime }, 'Rate limiting - waiting');
      await sleep(waitTime);
    }

    config.lastCall = Date.now();
  }

  async execute(endpoint, operation, fn) {
    await this.waitForSlot(endpoint);

    try {
      const result = await fn();
      return result;
    } catch (error) {
      // Handle throttling errors with exponential backoff
      if (error.code === 'QuotaExceeded' || error.statusCode === 429) {
        const retryAfter = parseInt(error.headers?.['x-amzn-ratelimit-limit'], 10) || 2000;
        syncLogger.warn({ endpoint, operation, retryAfter }, 'Rate limited - backing off');
        await sleep(retryAfter);
        return fn(); // Retry once
      }
      throw error;
    }
  }
}

const rateLimiter = new SpApiRateLimiter();

/**
 * Create SP-API client
 */
function getSpClient() {
  if (!hasSpApiCredentials()) {
    return null;
  }

  const config = getSpApiClientConfig();
  return new SellingPartner({
    region: config.region,
    refresh_token: config.refresh_token,
    credentials: config.credentials,
    options: {
      ...config.options,
      debug_log: true,
    },
  });
}

// ============================================================================
// ORDERS API - Real-time order data
// ============================================================================

/**
 * Sync recent orders from Amazon
 * @param {number} daysBack - Number of days to fetch (default 30)
 * @returns {Promise<Object>} Sync results
 */
export async function syncOrders(daysBack = 30) {
  const sp = getSpClient();
  if (!sp) throw new Error('SP-API not configured');

  // J.5 FIX: Structured logging
  syncLogger.info({ daysBack }, 'Syncing orders');

  const marketplaceId = getDefaultMarketplaceId();
  const createdAfter = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  let orders = [];
  let nextToken = null;

  do {
    const params = {
      operation: 'getOrders',
      endpoint: 'orders',
      query: {
        MarketplaceIds: marketplaceId,
        CreatedAfter: createdAfter,
        ...(nextToken && { NextToken: nextToken }),
      },
    };

    // J.1 FIX: Use centralized rate limiter
    const response = await rateLimiter.execute('orders', 'getOrders', () =>
      sp.callAPI(params)
    );

    if (response.Orders) {
      orders = orders.concat(response.Orders);
    }

    nextToken = response.NextToken;
    syncLogger.debug({ orderCount: orders.length }, 'Fetched orders page');

    // J.6 FIX: Use centralized delay config
    if (nextToken) await sleep(SYNC_CONFIG.delays.pagination);
  } while (nextToken);

  syncLogger.info({ totalOrders: orders.length }, 'Total orders fetched');

  // Save to database using batch upsert (eliminates N+1)
  let saved = 0;
  try {
    saved = await batchUpsertOrders(orders);
    syncLogger.info({ saved }, 'Batch upserted orders');
  } catch (error) {
    // J.5 FIX: Structured error logging
    syncLogger.warn({ err: error }, 'Batch upsert failed, falling back to sequential');
    // Fallback to individual upserts if batch fails
    for (const order of orders) {
      try {
        await upsertOrder(order);
        saved++;
      } catch (err) {
        syncLogger.error({ err, orderId: order.AmazonOrderId }, 'Error saving order');
      }
    }
  }

  return {
    success: true,
    orders_fetched: orders.length,
    orders_saved: saved,
    days_back: daysBack,
  };
}

/**
 * Get order items for specific orders
 * J.3 FIX: Batch insert order items to eliminate N+1
 */
export async function syncOrderItems(orderIds) {
  const sp = getSpClient();
  if (!sp) throw new Error('SP-API not configured');

  syncLogger.info({ orderCount: orderIds.length }, 'Fetching order items');

  // J.3 FIX: Collect all items first, then batch insert
  const allItems = [];

  for (const orderId of orderIds) {
    try {
      // J.1 FIX: Use centralized rate limiter
      const response = await rateLimiter.execute('orders', 'getOrderItems', () =>
        sp.callAPI({
          operation: 'getOrderItems',
          endpoint: 'orders',
          path: { orderId },
        })
      );

      if (response.OrderItems) {
        for (const item of response.OrderItems) {
          allItems.push({ orderId, item });
        }
      }

      // J.6 FIX: Use centralized delay config
      await sleep(SYNC_CONFIG.delays.perItem);
    } catch (error) {
      // J.5 FIX: Structured error logging
      syncLogger.error({ err: error, orderId }, 'Error fetching items for order');
    }
  }

  // J.3 FIX: Batch upsert all collected items
  let saved = 0;
  try {
    if (allItems.length > 0) {
      saved = await batchUpsertOrderItems(allItems);
      syncLogger.info({ saved, total: allItems.length }, 'Batch upserted order items');
    }
  } catch (error) {
    // Fallback to sequential inserts if batch fails
    syncLogger.warn({ err: error }, 'Batch upsert failed, falling back to sequential');
    for (const { orderId, item } of allItems) {
      try {
        await upsertOrderItem(orderId, item);
        saved++;
      } catch (err) {
        syncLogger.error({ err, orderId, orderItemId: item.OrderItemId }, 'Error saving order item');
      }
    }
  }

  return { items_synced: saved };
}

// ============================================================================
// FBA INVENTORY API - Inventory levels and health
// ============================================================================

/**
 * Sync FBA inventory summaries
 */
export async function syncFbaInventory() {
  const sp = getSpClient();
  if (!sp) throw new Error('SP-API not configured');

  syncLogger.info('Syncing FBA inventory');

  const marketplaceId = getDefaultMarketplaceId();
  let inventoryItems = [];
  let nextToken = null;

  do {
    const params = {
      operation: 'getInventorySummaries',
      endpoint: 'fbaInventory',
      query: {
        details: true,
        granularityType: 'Marketplace',
        granularityId: marketplaceId,
        marketplaceIds: marketplaceId,
        ...(nextToken && { nextToken }),
      },
    };

    // J.1 FIX: Use centralized rate limiter
    const response = await rateLimiter.execute('fbaInventory', 'getInventorySummaries', () =>
      sp.callAPI(params)
    );

    if (response.inventorySummaries) {
      inventoryItems = inventoryItems.concat(response.inventorySummaries);
    }

    nextToken = response.pagination?.nextToken;
    syncLogger.debug({ itemCount: inventoryItems.length }, 'Fetched inventory page');

    // J.6 FIX: Use centralized delay config
    if (nextToken) await sleep(SYNC_CONFIG.delays.pagination);
  } while (nextToken);

  // Save to database using batch upsert (eliminates N+1)
  let saved = 0;
  try {
    saved = await batchUpsertFbaInventory(inventoryItems);
    syncLogger.info({ saved }, 'Batch upserted inventory items');
  } catch (error) {
    syncLogger.warn({ err: error }, 'Batch upsert failed, falling back to sequential');
    for (const item of inventoryItems) {
      try {
        await upsertFbaInventory(item);
        saved++;
      } catch (err) {
        syncLogger.error({ err, sku: item.sellerSku }, 'Error saving inventory');
      }
    }
  }

  return {
    success: true,
    items_fetched: inventoryItems.length,
    items_saved: saved,
  };
}

// ============================================================================
// PRODUCT PRICING API - Competitive pricing and offers
// ============================================================================

/**
 * Sync competitive pricing for all ASINs
 */
export async function syncCompetitivePricing() {
  const sp = getSpClient();
  if (!sp) throw new Error('SP-API not configured');

  syncLogger.info('Syncing competitive pricing');

  // Get all ASINs from listings
  const listingsResult = await query('SELECT DISTINCT asin FROM listings WHERE asin IS NOT NULL');
  const asins = listingsResult.rows.map(r => r.asin).filter(Boolean);

  if (asins.length === 0) {
    return { success: true, message: 'No ASINs to fetch pricing for' };
  }

  const marketplaceId = getDefaultMarketplaceId();
  let saved = 0;

  // J.6 FIX: Use centralized batch size config
  const batchSize = SYNC_CONFIG.batchSizes.pricing;
  for (let i = 0; i < asins.length; i += batchSize) {
    const batch = asins.slice(i, i + batchSize);

    try {
      // J.1 FIX: Use centralized rate limiter
      const response = await rateLimiter.execute('productPricing', 'getCompetitivePricing', () =>
        sp.callAPI({
          operation: 'getCompetitivePricing',
          endpoint: 'productPricing',
          query: {
            MarketplaceId: marketplaceId,
            Asins: batch,
            ItemType: 'Asin',
          },
        })
      );

      if (response && Array.isArray(response)) {
        // Batch upsert all items from this API call
        const batchSaved = await batchUpsertCompetitivePricing(response);
        saved += batchSaved;
      }

      syncLogger.debug({ processed: Math.min(i + batchSize, asins.length), total: asins.length }, 'Processed pricing batch');
      // J.6 FIX: Use centralized delay config
      await sleep(SYNC_CONFIG.delays.batchDelay);
    } catch (error) {
      syncLogger.error({ err: error, batchStart: i }, 'Error fetching pricing batch');
    }
  }

  return {
    success: true,
    asins_processed: asins.length,
    pricing_saved: saved,
  };
}

/**
 * Sync listing offers (other sellers' prices)
 *
 * @param {Object} [options] - Optional parameters
 * @param {string[]} [options.asins] - Specific ASINs to sync (if omitted, syncs all ASINs from listings table)
 * @returns {Promise<Object>} Sync results with asins_checked, offers_saved, and mode
 */
export async function syncListingOffers(options = {}) {
  const sp = getSpClient();
  if (!sp) throw new Error('SP-API not configured');

  // Determine ASIN list: use provided override or fetch all from listings
  let asins;
  let mode = 'global';

  if (options.asins && Array.isArray(options.asins) && options.asins.length > 0) {
    // Targeted sync - use provided ASINs
    asins = [...new Set(options.asins.filter(Boolean))]; // Dedupe and filter nulls
    mode = 'targeted';
    syncLogger.info({ asinCount: asins.length, mode }, 'Syncing listing offers (targeted)');
  } else {
    // Global sync - fetch all ASINs from listings
    const listingsResult = await query('SELECT DISTINCT asin FROM listings WHERE asin IS NOT NULL');
    asins = listingsResult.rows.map(r => r.asin).filter(Boolean);
    syncLogger.info({ asinCount: asins.length, mode }, 'Syncing listing offers (global)');
  }

  if (asins.length === 0) {
    return {
      success: true,
      asins_checked: 0,
      offers_saved: 0,
      mode,
      message: 'No ASINs to sync',
    };
  }

  const marketplaceId = getDefaultMarketplaceId();
  let totalOffers = 0;

  for (const asin of asins) {
    try {
      // J.1 FIX: Use centralized rate limiter
      const response = await rateLimiter.execute('productPricing', 'getItemOffers', () =>
        sp.callAPI({
          operation: 'getItemOffers',
          endpoint: 'productPricing',
          path: { Asin: asin },
          query: {
            MarketplaceId: marketplaceId,
            ItemCondition: 'New',
          },
        })
      );

      if (response?.Offers) {
        for (const offer of response.Offers) {
          await upsertListingOffer(asin, offer);
          totalOffers++;
        }
      }

      // J.6 FIX: Use centralized delay config
      await sleep(SYNC_CONFIG.delays.perItem);
    } catch (error) {
      // J.5 FIX: Structured logging for skipped items
      syncLogger.debug({ asin, err: error.message }, 'Skipped offers for ASIN');
    }
  }

  return {
    success: true,
    asins_checked: asins.length,
    offers_saved: totalOffers,
    mode,
    ...(mode === 'targeted' && { target_asins: asins }),
  };
}

// ============================================================================
// PRODUCT FEES API - FBA fee estimates
// ============================================================================

/**
 * Sync FBA fee estimates for all SKUs
 */
export async function syncFbaFees() {
  const sp = getSpClient();
  if (!sp) throw new Error('SP-API not configured');

  syncLogger.info('Syncing FBA fee estimates');

  // Get all listings with prices
  const listingsResult = await query(`
    SELECT seller_sku, asin, price_inc_vat
    FROM listings
    WHERE price_inc_vat > 0 AND seller_sku IS NOT NULL
  `);

  const marketplaceId = getDefaultMarketplaceId();
  let saved = 0;

  for (const listing of listingsResult.rows) {
    try {
      // J.1 FIX: Use centralized rate limiter
      const response = await rateLimiter.execute('productFees', 'getMyFeesEstimateForSKU', () =>
        sp.callAPI({
          operation: 'getMyFeesEstimateForSKU',
          endpoint: 'productFees',
          path: { SellerSKU: listing.seller_sku },
          body: {
            FeesEstimateRequest: {
              MarketplaceId: marketplaceId,
              PriceToEstimateFees: {
                ListingPrice: {
                  CurrencyCode: 'GBP',
                  Amount: parseFloat(listing.price_inc_vat),
                },
              },
              Identifier: listing.seller_sku,
              IsAmazonFulfilled: true,
            },
          },
        })
      );

      if (response?.FeesEstimateResult) {
        await upsertFbaFeeEstimate(listing.seller_sku, response.FeesEstimateResult);
        saved++;
      }

      // J.6 FIX: Use centralized delay config
      await sleep(SYNC_CONFIG.delays.perItem);
    } catch (error) {
      syncLogger.debug({ sku: listing.seller_sku, err: error.message }, 'Skipped fees for SKU');
    }
  }

  return {
    success: true,
    skus_processed: listingsResult.rows.length,
    fees_saved: saved,
  };
}

// ============================================================================
// REPORTS API - Bulk data reports
// ============================================================================

/**
 * Request and download a report
 */
async function requestAndDownloadReport(sp, reportType, options = {}) {
  const marketplaceId = getDefaultMarketplaceId();

  // Request the report
  const createResponse = await sp.callAPI({
    operation: 'createReport',
    endpoint: 'reports',
    body: {
      reportType,
      marketplaceIds: [marketplaceId],
      ...options,
    },
  });

  const reportId = createResponse.reportId;
  syncLogger.info({ reportType, reportId }, 'Report requested');

  // J.2 FIX: Wait for completion with configurable timeout (15 minutes default)
  const maxWait = SYNC_CONFIG.reportTimeoutMs;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    // J.1 FIX: Use centralized rate limiter
    const report = await rateLimiter.execute('reports', 'getReport', () =>
      sp.callAPI({
        operation: 'getReport',
        endpoint: 'reports',
        path: { reportId },
      })
    );

    if (report.processingStatus === 'DONE') {
      // Download document
      const document = await rateLimiter.execute('reports', 'getReportDocument', () =>
        sp.callAPI({
          operation: 'getReportDocument',
          endpoint: 'reports',
          path: { reportDocumentId: report.reportDocumentId },
        })
      );

      // Download with SSRF protection
      const response = await safeFetch(document.url, {
        timeout: 60000,  // 60s for large reports
        maxSize: 100 * 1024 * 1024,  // 100MB
      });
      return await response.text();
    } else if (report.processingStatus === 'CANCELLED' || report.processingStatus === 'FATAL') {
      syncLogger.error({ reportId, status: report.processingStatus }, 'Report failed');
      throw new Error(`Report failed: ${report.processingStatus}`);
    }

    await sleep(SYNC_CONFIG.delays.reportPoll);
  }

  syncLogger.error({ reportId, timeoutMs: maxWait }, 'Report timed out');
  throw new Error(`Report timed out after ${maxWait / 1000} seconds`);
}

/**
 * Sync FBA inventory report (aged inventory, planning data)
 */
export async function syncFbaInventoryReport() {
  const sp = getSpClient();
  if (!sp) throw new Error('SP-API not configured');

  syncLogger.info('Requesting FBA inventory report');

  try {
    const content = await requestAndDownloadReport(sp, 'GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA');
    const items = parseTsvReport(content);

    let saved = 0;
    for (const item of items) {
      try {
        await upsertFbaInventoryReport(item);
        saved++;
      } catch (error) {
        syncLogger.error({ err: error }, 'Error saving inventory item');
      }
    }

    return {
      success: true,
      items_fetched: items.length,
      items_saved: saved,
    };
  } catch (error) {
    syncLogger.error({ err: error }, 'FBA inventory report failed');
    throw error;
  }
}

/**
 * !IMPORTANT! DO NOT USE - Sales & Traffic Report (GET_SALES_AND_TRAFFIC_REPORT)
 *
 * This function has been REMOVED because the Amazon SP-API Sales & Traffic Report
 * (GET_SALES_AND_TRAFFIC_REPORT) requires Brand Analytics permissions that are NOT
 * available for this account.
 *
 * !IMPORTANT! Claude Code: NEVER attempt to re-implement this function or use
 * GET_SALES_AND_TRAFFIC_REPORT, salesAndTrafficByAsin, or the amazon_sales_traffic table.
 * These require Brand Analytics seller permissions we do not have access to.
 *
 * Alternative data sources for traffic/buy box data:
 * - Use syncListingOffers() for buy box status
 * - Use syncCompetitivePricing() for competitive pricing data
 * - Use syncOrders() for actual sales data
 */

/**
 * Sync all orders report (historical)
 */
export async function syncOrdersReport(daysBack = 30) {
  const sp = getSpClient();
  if (!sp) throw new Error('SP-API not configured');

  syncLogger.info({ daysBack }, 'Requesting orders report');

  const endDate = new Date();
  const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  try {
    const content = await requestAndDownloadReport(sp, 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE', {
      dataStartTime: startDate.toISOString(),
      dataEndTime: endDate.toISOString(),
    });

    const orders = parseTsvReport(content);

    let saved = 0;
    for (const order of orders) {
      try {
        await upsertOrderFromReport(order);
        saved++;
      } catch (error) {
        syncLogger.error({ err: error }, 'Error saving order');
      }
    }

    return {
      success: true,
      orders_fetched: orders.length,
      orders_saved: saved,
    };
  } catch (error) {
    syncLogger.error({ err: error }, 'Orders report failed');
    throw error;
  }
}

// ============================================================================
// FINANCES API - Financial events
// ============================================================================

/**
 * Sync financial events (settlements, refunds, fees)
 * J.4 FIX: Added idempotency via unique constraint on (event_type, amazon_order_id, posted_date)
 */
export async function syncFinancialEvents(daysBack = 30) {
  const sp = getSpClient();
  if (!sp) throw new Error('SP-API not configured');

  syncLogger.info({ daysBack }, 'Syncing financial events');

  const postedAfter = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  let events = [];
  let nextToken = null;

  do {
    const params = {
      operation: 'listFinancialEvents',
      endpoint: 'finances',
      query: {
        PostedAfter: postedAfter,
        ...(nextToken && { NextToken: nextToken }),
      },
    };

    // J.1 FIX: Use centralized rate limiter
    const response = await rateLimiter.execute('finances', 'listFinancialEvents', () =>
      sp.callAPI(params)
    );

    if (response.FinancialEvents) {
      events.push(response.FinancialEvents);
    }

    nextToken = response.NextToken;
    // J.6 FIX: Use centralized delay config
    if (nextToken) await sleep(SYNC_CONFIG.delays.pagination);
  } while (nextToken);

  // Save to database with idempotency
  let saved = 0;
  let duplicatesSkipped = 0;
  for (const eventGroup of events) {
    try {
      const result = await upsertFinancialEvents(eventGroup);
      saved += result.saved;
      duplicatesSkipped += result.duplicates;
    } catch (error) {
      syncLogger.error({ err: error }, 'Error saving financial events');
    }
  }

  syncLogger.info({ saved, duplicatesSkipped }, 'Financial events sync complete');

  return {
    success: true,
    event_groups_fetched: events.length,
    events_saved: saved,
    duplicates_skipped: duplicatesSkipped,
  };
}

// ============================================================================
// CATALOG ITEMS API - Product details
// ============================================================================

/**
 * Sync catalog data for ASINs
 *
 * @param {Object} [options] - Optional parameters
 * @param {string[]} [options.asins] - Specific ASINs to sync (if omitted, syncs all ASINs from listings table)
 * @returns {Promise<Object>} Sync results with asins_processed, items_saved, and mode
 */
export async function syncCatalogItems(options = {}) {
  const sp = getSpClient();
  if (!sp) throw new Error('SP-API not configured');

  // Determine ASIN list: use provided override or fetch all from listings
  let asins;
  let mode = 'global';

  if (options.asins && Array.isArray(options.asins) && options.asins.length > 0) {
    // Targeted sync - use provided ASINs
    asins = [...new Set(options.asins.filter(Boolean))]; // Dedupe and filter nulls
    mode = 'targeted';
    syncLogger.info({ asinCount: asins.length, mode }, 'Syncing catalog items (targeted)');
  } else {
    // Global sync - fetch all ASINs from listings
    const listingsResult = await query('SELECT DISTINCT asin FROM listings WHERE asin IS NOT NULL');
    asins = listingsResult.rows.map(r => r.asin).filter(Boolean);
    syncLogger.info({ asinCount: asins.length, mode }, 'Syncing catalog items (global)');
  }

  if (asins.length === 0) {
    return {
      success: true,
      asins_processed: 0,
      items_saved: 0,
      mode,
      message: 'No ASINs to sync',
    };
  }

  const marketplaceId = getDefaultMarketplaceId();
  let saved = 0;

  for (const asin of asins) {
    try {
      // J.1 FIX: Use centralized rate limiter
      const response = await rateLimiter.execute('catalogItems', 'getCatalogItem', () =>
        sp.callAPI({
          operation: 'getCatalogItem',
          endpoint: 'catalogItems',
          path: { asin },
          query: {
            marketplaceIds: marketplaceId,
            includedData: 'attributes,dimensions,identifiers,images,productTypes,salesRanks,summaries',
          },
        })
      );

      if (response) {
        await upsertCatalogItem(asin, response);
        saved++;
      }

      // J.6 FIX: Use centralized delay config
      await sleep(SYNC_CONFIG.delays.pagination);
    } catch (error) {
      syncLogger.debug({ asin, err: error.message }, 'Skipped catalog for ASIN');
    }
  }

  return {
    success: true,
    asins_processed: asins.length,
    items_saved: saved,
    mode,
    ...(mode === 'targeted' && { target_asins: asins }),
  };
}

// ============================================================================
// MASTER SYNC - Sync everything
// ============================================================================

/**
 * Sync ALL available Amazon data
 * Uses parallel execution where possible for better performance.
 *
 * Sync order:
 * 1. Listings (must be first - provides base data)
 * 2. Parallel batch 1: FBA Inventory, Orders, Financial Events (independent API endpoints)
 * 3. Parallel batch 2: Competitive Pricing, FBA Fees, Catalog Items
 * 4. Listing Offers (last - most API intensive, separate rate limit bucket)
 *
 * !IMPORTANT! Sales & Traffic sync is NOT available - requires Brand Analytics permissions
 *
 * @returns {Promise<Object>} Combined results from all syncs
 */
export async function syncAll() {
  const results = {
    started_at: new Date().toISOString(),
    syncs: {},
    errors: [],
  };

  // J.5 FIX: Structured logging throughout
  syncLogger.info('Starting full Amazon data sync (parallelized)');

  // Phase 0: Listings Report (core data - MUST sync first)
  try {
    syncLogger.info({ phase: 0 }, 'Syncing Listings from Report');
    const listingsResult = await syncListings();
    results.syncs.listings = {
      success: true,
      listings_processed: listingsResult.listingsProcessed,
      listings_created: listingsResult.listingsCreated,
      listings_updated: listingsResult.listingsUpdated,
    };
  } catch (error) {
    syncLogger.error({ err: error, sync: 'listings' }, 'Listings sync failed');
    results.errors.push({ sync: 'listings', error: error.message });
  }

  // Phase 1: Parallel - Independent API endpoints
  syncLogger.info({ phase: 1 }, 'Parallel: FBA Inventory, Orders, Financial Events');
  const phase1Results = await Promise.allSettled([
    syncFbaInventory().then(r => ({ name: 'fba_inventory', result: r })),
    syncOrders(30).then(r => ({ name: 'orders', result: r })),
    syncFinancialEvents(30).then(r => ({ name: 'financial_events', result: r })),
  ]);

  for (const outcome of phase1Results) {
    if (outcome.status === 'fulfilled') {
      results.syncs[outcome.value.name] = outcome.value.result;
    } else {
      const syncName = outcome.reason?.name || 'unknown';
      syncLogger.error({ err: outcome.reason, sync: syncName }, 'Sync failed');
      results.errors.push({ sync: syncName, error: outcome.reason?.message || String(outcome.reason) });
    }
  }

  // Phase 2: Parallel - Syncs that query listings table + reports
  // !IMPORTANT! Sales & Traffic sync removed - requires Brand Analytics permissions we don't have
  syncLogger.info({ phase: 2 }, 'Parallel: Pricing, Fees, Catalog');
  const phase2Results = await Promise.allSettled([
    syncCompetitivePricing().then(r => ({ name: 'competitive_pricing', result: r })),
    syncFbaFees().then(r => ({ name: 'fba_fees', result: r })),
    syncCatalogItems().then(r => ({ name: 'catalog_items', result: r })),
  ]);

  for (const outcome of phase2Results) {
    if (outcome.status === 'fulfilled') {
      results.syncs[outcome.value.name] = outcome.value.result;
    } else {
      const syncName = outcome.reason?.name || 'unknown';
      syncLogger.error({ err: outcome.reason, sync: syncName }, 'Sync failed');
      results.errors.push({ sync: syncName, error: outcome.reason?.message || String(outcome.reason) });
    }
  }

  // Phase 3: Listing Offers (most API intensive - run alone to avoid rate limits)
  syncLogger.info({ phase: 3 }, 'Listing Offers');
  try {
    results.syncs.listing_offers = await syncListingOffers();
  } catch (error) {
    syncLogger.error({ err: error, sync: 'listing_offers' }, 'Listing offers sync failed');
    results.errors.push({ sync: 'listing_offers', error: error.message });
  }

  results.completed_at = new Date().toISOString();
  results.success = results.errors.length === 0;

  const successCount = Object.keys(results.syncs).length;
  const totalCount = successCount + results.errors.length;

  syncLogger.info({ successCount, totalCount, success: results.success }, 'Full sync complete');

  return results;
}

// ============================================================================
// DATABASE HELPERS
// ============================================================================

/**
 * Ensure all required tables exist
 */
export async function ensureTables() {
  syncLogger.info('Ensuring database tables exist');

  // Amazon Orders table
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_orders (
      id SERIAL PRIMARY KEY,
      amazon_order_id VARCHAR(50) UNIQUE NOT NULL,
      seller_order_id VARCHAR(50),
      purchase_date TIMESTAMP,
      order_status VARCHAR(50),
      fulfillment_channel VARCHAR(20),
      sales_channel VARCHAR(50),
      ship_service_level VARCHAR(50),
      order_total_amount DECIMAL(12,2),
      order_total_currency VARCHAR(10),
      number_of_items_shipped INTEGER,
      number_of_items_unshipped INTEGER,
      buyer_email VARCHAR(255),
      buyer_name VARCHAR(255),
      shipping_address_json JSONB,
      raw_json JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Amazon Order Items table
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_order_items (
      id SERIAL PRIMARY KEY,
      amazon_order_id VARCHAR(50) NOT NULL,
      order_item_id VARCHAR(50) UNIQUE NOT NULL,
      asin VARCHAR(20),
      seller_sku VARCHAR(100),
      title TEXT,
      quantity_ordered INTEGER,
      quantity_shipped INTEGER,
      item_price_amount DECIMAL(12,2),
      item_price_currency VARCHAR(10),
      item_tax_amount DECIMAL(12,2),
      promotion_discount_amount DECIMAL(12,2),
      raw_json JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // FBA Inventory table
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_fba_inventory (
      id SERIAL PRIMARY KEY,
      seller_sku VARCHAR(100) UNIQUE NOT NULL,
      asin VARCHAR(20),
      fn_sku VARCHAR(50),
      product_name TEXT,
      condition VARCHAR(50),
      fulfillable_quantity INTEGER,
      inbound_working_quantity INTEGER,
      inbound_shipped_quantity INTEGER,
      inbound_receiving_quantity INTEGER,
      reserved_quantity INTEGER,
      unfulfillable_quantity INTEGER,
      researching_quantity INTEGER,
      total_quantity INTEGER,
      raw_json JSONB,
      captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Competitive Pricing table
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_competitive_pricing (
      id SERIAL PRIMARY KEY,
      asin VARCHAR(20) NOT NULL,
      marketplace_id VARCHAR(20),
      competitive_price_amount DECIMAL(12,2),
      competitive_price_currency VARCHAR(10),
      competitive_price_condition VARCHAR(50),
      landed_price_amount DECIMAL(12,2),
      listing_price_amount DECIMAL(12,2),
      shipping_amount DECIMAL(12,2),
      number_of_offer_listings INTEGER,
      trade_in_value_amount DECIMAL(12,2),
      sales_rank INTEGER,
      sales_rank_category VARCHAR(255),
      raw_json JSONB,
      captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(asin, marketplace_id)
    )
  `);

  // Listing Offers table (competitor prices)
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_listing_offers (
      id SERIAL PRIMARY KEY,
      asin VARCHAR(20) NOT NULL,
      seller_id VARCHAR(50),
      is_buy_box_winner BOOLEAN,
      is_featured_merchant BOOLEAN,
      is_fulfilled_by_amazon BOOLEAN,
      listing_price_amount DECIMAL(12,2),
      listing_price_currency VARCHAR(10),
      shipping_amount DECIMAL(12,2),
      landed_price_amount DECIMAL(12,2),
      condition_type VARCHAR(50),
      condition_sub_type VARCHAR(50),
      feedback_rating DECIMAL(3,1),
      feedback_count INTEGER,
      ships_from VARCHAR(100),
      raw_json JSONB,
      captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // FBA Fee Estimates table
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_fba_fees (
      id SERIAL PRIMARY KEY,
      seller_sku VARCHAR(100) NOT NULL,
      asin VARCHAR(20),
      marketplace_id VARCHAR(20),
      price_to_estimate DECIMAL(12,2),
      total_fees_estimate DECIMAL(12,2),
      fee_currency VARCHAR(10),
      referral_fee DECIMAL(12,2),
      variable_closing_fee DECIMAL(12,2),
      per_item_fee DECIMAL(12,2),
      fba_fees DECIMAL(12,2),
      fba_pick_pack DECIMAL(12,2),
      fba_weight_handling DECIMAL(12,2),
      fba_order_handling DECIMAL(12,2),
      raw_json JSONB,
      captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(seller_sku, marketplace_id)
    )
  `);

  // !IMPORTANT! amazon_sales_traffic table REMOVED
  // The Sales & Traffic Report (GET_SALES_AND_TRAFFIC_REPORT) requires Brand Analytics
  // permissions that are NOT available for this account. Do NOT recreate this table
  // or attempt to use Sales & Traffic data.

  // Financial Events table
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_financial_events (
      id SERIAL PRIMARY KEY,
      event_group_id VARCHAR(100),
      event_type VARCHAR(100) NOT NULL,
      amazon_order_id VARCHAR(50),
      seller_order_id VARCHAR(50),
      posted_date TIMESTAMP,
      marketplace_id VARCHAR(20),
      transaction_type VARCHAR(50),
      amount DECIMAL(12,2),
      currency VARCHAR(10),
      asin VARCHAR(20),
      seller_sku VARCHAR(100),
      quantity INTEGER,
      raw_json JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Catalog Items table
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_catalog_items (
      id SERIAL PRIMARY KEY,
      asin VARCHAR(20) UNIQUE NOT NULL,
      marketplace_id VARCHAR(20),
      title TEXT,
      brand VARCHAR(255),
      color VARCHAR(100),
      size VARCHAR(100),
      manufacturer VARCHAR(255),
      model_number VARCHAR(100),
      part_number VARCHAR(100),
      product_type VARCHAR(100),
      item_dimensions_json JSONB,
      package_dimensions_json JSONB,
      images_json JSONB,
      sales_ranks_json JSONB,
      attributes_json JSONB,
      raw_json JSONB,
      captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes
  await query('CREATE INDEX IF NOT EXISTS idx_amazon_orders_date ON amazon_orders(purchase_date)');
  await query('CREATE INDEX IF NOT EXISTS idx_amazon_orders_status ON amazon_orders(order_status)');
  await query('CREATE INDEX IF NOT EXISTS idx_amazon_order_items_order ON amazon_order_items(amazon_order_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_amazon_order_items_sku ON amazon_order_items(seller_sku)');
  await query('CREATE INDEX IF NOT EXISTS idx_amazon_fba_inventory_sku ON amazon_fba_inventory(seller_sku)');
  await query('CREATE INDEX IF NOT EXISTS idx_amazon_competitive_pricing_asin ON amazon_competitive_pricing(asin)');
  await query('CREATE INDEX IF NOT EXISTS idx_amazon_listing_offers_asin ON amazon_listing_offers(asin)');
  await query('CREATE INDEX IF NOT EXISTS idx_amazon_fba_fees_sku ON amazon_fba_fees(seller_sku)');
  // !IMPORTANT! amazon_sales_traffic indexes REMOVED - table no longer exists
  await query('CREATE INDEX IF NOT EXISTS idx_amazon_financial_events_order ON amazon_financial_events(amazon_order_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_amazon_catalog_items_asin ON amazon_catalog_items(asin)');

  syncLogger.info('Database tables ready');
}

// ============================================================================
// BATCH UPSERT FUNCTIONS (eliminates N+1)
// ============================================================================

/**
 * Batch upsert orders using UNNEST
 */
async function batchUpsertOrders(orders) {
  if (!orders || orders.length === 0) return 0;

  const amazonOrderIds = [];
  const sellerOrderIds = [];
  const purchaseDates = [];
  const orderStatuses = [];
  const fulfillmentChannels = [];
  const salesChannels = [];
  const shipServiceLevels = [];
  const orderTotalAmounts = [];
  const orderTotalCurrencies = [];
  const numbersOfItemsShipped = [];
  const numbersOfItemsUnshipped = [];
  const buyerEmails = [];
  const buyerNames = [];
  const shippingAddresses = [];
  const rawJsons = [];

  for (const order of orders) {
    amazonOrderIds.push(order.AmazonOrderId);
    sellerOrderIds.push(order.SellerOrderId || null);
    purchaseDates.push(order.PurchaseDate || null);
    orderStatuses.push(order.OrderStatus || null);
    fulfillmentChannels.push(order.FulfillmentChannel || null);
    salesChannels.push(order.SalesChannel || null);
    shipServiceLevels.push(order.ShipServiceLevel || null);
    orderTotalAmounts.push(order.OrderTotal?.Amount || null);
    orderTotalCurrencies.push(order.OrderTotal?.CurrencyCode || null);
    numbersOfItemsShipped.push(order.NumberOfItemsShipped || 0);
    numbersOfItemsUnshipped.push(order.NumberOfItemsUnshipped || 0);
    buyerEmails.push(order.BuyerEmail || null);
    buyerNames.push(order.BuyerName || null);
    shippingAddresses.push(JSON.stringify(order.ShippingAddress || {}));
    rawJsons.push(JSON.stringify(order));
  }

  const result = await query(`
    INSERT INTO amazon_orders (
      amazon_order_id, seller_order_id, purchase_date, order_status,
      fulfillment_channel, sales_channel, ship_service_level,
      order_total_amount, order_total_currency,
      number_of_items_shipped, number_of_items_unshipped,
      buyer_email, buyer_name, shipping_address_json, raw_json, updated_at
    )
    SELECT * FROM UNNEST(
      $1::varchar[], $2::varchar[], $3::timestamp[], $4::varchar[],
      $5::varchar[], $6::varchar[], $7::varchar[],
      $8::decimal[], $9::varchar[],
      $10::integer[], $11::integer[],
      $12::varchar[], $13::varchar[], $14::jsonb[], $15::jsonb[]
    ) AS t(amazon_order_id, seller_order_id, purchase_date, order_status,
           fulfillment_channel, sales_channel, ship_service_level,
           order_total_amount, order_total_currency,
           number_of_items_shipped, number_of_items_unshipped,
           buyer_email, buyer_name, shipping_address_json, raw_json)
    CROSS JOIN (SELECT CURRENT_TIMESTAMP AS updated_at) AS times
    ON CONFLICT (amazon_order_id) DO UPDATE SET
      order_status = EXCLUDED.order_status,
      number_of_items_shipped = EXCLUDED.number_of_items_shipped,
      number_of_items_unshipped = EXCLUDED.number_of_items_unshipped,
      raw_json = EXCLUDED.raw_json,
      updated_at = CURRENT_TIMESTAMP
  `, [
    amazonOrderIds, sellerOrderIds, purchaseDates, orderStatuses,
    fulfillmentChannels, salesChannels, shipServiceLevels,
    orderTotalAmounts, orderTotalCurrencies,
    numbersOfItemsShipped, numbersOfItemsUnshipped,
    buyerEmails, buyerNames, shippingAddresses, rawJsons,
  ]);

  return result.rowCount;
}

/**
 * J.3 FIX: Batch upsert order items using UNNEST
 * Eliminates N+1 query pattern in syncOrderItems
 */
async function batchUpsertOrderItems(items) {
  if (!items || items.length === 0) return 0;

  const amazonOrderIds = [];
  const orderItemIds = [];
  const asins = [];
  const sellerSkus = [];
  const titles = [];
  const quantitiesOrdered = [];
  const quantitiesShipped = [];
  const itemPriceAmounts = [];
  const itemPriceCurrencies = [];
  const itemTaxAmounts = [];
  const promotionDiscountAmounts = [];
  const rawJsons = [];

  for (const { orderId, item } of items) {
    amazonOrderIds.push(orderId);
    orderItemIds.push(item.OrderItemId);
    asins.push(item.ASIN || null);
    sellerSkus.push(item.SellerSKU || null);
    titles.push(item.Title || null);
    quantitiesOrdered.push(item.QuantityOrdered || 0);
    quantitiesShipped.push(item.QuantityShipped || 0);
    itemPriceAmounts.push(item.ItemPrice?.Amount || null);
    itemPriceCurrencies.push(item.ItemPrice?.CurrencyCode || null);
    itemTaxAmounts.push(item.ItemTax?.Amount || null);
    promotionDiscountAmounts.push(item.PromotionDiscount?.Amount || null);
    rawJsons.push(JSON.stringify(item));
  }

  const result = await query(`
    INSERT INTO amazon_order_items (
      amazon_order_id, order_item_id, asin, seller_sku, title,
      quantity_ordered, quantity_shipped,
      item_price_amount, item_price_currency, item_tax_amount,
      promotion_discount_amount, raw_json, updated_at
    )
    SELECT * FROM UNNEST(
      $1::varchar[], $2::varchar[], $3::varchar[], $4::varchar[], $5::text[],
      $6::integer[], $7::integer[],
      $8::decimal[], $9::varchar[], $10::decimal[],
      $11::decimal[], $12::jsonb[]
    ) AS t(amazon_order_id, order_item_id, asin, seller_sku, title,
           quantity_ordered, quantity_shipped,
           item_price_amount, item_price_currency, item_tax_amount,
           promotion_discount_amount, raw_json)
    CROSS JOIN (SELECT CURRENT_TIMESTAMP AS updated_at) AS times
    ON CONFLICT (order_item_id) DO UPDATE SET
      quantity_shipped = EXCLUDED.quantity_shipped,
      raw_json = EXCLUDED.raw_json,
      updated_at = CURRENT_TIMESTAMP
  `, [
    amazonOrderIds, orderItemIds, asins, sellerSkus, titles,
    quantitiesOrdered, quantitiesShipped,
    itemPriceAmounts, itemPriceCurrencies, itemTaxAmounts,
    promotionDiscountAmounts, rawJsons,
  ]);

  return result.rowCount;
}

/**
 * Batch upsert FBA inventory using UNNEST
 */
async function batchUpsertFbaInventory(items) {
  if (!items || items.length === 0) return 0;

  const sellerSkus = [];
  const asins = [];
  const fnSkus = [];
  const productNames = [];
  const conditions = [];
  const fulfillableQuantities = [];
  const inboundWorkingQuantities = [];
  const inboundShippedQuantities = [];
  const inboundReceivingQuantities = [];
  const reservedQuantities = [];
  const unfulfillableQuantities = [];
  const researchingQuantities = [];
  const totalQuantities = [];
  const rawJsons = [];

  for (const item of items) {
    sellerSkus.push(item.sellerSku);
    asins.push(item.asin || null);
    fnSkus.push(item.fnSku || null);
    productNames.push(item.productName || null);
    conditions.push(item.condition || null);
    fulfillableQuantities.push(item.inventoryDetails?.fulfillableQuantity || 0);
    inboundWorkingQuantities.push(item.inventoryDetails?.inboundWorkingQuantity || 0);
    inboundShippedQuantities.push(item.inventoryDetails?.inboundShippedQuantity || 0);
    inboundReceivingQuantities.push(item.inventoryDetails?.inboundReceivingQuantity || 0);
    reservedQuantities.push(item.inventoryDetails?.reservedQuantity?.totalReservedQuantity || 0);
    unfulfillableQuantities.push(item.inventoryDetails?.unfulfillableQuantity?.totalUnfulfillableQuantity || 0);
    researchingQuantities.push(item.inventoryDetails?.researchingQuantity?.totalResearchingQuantity || 0);
    totalQuantities.push(item.totalQuantity || 0);
    rawJsons.push(JSON.stringify(item));
  }

  const result = await query(`
    INSERT INTO amazon_fba_inventory (
      seller_sku, asin, fn_sku, product_name, condition,
      fulfillable_quantity, inbound_working_quantity, inbound_shipped_quantity,
      inbound_receiving_quantity, reserved_quantity, unfulfillable_quantity,
      researching_quantity, total_quantity, raw_json, captured_at, updated_at
    )
    SELECT seller_sku, asin, fn_sku, product_name, condition,
           fulfillable_quantity, inbound_working_quantity, inbound_shipped_quantity,
           inbound_receiving_quantity, reserved_quantity, unfulfillable_quantity,
           researching_quantity, total_quantity, raw_json,
           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM UNNEST(
      $1::varchar[], $2::varchar[], $3::varchar[], $4::text[], $5::varchar[],
      $6::integer[], $7::integer[], $8::integer[],
      $9::integer[], $10::integer[], $11::integer[],
      $12::integer[], $13::integer[], $14::jsonb[]
    ) AS t(seller_sku, asin, fn_sku, product_name, condition,
           fulfillable_quantity, inbound_working_quantity, inbound_shipped_quantity,
           inbound_receiving_quantity, reserved_quantity, unfulfillable_quantity,
           researching_quantity, total_quantity, raw_json)
    ON CONFLICT (seller_sku) DO UPDATE SET
      fulfillable_quantity = EXCLUDED.fulfillable_quantity,
      inbound_working_quantity = EXCLUDED.inbound_working_quantity,
      inbound_shipped_quantity = EXCLUDED.inbound_shipped_quantity,
      inbound_receiving_quantity = EXCLUDED.inbound_receiving_quantity,
      reserved_quantity = EXCLUDED.reserved_quantity,
      unfulfillable_quantity = EXCLUDED.unfulfillable_quantity,
      researching_quantity = EXCLUDED.researching_quantity,
      total_quantity = EXCLUDED.total_quantity,
      raw_json = EXCLUDED.raw_json,
      captured_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `, [
    sellerSkus, asins, fnSkus, productNames, conditions,
    fulfillableQuantities, inboundWorkingQuantities, inboundShippedQuantities,
    inboundReceivingQuantities, reservedQuantities, unfulfillableQuantities,
    researchingQuantities, totalQuantities, rawJsons,
  ]);

  return result.rowCount;
}

/**
 * !IMPORTANT! batchUpsertSalesTraffic REMOVED
 * The Sales & Traffic Report requires Brand Analytics permissions we don't have.
 * Do NOT re-implement this function or use amazon_sales_traffic table.
 */

/**
 * Batch upsert competitive pricing using UNNEST
 */
async function batchUpsertCompetitivePricing(items) {
  if (!items || items.length === 0) return 0;

  const marketplaceId = getDefaultMarketplaceId();
  const asins = [];
  const marketplaceIds = [];
  const competitivePriceAmounts = [];
  const competitivePriceCurrencies = [];
  const competitivePriceConditions = [];
  const landedPriceAmounts = [];
  const listingPriceAmounts = [];
  const shippingAmounts = [];
  const numbersOfOfferListings = [];
  const salesRanks = [];
  const salesRankCategories = [];
  const rawJsons = [];

  for (const item of items) {
    const pricing = item.Product?.CompetitivePricing;
    const offers = item.Product?.NumberOfOfferListings;
    const salesRank = item.Product?.SalesRankings?.[0];

    asins.push(item.ASIN);
    marketplaceIds.push(marketplaceId);
    competitivePriceAmounts.push(pricing?.CompetitivePrices?.[0]?.Price?.LandedPrice?.Amount || null);
    competitivePriceCurrencies.push(pricing?.CompetitivePrices?.[0]?.Price?.LandedPrice?.CurrencyCode || null);
    competitivePriceConditions.push(pricing?.CompetitivePrices?.[0]?.condition || null);
    landedPriceAmounts.push(pricing?.CompetitivePrices?.[0]?.Price?.LandedPrice?.Amount || null);
    listingPriceAmounts.push(pricing?.CompetitivePrices?.[0]?.Price?.ListingPrice?.Amount || null);
    shippingAmounts.push(pricing?.CompetitivePrices?.[0]?.Price?.Shipping?.Amount || null);
    numbersOfOfferListings.push(offers?.[0]?.Count || null);
    salesRanks.push(salesRank?.Rank || null);
    salesRankCategories.push(salesRank?.ProductCategoryId || null);
    rawJsons.push(JSON.stringify(item));
  }

  const result = await query(`
    INSERT INTO amazon_competitive_pricing (
      asin, marketplace_id, competitive_price_amount, competitive_price_currency,
      competitive_price_condition, landed_price_amount, listing_price_amount,
      shipping_amount, number_of_offer_listings, sales_rank, sales_rank_category,
      raw_json, captured_at, updated_at
    )
    SELECT asin, marketplace_id, competitive_price_amount, competitive_price_currency,
           competitive_price_condition, landed_price_amount, listing_price_amount,
           shipping_amount, number_of_offer_listings, sales_rank, sales_rank_category,
           raw_json, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM UNNEST(
      $1::varchar[], $2::varchar[], $3::decimal[], $4::varchar[],
      $5::varchar[], $6::decimal[], $7::decimal[],
      $8::decimal[], $9::integer[], $10::integer[], $11::varchar[],
      $12::jsonb[]
    ) AS t(asin, marketplace_id, competitive_price_amount, competitive_price_currency,
           competitive_price_condition, landed_price_amount, listing_price_amount,
           shipping_amount, number_of_offer_listings, sales_rank, sales_rank_category,
           raw_json)
    ON CONFLICT (asin, marketplace_id) DO UPDATE SET
      competitive_price_amount = EXCLUDED.competitive_price_amount,
      competitive_price_currency = EXCLUDED.competitive_price_currency,
      landed_price_amount = EXCLUDED.landed_price_amount,
      listing_price_amount = EXCLUDED.listing_price_amount,
      shipping_amount = EXCLUDED.shipping_amount,
      number_of_offer_listings = EXCLUDED.number_of_offer_listings,
      sales_rank = EXCLUDED.sales_rank,
      sales_rank_category = EXCLUDED.sales_rank_category,
      raw_json = EXCLUDED.raw_json,
      captured_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `, [
    asins, marketplaceIds, competitivePriceAmounts, competitivePriceCurrencies,
    competitivePriceConditions, landedPriceAmounts, listingPriceAmounts,
    shippingAmounts, numbersOfOfferListings, salesRanks, salesRankCategories,
    rawJsons,
  ]);

  return result.rowCount;
}

// ============================================================================
// SINGLE-ROW UPSERT FUNCTIONS (used as fallback or for single items)
// ============================================================================

// Upsert functions for each data type
async function upsertOrder(order) {
  await query(`
    INSERT INTO amazon_orders (
      amazon_order_id, seller_order_id, purchase_date, order_status,
      fulfillment_channel, sales_channel, ship_service_level,
      order_total_amount, order_total_currency,
      number_of_items_shipped, number_of_items_unshipped,
      buyer_email, buyer_name, shipping_address_json, raw_json, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
    ON CONFLICT (amazon_order_id) DO UPDATE SET
      order_status = EXCLUDED.order_status,
      number_of_items_shipped = EXCLUDED.number_of_items_shipped,
      number_of_items_unshipped = EXCLUDED.number_of_items_unshipped,
      raw_json = EXCLUDED.raw_json,
      updated_at = CURRENT_TIMESTAMP
  `, [
    order.AmazonOrderId,
    order.SellerOrderId,
    order.PurchaseDate,
    order.OrderStatus,
    order.FulfillmentChannel,
    order.SalesChannel,
    order.ShipServiceLevel,
    order.OrderTotal?.Amount,
    order.OrderTotal?.CurrencyCode,
    order.NumberOfItemsShipped,
    order.NumberOfItemsUnshipped,
    order.BuyerEmail,
    order.BuyerName,
    JSON.stringify(order.ShippingAddress || {}),
    JSON.stringify(order),
  ]);
}

async function upsertOrderItem(orderId, item) {
  await query(`
    INSERT INTO amazon_order_items (
      amazon_order_id, order_item_id, asin, seller_sku, title,
      quantity_ordered, quantity_shipped,
      item_price_amount, item_price_currency, item_tax_amount,
      promotion_discount_amount, raw_json, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
    ON CONFLICT (order_item_id) DO UPDATE SET
      quantity_shipped = EXCLUDED.quantity_shipped,
      raw_json = EXCLUDED.raw_json,
      updated_at = CURRENT_TIMESTAMP
  `, [
    orderId,
    item.OrderItemId,
    item.ASIN,
    item.SellerSKU,
    item.Title,
    item.QuantityOrdered,
    item.QuantityShipped,
    item.ItemPrice?.Amount,
    item.ItemPrice?.CurrencyCode,
    item.ItemTax?.Amount,
    item.PromotionDiscount?.Amount,
    JSON.stringify(item),
  ]);
}

async function upsertFbaInventory(item) {
  await query(`
    INSERT INTO amazon_fba_inventory (
      seller_sku, asin, fn_sku, product_name, condition,
      fulfillable_quantity, inbound_working_quantity, inbound_shipped_quantity,
      inbound_receiving_quantity, reserved_quantity, unfulfillable_quantity,
      researching_quantity, total_quantity, raw_json, captured_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (seller_sku) DO UPDATE SET
      fulfillable_quantity = EXCLUDED.fulfillable_quantity,
      inbound_working_quantity = EXCLUDED.inbound_working_quantity,
      inbound_shipped_quantity = EXCLUDED.inbound_shipped_quantity,
      inbound_receiving_quantity = EXCLUDED.inbound_receiving_quantity,
      reserved_quantity = EXCLUDED.reserved_quantity,
      unfulfillable_quantity = EXCLUDED.unfulfillable_quantity,
      researching_quantity = EXCLUDED.researching_quantity,
      total_quantity = EXCLUDED.total_quantity,
      raw_json = EXCLUDED.raw_json,
      captured_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `, [
    item.sellerSku,
    item.asin,
    item.fnSku,
    item.productName,
    item.condition,
    item.inventoryDetails?.fulfillableQuantity || 0,
    item.inventoryDetails?.inboundWorkingQuantity || 0,
    item.inventoryDetails?.inboundShippedQuantity || 0,
    item.inventoryDetails?.inboundReceivingQuantity || 0,
    item.inventoryDetails?.reservedQuantity?.totalReservedQuantity || 0,
    item.inventoryDetails?.unfulfillableQuantity?.totalUnfulfillableQuantity || 0,
    item.inventoryDetails?.researchingQuantity?.totalResearchingQuantity || 0,
    item.totalQuantity || 0,
    JSON.stringify(item),
  ]);
}

async function upsertCompetitivePricing(item) {
  const asin = item.ASIN;
  const pricing = item.Product?.CompetitivePricing;
  const offers = item.Product?.NumberOfOfferListings;
  const salesRank = item.Product?.SalesRankings?.[0];

  await query(`
    INSERT INTO amazon_competitive_pricing (
      asin, marketplace_id, competitive_price_amount, competitive_price_currency,
      competitive_price_condition, landed_price_amount, listing_price_amount,
      shipping_amount, number_of_offer_listings, sales_rank, sales_rank_category,
      raw_json, captured_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (asin, marketplace_id) DO UPDATE SET
      competitive_price_amount = EXCLUDED.competitive_price_amount,
      competitive_price_currency = EXCLUDED.competitive_price_currency,
      landed_price_amount = EXCLUDED.landed_price_amount,
      listing_price_amount = EXCLUDED.listing_price_amount,
      shipping_amount = EXCLUDED.shipping_amount,
      number_of_offer_listings = EXCLUDED.number_of_offer_listings,
      sales_rank = EXCLUDED.sales_rank,
      sales_rank_category = EXCLUDED.sales_rank_category,
      raw_json = EXCLUDED.raw_json,
      captured_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `, [
    asin,
    getDefaultMarketplaceId(),
    pricing?.CompetitivePrices?.[0]?.Price?.LandedPrice?.Amount,
    pricing?.CompetitivePrices?.[0]?.Price?.LandedPrice?.CurrencyCode,
    pricing?.CompetitivePrices?.[0]?.condition,
    pricing?.CompetitivePrices?.[0]?.Price?.LandedPrice?.Amount,
    pricing?.CompetitivePrices?.[0]?.Price?.ListingPrice?.Amount,
    pricing?.CompetitivePrices?.[0]?.Price?.Shipping?.Amount,
    offers?.[0]?.Count,
    salesRank?.Rank,
    salesRank?.ProductCategoryId,
    JSON.stringify(item),
  ]);
}

async function upsertListingOffer(asin, offer) {
  await query(`
    INSERT INTO amazon_listing_offers (
      asin, seller_id, is_buy_box_winner, is_featured_merchant,
      is_fulfilled_by_amazon, listing_price_amount, listing_price_currency,
      shipping_amount, landed_price_amount, condition_type, condition_sub_type,
      feedback_rating, feedback_count, ships_from, raw_json, captured_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
  `, [
    asin,
    offer.SellerId,
    offer.IsBuyBoxWinner,
    offer.IsFeaturedMerchant,
    offer.IsFulfilledByAmazon,
    offer.ListingPrice?.Amount,
    offer.ListingPrice?.CurrencyCode,
    offer.Shipping?.Amount,
    offer.ListingPrice?.Amount + (offer.Shipping?.Amount || 0),
    offer.SubCondition,
    offer.ConditionNotes,
    offer.SellerFeedbackRating?.SellerPositiveFeedbackRating,
    offer.SellerFeedbackRating?.FeedbackCount,
    offer.ShipsFrom?.Country,
    JSON.stringify(offer),
  ]);
}

async function upsertFbaFeeEstimate(sku, feeResult) {
  const fees = feeResult.FeesEstimate?.FeeDetailList || [];

  const feeMap = {};
  for (const fee of fees) {
    feeMap[fee.FeeType] = fee.FeeAmount?.Amount;
  }

  await query(`
    INSERT INTO amazon_fba_fees (
      seller_sku, asin, marketplace_id, price_to_estimate,
      total_fees_estimate, fee_currency, referral_fee, variable_closing_fee,
      per_item_fee, fba_fees, fba_pick_pack, fba_weight_handling,
      fba_order_handling, raw_json, captured_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (seller_sku, marketplace_id) DO UPDATE SET
      price_to_estimate = EXCLUDED.price_to_estimate,
      total_fees_estimate = EXCLUDED.total_fees_estimate,
      referral_fee = EXCLUDED.referral_fee,
      variable_closing_fee = EXCLUDED.variable_closing_fee,
      per_item_fee = EXCLUDED.per_item_fee,
      fba_fees = EXCLUDED.fba_fees,
      fba_pick_pack = EXCLUDED.fba_pick_pack,
      fba_weight_handling = EXCLUDED.fba_weight_handling,
      fba_order_handling = EXCLUDED.fba_order_handling,
      raw_json = EXCLUDED.raw_json,
      captured_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `, [
    sku,
    feeResult.FeesEstimateIdentifier?.IdValue,
    feeResult.FeesEstimateIdentifier?.MarketplaceId || getDefaultMarketplaceId(),
    feeResult.FeesEstimateIdentifier?.PriceToEstimateFees?.ListingPrice?.Amount,
    feeResult.FeesEstimate?.TotalFeesEstimate?.Amount,
    feeResult.FeesEstimate?.TotalFeesEstimate?.CurrencyCode,
    feeMap['ReferralFee'],
    feeMap['VariableClosingFee'],
    feeMap['PerItemFee'],
    feeMap['FBAFees'],
    feeMap['FBAPickAndPack'],
    feeMap['FBAWeightHandling'],
    feeMap['FBAOrderHandling'],
    JSON.stringify(feeResult),
  ]);
}

/**
 * !IMPORTANT! upsertSalesTraffic REMOVED
 * The Sales & Traffic Report requires Brand Analytics permissions we don't have.
 * Do NOT re-implement this function or use amazon_sales_traffic table.
 */

/**
 * J.4 FIX: Upsert financial events with idempotency
 * Uses ON CONFLICT DO NOTHING with unique index on (event_type, amazon_order_id, posted_date)
 * Returns count of saved and duplicate (skipped) events
 */
async function upsertFinancialEvents(eventGroup) {
  let saved = 0;
  let duplicates = 0;

  // Process shipment events
  for (const event of eventGroup.ShipmentEventList || []) {
    for (const item of event.ShipmentItemList || []) {
      // J.4 FIX: ON CONFLICT DO NOTHING for idempotency
      const result = await query(`
        INSERT INTO amazon_financial_events (
          event_type, amazon_order_id, seller_order_id, posted_date,
          marketplace_id, transaction_type, amount, currency,
          asin, seller_sku, quantity, raw_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT DO NOTHING
      `, [
        'SHIPMENT',
        event.AmazonOrderId,
        event.SellerOrderId,
        event.PostedDate,
        event.MarketplaceName,
        'Sale',
        item.ItemChargeList?.[0]?.ChargeAmount?.CurrencyAmount,
        item.ItemChargeList?.[0]?.ChargeAmount?.CurrencyCode,
        item.SellerSKU,
        item.SellerSKU,
        item.QuantityShipped,
        JSON.stringify(event),
      ]);
      if (result.rowCount > 0) {
        saved++;
      } else {
        duplicates++;
      }
    }
  }

  // Process refund events
  for (const event of eventGroup.RefundEventList || []) {
    for (const item of event.ShipmentItemAdjustmentList || []) {
      // J.4 FIX: ON CONFLICT DO NOTHING for idempotency
      const result = await query(`
        INSERT INTO amazon_financial_events (
          event_type, amazon_order_id, seller_order_id, posted_date,
          marketplace_id, transaction_type, amount, currency,
          seller_sku, quantity, raw_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT DO NOTHING
      `, [
        'REFUND',
        event.AmazonOrderId,
        event.SellerOrderId,
        event.PostedDate,
        event.MarketplaceName,
        'Refund',
        item.ItemChargeAdjustmentList?.[0]?.ChargeAmount?.CurrencyAmount,
        item.ItemChargeAdjustmentList?.[0]?.ChargeAmount?.CurrencyCode,
        item.SellerSKU,
        item.QuantityShipped,
        JSON.stringify(event),
      ]);
      if (result.rowCount > 0) {
        saved++;
      } else {
        duplicates++;
      }
    }
  }

  return { saved, duplicates };
}

async function upsertCatalogItem(asin, item) {
  const summary = item.summaries?.[0] || {};
  const attributes = item.attributes || {};
  const dimensions = item.dimensions?.[0] || {};

  await query(`
    INSERT INTO amazon_catalog_items (
      asin, marketplace_id, title, brand, color, size,
      manufacturer, model_number, part_number, product_type,
      item_dimensions_json, package_dimensions_json, images_json,
      sales_ranks_json, attributes_json, raw_json, captured_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (asin) DO UPDATE SET
      title = EXCLUDED.title,
      brand = EXCLUDED.brand,
      color = EXCLUDED.color,
      size = EXCLUDED.size,
      manufacturer = EXCLUDED.manufacturer,
      product_type = EXCLUDED.product_type,
      item_dimensions_json = EXCLUDED.item_dimensions_json,
      package_dimensions_json = EXCLUDED.package_dimensions_json,
      images_json = EXCLUDED.images_json,
      sales_ranks_json = EXCLUDED.sales_ranks_json,
      attributes_json = EXCLUDED.attributes_json,
      raw_json = EXCLUDED.raw_json,
      captured_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `, [
    asin,
    getDefaultMarketplaceId(),
    summary.itemName,
    summary.brand,
    attributes.color?.[0]?.value,
    attributes.size?.[0]?.value,
    summary.manufacturer,
    attributes.model_number?.[0]?.value,
    attributes.part_number?.[0]?.value,
    item.productTypes?.[0]?.productType,
    JSON.stringify(dimensions.item || {}),
    JSON.stringify(dimensions.package || {}),
    JSON.stringify(item.images || []),
    JSON.stringify(item.salesRanks || []),
    JSON.stringify(attributes),
    JSON.stringify(item),
  ]);
}

async function upsertFbaInventoryReport(item) {
  // Update from report data
  await query(`
    INSERT INTO amazon_fba_inventory (
      seller_sku, asin, fn_sku, product_name, condition,
      fulfillable_quantity, raw_json, captured_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (seller_sku) DO UPDATE SET
      fulfillable_quantity = EXCLUDED.fulfillable_quantity,
      raw_json = EXCLUDED.raw_json,
      captured_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `, [
    item.sku || item.seller_sku,
    item.asin,
    item.fnsku || item.fn_sku,
    item.product_name || item['product-name'],
    item.condition,
    parseInt(item.afn_fulfillable_quantity || item['afn-fulfillable-quantity'] || 0),
    JSON.stringify(item),
  ]);
}

async function upsertOrderFromReport(order) {
  await upsertOrder({
    AmazonOrderId: order.amazon_order_id || order['amazon-order-id'],
    SellerOrderId: order.merchant_order_id || order['merchant-order-id'],
    PurchaseDate: order.purchase_date || order['purchase-date'],
    OrderStatus: order.order_status || order['order-status'],
    FulfillmentChannel: order.fulfillment_channel || order['fulfillment-channel'],
    SalesChannel: order.sales_channel || order['sales-channel'],
    OrderTotal: {
      Amount: parseFloat(order.item_price || order['item-price'] || 0),
      CurrencyCode: order.currency || 'GBP',
    },
  });
}

// Helper functions
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseTsvReport(content) {
  const lines = content.split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split('\t').map(h =>
    h.trim().toLowerCase().replace(/[- ]/g, '_').replace(/[()]/g, '')
  );

  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split('\t');
    const item = {};
    headers.forEach((header, index) => {
      item[header] = values[index] || '';
    });
    items.push(item);
  }

  return items;
}

export default {
  syncOrders,
  syncOrderItems,
  syncFbaInventory,
  syncCompetitivePricing,
  syncListingOffers,
  syncFbaFees,
  syncFbaInventoryReport,
  // !IMPORTANT! syncSalesAndTraffic REMOVED - requires Brand Analytics permissions we don't have
  syncOrdersReport,
  syncFinancialEvents,
  syncCatalogItems,
  syncAll,
  ensureTables,
};
