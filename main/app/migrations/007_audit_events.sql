-- Migration: Audit Events Table
-- Version: 007
-- Date: 2026-01-22
-- Purpose: Add comprehensive audit trail for all significant operations

-- ============================================================================
-- 1. AUDIT EVENT TYPES ENUM
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE audit_event_type AS ENUM (
        -- Price operations
        'PRICE_PUBLISH_ATTEMPT',
        'PRICE_PUBLISH_SUCCESS',
        'PRICE_PUBLISH_FAILURE',
        'PRICE_PUBLISH_SIMULATED',

        -- Stock operations
        'STOCK_PUBLISH_ATTEMPT',
        'STOCK_PUBLISH_SUCCESS',
        'STOCK_PUBLISH_FAILURE',
        'STOCK_PUBLISH_SIMULATED',

        -- Cost overrides
        'COST_OVERRIDE_CREATED',
        'COST_OVERRIDE_UPDATED',
        'COST_OVERRIDE_DELETED',

        -- BOM operations
        'BOM_CREATED',
        'BOM_UPDATED',
        'BOM_ACTIVATED',

        -- Settings/guardrails
        'SETTING_UPDATED',
        'GUARDRAIL_OVERRIDE',

        -- Sync operations
        'AMAZON_SYNC_STARTED',
        'AMAZON_SYNC_COMPLETED',
        'AMAZON_SYNC_FAILED',
        'KEEPA_SYNC_STARTED',
        'KEEPA_SYNC_COMPLETED',
        'KEEPA_SYNC_FAILED',

        -- Auth/access (future)
        'API_KEY_CREATED',
        'API_KEY_REVOKED',
        'LOGIN_SUCCESS',
        'LOGIN_FAILURE'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 2. AUDIT OUTCOME ENUM
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE audit_outcome AS ENUM (
        'SUCCESS',
        'FAILURE',
        'SIMULATED',
        'BLOCKED',
        'PENDING'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 3. AUDIT_EVENTS TABLE
-- Comprehensive audit trail for all significant operations
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_events (
    id SERIAL PRIMARY KEY,

    -- Event identification
    event_type audit_event_type NOT NULL,
    outcome audit_outcome NOT NULL DEFAULT 'SUCCESS',

    -- Actor information
    actor_type VARCHAR(50) NOT NULL DEFAULT 'system',     -- 'system', 'api_key', 'user', 'worker'
    actor_id VARCHAR(100),                                -- API key ID, user ID, or null for system

    -- Entity reference (what was affected)
    entity_type VARCHAR(50),                              -- 'listing', 'bom', 'setting', etc.
    entity_id INTEGER,                                    -- ID of the affected entity
    listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,

    -- Request context
    correlation_id VARCHAR(100),                          -- Client-provided tracking ID
    request_id VARCHAR(100),                              -- Server-generated request ID
    ip_address INET,                                      -- Client IP (for API calls)
    user_agent TEXT,                                      -- Client user agent

    -- State change tracking
    before_json JSONB,                                    -- State before change
    after_json JSONB,                                     -- State after change

    -- Operation details
    write_mode VARCHAR(20),                               -- 'simulate' or 'live'
    sp_api_called BOOLEAN DEFAULT FALSE,                  -- Was SP-API actually called?
    sp_api_response JSONB,                                -- SP-API response (if called)

    -- Error tracking
    error_code VARCHAR(50),                               -- Error code if failed
    error_message TEXT,                                   -- Error message if failed

    -- Metadata
    metadata JSONB DEFAULT '{}',                          -- Additional context
    duration_ms INTEGER,                                  -- Operation duration in milliseconds

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 4. INDEXES FOR EFFICIENT QUERYING
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_audit_events_type ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_outcome ON audit_events(outcome);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_listing ON audit_events(listing_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_correlation ON audit_events(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at DESC);

-- Partial index for failed events (commonly queried for debugging)
CREATE INDEX IF NOT EXISTS idx_audit_events_failures ON audit_events(created_at DESC)
    WHERE outcome IN ('FAILURE', 'BLOCKED');

-- ============================================================================
-- 5. AUDIT_EVENTS VIEW FOR COMMON QUERIES
-- ============================================================================
CREATE OR REPLACE VIEW v_recent_audit_events AS
SELECT
    ae.id,
    ae.event_type,
    ae.outcome,
    ae.actor_type,
    ae.entity_type,
    ae.entity_id,
    ae.listing_id,
    l.seller_sku,
    l.title as listing_title,
    ae.write_mode,
    ae.sp_api_called,
    ae.error_code,
    ae.error_message,
    ae.duration_ms,
    ae.created_at
FROM audit_events ae
LEFT JOIN listings l ON l.id = ae.listing_id
ORDER BY ae.created_at DESC;

-- ============================================================================
-- 6. FUNCTION TO RECORD AUDIT EVENT
-- ============================================================================
CREATE OR REPLACE FUNCTION record_audit_event(
    p_event_type audit_event_type,
    p_outcome audit_outcome,
    p_actor_type VARCHAR DEFAULT 'system',
    p_actor_id VARCHAR DEFAULT NULL,
    p_entity_type VARCHAR DEFAULT NULL,
    p_entity_id INTEGER DEFAULT NULL,
    p_listing_id INTEGER DEFAULT NULL,
    p_correlation_id VARCHAR DEFAULT NULL,
    p_request_id VARCHAR DEFAULT NULL,
    p_before_json JSONB DEFAULT NULL,
    p_after_json JSONB DEFAULT NULL,
    p_write_mode VARCHAR DEFAULT NULL,
    p_sp_api_called BOOLEAN DEFAULT FALSE,
    p_sp_api_response JSONB DEFAULT NULL,
    p_error_code VARCHAR DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}',
    p_duration_ms INTEGER DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
    v_event_id INTEGER;
BEGIN
    INSERT INTO audit_events (
        event_type, outcome, actor_type, actor_id,
        entity_type, entity_id, listing_id,
        correlation_id, request_id,
        before_json, after_json,
        write_mode, sp_api_called, sp_api_response,
        error_code, error_message,
        metadata, duration_ms
    ) VALUES (
        p_event_type, p_outcome, p_actor_type, p_actor_id,
        p_entity_type, p_entity_id, p_listing_id,
        p_correlation_id, p_request_id,
        p_before_json, p_after_json,
        p_write_mode, p_sp_api_called, p_sp_api_response,
        p_error_code, p_error_message,
        p_metadata, p_duration_ms
    ) RETURNING id INTO v_event_id;

    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. RETENTION POLICY (optional - for production)
-- Keeps audit events for 90 days by default
-- ============================================================================
-- Uncomment for production use:
-- CREATE OR REPLACE FUNCTION cleanup_old_audit_events() RETURNS void AS $$
-- BEGIN
--     DELETE FROM audit_events
--     WHERE created_at < NOW() - INTERVAL '90 days';
-- END;
-- $$ LANGUAGE plpgsql;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
SELECT 'Migration 007 (audit_events) completed successfully!' AS result;
