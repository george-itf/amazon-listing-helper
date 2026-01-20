# Database Schema Design

## Overview

This document details the database schema for the Amazon Seller ML Listing Helper. We use PostgreSQL with TimescaleDB extension for time-series data.

---

## 1. Schema Organization

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATABASE SCHEMAS                                   │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │   catalog   │  │   pricing   │  │  analytics  │  │   system    │       │
│  │             │  │             │  │             │  │             │       │
│  │ - listings  │  │ - prices    │  │ - metrics   │  │ - settings  │       │
│  │ - keywords  │  │ - costs     │  │ - events    │  │ - jobs      │       │
│  │ - images    │  │ - margins   │  │ - scores    │  │ - audit     │       │
│  │ - variants  │  │ - rules     │  │ - cohorts   │  │ - creds     │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │ competitors │  │  inventory  │  │  workflow   │  │  reporting  │       │
│  │             │  │             │  │             │  │             │       │
│  │ - products  │  │ - stock     │  │ - tasks     │  │ - templates │       │
│  │ - tracking  │  │ - forecasts │  │ - rules     │  │ - exports   │       │
│  │ - alerts    │  │ - suppliers │  │ - stages    │  │ - schedules │       │
│  │ - history   │  │ - bom       │  │ - automtn   │  │             │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Catalog Schema

### 2.1 Listings Table

```sql
-- Core listing data synchronized from SP-API
CREATE TABLE catalog.listings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Amazon Identifiers
    asin                VARCHAR(10) NOT NULL UNIQUE,
    sku                 VARCHAR(50) NOT NULL UNIQUE,
    marketplace_id      VARCHAR(20) NOT NULL DEFAULT 'A1F83G8C2ARO7P', -- UK
    fnsku               VARCHAR(20),

    -- Basic Info
    title               TEXT NOT NULL,
    brand               VARCHAR(255),
    manufacturer        VARCHAR(255),
    model_number        VARCHAR(100),
    part_number         VARCHAR(100),

    -- Category (DIY & Tools focus)
    category_id         BIGINT,
    category_path       TEXT[], -- ['Tools & Home Improvement', 'Power Tools', 'Drills']
    browse_node_id      BIGINT,

    -- Content
    bullet_points       TEXT[], -- Array of 5 bullet points
    description         TEXT,
    search_terms        TEXT[], -- Backend search terms

    -- A+ Content
    aplus_enabled       BOOLEAN DEFAULT FALSE,
    aplus_content_id    VARCHAR(50),
    brand_story_enabled BOOLEAN DEFAULT FALSE,

    -- Status
    status              VARCHAR(20) NOT NULL DEFAULT 'active',
    -- active, inactive, suppressed, incomplete
    fulfillment_channel VARCHAR(10) NOT NULL DEFAULT 'FBM',
    condition_type      VARCHAR(20) DEFAULT 'new_new',

    -- Variation Info
    parent_asin         VARCHAR(10),
    variation_type      VARCHAR(50), -- 'parent', 'child', 'standalone'
    variation_theme     VARCHAR(50), -- 'Size', 'Color', etc.
    variation_attributes JSONB,

    -- Custom Organization
    tags                TEXT[],
    custom_category     VARCHAR(100), -- 'screws', 'power_tools', 'accessories'
    product_group       VARCHAR(100),
    lifecycle_stage     VARCHAR(20) DEFAULT 'active',
    -- 'launch', 'growth', 'mature', 'decline', 'discontinue'

    -- Scoring (denormalized for quick access)
    current_score       DECIMAL(5,2),
    score_updated_at    TIMESTAMPTZ,

    -- Sync Metadata
    last_synced_at      TIMESTAMPTZ,
    sp_api_hash         VARCHAR(64), -- Detect changes

    -- Timestamps
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_listings_asin ON catalog.listings(asin);
CREATE INDEX idx_listings_sku ON catalog.listings(sku);
CREATE INDEX idx_listings_category ON catalog.listings(custom_category);
CREATE INDEX idx_listings_tags ON catalog.listings USING GIN(tags);
CREATE INDEX idx_listings_status ON catalog.listings(status);
CREATE INDEX idx_listings_parent ON catalog.listings(parent_asin);
CREATE INDEX idx_listings_score ON catalog.listings(current_score DESC);
```

### 2.2 Listing Versions (Content Versioning)

```sql
-- Track all changes to listing content for rollback
CREATE TABLE catalog.listing_versions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id          UUID NOT NULL REFERENCES catalog.listings(id),
    version_number      INTEGER NOT NULL,

    -- Snapshot of content at this version
    title               TEXT,
    bullet_points       TEXT[],
    description         TEXT,
    search_terms        TEXT[],

    -- Change metadata
    change_type         VARCHAR(20) NOT NULL, -- 'manual', 'auto', 'sync', 'rollback'
    change_source       VARCHAR(50), -- 'user', 'automation_rule_id', 'sp_api_sync'
    change_reason       TEXT,

    -- Scoring at this version
    score_at_change     DECIMAL(5,2),

    created_at          TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(listing_id, version_number)
);

CREATE INDEX idx_versions_listing ON catalog.listing_versions(listing_id);
CREATE INDEX idx_versions_created ON catalog.listing_versions(created_at DESC);
```

### 2.3 Listing Images

```sql
CREATE TABLE catalog.listing_images (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id          UUID NOT NULL REFERENCES catalog.listings(id),

    -- Image Info
    image_type          VARCHAR(20) NOT NULL, -- 'main', 'pt01'-'pt08', 'swatch'
    url                 TEXT NOT NULL,
    url_thumb           TEXT,
    width               INTEGER,
    height              INTEGER,

    -- Quality Analysis (from Vision API - future)
    quality_score       DECIMAL(5,2),
    has_text            BOOLEAN,
    has_lifestyle       BOOLEAN,
    has_infographic     BOOLEAN,
    background_type     VARCHAR(20), -- 'white', 'lifestyle', 'other'
    analysis_data       JSONB,
    analyzed_at         TIMESTAMPTZ,

    sort_order          INTEGER DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_images_listing ON catalog.listing_images(listing_id);
```

### 2.4 Keywords

```sql
-- Keywords associated with listings
CREATE TABLE catalog.keywords (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id          UUID NOT NULL REFERENCES catalog.listings(id),

    keyword             TEXT NOT NULL,
    keyword_normalized  TEXT NOT NULL, -- Lowercase, trimmed

    -- Source
    source              VARCHAR(20) NOT NULL,
    -- 'title', 'bullets', 'backend', 'competitor', 'suggested', 'manual'

    -- Metrics (from Search Terms Report)
    search_volume       INTEGER,
    search_volume_trend DECIMAL(5,2), -- % change
    organic_rank        INTEGER, -- Current rank for this keyword
    sponsored_rank      INTEGER,

    -- Relevance
    relevance_score     DECIMAL(5,2), -- How relevant to the product
    conversion_rate     DECIMAL(5,4), -- If we have this data

    -- Tracking
    is_primary          BOOLEAN DEFAULT FALSE,
    is_tracked          BOOLEAN DEFAULT TRUE,

    last_updated        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_keywords_listing ON catalog.keywords(listing_id);
CREATE INDEX idx_keywords_keyword ON catalog.keywords(keyword_normalized);
CREATE INDEX idx_keywords_volume ON catalog.keywords(search_volume DESC NULLS LAST);
```

---

## 3. Pricing Schema

### 3.1 Current Prices

```sql
CREATE TABLE pricing.current_prices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id          UUID NOT NULL REFERENCES catalog.listings(id) UNIQUE,

    -- Current Price
    price               DECIMAL(10,2) NOT NULL,
    currency            VARCHAR(3) DEFAULT 'GBP',

    -- Sale Price (if applicable)
    sale_price          DECIMAL(10,2),
    sale_start_date     DATE,
    sale_end_date       DATE,

    -- Buy Box
    has_buy_box         BOOLEAN,
    buy_box_price       DECIMAL(10,2),
    buy_box_seller      VARCHAR(100),
    buy_box_percentage  DECIMAL(5,2), -- Your BB win rate

    -- Landed Cost (from BOM)
    landed_cost         DECIMAL(10,2),
    landed_cost_updated TIMESTAMPTZ,

    -- Calculated Margins
    gross_margin        DECIMAL(10,2),
    gross_margin_pct    DECIMAL(5,2),
    net_margin          DECIMAL(10,2), -- After Amazon fees
    net_margin_pct      DECIMAL(5,2),

    -- Amazon Fees
    referral_fee        DECIMAL(10,2),
    fba_fee             DECIMAL(10,2), -- If applicable

    -- Price Optimization
    optimal_price       DECIMAL(10,2), -- Suggested by system
    price_confidence    DECIMAL(5,2), -- Confidence in suggestion
    last_optimized_at   TIMESTAMPTZ,

    -- Constraints
    min_price           DECIMAL(10,2), -- User-defined floor
    max_price           DECIMAL(10,2), -- User-defined ceiling
    margin_floor_pct    DECIMAL(5,2), -- Minimum margin allowed

    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_prices_listing ON pricing.current_prices(listing_id);
CREATE INDEX idx_prices_margin ON pricing.current_prices(net_margin_pct DESC);
```

### 3.2 Price History (TimescaleDB Hypertable)

```sql
-- Time-series price data
CREATE TABLE pricing.price_history (
    time                TIMESTAMPTZ NOT NULL,
    listing_id          UUID NOT NULL REFERENCES catalog.listings(id),

    price               DECIMAL(10,2) NOT NULL,
    sale_price          DECIMAL(10,2),
    buy_box_price       DECIMAL(10,2),
    has_buy_box         BOOLEAN,

    -- Source of data
    source              VARCHAR(20) NOT NULL, -- 'sp_api', 'keepa', 'manual'

    PRIMARY KEY (listing_id, time)
);

-- Convert to TimescaleDB hypertable
SELECT create_hypertable('pricing.price_history', 'time');

-- Compression policy (compress data older than 30 days)
ALTER TABLE pricing.price_history SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'listing_id'
);

SELECT add_compression_policy('pricing.price_history', INTERVAL '30 days');

-- Retention policy (keep 2 years)
SELECT add_retention_policy('pricing.price_history', INTERVAL '2 years');
```

### 3.3 Price Rules

```sql
CREATE TABLE pricing.price_rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name                VARCHAR(100) NOT NULL,
    description         TEXT,

    -- Scope
    applies_to          VARCHAR(20) NOT NULL, -- 'all', 'category', 'tag', 'listing'
    scope_value         TEXT, -- Category name, tag, or listing_id

    -- Rule Type
    rule_type           VARCHAR(30) NOT NULL,
    -- 'margin_floor', 'competitor_match', 'competitor_beat', 'time_based', 'inventory_based'

    -- Rule Configuration
    config              JSONB NOT NULL,
    /*
    Examples:
    margin_floor: { "min_margin_pct": 20 }
    competitor_match: { "competitor_asin": "B08XXX", "match_type": "beat", "beat_by_pct": 2 }
    time_based: { "schedule": "0 9 * * 1-5", "price_change_pct": -5 }
    inventory_based: { "when_below": 10, "price_change_pct": 15 }
    */

    -- Priority (higher = more important)
    priority            INTEGER DEFAULT 100,

    -- Status
    is_active           BOOLEAN DEFAULT TRUE,

    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 4. BOM & Cost Schema

### 4.1 Suppliers

```sql
CREATE TABLE inventory.suppliers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name                VARCHAR(255) NOT NULL,
    code                VARCHAR(50) UNIQUE,

    -- Contact
    contact_name        VARCHAR(255),
    email               VARCHAR(255),
    phone               VARCHAR(50),

    -- Location
    country             VARCHAR(2) DEFAULT 'GB',
    is_domestic         BOOLEAN DEFAULT TRUE,

    -- Terms
    payment_terms       VARCHAR(50), -- 'Net30', 'COD', etc.
    lead_time_days      INTEGER,
    min_order_value     DECIMAL(10,2),

    -- Performance
    quality_score       DECIMAL(5,2),
    reliability_score   DECIMAL(5,2),

    notes               TEXT,
    is_active           BOOLEAN DEFAULT TRUE,

    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.2 Components

```sql
CREATE TABLE inventory.components (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name                VARCHAR(255) NOT NULL,
    sku                 VARCHAR(100) UNIQUE,
    description         TEXT,

    -- Category
    component_type      VARCHAR(50), -- 'raw_material', 'packaging', 'label', 'accessory'

    -- Default Supplier
    default_supplier_id UUID REFERENCES inventory.suppliers(id),

    -- Stock Info
    stock_quantity      INTEGER DEFAULT 0,
    reorder_point       INTEGER,
    reorder_quantity    INTEGER,

    -- Unit
    unit_of_measure     VARCHAR(20) DEFAULT 'each', -- 'each', 'kg', 'meter', etc.

    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.3 Component Prices

```sql
CREATE TABLE inventory.component_prices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    component_id        UUID NOT NULL REFERENCES inventory.components(id),
    supplier_id         UUID NOT NULL REFERENCES inventory.suppliers(id),

    -- Pricing
    unit_cost           DECIMAL(10,4) NOT NULL,
    currency            VARCHAR(3) DEFAULT 'GBP',

    -- Quantity Breaks
    min_quantity        INTEGER DEFAULT 1,

    -- Validity
    valid_from          DATE DEFAULT CURRENT_DATE,
    valid_to            DATE,

    -- Import Costs (for international suppliers)
    import_duty_pct     DECIMAL(5,2) DEFAULT 0,
    shipping_cost       DECIMAL(10,2) DEFAULT 0,

    is_current          BOOLEAN DEFAULT TRUE,

    created_at          TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(component_id, supplier_id, min_quantity, valid_from)
);
```

### 4.4 Bill of Materials

```sql
CREATE TABLE inventory.bill_of_materials (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id          UUID NOT NULL REFERENCES catalog.listings(id),
    component_id        UUID NOT NULL REFERENCES inventory.components(id),

    quantity            DECIMAL(10,4) NOT NULL DEFAULT 1,

    -- Override pricing for this specific BOM entry
    cost_override       DECIMAL(10,4),

    notes               TEXT,

    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(listing_id, component_id)
);

-- Helper view to calculate landed costs
CREATE VIEW inventory.listing_landed_costs AS
SELECT
    l.id AS listing_id,
    l.asin,
    l.sku,
    SUM(
        COALESCE(bom.cost_override, cp.unit_cost) * bom.quantity
    ) AS component_cost,
    -- Add labor, shipping estimates as needed
    SUM(
        COALESCE(bom.cost_override, cp.unit_cost) * bom.quantity
    ) * 1.1 AS estimated_landed_cost -- 10% overhead estimate
FROM catalog.listings l
JOIN inventory.bill_of_materials bom ON l.id = bom.listing_id
JOIN inventory.component_prices cp ON bom.component_id = cp.component_id
    AND cp.is_current = TRUE
GROUP BY l.id, l.asin, l.sku;
```

---

## 5. Competitors Schema

### 5.1 Competitor Products

```sql
CREATE TABLE competitors.products (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    asin                VARCHAR(10) NOT NULL UNIQUE,
    marketplace_id      VARCHAR(20) NOT NULL DEFAULT 'A1F83G8C2ARO7P',

    -- Basic Info (from Keepa/scraping)
    title               TEXT,
    brand               VARCHAR(255),
    seller_name         VARCHAR(255),
    seller_id           VARCHAR(50),

    -- Category
    category_path       TEXT[],

    -- Current State
    current_price       DECIMAL(10,2),
    current_bsr         INTEGER,
    review_count        INTEGER,
    rating              DECIMAL(3,2),

    -- Buy Box
    buy_box_price       DECIMAL(10,2),
    buy_box_seller      VARCHAR(255),
    is_amazon_seller    BOOLEAN DEFAULT FALSE,

    -- Tracking Config
    threat_score        DECIMAL(5,2), -- Composite threat level
    tracking_priority   VARCHAR(20) DEFAULT 'normal', -- 'high', 'normal', 'low'

    -- Related to which of your listings
    tracked_for_listings UUID[], -- Array of your listing IDs

    -- Sync
    last_synced_at      TIMESTAMPTZ,
    keepa_domain_id     INTEGER DEFAULT 3, -- UK

    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_competitor_asin ON competitors.products(asin);
CREATE INDEX idx_competitor_threat ON competitors.products(threat_score DESC);
```

### 5.2 Competitor Price History (TimescaleDB)

```sql
CREATE TABLE competitors.price_history (
    time                TIMESTAMPTZ NOT NULL,
    competitor_id       UUID NOT NULL REFERENCES competitors.products(id),

    price               DECIMAL(10,2),
    buy_box_price       DECIMAL(10,2),
    bsr                 INTEGER,

    source              VARCHAR(20) DEFAULT 'keepa',

    PRIMARY KEY (competitor_id, time)
);

SELECT create_hypertable('competitors.price_history', 'time');
```

### 5.3 Competitor Alerts

```sql
CREATE TABLE competitors.alerts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor_id       UUID NOT NULL REFERENCES competitors.products(id),

    alert_type          VARCHAR(30) NOT NULL,
    -- 'price_drop', 'price_increase', 'bsr_change', 'new_competitor',
    -- 'listing_change', 'out_of_stock', 'back_in_stock'

    -- Change Details
    previous_value      TEXT,
    new_value           TEXT,
    change_pct          DECIMAL(10,2),

    -- Impact Assessment
    severity            VARCHAR(10) DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
    affected_listings   UUID[], -- Your listings affected

    -- Status
    status              VARCHAR(20) DEFAULT 'new', -- 'new', 'viewed', 'actioned', 'dismissed'
    actioned_at         TIMESTAMPTZ,
    action_taken        TEXT,

    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alerts_status ON competitors.alerts(status, created_at DESC);
CREATE INDEX idx_alerts_severity ON competitors.alerts(severity, created_at DESC);
```

---

## 6. Analytics Schema

### 6.1 Listing Scores (TimescaleDB)

```sql
CREATE TABLE analytics.listing_scores (
    time                TIMESTAMPTZ NOT NULL,
    listing_id          UUID NOT NULL REFERENCES catalog.listings(id),

    -- Overall Score
    total_score         DECIMAL(5,2) NOT NULL,

    -- Component Scores
    seo_score           DECIMAL(5,2),
    content_score       DECIMAL(5,2),
    image_score         DECIMAL(5,2),
    competitive_score   DECIMAL(5,2),
    compliance_score    DECIMAL(5,2),

    -- Individual Metrics (for drill-down)
    score_breakdown     JSONB,
    /*
    {
        "title_length": 85,
        "title_keywords": 92,
        "bullet_count": 100,
        "bullet_quality": 78,
        "image_count": 80,
        "main_image_quality": 90,
        ...
    }
    */

    -- Scoring Context
    scoring_version     VARCHAR(20), -- Version of scoring algorithm

    PRIMARY KEY (listing_id, time)
);

SELECT create_hypertable('analytics.listing_scores', 'time');
```

### 6.2 Performance Metrics (TimescaleDB)

```sql
CREATE TABLE analytics.performance_metrics (
    time                TIMESTAMPTZ NOT NULL,
    listing_id          UUID NOT NULL REFERENCES catalog.listings(id),

    -- Traffic (from Business Reports)
    sessions            INTEGER,
    page_views          INTEGER,
    page_views_pct      DECIMAL(5,4),

    -- Conversion
    units_ordered       INTEGER,
    unit_session_pct    DECIMAL(5,4), -- Conversion rate

    -- Revenue
    ordered_product_sales DECIMAL(12,2),
    currency            VARCHAR(3) DEFAULT 'GBP',

    -- Buy Box
    buy_box_pct         DECIMAL(5,2),

    -- BSR
    bsr                 INTEGER,
    bsr_category        VARCHAR(255),

    -- Source
    report_date         DATE,

    PRIMARY KEY (listing_id, time)
);

SELECT create_hypertable('analytics.performance_metrics', 'time');
```

### 6.3 Attribution Events

```sql
-- Track which changes led to which outcomes
CREATE TABLE analytics.attribution_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id          UUID NOT NULL REFERENCES catalog.listings(id),

    -- The Change
    change_type         VARCHAR(50) NOT NULL,
    -- 'title_update', 'bullet_update', 'price_change', 'image_add', etc.
    change_id           UUID, -- Reference to version or price change
    change_timestamp    TIMESTAMPTZ NOT NULL,

    -- Before/After Metrics (7 days before, 7 days after)
    metrics_before      JSONB,
    metrics_after       JSONB,
    /*
    {
        "sessions_avg": 45,
        "conversion_rate": 0.12,
        "bsr_avg": 5420,
        "revenue_total": 1234.56
    }
    */

    -- Calculated Impact
    impact_score        DECIMAL(5,2), -- Positive or negative impact
    confidence          DECIMAL(5,2), -- How confident in attribution

    -- Analysis
    analysis_date       DATE,
    analysis_notes      TEXT,

    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_attribution_listing ON analytics.attribution_events(listing_id);
CREATE INDEX idx_attribution_impact ON analytics.attribution_events(impact_score DESC);
```

---

## 7. Workflow Schema

### 7.1 Kanban Stages

```sql
CREATE TABLE workflow.kanban_stages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name                VARCHAR(100) NOT NULL,
    description         TEXT,
    color               VARCHAR(7), -- Hex color

    sort_order          INTEGER NOT NULL,
    is_default          BOOLEAN DEFAULT FALSE, -- Default stage for new tasks
    is_terminal         BOOLEAN DEFAULT FALSE, -- Marks completion

    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Default stages
INSERT INTO workflow.kanban_stages (name, sort_order, is_default, is_terminal, color) VALUES
('Backlog', 1, TRUE, FALSE, '#6B7280'),
('To Analyze', 2, FALSE, FALSE, '#3B82F6'),
('In Progress', 3, FALSE, FALSE, '#F59E0B'),
('Review', 4, FALSE, FALSE, '#8B5CF6'),
('Ready to Deploy', 5, FALSE, FALSE, '#10B981'),
('Monitoring', 6, FALSE, FALSE, '#06B6D4'),
('Done', 7, FALSE, TRUE, '#22C55E');
```

### 7.2 Tasks

```sql
CREATE TABLE workflow.tasks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Basic Info
    title               VARCHAR(255) NOT NULL,
    description         TEXT,

    -- Classification
    task_type           VARCHAR(30) NOT NULL,
    -- 'optimization', 'pricing', 'competitive', 'compliance', 'launch', 'other'

    -- Related Entities
    listing_id          UUID REFERENCES catalog.listings(id),
    listing_ids         UUID[], -- For bulk tasks

    -- Workflow
    stage_id            UUID NOT NULL REFERENCES workflow.kanban_stages(id),

    -- Priority (smart-scored)
    priority_score      DECIMAL(5,2),
    priority_breakdown  JSONB,
    /*
    {
        "impact_score": 8.5,
        "ease_score": 6.0,
        "urgency_score": 9.0
    }
    */

    -- Source
    created_by          VARCHAR(20) DEFAULT 'system', -- 'system', 'user', 'rule'
    source_rule_id      UUID, -- If created by automation

    -- Scheduling
    due_date            DATE,
    scheduled_for       TIMESTAMPTZ,

    -- Completion
    completed_at        TIMESTAMPTZ,
    outcome             TEXT,

    -- Metadata
    tags                TEXT[],

    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_stage ON workflow.tasks(stage_id);
CREATE INDEX idx_tasks_listing ON workflow.tasks(listing_id);
CREATE INDEX idx_tasks_priority ON workflow.tasks(priority_score DESC);
CREATE INDEX idx_tasks_due ON workflow.tasks(due_date);
```

### 7.3 Automation Rules

```sql
CREATE TABLE workflow.automation_rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name                VARCHAR(100) NOT NULL,
    description         TEXT,

    -- Trigger
    trigger_type        VARCHAR(30) NOT NULL,
    -- 'threshold', 'competitive', 'time_based', 'event'
    trigger_config      JSONB NOT NULL,
    /*
    threshold: { "metric": "score", "operator": "lt", "value": 70 }
    competitive: { "event": "competitor_price_drop", "threshold_pct": 5 }
    time_based: { "cron": "0 9 * * 1" } -- Every Monday 9am
    event: { "event_type": "listing.synced" }
    */

    -- Conditions (AND logic)
    conditions          JSONB,
    /*
    [
        { "field": "listing.custom_category", "operator": "in", "value": ["power_tools"] },
        { "field": "listing.lifecycle_stage", "operator": "eq", "value": "growth" }
    ]
    */

    -- Actions
    action_type         VARCHAR(30) NOT NULL,
    -- 'create_task', 'update_price', 'send_alert', 'apply_template', 'tag_listing'
    action_config       JSONB NOT NULL,
    /*
    create_task: { "task_type": "optimization", "title_template": "Review {asin}" }
    update_price: { "change_type": "percentage", "value": -5 }
    send_alert: { "severity": "high", "message": "Competitor undercut!" }
    */

    -- Limits
    cooldown_minutes    INTEGER DEFAULT 60, -- Min time between triggers for same entity
    max_daily_triggers  INTEGER, -- NULL = unlimited

    -- Status
    is_active           BOOLEAN DEFAULT TRUE,
    last_triggered_at   TIMESTAMPTZ,
    trigger_count       INTEGER DEFAULT 0,

    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rules_active ON workflow.automation_rules(is_active, trigger_type);
```

---

## 8. System Schema

### 8.1 Settings

```sql
CREATE TABLE system.settings (
    key                 VARCHAR(100) PRIMARY KEY,
    value               JSONB NOT NULL,
    description         TEXT,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Default settings
INSERT INTO system.settings (key, value, description) VALUES
('scoring.weights', '{"seo": 0.25, "content": 0.25, "images": 0.20, "competitive": 0.15, "compliance": 0.15}', 'Weights for overall score calculation'),
('sync.sp_api.interval_minutes', '60', 'How often to sync from SP-API'),
('sync.keepa.tokens_per_minute', '21', 'Keepa API rate limit'),
('pricing.default_margin_floor', '0.20', 'Default minimum margin (20%)'),
('seasonality.uk_calendar', '{"diy_peak_months": [3,4,5,6,7,8], "holiday_weeks": ["2025-12-22", "2025-12-29"]}', 'UK seasonal patterns');
```

### 8.2 Audit Log

```sql
CREATE TABLE system.audit_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What Changed
    entity_type         VARCHAR(50) NOT NULL, -- 'listing', 'price', 'rule', etc.
    entity_id           UUID NOT NULL,
    action              VARCHAR(20) NOT NULL, -- 'create', 'update', 'delete'

    -- Change Details
    changes             JSONB, -- { "field": { "old": x, "new": y } }

    -- Context
    source              VARCHAR(50), -- 'user', 'sp_api_sync', 'automation', 'api'
    source_id           VARCHAR(100), -- Rule ID, job ID, etc.

    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Partition by month for performance
CREATE INDEX idx_audit_entity ON system.audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_created ON system.audit_log(created_at DESC);
```

### 8.3 Background Jobs

```sql
CREATE TABLE system.jobs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    job_type            VARCHAR(50) NOT NULL,
    -- 'sync_listings', 'sync_orders', 'calculate_scores', 'fetch_keepa', etc.

    -- Status
    status              VARCHAR(20) DEFAULT 'pending',
    -- 'pending', 'running', 'completed', 'failed', 'cancelled'

    -- Timing
    scheduled_for       TIMESTAMPTZ,
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,

    -- Input/Output
    input_data          JSONB,
    result_data         JSONB,
    error_message       TEXT,

    -- Retry
    attempt_count       INTEGER DEFAULT 0,
    max_attempts        INTEGER DEFAULT 3,

    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_jobs_status ON system.jobs(status, scheduled_for);
CREATE INDEX idx_jobs_type ON system.jobs(job_type, status);
```

---

## 9. Indexes and Performance

### 9.1 Composite Indexes

```sql
-- Common query patterns
CREATE INDEX idx_listings_category_score ON catalog.listings(custom_category, current_score DESC);
CREATE INDEX idx_listings_status_updated ON catalog.listings(status, updated_at DESC);
CREATE INDEX idx_keywords_listing_primary ON catalog.keywords(listing_id, is_primary);
CREATE INDEX idx_prices_listing_updated ON pricing.current_prices(listing_id, updated_at DESC);
```

### 9.2 Partial Indexes

```sql
-- Only index active listings
CREATE INDEX idx_active_listings ON catalog.listings(asin) WHERE status = 'active';

-- Only index high-priority tasks
CREATE INDEX idx_urgent_tasks ON workflow.tasks(due_date) WHERE stage_id != (SELECT id FROM workflow.kanban_stages WHERE is_terminal = TRUE);
```

---

## Next Document: Service Architecture →
