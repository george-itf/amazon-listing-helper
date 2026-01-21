\# CLAUDE CODE WORK ORDER — Remediation \+ Hardening Pass (Post-Slice A–E)

\#\# Context  
You have already implemented Slice A–E (economics/BOM, jobs \+ publish, snapshots \+ feature store, recommendations, ASIN analyzer). This task is a remediation \+ hardening pass to make the system:  
\- runnable without startup crashes,  
\- economically trustworthy (VAT semantics),  
\- strictly layered (snapshots → features → UI \+ recs),  
\- Buy Box-aware in a real way,  
\- Keepa-embedded and evidence-backed,  
\- ready to safely freeze/deprecate /api/v1.

\#\# Scope  
Product correctness and operational coherence only.  
Ignore security improvements beyond the explicit CredentialsProvider usage requirement (do not redesign secrets storage). No “new big features” outside what’s listed.

\#\# Non-negotiable rules  
1\) Do not change semantics defined in \`DATA\_CONTRACTS.md\`. If you must change a DTO, bump version explicitly and update docs \+ tests.  
2\) No economics/profit computation in UI or in random route handlers. All economics derives from \`economics.service.js\`.  
3\) No recommendations reading raw snapshots directly. Recs must read from \`feature\_store\` only.  
4\) No long-running Keepa/Amazon calls in HTTP handlers. Only jobs.  
5\) Jobs must be idempotent for ingestion \+ feature computation \+ recommendation generation.  
6\) Provide PR-sized commits and keep changes reversible.

\---

\# Phase 1 — P0 Fixes (Must pass before anything else)

\#\# 1.1 Fix Fastify startup crash: duplicate route registration  
Problem: \`POST /api/v2/listings/:listingId/price/preview\` is registered twice in \`src/routes/v2.routes.js\`.  
Action:  
\- Consolidate to ONE route. It must return a combined payload:  
  \- economics preview (per EconomicsDTO contract)  
  \- guardrails result (violations \+ pass/fail)  
  \- any competitor/buybox signals if available, else null with explicit reason  
\- Delete the duplicate registration.

Acceptance:  
\- Server starts successfully.  
\- \`npm start\` (or repo run command) does not throw "route already declared" or similar.

Deliverables:  
\- Update \`src/routes/v2.routes.js\` to a single \`/price/preview\` implementation.  
\- Update any UI code calling the preview endpoint if needed.

\#\# 1.2 Fix unit tests failing due to export mismatch in economics  
Problem: tests import named exports like \`calculateAmazonFeesExVat\` that are not exported.  
Action:  
\- Decide and implement ONE of:  
  A) Export helper functions as named exports from \`economics.service.js\`, OR  
  B) Change tests to import default export and destructure helpers (only if helpers are intentionally non-public).  
Preferred: A) (named exports) to keep economics logic testable and stable.

Acceptance:  
\- \`npm test\` passes for economics tests.  
\- Add/retain explicit tests that validate VAT-inc vs VAT-ex semantics with the known example:  
  \- price\_inc\_vat=24.00, vat\_rate=0.20 \-\> price\_ex\_vat=20.00  
  \- bom=6.00 ship=2.00 pack=0.50 fees=3.00  
  \- profit=8.50, margin=0.425

Deliverables:  
\- Fix \`economics.service.js\` exports and update test imports accordingly.  
\- Ensure tests run with a single command.

\#\# 1.3 Enforce CredentialsProvider for all production-reachable code paths  
Problem: repo still has direct reads of \`credentials.json\` across legacy modules.  
Action:  
\- Any code that can run in production for v2/jobs/services must use \`CredentialsProvider\` only.  
\- Legacy v1 modules may read JSON only if fully gated behind a feature flag that is OFF in v2 mode.  
\- Create a single \`getCredentials()\` interface used by:  
  \- keepa.service  
  \- amazon ingestion worker(s)  
  \- publish worker(s)

Acceptance:  
\- \`grep \-R "credentials.json" main/app/src\` returns only:  
  \- \`credentials-provider.js\` (and optionally legacy modules explicitly marked legacy and disabled by flags).  
\- All v2 endpoints and all worker code use the provider.

Deliverables:  
\- Refactor services/workers to obtain credentials via provider.  
\- Add a small test or runtime check that throws a clear error if v2 jobs run without required creds (but do not block local dev if mock mode is enabled).

\---

\# Phase 2 — Strict Layering Enforcement (Stop Drift)

\#\# 2.1 Add a codebase-wide “no bypass” policy and enforce it  
Action:  
\- Remove/disable any remaining economics calculations outside \`economics.service.js\`.  
\- Remove/disable any routes that compute profit/margin ad-hoc.  
\- Ensure UI never computes profit/margin. UI must display values returned from v2 endpoints.

Acceptance:  
\- \`grep \-R "calculateMargin|calculateProfit|profit \=" main/web\` shows no client-side economics calculations (except display formatting).  
\- Any derived values come from backend DTOs.

Deliverables:  
\- Introduce a single backend endpoint \`GET /api/v2/listings/:listingId/summary\` or similar that returns:  
  \- economics summary fields  
  \- offer current fields (buy box status, price)  
  \- stock fields  
  \- feature freshness timestamp  
  (If you already have equivalent endpoints, use them—do not invent a new duplicate.)

\#\# 2.2 Ensure recommendations read from feature\_store only  
Action:  
\- Refactor \`recommendation.service.js\` (and any rec generation jobs) so they:  
  \- load features from \`feature\_store\`  
  \- never parse keepa\_snapshots directly  
  \- never call Keepa/Amazon directly

Acceptance:  
\- Grep check: \`recommendation.service.js\` does not import keepa service or read keepa\_snapshots table.  
\- Each recommendation includes an evidence payload that references specific feature keys and includes computed timestamps.

Deliverables:  
\- Update recommendation evidence JSON structure to include:  
  \- \`feature\_version\`  
  \- \`computed\_at\`  
  \- \`source\_features: { key: value }\` with only the keys used

\---

\# Phase 3 — Buy Box: Make it Real (Contract \+ Pipeline)

\#\# 3.1 Define Buy Box ingestion behaviour explicitly  
Action:  
\- Update \`DATA\_CONTRACTS.md\` (only if missing) with:  
  \- Which Buy Box signals are supported today:  
    \- \`buy\_box\_status\` (WON/LOST/UNKNOWN) required  
    \- \`buy\_box\_percentage\_30d\` optional if not reliably obtainable  
  \- Nullability rules and how recs degrade when unknown.

Acceptance:  
\- \`DATA\_CONTRACTS.md\` clearly defines buy box fields and missing-data behaviour.

\#\# 3.2 Implement Buy Box signal population in ingestion pipeline  
Action:  
\- In Amazon ingestion job(s), populate at least:  
  \- \`listing\_offer\_current.buy\_box\_status\` (WON/LOST/UNKNOWN)  
  \- \`listing\_offer\_current.buy\_box\_price\_inc\_vat\` if retrievable or inferable  
  \- \`listing\_offer\_current.competitor\_lowest\_price\_inc\_vat\` if available  
\- If full Buy Box % cannot be retrieved, implement UNKNOWN \+ reason and do NOT fabricate.  
\- Ensure feature computation reads offer\_current and outputs:  
  \- \`buy\_box\_status\`  
  \- \`buy\_box\_gap\_inc\_vat\` (competitor\_lowest \- our\_price, nullable)  
  \- \`buy\_box\_risk\` (LOW/MED/HIGH) with explicit rules

Acceptance:  
\- After running ingestion \+ feature compute, feature\_store contains buy box fields for listings (or UNKNOWN with reason).  
\- Buy Box pricing recommendations are only generated when required signals exist; otherwise rec is suppressed or replaced with “missing data” observation.

Deliverables:  
\- Update ingestion jobs \+ feature-store computation logic accordingly.  
\- Add tests (or fixtures) that verify UNKNOWN behaviour and no bogus recommendations.

\---

\# Phase 4 — Keepa “Embedded Throughout” (Evidence & UX)

\#\# 4.1 Ensure Keepa snapshots are stored properly and features computed cleanly  
Action:  
\- Confirm \`keepa\_snapshots\` stores \`raw\_json\`, \`parsed\_json\`, \`captured\_at\`.  
\- Compute Keepa-derived features into feature\_store only:  
  \- price band (median, p25/p75)  
  \- volatility metric  
  \- offers count trend proxy  
  \- sales rank trend proxy if available

Acceptance:  
\- Feature store contains Keepa-derived feature keys used by UI and recs.  
\- No UI or rec reads raw keepa snapshots directly.

\#\# 4.2 UI embedding requirements (minimum viable, not perfect UI)  
Action:  
\- Listing detail view must show:  
  \- Keepa price band summary (numbers \+ last updated timestamp)  
  \- offers trend summary  
  \- volatility indicator  
\- Recommendations cards must show:  
  \- “Why” section with exact Keepa/Amazon numbers used

Acceptance:  
\- For a listing with keepa features available, the listing page displays keepa summary and timestamps.  
\- Recommendation card includes evidence values and “computed\_at”.

Deliverables:  
\- Update \`main/web/extra.js\` and relevant HTML sections to render these fields.  
\- Keep changes minimal and consistent with existing UI patterns.

\---

\# Phase 5 — Feature Freshness & Job Idempotency

\#\# 5.1 Surface freshness everywhere  
Action:  
\- Every listing summary and ASIN analyzer output must include:  
  \- feature\_store \`computed\_at\`  
  \- keepa snapshot \`captured\_at\` (if present)  
  \- offer\_current \`updated\_at\`

Acceptance:  
\- UI displays “Computed X minutes ago” or equivalent on listing detail and ASIN analyzer.  
\- If stale beyond threshold (define thresholds), show warning badge.

\#\# 5.2 Idempotency checks and fixes  
Action:  
\- Ensure:  
  \- multiple Keepa sync runs append snapshots without corruption  
  \- feature computation overwrites the latest feature row deterministically (or versions it), without duplicates that break queries  
  \- recommendation generation does not spam duplicates; use suppression rules:  
    \- do not regenerate identical rec if rejected within N days  
    \- update existing rec if still relevant, or create a new rec only when materially different

Acceptance:  
\- Running ingestion+compute+recs twice does not create duplicate “active” recs for the same issue.  
\- Feature\_store query used by UI returns exactly one “current” feature set per entity.

Deliverables:  
\- Add unique constraints or “upsert” strategy for current feature row:  
  \- either maintain \`feature\_version\` and select latest  
  \- or maintain a \`is\_current\` flag with constraints  
\- Implement recommendation dedupe logic.

\---

\# Phase 6 — Freeze v1 and prepare for deprecation

\#\# 6.1 Add feature flag to disable /api/v1  
Action:  
\- Add env var \`DISABLE\_V1=true\` support.  
\- When enabled, \`/api/v1/\*\` routes are not registered (or return 410 with a clear message).  
\- Ensure v2-only mode is a first-class path.

Acceptance:  
\- App runs with v2-only endpoints.  
\- UI uses v2 endpoints for all core workflows (listings, economics, preview/publish, recs, asins).

Deliverables:  
\- Implement flag check in \`server.js\` route registration.  
\- Update README with run modes:  
  \- legacy mode  
  \- v2-only mode

\#\# 6.2 Route-by-route mapping completion  
Action:  
\- Update \`DEPRECATION\_PLAN.md\` with a table:  
  \- v1 endpoint  
  \- v2 replacement  
  \- slice/gate removal  
  \- status: migrated / pending / remove now  
\- Include at least:  
  \- listings  
  \- profit/costs  
  \- bom/components/suppliers  
  \- keepa  
  \- sync  
  \- changes/push  
  \- ai recommendations  
  \- generator

Acceptance:  
\- Mapping exists and covers core routes.  
\- No vague “core routes” language.

\---

\# Phase 7 — Final Deliverables & Verification

\#\# 7.1 Produce verification report files  
Create/update:  
\- \`POST\_REMEDIATION\_REPORT.md\` including:  
  \- what was fixed  
  \- how to run tests  
  \- how to run in v2-only mode  
  \- known limitations (e.g., buy box % not available)

\#\# 7.2 Provide commands to verify everything  
Ensure repo supports:  
\- \`npm ci && npm test\`  
\- \`npm run dev\` (or equivalent)  
\- optional docker-compose if present

\---

\# Execution format  
\- Work in commits in this order:  
  1\) P0 route duplication fix  
  2\) economics exports/tests fix  
  3\) CredentialsProvider enforcement  
  4\) strict layering (no bypass)  
  5\) buy box ingestion \+ features \+ rec gating  
  6\) keepa embedding \+ evidence improvements  
  7\) freshness \+ idempotency \+ rec dedupe  
  8\) v1 freeze feature flag \+ deprecation mapping \+ docs

Each commit message must include:  
\- what changed  
\- how to test

STOP AFTER PHASE 1 and request approval if any “SPEC ambiguity” is encountered. Otherwise continue to completion.

\---

\# Definition of Done  
This work order is complete when:  
\- Server starts without route conflicts.  
\- Economics tests pass and match VAT semantics.  
\- CredentialsProvider is the only credential access path for v2/jobs.  
\- Recs read feature\_store only and include traceable evidence \+ timestamps.  
\- Buy Box status is populated (or UNKNOWN with reason) and recs degrade gracefully.  
\- Keepa summary is visible in listing detail and used in evidence.  
\- Jobs are idempotent; recs do not spam duplicates.  
\- \`/api/v1\` can be disabled via flag and v2-only mode works.  
\- Deprecation plan contains full route-by-route mapping.

## **ADDENDUM — REQUIRED BY CLAUDE’S OWN ANALYSIS (NOT OPTIONAL)**

The following requirements **must be implemented** in addition to the work above. They are derived directly from Claude’s verification documents and are mandatory.

---

## **ADDENDUM A — Pending Job Deduplication (P1-002)**

**Problem:**  
 `POST /price/publish` and `POST /stock/publish` currently create duplicate PENDING jobs if called twice with identical payloads.

**Required Change:**  
 Before creating a job:

* Check for an existing `PENDING` job with:

  * same `listing_id`

  * same `job_type`

  * same `input_json` (price\_inc\_vat or available\_quantity)

* If found:

  * return HTTP 409

  * include `existing_job_id`

**Acceptance:**

* Duplicate publish attempts do not create duplicate jobs.

* Worker queue remains minimal.

---

## **ADDENDUM B — Recommendation Generation Locking (P1-003)**

**Problem:**  
 Concurrent recommendation generation can produce duplicate recommendations.

**Required Change:**

* Use PostgreSQL advisory locks keyed on `(entity_type, entity_id)` during recommendation generation.

* Lock must span:

  * supersede old recommendations

  * generate new recommendations

**Acceptance:**

* Concurrent rec jobs produce one consistent rec set.

---

## **ADDENDUM C — BOM Immutability Enforcement (P1-001)**

**Problem:**  
 Older BOM versions can still be edited.

**Required Change:**

* Reject edits to BOMs where `is_active = false`.

* Only allow:

  * creation of a new BOM version

  * activation of the new version

**Acceptance:**

* Historical BOMs are immutable.

* Audit integrity preserved.

---

## **ADDENDUM D — Feature Store Duplicate Suppression (P2-004)**

**Problem:**  
 Feature computation appends identical rows repeatedly.

**Required Change:**

* Before inserting new feature\_store row:

  * Compare hash of `features_json` to latest row

  * Skip insert if unchanged

**Acceptance:**

* Re-running feature computation without changes does not grow table.

---

## **ADDENDUM E — Feature Recompute Triggers (P2-007)**

**Problem:**  
 Feature store is not recomputed after price/stock changes.

**Required Change:**

* After successful price or stock publish:

  * enqueue `COMPUTE_FEATURES_LISTING` job for that listing

**Acceptance:**

* Features reflect latest state after any publish.

---

## **ADDENDUM F — Economics Caching via Feature Store (P2-005)**

**Problem:**  
 Economics display recalculates directly instead of using feature\_store.

**Required Change:**

* Cache economics results into feature\_store

* Listing summary endpoints must read economics from feature\_store where available

**Acceptance:**

* One consistent economics view across UI, recs, and ASIN analyzer.

---

## **ADDENDUM G — Lead Time Derivation (P2-002)**

**Problem:**  
 `lead_time_days` is hardcoded.

**Required Change:**

* Derive `lead_time_days` as `MAX(components.lead_time_days)` for active BOM

* Null if no BOM or no component lead times

**Acceptance:**

* Stockout risk and guardrails reflect real supply lead time.

---

## **ADDENDUM H — Anomaly Score Placeholders (P2-003)**

**Problem:**  
 `sales_anomaly_score` always returns 0\.

**Required Change:**

* Implement basic statistical anomaly detection:

  * rolling mean \+ standard deviation

  * z-score thresholding

* Persist result into feature\_store

**Acceptance:**

* Non-zero anomaly scores appear for real deviations.

---

## **ADDENDUM I — Feature Store Retention Policy (P3-002)**

**Problem:**  
 feature\_store grows unbounded.

**Required Change:**

* Add scheduled cleanup job:

  * retain latest row per entity

  * retain historical rows up to N days (configurable)

**Acceptance:**

* feature\_store remains bounded.

---

## **ADDENDUM J — Test Framework Hardening**

**Problem:**  
 Tests are manual scripts; no integration coverage.

**Required Change:**

* Introduce a test runner (jest or equivalent)

* Add integration tests for:

  * job lifecycle

  * publish flow

  * recommendation generation

  * ASIN conversion

**Acceptance:**

* One command runs unit \+ integration tests.

* CI-ready.

---

## **ADDENDUM K — Worker Execution Model**

**Problem:**  
 `job-worker.js` is not auto-started.

**Required Change:**

* Document and/or implement:

  * separate worker process

  * or integrated worker loop (flag-controlled)

* Update README accordingly.

**Acceptance:**

* Jobs are processed in all supported run modes.

---

## **FINAL STOP CONDITION**

Do not proceed past any phase if:

* tests fail,

* DTO contracts diverge,

* economics values mismatch SPEC examples,

* or duplicate jobs/recs/features are observed.

Pause, report, and request approval.

---

### **This document is the authoritative execution contract.**

### **Claude Code must follow it verbatim.**

### **No interpretation, no shortcuts, no silent changes.**

