# DEPRECATION PLAN

**Date:** 2026-01-20
**Updated:** 2026-01-20 (Phase 6 - v1 API freeze and deprecation headers enabled)
**Purpose:** Step-by-step plan to deprecate legacy systems and transition to SPEC.md architecture

---

## 0. V1 API Deprecation Notice

> **⚠️ NOTICE:** All `/api/v1/*` endpoints are now FROZEN and DEPRECATED.
>
> **Sunset Date:** July 21, 2026 (6 months from freeze date)
>
> All v1 responses include the following headers:
> - `Deprecation: true`
> - `Sunset: Tue, 21 Jul 2026 00:00:00 GMT`
> - `Link: </api/v2>; rel="successor-version"`
> - `X-API-Warning: This endpoint is deprecated. Please migrate to /api/v2`
>
> **No new features will be added to v1 endpoints.**
>
> Clients should migrate to `/api/v2/*` endpoints per the mapping in §2 below.

---

## 1. Deprecation Sequence Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DEPRECATION TIMELINE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  SLICE A    ──►  Gate A1 (DB)  ──►  Gate A2 (Economics)                    │
│     │                                    │                                  │
│     ▼                                    ▼                                  │
│  [Migrate BOM/Components]      [Deprecate costs.json, bom.js file paths]   │
│                                                                             │
│  SLICE B    ──►  Gate B1 (Jobs)  ──►  Gate B2 (Publish)                    │
│     │                                    │                                  │
│     ▼                                    ▼                                  │
│  [Job system live]             [Deprecate pending-changes.json]            │
│                                [Deprecate amazon-push.js]                   │
│                                                                             │
│  SLICE C    ──►  Gate C1 (Ingestion)  ──►  Gate C2 (Features)              │
│     │                                    │                                  │
│     ▼                                    ▼                                  │
│  [Job-based Keepa/Amazon]      [Deprecate inline sync handlers]            │
│                                [Deprecate keepa.json, keepa-sync.js]       │
│                                                                             │
│  SLICE D    ──►  Gate D1 (Recommendations)                                 │
│     │                                                                       │
│     ▼                                                                       │
│  [Structured recs live]        [Deprecate ai-recommendations.js]           │
│                                [Deprecate scoring.js, score.repository.js] │
│                                                                             │
│  SLICE E    ──►  Gate E1 (ASIN Analyzer)                                   │
│     │                                                                       │
│     ▼                                                                       │
│  [Research pool live]          [Deprecate listing-generator.js]            │
│                                                                             │
│  FINAL      ──►  Remove /api/v1  ──►  Remove JSON files                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core /api/v1 Route-by-Route Mapping

### 2.1 Listings Endpoints

| v1 Endpoint | v2 Replacement | Slice | Gate | Notes |
|-------------|----------------|-------|------|-------|
| `GET /api/v1/listings` | `GET /api/v2/listings` | A | A1 | Add pagination, filtering |
| `GET /api/v1/listings/:id` | `GET /api/v2/listings/{id}` | A | A1 | Include economics, features |
| `POST /api/v1/listings` | `POST /api/v2/listings` | A | A1 | |
| `PUT /api/v1/listings/:id` | `PUT /api/v2/listings/{id}` | A | A1 | |

### 2.2 Profit/Costs Endpoints

| v1 Endpoint | v2 Replacement | Slice | Gate | Notes |
|-------------|----------------|-------|------|-------|
| `GET /api/v1/profit/:sku` | `GET /api/v2/listings/{id}/economics` | A | A2 | Full economics DTO |
| `GET /api/v1/costs/:sku` | `GET /api/v2/listings/{id}/economics` | A | A2 | Merged into economics |
| `POST /api/v1/costs/:sku` | `PUT /api/v2/listings/{id}/cost-overrides` | A | A2 | Shipping/packaging costs |
| `GET /api/v1/bom/:sku/margin` | `GET /api/v2/listings/{id}/economics` | A | A2 | Merged into economics |

### 2.3 BOM/Components/Suppliers Endpoints

| v1 Endpoint | v2 Replacement | Slice | Gate | Notes |
|-------------|----------------|-------|------|-------|
| `GET /api/v1/suppliers` | `GET /api/v2/suppliers` | A | A1 | |
| `POST /api/v1/suppliers` | `POST /api/v2/suppliers` | A | A1 | |
| `PUT /api/v1/suppliers/:id` | `PUT /api/v2/suppliers/{id}` | A | A1 | |
| `DELETE /api/v1/suppliers/:id` | `DELETE /api/v2/suppliers/{id}` | A | A1 | |
| `GET /api/v1/components` | `GET /api/v2/components` | A | A1 | |
| `POST /api/v1/components` | `POST /api/v2/components` | A | A1 | |
| `PUT /api/v1/components/:id` | `PUT /api/v2/components/{id}` | A | A1 | |
| `DELETE /api/v1/components/:id` | `DELETE /api/v2/components/{id}` | A | A1 | |
| `POST /api/v1/components/import` | `POST /api/v2/components/import` | A | A1 | CSV import |
| `GET /api/v1/bom/:sku` | `GET /api/v2/listings/{id}/bom` | A | A1 | Returns active BOM |
| `POST /api/v1/bom/:sku` | `POST /api/v2/listings/{id}/bom` | A | A1 | Creates new version |
| `PUT /api/v1/bom/:sku/components` | `PUT /api/v2/boms/{bom_id}/lines` | A | A1 | Atomic line update |

### 2.4 Keepa Endpoints

| v1 Endpoint | v2 Replacement | Slice | Gate | Notes |
|-------------|----------------|-------|------|-------|
| `GET /api/v1/keepa/:asin` | Job-based: `POST /api/v2/asins/analyze` | C | C1 | Returns job_id |
| `POST /api/v1/keepa/sync` | Job-based: `POST /api/v2/jobs` (type=SYNC_KEEPA_ASIN) | C | C1 | Batch sync via jobs |
| `GET /api/v1/keepa/data/:asin` | `GET /api/v2/asins/{asin_entity_id}` | C | C2 | Via feature store |

### 2.5 Sync Endpoints

| v1 Endpoint | v2 Replacement | Slice | Gate | Notes |
|-------------|----------------|-------|------|-------|
| `POST /api/v1/sync` | Job-based: `POST /api/v2/listings/{id}/enrich` | C | C1 | Creates sync jobs |

### 2.6 Changes/Push Endpoints

| v1 Endpoint | v2 Replacement | Slice | Gate | Notes |
|-------------|----------------|-------|------|-------|
| `GET /api/v1/changes` | `GET /api/v2/jobs?type=PUBLISH_*` | B | B1 | Job status |
| `POST /api/v1/changes/price` | `POST /api/v2/listings/{id}/price/publish` | B | B2 | With guardrails |
| `POST /api/v1/changes/stock` | `POST /api/v2/listings/{id}/stock/publish` | B | B2 | With guardrails |
| `POST /api/v1/changes/submit` | Worker handles automatically | B | B2 | No manual submit |
| `DELETE /api/v1/changes/:id` | `POST /api/v2/jobs/{id}/cancel` | B | B1 | |

### 2.7 AI Recommendations Endpoints

| v1 Endpoint | v2 Replacement | Slice | Gate | Notes |
|-------------|----------------|-------|------|-------|
| `GET /api/v1/ai/recommendations` | `GET /api/v2/recommendations` | D | D1 | Structured recs |
| `POST /api/v1/ai/recommendations/:id/apply` | `POST /api/v2/recommendations/{id}/accept` | D | D1 | Accept flow |

### 2.8 Generator Endpoints

| v1 Endpoint | v2 Replacement | Slice | Gate | Notes |
|-------------|----------------|-------|------|-------|
| `POST /api/v1/generator/analyze` | `POST /api/v2/asins/analyze` | E | E1 | |
| `GET /api/v1/generator/results/:id` | `GET /api/v2/asins/{asin_entity_id}` | E | E1 | |
| `POST /api/v1/generator/create-listing` | `POST /api/v2/asins/{asin_entity_id}/convert` | E | E1 | |

### 2.9 Settings Endpoints

| v1 Endpoint | v2 Replacement | Slice | Gate | Notes |
|-------------|----------------|-------|------|-------|
| `GET /api/v1/settings` | `GET /api/v2/settings` | B | B1 | Includes guardrails |
| `POST /api/v1/settings` | `PUT /api/v2/settings` | B | B1 | |

---

## 3. Slice A Deprecation Gates

### Gate A1: Database Schema Migration Complete

**Prerequisites:**
- [ ] `marketplaces` table created with `vat_rate`
- [ ] `suppliers` table created and populated
- [ ] `components` table created and populated
- [ ] `boms` table created with versioning (see BOM Invariants §12)
- [ ] `bom_lines` table created
- [ ] `listing_cost_overrides` table created
- [ ] Data migrated from `suppliers.json`, `components.json`, `bom.json`, `costs.json`
- [ ] `CredentialsProvider` module created; no direct credentials.json reads elsewhere

**Verification Queries:**
```sql
-- Verify suppliers migrated
SELECT COUNT(*) FROM suppliers;

-- Verify components migrated
SELECT COUNT(*) FROM components;

-- Verify BOMs migrated with version 1 and is_active=true
SELECT COUNT(*) FROM boms WHERE version = 1 AND is_active = true;

-- Verify exactly one active BOM per listing
SELECT listing_id, COUNT(*)
FROM boms
WHERE is_active = true AND scope_type = 'LISTING'
GROUP BY listing_id
HAVING COUNT(*) > 1;  -- Should return 0 rows

-- Verify line items
SELECT COUNT(*) FROM bom_lines;
```

**When Gate Passes:**
- New `/api/v2/components/*` and `/api/v2/listings/{id}/bom` endpoints are live
- Old file-based BOM functions can be marked `@deprecated`

### Gate A2: Economics Service Live

**Prerequisites:**
- [ ] `economics.service.js` created with all calculations
- [ ] VAT semantics implemented per DATA_CONTRACTS.md §2-4
- [ ] All margin/profit calculations flow through economics service
- [ ] `GET /api/v2/listings/{id}/economics` returns correct data
- [ ] UI updated to display new economics panel

**Verification Tests:**
```javascript
// Test: Economics returns correct SPEC fields (DATA_CONTRACTS.md §4)
const result = await fetch('/api/v2/listings/123/economics');
const data = await result.json();

// Required SPEC fields - no gross/net/landed_total
assert(data.price_inc_vat !== undefined);
assert(data.price_ex_vat !== undefined);
assert(data.bom_cost_ex_vat !== undefined);
assert(data.shipping_cost_ex_vat !== undefined);
assert(data.packaging_cost_ex_vat !== undefined);
assert(data.amazon_fees_ex_vat !== undefined);
assert(data.net_revenue_ex_vat !== undefined);
assert(data.profit_ex_vat !== undefined);
assert(data.margin !== undefined);
assert(data.break_even_price_inc_vat !== undefined);

// Acceptance test (SPEC §16.1)
// price_inc_vat=24.00, vat_rate=0.20 -> price_ex_vat=20.00
// bom=6.00, ship=2.00, pack=0.50, fees=3.00
// profit_ex_vat=8.50, margin=0.425
```

**When Gate Passes:**
- Mark old `/api/v1/profit/*`, `/api/v1/costs/*` endpoints as `@deprecated`
- Old profit calculation functions can be removed
- `costs.json` can be deleted after backup

**Files to Deprecate After Gate A2:**
| File/Function | Action |
|---------------|--------|
| `loadCosts()` in server.js | Remove |
| `saveCosts()` in server.js | Remove |
| `calculateAmazonFees()` inline | Remove (use economics service) |
| `/api/v1/profit/:sku` | Remove |
| `/api/v1/costs/:sku` | Remove |
| `costs.json` | Delete (after backup) |
| `suppliers.json` | Delete (after backup) |
| `components.json` | Delete (after backup) |
| `bom.json` | Delete (after backup) |

---

## 4. Slice B Deprecation Gates

### Gate B1: Job System Operational

**Prerequisites:**
- [ ] `jobs` table created (SPEC §4.17)
- [ ] **No `job_events` table** - use `jobs.log_json` + `listing_events` + `recommendation_events`
- [ ] Job worker process running
- [ ] Jobs can be created, polled, and completed
- [ ] `GET /api/v2/jobs/{id}` returns job status

**Verification Tests:**
```javascript
// Test: Can create and poll job
// Note: Use SPEC payload { price_inc_vat, reason } not { new_price }
const createRes = await fetch('/api/v2/listings/123/price/publish', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    price_inc_vat: 9.99,
    reason: 'Test price change'
  })
});
const job = await createRes.json();
assert(job.job_id !== undefined);
assert(job.status === 'PENDING');

// Poll until complete
let status;
do {
  await sleep(1000);
  const pollRes = await fetch(`/api/v2/jobs/${job.job_id}`);
  status = (await pollRes.json()).status;
} while (status === 'PENDING' || status === 'RUNNING');
assert(status === 'SUCCEEDED' || status === 'FAILED');
```

### Gate B2: Publish Endpoints Live

**Prerequisites:**
- [ ] `/api/v2/listings/{id}/price/preview` returns economics preview + guardrails
- [ ] `/api/v2/listings/{id}/price/publish` creates job (payload: `{ price_inc_vat, reason, correlation_id? }`)
- [ ] `/api/v2/listings/{id}/stock/preview` returns preview + guardrails
- [ ] `/api/v2/listings/{id}/stock/publish` creates job (payload: `{ available_quantity, reason }`)
- [ ] Guardrails settings table populated
- [ ] **Server-side guardrails enforcement** (see §13)
- [ ] UI modals for edit price/stock working

**Verification Tests:**
```javascript
// Test: Preview returns guardrail violations if any
const preview = await fetch('/api/v2/listings/123/price/preview', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ price_inc_vat: 1.00 }) // Below floor
});
const result = await preview.json();
assert(result.guardrails.passed === false);
assert(result.guardrails.violations.length > 0);
assert(result.guardrails.violations[0].rule !== undefined);
assert(result.guardrails.violations[0].threshold !== undefined);
assert(result.guardrails.violations[0].actual !== undefined);

// Test: Publish re-checks guardrails server-side
const publish = await fetch('/api/v2/listings/123/price/publish', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    price_inc_vat: 1.00,  // Still below floor
    reason: 'Test'
  })
});
assert(publish.status === 400); // Rejected by server-side guardrails
```

**When Gate Passes:**
- Mark all `/api/v1/changes/*` endpoints as `@deprecated`
- `amazon-push.js` can be deprecated
- `pending-changes.json` can be deleted

**Files to Deprecate After Gate B2:**
| File/Function | Action |
|---------------|--------|
| `amazon-push.js` | Remove entirely |
| `queuePriceChange()` | Remove |
| `submitPriceChanges()` | Remove |
| `pending-changes.json` | Delete |
| `/api/v1/changes/*` routes | Remove |
| UI "Push to Amazon" page | Replace with new modals |

---

## 5. Slice C Deprecation Gates

### Gate C1: Ingestion Jobs Operational

**Prerequisites:**
- [ ] `keepa_snapshots` table created with `raw_json`, `parsed_json`, `captured_at` (**NO features column**)
- [ ] `amazon_catalog_snapshots` table created (SPEC §4.11)
- [ ] `listing_offer_current` table created (SPEC §4.3) - current state, not snapshot
- [ ] `listing_sales_daily` table created (SPEC §4.4) - time series
- [ ] `SYNC_KEEPA_ASIN` job type registered
- [ ] `SYNC_AMAZON_OFFER`, `SYNC_AMAZON_SALES`, `SYNC_AMAZON_CATALOG` job types registered
- [ ] Jobs fetch from APIs and store snapshots
- [ ] Feature computation triggered after snapshots saved

**Note:** Do NOT create a generic `amazon_snapshots` table. Use SPEC tables:
- `listing_offer_current` for current price/stock/buy box
- `listing_sales_daily` for sales time series
- `amazon_catalog_snapshots` for catalog attributes

**Verification Tests:**
```javascript
// Test: Keepa ingestion job creates snapshot
const job = await createJob({ type: 'SYNC_KEEPA_ASIN', asin: 'B001234567' });
await waitForJobComplete(job.job_id);

const snapshot = await db.query(
  'SELECT * FROM keepa_snapshots WHERE asin = $1 ORDER BY captured_at DESC LIMIT 1',
  ['B001234567']
);
assert(snapshot.rows.length > 0);
assert(snapshot.rows[0].raw_json !== null);
assert(snapshot.rows[0].parsed_json !== null);
// NO features column on snapshots - features go to feature_store
```

### Gate C2: Feature Store Live

**Prerequisites:**
- [ ] `feature_store` table created (SPEC §4.13)
- [ ] Columns: `entity_type`, `entity_id`, `feature_version`, `features_json`, `computed_at`
- [ ] `COMPUTE_FEATURES_LISTING` job type working
- [ ] `COMPUTE_FEATURES_ASIN` job type working
- [ ] Features extracted from Keepa snapshots → feature_store
- [ ] Features extracted from Amazon data → feature_store
- [ ] UI displays features from feature_store

**Verification Tests:**
```javascript
// Test: Features computed for listing and stored in feature_store
const features = await db.query(
  `SELECT * FROM feature_store
   WHERE entity_type = 'LISTING' AND entity_id = $1
   ORDER BY computed_at DESC LIMIT 1`,
  [listingId]
);
assert(features.rows.length > 0);
assert(features.rows[0].feature_version === 1);
assert(features.rows[0].features_json.buy_box_status !== undefined);
assert(features.rows[0].features_json.margin !== undefined);
```

**When Gate Passes:**
- Mark all inline Keepa sync handlers as `@deprecated`
- `keepa-sync.js` can be removed
- `keepa.json` can be deleted

**Files to Deprecate After Gate C2:**
| File/Function | Action |
|---------------|--------|
| `keepa-sync.js` | Remove entirely |
| Inline Keepa fetch in routes | Remove |
| `keepa.json` | Delete |
| `/api/v1/keepa/sync` | Remove |
| Inline Amazon sync in `/api/v1/sync` | Remove |
| Direct Keepa API calls in handlers | Remove |

---

## 6. Slice D Deprecation Gates

### Gate D1: Recommendations System Live

**Prerequisites:**
- [ ] `recommendations` table created (SPEC §4.14)
- [ ] `recommendation_events` table created (SPEC §4.15)
- [ ] `GENERATE_RECOMMENDATIONS_LISTING` job working
- [ ] `GENERATE_RECOMMENDATIONS_ASIN` job working
- [ ] Evidence, guardrails, impact computed per SPEC §9
- [ ] `/api/v2/recommendations` returns typed recommendations
- [ ] Accept/Reject/Snooze endpoints working
- [ ] UI displays recommendation cards with evidence

**Verification Tests:**
```javascript
// Test: Recommendations have required structure (SPEC §9)
const recs = await fetch('/api/v2/recommendations?status=OPEN');
const data = await recs.json();
for (const rec of data.items) {
  // Type must be enumerated (SPEC §9.1)
  assert(['PRICE_DECREASE_REGAIN_BUYBOX', 'STOCK_INCREASE_STOCKOUT_RISK',
          'MARGIN_AT_RISK_COMPONENT_COST', 'ANOMALY_SALES_DROP',
          'OPPORTUNITY_CREATE_LISTING'].includes(rec.type));

  // Required fields per SPEC §9.2-9.4
  assert(rec.action_payload_json !== undefined);
  assert(rec.evidence_json !== undefined);
  assert(rec.guardrails_json !== undefined);
  assert(rec.impact_json !== undefined);
  assert(rec.severity !== undefined);
  assert(rec.status !== undefined);
}
```

**When Gate Passes:**
- `ai-recommendations.js` can be removed
- `scoring.js` can be removed (legacy scoring)
- `score.repository.js` can be removed (legacy)
- Old unstructured recommendation endpoints deprecated

**Files to Deprecate After Gate D1:**
| File/Function | Action |
|---------------|--------|
| `ai-recommendations.js` | Remove entirely |
| `scoring.js` | Remove entirely (legacy) |
| `score.repository.js` | Remove entirely (legacy) |
| `scores` table | Mark deprecated, do not delete yet |
| `/api/v1/ai/recommendations/*` | Remove |
| `/api/v1/scores/*` | Remove |
| `/api/v1/score` | Remove |

---

## 7. Slice E Deprecation Gates

### Gate E1: ASIN Analyzer & Research Pool Live

**Prerequisites:**
- [ ] `asin_entities` table is canonical (SPEC §4.12)
- [ ] Research pool table (if needed) references `asin_entity_id`, does NOT replace `asin_entities`
- [ ] `POST /api/v2/asins/analyze` creates `asin_entities` row + triggers sync jobs
- [ ] `GET /api/v2/asins/{asin_entity_id}` returns ASIN analysis (uses `asin_entity_id`, NOT raw ASIN)
- [ ] `POST /api/v2/asins/{asin_entity_id}/bom` creates scenario BOM
- [ ] `POST /api/v2/asins/{asin_entity_id}/convert` converts to listing
- [ ] Research pool filters/views working

**Verification Tests:**
```javascript
// Test: ASIN analysis workflow
// Step 1: Analyze creates asin_entity
const analyze = await fetch('/api/v2/asins/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ asin: 'B001234567', marketplace_id: 1 })
});
const result = await analyze.json();
assert(result.asin_entity_id !== undefined);  // Returns asin_entity_id
assert(result.job_id !== undefined);

// Wait for analysis job
await waitForJobComplete(result.job_id);

// Step 2: Get results using asin_entity_id (not raw ASIN)
const asinData = await fetch(`/api/v2/asins/${result.asin_entity_id}`);
const data = await asinData.json();
assert(data.asin === 'B001234567');
assert(data.features !== undefined);
assert(data.recommendations !== undefined);

// Step 3: Convert to listing
const convert = await fetch(`/api/v2/asins/${result.asin_entity_id}/convert`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ seller_sku: 'NEW-SKU-001' })
});
const listing = await convert.json();
assert(listing.listing_id !== undefined);
```

**When Gate Passes:**
- `listing-generator.js` can be removed
- Old generator endpoints deprecated

**Files to Deprecate After Gate E1:**
| File/Function | Action |
|---------------|--------|
| `listing-generator.js` | Remove or refactor |
| `/api/v1/generator/*` | Remove |

---

## 8. Final Cleanup Phase

### Phase F1: Remove All `/api/v1` Routes

**Prerequisites:**
- [ ] All Slices A-E complete
- [ ] All gates passed
- [ ] Frontend fully migrated to `/api/v2`
- [ ] No external integrations using `/api/v1`
- [ ] At least 1 week of `/api/v2`-only operation in staging

**Actions:**
1. Remove all `/api/v1` route registrations from `server.js`
2. Remove any helper functions only used by v1 routes
3. Update any documentation referencing v1 endpoints

### Phase F2: Remove Legacy JSON Files

**Prerequisites:**
- [ ] All data migrated to PostgreSQL
- [ ] Backups of all JSON files stored safely
- [ ] No code references to JSON files

**Files to Delete:**
```
main/data/
├── listings.json      # DELETE
├── scores.json        # DELETE
├── alerts.json        # DELETE
├── tasks.json         # DELETE
├── keepa.json         # DELETE
├── pending-changes.json  # DELETE
├── templates.json     # DELETE (if migrated)
├── suppliers.json     # DELETE
├── components.json    # DELETE
├── bom.json           # DELETE
├── costs.json         # DELETE
├── shipping.json      # DELETE (if migrated)
└── credentials.json   # KEEP (accessed via CredentialsProvider only)
```

### Phase F3: Remove Legacy Modules

**Files to Delete:**
```
main/app/src/
├── amazon-push.js           # DELETE (replaced by job system)
├── keepa-sync.js            # DELETE (replaced by ingestion jobs)
├── tasks.js                 # DELETE (using repository now)
├── ai-recommendations.js    # DELETE (replaced by typed recs)
├── scoring.js               # DELETE (replaced by feature_store)
├── listing-generator.js     # DELETE or refactor
└── repositories/
    └── score.repository.js  # DELETE (legacy)
```

### Phase F4: Code Cleanup

**Actions:**
1. Remove dead code paths in `server.js`
2. Remove unused imports
3. Remove deprecated helper functions
4. Update tests to only test v2 endpoints
5. Run linter to catch remaining issues

---

## 9. Rollback Procedures

### Rollback Strategy Per Slice

Each slice has independent rollback capability:

| Slice | Rollback Method |
|-------|-----------------|
| A | Restore JSON files from backup, revert schema |
| B | Re-enable `pending-changes.json`, restore amazon-push.js |
| C | Restore `keepa.json`, re-enable inline sync |
| D | Restore ai-recommendations.js, scoring.js |
| E | Restore listing-generator.js |

### Emergency Rollback Script

```bash
#!/bin/bash
# emergency-rollback.sh
# Run this if critical issues discovered post-migration

SLICE=$1
BACKUP_DIR="/opt/alh/backups/$(date +%Y%m%d)"

case $SLICE in
  "A")
    echo "Rolling back Slice A..."
    cp $BACKUP_DIR/costs.json /opt/alh/data/
    cp $BACKUP_DIR/suppliers.json /opt/alh/data/
    cp $BACKUP_DIR/components.json /opt/alh/data/
    cp $BACKUP_DIR/bom.json /opt/alh/data/
    # Revert DB schema if needed
    psql -f migrations/rollback_slice_a.sql
    ;;
  "B")
    echo "Rolling back Slice B..."
    cp $BACKUP_DIR/pending-changes.json /opt/alh/data/
    git checkout HEAD~1 -- src/amazon-push.js
    ;;
  # ... similar for other slices
esac

echo "Rollback complete. Restart server."
```

---

## 10. Feature Flags

Use environment variables to control gradual rollout:

```javascript
// Feature flags for migration
const FEATURES = {
  USE_V2_ECONOMICS: process.env.FEATURE_V2_ECONOMICS === 'true',
  USE_V2_JOBS: process.env.FEATURE_V2_JOBS === 'true',
  USE_V2_KEEPA: process.env.FEATURE_V2_KEEPA === 'true',
  USE_V2_RECS: process.env.FEATURE_V2_RECS === 'true',
  USE_V2_ASIN: process.env.FEATURE_V2_ASIN === 'true',
  DISABLE_V1_ROUTES: process.env.DISABLE_V1 === 'true'
};

// Example usage in route handler
fastify.get('/api/v1/profit/:sku', async (req, reply) => {
  if (FEATURES.USE_V2_ECONOMICS) {
    // Redirect to v2 or use v2 service
    return reply.redirect('/api/v2/listings/' + req.params.sku + '/economics');
  }
  // Legacy behavior
  ...
});
```

---

## 11. Deprecation Checklist

### Pre-Migration Checklist
- [ ] Full database backup completed
- [ ] All JSON files backed up
- [ ] Source code committed to git
- [ ] Rollback scripts tested in staging
- [ ] Feature flags configured

### Slice A Checklist
- [ ] Gate A1 passed (DB schema)
- [ ] Gate A2 passed (Economics service)
- [ ] BOM invariants verified (§12)
- [ ] Old files backed up and removed
- [ ] Tests passing

### Slice B Checklist
- [ ] Gate B1 passed (Job system)
- [ ] Gate B2 passed (Publish endpoints)
- [ ] Guardrails enforcement verified (§13)
- [ ] `amazon-push.js` removed
- [ ] `pending-changes.json` removed
- [ ] Tests passing

### Slice C Checklist
- [ ] Gate C1 passed (Ingestion jobs)
- [ ] Gate C2 passed (Feature store)
- [ ] Snapshots use correct SPEC tables (no generic amazon_snapshots)
- [ ] `keepa-sync.js` removed
- [ ] `keepa.json` removed
- [ ] Tests passing

### Slice D Checklist
- [ ] Gate D1 passed (Recommendations)
- [ ] `ai-recommendations.js` removed
- [ ] `scoring.js` removed (legacy)
- [ ] `score.repository.js` removed (legacy)
- [ ] Tests passing

### Slice E Checklist
- [ ] Gate E1 passed (ASIN Analyzer)
- [ ] `asin_entities` is canonical; research pool references it
- [ ] Old generator code removed/refactored
- [ ] Tests passing

### Final Cleanup Checklist
- [ ] All `/api/v1` routes removed
- [ ] All legacy JSON files deleted
- [ ] All legacy modules removed
- [ ] No deprecated code remaining
- [ ] Documentation updated
- [ ] Production monitoring verified

---

## 12. BOM Invariants (Referenced in Gate A1)

These invariants MUST be enforced by the implementation:

### 12.1 Versioned BOMs
- Each BOM has a `version` integer starting at 1
- Versions are **immutable** once created
- To update a BOM, create a new version: `new_version = MAX(version) + 1`

### 12.2 One Active BOM Per Listing
- Exactly one BOM with `is_active = true` per listing
- Enforced by partial unique index:
  ```sql
  CREATE UNIQUE INDEX boms_listing_active_unique
  ON boms (listing_id)
  WHERE is_active = true AND scope_type = 'LISTING';
  ```
- Activation is atomic: deactivate old + activate new in single transaction

### 12.3 Atomic Line Updates
- `PUT /api/v2/boms/{bom_id}/lines` replaces ALL lines atomically
- No partial add/remove of individual lines
- Validation:
  - All `component_id` references must exist in `components` table
  - `quantity > 0`
  - `wastage_rate >= 0 AND wastage_rate < 1`

### 12.4 Migration Requirement
- Migrated BOMs from `bom.json` start at `version = 1` with `is_active = true`
- Each migrated BOM must have its lines migrated to `bom_lines`

---

## 13. Guardrails Enforcement (Referenced in Gate B2)

These enforcement rules MUST be implemented:

### 13.1 Server-Side Re-Computation
```
┌─────────────────────────────────────────────────────────────────┐
│                    GUARDRAIL ENFORCEMENT FLOW                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  UI Preview → Backend computes guardrails → Returns violations  │
│                                                                 │
│  UI Publish → Backend RE-COMPUTES guardrails → Creates job      │
│               (NEVER trust UI's previous computation)           │
│                                                                 │
│  Publish without Preview → Backend computes same checks         │
│                            deterministically                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 13.2 Publish Must Re-Check
- Publish endpoint MUST call guardrails service before creating job
- If any guardrails fail, return HTTP 400 with violations array
- No job is created if guardrails fail

### 13.3 No Override in v1
- There is NO override mechanism for guardrails in v1
- User must adjust their input to pass guardrails
- Override capability may be added in v2 with explicit audit trail

### 13.4 Deterministic Checks
- Guardrails computation must be deterministic
- Same inputs → same guardrails result
- Publish without prior preview is allowed; backend computes everything needed

---

## 14. Migration Scripts

### Script: Migrate BOM Data (Slice A)

```javascript
// scripts/migrate_bom_data.js
import fs from 'fs';
import { query, transaction } from '../src/database/connection.js';

async function migrateBOM() {
  const suppliers = JSON.parse(fs.readFileSync('/opt/alh/data/suppliers.json'));
  const components = JSON.parse(fs.readFileSync('/opt/alh/data/components.json'));
  const boms = JSON.parse(fs.readFileSync('/opt/alh/data/bom.json'));

  await transaction(async (client) => {
    // Migrate suppliers
    for (const s of suppliers.suppliers || []) {
      await client.query(`
        INSERT INTO suppliers (id, name, contact_name, email, phone, website, currency, lead_time_days, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO NOTHING
      `, [s.id, s.name, s.contactName, s.email, s.phone, s.website, s.currency, s.leadTimeDays, s.createdAt]);
    }

    // Migrate components
    for (const c of components.components || []) {
      await client.query(`
        INSERT INTO components (id, component_sku, name, description, category, supplier_id, unit_cost_ex_vat, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (component_sku) DO NOTHING
      `, [c.id, c.sku, c.name, c.description, c.category, c.supplierId, c.unitCost, c.createdAt]);
    }

    // Migrate BOMs with versioning invariants
    for (const [sku, bom] of Object.entries(boms.bom || {})) {
      // Get listing ID
      const listing = await client.query('SELECT id FROM listings WHERE seller_sku = $1', [sku]);
      if (listing.rows.length === 0) continue;

      const listingId = listing.rows[0].id;

      // Create BOM version 1, is_active=true
      const bomResult = await client.query(`
        INSERT INTO boms (listing_id, scope_type, version, is_active, effective_from, created_at)
        VALUES ($1, 'LISTING', 1, true, NOW(), NOW())
        RETURNING id
      `, [listingId]);

      const bomId = bomResult.rows[0].id;

      // Migrate BOM lines
      for (const line of bom.components || []) {
        await client.query(`
          INSERT INTO bom_lines (bom_id, component_id, quantity, wastage_rate, created_at)
          VALUES ($1, $2, $3, 0, NOW())
        `, [bomId, line.componentId, line.quantity]);
      }
    }
  });

  console.log('BOM data migration complete');
}

migrateBOM().catch(console.error);
```

### Script: Verify Migration (Slice A)

```javascript
// scripts/verify_bom_migration.js
import fs from 'fs';
import { query } from '../src/database/connection.js';

async function verify() {
  const oldSuppliers = JSON.parse(fs.readFileSync('/opt/alh/data/suppliers.json'));
  const oldComponents = JSON.parse(fs.readFileSync('/opt/alh/data/components.json'));
  const oldBoms = JSON.parse(fs.readFileSync('/opt/alh/data/bom.json'));

  const newSuppliers = await query('SELECT COUNT(*) FROM suppliers');
  const newComponents = await query('SELECT COUNT(*) FROM components');
  const newBoms = await query('SELECT COUNT(*) FROM boms WHERE is_active = true');

  console.log('=== Migration Verification ===');
  console.log(`Suppliers: ${oldSuppliers.suppliers?.length || 0} -> ${newSuppliers.rows[0].count}`);
  console.log(`Components: ${oldComponents.components?.length || 0} -> ${newComponents.rows[0].count}`);
  console.log(`Active BOMs: ${Object.keys(oldBoms.bom || {}).length} -> ${newBoms.rows[0].count}`);

  // Verify BOM invariants
  const duplicateActiveBoms = await query(`
    SELECT listing_id, COUNT(*) as cnt
    FROM boms
    WHERE is_active = true AND scope_type = 'LISTING'
    GROUP BY listing_id
    HAVING COUNT(*) > 1
  `);

  if (duplicateActiveBoms.rows.length > 0) {
    console.error('ERROR: Found listings with multiple active BOMs!');
    console.error(duplicateActiveBoms.rows);
    process.exit(1);
  }

  console.log('BOM invariants: OK (one active BOM per listing)');
}

verify().catch(console.error);
```

---

## Summary

This deprecation plan ensures:
1. **Gradual migration** - No big-bang cutover
2. **Verifiable gates** - Each step has clear success criteria
3. **Rollback capability** - Every change can be undone
4. **Feature flags** - Control migration at runtime
5. **Data safety** - Backups before every change
6. **Minimal downtime** - Old and new systems coexist during transition
7. **SPEC compliance** - All contracts match SPEC.md exactly
8. **BOM invariants enforced** - Versioning and one-active rules
9. **Guardrails enforced server-side** - Never trust UI
