-- ============================================================================
-- ML Data Pool Migration
-- Creates a unified view of all data for machine learning training
--
-- This migration is RESILIENT to missing tables:
-- - If advanced tables (asin_entities, keepa_snapshots, etc.) don't exist,
--   it creates a simplified view using only the listings table
-- - Uses DO blocks to conditionally create the full or simple view
--
-- NOTE: Uses migrated column names from 001_slice_a_schema.sql:
-- - seller_sku (was: sku)
-- - price_inc_vat (was: price)
-- - available_quantity (was: quantity)
-- ============================================================================

-- Drop existing view if it exists
DROP MATERIALIZED VIEW IF EXISTS ml_data_pool CASCADE;
DROP VIEW IF EXISTS ml_training_export CASCADE;
DROP FUNCTION IF EXISTS refresh_ml_data_pool() CASCADE;

-- Check which tables exist and create appropriate view
DO $$
DECLARE
    has_asin_entities BOOLEAN;
    has_keepa_snapshots BOOLEAN;
    has_feature_store BOOLEAN;
    has_recommendations BOOLEAN;
    has_boms BOOLEAN;
    has_listing_sales_daily BOOLEAN;
BEGIN
    -- Check for each table
    SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'asin_entities') INTO has_asin_entities;
    SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'keepa_snapshots') INTO has_keepa_snapshots;
    SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'feature_store') INTO has_feature_store;
    SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'recommendations') INTO has_recommendations;
    SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'boms') INTO has_boms;
    SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'listing_sales_daily') INTO has_listing_sales_daily;

    RAISE NOTICE 'ML Data Pool - Table check: asin_entities=%, keepa_snapshots=%, feature_store=%, recommendations=%, boms=%, listing_sales_daily=%',
        has_asin_entities, has_keepa_snapshots, has_feature_store, has_recommendations, has_boms, has_listing_sales_daily;

    -- If we have all the advanced tables, create the full view
    IF has_asin_entities AND has_keepa_snapshots AND has_feature_store AND has_recommendations AND has_boms AND has_listing_sales_daily THEN
        RAISE NOTICE 'Creating FULL ML Data Pool with all tables';

        EXECUTE $view$
        CREATE MATERIALIZED VIEW ml_data_pool AS
        -- Part 1: All ASIN entities with their matched listings
        SELECT
            COALESCE(l.id, ae.listing_id) as listing_id,
            ae.id as asin_entity_id,
            COALESCE(l.seller_sku, 'ASIN_' || ae.asin) as sku,
            COALESCE(l.asin, ae.asin) as asin,
            CASE WHEN l.id IS NOT NULL THEN 'LISTING' ELSE 'ASIN' END as entity_type,
            COALESCE(l.title, ae.title) as title,
            ae.brand,
            ae.category,
            l.description,
            l."bulletPoints" as bullet_points,
            l.status as listing_status,
            l."fulfillmentChannel" as fulfillment_channel,
            ae.is_tracked,
            l.price_inc_vat as current_price,
            l.available_quantity as current_quantity,
            -- Keepa data (using asin for lookup)
            (SELECT parsed_json->'metrics'->>'price_current' FROM keepa_snapshots ks WHERE ks.asin = ae.asin ORDER BY captured_at DESC LIMIT 1)::numeric as keepa_price_current,
            (SELECT parsed_json->'metrics'->>'price_median_90d' FROM keepa_snapshots ks WHERE ks.asin = ae.asin ORDER BY captured_at DESC LIMIT 1)::numeric as keepa_price_median_90d,
            (SELECT parsed_json->'metrics'->>'volatility_90d' FROM keepa_snapshots ks WHERE ks.asin = ae.asin ORDER BY captured_at DESC LIMIT 1)::numeric as keepa_volatility_90d,
            (SELECT parsed_json->'metrics'->>'offers_count_current' FROM keepa_snapshots ks WHERE ks.asin = ae.asin ORDER BY captured_at DESC LIMIT 1)::int as keepa_offers_count,
            (SELECT parsed_json->'metrics'->>'sales_rank_current' FROM keepa_snapshots ks WHERE ks.asin = ae.asin ORDER BY captured_at DESC LIMIT 1)::int as keepa_sales_rank,
            (SELECT captured_at FROM keepa_snapshots ks WHERE ks.asin = ae.asin ORDER BY captured_at DESC LIMIT 1) as keepa_captured_at,
            -- BOM data
            (SELECT id FROM boms WHERE listing_id = l.id AND is_active = true ORDER BY effective_from DESC LIMIT 1) as bom_id,
            (SELECT COALESCE(SUM(bl.quantity * (1 + COALESCE(bl.wastage_rate, 0)) * COALESCE(c.unit_cost_ex_vat, 0)), 0)
             FROM boms b JOIN bom_lines bl ON bl.bom_id = b.id JOIN components c ON c.id = bl.component_id
             WHERE b.listing_id = l.id AND b.is_active = true LIMIT 1) as bom_cost_ex_vat,
            -- Feature store data
            (SELECT features_json->>'margin' FROM feature_store WHERE entity_type = 'LISTING' AND entity_id = l.id ORDER BY computed_at DESC LIMIT 1)::numeric as computed_margin,
            (SELECT features_json->>'opportunity_score' FROM feature_store WHERE entity_type = 'LISTING' AND entity_id = l.id ORDER BY computed_at DESC LIMIT 1)::numeric as opportunity_score,
            (SELECT features_json FROM feature_store WHERE entity_type = 'LISTING' AND entity_id = l.id ORDER BY computed_at DESC LIMIT 1) as all_features,
            (SELECT computed_at FROM feature_store WHERE entity_type = 'LISTING' AND entity_id = l.id ORDER BY computed_at DESC LIMIT 1) as features_computed_at,
            -- Sales velocity
            COALESCE((SELECT SUM(units) FROM listing_sales_daily WHERE listing_id = l.id AND date >= CURRENT_DATE - INTERVAL '30 days'), 0) as sales_30d_units,
            COALESCE((SELECT SUM(revenue_inc_vat) FROM listing_sales_daily WHERE listing_id = l.id AND date >= CURRENT_DATE - INTERVAL '30 days'), 0) as sales_30d_revenue,
            -- Recommendations
            COALESCE((SELECT COUNT(*) FROM recommendations WHERE entity_type = 'LISTING' AND entity_id = l.id AND status = 'PENDING'), 0) as pending_recommendations,
            -- Timestamps
            l."createdAt" as listing_created_at,
            l."updatedAt" as listing_updated_at,
            ae.created_at as asin_tracked_at,
            CURRENT_TIMESTAMP as snapshot_at
        FROM asin_entities ae
        LEFT JOIN listings l ON l.asin = ae.asin OR l.id = ae.listing_id

        UNION ALL

        -- Part 2: Listings without ASIN entities
        SELECT
            l.id as listing_id,
            NULL::integer as asin_entity_id,
            l.seller_sku as sku,
            l.asin,
            'LISTING' as entity_type,
            l.title,
            NULL::varchar as brand,
            l.category::varchar,
            l.description,
            l."bulletPoints" as bullet_points,
            l.status as listing_status,
            l."fulfillmentChannel" as fulfillment_channel,
            NULL::boolean as is_tracked,
            l.price_inc_vat as current_price,
            l.available_quantity as current_quantity,
            -- Keepa data
            (SELECT parsed_json->'metrics'->>'price_current' FROM keepa_snapshots ks WHERE ks.asin = l.asin ORDER BY captured_at DESC LIMIT 1)::numeric as keepa_price_current,
            (SELECT parsed_json->'metrics'->>'price_median_90d' FROM keepa_snapshots ks WHERE ks.asin = l.asin ORDER BY captured_at DESC LIMIT 1)::numeric as keepa_price_median_90d,
            (SELECT parsed_json->'metrics'->>'volatility_90d' FROM keepa_snapshots ks WHERE ks.asin = l.asin ORDER BY captured_at DESC LIMIT 1)::numeric as keepa_volatility_90d,
            (SELECT parsed_json->'metrics'->>'offers_count_current' FROM keepa_snapshots ks WHERE ks.asin = l.asin ORDER BY captured_at DESC LIMIT 1)::int as keepa_offers_count,
            (SELECT parsed_json->'metrics'->>'sales_rank_current' FROM keepa_snapshots ks WHERE ks.asin = l.asin ORDER BY captured_at DESC LIMIT 1)::int as keepa_sales_rank,
            (SELECT captured_at FROM keepa_snapshots ks WHERE ks.asin = l.asin ORDER BY captured_at DESC LIMIT 1) as keepa_captured_at,
            -- BOM data
            (SELECT id FROM boms WHERE listing_id = l.id AND is_active = true ORDER BY effective_from DESC LIMIT 1) as bom_id,
            (SELECT COALESCE(SUM(bl.quantity * (1 + COALESCE(bl.wastage_rate, 0)) * COALESCE(c.unit_cost_ex_vat, 0)), 0)
             FROM boms b JOIN bom_lines bl ON bl.bom_id = b.id JOIN components c ON c.id = bl.component_id
             WHERE b.listing_id = l.id AND b.is_active = true LIMIT 1) as bom_cost_ex_vat,
            -- Feature store
            (SELECT features_json->>'margin' FROM feature_store WHERE entity_type = 'LISTING' AND entity_id = l.id ORDER BY computed_at DESC LIMIT 1)::numeric as computed_margin,
            (SELECT features_json->>'opportunity_score' FROM feature_store WHERE entity_type = 'LISTING' AND entity_id = l.id ORDER BY computed_at DESC LIMIT 1)::numeric as opportunity_score,
            (SELECT features_json FROM feature_store WHERE entity_type = 'LISTING' AND entity_id = l.id ORDER BY computed_at DESC LIMIT 1) as all_features,
            (SELECT computed_at FROM feature_store WHERE entity_type = 'LISTING' AND entity_id = l.id ORDER BY computed_at DESC LIMIT 1) as features_computed_at,
            -- Sales
            COALESCE((SELECT SUM(units) FROM listing_sales_daily WHERE listing_id = l.id AND date >= CURRENT_DATE - INTERVAL '30 days'), 0) as sales_30d_units,
            COALESCE((SELECT SUM(revenue_inc_vat) FROM listing_sales_daily WHERE listing_id = l.id AND date >= CURRENT_DATE - INTERVAL '30 days'), 0) as sales_30d_revenue,
            -- Recommendations
            COALESCE((SELECT COUNT(*) FROM recommendations WHERE entity_type = 'LISTING' AND entity_id = l.id AND status = 'PENDING'), 0) as pending_recommendations,
            -- Timestamps
            l."createdAt" as listing_created_at,
            l."updatedAt" as listing_updated_at,
            NULL::timestamp as asin_tracked_at,
            CURRENT_TIMESTAMP as snapshot_at
        FROM listings l
        WHERE NOT EXISTS (SELECT 1 FROM asin_entities ae WHERE ae.asin = l.asin OR ae.listing_id = l.id)
        $view$;
    ELSE
        -- Create simplified view using only listings table
        RAISE NOTICE 'Creating SIMPLIFIED ML Data Pool (listings only)';

        EXECUTE $view$
        CREATE MATERIALIZED VIEW ml_data_pool AS
        SELECT
            l.id as listing_id,
            NULL::integer as asin_entity_id,
            l.seller_sku as sku,
            l.asin,
            'LISTING' as entity_type,
            l.title,
            NULL::varchar as brand,
            l.category::varchar as category,
            l.description,
            l."bulletPoints" as bullet_points,
            l.status as listing_status,
            l."fulfillmentChannel" as fulfillment_channel,
            NULL::boolean as is_tracked,
            l.price_inc_vat as current_price,
            l.available_quantity as current_quantity,
            -- No Keepa data available
            NULL::numeric as keepa_price_current,
            NULL::numeric as keepa_price_median_90d,
            NULL::numeric as keepa_volatility_90d,
            NULL::int as keepa_offers_count,
            NULL::int as keepa_sales_rank,
            NULL::timestamp as keepa_captured_at,
            -- No BOM data available
            NULL::int as bom_id,
            NULL::numeric as bom_cost_ex_vat,
            -- No feature store data available
            NULL::numeric as computed_margin,
            NULL::numeric as opportunity_score,
            NULL::jsonb as all_features,
            NULL::timestamp as features_computed_at,
            -- No sales data available
            0 as sales_30d_units,
            0::numeric as sales_30d_revenue,
            -- No recommendations available
            0 as pending_recommendations,
            -- Timestamps
            l."createdAt" as listing_created_at,
            l."updatedAt" as listing_updated_at,
            NULL::timestamp as asin_tracked_at,
            CURRENT_TIMESTAMP as snapshot_at
        FROM listings l
        $view$;
    END IF;
END $$;

-- Create indexes (works for both full and simplified views)
CREATE INDEX IF NOT EXISTS idx_ml_pool_listing ON ml_data_pool(listing_id) WHERE listing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ml_pool_asin_entity ON ml_data_pool(asin_entity_id) WHERE asin_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ml_pool_entity_type ON ml_data_pool(entity_type);
CREATE INDEX IF NOT EXISTS idx_ml_pool_sku ON ml_data_pool(sku);

-- Create refresh function
CREATE OR REPLACE FUNCTION refresh_ml_data_pool()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW ml_data_pool;
END;
$$ LANGUAGE plpgsql;

-- Create training export view (simplified version that works with any ml_data_pool)
CREATE OR REPLACE VIEW ml_training_export AS
SELECT
    listing_id,
    asin_entity_id,
    sku,
    asin,
    entity_type,
    COALESCE(current_price, keepa_price_current, 0) as price,
    COALESCE(current_quantity, 0) as quantity,
    COALESCE(keepa_price_median_90d, 0) as price_median_90d,
    COALESCE(keepa_volatility_90d, 0) as price_volatility,
    COALESCE(keepa_offers_count, 0) as competition_count,
    COALESCE(keepa_sales_rank, 999999) as sales_rank,
    COALESCE(bom_cost_ex_vat, 0) as cost,
    COALESCE(computed_margin, 0) as margin,
    COALESCE(opportunity_score, 0) as opportunity_score,
    COALESCE(sales_30d_units, 0) as sales_velocity,
    CASE WHEN fulfillment_channel = 'FBA' THEN 1 ELSE 0 END as is_fba,
    CASE WHEN bom_id IS NOT NULL THEN 1 ELSE 0 END as has_bom,
    snapshot_at
FROM ml_data_pool;

-- Grant access
GRANT SELECT ON ml_data_pool TO PUBLIC;
GRANT SELECT ON ml_training_export TO PUBLIC;

-- Initial refresh
REFRESH MATERIALIZED VIEW ml_data_pool;

SELECT 'ML Data Pool migration completed!' AS result;
