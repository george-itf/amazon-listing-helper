-- ============================================================================
-- ML Data Pool Migration
-- Creates a unified view of all data for machine learning training
-- ============================================================================

-- Drop existing view if it exists
DROP MATERIALIZED VIEW IF EXISTS ml_data_pool CASCADE;

-- Create unified ML data pool materialized view
-- This combines data from all relevant tables into a single denormalized dataset
CREATE MATERIALIZED VIEW ml_data_pool AS
SELECT
    -- Entity identification
    COALESCE(l.id, ae.listing_id) as listing_id,
    ae.id as asin_entity_id,
    COALESCE(l.sku, 'ASIN_' || ae.asin) as sku,
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

    -- Pricing data
    l.price as current_price,
    l.quantity as current_quantity,

    -- Keepa market data (latest snapshot)
    (ks.parsed_json->'metrics'->>'price_current')::numeric as keepa_price_current,
    (ks.parsed_json->'metrics'->>'price_median_90d')::numeric as keepa_price_median_90d,
    (ks.parsed_json->'metrics'->>'price_p25_90d')::numeric as keepa_price_p25_90d,
    (ks.parsed_json->'metrics'->>'price_p75_90d')::numeric as keepa_price_p75_90d,
    (ks.parsed_json->'metrics'->>'volatility_90d')::numeric as keepa_volatility_90d,
    (ks.parsed_json->'metrics'->>'offers_count_current')::int as keepa_offers_count,
    (ks.parsed_json->'metrics'->>'sales_rank_current')::int as keepa_sales_rank,
    (ks.parsed_json->'metrics'->>'rank_trend_90d')::numeric as keepa_rank_trend_90d,
    (ks.parsed_json->'metrics'->>'buy_box_is_amazon')::boolean as keepa_buybox_is_amazon,
    ks.captured_at as keepa_captured_at,

    -- BOM/Cost data (active BOM)
    bom.id as bom_id,
    bom.name as bom_name,
    bom.total_cost_ex_vat as bom_cost_ex_vat,
    bom.effective_from as bom_effective_from,

    -- Feature store data (latest features)
    (fs.features_json->>'margin')::numeric as computed_margin,
    (fs.features_json->>'profit_ex_vat')::numeric as computed_profit,
    (fs.features_json->>'break_even_price_inc_vat')::numeric as break_even_price,
    (fs.features_json->>'buy_box_status')::text as buy_box_status,
    (fs.features_json->>'buy_box_risk')::text as buy_box_risk,
    (fs.features_json->>'stockout_risk')::text as stockout_risk,
    (fs.features_json->>'opportunity_score')::numeric as opportunity_score,
    (fs.features_json->>'opportunity_margin')::numeric as opportunity_margin,
    (fs.features_json->>'opportunity_profit')::numeric as opportunity_profit,
    fs.features_json as all_features,
    fs.computed_at as features_computed_at,

    -- Sales velocity (30 day)
    COALESCE(sales.total_units, 0) as sales_30d_units,
    COALESCE(sales.total_revenue, 0) as sales_30d_revenue,

    -- Recommendations pending
    COALESCE(rec.pending_count, 0) as pending_recommendations,

    -- Timestamps
    l."createdAt" as listing_created_at,
    l."updatedAt" as listing_updated_at,
    ae.created_at as asin_tracked_at,
    CURRENT_TIMESTAMP as snapshot_at

FROM asin_entities ae
FULL OUTER JOIN listings l ON l.asin = ae.asin OR l.id = ae.listing_id

-- Latest Keepa snapshot
LEFT JOIN LATERAL (
    SELECT parsed_json, captured_at
    FROM keepa_snapshots
    WHERE asin_entity_id = ae.id
    ORDER BY captured_at DESC
    LIMIT 1
) ks ON true

-- Active BOM
LEFT JOIN LATERAL (
    SELECT b.id, b.name, b.total_cost_ex_vat, b.effective_from
    FROM boms b
    WHERE b.listing_id = l.id
      AND b.status = 'ACTIVE'
    ORDER BY b.effective_from DESC
    LIMIT 1
) bom ON true

-- Latest feature store entry
LEFT JOIN LATERAL (
    SELECT features_json, computed_at
    FROM feature_store
    WHERE (entity_type = 'LISTING' AND entity_id = l.id)
       OR (entity_type = 'ASIN' AND entity_id = ae.id)
    ORDER BY computed_at DESC
    LIMIT 1
) fs ON true

-- 30-day sales
LEFT JOIN LATERAL (
    SELECT
        SUM(units) as total_units,
        SUM(revenue) as total_revenue
    FROM listing_sales_daily
    WHERE listing_id = l.id
      AND date >= CURRENT_DATE - INTERVAL '30 days'
) sales ON true

-- Pending recommendations
LEFT JOIN LATERAL (
    SELECT COUNT(*) as pending_count
    FROM recommendations
    WHERE (listing_id = l.id OR asin_entity_id = ae.id)
      AND status = 'PENDING'
) rec ON true

WHERE ae.id IS NOT NULL OR l.id IS NOT NULL;

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
