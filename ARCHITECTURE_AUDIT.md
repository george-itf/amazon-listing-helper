# ARCHITECTURE AUDIT

**Date:** 2026-01-20
**Auditor:** Claude
**Purpose:** Document current system state before implementing SPEC.md rebuild

---

## A) System Inventory

### A.1 Backend Modules (`main/app/src/`)

| File | Purpose | Lines | Key Functions |
|------|---------|-------|---------------|
| `server.js` | Main Fastify server with all routes | ~2400 | 100+ API endpoints under `/api/v1` |
| `scoring.js` | Listing quality scoring engine | ~925 | `calculateScore`, `calculateComplianceScore`, `calculateCompetitiveScore` |
| `bom.js` | BOM and cost management | ~453 | Supplier/Component/BOM CRUD, `calculateLandedCost`, `calculateMargin` |
| `amazon-push.js` | Push changes to Amazon via SP-API | ~252 | `queuePriceChange`, `submitPriceChanges`, `buildPriceFeed` |
| `tasks.js` | Kanban task board | ~231 | Kanban stages, task CRUD, `generateTasksFromScores` |
| `keepa-sync.js` | Keepa data sync script | ~54 | Standalone sync script (not integrated) |
| `automation.js` | Basic automation rules | ~207 | Rule evaluation, alert generation |
| `advanced-automation.js` | Advanced rules, webhooks, scheduling | ~700+ | Triggers, actions, webhooks, scheduled tasks |
| `ai-recommendations.js` | AI-style recommendations | ~200 | Text-based recommendations (not structured) |
| `opportunities.js` | Opportunity scoring | ~460 | `analyzeOpportunities`, `findBundleOpportunities` |
| `forecasting.js` | Demand forecasting | ~410 | `forecastDemand`, `getRestockRecommendation` |
| `reports.js` | Report generation | ~740 | Report templates, CSV/HTML generation |
| `metrics.js` | Performance metrics | ~410 | Sales tracking, score history, attribution |
| `widgets.js` | Dashboard widgets | ~230 | Widget configuration and data |
| `templates.js` | Listing templates | ~140 | Template CRUD and application |
| `competitor-intelligence.js` | Competitor tracking | ~615 | Price tracking, Buy Box analysis |
| `listing-generator.js` | Generate listings from ASIN | ~1040 | ASIN analysis, listing creation |
| `aplus-content.js` | A+ Content management | ~760 | A+ content templates |
| `shipping.js` | Shipping rate calculator | ~90 | Royal Mail rate calculation |
| `dashboard.js` | Dashboard statistics | ~145 | Aggregated stats |
| `orders-sync.js` | Order synchronization | ~200 | Amazon order sync |

### A.2 Repositories (`main/app/src/repositories/`)

| File | Purpose | Database Table |
|------|---------|----------------|
| `listing.repository.js` | Listing CRUD | `listings`, `listing_images` |
| `score.repository.js` | Score CRUD | `scores` |
| `alert.repository.js` | Alert CRUD | `alerts` |
| `keepa.repository.js` | Keepa data CRUD | `keepa_data` |
| `task.repository.js` | Task CRUD | `tasks` |
| `settings.repository.js` | Settings CRUD | `settings` |
| `order.repository.js` | Order CRUD | `orders` (separate schema) |

### A.3 Database Schema (`schema.sql`)

| Table | Purpose | Notes |
|-------|---------|-------|
| `listings` | Core listing data | SKU as unique key, has `currentScore` denormalized |
| `listing_images` | Listing images | FK to listings |
| `scores` | Scoring history | 5-component scoring (SEO, content, images, competitive, compliance) |
| `alerts` | Alert notifications | Read/unread tracking |
| `keepa_data` | Keepa snapshots | Price history, BSR, offers |
| `settings` | App settings | Key-value store |
| `tasks` | Kanban tasks | Stage-based workflow |

### A.4 File-Based State (`main/data/`)

| File | Purpose | Should Migrate To |
|------|---------|-------------------|
| `credentials.json` | SP-API + Keepa API keys | **KEEP** (sensitive, file-based OK) |
| `listings.json` | Cached listing data | **REMOVE** (duplicates DB) |
| `scores.json` | Score history | **REMOVE** (duplicates DB) |
| `keepa.json` | Keepa data cache | **REMOVE** (duplicates DB) |
| `alerts.json` | Alert history | **REMOVE** (duplicates DB) |
| `tasks.json` | Task board state | **REMOVE** (duplicates DB) |
| `pending-changes.json` | Amazon change queue | **MIGRATE** to `jobs` table |
| `templates.json` | Listing templates | **MIGRATE** to DB |
| `suppliers.json` | Supplier data | **MIGRATE** to `suppliers` table |
| `components.json` | Component data | **MIGRATE** to `components` table |
| `bom.json` | BOM data | **MIGRATE** to `boms` + `bom_lines` tables |
| `costs.json` | Cost data | **MIGRATE** to `listing_cost_overrides` |
| `shipping.json` | Shipping dimensions | **MIGRATE** to `listings` or separate table |

### A.5 Frontend (`main/web/`)

| File | Purpose | Size |
|------|---------|------|
| `index.html` | Single-page app with all pages | ~71KB |
| `js/app.js` | Application JavaScript | ~3.7KB |
| `extra.js` | Extended functionality | ~116KB |
| `css/tailwind.css` | Tailwind CSS | ~43KB |

**Frontend Pages (in index.html):**
- Dashboard, Listings, Pricing, Alerts, Shipping, Optimize, AI Assist
- Tasks, Push to Amazon, Rules, BOM & Costs, Opportunities
- Forecasting, Reports, Listing Generator, Webhooks, Dashboard Setup, Settings

### A.6 API Routes Summary

**All routes are under `/api/v1`** - no `/api/v2` exists yet.

| Category | Route Pattern | Count |
|----------|---------------|-------|
| Health | `/api/v1/health` | 1 |
| Settings | `/api/v1/settings` | 2 |
| Dashboard | `/api/v1/dashboard/*` | 3 |
| Listings | `/api/v1/listings/*` | 4 |
| Scoring | `/api/v1/score`, `/api/v1/scores/*` | 5 |
| Sync | `/api/v1/sync` | 1 |
| Keepa | `/api/v1/keepa/*` | 3 |
| Costs/Profit | `/api/v1/costs/*`, `/api/v1/profit/*` | 4 |
| Shipping | `/api/v1/shipping/*` | 3 |
| Optimize | `/api/v1/optimize/*` | 3 |
| Automation | `/api/v1/automation/*` | 6 |
| Alerts | `/api/v1/alerts/*` | 3 |
| Tasks | `/api/v1/tasks/*` | 7 |
| Templates | `/api/v1/templates/*` | 5 |
| Changes | `/api/v1/changes/*` | 5 |
| BOM | `/api/v1/bom/*`, `/api/v1/suppliers/*`, `/api/v1/components/*` | 18 |
| Metrics | `/api/v1/metrics/*`, `/api/v1/attribution/*` | 9 |
| Opportunities | `/api/v1/opportunities/*` | 4 |
| Forecasting | `/api/v1/sales/*`, `/api/v1/forecast/*` | 7 |
| Widgets | `/api/v1/widgets/*` | 10 |
| Advanced Automation | `/api/v1/automation/advanced/*`, `/api/v1/webhooks/*` | 15 |
| Reports | `/api/v1/reports/*` | 8 |
| AI | `/api/v1/ai/*` | 2 |
| Competitors | `/api/v1/competitors/*` | ~10 |
| Listing Generator | `/api/v1/generator/*` | ~8 |
| A+ Content | `/api/v1/aplus/*` | ~8 |
| Orders | `/api/v1/orders/*` | ~5 |

---

## B) Redundancy Map

### B.1 Listing CRUD

| Implementation | Location | Notes |
|----------------|----------|-------|
| PostgreSQL Repository | `listing.repository.js` | **PRIMARY** - used by routes |
| JSON File | `loadListings()`/`saveListings()` in `server.js` | **DUPLICATE** - still used by some endpoints |
| File: `listings.json` | `main/data/listings.json` | Cache that shouldn't be source of truth |

**VERDICT:** Dual storage creates inconsistency. Some routes read from file, others from DB.

### B.2 Economics/Profit Calculation

| Implementation | Location | Notes |
|----------------|----------|-------|
| `calculateAmazonFees()` | `server.js:563-576` | Inline fee calculation |
| `calculateMargin()` | `bom.js:286-305` | Uses BOM landed cost |
| `/api/v1/profit/:sku` | `server.js:604-668` | Reads from files, calculates profit |
| `/api/v1/bom/:sku/margin` | `server.js:1470-1479` | Different margin calculation |
| Optimize endpoints | `server.js:787-998` | Yet another profit calculation path |

**VERDICT:** 4+ different profit calculation paths with no single source of truth. No VAT semantics.

### B.3 Keepa Ingestion

| Implementation | Location | Notes |
|----------------|----------|-------|
| Inline in route handler | `GET /api/v1/keepa/:asin` (server.js:427-466) | Fetches and saves inline |
| Inline sync | `POST /api/v1/keepa/sync` (server.js:469-526) | Batch sync inline |
| Standalone script | `keepa-sync.js` | Writes to file, not DB |
| File storage | `keepa.json` | Duplicates `keepa_data` table |

**VERDICT:** Keepa sync happens inline in HTTP handlers (violates job-based rule). Dual storage.

### B.4 Amazon Ingestion

| Implementation | Location | Notes |
|----------------|----------|-------|
| Inline sync | `POST /api/v1/sync` (server.js:313-424) | Long-running in HTTP handler |
| Orders sync | `orders-sync.js` | Separate sync logic |

**VERDICT:** Sync is inline, not job-based. Should be background jobs with status tracking.

### B.5 Publishing Price/Stock

| Implementation | Location | Notes |
|----------------|----------|-------|
| `amazon-push.js` | File-based change queue | Uses `pending-changes.json` |
| Feed submission | `submitPriceChanges()` | Creates SP-API feed inline |

**VERDICT:** No job system. No DB-stored state. No history/audit trail in DB.

### B.6 Scoring/Recommendations

| Implementation | Location | Notes |
|----------------|----------|-------|
| `scoring.js` | 5-component scoring | Compliance, Competitive, SEO, Content, Images |
| `ai-recommendations.js` | Text-based recommendations | Not structured per SPEC |
| `opportunities.js` | Opportunity scoring | Different scoring system |
| `automation.js` | Rule-based alerts | Creates alerts, not structured recs |

**VERDICT:** Multiple scoring systems. Recommendations are unstructured text, not typed with evidence/guardrails/impact.

### B.7 Tasks/Automation

| Implementation | Location | Notes |
|----------------|----------|-------|
| `tasks.js` | File-based kanban | Uses `tasks.json` |
| `task.repository.js` | PostgreSQL tasks | Different from file-based |
| `automation.js` | Basic rules | Creates alerts |
| `advanced-automation.js` | Advanced rules, webhooks | More complex automation |

**VERDICT:** Dual task storage. No unified job system per SPEC.

---

## C) Quality Classification

### C.1 KEEP (Retain and Improve)

| Component | Reason |
|-----------|--------|
| PostgreSQL repositories | Aligned with target, structurally sound |
| `listing.repository.js` | Good patterns, needs schema updates |
| `score.repository.js` | Good patterns, needs feature store integration |
| `credentials.json` file storage | Appropriate for sensitive credentials |
| Fastify server framework | Stable, performant |
| Basic scoring algorithms | Can be adapted to new feature store model |

### C.2 REMOVE (Delete After Migration)

| Component | Reason |
|-----------|--------|
| `listings.json` | Duplicates PostgreSQL `listings` table |
| `scores.json` | Duplicates PostgreSQL `scores` table |
| `alerts.json` | Duplicates PostgreSQL `alerts` table |
| `tasks.json` | Duplicates PostgreSQL `tasks` table |
| `keepa.json` | Duplicates PostgreSQL `keepa_data` table |
| `loadListings()`/`saveListings()` functions | Use repository instead |
| Duplicate routes that read from files | Consolidate to repository-based |

### C.3 REBUILD (Scrap and Replace)

| Component | Reason | Replacement |
|-----------|--------|-------------|
| **Economics calculation** | Scattered across 4+ locations, no VAT semantics | Dedicated economics service with VAT rules |
| **BOM system** (`bom.js`) | File-based, no versioning | PostgreSQL tables with versioning per SPEC |
| **Keepa ingestion** | Inline in HTTP handlers | Job-based with snapshots per SPEC |
| **Amazon sync** | Inline in HTTP handlers | Job-based with status tracking |
| **Amazon push** (`amazon-push.js`) | File-based, no job lifecycle | Job-based publish with events/history |
| **Recommendations** (`ai-recommendations.js`) | Unstructured text | Typed recs with evidence/guardrails/impact |
| **Feature computation** | None exists | New feature store per SPEC |
| **All `/api/v1` endpoints** | Gradual migration | New `/api/v2` endpoints |

---

## D) Proposed Cutover Strategy

### D.1 What Remains in `/api/v1` (Temporarily)

During migration, `/api/v1` endpoints remain functional for:
- Frontend compatibility until UI is updated
- Gradual testing of `/api/v2` equivalents
- Rollback safety

**Timeline:** `/api/v1` deprecated after all slices complete and verified.

### D.2 What is Rebuilt in `/api/v2`

| Slice | New Endpoints |
|-------|---------------|
| **Slice A** | `GET/POST /api/v2/components`, `POST /api/v2/components/import`, `GET/POST /api/v2/listings/{id}/bom`, `PUT /api/v2/boms/{id}/lines`, `GET /api/v2/listings/{id}/economics` |
| **Slice B** | `POST /api/v2/listings/{id}/price/preview`, `POST /api/v2/listings/{id}/price/publish`, `POST /api/v2/listings/{id}/stock/preview`, `POST /api/v2/listings/{id}/stock/publish`, `GET/POST /api/v2/settings` |
| **Slice C** | Job endpoints for sync, `GET /api/v2/jobs/*`, Feature store endpoints |
| **Slice D** | `GET /api/v2/recommendations`, Accept/Reject/Snooze endpoints |
| **Slice E** | `POST /api/v2/asins/analyze`, `GET /api/v2/asins/{id}`, Research pool endpoints |

### D.3 Data Migration Requirements

| Source | Target | Migration Notes |
|--------|--------|-----------------|
| `suppliers.json` | `suppliers` table (new) | One-time migration script |
| `components.json` | `components` table | One-time migration script |
| `bom.json` | `boms` + `bom_lines` tables | Versioning starts at v1 |
| `costs.json` | `listing_cost_overrides` table | Merge with existing listings |
| `pending-changes.json` | `jobs` table | Migrate pending to PENDING status |
| `keepa_data` rows | `keepa_snapshots` table | Add `raw_json`, `parsed_json` structure |
| `scores` rows | `feature_store` / `listing_features` | Transform to feature JSON |

### D.4 Migration Order

1. **Database schema migrations** (Slice A) - Create all new tables first
2. **Data backfill** - Migrate file-based data to new tables
3. **Service layer** - Implement economics, features, recommendations services
4. **API endpoints** - Build `/api/v2` endpoints
5. **UI updates** - Point frontend to `/api/v2`
6. **Deprecate `/api/v1`** - Remove file-based code paths
7. **Cleanup** - Remove JSON files and legacy code

---

## E) Risk Assessment

### High Risk Items
1. **Economics calculation changes** - Must maintain backward compatibility during transition
2. **BOM data migration** - Active BOM data must not be lost
3. **Keepa sync changes** - Must not break existing Keepa data flow

### Mitigation Strategies
1. Run old and new systems in parallel during transition
2. Create comprehensive backup before each migration step
3. Implement feature flags for gradual rollout
4. Write migration scripts with rollback capability

---

## F) Summary Statistics

| Metric | Count |
|--------|-------|
| Total Backend Files | 24 |
| Total Lines of JS (backend) | ~12,000 |
| Total API Routes | ~130 |
| PostgreSQL Tables | 7 |
| JSON Data Files | 12 |
| Redundant Subsystems | 7 |
| Components Marked REBUILD | 8 |
| Components Marked REMOVE | 7 |
| Components Marked KEEP | 6 |
