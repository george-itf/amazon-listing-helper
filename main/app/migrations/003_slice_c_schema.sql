-- Migration: Slice C Schema
-- Version: 003
-- Date: 2026-01-20
-- Purpose: Add snapshots, feature store, and ASIN entities per SPEC

-- ============================================================================
-- 1. ASIN_ENTITIES TABLE (DATA_CONTRACTS §1.2)
-- Canonical table for ASIN data
-- ============================================================================
CREATE TABLE IF NOT EXISTS asin_entities (
    id SERIAL PRIMARY KEY,
    asin VARCHAR(20) NOT NULL,
    marketplace_id INTEGER NOT NULL REFERENCES marketplaces(id),
    title TEXT,
    brand VARCHAR(255),
    category VARCHAR(255),
    subcategory VARCHAR(255),
    main_image_url TEXT,
    listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,  -- Linked if converted to listing
    is_tracked BOOLEAN DEFAULT FALSE,                                -- In research pool
    tracked_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT asin_entities_unique UNIQUE (asin, marketplace_id)
);

CREATE INDEX IF NOT EXISTS idx_asin_entities_asin ON asin_entities(asin);
CREATE INDEX IF NOT EXISTS idx_asin_entities_marketplace ON asin_entities(marketplace_id);
CREATE INDEX IF NOT EXISTS idx_asin_entities_listing ON asin_entities(listing_id);
CREATE INDEX IF NOT EXISTS idx_asin_entities_tracked ON asin_entities(is_tracked) WHERE is_tracked = true;

-- ============================================================================
-- 2. KEEPA_SNAPSHOTS TABLE (DATA_CONTRACTS §8.1)
-- ============================================================================
CREATE TABLE IF NOT EXISTS keepa_snapshots (
    id SERIAL PRIMARY KEY,
    asin VARCHAR(20) NOT NULL,
    marketplace_id INTEGER NOT NULL REFERENCES marketplaces(id),
    asin_entity_id INTEGER REFERENCES asin_entities(id) ON DELETE SET NULL,
    raw_json JSONB,                                      -- Unmodified Keepa API response
    parsed_json JSONB,                                   -- Extracted metrics
    captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_keepa_snapshots_asin ON keepa_snapshots(asin);
CREATE INDEX IF NOT EXISTS idx_keepa_snapshots_marketplace ON keepa_snapshots(marketplace_id);
CREATE INDEX IF NOT EXISTS idx_keepa_snapshots_asin_entity ON keepa_snapshots(asin_entity_id);
CREATE INDEX IF NOT EXISTS idx_keepa_snapshots_captured ON keepa_snapshots(asin, marketplace_id, captured_at DESC);

-- ============================================================================
-- 3. AMAZON_CATALOG_SNAPSHOTS TABLE (DATA_CONTRACTS §8.2)
-- ============================================================================
CREATE TABLE IF NOT EXISTS amazon_catalog_snapshots (
    id SERIAL PRIMARY KEY,
    asin VARCHAR(20) NOT NULL,
    marketplace_id INTEGER NOT NULL REFERENCES marketplaces(id),
    asin_entity_id INTEGER REFERENCES asin_entities(id) ON DELETE SET NULL,
    raw_json JSONB,                                      -- Unmodified SP-API response
    parsed_json JSONB,                                   -- Extracted attributes
    captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_amazon_catalog_asin ON amazon_catalog_snapshots(asin);
CREATE INDEX IF NOT EXISTS idx_amazon_catalog_marketplace ON amazon_catalog_snapshots(marketplace_id);
CREATE INDEX IF NOT EXISTS idx_amazon_catalog_asin_entity ON amazon_catalog_snapshots(asin_entity_id);
CREATE INDEX IF NOT EXISTS idx_amazon_catalog_captured ON amazon_catalog_snapshots(asin, marketplace_id, captured_at DESC);

-- ============================================================================
-- 4. LISTING_SALES_DAILY TABLE (DATA_CONTRACTS §8.4)
-- Time series, one row per day
-- ============================================================================
CREATE TABLE IF NOT EXISTS listing_sales_daily (
    id SERIAL PRIMARY KEY,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    units INTEGER DEFAULT 0,
    revenue_inc_vat NUMERIC(12,2) DEFAULT 0,
    sessions INTEGER,                                    -- Nullable
    page_views INTEGER,                                  -- Nullable
    conversion_rate NUMERIC(5,4),                        -- Nullable
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT listing_sales_daily_unique UNIQUE (listing_id, date)
);

CREATE INDEX IF NOT EXISTS idx_listing_sales_daily_listing ON listing_sales_daily(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_sales_daily_date ON listing_sales_daily(listing_id, date DESC);

-- ============================================================================
-- 5. FEATURE_STORE TABLE (DATA_CONTRACTS §9)
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE feature_entity_type AS ENUM ('LISTING', 'ASIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS feature_store (
    id SERIAL PRIMARY KEY,
    entity_type feature_entity_type NOT NULL,
    entity_id INTEGER NOT NULL,                          -- listing_id or asin_entity_id
    feature_version INTEGER NOT NULL DEFAULT 1,
    features_json JSONB NOT NULL,
    computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feature_store_entity ON feature_store(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_feature_store_computed ON feature_store(entity_type, entity_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_store_version ON feature_store(feature_version);

-- ============================================================================
-- 6. ADD ASIN TO LISTINGS IF NOT EXISTS
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'listings' AND column_name = 'asin'
    ) THEN
        ALTER TABLE listings ADD COLUMN asin VARCHAR(20);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_listings_asin ON listings(asin);

-- ============================================================================
-- 7. ADD FK FROM BOMS TO ASIN_ENTITIES
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'boms_asin_entity_fk'
    ) THEN
        ALTER TABLE boms ADD CONSTRAINT boms_asin_entity_fk
            FOREIGN KEY (asin_entity_id) REFERENCES asin_entities(id) ON DELETE CASCADE;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 8. ADD ASIN SCENARIO BOM INDEX
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS boms_asin_active_unique
ON boms (asin_entity_id)
WHERE is_active = true AND scope_type = 'ASIN_SCENARIO' AND asin_entity_id IS NOT NULL;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
SELECT 'Slice C migration completed successfully!' AS result;
