-- Migration 008: Dead Letter Queue and Performance Indexes
-- Per REPO_REVIEW_REPORT A.3.2 (Dead Letter Queue) and B.1 (Performance Indexes)

-- A.3.2: Dead Letter Queue table for failed jobs
CREATE TABLE IF NOT EXISTS job_dead_letters (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL,
  job_type VARCHAR(64) NOT NULL,
  scope_type VARCHAR(16) DEFAULT 'LISTING',
  listing_id INTEGER,
  asin_entity_id INTEGER,
  payload JSONB,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  error_stack TEXT,
  failed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP,
  resolution_notes TEXT
);

-- DLQ indexes
CREATE INDEX IF NOT EXISTS idx_dlq_job_id ON job_dead_letters(job_id);
CREATE INDEX IF NOT EXISTS idx_dlq_job_type ON job_dead_letters(job_type);
CREATE INDEX IF NOT EXISTS idx_dlq_failed_at ON job_dead_letters(failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_dlq_unresolved ON job_dead_letters(resolved_at) WHERE resolved_at IS NULL;

-- B.1: Performance indexes for common query patterns

-- Composite index for listing scores (used in ranking queries)
-- NOTE: Expression indexes require the full expression in parentheses before sort direction
CREATE INDEX IF NOT EXISTS idx_listing_scores_composite
  ON feature_store(entity_id, ((features_json->>'margin')::numeric) DESC)
  WHERE entity_type = 'LISTING';

-- Listings by status and update time (used in sync/refresh queries)
CREATE INDEX IF NOT EXISTS idx_listings_status_updated
  ON listings(status, "updatedAt" DESC);

-- Keepa snapshots TTL index (used in cleanup and latest-snapshot queries)
CREATE INDEX IF NOT EXISTS idx_keepa_snapshots_ttl
  ON keepa_snapshots(asin, marketplace_id, captured_at DESC);

-- Partial index for pending jobs (frequently queried, small subset)
CREATE INDEX IF NOT EXISTS idx_jobs_pending
  ON jobs(priority DESC, scheduled_for ASC)
  WHERE status = 'PENDING';

-- BOM lookup by listing (for economics calculations)
CREATE INDEX IF NOT EXISTS idx_boms_listing_active
  ON boms(listing_id, is_active)
  WHERE is_active = true AND scope_type = 'LISTING';

-- Feature store entity lookup
CREATE INDEX IF NOT EXISTS idx_feature_store_entity
  ON feature_store(entity_type, entity_id, computed_at DESC);

-- Recommendations lookup
CREATE INDEX IF NOT EXISTS idx_recommendations_entity
  ON recommendations(entity_type, entity_id, status)
  WHERE status = 'PENDING';

-- Comments
COMMENT ON TABLE job_dead_letters IS 'Dead letter queue for jobs that exceed max retry attempts (A.3.2)';
COMMENT ON INDEX idx_jobs_pending IS 'Partial index for pending jobs - dramatically speeds up job polling (B.1)';
