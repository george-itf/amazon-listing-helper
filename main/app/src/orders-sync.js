/**
 * Orders Sync Service
 * Fetches orders from Amazon SP-API and stores in database
 */

import SellingPartner from 'amazon-sp-api';
import fs from 'fs';
import path from 'path';
import * as OrderRepository from './repositories/order.repository.js';

const DATA_DIR = path.join(process.cwd(), '..', 'data');

function loadCreds() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'credentials.json'), 'utf8'));
  } catch {
    return {};
  }
}

function getSpClient() {
  const creds = loadCreds();
  if (!creds?.clientId || !creds?.clientSecret || !creds?.refreshToken) {
    return null;
  }

  return new SellingPartner({
    region: 'eu',
    refresh_token: creds.refreshToken,
    credentials: {
      SELLING_PARTNER_APP_CLIENT_ID: creds.clientId,
      SELLING_PARTNER_APP_CLIENT_SECRET: creds.clientSecret
    }
  });
}

/**
 * Fetch orders from Amazon SP-API
 * @param {Object} options - Fetch options
 * @param {Date} options.createdAfter - Fetch orders created after this date
 * @param {Date} options.createdBefore - Fetch orders created before this date
 * @param {Array} options.orderStatuses - Filter by order statuses
 * @param {number} options.maxResults - Maximum results per page (max 100)
 * @returns {Promise<Array>} Orders from Amazon
 */
export async function fetchOrders(options = {}) {
  const sp = getSpClient();
  if (!sp) {
    throw new Error('SP-API credentials not configured');
  }

  const {
    createdAfter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Default 30 days ago
    createdBefore = new Date(),
    orderStatuses = ['Unshipped', 'PartiallyShipped', 'Shipped', 'Canceled'],
    maxResults = 100
  } = options;

  const allOrders = [];
  let nextToken = null;

  try {
    do {
      const params = {
        operation: 'getOrders',
        query: {
          MarketplaceIds: ['A1F83G8C2ARO7P'], // UK marketplace
          CreatedAfter: createdAfter.toISOString(),
          CreatedBefore: createdBefore.toISOString(),
          OrderStatuses: orderStatuses,
          MaxResultsPerPage: maxResults
        }
      };

      if (nextToken) {
        params.query.NextToken = nextToken;
      }

      const response = await sp.callAPI(params);

      if (response.Orders) {
        allOrders.push(...response.Orders);
      }

      nextToken = response.NextToken;

      // Rate limiting - wait 1 second between requests
      if (nextToken) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

    } while (nextToken);

    return allOrders;

  } catch (error) {
    console.error('Error fetching orders from SP-API:', error.message);
    throw error;
  }
}

/**
 * Fetch order items for a specific order
 * @param {string} orderId - Amazon Order ID
 * @returns {Promise<Array>} Order items
 */
export async function fetchOrderItems(orderId) {
  const sp = getSpClient();
  if (!sp) {
    throw new Error('SP-API credentials not configured');
  }

  try {
    const response = await sp.callAPI({
      operation: 'getOrderItems',
      path: { orderId }
    });

    return response.OrderItems || [];

  } catch (error) {
    console.error(`Error fetching items for order ${orderId}:`, error.message);
    return [];
  }
}

/**
 * Sync orders from Amazon to database
 * @param {Object} options - Sync options
 * @returns {Promise<Object>} Sync results
 */
export async function syncOrders(options = {}) {
  const startTime = Date.now();
  const results = {
    ordersProcessed: 0,
    ordersCreated: 0,
    ordersUpdated: 0,
    itemsProcessed: 0,
    errors: []
  };

  try {
    // Determine date range
    let createdAfter;
    if (options.fullSync) {
      // Full sync: last 90 days
      createdAfter = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    } else {
      // Incremental: from last sync or 7 days
      const lastSync = await OrderRepository.getLastSyncTime();
      createdAfter = lastSync || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    }

    console.log(`📦 Starting order sync from ${createdAfter.toISOString()}`);

    // Fetch orders from Amazon
    const orders = await fetchOrders({
      createdAfter,
      createdBefore: new Date(),
      orderStatuses: options.orderStatuses || ['Unshipped', 'PartiallyShipped', 'Shipped', 'Canceled']
    });

    console.log(`📦 Fetched ${orders.length} orders from Amazon`);

    // Process each order
    for (const order of orders) {
      try {
        // Save order to database
        const savedOrder = await OrderRepository.upsertOrder(order);
        results.ordersProcessed++;

        // Fetch and save order items
        const items = await fetchOrderItems(order.AmazonOrderId);
        if (items.length > 0) {
          await OrderRepository.upsertOrderItems(savedOrder.id, order.AmazonOrderId, items);
          results.itemsProcessed += items.length;
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        results.errors.push({
          orderId: order.AmazonOrderId,
          error: error.message
        });
      }
    }

    // Calculate daily summaries for recent days
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      try {
        await OrderRepository.calculateDailySummary(date);
      } catch (e) {
        console.error(`Error calculating summary for ${date.toISOString()}:`, e.message);
      }
    }

    results.duration = Date.now() - startTime;
    console.log(`✅ Order sync complete: ${results.ordersProcessed} orders, ${results.itemsProcessed} items in ${results.duration}ms`);

    return results;

  } catch (error) {
    results.errors.push({ error: error.message });
    console.error('❌ Order sync failed:', error.message);
    throw error;
  }
}

/**
 * Get sync status
 * @returns {Promise<Object>} Current sync status
 */
export async function getSyncStatus() {
  const lastSync = await OrderRepository.getLastSyncTime();
  const counts = await OrderRepository.getOrderCounts();

  return {
    lastSync,
    orderCounts: counts,
    spApiConfigured: getSpClient() !== null
  };
}

export default {
  fetchOrders,
  fetchOrderItems,
  syncOrders,
  getSyncStatus
};
