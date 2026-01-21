/**
 * Listings Sync Service
 * Fetches merchant listings from Amazon SP-API and syncs to database
 */

import SellingPartner from 'amazon-sp-api';
import { getSpApiClientConfig, hasSpApiCredentials, getDefaultMarketplaceId } from './credentials-provider.js';
import * as listingRepo from './repositories/listing.repository.js';

/**
 * Create SP-API client
 * @returns {SellingPartner|null} SP-API client or null if not configured
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
    options: config.options,
  });
}

/**
 * Request a GET_MERCHANT_LISTINGS_ALL_DATA report
 * @param {SellingPartner} sp - SP-API client
 * @returns {Promise<string>} Report ID
 */
async function requestListingsReport(sp) {
  const marketplaceId = getDefaultMarketplaceId();

  const response = await sp.callAPI({
    operation: 'createReport',
    body: {
      reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA',
      marketplaceIds: [marketplaceId],
    },
  });

  return response.reportId;
}

/**
 * Wait for report to complete and get the document
 * @param {SellingPartner} sp - SP-API client
 * @param {string} reportId - Report ID
 * @param {number} maxWaitMs - Maximum wait time in milliseconds
 * @returns {Promise<string>} Report document content
 */
async function waitForReport(sp, reportId, maxWaitMs = 300000) {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const report = await sp.callAPI({
      operation: 'getReport',
      path: { reportId },
    });

    console.log(`[ListingsSync] Report ${reportId} status: ${report.processingStatus}`);

    if (report.processingStatus === 'DONE') {
      // Get the report document
      const documentId = report.reportDocumentId;
      const document = await sp.callAPI({
        operation: 'getReportDocument',
        path: { reportDocumentId: documentId },
      });

      // Download the document
      const response = await fetch(document.url);
      const content = await response.text();

      return content;
    } else if (report.processingStatus === 'CANCELLED' || report.processingStatus === 'FATAL') {
      throw new Error(`Report failed with status: ${report.processingStatus}`);
    }

    // Wait 10 seconds before checking again
    await new Promise(resolve => setTimeout(resolve, 10000));
  }

  throw new Error(`Report timed out after ${maxWaitMs}ms`);
}

/**
 * Parse TSV report content into listing objects
 * @param {string} content - TSV report content
 * @returns {Array<Object>} Parsed listings
 */
function parseListingsReport(content) {
  const lines = content.split('\n');
  if (lines.length < 2) {
    return [];
  }

  // Parse header row
  const headers = lines[0].split('\t').map(h => h.trim().toLowerCase().replace(/[- ]/g, '_'));

  const listings = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split('\t');
    const listing = {};

    headers.forEach((header, index) => {
      listing[header] = values[index] || '';
    });

    // Map Amazon fields to our schema
    const mapped = {
      sku: listing.seller_sku || listing.sku || '',
      asin: listing.asin1 || listing.asin || '',
      title: listing.item_name || listing.title || '',
      price: parseFloat(listing.price) || 0,
      quantity: parseInt(listing.quantity, 10) || 0,
      status: mapStatus(listing.status),
      fulfillmentChannel: listing.fulfillment_channel === 'AMAZON_NA' || listing.fulfillment_channel === 'AMAZON_EU' ? 'FBA' : 'FBM',
      category: listing.item_type || listing.product_type || null,
      description: listing.item_description || listing.description || '',
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
 * @param {string} amazonStatus
 * @returns {string}
 */
function mapStatus(amazonStatus) {
  const status = (amazonStatus || '').toLowerCase();
  if (status === 'active' || status === '') return 'active';
  if (status === 'inactive' || status === 'blocked') return 'inactive';
  if (status === 'incomplete') return 'incomplete';
  return 'active';
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
  };

  try {
    const sp = getSpClient();
    if (!sp) {
      throw new Error('SP-API credentials not configured. Please set SP_API_CLIENT_ID, SP_API_CLIENT_SECRET, and SP_API_REFRESH_TOKEN environment variables.');
    }

    console.log('[ListingsSync] Starting listing sync from Amazon SP-API...');

    // Request the report
    const reportId = await requestListingsReport(sp);
    console.log(`[ListingsSync] Report requested: ${reportId}`);

    // Wait for report to complete and download
    const reportContent = await waitForReport(sp, reportId);
    console.log(`[ListingsSync] Report downloaded, size: ${reportContent.length} bytes`);

    // Parse the report
    const listings = parseListingsReport(reportContent);
    console.log(`[ListingsSync] Parsed ${listings.length} listings`);

    results.listingsProcessed = listings.length;

    if (!options.dryRun) {
      // Upsert each listing
      for (const listing of listings) {
        try {
          const existing = await listingRepo.getBySku(listing.sku);
          await listingRepo.upsert(listing);

          if (existing) {
            results.listingsUpdated++;
          } else {
            results.listingsCreated++;
          }
        } catch (error) {
          results.errors.push({
            sku: listing.sku,
            error: error.message,
          });
        }
      }
    }

    results.success = true;
    results.duration = Date.now() - startTime;

    console.log(`[ListingsSync] Sync complete: ${results.listingsCreated} created, ${results.listingsUpdated} updated, ${results.errors.length} errors in ${results.duration}ms`);

    return results;

  } catch (error) {
    results.errors.push({ error: error.message });
    results.duration = Date.now() - startTime;
    console.error('[ListingsSync] Sync failed:', error.message);
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
};
