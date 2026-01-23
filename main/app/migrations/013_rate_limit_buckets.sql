-- Migration: Rate Limit Buckets Table
-- Version: 013
-- Date: 2026-01-23
-- Purpose: Add rate_limit_buckets table for token bucket rate limiter persistence

-- ============================================================================
-- RATE_LIMIT_BUCKETS TABLE
-- Purpose: Persist token bucket state across server restarts
-- ============================================================================
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    name VARCHAR(100) PRIMARY KEY,
    tokens NUMERIC(10, 4) NOT NULL,
    last_refill_time TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_updated ON rate_limit_buckets(updated_at);

-- Insert default Keepa rate limiter bucket
INSERT INTO rate_limit_buckets (name, tokens, last_refill_time)
VALUES ('keepa_api', 20, CURRENT_TIMESTAMP)
ON CONFLICT (name) DO NOTHING;

SELECT 'Rate limit buckets table migration completed!' AS result;
