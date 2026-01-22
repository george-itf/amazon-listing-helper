/**
 * Amazon Data Sync Service
 * Comprehensive data fetching from ALL available Amazon SP-API endpoints
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

  console.log(`[AmazonSync] Syncing orders from last ${daysBack} days...`);

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

    const response = await sp.callAPI(params);

    if (response.Orders) {
      orders = orders.concat(response.Orders);
    }

    nextToken = response.NextToken;
    console.log(`[AmazonSync] Fetched ${orders.length} orders so far...`);

    // Rate limiting - wait 500ms between calls
    if (nextToken) await sleep(500);
  } while (nextToken);

  console.log(`[AmazonSync] Total orders fetched: ${orders.length}`);

  // Save to database using batch upsert (eliminates N+1)
  let saved = 0;
  try {
    saved = await batchUpsertOrders(orders);
    console.log(`[AmazonSync] Batch upserted ${saved} orders`);
  } catch (error) {
    console.error(`[AmazonSync] Batch upsert failed, falling back to sequential:`, error.message);
    // Fallback to individual upserts if batch fails
    for (const order of orders) {
      try {
        await upsertOrder(order);
        saved++;
      } catch (err) {
        console.error(`[AmazonSync] Error saving order ${order.AmazonOrderId}:`, err.message);
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
 */
export async function syncOrderItems(orderIds) {
  const sp = getSpClient();
  if (!sp) throw new Error('SP-API not configured');

  console.log(`[AmazonSync] Fetching items for ${orderIds.length} orders...`);

  let totalItems = 0;

  for (const orderId of orderIds) {
    try {
      const response = await sp.callAPI({
        operation: 'getOrderItems',
        endpoint: 'orders',
        path: { orderId },
      });

      if (response.OrderItems) {
        for (const item of response.OrderItems) {
          await upsertOrderItem(orderId, item);
          totalItems++;
        }
      }

      // Rate limiting
      await sleep(200);
    } catch (error) {
      console.error(`[AmazonSync] Error fetching items for order ${orderId}:`, error.message);
    }
  }

  return { items_synced: totalItems };
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

  console.log('[AmazonSync] Syncing FBA inventory...');

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

    const response = await sp.callAPI(params);

    if (response.inventorySummaries) {
      inventoryItems = inventoryItems.concat(response.inventorySummaries);
    }

    nextToken = response.pagination?.nextToken;
    console.log(`[AmazonSync] Fetched ${inventoryItems.length} inventory items...`);

    if (nextToken) await sleep(500);
  } while (nextToken);

  // Save to database using batch upsert (eliminates N+1)
  let saved = 0;
  try {
    saved = await batchUpsertFbaInventory(inventoryItems);
    console.log(`[AmazonSync] Batch upserted ${saved} inventory items`);
  } catch (error) {
    console.error(`[AmazonSync] Batch upsert failed, falling back to sequential:`, error.message);
    for (const item of inventoryItems) {
      try {
        await upsertFbaInventory(item);
        saved++;
      } catch (err) {
        console.error(`[AmazonSync] Error saving inventory ${item.sellerSku}:`, err.message);
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

  console.log('[AmazonSync] Syncing competitive pricing...');

  // Get all ASINs from listings
  const listingsResult = await query('SELECT DISTINCT asin FROM listings WHERE asin IS NOT NULL');
  const asins = listingsResult.rows.map(r => r.asin).filter(Boolean);

  if (asins.length === 0) {
    return { success: true, message: 'No ASINs to fetch pricing for' };
  }

  const marketplaceId = getDefaultMarketplaceId();
  let saved = 0;

  // Process in batches of 20 (API limit)
  const batchSize = 20;
  for (let i = 0; i < asins.length; i += batchSize) {
    const batch = asins.slice(i, i + batchSize);

    try {
      const response = await sp.callAPI({
        operation: 'getCompetitivePricing',
        endpoint: 'productPricing',
        query: {
          MarketplaceId: marketplaceId,
          Asins: batch,
          ItemType: 'Asin',
        },
      });

      if (response && Array.isArray(response)) {
        // Batch upsert all items from this API call
        const batchSaved = await batchUpsertCompetitivePricing(response);
        saved += batchSaved;
      }

      console.log(`[AmazonSync] Processed ${Math.min(i + batchSize, asins.length)}/${asins.length} ASINs`);
      await sleep(1000); // Rate limiting
    } catch (error) {
      console.error(`[AmazonSync] Error fetching pricing batch:`, error.message);
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
    console.log(`[AmazonSync] Syncing listing offers for ${asins.length} targeted ASIN(s)...`);
  } else {
    // Global sync - fetch all ASINs from listings
    const listingsResult = await query('SELECT DISTINCT asin FROM listings WHERE asin IS NOT NULL');
    asins = listingsResult.rows.map(r => r.asin).filter(Boolean);
    console.log(`[AmazonSync] Syncing listing offers for all ${asins.length} ASIN(s)...`);
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
      const response = await sp.callAPI({
        operation: 'getItemOffers',
        endpoint: 'productPricing',
        path: { Asin: asin },
        query: {
          MarketplaceId: marketplaceId,
          ItemCondition: 'New',
        },
      });

      if (response?.Offers) {
        for (const offer of response.Offers) {
          await upsertListingOffer(asin, offer);
          totalOffers++;
        }
      }

      await sleep(200); // Rate limiting
    } catch (error) {
      // Skip - might be throttled or ASIN not found
      console.log(`[AmazonSync] Skipped offers for ${asin}: ${error.message}`);
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

  console.log('[AmazonSync] Syncing FBA fee estimates...');

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
      const response = await sp.callAPI({
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
      });

      if (response?.FeesEstimateResult) {
        await upsertFbaFeeEstimate(listing.seller_sku, response.FeesEstimateResult);
        saved++;
      }

      await sleep(200); // Rate limiting
    } catch (error) {
      console.log(`[AmazonSync] Skipped fees for ${listing.seller_sku}: ${error.message}`);
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
  console.log(`[AmazonSync] Report ${reportType} requested: ${reportId}`);

  // Wait for completion
  const maxWait = 300000; // 5 minutes
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    const report = await sp.callAPI({
      operation: 'getReport',
      endpoint: 'reports',
      path: { reportId },
    });

    if (report.processingStatus === 'DONE') {
      // Download document
      const document = await sp.callAPI({
        operation: 'getReportDocument',
        endpoint: 'reports',
        path: { reportDocumentId: report.reportDocumentId },
      });

      const response = await fetch(document.url);
      return await response.text();
    } else if (report.processingStatus === 'CANCELLED' || report.processingStatus === 'FATAL') {
      throw new Error(`Report failed: ${report.processingStatus}`);
    }

    await sleep(5000);
  }

  throw new Error('Report timed out');
}

/**
 * Sync FBA inventory report (aged inventory, planning data)
 */
export async function syncFbaInventoryReport() {
  const sp = getSpClient();
  if (!sp) throw new Error('SP-API not configured');

  console.log('[AmazonSync] Requesting FBA inventory report...');

  try {
    const content = await requestAndDownloadReport(sp, 'GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA');
    const items = parseTsvReport(content);

    let saved = 0;
    for (const item of items) {
      try {
        await upsertFbaInventoryReport(item);
        saved++;
      } catch (error) {
        console.error(`[AmazonSync] Error saving inventory item:`, error.message);
      }
    }

    return {
      success: true,
      items_fetched: items.length,
      items_saved: saved,
    };
  } catch (error) {
    console.error('[AmazonSync] FBA inventory report failed:', error.message);
    throw error;
  }
}

/**
 * Sync sales and traffic report (Business Reports data)
 *
 * @param {number} [daysBack=30] - Number of days to fetch
 * @param {Object} [options] - Optional parameters
 * @param {string[]} [options.asins] - Specific ASINs to save (filters results after fetch; if omitted, saves all)
 * @returns {Promise<Object>} Sync results with records_fetched, records_saved, and mode
 */
export async function syncSalesAndTraffic(daysBack = 30, options = {}) {
  const sp = getSpClient();
  if (!sp) throw new Error('SP-API not configured');

  console.log(`[AmazonSync] Requesting sales & traffic report for last ${daysBack} days...`);

  const endDate = new Date();
  const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  // Determine if we're doing targeted filtering
  let targetAsins = null;
  let mode = 'global';

  if (options.asins && Array.isArray(options.asins) && options.asins.length > 0) {
    targetAsins = new Set(options.asins.filter(Boolean));
    mode = 'targeted';
    console.log(`[AmazonSync] Will filter to ${targetAsins.size} targeted ASIN(s)`);
  }

  try {
    const content = await requestAndDownloadReport(sp, 'GET_SALES_AND_TRAFFIC_REPORT', {
      dataStartTime: startDate.toISOString(),
      dataEndTime: endDate.toISOString(),
    });

    // This report is JSON format
    const data = JSON.parse(content);

    // Get all items from report
    let items = data.salesAndTrafficByAsin || [];
    const totalFetched = items.length;

    // Filter to target ASINs if specified
    if (targetAsins && targetAsins.size > 0) {
      items = items.filter(item => {
        const itemAsin = item.parentAsin || item.childAsin;
        return targetAsins.has(itemAsin);
      });
      console.log(`[AmazonSync] Filtered from ${totalFetched} to ${items.length} records for targeted ASINs`);
    }

    let saved = 0;
    if (items.length > 0) {
      // Batch upsert filtered sales/traffic data (eliminates N+1)
      try {
        saved = await batchUpsertSalesTraffic(items);
        console.log(`[AmazonSync] Batch upserted ${saved} sales/traffic records`);
      } catch (error) {
        console.error(`[AmazonSync] Batch upsert failed, falling back to sequential:`, error.message);
        for (const item of items) {
          try {
            await upsertSalesTraffic(item);
            saved++;
          } catch (err) {
            console.error(`[AmazonSync] Error saving sales data:`, err.message);
          }
        }
      }
    }

    return {
      success: true,
      records_fetched: totalFetched,
      records_filtered: items.length,
      records_saved: saved,
      days_back: daysBack,
      mode,
      ...(mode === 'targeted' && { target_asins: [...targetAsins] }),
    };
  } catch (error) {
    console.error('[AmazonSync] Sales & traffic report failed:', error.message);
    throw error;
  }
}

/**
 * Sync all orders report (historical)
 */
export async function syncOrdersReport(daysBack = 30) {
  const sp = getSpClient();
  if (!sp) throw new Error('SP-API not configured');

  console.log(`[AmazonSync] Requesting orders report for last ${daysBack} days...`);

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
        console.error(`[AmazonSync] Error saving order:`, error.message);
      }
    }

    return {
      success: true,
      orders_fetched: orders.length,
      orders_saved: saved,
    };
  } catch (error) {
    console.error('[AmazonSync] Orders report failed:', error.message);
    throw error;
  }
}

// ============================================================================
// FINANCES API - Financial events
// ============================================================================

/**
 * Sync financial events (settlements, refunds, fees)
 */
export async function syncFinancialEvents(daysBack = 30) {
  const sp = getSpClient();
  if (!sp) throw new Error('SP-API not configured');

  console.log(`[AmazonSync] Syncing financial events from last ${daysBack} days...`);

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

    const response = await sp.callAPI(params);

    if (response.FinancialEvents) {
      events.push(response.FinancialEvents);
    }

    nextToken = response.NextToken;
    if (nextToken) await sleep(500);
  } while (nextToken);

  // Save to database
  let saved = 0;
  for (const eventGroup of events) {
    try {
      await upsertFinancialEvents(eventGroup);
      saved++;
    } catch (error) {
      console.error(`[AmazonSync] Error saving financial events:`, error.message);
    }
  }

  return {
    success: true,
    event_groups_fetched: events.length,
    event_groups_saved: saved,
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
    console.log(`[AmazonSync] Syncing catalog items for ${asins.length} targeted ASIN(s)...`);
  } else {
    // Global sync - fetch all ASINs from listings
    const listingsResult = await query('SELECT DISTINCT asin FROM listings WHERE asin IS NOT NULL');
    asins = listingsResult.rows.map(r => r.asin).filter(Boolean);
    console.log(`[AmazonSync] Syncing catalog items for all ${asins.length} ASIN(s)...`);
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
      const response = await sp.callAPI({
        operation: 'getCatalogItem',
        endpoint: 'catalogItems',
        path: { asin },
        query: {
          marketplaceIds: marketplaceId,
          includedData: 'attributes,dimensions,identifiers,images,productTypes,salesRanks,summaries',
        },
      });

      if (response) {
        await upsertCatalogItem(asin, response);
        saved++;
      }

      await sleep(500); // Rate limiting
    } catch (error) {
      console.log(`[AmazonSync] Skipped catalog for ${asin}: ${error.message}`);
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
 * 3. Parallel batch 2: Competitive Pricing, FBA Fees, Catalog Items, Sales & Traffic
 * 4. Listing Offers (last - most API intensive, separate rate limit bucket)
 *
 * @returns {Promise<Object>} Combined results from all syncs
 */
export async function syncAll() {
  const results = {
    started_at: new Date().toISOString(),
    syncs: {},
    errors: [],
  };

  console.log('[AmazonSync] === STARTING FULL AMAZON DATA SYNC (PARALLELIZED) ===');

  // Phase 0: Listings Report (core data - MUST sync first)
  try {
    console.log('[AmazonSync] Phase 0 - Syncing Listings from Report...');
    const listingsResult = await syncListings();
    results.syncs.listings = {
      success: true,
      listings_processed: listingsResult.listingsProcessed,
      listings_created: listingsResult.listingsCreated,
      listings_updated: listingsResult.listingsUpdated,
    };
  } catch (error) {
    console.error('[AmazonSync] Listings sync failed:', error.message);
    results.errors.push({ sync: 'listings', error: error.message });
  }

  // Phase 1: Parallel - Independent API endpoints
  console.log('[AmazonSync] Phase 1 - Parallel: FBA Inventory, Orders, Financial Events...');
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
      console.error(`[AmazonSync] ${syncName} sync failed:`, outcome.reason?.message || outcome.reason);
      results.errors.push({ sync: syncName, error: outcome.reason?.message || String(outcome.reason) });
    }
  }

  // Phase 2: Parallel - Syncs that query listings table + reports
  console.log('[AmazonSync] Phase 2 - Parallel: Pricing, Fees, Catalog, Sales...');
  const phase2Results = await Promise.allSettled([
    syncCompetitivePricing().then(r => ({ name: 'competitive_pricing', result: r })),
    syncFbaFees().then(r => ({ name: 'fba_fees', result: r })),
    syncCatalogItems().then(r => ({ name: 'catalog_items', result: r })),
    syncSalesAndTraffic(30).then(r => ({ name: 'sales_traffic', result: r })),
  ]);

  for (const outcome of phase2Results) {
    if (outcome.status === 'fulfilled') {
      results.syncs[outcome.value.name] = outcome.value.result;
    } else {
      const syncName = outcome.reason?.name || 'unknown';
      console.error(`[AmazonSync] ${syncName} sync failed:`, outcome.reason?.message || outcome.reason);
      results.errors.push({ sync: syncName, error: outcome.reason?.message || String(outcome.reason) });
    }
  }

  // Phase 3: Listing Offers (most API intensive - run alone to avoid rate limits)
  console.log('[AmazonSync] Phase 3 - Listing Offers...');
  try {
    results.syncs.listing_offers = await syncListingOffers();
  } catch (error) {
    console.error('[AmazonSync] Listing offers sync failed:', error.message);
    results.errors.push({ sync: 'listing_offers', error: error.message });
  }

  results.completed_at = new Date().toISOString();
  results.success = results.errors.length === 0;

  const successCount = Object.keys(results.syncs).length;
  const totalCount = successCount + results.errors.length;

  console.log('[AmazonSync] === FULL SYNC COMPLETE ===');
  console.log(`[AmazonSync] Successful: ${successCount}/${totalCount}`);

  return results;
}

// ============================================================================
// DATABASE HELPERS
// ============================================================================

/**
 * Ensure all required tables exist
 */
export async function ensureTables() {
  console.log('[AmazonSync] Ensuring database tables exist...');

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

  // Sales and Traffic data table
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_sales_traffic (
      id SERIAL PRIMARY KEY,
      asin VARCHAR(20) NOT NULL,
      date DATE NOT NULL,
      sessions INTEGER,
      session_percentage DECIMAL(5,2),
      page_views INTEGER,
      page_views_percentage DECIMAL(5,2),
      buy_box_percentage DECIMAL(5,2),
      units_ordered INTEGER,
      units_ordered_b2b INTEGER,
      unit_session_percentage DECIMAL(5,2),
      ordered_product_sales_amount DECIMAL(12,2),
      ordered_product_sales_currency VARCHAR(10),
      total_order_items INTEGER,
      raw_json JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(asin, date)
    )
  `);

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
  await query('CREATE INDEX IF NOT EXISTS idx_amazon_sales_traffic_asin ON amazon_sales_traffic(asin)');
  await query('CREATE INDEX IF NOT EXISTS idx_amazon_sales_traffic_date ON amazon_sales_traffic(date)');
  await query('CREATE INDEX IF NOT EXISTS idx_amazon_financial_events_order ON amazon_financial_events(amazon_order_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_amazon_catalog_items_asin ON amazon_catalog_items(asin)');

  console.log('[AmazonSync] Database tables ready');
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
 * Batch upsert sales/traffic data using UNNEST
 */
async function batchUpsertSalesTraffic(items) {
  if (!items || items.length === 0) return 0;

  const asins = [];
  const dates = [];
  const sessions = [];
  const sessionPercentages = [];
  const pageViews = [];
  const pageViewsPercentages = [];
  const buyBoxPercentages = [];
  const unitsOrdered = [];
  const unitsOrderedB2B = [];
  const unitSessionPercentages = [];
  const salesAmounts = [];
  const salesCurrencies = [];
  const totalOrderItems = [];
  const rawJsons = [];

  for (const item of items) {
    const traffic = item.trafficByAsin || {};
    const sales = item.salesByAsin || {};

    asins.push(item.parentAsin || item.childAsin);
    dates.push(item.date);
    sessions.push(traffic.sessions || 0);
    sessionPercentages.push(traffic.sessionPercentage || 0);
    pageViews.push(traffic.pageViews || 0);
    pageViewsPercentages.push(traffic.pageViewsPercentage || 0);
    buyBoxPercentages.push(traffic.buyBoxPercentage || 0);
    unitsOrdered.push(sales.unitsOrdered || 0);
    unitsOrderedB2B.push(sales.unitsOrderedB2B || 0);
    unitSessionPercentages.push(traffic.unitSessionPercentage || 0);
    salesAmounts.push(sales.orderedProductSales?.amount || 0);
    salesCurrencies.push(sales.orderedProductSales?.currencyCode || 'GBP');
    totalOrderItems.push(sales.totalOrderItems || 0);
    rawJsons.push(JSON.stringify(item));
  }

  const result = await query(`
    INSERT INTO amazon_sales_traffic (
      asin, date, sessions, session_percentage, page_views,
      page_views_percentage, buy_box_percentage, units_ordered,
      units_ordered_b2b, unit_session_percentage, ordered_product_sales_amount,
      ordered_product_sales_currency, total_order_items, raw_json, updated_at
    )
    SELECT asin, date, sessions, session_percentage, page_views,
           page_views_percentage, buy_box_percentage, units_ordered,
           units_ordered_b2b, unit_session_percentage, ordered_product_sales_amount,
           ordered_product_sales_currency, total_order_items, raw_json,
           CURRENT_TIMESTAMP
    FROM UNNEST(
      $1::varchar[], $2::date[], $3::integer[], $4::decimal[], $5::integer[],
      $6::decimal[], $7::decimal[], $8::integer[],
      $9::integer[], $10::decimal[], $11::decimal[],
      $12::varchar[], $13::integer[], $14::jsonb[]
    ) AS t(asin, date, sessions, session_percentage, page_views,
           page_views_percentage, buy_box_percentage, units_ordered,
           units_ordered_b2b, unit_session_percentage, ordered_product_sales_amount,
           ordered_product_sales_currency, total_order_items, raw_json)
    ON CONFLICT (asin, date) DO UPDATE SET
      sessions = EXCLUDED.sessions,
      session_percentage = EXCLUDED.session_percentage,
      page_views = EXCLUDED.page_views,
      buy_box_percentage = EXCLUDED.buy_box_percentage,
      units_ordered = EXCLUDED.units_ordered,
      ordered_product_sales_amount = EXCLUDED.ordered_product_sales_amount,
      raw_json = EXCLUDED.raw_json,
      updated_at = CURRENT_TIMESTAMP
  `, [
    asins, dates, sessions, sessionPercentages, pageViews,
    pageViewsPercentages, buyBoxPercentages, unitsOrdered,
    unitsOrderedB2B, unitSessionPercentages, salesAmounts,
    salesCurrencies, totalOrderItems, rawJsons,
  ]);

  return result.rowCount;
}

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

async function upsertSalesTraffic(item) {
  const traffic = item.trafficByAsin || {};
  const sales = item.salesByAsin || {};

  await query(`
    INSERT INTO amazon_sales_traffic (
      asin, date, sessions, session_percentage, page_views,
      page_views_percentage, buy_box_percentage, units_ordered,
      units_ordered_b2b, unit_session_percentage, ordered_product_sales_amount,
      ordered_product_sales_currency, total_order_items, raw_json, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
    ON CONFLICT (asin, date) DO UPDATE SET
      sessions = EXCLUDED.sessions,
      session_percentage = EXCLUDED.session_percentage,
      page_views = EXCLUDED.page_views,
      buy_box_percentage = EXCLUDED.buy_box_percentage,
      units_ordered = EXCLUDED.units_ordered,
      ordered_product_sales_amount = EXCLUDED.ordered_product_sales_amount,
      raw_json = EXCLUDED.raw_json,
      updated_at = CURRENT_TIMESTAMP
  `, [
    item.parentAsin || item.childAsin,
    item.date,
    traffic.sessions,
    traffic.sessionPercentage,
    traffic.pageViews,
    traffic.pageViewsPercentage,
    traffic.buyBoxPercentage,
    sales.unitsOrdered,
    sales.unitsOrderedB2B,
    traffic.unitSessionPercentage,
    sales.orderedProductSales?.amount,
    sales.orderedProductSales?.currencyCode,
    sales.totalOrderItems,
    JSON.stringify(item),
  ]);
}

async function upsertFinancialEvents(eventGroup) {
  // Process shipment events
  for (const event of eventGroup.ShipmentEventList || []) {
    for (const item of event.ShipmentItemList || []) {
      await query(`
        INSERT INTO amazon_financial_events (
          event_type, amazon_order_id, seller_order_id, posted_date,
          marketplace_id, transaction_type, amount, currency,
          asin, seller_sku, quantity, raw_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
    }
  }

  // Process refund events
  for (const event of eventGroup.RefundEventList || []) {
    for (const item of event.ShipmentItemAdjustmentList || []) {
      await query(`
        INSERT INTO amazon_financial_events (
          event_type, amazon_order_id, seller_order_id, posted_date,
          marketplace_id, transaction_type, amount, currency,
          seller_sku, quantity, raw_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
    }
  }
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
  syncSalesAndTraffic,
  syncOrdersReport,
  syncFinancialEvents,
  syncCatalogItems,
  syncAll,
  ensureTables,
};
