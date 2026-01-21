-- Fix all missing columns for Amazon Listing Helper
-- Run with: PGPASSWORD='AmazonHelper2026Secure!' psql -h localhost -U alh_user -d amazon_listing_helper -f /opt/alh/fix-schema.sql

-- Alerts table fixes
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS dismissed BOOLEAN DEFAULT FALSE;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS "dismissedAt" TIMESTAMP;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS read BOOLEAN DEFAULT FALSE;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Listing_scores table fixes (already renamed from scores)
ALTER TABLE listing_scores ADD COLUMN IF NOT EXISTS "seoScore" INTEGER DEFAULT 0;
ALTER TABLE listing_scores ADD COLUMN IF NOT EXISTS "contentScore" INTEGER DEFAULT 0;

-- Tasks table - check for missing columns
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee VARCHAR(100);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]';

-- Listings table - ensure all columns exist
ALTER TABLE listings ADD COLUMN IF NOT EXISTS "searchTerms" TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS "backendKeywords" TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS brand VARCHAR(255);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(255);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS "parentAsin" VARCHAR(20);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS "variationTheme" VARCHAR(100);

-- Settings - add any missing columns
ALTER TABLE settings ADD COLUMN IF NOT EXISTS category VARCHAR(50);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_alerts_dismissed ON alerts(dismissed);
CREATE INDEX IF NOT EXISTS idx_alerts_read ON alerts(read);
CREATE INDEX IF NOT EXISTS idx_listings_brand ON listings(brand);

SELECT 'Schema fixes applied successfully!' AS result;
