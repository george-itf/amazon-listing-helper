/**
 * Order Repository
 * Handles all database operations for orders and sales data
 */

import { query, transaction } from '../database/connection.js';

/**
 * Upsert an order from SP-API
 * @param {Object} orderData - Order data from Amazon
 * @returns {Promise<Object>} Saved order
 */
export async function upsertOrder(orderData) {
  const sql = `
    INSERT INTO orders (
      "amazonOrderId", "purchaseDate", "lastUpdateDate", "orderStatus",
      "fulfillmentChannel", "salesChannel", "orderTotal", "orderCurrency",
      "numberOfItemsShipped", "numberOfItemsUnshipped", "paymentMethod",
      "marketplaceId", "shipmentServiceLevelCategory", "shippingAddress",
      "buyerInfo", "isPrime", "isBusinessOrder", "earliestDeliveryDate",
      "latestDeliveryDate", "syncedAt"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, CURRENT_TIMESTAMP)
    ON CONFLICT ("amazonOrderId") DO UPDATE SET
      "lastUpdateDate" = EXCLUDED."lastUpdateDate",
      "orderStatus" = EXCLUDED."orderStatus",
      "numberOfItemsShipped" = EXCLUDED."numberOfItemsShipped",
      "numberOfItemsUnshipped" = EXCLUDED."numberOfItemsUnshipped",
      "shippingAddress" = EXCLUDED."shippingAddress",
      "syncedAt" = CURRENT_TIMESTAMP
    RETURNING *
  `;

  const params = [
    orderData.AmazonOrderId,
    orderData.PurchaseDate,
    orderData.LastUpdateDate,
    orderData.OrderStatus,
    orderData.FulfillmentChannel,
    orderData.SalesChannel,
    parseFloat(orderData.OrderTotal?.Amount) || 0,
    orderData.OrderTotal?.CurrencyCode || 'GBP',
    orderData.NumberOfItemsShipped || 0,
    orderData.NumberOfItemsUnshipped || 0,
    orderData.PaymentMethod,
    orderData.MarketplaceId,
    orderData.ShipmentServiceLevelCategory,
    JSON.stringify(orderData.ShippingAddress || {}),
    JSON.stringify(orderData.BuyerInfo || {}),
    orderData.IsPrime || false,
    orderData.IsBusinessOrder || false,
    orderData.EarliestDeliveryDate,
    orderData.LatestDeliveryDate
  ];

  const result = await query(sql, params);
  return result.rows[0];
}

/**
 * Upsert order items from SP-API
 * @param {number} orderId - Database order ID
 * @param {string} amazonOrderId - Amazon order ID
 * @param {Array} items - Order items from Amazon
 * @returns {Promise<Array>} Saved order items
 */
export async function upsertOrderItems(orderId, amazonOrderId, items) {
  const results = [];

  for (const item of items) {
    const sql = `
      INSERT INTO order_items (
        "orderId", "amazonOrderId", "orderItemId", asin, sku, title,
        "quantityOrdered", "quantityShipped", "itemPrice", "itemTax",
        "shippingPrice", "shippingTax", "promotionDiscount", "itemCurrency",
        "conditionId", "isGift"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT ("amazonOrderId", "orderItemId") DO UPDATE SET
        "quantityShipped" = EXCLUDED."quantityShipped",
        "itemPrice" = EXCLUDED."itemPrice"
      RETURNING *
    `;

    const params = [
      orderId,
      amazonOrderId,
      item.OrderItemId,
      item.ASIN,
      item.SellerSKU,
      item.Title,
      item.QuantityOrdered || 1,
      item.QuantityShipped || 0,
      parseFloat(item.ItemPrice?.Amount) || 0,
      parseFloat(item.ItemTax?.Amount) || 0,
      parseFloat(item.ShippingPrice?.Amount) || 0,
      parseFloat(item.ShippingTax?.Amount) || 0,
      parseFloat(item.PromotionDiscount?.Amount) || 0,
      item.ItemPrice?.CurrencyCode || 'GBP',
      item.ConditionId,
      item.IsGift || false
    ];

    const result = await query(sql, params);
    results.push(result.rows[0]);
  }

  return results;
}

/**
 * Get orders with optional filters
 * @param {Object} filters - Filter options
 * @returns {Promise<Array>} Orders with items
 */
export async function getOrders(filters = {}) {
  let sql = `
    SELECT
      o.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id', oi.id,
            'orderItemId', oi."orderItemId",
            'asin', oi.asin,
            'sku', oi.sku,
            'title', oi.title,
            'quantityOrdered', oi."quantityOrdered",
            'quantityShipped', oi."quantityShipped",
            'itemPrice', oi."itemPrice",
            'itemTax', oi."itemTax"
          )
        ) FILTER (WHERE oi.id IS NOT NULL),
        '[]'
      ) as items
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi."orderId"
    WHERE 1=1
  `;

  const params = [];
  let paramCount = 1;

  if (filters.status) {
    sql += ` AND o."orderStatus" = $${paramCount++}`;
    params.push(filters.status);
  }

  if (filters.startDate) {
    sql += ` AND o."purchaseDate" >= $${paramCount++}`;
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    sql += ` AND o."purchaseDate" <= $${paramCount++}`;
    params.push(filters.endDate);
  }

  if (filters.sku) {
    sql += ` AND EXISTS (SELECT 1 FROM order_items oi2 WHERE oi2."orderId" = o.id AND oi2.sku = $${paramCount++})`;
    params.push(filters.sku);
  }

  sql += ` GROUP BY o.id ORDER BY o."purchaseDate" DESC`;

  if (filters.limit) {
    sql += ` LIMIT $${paramCount++}`;
    params.push(filters.limit);
  }

  if (filters.offset) {
    sql += ` OFFSET $${paramCount++}`;
    params.push(filters.offset);
  }

  const result = await query(sql, params);
  return result.rows;
}

/**
 * Get order count by status
 * @returns {Promise<Object>} Counts by status
 */
export async function getOrderCounts() {
  const sql = `
    SELECT
      "orderStatus",
      COUNT(*) as count
    FROM orders
    GROUP BY "orderStatus"
  `;
  const result = await query(sql);

  const counts = { total: 0 };
  result.rows.forEach(row => {
    counts[row.orderStatus] = parseInt(row.count);
    counts.total += parseInt(row.count);
  });

  return counts;
}

/**
 * Get sales summary for a date range
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<Object>} Sales summary
 */
export async function getSalesSummary(startDate, endDate) {
  const sql = `
    SELECT
      COUNT(DISTINCT o.id) as "totalOrders",
      SUM(oi."quantityOrdered") as "totalUnits",
      SUM(oi."itemPrice" * oi."quantityOrdered") as "totalRevenue",
      SUM(oi."shippingPrice") as "totalShipping",
      SUM(oi."itemTax" + oi."shippingTax") as "totalTax",
      AVG(o."orderTotal") as "avgOrderValue"
    FROM orders o
    JOIN order_items oi ON o.id = oi."orderId"
    WHERE o."purchaseDate" >= $1 AND o."purchaseDate" <= $2
      AND o."orderStatus" NOT IN ('Cancelled', 'Pending')
  `;

  const result = await query(sql, [startDate, endDate]);
  return result.rows[0];
}

/**
 * Get daily sales for charting
 * @param {number} days - Number of days to look back
 * @returns {Promise<Array>} Daily sales data
 */
export async function getDailySales(days = 30) {
  const sql = `
    SELECT
      DATE(o."purchaseDate") as date,
      COUNT(DISTINCT o.id) as orders,
      SUM(oi."quantityOrdered") as units,
      SUM(oi."itemPrice" * oi."quantityOrdered") as revenue
    FROM orders o
    JOIN order_items oi ON o.id = oi."orderId"
    WHERE o."purchaseDate" >= NOW() - INTERVAL '1 day' * $1
      AND o."orderStatus" NOT IN ('Cancelled', 'Pending')
    GROUP BY DATE(o."purchaseDate")
    ORDER BY date DESC
  `;

  const result = await query(sql, [days]);
  return result.rows;
}

/**
 * Get top selling SKUs
 * @param {number} days - Number of days to look back
 * @param {number} limit - Number of SKUs to return
 * @returns {Promise<Array>} Top SKUs with sales data
 */
export async function getTopSkus(days = 30, limit = 10) {
  const sql = `
    SELECT
      oi.sku,
      oi.asin,
      MAX(oi.title) as title,
      SUM(oi."quantityOrdered") as "unitsOrdered",
      SUM(oi."itemPrice" * oi."quantityOrdered") as revenue,
      COUNT(DISTINCT o.id) as "orderCount",
      AVG(oi."itemPrice") as "avgPrice"
    FROM orders o
    JOIN order_items oi ON o.id = oi."orderId"
    WHERE o."purchaseDate" >= NOW() - INTERVAL '1 day' * $1
      AND o."orderStatus" NOT IN ('Cancelled', 'Pending')
      AND oi.sku IS NOT NULL
    GROUP BY oi.sku, oi.asin
    ORDER BY "unitsOrdered" DESC
    LIMIT $2
  `;

  const result = await query(sql, [days, limit]);
  return result.rows;
}

/**
 * Get SKU sales performance over time
 * @param {string} sku - SKU to analyze
 * @param {number} days - Number of days
 * @returns {Promise<Array>} Daily sales for SKU
 */
export async function getSkuSalesHistory(sku, days = 30) {
  const sql = `
    SELECT
      DATE(o."purchaseDate") as date,
      SUM(oi."quantityOrdered") as units,
      SUM(oi."itemPrice" * oi."quantityOrdered") as revenue,
      COUNT(DISTINCT o.id) as orders
    FROM orders o
    JOIN order_items oi ON o.id = oi."orderId"
    WHERE oi.sku = $1
      AND o."purchaseDate" >= NOW() - INTERVAL '1 day' * $2
      AND o."orderStatus" NOT IN ('Cancelled', 'Pending')
    GROUP BY DATE(o."purchaseDate")
    ORDER BY date DESC
  `;

  const result = await query(sql, [sku, days]);
  return result.rows;
}

/**
 * Get the last sync timestamp
 * @returns {Promise<Date|null>} Last sync time
 */
export async function getLastSyncTime() {
  const sql = `SELECT MAX("syncedAt") as "lastSync" FROM orders`;
  const result = await query(sql);
  return result.rows[0]?.lastSync || null;
}

/**
 * Calculate and store daily summary
 * @param {Date} date - Date to summarize
 * @returns {Promise<Object>} Summary record
 */
export async function calculateDailySummary(date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const summaryData = await getSalesSummary(startOfDay, endOfDay);
  const topSkus = await getTopSkus(1, 5);

  const sql = `
    INSERT INTO sales_summary (
      "summaryDate", "totalOrders", "totalUnits", "totalRevenue",
      "totalShipping", "totalTax", "avgOrderValue", "topSkus", "calculatedAt"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
    ON CONFLICT ("summaryDate") DO UPDATE SET
      "totalOrders" = EXCLUDED."totalOrders",
      "totalUnits" = EXCLUDED."totalUnits",
      "totalRevenue" = EXCLUDED."totalRevenue",
      "totalShipping" = EXCLUDED."totalShipping",
      "totalTax" = EXCLUDED."totalTax",
      "avgOrderValue" = EXCLUDED."avgOrderValue",
      "topSkus" = EXCLUDED."topSkus",
      "calculatedAt" = CURRENT_TIMESTAMP
    RETURNING *
  `;

  const params = [
    startOfDay,
    summaryData.totalOrders || 0,
    summaryData.totalUnits || 0,
    summaryData.totalRevenue || 0,
    summaryData.totalShipping || 0,
    summaryData.totalTax || 0,
    summaryData.avgOrderValue || 0,
    JSON.stringify(topSkus)
  ];

  const result = await query(sql, params);
  return result.rows[0];
}

export default {
  upsertOrder,
  upsertOrderItems,
  getOrders,
  getOrderCounts,
  getSalesSummary,
  getDailySales,
  getTopSkus,
  getSkuSalesHistory,
  getLastSyncTime,
  calculateDailySummary
};
