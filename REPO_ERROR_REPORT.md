
## ADDITIONAL FILE REVIEWS (Continuation 2)

### K. Recommendation Service (`src/services/recommendation.service.js`)

**Purpose:** Generates and manages typed recommendations for listings and ASINs with advisory locking.

#### K.1 [POSITIVE] Advisory Lock Implemented Correctly ✅
- **Lines:** 38-57, 146-165
- **Category:** Correctness
- **What's Right:** Uses `pg_try_advisory_lock(lockKey)` with distinct namespaces (100000000 for listings, 200000000 for ASINs). Always releases in `finally` block.
- **Status:** Addresses Addendum B compliance.

#### K.2 [HIGH] Stale Amazon Fees in Margin Calculation (Confirmed)
- **Lines:** 218-224
- **Category:** Correctness
- **What's Wrong:**
  ```javascript
  const totalCost = (features.bom_cost_ex_vat || 0) + (features.shipping_cost_ex_vat || 0) +
                    (features.packaging_cost_ex_vat || 0) + (features.amazon_fees_ex_vat || 0);
  ```
  Uses `features.amazon_fees_ex_vat` which was calculated at the **current** price, not the **suggested** price.
- **Impact:** Recommended price changes show incorrect margin estimates. A 10% price drop would reduce fees by ~1.5%, but this is not reflected.
- **Fix:**
  ```javascript
  const { calculateAmazonFeesExVat } = await import('./economics.service.js');
  const recalculatedFees = calculateAmazonFeesExVat(suggestedPrice, fulfillmentChannel, category, vatRate);
  const totalCost = (features.bom_cost_ex_vat || 0) + ... + recalculatedFees;
  ```

#### K.3 [MEDIUM] Sequential Recommendation Saves (Confirmed)
- **Lines:** 119-124, 192-197
- **Category:** Performance
- **What's Wrong:**
  ```javascript
  for (const rec of recommendations) {
    const saved = await saveRecommendation(rec, jobId);  // Sequential!
  }
  ```
- **Fix:** Use `Promise.all(recommendations.map(...))`

#### K.4 [LOW] Missing Expiry Check for Snoozed Recommendations
- **Lines:** 595-618
- **Category:** Correctness
- **What's Wrong:** `snoozeRecommendation()` sets `snoozed_until` but there's no job/cron to un-snooze expired recommendations.
- **Fix:** Add scheduled job or check in `getPendingRecommendations()`.

---

### L. Buy Box Service (`src/services/buybox.service.js`)

**Purpose:** Manages Buy Box status tracking with canonical WON/LOST/PARTIAL/UNKNOWN values.

#### L.1 [POSITIVE] Clean Status Derivation ✅
- **Lines:** 199-214
- **Category:** Correctness
- **What's Right:** `determineBuyBoxStatus()` correctly handles percentage-based status (>=50% = WON, 0% = LOST, 1-49% = PARTIAL).

#### L.2 [MEDIUM] PARTIAL Status Lost in DB
- **Lines:** 237-239
- **Category:** Correctness
- **What's Wrong:**
  ```javascript
  const dbStatus = buyBoxStatus === 'PARTIAL' ? 'UNKNOWN' : buyBoxStatus;
  ```
  The service correctly computes PARTIAL, but the DB enum only has WON/LOST/UNKNOWN. PARTIAL gets downgraded to UNKNOWN.
- **Impact:** Loss of granularity in historical data.
- **Fix:** Add migration to extend the enum: `ALTER TYPE buy_box_status ADD VALUE 'PARTIAL';`

#### L.3 [LOW] Stub `getBuyBoxHistory()`
- **Lines:** 271-276
- **Category:** DX
- **What's Wrong:** Returns only current status; no historical data.
- **Fix:** Implement history table or note in docs that this is a stub.

---

### M. Job Worker (`src/workers/job-worker.js`)

**Purpose:** Background job processor for all async operations.

#### M.1 [HIGH] No Per-Job Timeout (Confirmed)
- **Lines:** 88-122, 1160-1205
- **Category:** Reliability
- **What's Wrong:** `processJob()` has no timeout wrapper. If SP-API hangs, worker hangs indefinitely.
- **Fix:**
  ```javascript
  const JOB_TIMEOUT_MS = parseInt(process.env.JOB_TIMEOUT_MS || '300000', 10);

  async function processJobWithTimeout(job) {
    return Promise.race([
      processJob(job),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Job timeout exceeded')), JOB_TIMEOUT_MS)
      )
    ]);
  }
  ```

#### M.2 [HIGH] No Dead Letter Queue (Confirmed)
- **Lines:** 1188-1198
- **Category:** Reliability
- **What's Wrong:** Failed jobs just get `status='FAILED'` with no alerting mechanism.
- **Fix:** Add DLQ table or send alert when `job.attempts >= max_attempts`.

#### M.3 [MEDIUM] Worker Shutdown Race Condition
- **Lines:** 1227-1240
- **Category:** Reliability
- **What's Wrong:** `stopWorker()` sets `isRunning = false` and clears interval, but doesn't wait for in-progress job to complete.
- **Fix:**
  ```javascript
  let currentJobPromise = null;

  export async function stopWorker() {
    isRunning = false;
    clearInterval(workerInterval);
    if (currentJobPromise) {
      await currentJobPromise; // Wait for current job
    }
  }
  ```

#### M.4 [MEDIUM] Job Processing Not Truly Parallel
- **Lines:** 1167-1200
- **Category:** Performance
- **What's Wrong:** Despite fetching `WORKER_BATCH_SIZE` jobs, processes them sequentially in a `for` loop.
- **Fix:** Use `Promise.all(pendingJobs.map(...))`

#### M.5 [POSITIVE] Good Publish Flow with Gates ✅
- **Lines:** 135-301, 314-474
- **Category:** Correctness
- **What's Right:** Clear gate structure (ENABLE_PUBLISH → WRITE_MODE → CREDENTIALS) with audit trails at each step.

#### M.6 [POSITIVE] Feature Recompute Queued After Changes ✅
- **Lines:** 626-657
- **Category:** Correctness
- **What's Right:** `queueFeatureRecompute()` properly queues COMPUTE_FEATURES_LISTING after price/stock changes (Addendum E compliance).

---

### N. ListingDetail Page (`alh-ui/src/pages/ListingDetail.tsx`)

**Purpose:** Main listing detail view with BOM editing, price/stock modals, and recommendations display.

#### N.1 [MEDIUM] Multiple API Calls Not Deduplicated
- **Lines:** 51-57, 86-103
- **Category:** Performance
- **What's Wrong:** `reloadData()` duplicates the same calls from `loadData()`. If called rapidly, creates redundant requests.
- **Fix:** Use react-query or custom deduplication hook.

#### N.2 [MEDIUM] BOM Total Recalculated on Every Keystroke
- **Lines:** 186-193
- **Category:** Performance
- **What's Wrong:** `calculateBomTotal()` runs on every render during editing (called in JSX).
- **Fix:** Wrap in `useMemo(() => calculateBomTotal(), [bomLines, components])`.

#### N.3 [LOW] Error Boundaries Missing
- **Category:** UX
- **What's Wrong:** If `getRecommendationTitle()` throws, entire page crashes.
- **Fix:** Add try/catch in JSX or React error boundary.

#### N.4 [POSITIVE] Good Initial Data Loading Pattern ✅
- **Lines:** 51-57
- **Category:** Performance
- **What's Right:** Uses `Promise.all()` to fetch listing, economics, recommendations, BOM, and components in parallel.

---

### O. Database Connection (`src/database/connection.js`)

**Purpose:** PostgreSQL connection pool management with health checks.

#### O.1 [HIGH] No Statement Timeout (Confirmed)
- **Lines:** 33-50
- **Category:** Reliability
- **What's Wrong:** No `statement_timeout` in pool configuration. Long-running queries can exhaust connections.
- **Fix:**
  ```javascript
  const pool = new Pool({
    ...config,
    statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
  });
  ```

#### O.2 [MEDIUM] Slow Query Threshold Too Low
- **Lines:** 72-75
- **Category:** DX
- **What's Wrong:** Logs queries over 100ms as "slow". For complex joins, this is too aggressive and will spam logs.
- **Fix:** Raise to 500ms or make configurable via `SLOW_QUERY_THRESHOLD_MS`.

#### O.3 [LOW] ML Data Pool Never Refreshed (Confirmed)
- **Lines:** 161-211
- **Category:** Reliability
- **What's Wrong:** Materialized view created but no `REFRESH MATERIALIZED VIEW` scheduled.
- **Fix:** Add to nightly job: `REFRESH MATERIALIZED VIEW CONCURRENTLY ml_data_pool;`

#### O.4 [POSITIVE] Good Schema Health Check ✅
- **Lines:** 218-278
- **Category:** DX
- **What's Right:** `checkSchemaHealth()` validates all required tables exist and reports missing ones.

#### O.5 [POSITIVE] Transaction Helper with Auto-Rollback ✅
- **Lines:** 114-128
- **Category:** Reliability
- **What's Right:** `transaction()` properly handles BEGIN/COMMIT/ROLLBACK with client release in `finally`.

---

## FINAL UPDATED STATISTICS

**Report Generated:** 2026-01-22 (Updated)
**Total Findings:** 65
**Critical:** 5
**High:** 21
**Medium:** 29
**Low:** 10

---

## PRIORITIZED ACTION PLAN

### Week 1 (Critical + High-Impact)
1. ✅ SQL Injection fix (30 min)
2. ✅ VAT fee calculation fix (30 min)
3. ✅ Auth bypass fix (15 min)
4. ⬜ Add job timeout wrapper (1 hr)
5. ⬜ Add DB statement timeout (15 min)
6. ⬜ Parallelize batch economics (30 min)
7. ⬜ Recalculate fees in recommendations (1 hr)

### Week 2 (High Reliability)
1. ⬜ Add dead letter queue for failed jobs
2. ⬜ Add circuit breaker for external APIs
3. ⬜ Fix worker shutdown race condition
4. ⬜ Add missing composite indexes
5. ⬜ Persist Keepa rate limit state

### Week 3 (Medium + DX)
1. ⬜ Add frontend test infrastructure
2. ⬜ Extract BomLibrary.tsx components
3. ⬜ Add PARTIAL to buy_box_status enum
4. ⬜ Add table virtualization to listings table
5. ⬜ Fix hardcoded lead time

### Ongoing
- Add advisory lock to feature-store computations
- Standardize logger usage (replace console.log)
- Add edge case tests to economics.test.js
- Document API with OpenAPI spec

---

---

## ADDITIONAL FILE REVIEWS (Continuation 3)

### P. Guardrails Service (`src/services/guardrails.service.js`)

**Purpose:** Server-side enforcement of business rules for price/stock changes per DATA_CONTRACTS §11.

#### P.1 [POSITIVE] Clean Guardrail Loading with Defaults ✅
- **Lines:** 48-101
- **Category:** Correctness
- **What's Right:** `loadGuardrails()` loads from `settings` table with sensible defaults. Handles missing table gracefully.

#### P.2 [POSITIVE] Comprehensive Price Validation ✅
- **Lines:** 116-175
- **Category:** Correctness
- **What's Right:** Checks margin, break-even, price change %, and days of cover. Returns structured violations.

#### P.3 [MEDIUM] Stock Validation Always Passes
- **Lines:** 218-222
- **Category:** Correctness
- **What's Wrong:**
  ```javascript
  return {
    passed: true, // Stock changes don't hard-fail on warnings
    violations,
  };
  ```
  Even with violations, `passed` is always `true`. This means zero-stock changes are never blocked.
- **Impact:** User could accidentally zero-out inventory without a hard warning.
- **Fix:** Add `criticalViolations` array; only `passed = true` if no critical violations.

#### P.4 [MEDIUM] Hardcoded Lead Time (Again)
- **Line:** 243
- **Category:** Correctness
- **What's Wrong:** `calculateStockoutRisk(daysOfCover, leadTimeDays = 14)` - default lead time is hardcoded.
- **Fix:** Pass actual lead time from BOM or listing config.

#### P.5 [LOW] Guardrails Loaded Per Request
- **Lines:** 125, 193, 265
- **Category:** Performance
- **What's Wrong:** `loadGuardrails()` queries the database on every validation call.
- **Fix:** Cache for 60s since guardrails rarely change.

---

### Q. Audit Service (`src/services/audit.service.js`)

**Purpose:** Records comprehensive audit trail for debugging, compliance, and analytics.

#### Q.1 [POSITIVE] Complete Audit Trail Structure ✅
- **Lines:** 26-60, 99-173
- **Category:** Correctness
- **What's Right:** Well-defined event types and outcomes. Records before/after state, actor info, SP-API response, duration, correlation ID.

#### Q.2 [POSITIVE] Silent Failure on Missing Table ✅
- **Lines:** 163-172
- **Category:** Reliability
- **What's Right:** Audit failures don't break main operations - logs warning and returns null.

#### Q.3 [MEDIUM] SQL Injection in getAuditSummary
- **Line:** 388
- **Category:** Security
- **What's Wrong:**
  ```javascript
  WHERE created_at >= NOW() - INTERVAL '${hours} hours'
  ```
  `hours` is interpolated directly into SQL. Although it's an integer from the function parameter, this pattern is unsafe.
- **Fix:** Use parameterized query: `WHERE created_at >= NOW() - $1::interval` with `[`${hours} hours`]`

#### Q.4 [LOW] No Audit Retention Policy
- **Category:** Reliability
- **What's Wrong:** No mechanism to clean up old audit events. Table will grow indefinitely.
- **Fix:** Add scheduled job to delete events older than 90 days.

---

### R. Logger Module (`src/lib/logger.js`)

**Purpose:** Structured logging using Pino for observability.

#### R.1 [POSITIVE] Clean Child Logger Pattern ✅
- **Lines:** 46-64
- **Category:** DX
- **What's Right:** Pre-creates service-specific loggers (keepa, sp-api, worker, database, http) with context.

#### R.2 [POSITIVE] Pretty Print in Dev, JSON in Prod ✅
- **Lines:** 21-30
- **Category:** DX
- **What's Right:** Uses `pino-pretty` for development readability, raw JSON in production for log aggregators.

#### R.3 [LOW] No Log Sampling for High-Volume Events
- **Category:** Performance
- **What's Wrong:** Every event is logged. High-traffic endpoints could generate excessive logs.
- **Fix:** Add sampling option for debug-level logs in production.

---

### S. Metrics Module (`src/lib/metrics.js`)

**Purpose:** Prometheus metrics for observability using prom-client.

#### S.1 [POSITIVE] Comprehensive Metric Coverage ✅
- **Lines:** 26-192
- **Category:** Observability
- **What's Right:** Tracks Keepa calls, SP-API calls, job processing, HTTP requests, publish operations with proper labels and buckets.

#### S.2 [POSITIVE] Default Metrics Included ✅
- **Line:** 20
- **Category:** Observability
- **What's Right:** `client.collectDefaultMetrics({ register })` - includes Node.js runtime metrics.

#### S.3 [MEDIUM] High Cardinality Risk in HTTP Metrics
- **Lines:** 152-165
- **Category:** Performance
- **What's Wrong:**
  ```javascript
  labelNames: ['method', 'route', 'status_code']
  ```
  If `route` includes dynamic segments (e.g., `/api/v2/listings/123`), cardinality explodes.
- **Fix:** Ensure routes are normalized (e.g., `/api/v2/listings/:id`) before recording.

#### S.4 [LOW] No Metric for DB Connection Pool
- **Category:** Observability
- **What's Wrong:** No gauge for `pool.totalCount`, `pool.idleCount`, `pool.waitingCount`.
- **Fix:** Add pool health metrics:
  ```javascript
  export const dbPoolSize = new client.Gauge({
    name: 'db_pool_connections',
    help: 'Database connection pool size',
    labelNames: ['state'], // 'total', 'idle', 'waiting'
  });
  ```

---

### T. Price Edit Modal (`alh-ui/src/components/modals/PriceEditModal.tsx`)

**Purpose:** UI for editing listing prices with preview and guardrails display.

#### T.1 [POSITIVE] Two-Phase Publish Flow ✅
- **Lines:** 30-71
- **Category:** UX/Correctness
- **What's Right:** Preview → Show guardrails → Require reason → Publish. Matches SPEC requirements.

#### T.2 [POSITIVE] Disabled Publish on Guardrail Failure ✅
- **Line:** 192
- **Category:** Correctness
- **What's Right:** `disabled={isPublishing || !preview.guardrails.passed || !reason.trim()}` - can't publish with violations.

#### T.3 [MEDIUM] No Re-Preview on Price Change
- **Lines:** 107-108
- **Category:** UX
- **What's Wrong:** After preview, if user changes price, old preview is still shown. User could accidentally publish with stale preview data.
- **Fix:** Clear preview when price changes:
  ```javascript
  onChange={(e) => {
    setNewPrice(e.target.value);
    setPreview(null); // Clear stale preview
  }}
  ```

#### T.4 [LOW] No Keyboard Submit
- **Category:** UX/Accessibility
- **What's Wrong:** No `onKeyDown` handler for Enter key submission.
- **Fix:** Add `onKeyDown` to form that calls `handlePreview` or `handlePublish` on Enter.

#### T.5 [LOW] Missing Focus Management
- **Category:** Accessibility
- **What's Wrong:** When modal opens, focus doesn't move to price input. When modal closes, focus doesn't return.
- **Fix:** Use `useEffect` to focus input on open, and trap focus within modal.

---

## FINAL STATISTICS (All Reviews Complete)

**Report Generated:** 2026-01-22 (Final)
**Files Reviewed:** 20
**Total Findings:** 78
**Critical:** 5
**High:** 22
**Medium:** 36
**Low:** 15

---

## CONSOLIDATED POSITIVE FINDINGS

The codebase has many well-implemented patterns worth preserving:

| Area | Pattern | Files |
|------|---------|-------|
| **Locking** | Advisory locks for concurrent operations | recommendation.service.js |
| **Audit** | Comprehensive before/after state tracking | audit.service.js, job-worker.js |
| **Validation** | Two-phase preview → publish flow | guardrails.service.js, PriceEditModal.tsx |
| **Metrics** | Full Prometheus integration | metrics.js |
| **Logging** | Structured Pino with service context | logger.js |
| **DB** | Transaction helper with auto-rollback | connection.js |
| **Batching** | UNNEST-based bulk upserts | amazon-data-sync.js |
| **Retry** | Exponential backoff with jitter | keepa.service.js |

---

---

## ADDITIONAL FILE REVIEWS (Continuation 4)

### U. Job Repository (`src/repositories/job.repository.js`)

**Purpose:** CRUD operations for job queue with lifecycle management per DATA_CONTRACTS §10.

#### U.1 [POSITIVE] Correct Use of FOR UPDATE SKIP LOCKED ✅
- **Lines:** 86-96
- **Category:** Correctness
- **What's Right:** `FOR UPDATE OF j SKIP LOCKED` prevents multiple workers from claiming the same job. Proper concurrent-safe job claim pattern.

#### U.2 [POSITIVE] Linear Retry Backoff Documented
- **Line:** 185
- **Category:** DX
- **What's Right:** `scheduled_for = CURRENT_TIMESTAMP + (attempts * INTERVAL '1 minute')` - Linear backoff is intentional (documented in earlier review as area for potential improvement to exponential).

#### U.3 [MEDIUM] Console.warn Instead of Logger
- **Lines:** 47, 73, 102, 320, 357
- **Category:** DX
- **What's Wrong:** Uses `console.warn` instead of structured logger for missing table warnings.
- **Fix:** Import and use `workerLogger.warn()` for consistency.

#### U.4 [LOW] No Cleanup for Old Completed Jobs
- **Category:** Reliability
- **What's Wrong:** SUCCEEDED/FAILED jobs accumulate indefinitely in the `jobs` table.
- **Fix:** Add retention policy: `DELETE FROM jobs WHERE status IN ('SUCCEEDED', 'FAILED') AND finished_at < NOW() - INTERVAL '30 days'`

---

### V. Listing Repository (`src/repositories/listing.repository.js`)

**Purpose:** Data access for listings with schema migration compatibility.

#### V.1 [POSITIVE] Excellent Bulk Upsert Pattern ✅
- **Lines:** 476-555
- **Category:** Performance
- **What's Right:** Uses `UNNEST` with parallel arrays for efficient bulk operations. Correctly uses `xmax = 0` to distinguish inserts from updates.

#### V.2 [POSITIVE] Schema Migration Fallbacks ✅
- **Lines:** 146-180, 242-258
- **Category:** Reliability
- **What's Right:** Gracefully handles both old (`sku`, `price`, `quantity`) and new (`seller_sku`, `price_inc_vat`, `available_quantity`) column names.

#### V.3 [MEDIUM] Duplicate Query Patterns
- **Lines:** 18-79, 86-117, 124-180, 187-210
- **Category:** DX
- **What's Wrong:** Same image aggregation query repeated in `getAll()`, `getById()`, `getBySku()`, `getByAsin()`.
- **Fix:** Extract to helper function: `buildListingSelectQuery(whereClause)`.

#### V.4 [LOW] Missing Index Hint for Search
- **Line:** 53
- **Category:** Performance
- **What's Wrong:** `title ILIKE $n OR seller_sku ILIKE $n OR asin ILIKE $n` - No trigram index, will be slow on large datasets.
- **Fix:** Add `CREATE INDEX idx_listings_search ON listings USING gin(title gin_trgm_ops, seller_sku gin_trgm_ops);`

---

### W. Validation Schemas (`src/lib/validation-schemas.js`)

**Purpose:** JSON Schema definitions for Fastify request validation.

#### W.1 [POSITIVE] Comprehensive Coverage ✅
- **Lines:** 1-390
- **Category:** Security
- **What's Right:** All major endpoints have validation schemas with proper constraints (min/max, patterns, required fields, `additionalProperties: false`).

#### W.2 [POSITIVE] ASIN Pattern Validation ✅
- **Lines:** 49-53, 282-287
- **Category:** Correctness
- **What's Right:** `pattern: '^[A-Z0-9]{10}$'` correctly enforces ASIN format.

#### W.3 [LOW] Missing Schema for Some Endpoints
- **Category:** Security
- **What's Wrong:** No schema for backup/restore endpoints (the SQL injection issue).
- **Fix:** Add validation schema for backup type:
  ```javascript
  export const backupSchema = {
    body: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['full', 'bom'] }
      }
    }
  };
  ```

#### W.4 [LOW] Pagination Limit Not Capped
- **Lines:** 351-363
- **Category:** Performance/Security
- **What's Wrong:** `limit` has no maximum - user could request `?limit=1000000`.
- **Fix:** Add `maximum: 500` to pagination schema.

---

### X. API Client (`alh-ui/src/api/client.ts`)

**Purpose:** Centralized Axios client for all frontend API calls.

#### X.1 [POSITIVE] Clean Response Unwrapping ✅
- **Lines:** 51-59
- **Category:** DX
- **What's Right:** `unwrapResponse()` properly extracts `data.data` and throws meaningful errors.

#### X.2 [POSITIVE] Sensible Timeout ✅
- **Line:** 31
- **Category:** Reliability
- **What's Right:** 30s timeout prevents indefinite hangs.

#### X.3 [MEDIUM] No Request Retry Logic
- **Category:** Reliability
- **What's Wrong:** Single failed request = immediate error. No retry for transient failures.
- **Fix:** Add axios-retry:
  ```typescript
  import axiosRetry from 'axios-retry';
  axiosRetry(apiClient, { retries: 3, retryDelay: axiosRetry.exponentialDelay });
  ```

#### X.4 [LOW] No Request Deduplication
- **Category:** Performance
- **What's Wrong:** Rapid identical requests (e.g., double-click) create duplicate API calls.
- **Fix:** Add request deduplication middleware or use react-query.

---

### Y. Database Schema (`schema.sql`)

**Purpose:** Base schema definition (note: migrations extend this).

#### Y.1 [HIGH] Schema Out of Sync with Migrations
- **Category:** Correctness
- **What's Wrong:** `schema.sql` uses old column names (`sku`, `price`, `quantity`) while migrations use new names (`seller_sku`, `price_inc_vat`, `available_quantity`).
- **Impact:** Running `schema.sql` on fresh DB creates wrong schema.
- **Fix:** Either delete `schema.sql` (use only migrations) or update to match migration state.

#### Y.2 [MEDIUM] Missing Tables from Migrations
- **Category:** Correctness
- **What's Wrong:** `schema.sql` missing tables defined in migrations:
  - `jobs` (job queue)
  - `recommendations` (recommendation engine)
  - `feature_store` (computed features)
  - `components`, `boms`, `bom_lines` (BOM system)
  - `suppliers`
  - `listing_offer_current`, `listing_sales_daily`
  - `keepa_snapshots`, `amazon_catalog_snapshots`
  - `audit_events`
- **Fix:** Remove `schema.sql` and rely solely on migrations, or regenerate from current DB state.

#### Y.3 [MEDIUM] No Unique Constraint on Listing ASIN
- **Line:** 8
- **Category:** Correctness
- **What's Wrong:** `asin VARCHAR(20)` has no unique constraint. Same ASIN could exist on multiple listings.
- **Fix:** Add `UNIQUE` or composite unique on `(asin, marketplace_id)` if multi-marketplace.

#### Y.4 [LOW] Mixed Naming Conventions
- **Lines:** Various
- **Category:** DX
- **What's Wrong:** Mix of snake_case (`current_score`) and camelCase (`currentScore`, `bulletPoints`, `updatedAt`).
- **Fix:** Standardize to snake_case with quoted identifiers for camelCase where needed for compatibility.

---

## SCHEMA RECONCILIATION ISSUE

**CRITICAL FINDING:** The codebase has two conflicting schema sources:

| Source | State | Authority |
|--------|-------|-----------|
| `schema.sql` | Legacy (old column names) | ❌ Stale |
| `migrations/*.sql` | Current (new column names) | ✅ Source of truth |

**Repositories handle this with fallback logic**, but this is fragile.

**Recommendation:** Delete `schema.sql` or add a header comment:
```sql
-- DEPRECATED: Use migrations/* instead
-- This file exists only for reference
```

---

## FINAL STATISTICS (All 25 Files Reviewed)

**Report Generated:** 2026-01-22 (Final)
**Files Reviewed:** 25
**Total Findings:** 90
**Critical:** 5
**High:** 23
**Medium:** 42
**Low:** 20

---

## SEVERITY DISTRIBUTION

| Severity | Count | Examples |
|----------|-------|----------|
| **Critical** | 5 | SQL injection, VAT fees, auth bypass, test confusion, schema mismatch |
| **High** | 23 | No job timeout, no DLQ, stale fees in recs, hardcoded lead time, no statement timeout |
| **Medium** | 42 | Race conditions, sequential loops, missing indexes, console.log usage |
| **Low** | 20 | Missing .env.example, accessibility issues, cleanup policies |

---

## COMPLETE POSITIVE PATTERNS

| Category | Pattern | Files |
|----------|---------|-------|
| **Concurrency** | `FOR UPDATE SKIP LOCKED` for job claims | job.repository.js |
| **Concurrency** | Advisory locks for recommendations | recommendation.service.js |
| **Performance** | UNNEST bulk upserts | listing.repository.js, amazon-data-sync.js |
| **Resilience** | Schema fallback for migrations | listing.repository.js |
| **Security** | Comprehensive JSON Schema validation | validation-schemas.js |
| **Observability** | Pino structured logging | logger.js |
| **Observability** | Prometheus metrics | metrics.js |
| **Audit** | Complete before/after state tracking | audit.service.js |
| **UX** | Two-phase preview→publish flow | guardrails.service.js, PriceEditModal.tsx |
| **Retry** | Exponential backoff with jitter | keepa.service.js |

---

## FINAL RECOMMENDATIONS

### Immediate (This Week)
1. Fix SQL injection in backup/restore
2. Fix VAT fee calculation
3. Fix auth bypass
4. Add job execution timeout
5. Add DB statement timeout
6. Delete or deprecate `schema.sql`

### Short-Term (Next 2 Weeks)
1. Parallelize batch operations
2. Add dead letter queue
3. Recalculate fees in recommendations
4. Add missing composite indexes
5. Add frontend test infrastructure

### Medium-Term (Next Month)
1. Extract large components (BomLibrary.tsx)
2. Add circuit breaker for external APIs
3. Fix hardcoded lead time (use BOM data)
4. Add request retry/deduplication to frontend
5. Standardize logging (remove console.log)

### Long-Term (Next Quarter)
1. OpenAPI documentation
2. E2E test suite
3. Database audit retention policy
4. Metrics cardinality controls
5. Consider migrating to TypeScript on backend

---

## REVIEW COMPLETE ✅

This comprehensive review covered 25 files across:
- API services & routes
- Database repositories & schema
- Worker & job processing
- Frontend pages & components
- Configuration & utilities

All critical security issues have been identified with actionable patches.
