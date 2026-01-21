-- Migration: Slice A Schema
-- Version: 001
-- Date: 2026-01-20
-- Purpose: Add marketplaces, suppliers, components, BOMs, and cost overrides per SPEC

-- ============================================================================
-- 1. MARKETPLACES TABLE (SPEC §4.1)
-- ============================================================================
CREATE TABLE IF NOT EXISTS marketplaces (
    id SERIAL PRIMARY KEY,
    amazon_marketplace_id VARCHAR(20) UNIQUE NOT NULL,  -- e.g., 'A1F83G8C2ARO7P' for UK
    name VARCHAR(100) NOT NULL,                          -- e.g., 'Amazon UK'
    country_code VARCHAR(2) NOT NULL,                    -- e.g., 'GB'
    currency_code VARCHAR(3) NOT NULL DEFAULT 'GBP',     -- e.g., 'GBP'
    vat_rate NUMERIC(5,4) NOT NULL DEFAULT 0.20,         -- e.g., 0.20 for 20%
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert UK marketplace as default
INSERT INTO marketplaces (amazon_marketplace_id, name, country_code, currency_code, vat_rate)
VALUES ('A1F83G8C2ARO7P', 'Amazon UK', 'GB', 'GBP', 0.20)
ON CONFLICT (amazon_marketplace_id) DO NOTHING;

-- ============================================================================
-- 2. SUPPLIERS TABLE (SPEC §4.5)
-- ============================================================================
CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    contact_name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    website VARCHAR(500),
    address TEXT,
    currency_code VARCHAR(3) DEFAULT 'GBP',
    lead_time_days INTEGER DEFAULT 7,
    minimum_order_value NUMERIC(12,2) DEFAULT 0,
    payment_terms VARCHAR(100),
    notes TEXT,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);
CREATE INDEX IF NOT EXISTS idx_suppliers_is_active ON suppliers(is_active);

-- ============================================================================
-- 3. COMPONENTS TABLE (SPEC §4.6)
-- ============================================================================
CREATE TABLE IF NOT EXISTS components (
    id SERIAL PRIMARY KEY,
    component_sku VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100) DEFAULT 'General',
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    supplier_sku VARCHAR(100),                           -- Supplier's SKU for this component
    unit_cost_ex_vat NUMERIC(12,2) NOT NULL DEFAULT 0,   -- Cost excluding VAT per DATA_CONTRACTS
    unit_of_measure VARCHAR(50) DEFAULT 'each',          -- e.g., 'each', 'kg', 'm'
    pack_size INTEGER DEFAULT 1,
    weight_grams NUMERIC(10,2),
    dimensions_cm JSONB,                                 -- { length, width, height }
    min_stock_level INTEGER DEFAULT 0,
    current_stock INTEGER DEFAULT 0,
    reorder_point INTEGER DEFAULT 0,
    price_history JSONB DEFAULT '[]',                    -- Historical cost tracking
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_components_sku ON components(component_sku);
CREATE INDEX IF NOT EXISTS idx_components_supplier ON components(supplier_id);
CREATE INDEX IF NOT EXISTS idx_components_category ON components(category);
CREATE INDEX IF NOT EXISTS idx_components_is_active ON components(is_active);

-- ============================================================================
-- 4. BOMS TABLE (SPEC §4.7) - Versioned Bill of Materials
-- ============================================================================
-- Create enum idempotently (avoid "already exists" failure)
DO $$ BEGIN
    CREATE TYPE bom_scope_type AS ENUM ('LISTING', 'ASIN_SCENARIO');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS boms (
    id SERIAL PRIMARY KEY,
    listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,
    asin_entity_id INTEGER,                              -- For ASIN_SCENARIO scope (FK added later in Slice E)
    scope_type bom_scope_type NOT NULL DEFAULT 'LISTING',
    version INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    effective_from TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    effective_to TIMESTAMP,                              -- NULL means current
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- BOM Invariant: One active BOM per listing (enforced by partial unique index below)
    CONSTRAINT boms_version_unique UNIQUE (listing_id, version) -- Unique version per listing
);

-- BOM Invariant: Exactly one active BOM per listing (DEPRECATION_PLAN §12)
CREATE UNIQUE INDEX IF NOT EXISTS boms_listing_active_unique
ON boms (listing_id)
WHERE is_active = true AND scope_type = 'LISTING';

CREATE INDEX IF NOT EXISTS idx_boms_listing ON boms(listing_id);
CREATE INDEX IF NOT EXISTS idx_boms_is_active ON boms(is_active);
CREATE INDEX IF NOT EXISTS idx_boms_scope ON boms(scope_type);

-- ============================================================================
-- 5. BOM_LINES TABLE (SPEC §4.8) - BOM Line Items
-- ============================================================================
CREATE TABLE IF NOT EXISTS bom_lines (
    id SERIAL PRIMARY KEY,
    bom_id INTEGER NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
    component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE RESTRICT,
    quantity NUMERIC(10,4) NOT NULL CHECK (quantity > 0),
    wastage_rate NUMERIC(5,4) DEFAULT 0 CHECK (wastage_rate >= 0 AND wastage_rate < 1),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT bom_lines_unique UNIQUE (bom_id, component_id)
);

CREATE INDEX IF NOT EXISTS idx_bom_lines_bom ON bom_lines(bom_id);
CREATE INDEX IF NOT EXISTS idx_bom_lines_component ON bom_lines(component_id);

-- ============================================================================
-- 6. LISTING_COST_OVERRIDES TABLE (SPEC §4.9)
-- Per-listing cost overrides for shipping, packaging, etc.
-- ============================================================================
CREATE TABLE IF NOT EXISTS listing_cost_overrides (
    id SERIAL PRIMARY KEY,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE UNIQUE,
    shipping_cost_ex_vat NUMERIC(12,2) DEFAULT 0,        -- Outbound shipping to customer
    packaging_cost_ex_vat NUMERIC(12,2) DEFAULT 0,       -- Packaging materials
    handling_cost_ex_vat NUMERIC(12,2) DEFAULT 0,        -- Labor/handling
    other_cost_ex_vat NUMERIC(12,2) DEFAULT 0,           -- Miscellaneous costs
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_listing_cost_overrides_listing ON listing_cost_overrides(listing_id);

-- ============================================================================
-- 7. ADD MARKETPLACE_ID TO LISTINGS
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'listings' AND column_name = 'marketplace_id'
    ) THEN
        ALTER TABLE listings ADD COLUMN marketplace_id INTEGER REFERENCES marketplaces(id);
        -- Set default marketplace to UK for existing listings
        UPDATE listings SET marketplace_id = (SELECT id FROM marketplaces WHERE country_code = 'GB' LIMIT 1);
    END IF;
END $$;

-- Rename 'sku' to 'seller_sku' for clarity (if not already renamed)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'listings' AND column_name = 'sku'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'listings' AND column_name = 'seller_sku'
    ) THEN
        ALTER TABLE listings RENAME COLUMN sku TO seller_sku;
    END IF;
END $$;

-- Add price_inc_vat column to clarify VAT semantics
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'listings' AND column_name = 'price_inc_vat'
    ) THEN
        -- Rename 'price' to 'price_inc_vat' for VAT clarity
        ALTER TABLE listings RENAME COLUMN price TO price_inc_vat;
    END IF;
END $$;

-- Add available_quantity column (rename from quantity)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'listings' AND column_name = 'quantity'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'listings' AND column_name = 'available_quantity'
    ) THEN
        ALTER TABLE listings RENAME COLUMN quantity TO available_quantity;
    END IF;
END $$;

-- ============================================================================
-- 8. GUARDRAIL SETTINGS (SPEC §7)
-- Insert default guardrail settings
-- ============================================================================
INSERT INTO settings (key, value, description)
VALUES
    ('guardrails.min_margin', '0.15', 'Minimum acceptable profit margin (0.15 = 15%)'),
    ('guardrails.max_price_change_pct_per_day', '0.05', 'Maximum price change per day (0.05 = 5%)'),
    ('guardrails.min_days_of_cover_before_price_change', '7', 'Min stock days before allowing price cut'),
    ('guardrails.min_stock_threshold', '5', 'Minimum stock level before alerts'),
    ('default_vat_rate', '0.20', 'Default VAT rate (0.20 = 20%)')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 9. UPDATE INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_listings_marketplace ON listings(marketplace_id);
CREATE INDEX IF NOT EXISTS idx_listings_seller_sku ON listings(seller_sku);

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
SELECT 'Slice A migration completed successfully!' AS result;
