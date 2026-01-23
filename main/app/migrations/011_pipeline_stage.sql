-- Migration 011: Add pipeline_stage column to asin_entities
-- Supports Opportunity Pipeline feature with stages: INBOX, QUALIFIED, COSTED, READY, CONVERTED, REJECTED

ALTER TABLE asin_entities
ADD COLUMN IF NOT EXISTS pipeline_stage VARCHAR(20) DEFAULT NULL;

-- Index for efficient filtering by pipeline stage
CREATE INDEX IF NOT EXISTS idx_asin_entities_pipeline_stage
ON asin_entities(pipeline_stage);

-- Composite index for tracked ASINs by stage (common query pattern)
CREATE INDEX IF NOT EXISTS idx_asin_entities_tracked_stage
ON asin_entities(is_tracked, pipeline_stage)
WHERE is_tracked = true;
