-- Migration: Slice D Schema
-- Version: 004
-- Date: 2026-01-20
-- Purpose: Add recommendations and recommendation_events per SPEC

-- ============================================================================
-- 1. RECOMMENDATION TYPES ENUM (SPEC §10)
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE recommendation_type AS ENUM (
        'PRICE_DECREASE_REGAIN_BUYBOX',
        'PRICE_INCREASE_MARGIN_OPPORTUNITY',
        'STOCK_INCREASE_STOCKOUT_RISK',
        'STOCK_DECREASE_OVERSTOCK',
        'MARGIN_AT_RISK_COMPONENT_COST',
        'ANOMALY_SALES_DROP',
        'ANOMALY_CONVERSION_DROP',
        'ANOMALY_BUY_BOX_LOSS',
        'OPPORTUNITY_CREATE_LISTING'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 2. RECOMMENDATION STATUS ENUM
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE recommendation_status AS ENUM (
        'PENDING',
        'ACCEPTED',
        'REJECTED',
        'SNOOZED',
        'EXPIRED',
        'SUPERSEDED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 3. CONFIDENCE BAND ENUM
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE confidence_band AS ENUM (
        'HIGH',
        'MEDIUM',
        'LOW'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 4. RECOMMENDATIONS TABLE (SPEC §4.16)
-- ============================================================================
CREATE TABLE IF NOT EXISTS recommendations (
    id SERIAL PRIMARY KEY,
    recommendation_type recommendation_type NOT NULL,
    entity_type feature_entity_type NOT NULL,           -- LISTING or ASIN
    entity_id INTEGER NOT NULL,                          -- listing_id or asin_entity_id
    status recommendation_status NOT NULL DEFAULT 'PENDING',

    -- Action payload (what should be done)
    action_payload_json JSONB NOT NULL,

    -- Evidence (why this recommendation was made)
    evidence_json JSONB NOT NULL,

    -- Guardrails check results
    guardrails_json JSONB,

    -- Estimated impact
    impact_json JSONB NOT NULL,

    -- Confidence assessment
    confidence confidence_band NOT NULL DEFAULT 'MEDIUM',
    confidence_score NUMERIC(5,4),                       -- 0.0 to 1.0

    -- Lifecycle timestamps
    generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    accepted_at TIMESTAMP,
    rejected_at TIMESTAMP,
    snoozed_until TIMESTAMP,

    -- Metadata
    generation_job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    accepted_job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recommendations_entity ON recommendations(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_type ON recommendations(recommendation_type);
CREATE INDEX IF NOT EXISTS idx_recommendations_status ON recommendations(status);
CREATE INDEX IF NOT EXISTS idx_recommendations_pending ON recommendations(entity_type, entity_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_recommendations_generated ON recommendations(generated_at DESC);

-- ============================================================================
-- 5. RECOMMENDATION EVENT TYPES ENUM
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE recommendation_event_type AS ENUM (
        'GENERATED',
        'VIEWED',
        'ACCEPTED',
        'REJECTED',
        'SNOOZED',
        'EXPIRED',
        'SUPERSEDED',
        'ACTION_STARTED',
        'ACTION_COMPLETED',
        'ACTION_FAILED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 6. RECOMMENDATION_EVENTS TABLE (SPEC §4.16)
-- Audit trail for recommendation lifecycle
-- ============================================================================
CREATE TABLE IF NOT EXISTS recommendation_events (
    id SERIAL PRIMARY KEY,
    recommendation_id INTEGER NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
    event_type recommendation_event_type NOT NULL,
    job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,

    -- Event details
    details_json JSONB,
    reason TEXT,

    -- Metadata
    created_by VARCHAR(100) DEFAULT 'system',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rec_events_recommendation ON recommendation_events(recommendation_id);
CREATE INDEX IF NOT EXISTS idx_rec_events_type ON recommendation_events(event_type);
CREATE INDEX IF NOT EXISTS idx_rec_events_created ON recommendation_events(created_at);

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
SELECT 'Slice D migration completed successfully!' AS result;
