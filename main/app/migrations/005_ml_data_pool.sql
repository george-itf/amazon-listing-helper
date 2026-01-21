-- ============================================================================
-- ML Data Pool Migration
-- Creates a unified view of all data for machine learning training
--
-- NOTE: Uses migrated column names from 001_slice_a_schema.sql:
-- - seller_sku (was: sku)
-- - price_inc_vat (was: price)
-- - available_quantity (was: quantity)
--
-- NOTE: PostgreSQL doesn't support FULL OUTER JOIN with OR conditions,
-- so we use UNION ALL to combine matched and unmatched rows.
-- ============================================================================

-- Drop existing view if it exists
DROP MATERIALIZED VIEW IF EXISTS ml_data_pool CASCADE;

-- Create unified ML data pool materialized view
-- This combines data from all relevant tables into a single denormalized dataset
-- Uses UNION ALL approach to handle the full outer join semantics
CREATE MATERIALIZED VIEW ml_data_pool AS

-- Part 1: All ASIN entities with their matched listings (LEFT JOIN)
SELECT
    -- Entity identification
    COALESCE(l.id, ae.listing_id) as listing_id,
    ae.id as asin_entity_id,
    COALESCE(l.seller_sku, 'ASIN_' || ae.asin) as sku,
    COALESCE(l.asin, ae.asin) as asin,

    -- Entity type
    CASE
        WHEN l.id IS NOT NULL THEN 'LISTING'
        ELSE 'ASIN'
    END as entity_type,

    -- Basic product info
    COALESCE(l.title, ae.title) as title,
    ae.brand,
    ae.category,
    l.description,
    l."bulletPoints" as bullet_points,

    -- Listing status
    l.status as listing_status,
    l."fulfillmentChannel" as fulfillment_channel,
    ae.is_tracked,

    -- Pricing data (using migrated column names)
    l.price_inc_vat as current_price,
    l.available_quantity as current_quantity,

    -- Keepa market data (latest snapshot)
    (SELECT parsed_json->'metrics'->>'price_current' FROM keepa_snapshots WHERE asin_entity_id = ae.id ORDER BY captured_at DESC LIMIT 1)::numeric as keepa_price_current,
    (SELECT parsed_json->'metrics'->>'price_median_90d' FROM keepa_snapshots WHERE asin_entity_id = ae.id ORDER BY captured_at DESC LIMIT 1)::numeric as keepa_price_median_90d,
    (SELECT parsed_json->'metrics'->>'price_p25_90d' FROM keepa_snapshots WHERE asin_entity_id = ae.id ORDER BY captured_at DESC LIMIT 1)::numeric as keepa_price_p25_90d,
    (SELECT parsed_json->'metrics'->>'price_p75_90d' FROM keepa_snapshots WHERE asin_entity_id = ae.id ORDER BY captured_at DESC LIMIT 1)::numeric as keepa_price_p75_90d,
    (SELECT parsed_json->'metrics'->>'volatility_90d' FROM keepa_snapshots WHERE asin_entity_id = ae.id ORDER BY captured_at DESC LIMIT 1)::numeric as keepa_volatility_90d,
    (SELECT parsed_json->'metrics'->>'offers_count_current' FROM keepa_snapshots WHERE asin_entity_id = ae.id ORDER BY captured_at DESC LIMIT 1)::int as keepa_offers_count,
    (SELECT parsed_json->'metrics'->>'sales_rank_current' FROM keepa_snapshots WHERE asin_entity_id = ae.id ORDER BY captured_at DESC LIMIT 1)::int as keepa_sales_rank,
    (SELECT parsed_json->'metrics'->>'rank_trend_90d' FROM keepa_snapshots WHERE asin_entity_id = ae.id ORDER BY captured_at DESC LIMIT 1)::numeric as keepa_rank_trend_90d,
    (SELECT parsed_json->'metrics'->>'buy_box_is_amazon' FROM keepa_snapshots WHERE asin_entity_id = ae.id ORDER BY captured_at DESC LIMIT 1)::boolean as keepa_buybox_is_amazon,
    (SELECT captured_at FROM keepa_snapshots WHERE asin_entity_id = ae.id ORDER BY captured_at DESC LIMIT 1) as keepa_captured_at,

    -- BOM/Cost data (active BOM)
    (SELECT id FROM boms WHERE listing_id = l.id AND is_active = true AND scope_type = 'LISTING' ORDER BY effective_from DESC LIMIT 1) as bom_id,
    (SELECT notes FROM boms WHERE listing_id = l.id AND is_active = true AND scope_type = 'LISTING' ORDER BY effective_from DESC LIMIT 1) as bom_notes,
    (SELECT COALESCE(
        (SELECT SUM(bl.quantity * (1 + COALESCE(bl.wastage_rate, 0)) * COALESCE(c.unit_cost_ex_vat, 0))
         FROM bom_lines bl JOIN components c ON c.id = bl.component_id WHERE bl.bom_id = b.id), 0)
     FROM boms b WHERE b.listing_id = l.id AND b.is_active = true AND b.scope_type = 'LISTING' ORDER BY b.effective_from DESC LIMIT 1) as bom_cost_ex_vat,
    (SELECT effective_from FROM boms WHERE listing_id = l.id AND is_active = true AND scope_type = 'LISTING' ORDER BY effective_from DESC LIMIT 1) as bom_effective_from,

    -- Feature store data (latest features)
    (SELECT features_json->>'margin' FROM feature_store WHERE (entity_type = 'LISTING' AND entity_id = l.id) OR (entity_type = 'ASIN' AND entity_id = ae.id) ORDER BY computed_at DESC LIMIT 1)::numeric as computed_margin,
    (SELECT features_json->>'profit_ex_vat' FROM feature_store WHERE (entity_type = 'LISTING' AND entity_id = l.id) OR (entity_type = 'ASIN' AND entity_id = ae.id) ORDER BY computed_at DESC LIMIT 1)::numeric as computed_profit,
    (SELECT features_json->>'break_even_price_inc_vat' FROM feature_store WHERE (entity_type = 'LISTING' AND entity_id = l.id) OR (entity_type = 'ASIN' AND entity_id = ae.id) ORDER BY computed_at DESC LIMIT 1)::numeric as break_even_price,
    (SELECT features_json->>'buy_box_status' FROM feature_store WHERE (entity_type = 'LISTING' AND entity_id = l.id) OR (entity_type = 'ASIN' AND entity_id = ae.id) ORDER BY computed_at DESC LIMIT 1)::text as buy_box_status,
    (SELECT features_json->>'buy_box_risk' FROM feature_store WHERE (entity_type = 'LISTING' AND entity_id = l.id) OR (entity_type = 'ASIN' AND entity_id = ae.id) ORDER BY computed_at DESC LIMIT 1)::text as buy_box_risk,
    (SELECT features_json->>'stockout_risk' FROM feature_store WHERE (entity_type = 'LISTING' AND entity_id = l.id) OR (entity_type = 'ASIN' AND entity_id = ae.id) ORDER BY computed_at DESC LIMIT 1)::text as stockout_risk,
    (SELECT features_json->>'opportunity_score' FROM feature_store WHERE (entity_type = 'LISTING' AND entity_id = l.id) OR (entity_type = 'ASIN' AND entity_id = ae.id) ORDER BY computed_at DESC LIMIT 1)::numeric as opportunity_score,
    (SELECT features_json->>'opportunity_margin' FROM feature_store WHERE (entity_type = 'LISTING' AND entity_id = l.id) OR (entity_type = 'ASIN' AND entity_id = ae.id) ORDER BY computed_at DESC LIMIT 1)::numeric as opportunity_margin,
    (SELECT features_json->>'opportunity_profit' FROM feature_store WHERE (entity_type = 'LISTING' AND entity_id = l.id) OR (entity_type = 'ASIN' AND entity_id = ae.id) ORDER BY computed_at DESC LIMIT 1)::numeric as opportunity_profit,
    (SELECT features_json FROM feature_store WHERE (entity_type = 'LISTING' AND entity_id = l.id) OR (entity_type = 'ASIN' AND entity_id = ae.id) ORDER BY computed_at DESC LIMIT 1) as all_features,
    (SELECT computed_at FROM feature_store WHERE (entity_type = 'LISTING' AND entity_id = l.id) OR (entity_type = 'ASIN' AND entity_id = ae.id) ORDER BY computed_at DESC LIMIT 1) as features_computed_at,

    -- Sales velocity (30 day)
    COALESCE((SELECT SUM(units) FROM listing_sales_daily WHERE listing_id = l.id AND date >= CURRENT_DATE - INTERVAL '30 days'), 0) as sales_30d_units,
    COALESCE((SELECT SUM(revenue_inc_vat) FROM listing_sales_daily WHERE listing_id = l.id AND date >= CURRENT_DATE - INTERVAL '30 days'), 0) as sales_30d_revenue,

    -- Recommendations pending
    COALESCE((SELECT COUNT(*) FROM recommendations WHERE (listing_id = l.id OR asin_entity_id = ae.id) AND status = 'PENDING'), 0) as pending_recommendations,

    -- Timestamps
    l."createdAt" as listing_created_at,
    l."updatedAt" as listing_updated_at,
    ae.created_at as asin_tracked_at,
    CURRENT_TIMESTAMP as snapshot_at

FROM asin_entities ae
LEFT JOIN listings l ON l.asin = ae.asin OR l.id = ae.listing_id

UNION ALL

-- Part 2: Listings that have no matching ASIN entity
SELECT
    l.id as listing_id,
    NULL::integer as asin_entity_id,
    l.seller_sku as sku,
    l.asin,
    'LISTING' as entity_type,
    l.title,
    NULL::varchar as brand,
    NULL::varchar as category,
    l.description,
    l."bulletPoints" as bullet_points,
    l.status as listing_status,
    l."fulfillmentChannel" as fulfillment_channel,
    NULL::boolean as is_tracked,
    l.price_inc_vat as current_price,
    l.available_quantity as current_quantity,
    -- Keepa data (NULL for listings without ASIN entity)
    NULL::numeric as keepa_price_current,
    NULL::numeric as keepa_price_median_90d,
    NULL::numeric as keepa_price_p25_90d,
    NULL::numeric as keepa_price_p75_90d,
    NULL::numeric as keepa_volatility_90d,
    NULL::int as keepa_offers_count,
    NULL::int as keepa_sales_rank,
    NULL::numeric as keepa_rank_trend_90d,
    NULL::boolean as keepa_buybox_is_amazon,
    NULL::timestamp as keepa_captured_at,
    -- BOM data
    (SELECT id FROM boms WHERE listing_id = l.id AND is_active = true AND scope_type = 'LISTING' ORDER BY effective_from DESC LIMIT 1) as bom_id,
    (SELECT notes FROM boms WHERE listing_id = l.id AND is_active = true AND scope_type = 'LISTING' ORDER BY effective_from DESC LIMIT 1) as bom_notes,
    (SELECT COALESCE(
        (SELECT SUM(bl.quantity * (1 + COALESCE(bl.wastage_rate, 0)) * COALESCE(c.unit_cost_ex_vat, 0))
         FROM bom_lines bl JOIN components c ON c.id = bl.component_id WHERE bl.bom_id = b.id), 0)
     FROM boms b WHERE b.listing_id = l.id AND b.is_active = true AND b.scope_type = 'LISTING' ORDER BY b.effective_from DESC LIMIT 1) as bom_cost_ex_vat,
    (SELECT effective_from FROM boms WHERE listing_id = l.id AND is_active = true AND scope_type = 'LISTING' ORDER BY effective_from DESC LIMIT 1) as bom_effective_from,
    -- Feature store (listing only)
    (SELECT features_json->>'margin' FROM feature_store WHERE entity_type = 'LISTING' AND entity_id = l.id ORDER BY computed_at DESC LIMIT 1)::numeric as computed_margin,
    (SELECT features_json->>'profit_ex_vat' FROM feature_store WHERE entity_type = 'LISTING' AND entity_id = l.id ORDER BY computed_at DESC LIMIT 1)::numeric as computed_profit,
    (SELECT features_json->>'break_even_price_inc_vat' FROM feature_store WHERE entity_type = 'LISTING' AND entity_id = l.id ORDER BY computed_at DESC LIMIT 1)::numeric as break_even_price,
    (SELECT features_json->>'buy_box_status' FROM feature_store WHERE entity_type = 'LISTING' AND entity_id = l.id ORDER BY computed_at DESC LIMIT 1)::text as buy_box_status,
    (SELECT features_json->>'buy_box_risk' FROM feature_store WHERE entity_type = 'LISTING' AND entity_id = l.id ORDER BY computed_at DESC LIMIT 1)::text as buy_box_risk,
    (SELECT features_json->>'stockout_risk' FROM feature_store WHERE entity_type = 'LISTING' AND entity_id = l.id ORDER BY computed_at DESC LIMIT 1)::text as stockout_risk,
    (SELECT features_json->>'opportunity_score' FROM feature_store WHERE entity_type = 'LISTING' AND entity_id = l.id ORDER BY computed_at DESC LIMIT 1)::numeric as opportunity_score,
    (SELECT features_json->>'opportunity_margin' FROM feature_store WHERE entity_type = 'LISTING' AND entity_id = l.id ORDER BY computed_at DESC LIMIT 1)::numeric as opportunity_margin,
    (SELECT features_json->>'opportunity_profit' FROM feature_store WHERE entity_type = 'LISTING' AND entity_id = l.id ORDER BY computed_at DESC LIMIT 1)::numeric as opportunity_profit,
    (SELECT features_json FROM feature_store WHERE entity_type = 'LISTING' AND entity_id = l.id ORDER BY computed_at DESC LIMIT 1) as all_features,
    (SELECT computed_at FROM feature_store WHERE entity_type = 'LISTING' AND entity_id = l.id ORDER BY computed_at DESC LIMIT 1) as features_computed_at,
    -- Sales
    COALESCE((SELECT SUM(units) FROM listing_sales_daily WHERE listing_id = l.id AND date >= CURRENT_DATE - INTERVAL '30 days'), 0) as sales_30d_units,
    COALESCE((SELECT SUM(revenue_inc_vat) FROM listing_sales_daily WHERE listing_id = l.id AND date >= CURRENT_DATE - INTERVAL '30 days'), 0) as sales_30d_revenue,
    -- Recommendations
    COALESCE((SELECT COUNT(*) FROM recommendations WHERE listing_id = l.id AND status = 'PENDING'), 0) as pending_recommendations,
    -- Timestamps
    l."createdAt" as listing_created_at,
    l."updatedAt" as listing_updated_at,
    NULL::timestamp as asin_tracked_at,
    CURRENT_TIMESTAMP as snapshot_at

FROM listings l
WHERE NOT EXISTS (
    SELECT 1 FROM asin_entities ae
    WHERE ae.asin = l.asin OR ae.listing_id = l.id
);

-- Create indexes for efficient querying
CREATE UNIQUE INDEX idx_ml_pool_unique ON ml_data_pool(COALESCE(listing_id, 0), COALESCE(asin_entity_id, 0));
CREATE INDEX idx_ml_pool_listing ON ml_data_pool(listing_id) WHERE listing_id IS NOT NULL;
CREATE INDEX idx_ml_pool_asin ON ml_data_pool(asin_entity_id) WHERE asin_entity_id IS NOT NULL;
CREATE INDEX idx_ml_pool_entity_type ON ml_data_pool(entity_type);
CREATE INDEX idx_ml_pool_opportunity ON ml_data_pool(opportunity_score DESC NULLS LAST);
CREATE INDEX idx_ml_pool_margin ON ml_data_pool(computed_margin DESC NULLS LAST);

-- Function to refresh the ML data pool
CREATE OR REPLACE FUNCTION refresh_ml_data_pool()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY ml_data_pool;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ML Training Export View (flat format for ML tools)
-- ============================================================================
CREATE OR REPLACE VIEW ml_training_export AS
SELECT
    -- Identifiers (for reference, not features)
    listing_id,
    asin_entity_id,
    sku,
    asin,
    entity_type,

    -- Numerical features for ML
    COALESCE(current_price, keepa_price_current, 0) as price,
    COALESCE(current_quantity, 0) as quantity,
    COALESCE(keepa_price_median_90d, 0) as price_median_90d,
    COALESCE(keepa_volatility_90d, 0) as price_volatility,
    COALESCE(keepa_offers_count, 0) as competition_count,
    COALESCE(keepa_sales_rank, 999999) as sales_rank,
    COALESCE(keepa_rank_trend_90d, 0) as rank_trend,
    COALESCE(bom_cost_ex_vat, 0) as cost,
    COALESCE(computed_margin, 0) as margin,
    COALESCE(computed_profit, 0) as profit,
    COALESCE(opportunity_score, 0) as opportunity_score,
    COALESCE(sales_30d_units, 0) as sales_velocity,

    -- Categorical features
    CASE WHEN fulfillment_channel = 'FBA' THEN 1 ELSE 0 END as is_fba,
    CASE WHEN keepa_buybox_is_amazon THEN 1 ELSE 0 END as amazon_on_listing,
    CASE WHEN bom_id IS NOT NULL THEN 1 ELSE 0 END as has_bom,
    CASE WHEN buy_box_status = 'WON' THEN 1 ELSE 0 END as has_buybox,

    -- Target variables (for supervised learning)
    CASE
        WHEN computed_margin >= 0.20 THEN 'HIGH'
        WHEN computed_margin >= 0.10 THEN 'MEDIUM'
        ELSE 'LOW'
    END as margin_tier,

    CASE
        WHEN sales_30d_units >= 30 THEN 'HIGH'
        WHEN sales_30d_units >= 10 THEN 'MEDIUM'
        ELSE 'LOW'
    END as sales_tier,

    -- Data quality indicators
    CASE WHEN keepa_captured_at > CURRENT_TIMESTAMP - INTERVAL '7 days' THEN 1 ELSE 0 END as keepa_fresh,
    CASE WHEN features_computed_at > CURRENT_TIMESTAMP - INTERVAL '1 day' THEN 1 ELSE 0 END as features_fresh,

    snapshot_at

FROM ml_data_pool;

-- Grant access
GRANT SELECT ON ml_data_pool TO PUBLIC;
GRANT SELECT ON ml_training_export TO PUBLIC;

-- Initial refresh
REFRESH MATERIALIZED VIEW ml_data_pool;

SELECT 'ML Data Pool created successfully!' AS result;
