# CONTRACT_VERIFICATION.md — Phase 1 Verification

## 1. Document Presence

| Document | Present | Location |
|----------|---------|----------|
| SPEC.md | ✓ | `/SPEC.md` |
| DATA_CONTRACTS.md | ✓ | `/DATA_CONTRACTS.md` |
| DEPRECATION_PLAN.md | ✓ | `/DEPRECATION_PLAN.md` |
| ARCHITECTURE_AUDIT.md | ✓ | `/ARCHITECTURE_AUDIT.md` |

---

## 2. Economics DTO Verification

### 2.1 SPEC Fields (DATA_CONTRACTS.md §4.2)

| Field | Contract | Implementation | Status |
|-------|----------|----------------|--------|
| `listing_id` | number | ✓ `economics.service.js:234` | **ALIGNED** |
| `marketplace_id` | number | ✓ `economics.service.js:235` | **ALIGNED** |
| `vat_rate` | number | ✓ `economics.service.js:236` | **ALIGNED** |
| `price_inc_vat` | number | ✓ `economics.service.js:239` | **ALIGNED** |
| `price_ex_vat` | number | ✓ `economics.service.js:240` | **ALIGNED** |
| `bom_cost_ex_vat` | number | ✓ `economics.service.js:243` | **ALIGNED** |
| `shipping_cost_ex_vat` | number | ✓ `economics.service.js:244` | **ALIGNED** |
| `packaging_cost_ex_vat` | number | ✓ `economics.service.js:245` | **ALIGNED** |
| `amazon_fees_ex_vat` | number | ✓ `economics.service.js:246` | **ALIGNED** |
| `total_cost_ex_vat` | number | ✓ `economics.service.js:247` | **ALIGNED** |
| `net_revenue_ex_vat` | number | ✓ `economics.service.js:250` | **ALIGNED** |
| `profit_ex_vat` | number | ✓ `economics.service.js:251` | **ALIGNED** |
| `margin` | number | ✓ `economics.service.js:252` | **ALIGNED** |
| `break_even_price_inc_vat` | number | ✓ `economics.service.js:253` | **ALIGNED** |
| `computed_at` | ISO 8601 | ✓ `economics.service.js:256` | **ALIGNED** |
| `bom_version` | number/null | ✓ `economics.service.js:257` | **ALIGNED** |
| `fee_snapshot_id` | number/null | ✓ `economics.service.js:258` (always null) | **PARTIAL** |

### 2.2 VAT Semantics (SPEC §0.1)

| Rule | Contract | Implementation | Status |
|------|----------|----------------|--------|
| Display price = VAT inc | Yes | `price_inc_vat` field | **ALIGNED** |
| Costs = VAT ex | Yes | All `*_ex_vat` fields | **ALIGNED** |
| Profit = VAT ex | Yes | `profit_ex_vat` | **ALIGNED** |
| Margin = VAT ex | Yes | `profit_ex_vat / net_revenue_ex_vat` | **ALIGNED** |
| Conversion formula | `price_inc_vat / (1 + vat_rate)` | `economics.service.js:31` | **ALIGNED** |

### 2.3 Rounding Policy (DATA_CONTRACTS.md §3)

| Rule | Contract | Implementation | Status |
|------|----------|----------------|--------|
| Storage format | `NUMERIC(12,2)` | ✓ All migrations | **ALIGNED** |
| JS rounding | `Math.round(value * 100) / 100` | ✓ `economics.service.js:21` | **ALIGNED** |
| Margin precision | Higher precision | `roundMoney(* 10000) / 10000` | **ALIGNED** |

### 2.4 Acceptance Test Values (SPEC §16.1)

```
Given: price_inc_vat=24.00, vat_rate=0.20, bom=6.00, ship=2.00, pack=0.50, fees=3.00
Expected: price_ex_vat=20.00, total_cost=11.50, profit=8.50, margin=0.425
```

**Status:** Test case exists in `economics.test.js` — **ALIGNED**

---

## 3. Feature Store Verification

### 3.1 Schema (DATA_CONTRACTS.md §9)

| Field | Contract | Implementation | Status |
|-------|----------|----------------|--------|
| `entity_type` | ENUM('LISTING','ASIN') | ✓ `003_slice_c_schema.sql` | **ALIGNED** |
| `entity_id` | INTEGER | ✓ | **ALIGNED** |
| `feature_version` | INTEGER | ✓ | **ALIGNED** |
| `features_json` | JSONB | ✓ | **ALIGNED** |
| `computed_at` | TIMESTAMP | ✓ | **ALIGNED** |

### 3.2 Required Listing Features (SPEC §8.2)

| Feature | Contract | Implementation | Status |
|---------|----------|----------------|--------|
| Economics fields | All 10 | ✓ `feature-store.service.js:156-165` | **ALIGNED** |
| `units_7d`, `units_30d` | Required | ✓ Line 168-169 | **ALIGNED** |
| `revenue_inc_vat_7d`, `_30d` | Required | ✓ Line 170-171 | **ALIGNED** |
| `sessions_30d` | Nullable | ✓ Line 172 | **ALIGNED** |
| `conversion_rate_30d` | Nullable | ✓ Line 173 | **ALIGNED** |
| `sales_velocity_units_per_day_30d` | Required | ✓ Line 174 | **ALIGNED** |
| `available_quantity` | Required | ✓ Line 177 | **ALIGNED** |
| `days_of_cover` | Nullable | ✓ Line 178 | **ALIGNED** |
| `lead_time_days` | Nullable | Hardcoded 14 | **PARTIAL** |
| `stockout_risk` | ENUM | ✓ Line 180 | **ALIGNED** |
| `buy_box_status` | WON/LOST/UNKNOWN | ✓ Line 183 | **ALIGNED** |
| `buy_box_percentage_30d` | Nullable | ✓ Line 184 | **ALIGNED** |
| `buy_box_risk` | LOW/MED/HIGH/UNKNOWN | ✓ Line 185 | **ALIGNED** |
| `competitor_price_position` | ENUM | ✓ Line 186 | **ALIGNED** |
| `keepa_*` fields | 7 fields | ✓ Line 189 | **ALIGNED** |
| `sales_anomaly_score` | Required | ✓ Line 192 (returns 0) | **PARTIAL** |
| `conversion_anomaly_score` | Nullable | ✓ Line 193 (null) | **ALIGNED** |
| `buy_box_anomaly_score` | Nullable | ✓ Line 194 (null) | **ALIGNED** |

---

## 4. Publish Payload Verification

### 4.1 Price Publish (DATA_CONTRACTS.md §5.1)

| Field | Contract | Implementation | Status |
|-------|----------|----------------|--------|
| `price_inc_vat` | Required | ✓ `v2.routes.js:532` | **ALIGNED** |
| `reason` | Required | ✓ `v2.routes.js:538-540` | **ALIGNED** |
| `correlation_id` | Optional | ✓ `v2.routes.js:532` | **ALIGNED** |

**Validation:** Returns 400 if missing — **ALIGNED**

### 4.2 Stock Publish (DATA_CONTRACTS.md §5.2)

| Field | Contract | Implementation | Status |
|-------|----------|----------------|--------|
| `available_quantity` | Required | ✓ `v2.routes.js:760` | **ALIGNED** |
| `reason` | Required | ✓ `v2.routes.js:766-768` | **ALIGNED** |

**Validation:** Returns 400 if missing — **ALIGNED**

### 4.3 Publish Response (DATA_CONTRACTS.md §5.3)

| Field | Contract | Implementation | Status |
|-------|----------|----------------|--------|
| `job_id` | Required | ✓ `v2.routes.js:616` | **ALIGNED** |
| `status` | 'PENDING' | ✓ `v2.routes.js:617` | **ALIGNED** |
| `listing_id` | Required | ✓ `v2.routes.js:618` | **ALIGNED** |
| `listing_event_id` | Required | ✓ `v2.routes.js:619` | **ALIGNED** |

---

## 5. ASIN / Listing Canonical IDs

### 5.1 Endpoint ID Usage

| Endpoint Pattern | Contract | Implementation | Status |
|------------------|----------|----------------|--------|
| `/api/v2/asins/{id}` | Uses `asin_entity_id` | ✓ `v2.routes.js:1032` | **ALIGNED** |
| `/api/v2/listings/{listingId}` | Uses `listing.id` | ✓ Throughout | **ALIGNED** |

### 5.2 ASIN Entity Canonical Table

| Requirement | Contract | Implementation | Status |
|-------------|----------|----------------|--------|
| `asin_entities` is canonical | Yes | ✓ `003_slice_c_schema.sql` | **ALIGNED** |
| Research pool references it | Yes | ✓ Uses `asin_entity_id` | **ALIGNED** |
| Unique `(asin, marketplace_id)` | Yes | ✓ | **ALIGNED** |

---

## 6. BOM Invariants (DATA_CONTRACTS.md §7)

### 6.1 Versioning

| Invariant | Contract | Implementation | Status |
|-----------|----------|----------------|--------|
| Versions start at 1 | Yes | ✓ `001_slice_a_schema.sql:91` | **ALIGNED** |
| Version unique per listing | Yes | ✓ Line 100 | **ALIGNED** |
| Immutable once created | Yes | No code prevents edits | **PARTIAL** |

### 6.2 One Active BOM

| Invariant | Contract | Implementation | Status |
|-----------|----------|----------------|--------|
| Partial unique index | `WHERE is_active=true` | ✓ `001_slice_a_schema.sql:104-106` | **ALIGNED** |
| Atomic activation | Transaction | ✓ `v2.routes.js` BOM endpoints | **ALIGNED** |

### 6.3 Line Updates

| Invariant | Contract | Implementation | Status |
|-----------|----------|----------------|--------|
| Atomic replacement | PUT replaces all | ✓ `v2.routes.js` PUT BOM lines | **ALIGNED** |
| Quantity > 0 | Check constraint | ✓ `001_slice_a_schema.sql:119` | **ALIGNED** |
| Wastage 0..1 | Check constraint | ✓ Line 120 | **ALIGNED** |

---

## 7. Guardrails Enforcement (DATA_CONTRACTS.md §11)

### 7.1 Server-Side Re-Computation

| Rule | Contract | Implementation | Status |
|------|----------|----------------|--------|
| Publish re-checks | Never trust UI | ✓ `v2.routes.js:548-579` | **ALIGNED** |
| Returns 400 on violation | Yes | ✓ Line 581-586 | **ALIGNED** |

### 7.2 Guardrails Response Format

| Field | Contract | Implementation | Status |
|-------|----------|----------------|--------|
| `passed` | boolean | ✓ `guardrails.service.js:146` | **ALIGNED** |
| `violations[]` | Array | ✓ | **ALIGNED** |
| `violations[].rule` | string | ✓ Line 106 | **ALIGNED** |
| `violations[].threshold` | number | ✓ Line 107 | **ALIGNED** |
| `violations[].actual` | number | ✓ Line 108 | **ALIGNED** |
| `violations[].message` | string | ✓ Line 109 | **ALIGNED** |

---

## 8. Snapshot Storage (DATA_CONTRACTS.md §8)

### 8.1 Keepa Snapshots

| Column | Contract | Implementation | Status |
|--------|----------|----------------|--------|
| `raw_json` | JSONB | ✓ `003_slice_c_schema.sql` | **ALIGNED** |
| `parsed_json` | JSONB | ✓ | **ALIGNED** |
| `captured_at` | TIMESTAMP | ✓ | **ALIGNED** |
| NO `features` column | Features → feature_store | ✓ | **ALIGNED** |

### 8.2 listing_offer_current

| Column | Contract | Implementation | Status |
|--------|----------|----------------|--------|
| `buy_box_status` | ENUM | ✓ `002_slice_b_schema.sql` | **ALIGNED** |
| `buy_box_percentage_30d` | Nullable NUMERIC | ✓ | **ALIGNED** |

---

## 9. Divergence Summary

### 9.1 Fully Aligned

- Economics DTO fields and calculations
- VAT semantics throughout
- Publish payload contracts
- Guardrails enforcement flow
- ASIN/Listing canonical IDs
- BOM one-active constraint
- Feature store schema
- Snapshot storage (no features on snapshots)

### 9.2 Partially Aligned

| Item | Issue | Severity | Remediation |
|------|-------|----------|-------------|
| `fee_snapshot_id` | Always returns null | **P2** | Implement fee snapshot storage |
| `lead_time_days` | Hardcoded to 14 | **P2** | Derive from BOM component max lead time |
| `sales_anomaly_score` | Always returns 0 | **P2** | Implement anomaly detection logic |
| BOM immutability | No code enforcement | **P1** | Add check in BOM update endpoints |

### 9.3 Misaligned

**None identified** — All major contracts are implemented correctly.

---

## 10. Verdict

| Category | Status |
|----------|--------|
| Economics DTO | **PASS** |
| VAT Semantics | **PASS** |
| Publish Contracts | **PASS** |
| Feature Store | **PASS** (with P2 gaps) |
| Guardrails | **PASS** |
| BOM Invariants | **PASS** (with P1 gap) |
| ASIN/Listing IDs | **PASS** |
| Overall | **PASS** with minor gaps |

**Recommendation:** Address P1 BOM immutability enforcement before wider use.
