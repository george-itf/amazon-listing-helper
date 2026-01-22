-- Migration 009: Materialized View Refresh Job Type
-- Per REPO_REVIEW_REPORT B.3 - Materialized view not refreshed

-- Add REFRESH_MATERIALIZED_VIEWS job type to enum if not exists
DO $$
BEGIN
  -- Check if the value already exists in the enum
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'REFRESH_MATERIALIZED_VIEWS'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'job_type')
  ) THEN
    -- Add the new enum value
    ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'REFRESH_MATERIALIZED_VIEWS';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    -- Ignore if already exists
    NULL;
END
$$;

-- Create a table to track MV refresh history
CREATE TABLE IF NOT EXISTS mv_refresh_log (
  id SERIAL PRIMARY KEY,
  view_name VARCHAR(128) NOT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  rows_affected INTEGER,
  success BOOLEAN DEFAULT false,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_mv_refresh_log_view ON mv_refresh_log(view_name, started_at DESC);

-- Function to refresh materialized views and log results
CREATE OR REPLACE FUNCTION refresh_materialized_view_logged(view_name TEXT)
RETURNS void AS $$
DECLARE
  start_time TIMESTAMP;
  end_time TIMESTAMP;
  duration INTEGER;
  log_id INTEGER;
BEGIN
  start_time := clock_timestamp();

  -- Insert start log entry
  INSERT INTO mv_refresh_log (view_name, started_at)
  VALUES (view_name, start_time)
  RETURNING id INTO log_id;

  -- Refresh the view
  EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', view_name);

  end_time := clock_timestamp();
  duration := EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;

  -- Update log entry with success
  UPDATE mv_refresh_log
  SET completed_at = end_time,
      duration_ms = duration,
      success = true
  WHERE id = log_id;

EXCEPTION WHEN OTHERS THEN
  -- Log the error
  UPDATE mv_refresh_log
  SET completed_at = clock_timestamp(),
      success = false,
      error_message = SQLERRM
  WHERE id = log_id;

  RAISE WARNING 'Failed to refresh view %: %', view_name, SQLERRM;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE mv_refresh_log IS 'Tracks materialized view refresh history (B.3)';
COMMENT ON FUNCTION refresh_materialized_view_logged IS 'Refreshes MV with logging (B.3)';

-- @DOWN
-- Rollback SQL for this migration
DROP FUNCTION IF EXISTS refresh_materialized_view_logged(TEXT);
DROP TABLE IF EXISTS mv_refresh_log;
-- Note: Cannot remove enum values in PostgreSQL, would need to recreate the enum
