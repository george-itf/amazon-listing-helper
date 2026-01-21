-- Orders and Sales Schema for Amazon Listing Helper
-- Add orders and order_items tables for SP-API order data

-- Orders table (main order header)
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    "amazonOrderId" VARCHAR(50) UNIQUE NOT NULL,
    "purchaseDate" TIMESTAMP NOT NULL,
    "lastUpdateDate" TIMESTAMP,
    "orderStatus" VARCHAR(50) NOT NULL,
    "fulfillmentChannel" VARCHAR(20),
    "salesChannel" VARCHAR(100),
    "orderTotal" DECIMAL(10,2),
    "orderCurrency" VARCHAR(10) DEFAULT 'GBP',
    "numberOfItemsShipped" INTEGER DEFAULT 0,
    "numberOfItemsUnshipped" INTEGER DEFAULT 0,
    "paymentMethod" VARCHAR(50),
    "marketplaceId" VARCHAR(50),
    "shipmentServiceLevelCategory" VARCHAR(50),
    "shippingAddress" JSONB,
    "buyerInfo" JSONB,
    "isPrime" BOOLEAN DEFAULT FALSE,
    "isBusinessOrder" BOOLEAN DEFAULT FALSE,
    "earliestDeliveryDate" TIMESTAMP,
    "latestDeliveryDate" TIMESTAMP,
    "syncedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Order items table (line items in each order)
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    "orderId" INTEGER REFERENCES orders(id) ON DELETE CASCADE,
    "amazonOrderId" VARCHAR(50) NOT NULL,
    "orderItemId" VARCHAR(50) NOT NULL,
    asin VARCHAR(20),
    sku VARCHAR(100),
    title TEXT,
    "quantityOrdered" INTEGER DEFAULT 1,
    "quantityShipped" INTEGER DEFAULT 0,
    "itemPrice" DECIMAL(10,2),
    "itemTax" DECIMAL(10,2) DEFAULT 0,
    "shippingPrice" DECIMAL(10,2) DEFAULT 0,
    "shippingTax" DECIMAL(10,2) DEFAULT 0,
    "promotionDiscount" DECIMAL(10,2) DEFAULT 0,
    "itemCurrency" VARCHAR(10) DEFAULT 'GBP',
    "conditionId" VARCHAR(50),
    "isGift" BOOLEAN DEFAULT FALSE,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("amazonOrderId", "orderItemId")
);

-- Daily sales summary table (aggregated for quick dashboard)
CREATE TABLE IF NOT EXISTS sales_summary (
    id SERIAL PRIMARY KEY,
    "summaryDate" DATE UNIQUE NOT NULL,
    "totalOrders" INTEGER DEFAULT 0,
    "totalUnits" INTEGER DEFAULT 0,
    "totalRevenue" DECIMAL(12,2) DEFAULT 0,
    "totalShipping" DECIMAL(10,2) DEFAULT 0,
    "totalTax" DECIMAL(10,2) DEFAULT 0,
    "avgOrderValue" DECIMAL(10,2) DEFAULT 0,
    "topSkus" JSONB DEFAULT '[]',
    "calculatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- SKU sales performance (aggregated by SKU)
CREATE TABLE IF NOT EXISTS sku_sales (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(100) NOT NULL,
    asin VARCHAR(20),
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "periodType" VARCHAR(20) DEFAULT 'daily',
    "unitsOrdered" INTEGER DEFAULT 0,
    "unitsShipped" INTEGER DEFAULT 0,
    "revenue" DECIMAL(12,2) DEFAULT 0,
    "orderCount" INTEGER DEFAULT 0,
    "avgSellingPrice" DECIMAL(10,2) DEFAULT 0,
    "calculatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sku, "periodStart", "periodEnd", "periodType")
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_orders_amazon_order_id ON orders("amazonOrderId");
CREATE INDEX IF NOT EXISTS idx_orders_purchase_date ON orders("purchaseDate");
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders("orderStatus");
CREATE INDEX IF NOT EXISTS idx_orders_synced_at ON orders("syncedAt");
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items("orderId");
CREATE INDEX IF NOT EXISTS idx_order_items_sku ON order_items(sku);
CREATE INDEX IF NOT EXISTS idx_order_items_asin ON order_items(asin);
CREATE INDEX IF NOT EXISTS idx_sales_summary_date ON sales_summary("summaryDate");
CREATE INDEX IF NOT EXISTS idx_sku_sales_sku ON sku_sales(sku);
CREATE INDEX IF NOT EXISTS idx_sku_sales_period ON sku_sales("periodStart", "periodEnd");

SELECT 'Orders schema created successfully!' AS result;
