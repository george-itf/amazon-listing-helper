-- Migration: Slice B Schema
-- Version: 002
-- Date: 2026-01-20
-- Purpose: Add jobs, listing_events, and guardrails enforcement per SPEC

-- ============================================================================
-- 1. JOB TYPES ENUM (SPEC §6.1, DATA_CONTRACTS §10.2)
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE job_type AS ENUM (
        'SYNC_AMAZON_OFFER',
        'SYNC_AMAZON_SALES',
        'SYNC_AMAZON_CATALOG',
        'SYNC_KEEPA_ASIN',
        'COMPUTE_FEATURES_LISTING',
        'COMPUTE_FEATURES_ASIN',
        'GENERATE_RECOMMENDATIONS_LISTING',
        'GENERATE_RECOMMENDATIONS_ASIN',
        'PUBLISH_PRICE_CHANGE',
        'PUBLISH_STOCK_CHANGE'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 2. JOB STATUS ENUM (DATA_CONTRACTS §10.1)
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE job_status AS ENUM (
        'PENDING',
        'RUNNING',
        'SUCCEEDED',
        'FAILED',
        'CANCELLED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 3. JOB SCOPE ENUM
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE job_scope_type AS ENUM (
        'LISTING',
        'ASIN',
        'GLOBAL'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 4. JOBS TABLE (DATA_CONTRACTS §10)
-- ============================================================================
CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY,
    job_type job_type NOT NULL,
    scope_type job_scope_type NOT NULL DEFAULT 'LISTING',
    listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
    asin_entity_id INTEGER,                              -- FK added in Slice E
    status job_status NOT NULL DEFAULT 'PENDING',
    priority INTEGER DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 5,
    input_json JSONB,                                    -- Job input parameters
    result_json JSONB,                                   -- Job result/output
    log_json JSONB DEFAULT '[]',                         -- Execution logs
    error_message TEXT,                                  -- Last error if failed
    scheduled_for TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    created_by VARCHAR(100) DEFAULT 'system',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_jobs_listing ON jobs(listing_id);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled ON jobs(scheduled_for) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);

-- ============================================================================
-- 5. LISTING EVENT TYPES ENUM (SPEC §4.15)
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE listing_event_type AS ENUM (
        'PRICE_CHANGE_DRAFTED',
        'PRICE_CHANGE_PUBLISHED',
        'PRICE_CHANGE_SUCCEEDED',
        'PRICE_CHANGE_FAILED',
        'STOCK_CHANGE_DRAFTED',
        'STOCK_CHANGE_PUBLISHED',
        'STOCK_CHANGE_SUCCEEDED',
        'STOCK_CHANGE_FAILED',
        'BOM_UPDATED',
        'COST_OVERRIDE_UPDATED',
        'AMAZON_SYNC_COMPLETED',
        'KEEPA_SYNC_COMPLETED',
        'FEATURES_COMPUTED',
        'LISTING_CREATED',
        'LISTING_ARCHIVED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 6. LISTING_EVENTS TABLE (SPEC §4.15)
-- Audit trail for all listing-related changes
-- ============================================================================
CREATE TABLE IF NOT EXISTS listing_events (
    id SERIAL PRIMARY KEY,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    event_type listing_event_type NOT NULL,
    job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,

    -- State before/after for audit trail
    before_json JSONB,                                   -- State before change
    after_json JSONB,                                    -- State after change

    -- Metadata
    reason TEXT,                                         -- Why this change was made
    correlation_id VARCHAR(100),                         -- Client-provided tracking ID
    created_by VARCHAR(100) DEFAULT 'system',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_listing_events_listing ON listing_events(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_events_type ON listing_events(event_type);
CREATE INDEX IF NOT EXISTS idx_listing_events_job ON listing_events(job_id);
CREATE INDEX IF NOT EXISTS idx_listing_events_created ON listing_events(created_at);
CREATE INDEX IF NOT EXISTS idx_listing_events_correlation ON listing_events(correlation_id) WHERE correlation_id IS NOT NULL;

-- ============================================================================
-- 7. LISTING_OFFER_CURRENT TABLE (DATA_CONTRACTS §8.3)
-- Current offer state (not historical)
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE buy_box_status_type AS ENUM (
        'WON',
        'LOST',
        'UNKNOWN'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS listing_offer_current (
    listing_id INTEGER PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
    price_inc_vat NUMERIC(12,2),
    available_quantity INTEGER,
    buy_box_status buy_box_status_type DEFAULT 'UNKNOWN',
    buy_box_percentage_30d NUMERIC(5,2),                 -- Nullable
    buy_box_price NUMERIC(12,2),                         -- Current BB winner price
    is_buy_box_winner BOOLEAN,
    observed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 8. FEE_SNAPSHOTS TABLE (SPEC §4.14)
-- Amazon fee snapshots for economics calculations
-- ============================================================================
CREATE TABLE IF NOT EXISTS fee_snapshots (
    id SERIAL PRIMARY KEY,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    price_inc_vat NUMERIC(12,2) NOT NULL,                -- Price at time of snapshot
    referral_fee_ex_vat NUMERIC(12,2),
    fba_fee_ex_vat NUMERIC(12,2),                        -- Null for FBM
    variable_closing_fee_ex_vat NUMERIC(12,2),
    per_item_fee_ex_vat NUMERIC(12,2),
    total_fee_ex_vat NUMERIC(12,2) NOT NULL,
    category VARCHAR(100),
    fulfillment_channel VARCHAR(10) DEFAULT 'FBM',       -- FBM or FBA
    raw_json JSONB,                                      -- Raw API response
    captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fee_snapshots_listing ON fee_snapshots(listing_id);
CREATE INDEX IF NOT EXISTS idx_fee_snapshots_captured ON fee_snapshots(listing_id, captured_at DESC);

-- ============================================================================
-- 9. UPDATE GUARDRAILS SETTINGS (ensure all exist)
-- ============================================================================
INSERT INTO settings (key, value, description)
VALUES
    ('guardrails.min_margin', '0.15', 'Minimum acceptable profit margin (0.15 = 15%)'),
    ('guardrails.max_price_change_pct_per_day', '0.05', 'Maximum price change per day (0.05 = 5%)'),
    ('guardrails.min_days_of_cover_before_price_change', '7', 'Min stock days before allowing price cut'),
    ('guardrails.min_stock_threshold', '5', 'Minimum stock level before alerts'),
    ('guardrails.allow_price_below_break_even', 'false', 'Allow prices below break-even (dangerous)')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 10. ADD STATUS TO LISTINGS IF NOT EXISTS
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'listings' AND column_name = 'status'
    ) THEN
        ALTER TABLE listings ADD COLUMN status VARCHAR(20) DEFAULT 'active';
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);

-- ============================================================================
-- 11. ADD FULFILLMENT_CHANNEL TO LISTINGS IF NOT EXISTS
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'listings' AND column_name = 'fulfillment_channel'
    ) THEN
        ALTER TABLE listings ADD COLUMN fulfillment_channel VARCHAR(10) DEFAULT 'FBM';
    END IF;
END $$;

-- ============================================================================
-- 12. ADD CATEGORY TO LISTINGS IF NOT EXISTS
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'listings' AND column_name = 'category'
    ) THEN
        ALTER TABLE listings ADD COLUMN category VARCHAR(100);
    END IF;
END $$;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
SELECT 'Slice B migration completed successfully!' AS result;
