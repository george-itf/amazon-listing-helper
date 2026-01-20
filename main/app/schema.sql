-- Amazon Listing Helper Database Schema
-- Updated schema matching repository layer expectations

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Drop existing tables (for clean setup)
DROP TABLE IF EXISTS listing_images CASCADE;
DROP TABLE IF EXISTS listing_scores CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS alerts CASCADE;
DROP TABLE IF EXISTS keepa_data CASCADE;
DROP TABLE IF EXISTS settings CASCADE;
DROP TABLE IF EXISTS listings CASCADE;

-- =====================
-- LISTINGS TABLE
-- =====================
CREATE TABLE listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku VARCHAR(50) NOT NULL UNIQUE,
    asin VARCHAR(10) NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    "bulletPoints" JSONB DEFAULT '[]',
    price DECIMAL(10,2),
    quantity INTEGER DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    category VARCHAR(100),
    fulfillment VARCHAR(10) DEFAULT 'FBM',
    "fulfillmentChannel" VARCHAR(10) DEFAULT 'FBM',
    "openDate" TIMESTAMPTZ,
    "imageUrl" TEXT,

    -- Denormalized current score for quick access
    "currentScore" DECIMAL(5,2),
    "scoreUpdatedAt" TIMESTAMPTZ,

    -- Timestamps
    "createdAt" TIMESTAMPTZ DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_listings_asin ON listings(asin);
CREATE INDEX idx_listings_sku ON listings(sku);
CREATE INDEX idx_listings_status ON listings(status);
CREATE INDEX idx_listings_category ON listings(category);
CREATE INDEX idx_listings_score ON listings("currentScore" DESC NULLS LAST);

-- =====================
-- LISTING IMAGES TABLE
-- =====================
CREATE TABLE listing_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "listingId" UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    "imageType" VARCHAR(20) NOT NULL DEFAULT 'main',
    url TEXT NOT NULL,
    position INTEGER DEFAULT 0,
    variant VARCHAR(50),
    "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_images_listing ON listing_images("listingId");

-- =====================
-- LISTING SCORES TABLE
-- =====================
CREATE TABLE listing_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "listingId" UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,

    -- Overall score
    "totalScore" DECIMAL(5,2) NOT NULL,

    -- Component scores
    "seoScore" DECIMAL(5,2),
    "contentScore" DECIMAL(5,2),
    "imageScore" DECIMAL(5,2),
    "competitiveScore" DECIMAL(5,2),
    "complianceScore" DECIMAL(5,2),

    -- Violations per component (JSONB arrays)
    "seoViolations" JSONB DEFAULT '[]',
    "contentViolations" JSONB DEFAULT '[]',
    "imageViolations" JSONB DEFAULT '[]',
    "competitiveViolations" JSONB DEFAULT '[]',
    "complianceViolations" JSONB DEFAULT '[]',

    -- Detailed breakdown as JSONB
    breakdown JSONB,

    -- Recommendations
    recommendations JSONB,

    -- Timestamps
    "calculatedAt" TIMESTAMPTZ DEFAULT NOW(),
    "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scores_listing ON listing_scores("listingId");
CREATE INDEX idx_scores_calculated ON listing_scores("calculatedAt" DESC);
CREATE INDEX idx_scores_total ON listing_scores("totalScore" DESC);

-- =====================
-- TASKS TABLE
-- =====================
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,

    -- Task type and classification
    "taskType" VARCHAR(30) NOT NULL DEFAULT 'optimization',
    stage VARCHAR(20) NOT NULL DEFAULT 'backlog',
    priority VARCHAR(10) DEFAULT 'medium',

    -- Related listing
    sku VARCHAR(50),
    asin VARCHAR(10),
    "listingId" UUID REFERENCES listings(id) ON DELETE SET NULL,

    -- Workflow
    "dueDate" DATE,
    "order" INTEGER DEFAULT 0,
    archived BOOLEAN DEFAULT FALSE,

    -- Source tracking
    "createdBy" VARCHAR(20) DEFAULT 'system',

    -- Completion
    "completedAt" TIMESTAMPTZ,

    -- Timestamps
    "createdAt" TIMESTAMPTZ DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_stage ON tasks(stage);
CREATE INDEX idx_tasks_sku ON tasks(sku);
CREATE INDEX idx_tasks_listing ON tasks("listingId");
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_tasks_due ON tasks("dueDate");
CREATE INDEX idx_tasks_archived ON tasks(archived);

-- =====================
-- ALERTS TABLE
-- =====================
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "ruleId" VARCHAR(50),
    "ruleName" VARCHAR(100),

    -- Related listing (can be linked by ID or SKU/ASIN)
    "listingId" UUID REFERENCES listings(id) ON DELETE SET NULL,
    sku VARCHAR(50),
    asin VARCHAR(10),
    title TEXT,

    -- Alert classification
    type VARCHAR(50) NOT NULL DEFAULT 'general',
    severity VARCHAR(10) DEFAULT 'medium',

    -- Alert details
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',

    -- Status
    read BOOLEAN DEFAULT FALSE,
    dismissed BOOLEAN DEFAULT FALSE,
    "readAt" TIMESTAMPTZ,
    "dismissedAt" TIMESTAMPTZ,

    -- Timestamps
    "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alerts_listing ON alerts("listingId");
CREATE INDEX idx_alerts_sku ON alerts(sku);
CREATE INDEX idx_alerts_type ON alerts(type);
CREATE INDEX idx_alerts_severity ON alerts(severity);
CREATE INDEX idx_alerts_read ON alerts(read);
CREATE INDEX idx_alerts_created ON alerts("createdAt" DESC);

-- =====================
-- KEEPA DATA TABLE
-- =====================
CREATE TABLE keepa_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asin VARCHAR(10) NOT NULL UNIQUE,

    -- Current metrics
    "currentPrice" DECIMAL(10,2),
    "currentBSR" INTEGER,
    "avgPrice30" DECIMAL(10,2),
    "avgBSR30" INTEGER,

    -- Competitive info
    "competitorCount" INTEGER DEFAULT 0,
    "amazonOnListing" BOOLEAN DEFAULT FALSE,
    "buyBoxSeller" VARCHAR(255),
    "buyBoxPrice" DECIMAL(10,2),

    -- Reviews
    rating DECIMAL(3,2),
    "reviewCount" INTEGER,

    -- History (stored as JSONB)
    "priceHistory" JSONB,
    "bsrHistory" JSONB,

    -- Sales estimate
    "salesEstimate" INTEGER,

    -- Sync tracking
    "lastSyncedAt" TIMESTAMPTZ DEFAULT NOW(),
    "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_keepa_asin ON keepa_data(asin);
CREATE INDEX idx_keepa_bsr ON keepa_data("currentBSR");
CREATE INDEX idx_keepa_synced ON keepa_data("lastSyncedAt");

-- =====================
-- SETTINGS TABLE
-- =====================
CREATE TABLE settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    "createdAt" TIMESTAMPTZ DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings
INSERT INTO settings (key, value, description) VALUES
('scoring_weights', '{"seo": 0.20, "content": 0.20, "images": 0.15, "competitive": 0.20, "compliance": 0.25}', 'Weights for overall score calculation'),
('sync_interval_minutes', '60', 'How often to sync from external APIs'),
('alert_thresholds', '{"low_score": 60, "price_drop_pct": 10}', 'Alert threshold settings');

-- =====================
-- HELPER VIEWS
-- =====================

-- View for listings with their latest score
CREATE OR REPLACE VIEW listings_with_scores AS
SELECT
    l.*,
    ls."totalScore" as latest_score,
    ls."seoScore" as latest_seo_score,
    ls."contentScore" as latest_content_score,
    ls."imageScore" as latest_image_score,
    ls."competitiveScore" as latest_competitive_score,
    ls."complianceScore" as latest_compliance_score,
    ls.recommendations as latest_recommendations
FROM listings l
LEFT JOIN LATERAL (
    SELECT * FROM listing_scores
    WHERE "listingId" = l.id
    ORDER BY "calculatedAt" DESC
    LIMIT 1
) ls ON true;

-- View for task counts by stage
CREATE OR REPLACE VIEW task_counts_by_stage AS
SELECT
    stage,
    COUNT(*) as count
FROM tasks
WHERE archived = FALSE
GROUP BY stage;

-- View for alert summary
CREATE OR REPLACE VIEW alert_summary AS
SELECT
    severity,
    read,
    COUNT(*) as count
FROM alerts
WHERE dismissed = FALSE
GROUP BY severity, read;

COMMENT ON TABLE listings IS 'Core product listings synchronized from Amazon Seller Central';
COMMENT ON TABLE listing_scores IS 'ML-generated quality scores for listings, stored over time';
COMMENT ON TABLE tasks IS 'Kanban board tasks for listing optimization workflow';
COMMENT ON TABLE alerts IS 'Automated alerts for score drops, competitive changes, etc.';
COMMENT ON TABLE keepa_data IS 'Competitive intelligence data from Keepa API';
COMMENT ON TABLE settings IS 'Application configuration settings';
