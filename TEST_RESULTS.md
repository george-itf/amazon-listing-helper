# TEST_RESULTS.md — Phase 2 Build & Test Sanity

## 1. Dependencies

```
✓ npm install completed
✓ 183 packages audited
⚠ 3 high severity vulnerabilities (recommend npm audit fix)
```

## 2. Test Framework

**Status:** MINIMAL — No test runner (jest/mocha)

**Test files found:**
- `src/tests/economics.test.js` — Manual runner with assert
- `src/tests/guardrails.test.js` — Manual runner with assert

**Execution method:** `node src/tests/<file>.js`

---

## 3. Economics Test Results

```
Running Economics Service Unit Tests...

✓ roundMoney: rounds to 2 decimal places
✓ roundMoney: handles negative numbers
✗ roundMoney: handles zero
  Expected values to be strictly equal:
  + actual: -0
  - expected: 0

✓ calculatePriceExVat: UK VAT 20%
✓ calculatePriceExVat: zero VAT
✓ calculatePriceExVat: different VAT rates
✓ calculateBreakEvenPriceIncVat: basic calculation
✓ calculateBreakEvenPriceIncVat: zero cost
✓ calculateBreakEvenPriceIncVat: high cost scenario
✓ calculateAmazonFeesExVat: FBM basic referral
✓ calculateAmazonFeesExVat: FBA includes fulfillment fee
✓ calculateAmazonFeesExVat: media category adds per-item fee
✓ ACCEPTANCE: Full economics calculation matches SPEC
✓ ACCEPTANCE: Break-even price calculation
✓ Edge case: very small price
✓ Edge case: large price
✓ Edge case: zero price
```

**Summary:** 16/17 tests pass

**Failed Test Analysis:**
- `roundMoney: handles zero` — JavaScript `-0` vs `0` comparison issue
- **Root cause:** `Math.round(-0.00001 * 100) / 100` produces `-0`
- **Severity:** P3 (cosmetic) — `-0 === 0` is true in JS; only `Object.is` differentiates
- **Impact:** None in production

---

## 4. Guardrails Test Results

```
Running Guardrails Service Unit Tests...

✓ calculateDaysOfCover: normal scenario
✓ calculateDaysOfCover: zero velocity returns null
✓ calculateDaysOfCover: negative velocity returns null
✓ calculateDaysOfCover: zero stock returns 0
✓ calculateDaysOfCover: fractional result
✓ calculateStockoutRisk: HIGH when days < 0.5 * lead time
✓ calculateStockoutRisk: MEDIUM when days between 0.5 and 1.0 lead time
✓ calculateStockoutRisk: LOW when days > lead time
✓ calculateStockoutRisk: LOW when null (no velocity)
✓ calculateStockoutRisk: default lead time is 14 days
✓ GUARDRAILS: Margin below 15% should trigger violation
✓ GUARDRAILS: Price change > 5% should trigger violation
✓ GUARDRAILS: Price below break-even should trigger violation
```

**Summary:** 13/13 tests pass

---

## 5. Missing Tests

### 5.1 Critical Missing Tests (P0/P1)

| Area | Missing Test | Impact |
|------|--------------|--------|
| **BOM calculation** | BOM line total with wastage | Core economics |
| **BOM versioning** | Version increment, active toggle | Data integrity |
| **Job lifecycle** | Claim, succeed, fail transitions | Async processing |
| **Recommendations** | Type generation, evidence format | Feature correctness |
| **Feature store** | Computation triggers | Data freshness |
| **Publish flow** | End-to-end price/stock change | Critical path |

### 5.2 Important Missing Tests (P2)

| Area | Missing Test | Impact |
|------|--------------|--------|
| Keepa parsing | Raw JSON to parsed_json | External data |
| Amazon fees | Edge cases, different categories | Profitability |
| ASIN convert | BOM copy, SKU uniqueness | Workflow |
| Research pool | Opportunity score calculation | Recommendations |

### 5.3 Nice-to-Have Tests (P3)

| Area | Missing Test |
|------|--------------|
| Pagination | Listings, jobs, recommendations |
| Filtering | Query parameters |
| Sorting | ORDER BY variations |
| Error handling | Malformed inputs, missing data |

---

## 6. False Confidence Areas

### 6.1 High Risk — Untested Critical Paths

| Component | Risk | Reason |
|-----------|------|--------|
| `job-worker.js` | **HIGH** | No tests; async processing, state transitions |
| `recommendation.service.js` | **HIGH** | Complex logic, no tests |
| `keepa.service.js` | **MEDIUM** | External API parsing untested |
| `feature-store.service.js` | **MEDIUM** | Many derived calculations |

### 6.2 Coverage Estimate

| Layer | Estimated Coverage |
|-------|-------------------|
| Economics service | ~70% (pure math functions) |
| Guardrails service | ~60% (validation functions) |
| Repositories | 0% |
| Routes | 0% |
| Worker | 0% |
| Feature store | 0% |
| Recommendations | 0% |

---

## 7. Build Sanity

### 7.1 Syntax Check

```bash
# Check all JS files for syntax errors
node --check src/server.js           # ✓ OK
node --check src/routes/v2.routes.js # ✓ OK
node --check src/services/*.js       # ✓ OK
node --check src/workers/*.js        # ✓ OK
node --check src/repositories/*.js   # ✓ OK
```

### 7.2 Import Resolution

| Module | Status |
|--------|--------|
| economics.service.js | ✓ Exports fixed |
| guardrails.service.js | ✓ OK |
| feature-store.service.js | ✓ OK |
| recommendation.service.js | ✓ OK |
| keepa.service.js | ✓ OK |
| All repositories | ✓ OK |

### 7.3 Startup Check (without DB)

**Note:** Cannot test server startup without PostgreSQL connection.

---

## 8. Recommendations

### 8.1 Immediate Actions (before wider use)

1. **Add integration test for economics calculation**
   - Test with real DB data
   - Verify BOM → economics → margin flow

2. **Add job worker tests**
   - State transition coverage
   - Error handling
   - Retry logic

3. **Fix `-0` edge case** (optional, P3)
   - Add `Object.is(result, 0) || result === 0` check
   - Or change test to use `Object.is`

### 8.2 Before Production

1. Install test framework (jest recommended)
2. Add at least 1 test per critical endpoint
3. Add CI/CD pipeline with test gate
4. Achieve >50% coverage on critical services

---

## 9. Test Execution Commands

```bash
# Run economics tests
cd main/app && node src/tests/economics.test.js

# Run guardrails tests
cd main/app && node src/tests/guardrails.test.js

# Run all tests
cd main/app && node src/tests/economics.test.js && node src/tests/guardrails.test.js
```

---

## 10. Verdict

| Metric | Status |
|--------|--------|
| Dependencies install | **PASS** |
| Existing tests pass | **PASS** (29/30, 1 cosmetic fail) |
| Critical paths tested | **FAIL** (gaps in worker, recs) |
| Build sanity | **PASS** |
| Overall | **PASS WITH WARNINGS** |

**Recommendation:** Proceed with caution. Add integration tests before production use.
