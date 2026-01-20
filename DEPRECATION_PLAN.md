# DEPRECATION PLAN

**Date:** 2026-01-20
**Purpose:** Step-by-step plan to deprecate legacy systems and transition to SPEC.md architecture

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

## 2. Slice A Deprecation Gates

### Gate A1: Database Schema Migration Complete

**Prerequisites:**
- [ ] `suppliers` table created and populated
- [ ] `components` table created and populated
- [ ] `boms` table created with versioning
- [ ] `bom_lines` table created
- [ ] `listing_cost_overrides` table created
- [ ] Data migrated from `suppliers.json`, `components.json`, `bom.json`, `costs.json`

**Verification Queries:**
```sql
-- Verify suppliers migrated
SELECT COUNT(*) FROM suppliers;

-- Verify components migrated
SELECT COUNT(*) FROM components;

-- Verify BOMs migrated with version 1
SELECT COUNT(*) FROM boms WHERE version = 1;

-- Verify line items
SELECT COUNT(*) FROM bom_lines;
```

**When Gate Passes:**
- New `/api/v2/components/*` and `/api/v2/listings/{id}/bom` endpoints are live
- Old file-based BOM functions can be marked `@deprecated`

### Gate A2: Economics Service Live

**Prerequisites:**
- [ ] `economics.service.js` created with all calculations
- [ ] VAT semantics implemented (`price_inc_vat`, `cost_exc_vat`)
- [ ] All margin/profit calculations flow through economics service
- [ ] `GET /api/v2/listings/{id}/economics` returns correct data
- [ ] UI updated to display new economics panel

**Verification Tests:**
```javascript
// Test: Economics returns correct structure
const result = await fetch('/api/v2/listings/123/economics');
assert(result.revenue.gross !== undefined);
assert(result.revenue.net !== undefined);
assert(result.cogs.landed_total !== undefined);
assert(result.profit.contribution_margin !== undefined);
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

## 3. Slice B Deprecation Gates

### Gate B1: Job System Operational

**Prerequisites:**
- [ ] `jobs` table created
- [ ] `job_events` table created
- [ ] Job worker process running
- [ ] Jobs can be created, polled, and completed
- [ ] `GET /api/v2/jobs/{id}` returns job status

**Verification Tests:**
```javascript
// Test: Can create and poll job
const createRes = await fetch('/api/v2/listings/123/price/publish', {
  method: 'POST',
  body: JSON.stringify({ new_price: 9.99 })
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
assert(status === 'SUCCESS' || status === 'FAILED');
```

### Gate B2: Publish Endpoints Live

**Prerequisites:**
- [ ] `/api/v2/listings/{id}/price/preview` returns diff preview
- [ ] `/api/v2/listings/{id}/price/publish` creates job
- [ ] `/api/v2/listings/{id}/stock/preview` returns diff preview
- [ ] `/api/v2/listings/{id}/stock/publish` creates job
- [ ] Guardrails settings table populated
- [ ] UI modals for edit price/stock working

**Verification Tests:**
```javascript
// Test: Preview returns guardrail violations if any
const preview = await fetch('/api/v2/listings/123/price/preview', {
  method: 'POST',
  body: JSON.stringify({ new_price: 1.00 }) // Below floor
});
const result = await preview.json();
assert(result.guardrail_violations.length > 0);
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

## 4. Slice C Deprecation Gates

### Gate C1: Ingestion Jobs Operational

**Prerequisites:**
- [ ] `keepa_snapshots` table created with `raw_json`, `parsed_json`, `features`
- [ ] `amazon_snapshots` table created similarly
- [ ] `keepa_ingestion_job` type registered
- [ ] `amazon_ingestion_job` type registered
- [ ] Jobs fetch from APIs and store snapshots
- [ ] Feature extraction runs after snapshot saved

**Verification Tests:**
```javascript
// Test: Keepa ingestion job creates snapshot
const job = await createKeepaIngestionJob(['B001234567']);
await waitForJobComplete(job.job_id);

const snapshot = await db.query(
  'SELECT * FROM keepa_snapshots WHERE asin = $1 ORDER BY fetched_at DESC LIMIT 1',
  ['B001234567']
);
assert(snapshot.rows.length > 0);
assert(snapshot.rows[0].raw_json !== null);
assert(snapshot.rows[0].features !== null);
```

### Gate C2: Feature Store Live

**Prerequisites:**
- [ ] `listing_features` table created
- [ ] Feature computation jobs working
- [ ] Features extracted from Keepa snapshots
- [ ] Features extracted from Amazon snapshots
- [ ] UI displays features (buybox_gap, competitor_count, etc.)

**Verification Tests:**
```javascript
// Test: Features computed for listing
const features = await db.query(
  'SELECT * FROM listing_features WHERE listing_id = $1',
  [listingId]
);
assert(features.rows.length > 0);
assert(features.rows[0].feature_json.buybox_gap !== undefined);
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

## 5. Slice D Deprecation Gates

### Gate D1: Recommendations System Live

**Prerequisites:**
- [ ] `recommendations` table created
- [ ] Recommendation generation job working
- [ ] Evidence, guardrails, impact computed per SPEC
- [ ] `/api/v2/recommendations` returns typed recommendations
- [ ] Accept/Reject/Snooze endpoints working
- [ ] UI displays recommendation cards with evidence

**Verification Tests:**
```javascript
// Test: Recommendations have required structure
const recs = await fetch('/api/v2/recommendations?status=PENDING');
const data = await recs.json();
for (const rec of data.items) {
  assert(rec.type !== undefined); // REPRICE, RESTOCK, IMPROVE, etc.
  assert(rec.evidence !== undefined);
  assert(rec.guardrails !== undefined);
  assert(rec.expected_impact !== undefined);
}
```

**When Gate Passes:**
- `ai-recommendations.js` can be removed
- Old unstructured recommendation endpoints deprecated

**Files to Deprecate After Gate D1:**
| File/Function | Action |
|---------------|--------|
| `ai-recommendations.js` | Remove entirely |
| `generateRecommendations()` | Remove |
| `/api/v1/ai/recommendations/*` | Remove |

---

## 6. Slice E Deprecation Gates

### Gate E1: ASIN Analyzer & Research Pool Live

**Prerequisites:**
- [ ] `research_pool` table created
- [ ] `POST /api/v2/asins/analyze` creates research pool entry
- [ ] `GET /api/v2/asins/{id}` returns ASIN analysis
- [ ] `POST /api/v2/asins/{id}/convert` converts to listing
- [ ] Research pool filters/views working

**Verification Tests:**
```javascript
// Test: ASIN analysis workflow
const analyze = await fetch('/api/v2/asins/analyze', {
  method: 'POST',
  body: JSON.stringify({ asin: 'B001234567' })
});
const pool = await analyze.json();
assert(pool.research_pool_id !== undefined);

// Wait for analysis job
await waitForJobComplete(pool.job_id);

// Get results
const result = await fetch(`/api/v2/asins/${pool.research_pool_id}`);
const data = await result.json();
assert(data.market_data !== undefined);
assert(data.recommended_price !== undefined);
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

## 7. Final Cleanup Phase

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
└── credentials.json   # KEEP (still needed)
```

### Phase F3: Remove Legacy Modules

**Files to Delete:**
```
main/app/src/
├── amazon-push.js           # DELETE (replaced by job system)
├── keepa-sync.js            # DELETE (replaced by ingestion jobs)
├── tasks.js                 # DELETE (using repository now)
├── ai-recommendations.js    # DELETE (replaced by typed recs)
└── listing-generator.js     # DELETE or refactor
```

### Phase F4: Code Cleanup

**Actions:**
1. Remove dead code paths in `server.js`
2. Remove unused imports
3. Remove deprecated helper functions
4. Update tests to only test v2 endpoints
5. Run linter to catch remaining issues

---

## 8. Rollback Procedures

### Rollback Strategy Per Slice

Each slice has independent rollback capability:

| Slice | Rollback Method |
|-------|-----------------|
| A | Restore JSON files from backup, revert schema |
| B | Re-enable `pending-changes.json`, restore amazon-push.js |
| C | Restore `keepa.json`, re-enable inline sync |
| D | Restore ai-recommendations.js |
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

## 9. Feature Flags

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
    return redirect('/api/v2/listings/' + req.params.sku + '/economics');
  }
  // Legacy behavior
  ...
});
```

---

## 10. Deprecation Checklist

### Pre-Migration Checklist
- [ ] Full database backup completed
- [ ] All JSON files backed up
- [ ] Source code committed to git
- [ ] Rollback scripts tested in staging
- [ ] Feature flags configured

### Slice A Checklist
- [ ] Gate A1 passed (DB schema)
- [ ] Gate A2 passed (Economics service)
- [ ] Old files backed up and removed
- [ ] Tests passing

### Slice B Checklist
- [ ] Gate B1 passed (Job system)
- [ ] Gate B2 passed (Publish endpoints)
- [ ] `amazon-push.js` removed
- [ ] `pending-changes.json` removed
- [ ] Tests passing

### Slice C Checklist
- [ ] Gate C1 passed (Ingestion jobs)
- [ ] Gate C2 passed (Feature store)
- [ ] `keepa-sync.js` removed
- [ ] `keepa.json` removed
- [ ] Tests passing

### Slice D Checklist
- [ ] Gate D1 passed (Recommendations)
- [ ] `ai-recommendations.js` removed
- [ ] Tests passing

### Slice E Checklist
- [ ] Gate E1 passed (ASIN Analyzer)
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

## 11. Migration Scripts

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
        INSERT INTO components (id, sku, name, description, category, supplier_id, unit_cost, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO NOTHING
      `, [c.id, c.sku, c.name, c.description, c.category, c.supplierId, c.unitCost, c.createdAt]);
    }

    // Migrate BOMs
    for (const [sku, bom] of Object.entries(boms.bom || {})) {
      // Get listing ID
      const listing = await client.query('SELECT id FROM listings WHERE sku = $1', [sku]);
      if (listing.rows.length === 0) continue;

      const listingId = listing.rows[0].id;

      const bomResult = await client.query(`
        INSERT INTO boms (listing_id, version, labor_cost, packaging_cost, overhead_percent, created_at)
        VALUES ($1, 1, $2, $3, $4, NOW())
        RETURNING id
      `, [listingId, bom.laborCost || 0, bom.packagingCost || 0, bom.overheadPercent || 0]);

      const bomId = bomResult.rows[0].id;

      // Migrate BOM lines
      for (const line of bom.components || []) {
        await client.query(`
          INSERT INTO bom_lines (bom_id, component_id, quantity)
          VALUES ($1, $2, $3)
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
  const newBoms = await query('SELECT COUNT(*) FROM boms');

  console.log('=== Migration Verification ===');
  console.log(`Suppliers: ${oldSuppliers.suppliers?.length || 0} -> ${newSuppliers.rows[0].count}`);
  console.log(`Components: ${oldComponents.components?.length || 0} -> ${newComponents.rows[0].count}`);
  console.log(`BOMs: ${Object.keys(oldBoms.bom || {}).length} -> ${newBoms.rows[0].count}`);

  // Detailed spot checks
  // ...
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
