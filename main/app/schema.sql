-- Complete Database Schema for Amazon Listing Helper
-- Run this to create/update all tables with correct structure

-- Listings table (main product listings)
CREATE TABLE IF NOT EXISTS listings (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(100) UNIQUE NOT NULL,
    asin VARCHAR(20),
    title TEXT,
    description TEXT,
    "bulletPoints" JSONB DEFAULT '[]',
    price DECIMAL(10,2) DEFAULT 0,
    quantity INTEGER DEFAULT 0,
    category VARCHAR(255),
    status VARCHAR(50) DEFAULT 'active',
    "currentScore" INTEGER,
    "fulfillmentChannel" VARCHAR(20) DEFAULT 'FBM',
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Listing images table
CREATE TABLE IF NOT EXISTS listing_images (
    id SERIAL PRIMARY KEY,
    "listingId" INTEGER REFERENCES listings(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    position INTEGER DEFAULT 0,
    variant VARCHAR(50),
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Scores table (listing quality scores)
CREATE TABLE IF NOT EXISTS scores (
    id SERIAL PRIMARY KEY,
    "listingId" INTEGER REFERENCES listings(id) ON DELETE CASCADE,
    "totalScore" INTEGER NOT NULL,
    "titleScore" INTEGER,
    "descriptionScore" INTEGER,
    "bulletScore" INTEGER,
    "imageScore" INTEGER,
    "keywordScore" INTEGER,
    "priceScore" INTEGER,
    "complianceScore" INTEGER,
    "competitiveScore" INTEGER,
    violations JSONB DEFAULT '[]',
    recommendations JSONB DEFAULT '[]',
    "calculatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    "listingId" INTEGER REFERENCES listings(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) DEFAULT 'info',
    title VARCHAR(255) NOT NULL,
    message TEXT,
    category VARCHAR(50),
    "actionUrl" TEXT,
    "isRead" BOOLEAN DEFAULT FALSE,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Keepa data table (price/sales tracking)
CREATE TABLE IF NOT EXISTS keepa_data (
    id SERIAL PRIMARY KEY,
    "listingId" INTEGER REFERENCES listings(id) ON DELETE CASCADE,
    asin VARCHAR(20) NOT NULL,
    "priceHistory" JSONB,
    "salesRankHistory" JSONB,
    "buyBoxHistory" JSONB,
    "competitorCount" INTEGER,
    "avgPrice" DECIMAL(10,2),
    "fetchedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value JSONB,
    description TEXT,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tasks table (kanban board tasks)
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    "listingId" INTEGER REFERENCES listings(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255),
    description TEXT,
    stage VARCHAR(50) DEFAULT 'backlog',
    priority VARCHAR(20) DEFAULT 'medium',
    status VARCHAR(20) DEFAULT 'pending',
    archived BOOLEAN DEFAULT FALSE,
    payload JSONB,
    result JSONB,
    error TEXT,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP,
    "completedAt" TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_listings_sku ON listings(sku);
CREATE INDEX IF NOT EXISTS idx_listings_asin ON listings(asin);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listing_images_listing_id ON listing_images("listingId");
CREATE INDEX IF NOT EXISTS idx_scores_listing_id ON scores("listingId");
CREATE INDEX IF NOT EXISTS idx_scores_calculated_at ON scores("calculatedAt");
CREATE INDEX IF NOT EXISTS idx_alerts_listing_id ON alerts("listingId");
CREATE INDEX IF NOT EXISTS idx_alerts_is_read ON alerts("isRead");
CREATE INDEX IF NOT EXISTS idx_keepa_listing_id ON keepa_data("listingId");
CREATE INDEX IF NOT EXISTS idx_keepa_asin ON keepa_data(asin);
CREATE INDEX IF NOT EXISTS idx_tasks_stage ON tasks(stage);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_archived ON tasks(archived);
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);

SELECT 'Schema created/updated successfully!' AS result;
