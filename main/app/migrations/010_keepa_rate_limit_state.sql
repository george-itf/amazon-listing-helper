-- Migration 010: Keepa Rate Limit State Persistence
-- F.1 FIX: Persists rate limit state to survive restarts

-- Create table for Keepa rate limit state
-- Uses a single row (id=1) for the global state
CREATE TABLE IF NOT EXISTS keepa_rate_limit_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- Enforce single row
  tokens_remaining INTEGER,
  reset_time TIMESTAMPTZ,
  last_updated TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT single_row_keepa_state UNIQUE (id)
);

-- Insert initial state
INSERT INTO keepa_rate_limit_state (id, tokens_remaining, reset_time, last_updated)
VALUES (1, NULL, NULL, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

-- Create table for financial events idempotency (J.4 FIX)
-- Add unique constraint on natural key
-- Only if the table exists (it's created by a different migration)
DO $$
BEGIN
  -- Check if table exists before trying to create index
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'amazon_financial_events'
  ) THEN
    -- Add unique index if not exists for idempotency
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE indexname = 'idx_amazon_financial_events_unique'
    ) THEN
      -- Check if there are duplicates before creating unique index
      IF NOT EXISTS (
        SELECT event_type, amazon_order_id, posted_date, COUNT(*)
        FROM amazon_financial_events
        WHERE amazon_order_id IS NOT NULL AND posted_date IS NOT NULL
        GROUP BY event_type, amazon_order_id, posted_date
        HAVING COUNT(*) > 1
      ) THEN
        CREATE UNIQUE INDEX idx_amazon_financial_events_unique
        ON amazon_financial_events (event_type, amazon_order_id, posted_date)
        WHERE amazon_order_id IS NOT NULL AND posted_date IS NOT NULL;
      ELSE
        RAISE WARNING 'Duplicate records exist in amazon_financial_events - cannot create unique index';
      END IF;
    END IF;
  ELSE
    RAISE NOTICE 'amazon_financial_events table does not exist - skipping unique index creation';
  END IF;
END $$;

-- DOWN (for rollback):
-- DROP TABLE IF EXISTS keepa_rate_limit_state;
-- DROP INDEX IF EXISTS idx_amazon_financial_events_unique;
