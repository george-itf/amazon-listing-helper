# DATA CONTRACTS

**Version:** 1.0
**Date:** 2026-01-20
**Purpose:** Canonical data contracts for the Amazon Ops Platform. These are frozen specifications; version if changed.

---

## 1. Canonical Keys

### 1.1 Listing

**Primary Key:** `listing.id` (auto-increment integer)

**Business Key:** `(seller_sku, marketplace_id)` — UNIQUE constraint

**Foreign Keys:**
- `marketplace_id` → `marketplaces.id`
- `asin` (nullable) — links to potential `asin_entities` for research

### 1.2 ASIN Entity

**Primary Key:** `asin_entities.id` (auto-increment integer, referred to as `asin_entity_id`)

**Business Key:** `(asin, marketplace_id)` — UNIQUE constraint

**Usage:**
- All `/api/v2/asins/{id}` endpoints use `asin_entity_id`, NOT raw ASIN string
- Research pool table references `asin_entity_id`
- `asin_entities` is the canonical table; research pool does NOT replace it

### 1.3 Component

**Primary Key:** `components.id` (auto-increment integer)

**Business Key:** `component_sku` — UNIQUE constraint

### 1.4 BOM

**Primary Key:** `boms.id` (auto-increment integer)

**Business Key:** `(listing_id, version)` for LISTING scope; `(asin_entity_id, version)` for ASIN_SCENARIO scope

### 1.5 Marketplace

**Primary Key:** `marketplaces.id` (auto-increment integer)

**Business Key:** `amazon_marketplace_id` — UNIQUE constraint (e.g., `A1F83G8C2ARO7P` for UK)

---

## 2. VAT & Currency Rules

### 2.1 Operating Context

- **Primary Marketplace:** UK (Amazon Marketplace ID: `A1F83G8C2ARO7P`)
- **Primary Currency:** GBP
- **Default VAT Rate:** 20% (0.20)
- **VAT rates are stored per marketplace** in `marketplaces.vat_rate`

### 2.2 VAT Semantics (Non-Negotiable)

| Field Type | VAT Treatment | Label in UI |
|------------|---------------|-------------|
| **Displayed listing price** | VAT-inclusive | "Price (inc VAT)" |
| **BOM component costs** | VAT-exclusive | "Unit Cost (ex VAT)" |
| **Shipping costs** | VAT-exclusive | "Shipping (ex VAT)" |
| **Packaging costs** | VAT-exclusive | "Packaging (ex VAT)" |
| **Amazon fees** | VAT-exclusive | "Fees (ex VAT)" |
| **Profit** | VAT-exclusive | "Profit (ex VAT)" |
| **Margin %** | VAT-exclusive | "Margin %" |
| **Revenue in dashboards** | VAT-inclusive (labeled) | "Revenue (inc VAT)" |

### 2.3 VAT Conversion Formula

```
price_ex_vat = price_inc_vat / (1 + vat_rate)
```

Example:
- `price_inc_vat = 24.00`, `vat_rate = 0.20`
- `price_ex_vat = 24.00 / 1.20 = 20.00`

---

## 3. Money Type & Rounding Policy (LOCKED)

### 3.1 Storage Format

**Decision: All money stored as `numeric(12,2)`**

- Columns: `price_inc_vat`, `unit_cost_ex_vat`, `fee_total_ex_vat`, etc.
- Precision: 12 digits total, 2 decimal places
- No integer pence storage; decimal format for readability

### 3.2 Rounding Policy

1. **Internal calculations:** Full precision (no intermediate rounding)
2. **Storage:** Round to 2 decimal places using HALF_UP (banker's rounding)
3. **Display:** Round to 2 decimal places at final presentation step
4. **API responses:** Return 2 decimal places as strings or numbers (e.g., `"19.99"` or `19.99`)

### 3.3 Rounding Function (PostgreSQL)

```sql
ROUND(value, 2)  -- Uses banker's rounding (HALF_EVEN)
```

### 3.4 Rounding Function (JavaScript)

```javascript
function roundMoney(value) {
  return Math.round(value * 100) / 100;
}
```

---

## 4. Economics DTO Contract (Version 1.0)

### 4.1 Request

```typescript
interface EconomicsRequest {
  listing_id: number;
  // Optional scenario overrides
  scenario?: {
    price_inc_vat?: number;      // Override current price
    bom_cost_multiplier?: number; // e.g., 1.10 for +10%
  };
}
```

### 4.2 Response (Frozen Fields)

```typescript
interface EconomicsResponse {
  listing_id: number;
  marketplace_id: number;
  vat_rate: number;                    // e.g., 0.20

  // Price fields (SPEC §2)
  price_inc_vat: number;               // e.g., 24.00
  price_ex_vat: number;                // e.g., 20.00

  // Cost fields (all VAT-exclusive)
  bom_cost_ex_vat: number;             // e.g., 6.00
  shipping_cost_ex_vat: number;        // e.g., 2.00
  packaging_cost_ex_vat: number;       // e.g., 0.50
  amazon_fees_ex_vat: number;          // e.g., 3.00
  total_cost_ex_vat: number;           // sum of above

  // Derived fields (SPEC §2.2)
  net_revenue_ex_vat: number;          // = price_ex_vat
  profit_ex_vat: number;               // = net_revenue_ex_vat - total_cost_ex_vat
  margin: number;                      // = profit_ex_vat / net_revenue_ex_vat (0.0-1.0)
  break_even_price_inc_vat: number;    // price where profit_ex_vat = 0

  // Metadata
  computed_at: string;                 // ISO 8601 timestamp
  bom_version: number | null;          // Active BOM version used
  fee_snapshot_id: number | null;      // Fee snapshot used
}
```

**DO NOT USE:** `gross`, `net`, `revenue.gross`, `revenue.net`, `cogs.landed_total`, `profit.contribution_margin` — these are ambiguous. Use SPEC field names only.

### 4.3 Acceptance Test

```
Given:
  price_inc_vat = 24.00
  vat_rate = 0.20
  bom_cost_ex_vat = 6.00
  shipping_cost_ex_vat = 2.00
  packaging_cost_ex_vat = 0.50
  amazon_fees_ex_vat = 3.00

Then:
  price_ex_vat = 20.00
  total_cost_ex_vat = 11.50
  net_revenue_ex_vat = 20.00
  profit_ex_vat = 8.50
  margin = 0.425
```

---

## 5. Publish Payload Contracts (Version 1.0)

### 5.1 Price Publish Request

```typescript
interface PricePublishRequest {
  price_inc_vat: number;               // Required: new price (VAT inclusive)
  reason: string;                      // Required: why this change
  correlation_id?: string;             // Optional: client-provided ID for tracking
}
```

**Example:**
```json
{
  "price_inc_vat": 19.99,
  "reason": "Regain Buy Box; competitor undercut by £0.32",
  "correlation_id": "ui-modal-abc123"
}
```

**DO NOT USE:** `new_price` — use `price_inc_vat` only.

### 5.2 Stock Publish Request

```typescript
interface StockPublishRequest {
  available_quantity: number;          // Required: new stock quantity
  reason: string;                      // Required: why this change
}
```

**Example:**
```json
{
  "available_quantity": 120,
  "reason": "Prevent stockout; velocity 8.4/day; lead time 14d"
}
```

### 5.3 Publish Response

```typescript
interface PublishResponse {
  job_id: number;                      // Job ID for tracking
  status: 'PENDING';                   // Initial status
  listing_id: number;
  listing_event_id: number;            // Event created for audit trail
}
```

---

## 6. Buy Box Nullability Contract

### 6.1 Field Definitions

| Field | Type | Nullable | Default | Notes |
|-------|------|----------|---------|-------|
| `buy_box_status` | ENUM | NO | `'UNKNOWN'` | Values: `WON`, `LOST`, `UNKNOWN` |
| `buy_box_percentage_30d` | NUMERIC(5,2) | YES | `NULL` | 0.00-100.00 or NULL |
| `buy_box_price` | NUMERIC(12,2) | YES | `NULL` | Current Buy Box winner price |

### 6.2 Derivation Rules

```
IF is_buy_box_winner == true THEN buy_box_status = 'WON'
ELSE IF is_buy_box_winner == false THEN buy_box_status = 'LOST'
ELSE buy_box_status = 'UNKNOWN'
```

### 6.3 Feature Store Representation

```json
{
  "buy_box_status": "LOST",           // Always present: WON/LOST/UNKNOWN
  "buy_box_percentage_30d": null,     // May be null
  "buy_box_risk": "HIGH"              // May be "UNKNOWN" if status unknown
}
```

### 6.4 Recommendation Behavior

- `PRICE_DECREASE_REGAIN_BUYBOX`: Only generate if `buy_box_status = 'LOST'`
- If `buy_box_status = 'UNKNOWN'`: Do not generate Buy Box recommendations
- `evidence_json.notes` must include data availability disclaimer when `buy_box_percentage_30d` is null

---

## 7. BOM Invariants (ENFORCED)

### 7.1 Versioning Rules

1. **BOMs are versioned:** Each BOM has a `version` integer starting at 1
2. **Versions are immutable:** Once created, a BOM version's lines cannot be modified
3. **New version on change:** To update a BOM, create a new version
4. **Version increment:** `new_version = MAX(version) + 1` for that listing

### 7.2 Active BOM Constraint

1. **Exactly one active BOM per listing:** Enforced by partial unique index
2. **Constraint SQL:**
   ```sql
   CREATE UNIQUE INDEX boms_listing_active_unique
   ON boms (listing_id)
   WHERE is_active = true AND scope_type = 'LISTING';
   ```
3. **Activation is atomic:** Deactivate old + activate new in single transaction

### 7.3 Line Update Rules

1. **Atomic line replacement:** `PUT /api/v2/boms/{id}/lines` replaces ALL lines
2. **No partial updates:** Cannot add/remove individual lines
3. **Validation:** All `component_id` references must exist
4. **Quantity constraints:** `quantity > 0`, `wastage_rate >= 0 AND wastage_rate < 1`

### 7.4 BOM Scope Types

| Scope | Foreign Key | Use Case |
|-------|-------------|----------|
| `LISTING` | `listing_id` (required) | Production BOM for managed listings |
| `ASIN_SCENARIO` | `asin_entity_id` (required) | Scenario BOM for ASIN research |

---

## 8. Snapshot Storage Contract (SPEC §4.10, §4.11)

### 8.1 Keepa Snapshots

Table: `keepa_snapshots`

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL | PK |
| `asin` | VARCHAR(20) | ASIN |
| `marketplace_id` | INTEGER | FK to marketplaces |
| `raw_json` | JSONB | Unmodified Keepa API response |
| `parsed_json` | JSONB | Extracted metrics (price bands, volatility, etc.) |
| `captured_at` | TIMESTAMP | When data was fetched |
| `created_at` | TIMESTAMP | Row creation time |

**No `features` column on snapshots.** Features go to `feature_store`.

### 8.2 Amazon Catalog Snapshots

Table: `amazon_catalog_snapshots`

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL | PK |
| `asin` | VARCHAR(20) | ASIN |
| `marketplace_id` | INTEGER | FK to marketplaces |
| `raw_json` | JSONB | Unmodified SP-API response |
| `parsed_json` | JSONB | Extracted attributes (title, category, images) |
| `captured_at` | TIMESTAMP | When data was fetched |
| `created_at` | TIMESTAMP | Row creation time |

### 8.3 Listing Offer Current (NOT a snapshot table)

Table: `listing_offer_current` — Current state, not historical

| Column | Type | Notes |
|--------|------|-------|
| `listing_id` | INTEGER | PK, FK to listings |
| `price_inc_vat` | NUMERIC(12,2) | Current price |
| `available_quantity` | INTEGER | Current stock |
| `buy_box_status` | ENUM | WON/LOST/UNKNOWN |
| `buy_box_percentage_30d` | NUMERIC(5,2) | Nullable |
| `observed_at` | TIMESTAMP | When last observed |

### 8.4 Listing Sales Daily

Table: `listing_sales_daily` — Time series, one row per day

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL | PK |
| `listing_id` | INTEGER | FK to listings |
| `date` | DATE | The calendar date |
| `units` | INTEGER | Units sold |
| `revenue_inc_vat` | NUMERIC(12,2) | Revenue (VAT inclusive) |
| `sessions` | INTEGER | Nullable |
| `conversion_rate` | NUMERIC(5,4) | Nullable |

**UNIQUE:** `(listing_id, date)`

---

## 9. Feature Store Contract (SPEC §4.13)

### 9.1 Table Structure

Table: `feature_store`

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL | PK |
| `entity_type` | ENUM | `LISTING` or `ASIN` |
| `entity_id` | INTEGER | listing_id or asin_entity_id |
| `feature_version` | INTEGER | Schema version (starts at 1) |
| `features_json` | JSONB | Computed features |
| `computed_at` | TIMESTAMP | When computed |
| `created_at` | TIMESTAMP | Row creation |

**Index:** `(entity_type, entity_id, computed_at DESC)`

### 9.2 Feature Version Policy

- `feature_version = 1`: Initial schema
- Increment only when **schema/meaning changes**
- Old versions remain queryable for audit
- Current features = latest row by `computed_at`

### 9.3 Required Listing Features (features_json)

```typescript
interface ListingFeatures {
  // Economics
  vat_rate: number;
  price_inc_vat: number;
  price_ex_vat: number;
  bom_cost_ex_vat: number;
  shipping_cost_ex_vat: number;
  packaging_cost_ex_vat: number;
  amazon_fees_ex_vat: number;
  profit_ex_vat: number;
  margin: number;
  break_even_price_inc_vat: number;

  // Sales/Performance
  units_7d: number;
  units_30d: number;
  revenue_inc_vat_7d: number;
  revenue_inc_vat_30d: number;
  sessions_30d: number | null;
  conversion_rate_30d: number | null;
  sales_velocity_units_per_day_30d: number;

  // Inventory
  available_quantity: number;
  days_of_cover: number | null;      // null if velocity = 0
  lead_time_days: number | null;
  stockout_risk: 'LOW' | 'MEDIUM' | 'HIGH';

  // Buy Box
  buy_box_status: 'WON' | 'LOST' | 'UNKNOWN';
  buy_box_percentage_30d: number | null;
  buy_box_risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  competitor_price_position: 'BELOW_BAND' | 'IN_BAND' | 'ABOVE_BAND' | null;

  // Keepa Signals
  keepa_price_median_90d: number | null;
  keepa_price_p25_90d: number | null;
  keepa_price_p75_90d: number | null;
  keepa_volatility_90d: number | null;
  keepa_offers_count_current: number | null;
  keepa_offers_trend_30d: number | null;
  keepa_rank_trend_90d: number | null;

  // Anomaly Signals
  sales_anomaly_score: number;
  conversion_anomaly_score: number | null;
  buy_box_anomaly_score: number | null;
}
```

---

## 10. Jobs Table Contract (SPEC §4.17)

### 10.1 Table Structure

Table: `jobs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL | PK |
| `job_type` | ENUM | See §10.2 |
| `scope_type` | ENUM | `LISTING`, `ASIN`, `GLOBAL` |
| `listing_id` | INTEGER | FK, nullable |
| `asin_entity_id` | INTEGER | FK, nullable |
| `status` | ENUM | `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED` |
| `priority` | INTEGER | Default 5 |
| `attempts` | INTEGER | Default 0 |
| `max_attempts` | INTEGER | Default 5 |
| `scheduled_for` | TIMESTAMP | When to run |
| `started_at` | TIMESTAMP | Nullable |
| `finished_at` | TIMESTAMP | Nullable |
| `log_json` | JSONB | Execution logs and errors |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |

### 10.2 Job Types (SPEC §6.1)

```
SYNC_AMAZON_OFFER
SYNC_AMAZON_SALES
SYNC_AMAZON_CATALOG
SYNC_KEEPA_ASIN
COMPUTE_FEATURES_LISTING
COMPUTE_FEATURES_ASIN
GENERATE_RECOMMENDATIONS_LISTING
GENERATE_RECOMMENDATIONS_ASIN
PUBLISH_PRICE_CHANGE
PUBLISH_STOCK_CHANGE
```

### 10.3 Event Logging

- **No separate `job_events` table** unless SPEC explicitly extends
- Use `jobs.log_json` for execution logs
- Use `listing_events` for listing-related audit trail
- Use `recommendation_events` for recommendation lifecycle

---

## 11. Guardrails Enforcement Contract

### 11.1 Guardrail Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `min_margin` | NUMERIC(5,4) | 0.15 | Minimum acceptable margin |
| `max_price_change_pct_per_day` | NUMERIC(5,4) | 0.05 | Max 5% price change per day |
| `min_days_of_cover_before_price_change` | INTEGER | 7 | Don't cut price if low stock |
| `min_stock_threshold` | INTEGER | 5 | Minimum stock before alerts |
| `default_vat_rate` | NUMERIC(5,4) | 0.20 | Per marketplace |

### 11.2 Server-Side Enforcement (MANDATORY)

```
┌─────────────────────────────────────────────────────────────────┐
│                    GUARDRAIL ENFORCEMENT FLOW                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  UI Preview → Backend computes guardrails → Returns violations  │
│                                                                 │
│  UI Publish → Backend RE-COMPUTES guardrails → Creates job      │
│               (never trusts UI's previous computation)          │
│                                                                 │
│  Publish without Preview → Backend computes same checks         │
│                            deterministically                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 11.3 Guardrails Response Format

```typescript
interface GuardrailsResult {
  passed: boolean;
  violations: GuardrailViolation[];
}

interface GuardrailViolation {
  rule: string;                  // e.g., "min_margin"
  threshold: number;             // e.g., 0.15
  actual: number;                // e.g., 0.12
  message: string;               // Human-readable explanation
}
```

### 11.4 Behavior on Violation

- **Preview endpoint:** Returns violations; UI may show warning
- **Publish endpoint:** If violations exist, returns 400 with violations; no job created
- **No override mechanism in v1:** User must adjust input to pass guardrails

---

## 12. Summary: Frozen Contract Fields

The following field names are **frozen** and must be used exactly as specified:

**Economics:**
- `price_inc_vat`, `price_ex_vat`, `net_revenue_ex_vat`
- `bom_cost_ex_vat`, `shipping_cost_ex_vat`, `packaging_cost_ex_vat`, `amazon_fees_ex_vat`
- `total_cost_ex_vat`, `profit_ex_vat`, `margin`, `break_even_price_inc_vat`

**Publish Payloads:**
- Price: `{ price_inc_vat, reason, correlation_id? }`
- Stock: `{ available_quantity, reason }`

**Buy Box:**
- `buy_box_status` (WON/LOST/UNKNOWN)
- `buy_box_percentage_30d` (nullable)
- `buy_box_risk` (LOW/MEDIUM/HIGH/UNKNOWN)

**IDs:**
- Use `asin_entity_id` for ASIN endpoints, not raw ASIN string in paths
- Use `listing_id` for listing endpoints

**Do Not Use (Ambiguous):**
- `gross`, `net`, `new_price`, `landed_cost` (use specific SPEC fields instead)
