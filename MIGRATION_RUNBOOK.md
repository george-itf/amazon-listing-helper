# MIGRATION_RUNBOOK.md — Phase 3 Schema Verification

## 1. Migration Execution Order

```
┌─────────────────────────────────────────────────────────────────┐
│                    MIGRATION SEQUENCE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  001_slice_a_schema.sql                                         │
│    └─► Prerequisites: listings, settings tables exist           │
│    └─► Creates: marketplaces, suppliers, components, boms,      │
│                 bom_lines, listing_cost_overrides               │
│    └─► Modifies: listings (add marketplace_id, price_inc_vat)   │
│                                                                 │
│  002_slice_b_schema.sql                                         │
│    └─► Prerequisites: 001 complete                              │
│    └─► Creates: jobs, listing_events, listing_offer_current,    │
│                 fee_snapshots                                   │
│    └─► Modifies: listings (add status, fulfillment_channel)     │
│    └─► Depends on: listings                                     │
│                                                                 │
│  003_slice_c_schema.sql                                         │
│    └─► Prerequisites: 001, 002 complete                         │
│    └─► Creates: asin_entities, keepa_snapshots,                 │
│                 amazon_catalog_snapshots, listing_sales_daily,  │
│                 feature_store                                   │
│    └─► Modifies: boms (add FK to asin_entities), listings (asin)│
│    └─► Depends on: marketplaces, listings, boms                 │
│                                                                 │
│  004_slice_d_schema.sql                                         │
│    └─► Prerequisites: 001, 002, 003 complete                    │
│    └─► Creates: recommendations, recommendation_events          │
│    └─► Depends on: jobs, feature_entity_type enum               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Pre-Migration Checklist

```bash
# Verify base schema exists
psql -c "SELECT 1 FROM listings LIMIT 1"
psql -c "SELECT 1 FROM settings LIMIT 1"

# Backup existing data
pg_dump amazon_listing_helper > backup_$(date +%Y%m%d_%H%M%S).sql
```

---

## 3. Migration Commands

```bash
cd main/app/migrations

# Run in order
psql -d amazon_listing_helper -f 001_slice_a_schema.sql
psql -d amazon_listing_helper -f 002_slice_b_schema.sql
psql -d amazon_listing_helper -f 003_slice_c_schema.sql
psql -d amazon_listing_helper -f 004_slice_d_schema.sql

# Or run all in sequence
for f in 00*.sql; do psql -d amazon_listing_helper -f "$f"; done
```

---

## 4. BOM Versioning Constraints Verification

### 4.1 One-Active-BOM Invariant (DEPRECATION_PLAN §12)

**Constraint:** `boms_listing_active_unique` partial unique index

```sql
-- Verify index exists
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'boms' AND indexname = 'boms_listing_active_unique';

-- Expected:
-- CREATE UNIQUE INDEX boms_listing_active_unique ON boms (listing_id)
-- WHERE is_active = true AND scope_type = 'LISTING'
```

**Test: Attempt to create two active BOMs for same listing**

```sql
-- This should SUCCEED (first active BOM)
INSERT INTO boms (listing_id, scope_type, version, is_active)
VALUES (1, 'LISTING', 1, true);

-- This should FAIL with unique violation
INSERT INTO boms (listing_id, scope_type, version, is_active)
VALUES (1, 'LISTING', 2, true);
-- Expected: ERROR: duplicate key value violates unique constraint "boms_listing_active_unique"
```

### 4.2 Version Uniqueness Per Listing

**Constraint:** `boms_version_unique` on (listing_id, version)

```sql
-- Verify constraint exists
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'boms' AND constraint_name = 'boms_version_unique';

-- Test: Attempt duplicate version
INSERT INTO boms (listing_id, scope_type, version, is_active)
VALUES (1, 'LISTING', 1, false);
-- Expected: ERROR: duplicate key value violates unique constraint "boms_version_unique"
```

### 4.3 ASIN Scenario BOM Constraint

**Constraint:** `boms_asin_active_unique` partial unique index

```sql
-- Verify index exists
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'boms' AND indexname = 'boms_asin_active_unique';

-- Expected:
-- CREATE UNIQUE INDEX boms_asin_active_unique ON boms (asin_entity_id)
-- WHERE is_active = true AND scope_type = 'ASIN_SCENARIO' AND asin_entity_id IS NOT NULL
```

---

## 5. Jobs + Events Schema Verification

### 5.1 Jobs Table

```sql
-- Verify table structure
\d jobs

-- Expected columns:
-- id, job_type, scope_type, listing_id, asin_entity_id, status,
-- priority, attempts, max_attempts, input_json, result_json, log_json,
-- error_message, scheduled_for, started_at, finished_at, created_by,
-- created_at, updated_at

-- Verify ENUMs
SELECT enum_range(NULL::job_type);
-- Expected: {SYNC_AMAZON_OFFER,SYNC_AMAZON_SALES,SYNC_AMAZON_CATALOG,
--            SYNC_KEEPA_ASIN,COMPUTE_FEATURES_LISTING,COMPUTE_FEATURES_ASIN,
--            GENERATE_RECOMMENDATIONS_LISTING,GENERATE_RECOMMENDATIONS_ASIN,
--            PUBLISH_PRICE_CHANGE,PUBLISH_STOCK_CHANGE}

SELECT enum_range(NULL::job_status);
-- Expected: {PENDING,RUNNING,SUCCEEDED,FAILED,CANCELLED}
```

### 5.2 Listing Events Table

```sql
-- Verify table structure
\d listing_events

-- Verify ENUM
SELECT enum_range(NULL::listing_event_type);
-- Expected: {PRICE_CHANGE_DRAFTED,PRICE_CHANGE_PUBLISHED,PRICE_CHANGE_SUCCEEDED,
--            PRICE_CHANGE_FAILED,STOCK_CHANGE_DRAFTED,STOCK_CHANGE_PUBLISHED,
--            STOCK_CHANGE_SUCCEEDED,STOCK_CHANGE_FAILED,BOM_UPDATED,
--            COST_OVERRIDE_UPDATED,AMAZON_SYNC_COMPLETED,KEEPA_SYNC_COMPLETED,
--            FEATURES_COMPUTED,LISTING_CREATED,LISTING_ARCHIVED}
```

### 5.3 Recommendation Events Table

```sql
-- Verify table structure
\d recommendation_events

-- Verify ENUM
SELECT enum_range(NULL::recommendation_event_type);
-- Expected: {GENERATED,VIEWED,ACCEPTED,REJECTED,SNOOZED,EXPIRED,
--            SUPERSEDED,ACTION_STARTED,ACTION_COMPLETED,ACTION_FAILED}
```

---

## 6. Feature Store Schema Verification

```sql
-- Verify table structure
\d feature_store

-- Expected columns:
-- id, entity_type, entity_id, feature_version, features_json, computed_at, created_at

-- Verify ENUM
SELECT enum_range(NULL::feature_entity_type);
-- Expected: {LISTING,ASIN}

-- Verify JSONB indexing works
EXPLAIN ANALYZE
SELECT * FROM feature_store
WHERE entity_type = 'LISTING' AND entity_id = 1
ORDER BY computed_at DESC
LIMIT 1;
-- Should use index: idx_feature_store_computed
```

---

## 7. Schema Risks and Gaps

### 7.1 Identified Risks

| Risk | Severity | Migration | Mitigation |
|------|----------|-----------|------------|
| Missing FK from jobs.asin_entity_id | **P2** | 002 | Added in 003 via ALTER |
| No CASCADE on some FKs | **P3** | Various | Intentional for audit |
| No CONCURRENTLY on indexes | **P2** | All | Run during maintenance |

### 7.2 Missing Constraints (Recommended Future Additions)

| Constraint | Table | Purpose |
|------------|-------|---------|
| `CHECK (bom_cost_ex_vat >= 0)` | feature_store | Prevent negative costs |
| `CHECK (margin BETWEEN -1 AND 1)` | feature_store | Prevent invalid margins |
| `CHECK (attempts <= max_attempts)` | jobs | Enforce retry limit |

### 7.3 Potential Data Integrity Issues

| Issue | Table | Description |
|-------|-------|-------------|
| Orphaned BOMs | boms | listing_id CASCADE deletes, but asin_entity_id CASCADE may leave orphans if ASIN deleted while BOM active |
| Feature staleness | feature_store | No automatic expiry; need scheduled recompute |

---

## 8. Rollback Procedures

### 8.1 Rollback Migration 004

```sql
DROP TABLE IF EXISTS recommendation_events CASCADE;
DROP TABLE IF EXISTS recommendations CASCADE;
DROP TYPE IF EXISTS recommendation_event_type CASCADE;
DROP TYPE IF EXISTS recommendation_status CASCADE;
DROP TYPE IF EXISTS recommendation_type CASCADE;
DROP TYPE IF EXISTS confidence_band CASCADE;
```

### 8.2 Rollback Migration 003

```sql
-- Remove FK first
ALTER TABLE boms DROP CONSTRAINT IF EXISTS boms_asin_entity_fk;
DROP INDEX IF EXISTS boms_asin_active_unique;

DROP TABLE IF EXISTS feature_store CASCADE;
DROP TABLE IF EXISTS listing_sales_daily CASCADE;
DROP TABLE IF EXISTS amazon_catalog_snapshots CASCADE;
DROP TABLE IF EXISTS keepa_snapshots CASCADE;
DROP TABLE IF EXISTS asin_entities CASCADE;
DROP TYPE IF EXISTS feature_entity_type CASCADE;

ALTER TABLE listings DROP COLUMN IF EXISTS asin;
```

### 8.3 Rollback Migration 002

```sql
DROP TABLE IF EXISTS fee_snapshots CASCADE;
DROP TABLE IF EXISTS listing_offer_current CASCADE;
DROP TABLE IF EXISTS listing_events CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;
DROP TYPE IF EXISTS listing_event_type CASCADE;
DROP TYPE IF EXISTS buy_box_status_type CASCADE;
DROP TYPE IF EXISTS job_scope_type CASCADE;
DROP TYPE IF EXISTS job_status CASCADE;
DROP TYPE IF EXISTS job_type CASCADE;

ALTER TABLE listings DROP COLUMN IF EXISTS status;
ALTER TABLE listings DROP COLUMN IF EXISTS fulfillment_channel;
ALTER TABLE listings DROP COLUMN IF EXISTS category;

DELETE FROM settings WHERE key LIKE 'guardrails.%';
```

### 8.4 Rollback Migration 001

```sql
DROP TABLE IF EXISTS listing_cost_overrides CASCADE;
DROP TABLE IF EXISTS bom_lines CASCADE;
DROP TABLE IF EXISTS boms CASCADE;
DROP TABLE IF EXISTS components CASCADE;
DROP TABLE IF EXISTS suppliers CASCADE;
DROP TABLE IF EXISTS marketplaces CASCADE;
DROP TYPE IF EXISTS bom_scope_type CASCADE;

-- Restore column names (careful!)
-- ALTER TABLE listings RENAME COLUMN seller_sku TO sku;
-- ALTER TABLE listings RENAME COLUMN price_inc_vat TO price;
-- ALTER TABLE listings RENAME COLUMN available_quantity TO quantity;
ALTER TABLE listings DROP COLUMN IF EXISTS marketplace_id;

DELETE FROM settings WHERE key LIKE 'guardrails.%' OR key = 'default_vat_rate';
```

---

## 9. Post-Migration Validation

```sql
-- Count tables created
SELECT COUNT(*) as table_count FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

-- List all custom types
SELECT typname FROM pg_type
WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  AND typtype = 'e';

-- Verify BOM invariants
SELECT listing_id, COUNT(*) as active_count
FROM boms
WHERE is_active = true AND scope_type = 'LISTING'
GROUP BY listing_id
HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- Verify FK integrity
SELECT conname, conrelid::regclass, confrelid::regclass
FROM pg_constraint
WHERE contype = 'f'
  AND conrelid::regclass::text IN ('boms','jobs','recommendations');
```

---

## 10. Verdict

| Check | Status |
|-------|--------|
| Migration order documented | **PASS** |
| BOM versioning constraints | **PASS** |
| One-active-BOM invariant | **PASS** |
| Jobs schema per SPEC | **PASS** |
| Events schema per SPEC | **PASS** |
| Feature store schema | **PASS** |
| Rollback procedures | **PASS** |
| Schema risks identified | **PASS** |
| Overall | **PASS** |

**Note:** All migrations use `IF NOT EXISTS` / `IF EXISTS` for idempotency.
