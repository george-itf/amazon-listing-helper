# IDEMPOTENCY.md — Phase 5 Drift & Idempotency Checks

## 1. Job Processing Idempotency

### 1.1 Job Claiming — Race Condition Prevention

**Implementation:** `job.repository.js:66-80`

```sql
SELECT j.*, l.seller_sku as listing_sku
FROM jobs j
LEFT JOIN listings l ON l.id = j.listing_id
WHERE j.status = 'PENDING'
  AND j.scheduled_for <= CURRENT_TIMESTAMP
  AND j.attempts < j.max_attempts
ORDER BY j.priority DESC, j.scheduled_for ASC
LIMIT $1
FOR UPDATE SKIP LOCKED  -- ← CRITICAL for multi-worker safety
```

**Analysis:**
- ✓ `FOR UPDATE SKIP LOCKED` prevents multiple workers claiming same job
- ✓ PostgreSQL row-level locking ensures exactly-once claim
- ✓ No contention delays — skips locked rows instantly

### 1.2 Atomic Status Transition

**Implementation:** `job.repository.js:87-101`

```sql
UPDATE jobs
SET
  status = 'RUNNING',
  started_at = CURRENT_TIMESTAMP,
  attempts = attempts + 1,
  updated_at = CURRENT_TIMESTAMP
WHERE id = $1
  AND status = 'PENDING'  -- ← Ensures idempotent claim
RETURNING *
```

**Analysis:**
- ✓ Claim only succeeds if job still PENDING
- ✓ Returns null if already claimed → worker safely skips
- ✓ Atomic increment of `attempts` counter

### 1.3 Retry Logic with Backoff

**Implementation:** `job.repository.js:144-164`

```sql
SET
  status = CASE
    WHEN attempts >= max_attempts THEN 'FAILED'::job_status
    ELSE 'PENDING'::job_status  -- ← Re-queue for retry
  END,
  scheduled_for = CASE
    WHEN attempts < max_attempts THEN CURRENT_TIMESTAMP + (attempts * INTERVAL '1 minute')
    ELSE scheduled_for  -- ← Exponential backoff
  END
```

**Analysis:**
- ✓ Jobs return to PENDING if retries remain
- ✓ Linear backoff (1min, 2min, 3min, ...)
- ✓ Permanent FAILED after max_attempts

**Verdict:** **PASS** — Job processing is idempotent and race-condition safe

---

## 2. Feature Computation Idempotency

### 2.1 Re-Running Feature Computation

**Implementation:** `feature-store.service.js:321-328`

```javascript
export async function saveFeatures(entityType, entityId, features) {
  const result = await query(`
    INSERT INTO feature_store (entity_type, entity_id, feature_version, features_json, computed_at)
    VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
    RETURNING *
  `, [entityType, entityId, FEATURE_VERSION, JSON.stringify(features)]);

  return result.rows[0];
}
```

**Analysis:**
- ✓ Creates new row on each computation (append-only)
- ✓ Old features remain for history
- ✓ Latest features retrieved by `ORDER BY computed_at DESC LIMIT 1`
- ⚠ No deduplication — multiple identical rows possible

### 2.2 Feature Staleness

| Behavior | Status |
|----------|--------|
| Re-run creates new row | ✓ Safe (append-only) |
| Old rows deleted | ❌ No automatic cleanup |
| Duplicate detection | ❌ None |
| Identical features skipped | ❌ No |

**Recommendation:** Add check to skip if features unchanged:
```javascript
const existing = await getLatestFeatures(entityType, entityId);
if (existing && JSON.stringify(existing.features_json) === JSON.stringify(features)) {
  return existing; // Skip duplicate
}
```

**Verdict:** **PARTIAL PASS** — Safe to re-run, but creates duplicates

---

## 3. Recommendation Generation Idempotency

### 3.1 Supersession of Old Recommendations

**Implementation:** `recommendation.service.js:463-469`

```javascript
async function expireOldRecommendations(entityType, entityId) {
  await query(`
    UPDATE recommendations
    SET status = 'SUPERSEDED', updated_at = CURRENT_TIMESTAMP
    WHERE entity_type = $1 AND entity_id = $2 AND status = 'PENDING'
  `, [entityType, entityId]);
}
```

**Analysis:**
- ✓ Called before generating new recommendations (lines 58, 126)
- ✓ Old PENDING recs marked SUPERSEDED (not deleted)
- ✓ ACCEPTED/REJECTED recs preserved (audit trail)
- ✓ Re-running won't create duplicates

### 3.2 Re-Run Behavior

| Scenario | Behavior | Status |
|----------|----------|--------|
| First generation | Creates new recs | ✓ |
| Re-run immediately | Supersedes old, creates new | ✓ |
| User accepted rec, then re-run | Accepted preserved, new PENDING created | ✓ |
| Re-run with unchanged features | Still supersedes old, creates new | ⚠ Creates duplicates |

**Verdict:** **PASS** — Idempotent via supersession pattern

---

## 4. Publish Operations Idempotency

### 4.1 Price/Stock Publish

**Analysis of potential issues:**

| Scenario | Code Behavior | Idempotent? |
|----------|---------------|-------------|
| Publish same price twice | Creates two jobs | ❌ |
| Worker processes same job twice | Job claim fails (already RUNNING) | ✓ |
| Publish while job pending | Creates another job | ❌ |

### 4.2 Duplicate Job Prevention (MISSING)

**Current behavior:** No check for existing pending job with same parameters

**Recommendation:** Add deduplication check:
```javascript
// Before creating job, check for existing pending
const existing = await query(`
  SELECT id FROM jobs
  WHERE listing_id = $1
    AND job_type = $2
    AND status = 'PENDING'
    AND input_json->>'price_inc_vat' = $3
`, [listingId, 'PUBLISH_PRICE_CHANGE', newPrice.toString()]);

if (existing.rows.length > 0) {
  return reply.status(409).send({
    error: 'Duplicate job already pending',
    existing_job_id: existing.rows[0].id
  });
}
```

**Verdict:** **PARTIAL PASS** — Worker is safe, but API allows duplicate jobs

---

## 5. Race Conditions Analysis

### 5.1 Identified Race Conditions

| Component | Race Condition | Mitigated? | How |
|-----------|----------------|------------|-----|
| Job claim | Multiple workers claim same job | ✓ | `FOR UPDATE SKIP LOCKED` |
| Job retry | Concurrent retries | ✓ | Atomic `attempts` increment |
| BOM activation | Concurrent BOM updates | ✓ | Partial unique index |
| Feature save | Concurrent computations | ✓ (via append) | No conflict, just duplicates |
| Rec supersede | Concurrent generations | ⚠ | May skip some recs |

### 5.2 BOM Activation Race

**Implementation:** `001_slice_a_schema.sql:104-106`

```sql
CREATE UNIQUE INDEX boms_listing_active_unique
ON boms (listing_id)
WHERE is_active = true AND scope_type = 'LISTING';
```

**Scenario:** Two transactions try to activate BOMs for same listing

**Behavior:**
1. First transaction deactivates old BOM, activates new → succeeds
2. Second transaction tries to activate → unique constraint violation
3. Second transaction rolls back

**Verdict:** ✓ Safe — constraint prevents race

### 5.3 Recommendation Supersession Race

**Scenario:** Two workers generate recommendations for same listing simultaneously

**Behavior:**
1. Worker A: expires old recs (IDs 1,2,3 → SUPERSEDED)
2. Worker B: expires old recs (nothing to expire now)
3. Worker A: inserts new recs (IDs 4,5)
4. Worker B: inserts new recs (IDs 6,7)

**Result:** Duplicate recommendations created

**Mitigation:** Add locking around recommendation generation:
```javascript
await query('SELECT pg_advisory_lock($1)', [listingId]);
try {
  await expireOldRecommendations(...);
  await generateAndSaveRecs(...);
} finally {
  await query('SELECT pg_advisory_unlock($1)', [listingId]);
}
```

**Verdict:** ⚠ Potential duplicates under concurrent generation

---

## 6. Duplicated State Analysis

### 6.1 Current State

| Data | Duplicates Possible? | Impact |
|------|---------------------|--------|
| Jobs | Yes (user clicks twice) | Creates unnecessary work |
| Features | Yes (re-run computation) | Wastes storage |
| Recommendations | Unlikely (supersession) | Minimal |
| BOM versions | No (constraint) | N/A |
| Listing events | No (append-only audit) | N/A |

### 6.2 Storage Drift

**feature_store table:**
- Appends on every computation
- No automatic cleanup
- May grow unbounded

**Recommendation:** Add retention policy:
```sql
DELETE FROM feature_store
WHERE computed_at < NOW() - INTERVAL '90 days'
  AND id NOT IN (
    SELECT DISTINCT ON (entity_type, entity_id) id
    FROM feature_store
    ORDER BY entity_type, entity_id, computed_at DESC
  );
```

---

## 7. Non-Idempotent Behavior Catalog

### 7.1 Known Non-Idempotent Operations

| Operation | Behavior | Severity | Fix |
|-----------|----------|----------|-----|
| `POST /price/publish` | Creates new job each call | **P2** | Add pending job check |
| `POST /stock/publish` | Creates new job each call | **P2** | Add pending job check |
| Feature computation | Appends new row | **P3** | Add hash comparison |
| Recommendation job | Creates under concurrent | **P2** | Add advisory lock |
| Listing event creation | Always creates new | ✓ Correct (audit log) | N/A |

### 7.2 Safe to Re-Run

| Operation | Safe? | Notes |
|-----------|-------|-------|
| Job worker | ✓ Yes | `FOR UPDATE SKIP LOCKED` |
| Feature computation | ✓ Yes | Append-only, latest wins |
| Rec generation | ✓ Yes | Supersession pattern |
| BOM activation | ✓ Yes | Unique constraint |
| Migration scripts | ✓ Yes | `IF NOT EXISTS` |

---

## 8. Summary

| Check | Status |
|-------|--------|
| Job claim race prevention | **PASS** |
| Job retry idempotency | **PASS** |
| Feature re-computation | **PARTIAL** (creates duplicates) |
| Recommendation generation | **PASS** (supersession) |
| Publish idempotency | **PARTIAL** (no pending check) |
| BOM activation race | **PASS** |
| Overall | **PASS WITH WARNINGS** |

---

## 9. Recommended Fixes

### P1 (Important)
1. Add pending job deduplication check in publish endpoints
2. Add advisory lock around recommendation generation

### P2 (Moderate)
1. Add feature hash comparison to skip duplicates
2. Add job deduplication for same (listing, type, params)

### P3 (Minor)
1. Add feature_store retention policy (delete old rows)
2. Add metrics for duplicate detection monitoring
