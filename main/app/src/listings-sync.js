/**
 * Listings Sync Service
 * Fetches merchant listings from Amazon SP-API and syncs to database
 */

import SellingPartner from 'amazon-sp-api';
import { getSpApiClientConfig, hasSpApiCredentials, getDefaultMarketplaceId, getSellerId } from './credentials-provider.js';
import * as listingRepo from './repositories/listing.repository.js';

/**
 * Create SP-API client
 * @returns {SellingPartner|null} SP-API client or null if not configured
 */
function getSpClient() {
  if (!hasSpApiCredentials()) {
    return null;
  }

  try {
    const config = getSpApiClientConfig();
    return new SellingPartner({
      region: config.region,
      refresh_token: config.refresh_token,
      credentials: config.credentials,
      options: {
        ...config.options,
        debug_log: process.env.DEBUG === 'true',
      },
    });
  } catch (error) {
    console.error('[ListingsSync] Failed to create SP-API client:', error.message);
    return null;
  }
}

/**
 * Test SP-API connection by making a lightweight read-only API call
 * Uses getMarketplaceParticipations which doesn't create any resources
 * @returns {Promise<Object>} Connection test result
 */
export async function testConnection() {
  const sp = getSpClient();
  if (!sp) {
    return {
      success: false,
      error: 'SP-API credentials not configured',
      configured: false,
    };
  }

  try {
    // Use getMarketplaceParticipations - a lightweight read-only call
    // This validates the refresh token without creating orphan reports
    const response = await sp.callAPI({
      operation: 'getMarketplaceParticipations',
      endpoint: 'sellers',
    });

    // Extract marketplace info for useful response
    const marketplaces = response?.payload?.map(p => ({
      id: p.marketplace?.id,
      name: p.marketplace?.name,
      countryCode: p.marketplace?.countryCode,
      isParticipating: p.participation?.isParticipating,
    })) || [];

    console.log(`[ListingsSync] Connection test successful, ${marketplaces.length} marketplace(s) found`);

    return {
      success: true,
      configured: true,
      message: 'SP-API connection successful',
      marketplaces,
    };
  } catch (error) {
    console.error('[ListingsSync] Connection test failed:', error);

    // Check for specific error types
    const errorMessage = error.message || 'Failed to connect to Amazon SP-API';

    // If it's a token/auth error, provide specific guidance
    if (errorMessage.includes('invalid_grant') || errorMessage.includes('refresh_token')) {
      return {
        success: false,
        configured: true,
        error: 'Refresh token is invalid or expired. Please re-authorize the app in Seller Central.',
      };
    }

    return {
      success: false,
      configured: true,
      error: errorMessage,
    };
  }
}

/**
 * Request a GET_MERCHANT_LISTINGS_ALL_DATA report
 * @param {SellingPartner} sp - SP-API client
 * @returns {Promise<string>} Report ID
 */
async function requestListingsReport(sp) {
  const marketplaceId = getDefaultMarketplaceId();
  console.log(`[ListingsSync] Requesting report for marketplace: ${marketplaceId}`);

  const response = await sp.callAPI({
    operation: 'createReport',
    endpoint: 'reports',
    body: {
      reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA',
      marketplaceIds: [marketplaceId],
    },
  });

  console.log('[ListingsSync] createReport response:', JSON.stringify(response));
  return response.reportId;
}

/**
 * Wait for report to complete and get the document
 * @param {SellingPartner} sp - SP-API client
 * @param {string} reportId - Report ID
 * @param {number} maxWaitMs - Maximum wait time in milliseconds
 * @param {function} onProgress - Progress callback
 * @returns {Promise<string>} Report document content
 */
async function waitForReport(sp, reportId, maxWaitMs = 300000, onProgress = null) {
  const startTime = Date.now();
  let attempts = 0;

  while (Date.now() - startTime < maxWaitMs) {
    attempts++;
    const report = await sp.callAPI({
      operation: 'getReport',
      endpoint: 'reports',
      path: { reportId },
    });

    const status = report.processingStatus;
    console.log(`[ListingsSync] Report ${reportId} status: ${status} (attempt ${attempts})`);

    if (onProgress) {
      onProgress({ status, attempts, elapsed: Date.now() - startTime });
    }

    if (status === 'DONE') {
      // Get the report document
      const documentId = report.reportDocumentId;
      console.log(`[ListingsSync] Report done, fetching document: ${documentId}`);

      const document = await sp.callAPI({
        operation: 'getReportDocument',
        endpoint: 'reports',
        path: { reportDocumentId: documentId },
      });

      console.log(`[ListingsSync] Document URL obtained, downloading...`);

      // Download the document
      const response = await fetch(document.url);
      if (!response.ok) {
        throw new Error(`Failed to download report document: ${response.status}`);
      }

      const content = await response.text();
      console.log(`[ListingsSync] Downloaded ${content.length} bytes`);

      return content;
    } else if (status === 'CANCELLED' || status === 'FATAL') {
      throw new Error(`Report failed with status: ${status}`);
    }

    // Wait 5 seconds before checking again
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  throw new Error(`Report timed out after ${Math.round((Date.now() - startTime) / 1000)}s`);
}

/**
 * Parse TSV report content into listing objects
 * @param {string} content - TSV report content
 * @returns {Array<Object>} Parsed listings
 */
function parseListingsReport(content) {
  const lines = content.split('\n');
  if (lines.length < 2) {
    console.log('[ListingsSync] Report has no data rows');
    return [];
  }

  // Parse header row - handle various formats
  const rawHeaders = lines[0].split('\t');
  const headers = rawHeaders.map(h =>
    h.trim().toLowerCase().replace(/[- ]/g, '_').replace(/[()]/g, '')
  );

  console.log(`[ListingsSync] Report headers: ${headers.join(', ')}`);

  const listings = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split('\t');
    const listing = {};

    headers.forEach((header, index) => {
      listing[header] = values[index] || '';
    });

    // Map Amazon fields to our schema - handle various header names
    const mapped = {
      sku: listing.seller_sku || listing.sku || listing['seller-sku'] || '',
      asin: listing.asin1 || listing.asin || listing['asin1'] || '',
      title: listing.item_name || listing.title || listing['item-name'] || listing['product_name'] || '',
      price: parseFloat(listing.price || listing['your_price'] || listing['price'] || 0) || 0,
      quantity: parseInt(listing.quantity || listing['quantity'] || listing['available'] || 0, 10) || 0,
      status: mapStatus(listing.status || listing['item_status'] || listing['status']),
      fulfillmentChannel: mapFulfillment(listing.fulfillment_channel || listing['fulfillment-channel'] || listing['afn_listing_exists']),
      category: listing.item_type || listing.product_type || listing['product-type'] || listing['item_type'] || null,
      description: listing.item_description || listing.description || listing['item-description'] || '',
    };

    // Only include if we have a SKU
    if (mapped.sku) {
      listings.push(mapped);
    }
  }

  return listings;
}

/**
 * Map Amazon status to our status
 */
function mapStatus(amazonStatus) {
  const status = (amazonStatus || '').toLowerCase();
  if (status === 'active' || status === '') return 'active';
  if (status === 'inactive' || status === 'blocked' || status === 'incomplete') return 'inactive';
  return 'active';
}

/**
 * Map fulfillment channel
 */
function mapFulfillment(channel) {
  const ch = (channel || '').toUpperCase();
  if (ch.includes('AMAZON') || ch.includes('AFN') || ch === 'Y' || ch === 'YES') return 'FBA';
  return 'FBM';
}

/**
 * Sync listings from Amazon SP-API
 * @param {Object} options - Sync options
 * @param {boolean} options.dryRun - If true, don't actually save to database
 * @returns {Promise<Object>} Sync results
 */
export async function syncListings(options = {}) {
  const startTime = Date.now();
  const results = {
    success: false,
    listingsProcessed: 0,
    listingsCreated: 0,
    listingsUpdated: 0,
    errors: [],
    duration: 0,
    stage: 'starting',
  };

  try {
    // Check credentials first
    if (!hasSpApiCredentials()) {
      throw new Error('SP-API credentials not configured. Set SP_API_CLIENT_ID, SP_API_CLIENT_SECRET, and SP_API_REFRESH_TOKEN environment variables in Railway.');
    }

    const sp = getSpClient();
    results.stage = 'connecting';
    console.log('[ListingsSync] Starting listing sync from Amazon SP-API...');

    // Request the report
    results.stage = 'requesting_report';
    const reportId = await requestListingsReport(sp);
    console.log(`[ListingsSync] Report requested: ${reportId}`);

    // Wait for report to complete and download
    results.stage = 'waiting_for_report';
    const reportContent = await waitForReport(sp, reportId, 300000);
    console.log(`[ListingsSync] Report downloaded, size: ${reportContent.length} bytes`);

    // Parse the report
    results.stage = 'parsing';
    const listings = parseListingsReport(reportContent);
    console.log(`[ListingsSync] Parsed ${listings.length} listings`);

    results.listingsProcessed = listings.length;

    if (listings.length === 0) {
      results.success = true;
      results.duration = Date.now() - startTime;
      results.stage = 'complete';
      return results;
    }

    if (!options.dryRun) {
      results.stage = 'saving';

      // Bulk upsert all listings in a single query (eliminates N+1 problem)
      try {
        const bulkResult = await listingRepo.bulkUpsert(listings);
        results.listingsCreated = bulkResult.created;
        results.listingsUpdated = bulkResult.updated;
        console.log(`[ListingsSync] Bulk upsert complete: ${bulkResult.created} created, ${bulkResult.updated} updated`);
      } catch (error) {
        console.error(`[ListingsSync] Bulk upsert failed:`, error.message);

        // Fallback to individual upserts if bulk fails (e.g., one bad record)
        console.log('[ListingsSync] Falling back to individual upserts...');
        for (const listing of listings) {
          try {
            await listingRepo.upsert(listing);
            // Can't easily distinguish created vs updated in fallback mode
            results.listingsUpdated++;
          } catch (err) {
            console.error(`[ListingsSync] Error saving ${listing.sku}:`, err.message);
            results.errors.push({
              sku: listing.sku,
              error: err.message,
            });
          }
        }
      }
    }

    results.success = true;
    results.duration = Date.now() - startTime;
    results.stage = 'complete';

    console.log(`[ListingsSync] Sync complete: ${results.listingsCreated} created, ${results.listingsUpdated} updated, ${results.errors.length} errors in ${results.duration}ms`);

    return results;

  } catch (error) {
    console.error('[ListingsSync] Sync failed:', error);
    results.errors.push({ error: error.message, stack: error.stack });
    results.duration = Date.now() - startTime;
    results.stage = 'failed';
    throw error;
  }
}

/**
 * Get sync status
 * @returns {Promise<Object>} Current sync status
 */
export async function getSyncStatus() {
  const { query } = await import('./database/connection.js');

  const countResult = await query('SELECT COUNT(*) as count FROM listings');
  const lastUpdatedResult = await query('SELECT MAX("updatedAt") as last_updated FROM listings');

  return {
    spApiConfigured: hasSpApiCredentials(),
    listingCount: parseInt(countResult.rows[0]?.count || 0, 10),
    lastSync: lastUpdatedResult.rows[0]?.last_updated || null,
  };
}

export default {
  syncListings,
  getSyncStatus,
  testConnection,
};
