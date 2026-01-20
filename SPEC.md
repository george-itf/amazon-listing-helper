\# Amazon Ops Platform — Spec Pack for Claude Code  
Version: 1.0    
Owner: George    
Operating Mode: FBM, Buy Box–sensitive, VAT-inclusive selling price, VAT-exclusive costs/profit    
Primary Goal: A single portal that pools Amazon \+ Keepa \+ internal BOM/component cost data to (1) manage live listings, (2) research new products/ASINs, and (3) produce data-backed recommendations with an ML-assisted prioritisation loop.

\---

\#\# 0\) Non-Negotiables (Claude must not deviate)

\#\#\# 0.1 VAT & economics semantics (must be consistent everywhere)  
\- \*\*Displayed listing price\*\* is \*\*VAT-inclusive\*\* (what customers pay).  
\- \*\*All costs and profit\*\* are \*\*VAT-exclusive\*\*:  
  \- BOM component costs  
  \- Shipping  
  \- Packaging  
  \- Amazon fees  
  \- Profit  
  \- Margin %  
\- Revenue presented in dashboards may include VAT (labelled clearly), but \*\*profit/margin analytics are VAT-exclusive\*\*.

\#\#\# 0.2 FBM \+ Buy Box focus  
\- The system is designed for \*\*FBM\*\* operations, where \*\*inventory quantity\*\* and \*\*Buy Box status\*\* materially affect sales.  
\- Buy Box health is a first-class signal and must be embedded throughout UI and recommendations.

\#\#\# 0.3 “No quick calculations in UI”  
\- The UI must not implement “ad hoc” economics or derived metrics.  
\- All derived metrics (profit, margin, days cover, volatility, etc.) must be computed on the backend and served via API.

\#\#\# 0.4 Recommendations must be actionable and justified  
Every recommendation must have:  
\- A \*\*type\*\* (enumerated; no free-form)  
\- A proposed \*\*action payload\*\* (e.g., new price, new stock quantity, reorder qty)  
\- \*\*Evidence\*\* with concrete numbers and time windows  
\- \*\*Guardrails\*\* evaluation (pass/fail with reasons)  
\- \*\*Expected impact\*\* direction \+ confidence band  
\- Lifecycle controls: \*\*Accept / Reject / Snooze\*\*

\#\#\# 0.5 External data ingestion is job-based  
\- Keepa sync, Amazon sync, feature computation, and publishing actions are \*\*jobs\*\* with statuses and logs.  
\- No long-running sync or publish operations occur inline in request/response threads.

\---

\#\# 1\) Outcomes (What “Reality” Looks Like)

\#\#\# 1.1 You can do these daily tasks from the portal:  
1\) See all listings (SKU+marketplace), their:  
   \- price (VAT inc)  
   \- available quantity  
   \- Buy Box status  
   \- units sold (7/30)  
   \- revenue (VAT inc, labelled)  
   \- unit cost (VAT ex)  
   \- profit/unit (VAT ex)  
   \- margin %  
2\) Edit \*\*list price\*\* and \*\*stock quantity\*\* from the portal:  
   \- draft \-\> guardrails \-\> publish job \-\> status \-\> history  
3\) Maintain BOM costs per listing using reusable components you upload:  
   \- components library  
   \- BOM per listing (versioned)  
   \- roll-up economics everywhere  
4\) Enrich listings and ASINs:  
   \- Keepa \+ Amazon snapshots stored  
   \- features computed and stored  
5\) Recommendations panel provides:  
   \- Recommendations for existing listings  
   \- Suggested new listings to create  
   \- ASIN analyzer (enter ASIN and get a deep dive)  
6\) Product research:  
   \- Maintain a research pool of ASINs  
   \- Compare and prioritise based on Keepa \+ economics scenario modelling

\---

\#\# 2\) Canonical Economics Model (Single Source of Truth)

\#\#\# 2.1 Inputs  
\- \`price\_inc\_vat\` (GBP)  
\- \`vat\_rate\` (e.g., 0.20)  
\- \`bom\_cost\_ex\_vat\` (GBP)  
\- \`shipping\_cost\_ex\_vat\` (GBP)  
\- \`packaging\_cost\_ex\_vat\` (GBP)  
\- \`amazon\_fees\_ex\_vat\` (GBP)  
  \- includes referral fee  
  \- includes any per-order fees relevant to FBM if modelled  
  \- if some fees are only available VAT inc, system must convert to VAT ex consistently (documented in fee snapshot).

\#\#\# 2.2 Derived  
\- \`price\_ex\_vat \= price\_inc\_vat / (1 \+ vat\_rate)\`  
\- \`net\_revenue\_ex\_vat \= price\_ex\_vat\`  
\- \`total\_cost\_ex\_vat \= amazon\_fees\_ex\_vat \+ shipping\_cost\_ex\_vat \+ packaging\_cost\_ex\_vat \+ bom\_cost\_ex\_vat\`  
\- \`profit\_ex\_vat \= net\_revenue\_ex\_vat \- total\_cost\_ex\_vat\`  
\- \`margin \= profit\_ex\_vat / net\_revenue\_ex\_vat\` (if net\_revenue\_ex\_vat \> 0\)  
\- \`break\_even\_price\_inc\_vat\` \= price required so \`profit\_ex\_vat \= 0\`, returned as VAT inc.

\#\#\# 2.3 Presentation rules  
\- “Price” in UI defaults to VAT inc (explicit label).  
\- “Profit” “Costs” “Margin” are VAT ex (explicit label).  
\- Revenue can be VAT inc; must be labelled “Revenue (VAT inc)”.

\#\#\# 2.4 Unit tests required  
See §11 for test requirements. Economics must have deterministic tests covering:  
\- VAT conversion  
\- profit/margin calculation  
\- break-even price calculation  
\- rounding rules (GBP: 2 decimals; define rounding policy)

\#\#\# 2.5 Rounding policy (unambiguous)  
\- Store monetary values in DB as integer pence (recommended) OR numeric(12,2). Choose one and apply consistently.  
\- When presenting or applying guardrails, rounding to 2dp occurs at the last possible step.

\---

\#\# 3\) Entity Model & Canonical Keys

\#\#\# 3.1 Canonical identifiers  
\- \*\*Listing\*\*: keyed by \`(seller\_sku, marketplace\_id)\` and optionally linked to \`(asin, marketplace\_id)\`.  
\- \*\*ASIN entity\*\*: keyed by \`(asin, marketplace\_id)\` for research and analysis.  
\- \*\*Marketplace\*\*: use Amazon marketplace IDs or region codes consistently.

\#\#\# 3.2 Core objects  
1\) \*\*Listings\*\* (managed assets)  
2\) \*\*Research ASINs\*\* (unmanaged opportunities)  
3\) \*\*Components\*\* (cost building blocks)  
4\) \*\*BOM\*\* (per listing and per proposed ASIN scenario)  
5\) \*\*Snapshots\*\* (Amazon & Keepa raw \+ parsed)  
6\) \*\*Features\*\* (derived, versioned signal payload)  
7\) \*\*Recommendations\*\* (typed, actionable, lifecycle)  
8\) \*\*Jobs\*\* (sync/publish/compute)

\---

\#\# 4\) Database Schema (Required Tables)

\> Claude must implement the schema below. Optional fields can be added, but required columns must exist.    
\> Naming: snake\_case.    
\> Timestamps: \`created\_at\`, \`updated\_at\` UTC.    
\> All tables should have primary keys and necessary indexes.

\#\#\# 4.1 marketplaces  
\- \`id\` (pk)  
\- \`name\`  
\- \`amazon\_marketplace\_id\` (unique)  
\- \`currency\` (e.g., GBP)  
\- \`vat\_rate\` (e.g., 0.20)  
\- \`created\_at\`, \`updated\_at\`

\#\#\# 4.2 listings  
\- \`id\` (pk)  
\- \`seller\_sku\`  
\- \`marketplace\_id\` (fk)  
\- \`asin\` (nullable)  
\- \`title\` (cached display title)  
\- \`status\` (enum; see §5 workflow)  
\- \`fulfilment\_type\` (enum: FBM only for now; keep extensible)  
\- \`created\_at\`, \`updated\_at\`  
\*\*Unique\*\*: \`(seller\_sku, marketplace\_id)\`

\#\#\# 4.3 listing\_offer\_current (current offer snapshot)  
\- \`listing\_id\` (pk, fk)  
\- \`price\_inc\_vat\` (money)  
\- \`available\_quantity\` (int)  
\- \`buy\_box\_status\` (enum: UNKNOWN, WON, LOST, PARTIAL)  
\- \`buy\_box\_percentage\_30d\` (numeric 0..100, nullable)  
\- \`observed\_at\` (timestamp)  
\- \`created\_at\`, \`updated\_at\`

\#\#\# 4.4 listing\_sales\_daily (time series)  
\- \`id\` (pk)  
\- \`listing\_id\` (fk)  
\- \`date\` (date)  
\- \`units\` (int)  
\- \`revenue\_inc\_vat\` (money)  
\- \`sessions\` (int, nullable)  
\- \`conversion\_rate\` (numeric, nullable)  
\*\*Unique\*\*: \`(listing\_id, date)\`

\#\#\# 4.5 components  
\- \`id\` (pk)  
\- \`component\_sku\` (unique)  
\- \`name\`  
\- \`supplier\` (nullable)  
\- \`unit\_cost\_ex\_vat\` (money)  
\- \`currency\` (e.g., GBP)  
\- \`lead\_time\_days\` (int, nullable)  
\- \`notes\` (text, nullable)  
\- \`created\_at\`, \`updated\_at\`

\#\#\# 4.6 boms (versioned)  
\- \`id\` (pk)  
\- \`scope\_type\` (enum: LISTING, ASIN\_SCENARIO)  
\- \`listing\_id\` (fk nullable; required when LISTING)  
\- \`asin\_entity\_id\` (fk nullable; required when ASIN\_SCENARIO)  
\- \`version\` (int; starts at 1, increments)  
\- \`is\_active\` (bool)  
\- \`effective\_from\` (timestamp)  
\- \`created\_at\`, \`updated\_at\`  
\*\*Constraint\*\*:  
\- Exactly one of \`listing\_id\` or \`asin\_entity\_id\` set (based on scope\_type)  
\- Only one active BOM per listing (enforced by partial unique index)

\#\#\# 4.7 bom\_lines  
\- \`id\` (pk)  
\- \`bom\_id\` (fk)  
\- \`component\_id\` (fk)  
\- \`quantity\` (numeric, default 1\)  
\- \`wastage\_rate\` (numeric 0..1, default 0\)  
\- \`notes\` (text, nullable)  
\- \`created\_at\`, \`updated\_at\`  
\*\*Unique\*\*: \`(bom\_id, component\_id)\` unless you allow duplicate components; if duplicates allowed, remove unique and add line ordering.

\#\#\# 4.8 listing\_cost\_overrides (optional but recommended)  
\- \`listing\_id\` (pk, fk)  
\- \`shipping\_cost\_ex\_vat\` (money, default 0\)  
\- \`packaging\_cost\_ex\_vat\` (money, default 0\)  
\- \`created\_at\`, \`updated\_at\`

\#\#\# 4.9 fee\_snapshots  
\- \`id\` (pk)  
\- \`listing\_id\` (fk)  
\- \`fee\_total\_ex\_vat\` (money)  
\- \`fee\_breakdown\_json\` (jsonb)  // store raw components if available  
\- \`computed\_at\` (timestamp)  
\- \`source\` (enum: AMAZON\_API, ESTIMATE\_TABLE)  
\- \`created\_at\`, \`updated\_at\`

\#\#\# 4.10 keepa\_snapshots  
\- \`id\` (pk)  
\- \`asin\`  
\- \`marketplace\_id\` (fk)  
\- \`raw\_json\` (jsonb)  
\- \`parsed\_json\` (jsonb) // extracted metrics and series summaries  
\- \`captured\_at\` (timestamp)  
\- \`created\_at\`, \`updated\_at\`  
\*\*Index\*\*: \`(asin, marketplace\_id, captured\_at desc)\`

\#\#\# 4.11 amazon\_catalog\_snapshots  
\- \`id\` (pk)  
\- \`asin\`  
\- \`marketplace\_id\` (fk)  
\- \`raw\_json\` (jsonb)  
\- \`parsed\_json\` (jsonb)  
\- \`captured\_at\`  
\- \`created\_at\`, \`updated\_at\`

\#\#\# 4.12 asin\_entities (research \+ analyzer)  
\- \`id\` (pk)  
\- \`asin\`  
\- \`marketplace\_id\` (fk)  
\- \`title\` (nullable)  
\- \`created\_at\`, \`updated\_at\`  
\*\*Unique\*\*: \`(asin, marketplace\_id)\`

\#\#\# 4.13 feature\_store (unified table OR split tables)  
Option A (single table):  
\- \`id\` (pk)  
\- \`entity\_type\` (enum: LISTING, ASIN)  
\- \`entity\_id\` (listing\_id or asin\_entity\_id)  
\- \`feature\_version\` (int)  
\- \`features\_json\` (jsonb)  
\- \`computed\_at\` (timestamp)  
\- \`created\_at\`, \`updated\_at\`  
\*\*Index\*\*: \`(entity\_type, entity\_id, computed\_at desc)\`  
\*\*Constraint\*\*: latest row is current by computed\_at.

Option B (two tables): \`listing\_features\`, \`asin\_features\` with same structure.

\#\#\# 4.14 recommendations  
\- \`id\` (pk)  
\- \`scope\_type\` (enum: LISTING, ASIN)  
\- \`listing\_id\` (fk nullable)  
\- \`asin\_entity\_id\` (fk nullable)  
\- \`type\` (enum; see §8)  
\- \`severity\` (enum: LOW, MEDIUM, HIGH, CRITICAL)  
\- \`status\` (enum: OPEN, ACCEPTED, REJECTED, SNOOZED, APPLIED, FAILED, EXPIRED)  
\- \`title\` (short string)  
\- \`action\_payload\_json\` (jsonb) // exact proposed action  
\- \`evidence\_json\` (jsonb) // concrete data points  
\- \`guardrails\_json\` (jsonb) // pass/fail \+ reasons  
\- \`impact\_json\` (jsonb) // direction \+ band \+ confidence  
\- \`created\_at\`, \`updated\_at\`  
\*\*Index\*\*: \`(status, severity, created\_at desc)\`

\#\#\# 4.15 recommendation\_events  
\- \`id\` (pk)  
\- \`recommendation\_id\` (fk)  
\- \`event\_type\` (enum: CREATED, ACCEPTED, REJECTED, SNOOZED, UNSNOOZED, APPLIED, FAILED, NOTE\_ADDED)  
\- \`event\_json\` (jsonb)  
\- \`created\_at\`

\#\#\# 4.16 listing\_events (audit trail)  
\- \`id\` (pk)  
\- \`listing\_id\` (fk)  
\- \`event\_type\` (enum: PRICE\_DRAFTED, PRICE\_PUBLISHED, STOCK\_DRAFTED, STOCK\_PUBLISHED, BOM\_UPDATED, ENRICH\_REQUESTED, ENRICH\_COMPLETED, ERROR)  
\- \`event\_json\` (jsonb)  
\- \`created\_at\`

\#\#\# 4.17 jobs  
\- \`id\` (pk)  
\- \`job\_type\` (enum; see §7)  
\- \`scope\_type\` (LISTING, ASIN, GLOBAL)  
\- \`listing\_id\` (fk nullable)  
\- \`asin\_entity\_id\` (fk nullable)  
\- \`status\` (PENDING, RUNNING, SUCCEEDED, FAILED, CANCELLED)  
\- \`priority\` (int default 5\)  
\- \`attempts\` (int default 0\)  
\- \`max\_attempts\` (int default 5\)  
\- \`scheduled\_for\` (timestamp)  
\- \`started\_at\` (timestamp nullable)  
\- \`finished\_at\` (timestamp nullable)  
\- \`log\_json\` (jsonb)  
\- \`created\_at\`, \`updated\_at\`

\---

\#\# 5\) Listing Workflow (Statuses & Rules)

\#\#\# 5.1 listing.status enum  
\- \`NEW\` (created locally)  
\- \`ACTIVE\` (managed and syncing)  
\- \`AT\_RISK\` (computed state; optional as status, preferably derived)  
\- \`PAUSED\` (user paused operations)  
\- \`ARCHIVED\` (no longer active)

\#\#\# 5.2 Derived “health” is not the same as status  
\- Health is derived from features and displayed as: GREEN / AMBER / RED, plus reasons.

\---

\#\# 6\) Jobs & Scheduling (Operational Backbone)

\#\#\# 6.1 Job types (enum)  
\- \`SYNC\_AMAZON\_OFFER\` (price/stock/buy box)  
\- \`SYNC\_AMAZON\_SALES\` (daily sales/traffic)  
\- \`SYNC\_AMAZON\_CATALOG\` (attributes/images/title)  
\- \`SYNC\_KEEPA\_ASIN\` (keepa snapshot)  
\- \`COMPUTE\_FEATURES\_LISTING\`  
\- \`COMPUTE\_FEATURES\_ASIN\`  
\- \`GENERATE\_RECOMMENDATIONS\_LISTING\`  
\- \`GENERATE\_RECOMMENDATIONS\_ASIN\`  
\- \`PUBLISH\_PRICE\_CHANGE\`  
\- \`PUBLISH\_STOCK\_CHANGE\`

\#\#\# 6.2 Scheduling rules  
\- Offer sync: at least every X hours (configurable)  
\- Keepa sync: daily for active listings \+ on-demand for ASIN analyzer  
\- Feature computation: after any sync job completes, and on a nightly full run  
\- Recommendation generation: after feature computation, and nightly full run

\#\#\# 6.3 Worker requirements  
\- Must run as a separate process (or dedicated worker thread) from the API server.  
\- Must persist job state in DB.  
\- Must be idempotent: reruns do not corrupt data.  
\- Must log errors and store raw responses where appropriate.

\---

\#\# 7\) Enrichment (Amazon \+ Keepa)

\#\#\# 7.1 Amazon data to ingest (minimum)  
For each listing:  
\- Current price (VAT inc)  
\- Available quantity  
\- Buy Box status (or best available proxy; if unavailable, store UNKNOWN and document)  
\- Sales history:  
  \- daily units  
  \- daily revenue (VAT inc)  
  \- sessions & conversion if accessible  
\- Fees (estimate or API-derived; store fee snapshot with source)

\*\*If Buy Box % is not available\*\*, store:  
\- \`buy\_box\_status\` at last observation (WON/LOST/UNKNOWN)  
\- Add an evidence note in recommendations explaining limitation.

\#\#\# 7.2 Keepa data to ingest (minimum)  
For each ASIN:  
\- price band summaries: 30/90/365  
\- volatility index  
\- offers count trend  
\- rank trend and seasonality proxy  
\- review count and rating if available from Keepa payload

\#\#\# 7.3 Snapshot rules  
\- Store raw JSON.  
\- Store parsed/extracted JSON.  
\- Maintain “latest snapshot pointer” via computed\_at ordering (no mutable “latest row” flags).

\---

\#\# 8\) Feature Store (So every process uses every data)

\#\#\# 8.1 Feature versioning  
\- \`feature\_version\` starts at 1\.  
\- Increment feature\_version only when schema/meaning changes.  
\- Old versions remain queryable for audit.

\#\#\# 8.2 Required listing features (fields in features\_json)  
\*\*Economics\*\*  
\- \`vat\_rate\`  
\- \`price\_inc\_vat\`  
\- \`price\_ex\_vat\`  
\- \`bom\_cost\_ex\_vat\`  
\- \`shipping\_cost\_ex\_vat\`  
\- \`packaging\_cost\_ex\_vat\`  
\- \`amazon\_fees\_ex\_vat\` (latest fee snapshot)  
\- \`profit\_ex\_vat\`  
\- \`margin\`  
\- \`break\_even\_price\_inc\_vat\`

\*\*Sales/performance (windows)\*\*  
\- \`units\_7d\`, \`units\_30d\`  
\- \`revenue\_inc\_vat\_7d\`, \`revenue\_inc\_vat\_30d\`  
\- \`sessions\_30d\` (nullable)  
\- \`conversion\_rate\_30d\` (nullable)  
\- \`sales\_velocity\_units\_per\_day\_30d\`

\*\*Inventory\*\*  
\- \`available\_quantity\`  
\- \`days\_of\_cover\` (available\_quantity / velocity; handle zero velocity)  
\- \`lead\_time\_days\` (max of components lead time, nullable)  
\- \`stockout\_risk\` (LOW/MEDIUM/HIGH derived)

\*\*Buy Box\*\*  
\- \`buy\_box\_status\`  
\- \`buy\_box\_percentage\_30d\` (nullable)  
\- \`buy\_box\_risk\` (LOW/MEDIUM/HIGH derived)  
\- \`competitor\_price\_position\` (from Keepa: BELOW\_BAND / IN\_BAND / ABOVE\_BAND, etc.)

\*\*Keepa signals\*\*  
\- \`keepa\_price\_median\_90d\`  
\- \`keepa\_price\_p25\_90d\`  
\- \`keepa\_price\_p75\_90d\`  
\- \`keepa\_volatility\_90d\`  
\- \`keepa\_offers\_count\_current\`  
\- \`keepa\_offers\_trend\_30d\`  
\- \`keepa\_rank\_trend\_90d\`

\*\*Anomaly signals\*\*  
\- \`sales\_anomaly\_score\` (numeric)  
\- \`conversion\_anomaly\_score\` (numeric, nullable)  
\- \`buy\_box\_anomaly\_score\` (numeric, nullable)

\#\#\# 8.3 Required ASIN features  
\- Same Keepa features as above  
\- Catalog basics (title, category if available)  
\- No listing-specific inventory/sales unless tied to your account

\#\#\# 8.4 Feature computation triggers  
\- After any sync job updates offer/sales/keepa  
\- Nightly global recompute

\---

\#\# 9\) Recommendations (Types, Evidence, Guardrails, Ranking)

\#\#\# 9.1 Recommendation types (enum)  
\*\*Listing-scope\*\*  
\- \`PRICE\_DECREASE\_REGAIN\_BUYBOX\`  
\- \`PRICE\_INCREASE\_MARGIN\_OPPORTUNITY\`  
\- \`STOCK\_INCREASE\_STOCKOUT\_RISK\`  
\- \`STOCK\_DECREASE\_OVEREXPOSURE\`  
\- \`MARGIN\_AT\_RISK\_COMPONENT\_COST\`  
\- \`BREAK\_EVEN\_PRICE\_TOO\_HIGH\`  
\- \`ANOMALY\_SALES\_DROP\`  
\- \`ANOMALY\_CONVERSION\_DROP\`  
\- \`ANOMALY\_BUYBOX\_UNSTABLE\`

\*\*ASIN-scope\*\*  
\- \`OPPORTUNITY\_CREATE\_LISTING\`  
\- \`OPPORTUNITY\_REJECT\_LOW\_MARGIN\`  
\- \`OPPORTUNITY\_CAUTION\_VOLATILE\_PRICE\`  
\- \`OPPORTUNITY\_CAUTION\_HIGH\_COMPETITION\`

\#\#\# 9.2 Evidence format (must be consistent)  
\`evidence\_json\` MUST include:  
\- \`time\_window\` for each metric (e.g., 30d)  
\- \`values\` (key metrics)  
\- \`comparisons\` (vs competitor band, vs previous period)  
Example structure:  
\`\`\`json  
{  
  "values": {  
    "current\_price\_inc\_vat": 19.99,  
    "competitor\_low\_inc\_vat": 19.67,  
    "margin\_after\_change": 0.18,  
    "buy\_box\_status": "LOST",  
    "units\_30d": 142  
  },  
  "windows": {  
    "units\_30d": "last\_30\_days",  
    "keepa\_band\_90d": "last\_90\_days"  
  },  
  "notes": \[  
    "Buy Box status derived from latest offer sync; buy box % not available."  
  \]  
}

### **9.3 Guardrails (global configuration)**

Must exist as editable settings (DB table or config):

* `min_margin` (default e.g., 0.15)  
* `max_price_change_pct_per_day` (default e.g., 0.05)  
* `min_days_of_cover_before_price_change` (default e.g., 7\)  
* `min_stock_threshold` (default e.g., 5\)  
* `max_stock_change_per_publish` (optional)  
* `default_vat_rate` per marketplace

`guardrails_json` MUST show:

* each rule name  
* pass/fail  
* computed values  
* reason text

### **9.4 Recommendation ranking (deterministic v1 \+ learning later)**

**v1 ranking score**:

* severity weight (CRITICAL\>HIGH\>MEDIUM\>LOW)  
* urgency (stockout in days, buy box lost, anomaly magnitude)  
* upside (profit delta estimate for price actions)  
* confidence band

**Learning upgrade** (phase later):

* Use accept/reject/snooze events to learn ranking preferences per user.

### **9.5 Recommendation lifecycle**

* Generated as OPEN  
* User can ACCEPT (creates publish job if action is publishable)  
* User can REJECT (must store reason)  
* User can SNOOZE (until date)  
* When publish job succeeds \-\> APPLIED  
* When publish job fails \-\> FAILED with error details

---

## **10\) Publishing Actions (Edit Price & Edit Stock)**

### **10.1 UX flow (must implement)**

1. User clicks **Edit Price**  
2. Enters proposed new `price_inc_vat`  
3. UI calls backend “preview guardrails” endpoint  
4. UI shows:  
   * margin after change (VAT ex)  
   * guardrails pass/fail  
   * competitor band positioning  
   * expected impact (directional)  
5. User confirms “Publish”  
6. Backend creates `PUBLISH_PRICE_CHANGE` job with payload  
7. UI shows job status  
8. On success:  
   * listing\_offer\_current updates  
   * listing\_event recorded  
   * recommendation moves to APPLIED if linked  
9. On failure:  
   * job FAILED with error stored  
   * listing\_event ERROR recorded  
   * recommendation moves to FAILED

**Stock edit flow** is identical, with stock payload.

### **10.2 Backend endpoints (required)**

All endpoints under `/api/v2` (new stable API; do not break existing v1 unless necessary).

**Listings**

* `GET /api/v2/listings` (filters, pagination, sorting)  
* `GET /api/v2/listings/{id}` (detail \+ current offer \+ economics \+ latest features \+ latest recommendations)  
* `GET /api/v2/listings/{id}/history` (listing\_events, recent jobs, rec events)  
* `POST /api/v2/listings/{id}/enrich` (creates sync jobs)

**BOM & components**

* `GET /api/v2/components`  
* `POST /api/v2/components` (create)  
* `POST /api/v2/components/import` (CSV upload)  
* `GET /api/v2/listings/{id}/bom` (active \+ versions)  
* `POST /api/v2/listings/{id}/bom` (create new version)  
* `PUT /api/v2/boms/{bom_id}/lines` (replace lines atomically)

**Economics**

* `GET /api/v2/listings/{id}/economics` (computed results \+ breakdown)  
* `POST /api/v2/economics/preview` (price/stock hypothetical scenarios; no persistence unless requested)

**Price/stock edit**

* `POST /api/v2/listings/{id}/price/preview` (guardrails \+ economics preview)  
* `POST /api/v2/listings/{id}/price/publish` (creates publish job)  
* `POST /api/v2/listings/{id}/stock/preview`  
* `POST /api/v2/listings/{id}/stock/publish`

**Recommendations**

* `GET /api/v2/recommendations` (filters: scope, status, severity)  
* `POST /api/v2/recommendations/{id}/accept`  
* `POST /api/v2/recommendations/{id}/reject`  
* `POST /api/v2/recommendations/{id}/snooze`

**ASIN Analyzer**

* `POST /api/v2/asins/analyze` with `{asin, marketplace_id}`  
  * Creates asin\_entity if needed  
  * Triggers keepa \+ amazon catalog sync jobs on-demand  
  * Returns latest snapshots/features if already available, else “pending” with job ids  
* `GET /api/v2/asins/{asin_entity_id}` (deep-dive view data)  
* `POST /api/v2/asins/{asin_entity_id}/bom` (create scenario BOM, versioned)  
* `GET /api/v2/asins/{asin_entity_id}/recommendations`

**Jobs**

* `GET /api/v2/jobs` (filters)  
* `GET /api/v2/jobs/{id}` (status \+ log)

### **10.3 Publish payload structures (unambiguous)**

Price publish request:

{  
  "price\_inc\_vat": 19.99,  
  "reason": "Regain Buy Box; competitor undercut by 0.32",  
  "correlation\_id": "optional-client-id"  
}

Stock publish request:

{  
  "available\_quantity": 120,  
  "reason": "Prevent stockout; velocity 8.4/day; lead time 14d"  
}

---

## **11\) UI Requirements (Screens & Exact Content)**

### **11.1 Navigation structure (minimum)**

* Dashboard  
* Listings  
* Listing Detail  
* Components  
* BOM Templates (optional in v1; can be folded into BOM UI)  
* Recommendations  
* ASIN Analyzer  
* Research Pool  
* Jobs / Sync Health  
* Settings

### **11.2 Listings screen (table)**

Columns (required):

* SKU  
* ASIN  
* Title  
* Price (VAT inc)  
* Available Qty  
* Buy Box (status \+ % if available)  
* Units 7d  
* Units 30d  
* Revenue 30d (VAT inc)  
* Unit Cost (VAT ex)  
* Profit/Unit (VAT ex)  
* Margin %  
* Buy Box risk  
* Stock risk (days cover)  
* Price position vs competitors (Keepa)  
  Actions per row:  
* Edit price  
* Edit stock  
* View recommendations  
* View history

Filtering (required):

* by SKU/ASIN search  
* by Buy Box status  
* by risk (stock risk, buy box risk)  
* by margin band  
  Sorting (required):  
* margin asc/desc  
* profit/unit asc/desc  
* units 30d desc  
* buy box % desc (if available)

### **11.3 Listing detail screen (layout)**

**Panel 1: Price & Buy Box**

* Current price (VAT inc)  
* Buy Box status \+ buy box % (if available) \+ trend indicator  
* Keepa competitor band (p25/median/p75 90d) shown  
* “Edit price” button \-\> modal with preview and guardrails

**Panel 2: Stock**

* Available qty  
* Velocity 7/30  
* Days of cover  
* Lead time (derived from BOM)  
* “Edit stock” button \-\> modal with preview and guardrails  
* Reorder suggestion (if computed)

**Panel 3: Economics**

* BOM breakdown table  
* Shipping cost (VAT ex)  
* Packaging cost (VAT ex)  
* Amazon fees (VAT ex) \+ source  
* Profit/unit VAT ex  
* Margin %  
* Scenario slider:  
  * price scenario (VAT inc)  
  * component cost multiplier scenario (+10%)  
  * outputs update via backend preview endpoint only

**Panel 4: Keepa & competition**

* Price history chart  
* Offers count chart  
* Volatility indicator  
* Rank trend chart (if available)  
  (Charts can start as simple time series; exact library choice is up to implementation but must be stable.)

**Panel 5: Recommendations**

* Primary recommendation card (highest rank)  
* Secondary observations list  
  Each card shows:  
* What to do  
* Why (3–6 bullet evidence points with numbers)  
* Expected impact \+ confidence  
* Accept/Reject/Snooze buttons

**Panel 6: History**

* Listing events timeline  
* Recent jobs \+ status  
* Recent recommendation events

### **11.4 Recommendations screen**

Tabs:

* My Listings (listing-scope)  
* Opportunities (ASIN-scope)  
* ASIN Analyzer (entry box \+ results)

Filters:

* status, severity, type  
* snoozed until date

### **11.5 ASIN Analyzer**

Inputs:

* ASIN  
* marketplace  
  Outputs:  
* Market reality (Keepa summaries, volatility, offers trend)  
* Catalog summary (title, category if available)  
* “Apply BOM” section:  
  * choose existing BOM template OR build from components  
  * compute profitability scenarios:  
    * at keepa median 90d price  
    * at keepa p25 90d price (conservative)  
    * at keepa p75 90d price (aggressive)  
* Recommendations:  
  * create listing opportunity or caution/reject  
    Actions:  
* Save to research pool  
* Convert to listing candidate (creates listing with placeholder SKU if needed; or prompts for SKU)

### **11.6 Research Pool**

* list of asin\_entities tracked  
* last computed opportunity score  
* profitability at your current BOM scenario  
* “promote to listing” action

---

## **12\) Settings (Required)**

Settings must include:

* Marketplace VAT rate defaults  
* Guardrails:  
  * min\_margin  
  * max\_price\_change\_pct\_per\_day  
  * min\_days\_of\_cover\_before\_price\_change  
* Sync schedules:  
  * offer sync frequency  
  * keepa sync frequency  
* Fee model source preferences:  
  * Amazon API if available  
  * fallback estimate table  
* Currency: GBP (primary), but allow per-marketplace currency for future

---

## **13\) Import/Upload Requirements**

### **13.1 Components CSV import**

Required columns:

* component\_sku  
* name  
* unit\_cost\_ex\_vat  
  Optional:  
* supplier  
* lead\_time\_days  
* notes

Validation:

* component\_sku unique  
* unit\_cost\_ex\_vat numeric \>= 0

### **13.2 Listings import (optional)**

If supported, CSV columns:

* seller\_sku  
* marketplace\_id  
* asin (optional)  
* title (optional)

---

## **14\) Technical Constraints & Implementation Notes (for Claude)**

### **14.1 Do not break existing app**

* Implement new endpoints under `/api/v2`.  
* The existing UI can be iteratively refactored; if a new UI is built, it must coexist until v2 is complete.

### **14.2 Backend conventions**

* All derived metrics are computed server-side.  
* Use a service layer for:  
  * economics computation  
  * feature computation  
  * recommendation generation  
* Repositories only do DB operations, no business logic.

### **14.3 Feature computation & rec generation must be deterministic v1**

* ML “learning” is phase later.  
* v1 uses:  
  * rule-based recs  
  * anomaly detection using simple stats  
  * deterministic ranking

### **14.4 Idempotency**

* Jobs must be idempotent; duplicate job runs must not create duplicated snapshot rows incorrectly (use captured\_at \+ uniqueness logic where appropriate).

---

## **15\) Definition of Done (Per Slice)**

### **Slice A — BOM & economics foundation**

DONE when:

* Components CRUD \+ CSV import works  
* Listing BOM versioning works  
* Economics endpoints return correct profit/margin (VAT rules)  
* Listings table shows Unit Cost, Profit/Unit, Margin (VAT ex)  
* Unit tests for economics pass

### **Slice B — Edit price & stock (portal control)**

DONE when:

* Preview endpoints show guardrails and economic impact  
* Publish endpoints create jobs  
* Worker executes jobs (stub allowed if API not ready, but lifecycle must exist)  
* Success/failure visible in UI and stored in history

### **Slice C — Enrichment \+ feature store**

DONE when:

* Keepa snapshots stored  
* Amazon offer/sales snapshots stored (even partial initially)  
* Feature store rows computed and used by UI

### **Slice D — Recommendations v1**

DONE when:

* Recommendation objects generated for at least:  
  * price decrease regain buy box  
  * stock increase stockout risk  
  * margin at risk component cost  
  * sales drop anomaly  
* Cards show evidence \+ guardrails \+ impact \+ confidence  
* Accept/Reject/Snooze workflow works and is logged

### **Slice E — ASIN analyzer \+ opportunities**

DONE when:

* Enter ASIN triggers enrichment job  
* Shows Keepa summaries  
* Allows BOM scenario using stored components  
* Outputs profitability scenarios and opportunity recommendation  
* Save to research pool \+ convert to listing supported

---

## **16\) Acceptance Criteria (Examples — Must be Implemented)**

### **16.1 Economics acceptance tests**

Given:

* price\_inc\_vat \= 24.00, vat\_rate=0.20 \-\> price\_ex\_vat=20.00  
* bom\_cost\_ex\_vat=6.00  
* shipping\_cost\_ex\_vat=2.00  
* packaging\_cost\_ex\_vat=0.50  
* amazon\_fees\_ex\_vat=3.00  
  Then:  
* profit\_ex\_vat \= 20.00 \- (6+2+0.5+3) \= 8.50  
* margin \= 8.50 / 20.00 \= 0.425

### **16.2 Price preview guardrails**

Given:

* min\_margin=0.15  
* proposed price causes margin=0.12  
  Then:  
* preview returns guardrails fail  
* UI blocks publish unless “override” is explicitly designed (v1: no overrides)

### **16.3 Stock risk**

If:

* velocity=10/day, available=30  
  Then:  
* days\_of\_cover=3  
* stock\_risk=HIGH  
* recommendation STOCK\_INCREASE\_STOCKOUT\_RISK generated (severity HIGH/CRITICAL)

### **16.4 Buy Box regain rec**

If:

* buy\_box\_status=LOST  
* competitor\_low=19.67, current\_price=19.99  
* margin after reducing to 19.69 \>= min\_margin  
  Then:  
* PRICE\_DECREASE\_REGAIN\_BUYBOX rec generated  
* action\_payload proposes new price 19.69 (or 19.68; define rounding rule)  
* evidence includes competitor low and margin-after-change

---

## **17\) ML Roadmap (Explicit Boundaries)**

### **17.1 v1 (must deliver)**

* Rule-based recommendations  
* Simple anomaly detection:  
  * sales WoW drop magnitude  
  * conversion drop where sessions stable (if data available)  
* Deterministic ranking score

### **17.2 v2 (learning)**

* Recommendation ranking learns from feedback events:  
  * accept/reject/snooze  
* Price suggestion model can be added only if:  
  * guardrails remain enforced  
  * model outputs are explainable and logged  
  * no autonomous repricing without explicit user enablement

---

## **18\) What Claude Must Ask Before Coding (Allowed Clarifications)**

Claude is allowed to ask ONLY these clarifications if blocked:

1. Marketplace list to support (default: UK)  
2. VAT rate per marketplace (default: UK 20%)  
3. Where Amazon data will come from in the current repo (existing SP-API code paths vs new module)

If not provided, use UK marketplace and 20% VAT as defaults.

---

## **19\) Deliverables to Produce (Artifacts)**

Claude must produce:

1. DB migration scripts for the schema above  
2. Backend services:  
   * economics service  
   * feature computation service  
   * recommendation engine service  
   * job worker service  
3. API endpoints under `/api/v2`  
4. UI pages matching §11  
5. Tests:  
   * economics unit tests  
   * recommendation generation tests (fixtures)  
6. Seed data scripts for local dev  
7. A README:  
   * how to run  
   * how jobs run  
   * how to import components  
   * how to analyze an ASIN  
   * how to edit price/stock

---

## **20\) Explicit “Don’t Do” List (Prevents Drift)**

* Do not implement economics calculations in front-end JS.  
* Do not create “recommendations” as unstructured text without evidence and action payload.  
* Do not run Keepa/Amazon sync inline in API calls; must be jobs.  
* Do not store latest snapshots by mutable flags; use captured\_at ordering.  
* Do not introduce autonomous repricing.  
* Do not mix VAT semantics (price inc VAT, profit/cost ex VAT is fixed).

---

