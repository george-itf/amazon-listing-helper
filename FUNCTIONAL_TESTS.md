# FUNCTIONAL_TESTS.md — Phase 4 Product Verification

## 1. Economics Correctness

### 1.1 VAT Inc vs Ex Semantics

| Check | Code Location | Status |
|-------|---------------|--------|
| `price_inc_vat` is display price | `economics.service.js:239` | **PASS** |
| `price_ex_vat = price_inc_vat / (1 + vat_rate)` | `economics.service.js:31` | **PASS** |
| All costs are `*_ex_vat` | `economics.service.js:243-247` | **PASS** |
| Profit calculated ex VAT | `economics.service.js:226` | **PASS** |
| Margin = profit / net_revenue (ex VAT) | `economics.service.js:227` | **PASS** |

### 1.2 Margin Math Verification

```javascript
// From economics.service.js:225-227
const netRevenueExVat = priceExVat;
const profitExVat = roundMoney(netRevenueExVat - totalCostExVat);
const margin = netRevenueExVat > 0 ? roundMoney(profitExVat / netRevenueExVat * 10000) / 10000 : 0;
```

**Analysis:**
- ✓ Net revenue = price ex VAT (correct per SPEC)
- ✓ Profit = revenue - costs (all ex VAT)
- ✓ Margin uses higher precision (4 decimal places)
- ✓ Division by zero protected

### 1.3 BOM Cost Calculation

```sql
-- From economics.service.js:52-64
SELECT COALESCE(SUM(
  bl.quantity * (1 + bl.wastage_rate) * c.unit_cost_ex_vat
), 0) as bom_cost
FROM boms b
JOIN bom_lines bl ON bl.bom_id = b.id
JOIN components c ON c.id = bl.component_id
WHERE b.listing_id = $1
  AND b.is_active = true
  AND b.scope_type = 'LISTING'
```

**Analysis:**
- ✓ Only active BOM counted
- ✓ Wastage rate applied correctly: `qty * (1 + wastage)`
- ✓ Component cost is ex VAT
- ✓ COALESCE handles missing BOM (returns 0)

### 1.4 Amazon Fees Calculation

```javascript
// From economics.service.js:110-130
const referralRate = 0.15;
const referralFee = priceIncVat * referralRate;

let fulfillmentFee = 0;
if (fulfillmentChannel === 'FBA') {
  fulfillmentFee = 2.50; // Base small item fee
}
```

**Analysis:**
- ⚠ Referral fee calculated on inc VAT price (Amazon's actual method)
- ⚠ Simplified fee structure (hardcoded rates)
- ⚠ No size/weight-based FBA fees
- **Recommendation:** Integrate Amazon Fee Preview API for accuracy

### 1.5 Economics Acceptance Test

| Input | Expected | Calculation |
|-------|----------|-------------|
| price_inc_vat = 24.00 | price_ex_vat = 20.00 | 24 / 1.20 |
| vat_rate = 0.20 | | |
| bom = 6.00 | | |
| ship = 2.00 | | |
| pack = 0.50 | total_cost = 11.50 | 6+2+0.5+3 |
| fees = 3.00 | profit = 8.50 | 20-11.5 |
| | margin = 0.425 | 8.5/20 |

**Status:** ✓ Test exists in `economics.test.js:ACCEPTANCE`

---

## 2. Guardrails Enforcement

### 2.1 Server-Side Re-Computation

| Endpoint | Re-Computes Guardrails | Location |
|----------|------------------------|----------|
| `POST /price/preview` | ✓ Yes | `v2.routes.js:447-485` |
| `POST /price/publish` | ✓ Yes | `v2.routes.js:549-592` |
| `POST /stock/preview` | ✓ Yes | `v2.routes.js:701-740` |
| `POST /stock/publish` | ✓ Yes | `v2.routes.js:758-825` |

**Code Evidence (publish):**
```javascript
// v2.routes.js:583-598
// RE-COMPUTE guardrails (never trust UI)
const guardrailsResult = await validatePriceChange({...});

// Block publish if guardrails failed
if (!guardrailsResult.passed) {
  return reply.status(400).send({
    error: 'Guardrails check failed',
    guardrails: guardrailsResult,
  });
}
```

**Status:** **PASS** — Server always re-validates before job creation

### 2.2 Guardrails Rules Verified

| Rule | Service Function | Enforced |
|------|------------------|----------|
| Min margin (15%) | `validatePriceChange:104-111` | ✓ |
| Max price change (5%/day) | `validatePriceChange:124-134` | ✓ |
| Break-even protection | `validatePriceChange:114-121` | ✓ |
| Min days of cover | `validatePriceChange:137-144` | ✓ |
| Min stock threshold | `validateStockChange:172-179` | ✓ (warning) |

### 2.3 Guardrails Response Format

```javascript
// From guardrails.service.js:146-149
return {
  passed: violations.length === 0,
  violations,  // Array of { rule, threshold, actual, message }
};
```

**Status:** **PASS** — Matches DATA_CONTRACTS.md §11

---

## 3. Publish Lifecycle

### 3.1 Flow Verification

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      PRICE PUBLISH LIFECYCLE                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. POST /price/publish                                                 │
│     └─► Validate input (price_inc_vat, reason)                         │
│     └─► Get current listing data                                        │
│     └─► Calculate new economics                                         │
│     └─► RE-COMPUTE guardrails ← CRITICAL                               │
│     └─► IF guardrails fail: return 400                                 │
│                                                                         │
│  2. Create listing_event (PRICE_CHANGE_PUBLISHED)                      │
│     └─► before_json: { price_inc_vat: current }                        │
│     └─► after_json: { price_inc_vat: new }                             │
│     └─► reason, correlation_id stored                                   │
│                                                                         │
│  3. Create job (PUBLISH_PRICE_CHANGE)                                  │
│     └─► status: PENDING                                                 │
│     └─► input_json: { listing_id, new_price, old_price, reason }       │
│     └─► listing_event_id linked                                         │
│                                                                         │
│  4. Return { job_id, status, listing_event_id }                        │
│                                                                         │
│  5. Worker picks up job                                                 │
│     └─► Calls Amazon SP-API (or mock)                                  │
│     └─► Updates listing.price_inc_vat                                   │
│     └─► Creates PRICE_CHANGE_SUCCEEDED event (or FAILED)               │
│     └─► Updates job status                                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Code Locations:**
- Step 1-4: `v2.routes.js:530-634`
- Step 5: `job-worker.js` (PUBLISH_PRICE_CHANGE handler)

### 3.2 Audit Trail Verification

| Event Type | Trigger | Stored Data |
|------------|---------|-------------|
| PRICE_CHANGE_PUBLISHED | Publish endpoint | before/after price, reason |
| PRICE_CHANGE_SUCCEEDED | Worker success | job_id |
| PRICE_CHANGE_FAILED | Worker failure | error message |

**Status:** **PASS** — Full audit trail implemented

### 3.3 State Update Verification

```javascript
// From job-worker.js (PUBLISH_PRICE_CHANGE handler)
// Update listing price
await client.query(
  'UPDATE listings SET price_inc_vat = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
  [newPrice, listingId]
);

// Create success event
await client.query(`
  INSERT INTO listing_events (listing_id, event_type, job_id, ...)
  VALUES ($1, 'PRICE_CHANGE_SUCCEEDED', $2, ...)
`, [listingId, jobId, ...]);
```

**Status:** **PASS** — Atomic state update with event creation

---

## 4. Feature Store as Single Read Source

### 4.1 Feature Store Usage

| Consumer | Uses Feature Store | Location |
|----------|-------------------|----------|
| Economics display | ❌ No (calculates directly) | `v2.routes.js:262-278` |
| Recommendations | ✓ Yes | `recommendation.service.js:37` |
| Research pool | ✓ Yes | `v2.routes.js:1838-1856` |
| ASIN details | ✓ Yes | `v2.routes.js:1048-1071` |

### 4.2 Feature Computation Triggers

| Trigger | Job Type | Location |
|---------|----------|----------|
| Keepa sync complete | COMPUTE_FEATURES_ASIN | `keepa.service.js:syncKeepaAsin` |
| BOM update | COMPUTE_FEATURES_LISTING | `v2.routes.js` BOM endpoints |
| Manual refresh | COMPUTE_FEATURES_* | `/features/refresh` endpoints |

### 4.3 Gap Analysis

| Issue | Severity | Recommendation |
|-------|----------|----------------|
| Economics endpoint recalculates instead of reading store | **P2** | Add caching via feature_store |
| No automatic feature recompute on price change | **P2** | Add trigger after price publish |

**Status:** **PARTIAL PASS** — Feature store used for recommendations but not universally

---

## 5. Recommendation Traceability

### 5.1 Recommendation Structure

```javascript
// From recommendation.service.js
{
  recommendation_type: 'PRICE_DECREASE_REGAIN_BUYBOX',
  entity_type: 'LISTING',
  entity_id: listingId,

  action_payload_json: {
    suggested_price_inc_vat: newPrice,
    price_change_amount: delta,
    price_change_percentage: pctChange,
  },

  evidence_json: {
    current_price_inc_vat: features.price_inc_vat,
    buy_box_status: 'LOST',
    competitor_price_p25: features.keepa_price_p25_90d,
    days_at_current_price: 7,
  },

  guardrails_json: guardrailsResult,

  impact_json: {
    estimated_profit_change: newProfit - currentProfit,
    estimated_margin: newMargin,
    buy_box_probability: 0.8,
  },

  confidence: 'HIGH',
  confidence_score: 0.85,
}
```

**Status:** **PASS** — Fully structured per SPEC §9

### 5.2 Recommendation Lifecycle Events

| Event | Trigger | Tracked |
|-------|---------|---------|
| GENERATED | New rec created | ✓ `saveRecommendation()` |
| ACCEPTED | User accepts | ✓ `acceptRecommendation()` |
| REJECTED | User rejects | ✓ `rejectRecommendation()` |
| SNOOZED | User snoozes | ✓ `snoozeRecommendation()` |
| ACTION_COMPLETED | Job succeeds | ✓ Worker callback |

**Status:** **PASS** — Full lifecycle tracking

---

## 6. ASIN → Listing Conversion

### 6.1 Conversion Flow

| Step | Code | Status |
|------|------|--------|
| Validate SKU uniqueness | `v2.routes.js:1736-1746` | ✓ |
| Validate ASIN not already listing | `v2.routes.js:1722-1733` | ✓ |
| Get price from Keepa if not provided | `v2.routes.js:1751-1766` | ✓ |
| Create listing in transaction | `v2.routes.js:1768-1785` | ✓ |
| Link ASIN entity to listing | `v2.routes.js:1787-1790` | ✓ |
| Copy scenario BOM if requested | `v2.routes.js:1794-1823` | ✓ |
| Queue feature computation | `v2.routes.js:1828-1830` | ✓ |

### 6.2 BOM Carryover Verification

```javascript
// v2.routes.js:1816-1822
// Copy BOM lines
await client.query(`
  INSERT INTO bom_lines (bom_id, component_id, quantity, wastage_rate, notes)
  SELECT $1, component_id, quantity, wastage_rate, notes
  FROM bom_lines
  WHERE bom_id = $2
`, [copiedBomId, scenarioBomId]);
```

**Analysis:**
- ✓ Copies all line properties (component_id, quantity, wastage_rate, notes)
- ✓ Creates new BOM with scope_type = 'LISTING'
- ✓ Sets version = 1, is_active = true
- ✓ Atomic within transaction

**Status:** **PASS** — BOM carryover implemented correctly

### 6.3 Response Format

```json
{
  "success": true,
  "listing_id": 123,
  "sku": "NEW-SKU-001",
  "asin": "B001234567",
  "asin_entity_id": 45,
  "bom_copied": true,
  "bom_id": 67,
  "message": "ASIN converted to listing successfully"
}
```

**Status:** **PASS** — Informative response with all relevant IDs

---

## 7. Summary

| Check | Status | Notes |
|-------|--------|-------|
| Economics VAT semantics | **PASS** | Correct inc/ex handling |
| Economics margin math | **PASS** | Proper calculation |
| Guardrails server-side | **PASS** | Always re-validated |
| Publish lifecycle | **PASS** | Full audit trail |
| Feature store usage | **PARTIAL** | Not used for economics display |
| Recommendation traceability | **PASS** | Full lifecycle events |
| ASIN conversion + BOM | **PASS** | Atomic with carryover |

---

## 8. Recommended Improvements

### P0 (Critical)
- None identified

### P1 (Important)
1. Add feature recompute trigger after price/stock change
2. Use feature store for economics display (caching)

### P2 (Moderate)
1. Integrate Amazon Fee Preview API for accurate fees
2. Add size/weight-based FBA fee calculation
3. Add automated feature staleness detection

### P3 (Minor)
1. Add conversion rate anomaly detection
2. Add Buy Box anomaly detection
