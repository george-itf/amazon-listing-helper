# Canonical ASIN Data Model

This document describes the canonical ASIN data model, the foundation for data-driven recommendations, analytics, and charts.

## Overview

The canonical ASIN data model provides:
- **Single source of truth**: One authoritative place to ask "What do we currently know about this ASIN?"
- **Data maximalism**: Preserves all raw data from Keepa and SP-API for future analysis
- **Deterministic fingerprints**: For deduplication, suppression, and change detection
- **Append-only history**: Full audit trail of what we knew at any point in time

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   Keepa API     │     │  Amazon SP-API  │
└────────┬────────┘     └────────┬────────┘
         │                       │
         ▼                       ▼
┌──────────────────────────────────────────┐
│           ASIN Ingestion Worker          │
│  (Scheduled every 30 minutes)            │
└────────────────────┬─────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────┐
│           raw_payloads table             │
│  (Immutable landing zone)                │
└────────────────────┬─────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────┐
│          Transform Worker                │
│  - Flatten fields                        │
│  - Calculate derived metrics             │
│  - Run DQ checks                         │
│  - Generate fingerprint                  │
└─────────┬────────────────────┬───────────┘
          │                    │
          ▼                    ▼
┌─────────────────┐  ┌─────────────────┐
│  asin_snapshot  │  │   dq_issues     │
│ (Append-only)   │  │ (Data quality)  │
└────────┬────────┘  └─────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│           asin_current                  │
│  (Materialized current view)            │
│  ← UI, Charts, Recommendations read     │
└─────────────────────────────────────────┘
```

## Tables

### 1. raw_payloads

Immutable landing zone for exact raw API responses.

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| asin | VARCHAR(20) | ASIN |
| marketplace_id | INTEGER | FK to marketplaces |
| source | VARCHAR(20) | 'keepa' or 'sp_api' |
| ingestion_job_id | UUID | Links to ingestion run |
| payload | JSONB | Entire raw response |
| captured_at | TIMESTAMP | When data was fetched |

**Design principle**: Never modify rows. This table is write-only.

### 2. asin_snapshot

Append-only history of flattened ASIN data.

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| asin | VARCHAR(20) | ASIN |
| marketplace_id | INTEGER | FK to marketplaces |
| ingestion_job_id | UUID | Links to ingestion run |
| title | TEXT | Product title |
| brand | VARCHAR(255) | Brand name |
| category_path | TEXT | Full category path |
| price_inc_vat | NUMERIC(12,2) | Our price including VAT |
| buy_box_price | NUMERIC(12,2) | Buy box price |
| buy_box_seller_id | VARCHAR(50) | Who owns buy box |
| seller_count | INTEGER | Number of sellers |
| total_stock | INTEGER | Our inventory |
| keepa_* | VARIOUS | All Keepa metrics |
| amazon_raw | JSONB | Full SP-API payload |
| keepa_raw | JSONB | Full Keepa payload |
| fingerprint_hash | VARCHAR(64) | SHA-256 hash |
| snapshot_time | TIMESTAMP | When snapshot was created |

**Design principle**: Never update rows. Only insert new snapshots.

### 3. asin_current

Materialized current state - exactly one row per ASIN.

Same columns as asin_snapshot, plus:
- `latest_snapshot_id` - FK to most recent snapshot
- `first_seen_at` - When ASIN was first tracked
- `updated_at` - Last modification time

**Design principle**: Upsert semantics only.

### 4. dq_issues

Data quality issue tracking.

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| asin | VARCHAR(20) | ASIN |
| issue_type | VARCHAR(50) | Type (MISSING_FIELD, INVALID_VALUE, etc.) |
| field_name | VARCHAR(100) | Which field |
| severity | ENUM | WARN or CRITICAL |
| status | ENUM | OPEN, ACKNOWLEDGED, RESOLVED, IGNORED |
| message | TEXT | Human-readable description |
| details | JSONB | Additional context |

## Flattened Fields

All snapshots contain these flattened fields:

### Identity & Catalogue
- `asin` - Amazon Standard Identification Number
- `title` - Product title
- `brand` - Brand name
- `category_path` - Full category hierarchy

### Pricing & Buy Box
- `price_inc_vat` - Our price including VAT (GBP)
- `price_ex_vat` - Price excluding VAT
- `list_price` - Regular/RRP price
- `buy_box_price` - Current buy box price
- `buy_box_seller_id` - Who owns the buy box
- `buy_box_is_fba` - Is buy box FBA?
- `seller_count` - Number of competing sellers

### Inventory & Sales
- `total_stock` - Our current inventory
- `fulfillment_channel` - FBA or FBM
- `units_7d` - Units sold last 7 days
- `units_30d` - Units sold last 30 days
- `units_90d` - Units sold last 90 days
- `days_of_cover` - Inventory / daily sales

### Keepa Metrics (90-day windows)
- `keepa_has_data` - Boolean
- `keepa_last_update` - When Keepa data was updated
- `keepa_price_p25_90d` - 25th percentile price (pence)
- `keepa_price_median_90d` - Median price (pence)
- `keepa_price_p75_90d` - 75th percentile price (pence)
- `keepa_lowest_90d` - Lowest price (pence)
- `keepa_highest_90d` - Highest price (pence)
- `keepa_sales_rank_latest` - Current sales rank
- `keepa_new_offers` - Number of new offers
- `keepa_used_offers` - Number of used offers

### Derived Flags
- `is_buy_box_lost` - Have we lost the buy box?
- `is_out_of_stock` - Are we out of stock?
- `price_volatility_score` - Coefficient of variation

## Fingerprint Specification

Fingerprints enable deterministic change detection.

### Canonical Input (exact order)
1. `asin` - String
2. `marketplace` - String ('UK')
3. `price_inc_vat` - Integer pence (or null)
4. `total_stock` - Integer (or null)
5. `buy_box_seller_id` - String (or null)
6. `keepa_price_p25_90d` - Integer pence (or null)
7. `seller_count` - Integer (or null)

### Algorithm
1. Build canonical JSON object with keys in exact order
2. Include `null` explicitly for missing values
3. Serialize with sorted keys (deterministic JSON)
4. Hash using SHA-256
5. Store as 64-character hex digest

### Usage
```javascript
import { generateFingerprint } from '../lib/fingerprint.js';

const hash = generateFingerprint({
  asin: 'B001234567',
  marketplace_id: 1,
  price_inc_vat: 24.99,
  total_stock: 100,
  buy_box_seller_id: 'SELLER123',
  keepa_price_p25_90d: 2000,
  seller_count: 5,
});
// Returns: '8a3b4c5d6e7f...' (64 chars)
```

## Ingestion Cadence

- **Frequency**: Every 30 minutes
- **Keepa rate limit**: 20 tokens/minute (token bucket)
- **Batch size**: Up to 10 ASINs per Keepa request

### Rate Limiting

The token bucket rate limiter ensures we don't exceed Keepa's limits:

```javascript
import { getKeepaRateLimiter } from '../lib/token-bucket.js';

const limiter = getKeepaRateLimiter();
const acquired = await limiter.acquireForAsins(10); // Request 10 tokens
if (acquired) {
  // Make API call
}
```

## Data Quality Checks

DQ checks run during transformation and flag:

| Issue Type | Severity | Description |
|------------|----------|-------------|
| MISSING_FIELD | WARN | Required field is null |
| INVALID_VALUE | CRITICAL | Impossible value (negative stock) |
| STALE_DATA | WARN | Keepa data > 72 hours old |
| OUT_OF_RANGE | WARN | Value outside expected bounds |

## How to Use

### Query Current State

```javascript
import { getCurrentState } from '../services/asin-data.service.js';

const asin = await getCurrentState('B001234567', 1); // UK marketplace
console.log(asin.price_inc_vat);
console.log(asin.is_buy_box_lost);
```

### Query Historical Snapshots

```javascript
import { getSnapshotHistory } from '../services/asin-data.service.js';

const history = await getSnapshotHistory('B001234567', 1, 30); // Last 30 snapshots
```

### Check for Data Issues

```javascript
import * as dqRepo from '../repositories/dq-issue.repository.js';

const issues = await dqRepo.getCriticalOpen(50);
```

## Running Locally

### Start Ingestion Worker

The ingestion worker starts automatically with the main server. To run standalone:

```bash
node -e "import('./src/workers/asin-ingestion-worker.js').then(w => w.startWorker())"
```

### Manual Ingestion Run

```bash
node -e "import('./src/workers/asin-ingestion-worker.js').then(w => w.runOnce())"
```

### Inspect Data

```sql
-- Current state for all ASINs
SELECT asin, title, price_inc_vat, is_buy_box_lost, is_out_of_stock
FROM asin_current
ORDER BY updated_at DESC;

-- Snapshot history for an ASIN
SELECT id, snapshot_time, price_inc_vat, total_stock, fingerprint_hash
FROM asin_snapshot
WHERE asin = 'B001234567'
ORDER BY snapshot_time DESC
LIMIT 10;

-- Open DQ issues
SELECT asin, issue_type, severity, message
FROM dq_issues
WHERE status = 'OPEN'
ORDER BY severity DESC, detected_at DESC;

-- Raw payloads for debugging
SELECT asin, source, captured_at, payload->>'products' IS NOT NULL as has_data
FROM raw_payloads
WHERE asin = 'B001234567'
ORDER BY captured_at DESC;
```

## Migration

Apply the migration to create the new tables:

```bash
npm run db:migrate
```

Or manually apply:

```sql
\i migrations/012_canonical_asin_model.sql
```

## Testing

Run the unit and integration tests:

```bash
npm test -- --testPathPattern="fingerprint|asin-data|asin-integration"
```
