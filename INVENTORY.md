# INVENTORY.md — Repo Intake (Phase 0)

## Repository Structure

```
amazon-listing-helper/
├── ARCHITECTURE_AUDIT.md      # Phase 0 output - system inventory
├── CLAUDE_WORK_ORDER.md       # Original work order specification
├── CLEANUP_ADDENDUM.md        # Cleanup requirements
├── DATA_CONTRACTS.md          # Frozen field names and DTOs
├── DEPRECATION_PLAN.md        # v1 deprecation sequence
├── PROJECT-CONTEXT.md         # Project context
├── SPEC.md                    # Feature specification
│
├── main/
│   ├── 00-README.md → 08-IMPLEMENTATION-ROADMAP.md  # Design docs
│   │
│   ├── app/                   # Backend (Fastify + PostgreSQL)
│   │   ├── package.json       # ES modules, fastify 4.24, pg 8.11
│   │   ├── src/
│   │   │   ├── server.js      # Main entry point
│   │   │   ├── database/connection.js
│   │   │   ├── routes/v2.routes.js        # NEW: v2 API routes
│   │   │   ├── repositories/              # Data access layer
│   │   │   │   ├── supplier.repository.js  # NEW
│   │   │   │   ├── component.repository.js # NEW
│   │   │   │   ├── bom.repository.js       # NEW
│   │   │   │   ├── job.repository.js       # NEW
│   │   │   │   ├── listing-event.repository.js # NEW
│   │   │   │   └── [legacy repos]
│   │   │   ├── services/                   # Business logic
│   │   │   │   ├── economics.service.js    # NEW: Cost/profit calculation
│   │   │   │   ├── guardrails.service.js   # NEW: Validation rules
│   │   │   │   ├── keepa.service.js        # NEW: Keepa integration
│   │   │   │   ├── feature-store.service.js # NEW: Computed features
│   │   │   │   └── recommendation.service.js # NEW: AI recommendations
│   │   │   ├── workers/
│   │   │   │   └── job-worker.js           # NEW: Async job processor
│   │   │   └── tests/
│   │   │       ├── economics.test.js       # NEW
│   │   │       └── guardrails.test.js      # NEW
│   │   │
│   │   ├── migrations/                     # NEW: Schema migrations
│   │   │   ├── 001_slice_a_schema.sql     # Suppliers, components, BOMs
│   │   │   ├── 002_slice_b_schema.sql     # Jobs, events, offers
│   │   │   ├── 003_slice_c_schema.sql     # ASINs, Keepa, features
│   │   │   └── 004_slice_d_schema.sql     # Recommendations
│   │   │
│   │   ├── schema.sql         # Legacy main schema
│   │   └── orders-schema.sql  # Legacy orders schema
│   │
│   ├── web/                   # Frontend
│   │   ├── index.html
│   │   ├── app.js             # Legacy app
│   │   └── extra.js           # Extended UI (including Slice B-E UI)
│   │
│   ├── data/                  # JSON file storage (legacy)
│   └── docker-compose.yml     # PostgreSQL + Redis + MinIO
│
└── main/backup/               # Backup of original files
```

## Branch & Commits

**Current Branch:** `claude/execute-work-order-rv9SC` ✓

**Commit History (newest first):**
| Hash | Message |
|------|---------|
| 42e398e | Slice E: Implement ASIN Analyzer + Research Pool + Convert to Listing |
| 902a670 | Slice D: Implement Recommendations v1 |
| d9fe508 | Slice C: Implement Enrichment + Snapshots + Feature Store |
| 9985848 | Slice B: Implement Edit Price & Stock with Job Lifecycle |
| 23b8266 | Slice A: Implement BOM, Components, Economics backbone |
| c551c17 | Phase 0: Apply gating requirement updates |
| 1d9be5f | Phase 0: Add architecture audit and deprecation plan |

## Migrations Present

| File | Size | Content |
|------|------|---------|
| 001_slice_a_schema.sql | 10,291 B | Suppliers, components, BOMs, bom_lines |
| 002_slice_b_schema.sql | 10,121 B | Jobs, listing_events, listing_offer_current, fee_snapshots |
| 003_slice_c_schema.sql | 7,480 B | asin_entities, keepa_snapshots, amazon_catalog_snapshots, listing_sales_daily, feature_store |
| 004_slice_d_schema.sql | 5,325 B | recommendations, recommendation_events |

## Test Framework

**Status:** MINIMAL

- **package.json scripts:**
  - `npm start` → `node src/server.js`
  - `npm run test:db` → `node test-repositories.js` (legacy)
  - No dedicated test runner (jest, mocha, etc.)

- **Test files found:**
  - `src/tests/economics.test.js` — Manual test runner (no framework)
  - `src/tests/guardrails.test.js` — Manual test runner (no framework)

- **Test execution:** `node src/tests/economics.test.js`

## Docker / Local Run Assumptions

**docker-compose.yml provides:**
- **PostgreSQL:** `timescale/timescaledb:latest-pg15` on port 5432
  - DB: `amazon_listing_helper`
  - User: `alh_user`
  - Init script: `./init.sql`
- **Redis:** `redis:7-alpine` (for caching/queues)
- **MinIO:** Object storage for files

**No Dockerfile for app** — assumes local `node` execution

**Environment Variables Required:**
- `DATABASE_URL` — PostgreSQL connection string
- `DB_PASSWORD` — PostgreSQL password
- `MINIO_PASSWORD` — MinIO password
- `KEEPA_API_KEY` — Keepa API access (optional)
- `SP_API_*` — Amazon SP-API credentials (optional)

## Key Observations

1. **ES Modules:** Package uses `"type": "module"` — all imports use ESM syntax
2. **No test framework:** Tests are manual scripts, not using jest/mocha
3. **Dual schema system:** Legacy `schema.sql` + new migrations `001-004`
4. **Frontend bundling:** Uses Tailwind via CDN, no build step
5. **Worker not auto-started:** `job-worker.js` needs manual/cron execution
