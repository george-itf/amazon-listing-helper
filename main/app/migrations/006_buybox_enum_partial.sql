-- Migration: Add PARTIAL to buy_box_status_type enum
-- Version: 006
-- Date: 2026-01-22
-- Purpose: Add PARTIAL status to Buy Box enum for cases where seller has 1-49% win rate

-- ============================================================================
-- 1. ADD PARTIAL VALUE TO buy_box_status_type ENUM
-- ============================================================================
-- PostgreSQL requires ALTER TYPE to add new enum values
-- This is safe to run multiple times (IF NOT EXISTS)

DO $$ BEGIN
    ALTER TYPE buy_box_status_type ADD VALUE IF NOT EXISTS 'PARTIAL';
EXCEPTION
    WHEN duplicate_object THEN null;
    WHEN undefined_object THEN
        -- Enum doesn't exist yet, create it with all values
        CREATE TYPE buy_box_status_type AS ENUM ('WON', 'LOST', 'PARTIAL', 'UNKNOWN');
END $$;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
SELECT 'Migration 006 (buybox_enum_partial) completed successfully!' AS result;
