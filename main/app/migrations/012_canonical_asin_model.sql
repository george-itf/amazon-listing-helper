-- Migration: Canonical ASIN Data Model
-- Version: 012
-- Date: 2026-01-23
-- Purpose: Introduce canonical ASIN data layer with raw payload persistence,
--          append-only historical snapshots, and materialized current state.
--          This is the foundation for the new recommendations engine.

-- ============================================================================
-- 1. RAW_PAYLOADS TABLE (Write-only landing zone)
-- Purpose: Immutable landing zone for exact raw responses from external APIs.
-- One row per (asin, source, ingestion_job_id)
-- ============================================================================
CREATE TABLE IF NOT EXISTS raw_payloads (
    id SERIAL PRIMARY KEY,
    asin VARCHAR(20) NOT NULL,
    marketplace_id INTEGER NOT NULL REFERENCES marketplaces(id),
    source VARCHAR(20) NOT NULL CHECK (source IN ('keepa', 'sp_api')),
    ingestion_job_id UUID NOT NULL,
    payload JSONB NOT NULL,                        -- Entire raw JSON response, unmodified
    captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT raw_payloads_unique UNIQUE (asin, marketplace_id, source, ingestion_job_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_payloads_asin ON raw_payloads(asin);
CREATE INDEX IF NOT EXISTS idx_raw_payloads_marketplace ON raw_payloads(marketplace_id);
CREATE INDEX IF NOT EXISTS idx_raw_payloads_job ON raw_payloads(ingestion_job_id);
CREATE INDEX IF NOT EXISTS idx_raw_payloads_source ON raw_payloads(source);
CREATE INDEX IF NOT EXISTS idx_raw_payloads_captured ON raw_payloads(asin, marketplace_id, captured_at DESC);

-- ============================================================================
-- 2. ASIN_SNAPSHOT TABLE (Append-only history)
-- Purpose: Historical record of what we knew about an ASIN at a point in time.
-- Never update rows - only insert.
-- ============================================================================
CREATE TABLE IF NOT EXISTS asin_snapshot (
    id SERIAL PRIMARY KEY,
    asin VARCHAR(20) NOT NULL,
    marketplace_id INTEGER NOT NULL REFERENCES marketplaces(id),
    asin_entity_id INTEGER REFERENCES asin_entities(id) ON DELETE SET NULL,
    ingestion_job_id UUID NOT NULL,

    -- Identity & catalogue
    title TEXT,
    brand VARCHAR(255),
    category_path TEXT,

    -- Pricing & Buy Box
    price_inc_vat NUMERIC(12, 2),
    price_ex_vat NUMERIC(12, 2),
    list_price NUMERIC(12, 2),
    buy_box_price NUMERIC(12, 2),
    buy_box_seller_id VARCHAR(50),
    buy_box_is_fba BOOLEAN,
    seller_count INTEGER,

    -- Inventory & sales
    total_stock INTEGER,
    fulfillment_channel VARCHAR(20),
    units_7d INTEGER,
    units_30d INTEGER,
    units_90d INTEGER,
    days_of_cover NUMERIC(8, 2),

    -- Keepa metrics (90-day windows minimum)
    keepa_has_data BOOLEAN DEFAULT FALSE,
    keepa_last_update TIMESTAMP,
    keepa_price_p25_90d INTEGER,                   -- Stored in pence
    keepa_price_median_90d INTEGER,                -- Stored in pence
    keepa_price_p75_90d INTEGER,                   -- Stored in pence
    keepa_lowest_90d INTEGER,                      -- Stored in pence
    keepa_highest_90d INTEGER,                     -- Stored in pence
    keepa_sales_rank_latest INTEGER,
    keepa_new_offers INTEGER,
    keepa_used_offers INTEGER,

    -- Economics (best effort)
    gross_margin_pct NUMERIC(8, 4),
    profit_per_unit NUMERIC(12, 2),
    breakeven_price NUMERIC(12, 2),

    -- Derived flags
    is_buy_box_lost BOOLEAN,
    is_out_of_stock BOOLEAN,
    price_volatility_score NUMERIC(8, 4),

    -- Provenance & metadata
    amazon_raw JSONB,                              -- Full SP-API raw data
    keepa_raw JSONB,                               -- Full Keepa raw data
    fingerprint_hash VARCHAR(64) NOT NULL,         -- SHA-256 hex digest
    transform_version INTEGER NOT NULL DEFAULT 1,  -- Version of transform logic
    snapshot_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_asin_snapshot_asin ON asin_snapshot(asin);
CREATE INDEX IF NOT EXISTS idx_asin_snapshot_marketplace ON asin_snapshot(marketplace_id);
CREATE INDEX IF NOT EXISTS idx_asin_snapshot_entity ON asin_snapshot(asin_entity_id);
CREATE INDEX IF NOT EXISTS idx_asin_snapshot_job ON asin_snapshot(ingestion_job_id);
CREATE INDEX IF NOT EXISTS idx_asin_snapshot_fingerprint ON asin_snapshot(fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_asin_snapshot_time ON asin_snapshot(asin, marketplace_id, snapshot_time DESC);
CREATE INDEX IF NOT EXISTS idx_asin_snapshot_latest ON asin_snapshot(asin, marketplace_id, id DESC);

-- ============================================================================
-- 3. ASIN_CURRENT TABLE (Materialized current state)
-- Purpose: Fast, queryable latest state per ASIN. Exactly one row per ASIN.
-- Upsert semantics only.
-- ============================================================================
CREATE TABLE IF NOT EXISTS asin_current (
    id SERIAL PRIMARY KEY,
    asin VARCHAR(20) NOT NULL,
    marketplace_id INTEGER NOT NULL REFERENCES marketplaces(id),
    asin_entity_id INTEGER REFERENCES asin_entities(id) ON DELETE SET NULL,
    latest_snapshot_id INTEGER NOT NULL REFERENCES asin_snapshot(id),

    -- Identity & catalogue (denormalized for fast queries)
    title TEXT,
    brand VARCHAR(255),
    category_path TEXT,

    -- Pricing & Buy Box
    price_inc_vat NUMERIC(12, 2),
    price_ex_vat NUMERIC(12, 2),
    list_price NUMERIC(12, 2),
    buy_box_price NUMERIC(12, 2),
    buy_box_seller_id VARCHAR(50),
    buy_box_is_fba BOOLEAN,
    seller_count INTEGER,

    -- Inventory & sales
    total_stock INTEGER,
    fulfillment_channel VARCHAR(20),
    units_7d INTEGER,
    units_30d INTEGER,
    units_90d INTEGER,
    days_of_cover NUMERIC(8, 2),

    -- Keepa metrics
    keepa_has_data BOOLEAN DEFAULT FALSE,
    keepa_last_update TIMESTAMP,
    keepa_price_p25_90d INTEGER,
    keepa_price_median_90d INTEGER,
    keepa_price_p75_90d INTEGER,
    keepa_lowest_90d INTEGER,
    keepa_highest_90d INTEGER,
    keepa_sales_rank_latest INTEGER,
    keepa_new_offers INTEGER,
    keepa_used_offers INTEGER,

    -- Economics
    gross_margin_pct NUMERIC(8, 4),
    profit_per_unit NUMERIC(12, 2),
    breakeven_price NUMERIC(12, 2),

    -- Derived flags
    is_buy_box_lost BOOLEAN,
    is_out_of_stock BOOLEAN,
    price_volatility_score NUMERIC(8, 4),

    -- Provenance
    fingerprint_hash VARCHAR(64) NOT NULL,
    last_ingestion_job_id UUID NOT NULL,
    last_snapshot_time TIMESTAMP NOT NULL,
    first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT asin_current_unique UNIQUE (asin, marketplace_id)
);

CREATE INDEX IF NOT EXISTS idx_asin_current_asin ON asin_current(asin);
CREATE INDEX IF NOT EXISTS idx_asin_current_marketplace ON asin_current(marketplace_id);
CREATE INDEX IF NOT EXISTS idx_asin_current_entity ON asin_current(asin_entity_id);
CREATE INDEX IF NOT EXISTS idx_asin_current_snapshot ON asin_current(latest_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_asin_current_fingerprint ON asin_current(fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_asin_current_brand ON asin_current(brand);
CREATE INDEX IF NOT EXISTS idx_asin_current_buy_box_lost ON asin_current(is_buy_box_lost) WHERE is_buy_box_lost = true;
CREATE INDEX IF NOT EXISTS idx_asin_current_out_of_stock ON asin_current(is_out_of_stock) WHERE is_out_of_stock = true;
CREATE INDEX IF NOT EXISTS idx_asin_current_margin ON asin_current(gross_margin_pct DESC) WHERE gross_margin_pct IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asin_current_updated ON asin_current(updated_at DESC);

-- ============================================================================
-- 4. DQ_ISSUES TABLE (Data Quality Issues)
-- Purpose: Visibility into bad, missing, or suspicious data.
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE dq_severity AS ENUM ('WARN', 'CRITICAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE dq_status AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS dq_issues (
    id SERIAL PRIMARY KEY,
    asin VARCHAR(20) NOT NULL,
    marketplace_id INTEGER NOT NULL REFERENCES marketplaces(id),
    asin_entity_id INTEGER REFERENCES asin_entities(id) ON DELETE SET NULL,
    ingestion_job_id UUID,
    snapshot_id INTEGER REFERENCES asin_snapshot(id) ON DELETE SET NULL,

    issue_type VARCHAR(50) NOT NULL,               -- e.g., 'MISSING_FIELD', 'INVALID_VALUE', 'STALE_DATA'
    field_name VARCHAR(100),                       -- Which field has the issue
    severity dq_severity NOT NULL DEFAULT 'WARN',
    status dq_status NOT NULL DEFAULT 'OPEN',

    message TEXT NOT NULL,                         -- Human-readable description
    details JSONB,                                 -- Additional context (expected/actual values, etc.)

    detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at TIMESTAMP,
    resolved_at TIMESTAMP,
    acknowledged_by VARCHAR(100),
    resolution_notes TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dq_issues_asin ON dq_issues(asin);
CREATE INDEX IF NOT EXISTS idx_dq_issues_marketplace ON dq_issues(marketplace_id);
CREATE INDEX IF NOT EXISTS idx_dq_issues_entity ON dq_issues(asin_entity_id);
CREATE INDEX IF NOT EXISTS idx_dq_issues_job ON dq_issues(ingestion_job_id);
CREATE INDEX IF NOT EXISTS idx_dq_issues_snapshot ON dq_issues(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_dq_issues_type ON dq_issues(issue_type);
CREATE INDEX IF NOT EXISTS idx_dq_issues_severity ON dq_issues(severity);
CREATE INDEX IF NOT EXISTS idx_dq_issues_status ON dq_issues(status);
CREATE INDEX IF NOT EXISTS idx_dq_issues_open ON dq_issues(asin, marketplace_id, status) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_dq_issues_critical_open ON dq_issues(severity, status) WHERE severity = 'CRITICAL' AND status = 'OPEN';

-- ============================================================================
-- 5. ADD NEW JOB TYPES FOR ASIN INGESTION
-- ============================================================================
-- Check if we need to add new job types to the enum
DO $$ BEGIN
    -- Add INGEST_ASIN_DATA job type if it doesn't exist
    ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'INGEST_ASIN_DATA';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'TRANSFORM_ASIN_DATA';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 6. INGESTION_JOBS TABLE (Track ingestion runs)
-- Purpose: Track each 30-minute ingestion cycle
-- ============================================================================
CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type VARCHAR(50) NOT NULL,                 -- 'FULL_REFRESH', 'INCREMENTAL', etc.
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL')),

    asin_count INTEGER DEFAULT 0,
    asins_succeeded INTEGER DEFAULT 0,
    asins_failed INTEGER DEFAULT 0,

    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    duration_ms INTEGER,

    error_message TEXT,
    error_details JSONB,

    metadata JSONB,                                -- Additional context (rate limit state, etc.)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status ON ingestion_jobs(status);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_type ON ingestion_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_created ON ingestion_jobs(created_at DESC);

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
SELECT 'Canonical ASIN data model migration completed successfully!' AS result;
