\# CLAUDE WORK ORDER — Amazon Ops Platform Build \+ Cleanup (FBM / Buy Box / VAT Rules)  
Owner: George    
Date: 2026-01-20    
Primary Target: Implement the product described in \`SPEC.md\` and enforce the cleanup/rebuild policy in \`CLEANUP\_ADDENDUM.md\`.    
Operating Context: FBM, Buy Box-sensitive, Price shown VAT-inc, Profit/Costs VAT-ex.

\---

\#\# 0\) Golden Rules (Absolute)  
1\) \*\*Do not remove or break existing production-critical functionality\*\* until the replacement is implemented, validated, and cut over.  
2\) \*\*All new stable work goes under \`/api/v2\`\*\*. \`/api/v1\` is legacy and will be deprecated gradually.  
3\) \*\*No economics or derived metric calculations in UI\*\*. UI must consume backend computed values.  
4\) \*\*All sync/publish operations are jobs\*\* with DB-stored state and logs. No long-running sync in HTTP request handlers.  
5\) \*\*Recommendations are structured\*\*: type \+ action payload \+ evidence \+ guardrails \+ impact \+ confidence \+ lifecycle (Accept/Reject/Snooze).  
6\) \*\*Single source of truth\*\*: snapshots → features → UI/recommendations. No bespoke logic per page.  
7\) \*\*Aggressive simplification is required\*\*, but only via the deprecation gates defined below.

\---

\#\# 1\) Required Repo Artifacts to Create (First)  
Create these files in repo root:  
\- \`SPEC.md\` (paste the full spec pack)  
\- \`CLEANUP\_ADDENDUM.md\` (paste the cleanup/deprecation policy)  
\- \`CLAUDE\_WORK\_ORDER.md\` (this file)

If any already exist, update them to match these versions.

\---

\#\# 2\) Phase 0 — Audit and Plan (Must Complete Before Major Changes)

\#\#\# 2.1 Deliverable: ARCHITECTURE\_AUDIT.md  
Create \`ARCHITECTURE\_AUDIT.md\` containing:

\*\*A) System inventory\*\*  
\- Backend: list modules, key services, routes, and files that implement:  
  \- listings  
  \- keepa sync  
  \- amazon integration  
  \- pricing/stock updates  
  \- scoring/recommendations  
  \- tasks/automation  
\- Frontend: list pages/sections, key JS modules, how state is handled  
\- DB: list all tables and how they map to the product  
\- File-based state: list all JSON files used at runtime and what they store

\*\*B) Redundancy map\*\*  
For each workflow, show how many ways it is implemented:  
\- listing CRUD  
\- economics/profit calculation  
\- keepa ingestion  
\- amazon ingestion  
\- publish price/stock  
\- scoring/recommendations  
Flag duplicates explicitly.

\*\*C) Quality classification\*\*  
For each subsystem mark: KEEP / REMOVE / REBUILD using the criteria in \`CLEANUP\_ADDENDUM.md\`.

\*\*D) Proposed cutover strategy\*\*  
\- What remains in \`/api/v1\` temporarily  
\- What is rebuilt in \`/api/v2\`  
\- How data migrates

\#\#\# 2.2 Deliverable: DEPRECATION\_PLAN.md  
Create \`DEPRECATION\_PLAN.md\` including:  
\- Step-by-step deprecation sequence aligned to the build slices  
\- Migration scripts needed  
\- Feature flags or route prefix strategy to run old+new concurrently  
\- Rollback plan per step (git revert \+ DB migration notes)

\*\*STOP CONDITION:\*\* Do not begin deleting anything until both files are created.

\---

\#\# 3\) Phase 1 — Foundation Slice A (BOM \+ Economics Backbone)  
Goal: Deterministic unit economics with VAT semantics enforced across platform.

\#\#\# 3.1 Database migrations  
Implement the schema from \`SPEC.md\`:  
\- marketplaces  
\- listings  
\- listing\_offer\_current  
\- listing\_sales\_daily  
\- components  
\- boms  
\- bom\_lines  
\- listing\_cost\_overrides  
\- fee\_snapshots  
\- keepa\_snapshots  
\- amazon\_catalog\_snapshots  
\- asin\_entities  
\- feature\_store (or listing\_features \+ asin\_features)  
\- recommendations  
\- recommendation\_events  
\- listing\_events  
\- jobs

Migrations must be:  
\- idempotent  
\- safe on empty and existing DB  
\- include indexes and constraints

\#\#\# 3.2 Economics service (backend)  
Implement a dedicated service:  
\- Inputs: listing\_id (and optional scenario overrides)  
\- Output: full breakdown \+ derived fields:  
  \- price\_inc\_vat, price\_ex\_vat  
  \- bom\_cost\_ex\_vat  
  \- shipping\_cost\_ex\_vat  
  \- packaging\_cost\_ex\_vat  
  \- amazon\_fees\_ex\_vat  
  \- profit\_ex\_vat  
  \- margin  
  \- break\_even\_price\_inc\_vat

\*\*No UI calculations.\*\* UI receives these values from API.

\#\#\# 3.3 Components system  
Implement \`/api/v2/components\`:  
\- CRUD  
\- CSV import endpoint  
\- validation and error reporting

\#\#\# 3.4 BOM system  
Implement:  
\- Listing BOM versioning  
\- Active BOM per listing  
\- Atomic update of bom\_lines

Endpoints required (see \`SPEC.md\`):  
\- \`GET /api/v2/listings/{id}/bom\`  
\- \`POST /api/v2/listings/{id}/bom\` (create new version)  
\- \`PUT /api/v2/boms/{bom\_id}/lines\`

\#\#\# 3.5 Tests (mandatory)  
Implement unit tests for:  
\- VAT conversion  
\- profit and margin formula  
\- break-even calculation  
\- rounding policy

\*\*Acceptance example must pass\*\*:  
price\_inc\_vat=24.00, vat\_rate=0.20 → price\_ex\_vat=20.00    
bom=6.00, ship=2.00, pack=0.50, fees=3.00    
profit=8.50, margin=0.425

\#\#\# 3.6 UI updates (minimum)  
Update UI to show in listing table and listing detail:  
\- Unit Cost (VAT ex)  
\- Profit/Unit (VAT ex)  
\- Margin %

Use \`/api/v2\` endpoints only for these computed fields.

\*\*Definition of done for Slice A\*\*  
\- Components \+ BOM versioning works  
\- Economics computed server-side and displayed correctly  
\- Tests pass

\---

\#\# 4\) Phase 2 — Slice B (Edit Price & Stock with Job Lifecycle)  
Goal: Portal control of price and stock, with guardrails, jobs, and audit history.

\#\#\# 4.1 Guardrails settings  
Implement guardrails configuration:  
\- min\_margin  
\- max\_price\_change\_pct\_per\_day  
\- min\_days\_of\_cover\_before\_price\_change  
\- min\_stock\_threshold  
Store in DB (settings table or dedicated table), and expose via \`/api/v2/settings\`.

\#\#\# 4.2 Preview endpoints  
Implement:  
\- \`POST /api/v2/listings/{id}/price/preview\`  
\- \`POST /api/v2/listings/{id}/stock/preview\`

These must return:  
\- economics after change  
\- guardrails pass/fail with reasons  
\- competitor band positioning if Keepa features exist (else mark missing)

\#\#\# 4.3 Publish endpoints (create jobs)  
Implement:  
\- \`POST /api/v2/listings/{id}/price/publish\`  
\- \`POST /api/v2/listings/{id}/stock/publish\`

They must:  
\- validate input  
\- store a listing\_event (drafted)  
\- create a job (PUBLISH\_PRICE\_CHANGE / PUBLISH\_STOCK\_CHANGE)  
\- return job id

\#\#\# 4.4 Worker execution  
Implement worker handling for publish jobs:  
\- execute Amazon API calls (or stub with clear TODO if API integration not ready)  
\- update listing\_offer\_current on success  
\- create listing\_event (published)  
\- job status SUCCEEDED or FAILED with log\_json

\#\#\# 4.5 UI  
\- Add Edit Price modal with preview \-\> publish  
\- Add Edit Stock modal with preview \-\> publish  
\- Show job status and history timeline

\*\*Definition of done for Slice B\*\*  
\- Preview shows guardrails and updated economics  
\- Publish creates job and records history  
\- Job success/failure visible and stored

\---

\#\# 5\) Phase 3 — Slice C (Enrichment \+ Snapshots \+ Feature Store)  
Goal: Make data “poolable” and reusable everywhere.

\#\#\# 5.1 Keepa ingestion  
\- Implement job \`SYNC\_KEEPA\_ASIN\`  
\- Store raw and parsed snapshots in keepa\_snapshots  
\- Implement on-demand Keepa sync for ASIN Analyzer and scheduled sync for listings

\#\#\# 5.2 Amazon ingestion (minimum viable)  
Implement jobs:  
\- \`SYNC\_AMAZON\_OFFER\` (price/qty/buy box proxy)  
\- \`SYNC\_AMAZON\_SALES\` (daily sales/revenue; sessions if accessible)  
\- \`SYNC\_AMAZON\_CATALOG\`

Store raw and parsed snapshots.

\#\#\# 5.3 Feature computation  
Implement jobs:  
\- COMPUTE\_FEATURES\_LISTING  
\- COMPUTE\_FEATURES\_ASIN

Compute and store required features JSON (see \`SPEC.md\` §8).    
Ensure downstream systems (dashboard, recs, ASIN analyzer) read from feature store.

\*\*Definition of done for Slice C\*\*  
\- Snapshots exist  
\- Feature store rows exist  
\- UI uses feature store outputs

\---

\#\# 6\) Phase 4 — Slice D (Recommendations v1: rules \+ anomalies)  
Goal: Make recommendations real, structured, and useful.

\#\#\# 6.1 Recommendation generation  
Implement:  
\- GENERATE\_RECOMMENDATIONS\_LISTING  
\- GENERATE\_RECOMMENDATIONS\_ASIN

At minimum implement types:  
\- PRICE\_DECREASE\_REGAIN\_BUYBOX  
\- STOCK\_INCREASE\_STOCKOUT\_RISK  
\- MARGIN\_AT\_RISK\_COMPONENT\_COST  
\- ANOMALY\_SALES\_DROP  
\- OPPORTUNITY\_CREATE\_LISTING (for ASIN pool)

Each recommendation must include:  
\- action\_payload\_json  
\- evidence\_json  
\- guardrails\_json  
\- impact\_json  
\- confidence band

\#\#\# 6.2 Recommendation lifecycle endpoints  
Implement:  
\- \`GET /api/v2/recommendations\`  
\- accept/reject/snooze endpoints  
Store events in recommendation\_events.

\#\#\# 6.3 UI  
\- Recommendations screen with tabs:  
  \- My Listings  
  \- Opportunities  
  \- ASIN Analyzer  
\- Listing detail panel shows primary \+ secondary recommendations

\*\*Definition of done for Slice D\*\*  
\- Recommendations are generated and displayed  
\- Accept/reject/snooze flows work and are logged

\---

\#\# 7\) Phase 5 — Slice E (ASIN Analyzer \+ Research Pool \+ Opportunities)  
Goal: Deep-dive any ASIN and use existing components to cost it and decide.

\#\#\# 7.1 ASIN Analyzer endpoints  
Implement:  
\- \`POST /api/v2/asins/analyze\`  
\- \`GET /api/v2/asins/{asin\_entity\_id}\`  
\- scenario BOM endpoints:  
  \- \`POST /api/v2/asins/{asin\_entity\_id}/bom\`

\#\#\# 7.2 Research Pool  
Implement a UI list of tracked ASINs:  
\- computed opportunity metrics  
\- profitability scenarios based on scenario BOM

\#\#\# 7.3 Convert to listing  
Implement action:  
\- “Convert ASIN to listing”  
\- Requires SKU input (or create placeholder and force edit)  
\- Creates listing, links ASIN, sets status ACTIVE

\*\*Definition of done for Slice E\*\*  
\- Enter ASIN \-\> enrich \-\> features \-\> scenario BOM \-\> profitability \-\> recommendations  
\- Save to research pool works  
\- Convert to listing works

\---

\#\# 8\) Cleanup & Simplification (Continuous, but gated)

\#\#\# 8.1 Mandatory cleanup steps after each slice  
After Slice A–E, perform:  
1\) Identify redundant systems that overlap completed slice  
2\) Mark them in \`DEPRECATION\_PLAN.md\`  
3\) If replacement meets gates, remove redundant code paths

\#\#\# 8.2 Deprecation gates (must satisfy before deletion)  
Before removing any legacy subsystem:  
\- replacement exists in \`/api/v2\`  
\- data migrated/backfilled or explicitly declared unnecessary  
\- tests updated and passing  
\- manual verification checklist completed and documented

\#\#\# 8.3 Scrap/rebuild criteria  
If a subsystem:  
\- is tightly coupled  
\- duplicates logic across UI/back-end  
\- violates the jobs/snapshots/features architecture  
\- makes VAT semantics inconsistent  
Then classify REBUILD and implement clean replacement.

\#\#\# 8.4 Explicit targets likely to be redundant  
(Claude must confirm with audit, then act)  
\- Any UI code calculating profit/margin  
\- Any inline Keepa/Amazon calling inside HTTP handlers  
\- Multiple versions of “scoring”  
\- File-based state that overlaps DB feature store or BOM storage

\---

\#\# 9\) Final Cutover & Legacy Removal  
Once \`/api/v2\` and the new UI flows cover the core workflows:  
\- mark \`/api/v1\` as deprecated in README  
\- remove legacy UI links  
\- optionally remove \`/api/v1\` endpoints after a final verification pass

\---

\#\# 10\) Work Style & Communication  
\- Work in PR-sized commits.  
\- Each commit must have:  
  \- summary  
  \- what changed  
  \- how to test  
\- If blocked, only ask clarifications allowed in \`SPEC.md\` §18.  
\- If uncertain, choose deterministic, testable implementation over cleverness.

\---

\#\# 11\) Verification Checklist (Manual)  
Before declaring completion:  
\- Listings table shows correct VAT-inc price and VAT-ex profit/margin  
\- BOM costs roll up correctly from components  
\- Edit price shows preview with guardrails and posts a publish job  
\- Edit stock does the same  
\- Keepa data appears on listing detail and ASIN analyzer  
\- Recommendations show evidence \+ guardrails \+ impact \+ confidence  
\- Accept/reject/snooze works and is logged  
\- ASIN Analyzer can attach BOM using existing components and compute scenarios  
\- “Convert to listing” creates managed listing  
\- No duplicate subsystems remain for core workflows

\---  
