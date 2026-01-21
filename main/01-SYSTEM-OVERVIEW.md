# Amazon Seller ML Listing Helper - System Architecture

## Executive Summary

This document describes the architecture for a comprehensive Amazon seller platform focused on ML-powered listing optimization, intelligent pricing, competitive intelligence, and portfolio management. The system is designed for a UK-based FBM seller in the DIY & Tools category with 50-500 ASINs.

---

## 1. Architecture Principles

### 1.1 Design Philosophy

1. **Data-First**: Every decision should be traceable to data. The system learns from outcomes.
2. **Event-Driven**: Changes propagate through events, enabling loose coupling and auditability.
3. **Plugin Architecture**: Core system is extensible; integrations are swappable modules.
4. **Offline-Capable**: Critical functions work even when external APIs are unavailable.
5. **Cost-Aware**: Respect API rate limits, minimize unnecessary calls, cache aggressively.

### 1.2 Technical Principles

1. **Separation of Concerns**: Clear boundaries between data, logic, and presentation.
2. **Idempotency**: Operations can be safely retried without side effects.
3. **Eventual Consistency**: Accept that data may be stale; design for it.
4. **Graceful Degradation**: System remains useful even when components fail.
5. **Observability**: Everything is logged, metered, and traceable.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              PRESENTATION LAYER                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   Web App   │  │ Mobile PWA  │  │  Reports    │  │      API Consumers      │ │
│  │   (React)   │  │  (React)    │  │  (PDF/CSV)  │  │   (Webhooks/External)   │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘ │
└─────────┼────────────────┼────────────────┼─────────────────────┼───────────────┘
          │                │                │                     │
          └────────────────┴────────────────┴─────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                 API GATEWAY                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Authentication │ Rate Limiting │ Request Routing │ Response Caching    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              SERVICE LAYER                                       │
│                                                                                  │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐    │
│  │   Listing     │  │   Pricing     │  │  Competitive  │  │   Portfolio   │    │
│  │   Service     │  │   Service     │  │  Intel Svc    │  │   Service     │    │
│  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘    │
│                                                                                  │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐    │
│  │   Keyword     │  │   Inventory   │  │   BOM/Cost    │  │   Returns     │    │
│  │   Service     │  │   Service     │  │   Service     │  │   Service     │    │
│  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘    │
│                                                                                  │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐    │
│  │   Scoring     │  │  Automation   │  │   Analytics   │  │   Reporting   │    │
│  │   Engine      │  │   Engine      │  │   Service     │  │   Service     │    │
│  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            INTELLIGENCE LAYER                                    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                         ML SCORING ENGINE                                │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │    │
│  │  │  SEO Rules  │  │  Content    │  │ Competitive │  │  Learning   │    │    │
│  │  │  Engine     │  │  Analyzer   │  │ Benchmarker │  │  Module     │    │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                       PREDICTION ENGINE                                  │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │    │
│  │  │  Demand     │  │  Price      │  │  BSR        │  │ Seasonality │    │    │
│  │  │  Forecaster │  │  Optimizer  │  │  Predictor  │  │  Detector   │    │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                         RULES ENGINE                                     │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │    │
│  │  │  Threshold  │  │ Competitive │  │  Time-Based │  │   Custom    │    │    │
│  │  │  Rules      │  │  Triggers   │  │  Schedules  │  │   Logic     │    │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           INTEGRATION LAYER                                      │
│                                                                                  │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐    │
│  │   Amazon      │  │    Keepa     │  │  Royal Mail   │  │   Google      │    │
│  │   SP-API      │  │    API       │  │     API       │  │   APIs        │    │
│  │   Adapter     │  │   Adapter    │  │   Adapter     │  │   Adapter     │    │
│  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                      INTEGRATION ORCHESTRATOR                            │    │
│  │  Rate Limiting │ Request Queue │ Response Cache │ Error Handling        │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER                                          │
│                                                                                  │
│  ┌───────────────────────────────────┐  ┌───────────────────────────────────┐  │
│  │         PostgreSQL                 │  │            Redis                  │  │
│  │  ┌─────────────┐  ┌─────────────┐ │  │  ┌─────────────┐  ┌─────────────┐ │  │
│  │  │  Listings   │  │   Orders    │ │  │  │   Cache     │  │   Queues    │ │  │
│  │  │  Keywords   │  │  Inventory  │ │  │  │   Layer     │  │   & Jobs    │ │  │
│  │  │  Analytics  │  │    BOM      │ │  │  │             │  │             │ │  │
│  │  │  Audit Log  │  │   Rules     │ │  │  │             │  │             │ │  │
│  │  └─────────────┘  └─────────────┘ │  │  └─────────────┘  └─────────────┘ │  │
│  └───────────────────────────────────┘  └───────────────────────────────────┘  │
│                                                                                  │
│  ┌───────────────────────────────────┐  ┌───────────────────────────────────┐  │
│  │         TimescaleDB                │  │         File Storage              │  │
│  │  (Time-series extension)           │  │  ┌─────────────┐  ┌─────────────┐ │  │
│  │  ┌─────────────┐  ┌─────────────┐ │  │  │   Images    │  │   Reports   │ │  │
│  │  │  Price      │  │    BSR      │ │  │  │             │  │   Exports   │ │  │
│  │  │  History    │  │  History    │ │  │  │             │  │             │ │  │
│  │  │  Metrics    │  │  Events     │ │  │  └─────────────┘  └─────────────┘ │  │
│  │  └─────────────┘  └─────────────┘ │  │                                    │  │
│  └───────────────────────────────────┘  └───────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          EVENT BUS (Message Queue)                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  listing.updated │ price.changed │ competitor.detected │ rule.triggered │    │
│  │  inventory.low   │ score.changed │ alert.created      │ job.completed  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack

### 3.1 Recommended Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Frontend** | React 18 + TypeScript | Modern, wide ecosystem, mobile PWA ready |
| **UI Framework** | Tailwind CSS + shadcn/ui | Customizable, professional look |
| **State Management** | Zustand + React Query | Lightweight, excellent cache management |
| **Charts/Viz** | Recharts + D3.js | Flexible, performant for dashboards |
| **Backend** | Node.js 20 + TypeScript | Same language as frontend, excellent async |
| **API Framework** | Fastify | Faster than Express, schema validation built-in |
| **Database** | PostgreSQL 15 + TimescaleDB | Robust, excellent for analytics/time-series |
| **Cache/Queue** | Redis 7 | Fast, versatile, handles jobs and caching |
| **Job Queue** | BullMQ | Redis-based, reliable job processing |
| **ORM** | Prisma | Type-safe, excellent DX, migrations |
| **Validation** | Zod | Runtime type validation, schema sharing |
| **Testing** | Vitest + Playwright | Fast unit tests, reliable E2E |

### 3.2 Development Tools

| Tool | Purpose |
|------|---------|
| **pnpm** | Package management (faster, disk efficient) |
| **Turborepo** | Monorepo management |
| **Docker Compose** | Local development environment |
| **GitHub Actions** | CI/CD pipeline |

### 3.3 Deployment Options

| Environment | Approach |
|-------------|----------|
| **Local Dev** | Docker Compose (Postgres, Redis, App) |
| **Self-Hosted** | Docker on VPS (DigitalOcean, Hetzner) |
| **Cloud** | AWS (ECS/Fargate, RDS, ElastiCache) |

---

## 4. Data Flow Patterns

### 4.1 Listing Sync Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   SP-API     │     │  Integration │     │   Listing    │     │   Scoring    │
│   Adapter    │────▶│ Orchestrator │────▶│   Service    │────▶│   Engine     │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                                                │                      │
                                                ▼                      ▼
                                          ┌──────────┐          ┌──────────┐
                                          │ Database │          │  Event   │
                                          │          │          │   Bus    │
                                          └──────────┘          └──────────┘
                                                                      │
                            ┌─────────────────────────────────────────┤
                            ▼                    ▼                    ▼
                     ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
                     │  Automation  │    │   Analytics  │    │ Notification │
                     │   Engine     │    │   Service    │    │   Service    │
                     └──────────────┘    └──────────────┘    └──────────────┘
```

### 4.2 Competitive Intel Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    Keepa     │     │   Keepa      │     │  Competitor  │
│    API       │────▶│   Adapter    │────▶│   Service    │
└──────────────┘     └──────────────┘     └──────────────┘
                                                │
                     ┌──────────────────────────┼──────────────────────────┐
                     ▼                          ▼                          ▼
              ┌──────────────┐          ┌──────────────┐          ┌──────────────┐
              │   Threat     │          │    Price     │          │   Change     │
              │   Scoring    │          │   Analysis   │          │   Detection  │
              └──────────────┘          └──────────────┘          └──────────────┘
                     │                          │                          │
                     └──────────────────────────┼──────────────────────────┘
                                                ▼
                                          ┌──────────┐
                                          │  Alert   │
                                          │  Engine  │
                                          └──────────┘
```

### 4.3 Pricing Optimization Flow

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Current    │    │    BOM/      │    │  Competitor  │    │   Rules      │
│   Listing    │    │    Cost      │    │   Prices     │    │   Engine     │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │                   │
       └───────────────────┴───────────────────┴───────────────────┘
                                    │
                                    ▼
                          ┌──────────────────┐
                          │  PRICING ENGINE  │
                          │  ┌────────────┐  │
                          │  │  Margin    │  │
                          │  │  Calc      │  │
                          │  └────────────┘  │
                          │  ┌────────────┐  │
                          │  │  Buy Box   │  │
                          │  │  Optimizer │  │
                          │  └────────────┘  │
                          │  ┌────────────┐  │
                          │  │ Elasticity │  │
                          │  │  Model     │  │
                          │  └────────────┘  │
                          └────────┬─────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
             ┌───────────┐  ┌───────────┐  ┌───────────┐
             │Suggestion │  │ Auto-Apply│  │  Alert    │
             │   Queue   │  │   (if OK) │  │ (review)  │
             └───────────┘  └───────────┘  └───────────┘
```

---

## 5. Security Architecture

### 5.1 Authentication & Authorization

Since this is a single-user system, security focuses on:

1. **API Protection**: All endpoints require valid session/token
2. **Credential Storage**: SP-API, Keepa, Royal Mail credentials encrypted at rest
3. **Audit Logging**: All changes logged with timestamp and context

### 5.2 Credential Management

```
┌─────────────────────────────────────────────────────┐
│              CREDENTIAL VAULT                        │
│  ┌───────────────────────────────────────────────┐  │
│  │  SP-API Credentials                           │  │
│  │  ├── Client ID (encrypted)                    │  │
│  │  ├── Client Secret (encrypted)                │  │
│  │  ├── Refresh Token (encrypted)                │  │
│  │  └── Access Token (memory only, rotated)      │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  Keepa API Key (encrypted)                    │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  Royal Mail API Credentials (encrypted)       │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 5.3 Data Protection

- **Encryption at Rest**: Database encryption for sensitive fields
- **Encryption in Transit**: HTTPS/TLS for all communications
- **Backup Encryption**: Encrypted database backups

---

## 6. Scalability Considerations

### 6.1 Current Scale (50-500 ASINs)

The architecture handles this comfortably with:
- Single PostgreSQL instance
- Single Redis instance
- Single Node.js process (can use cluster module)

### 6.2 Growth Path (500-5000 ASINs)

If you expand:
- Add read replicas for PostgreSQL
- Separate workers for background jobs
- Consider dedicated TimescaleDB for time-series

### 6.3 Enterprise Scale (5000+ ASINs)

Would require:
- Horizontal scaling of services
- Database sharding
- Dedicated queue workers
- CDN for static assets

---

## 7. Multi-Channel Ready Architecture

Although we're building for Amazon UK first, the architecture supports future eBay integration:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    MARKETPLACE ABSTRACTION LAYER                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                   IMarketplaceAdapter                         │  │
│  │  ├── getListings()                                            │  │
│  │  ├── updateListing()                                          │  │
│  │  ├── getOrders()                                              │  │
│  │  ├── getInventory()                                           │  │
│  │  └── ... (common interface)                                   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│           ┌──────────────────┼──────────────────┐                   │
│           ▼                  ▼                  ▼                   │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐       │
│  │  Amazon UK      │ │  Amazon US      │ │  eBay UK        │       │
│  │  Adapter        │ │  Adapter        │ │  Adapter        │       │
│  │  (Implemented)  │ │  (Future)       │ │  (Future)       │       │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 8. Offline & Resilience

### 8.1 Offline Capabilities

- **Cached Data**: Recent listings, prices, analytics available offline
- **Queue Offline Actions**: Changes queued and synced when online
- **Deferred Sync**: Background sync when connectivity restored

### 8.2 API Failure Handling

| Scenario | Behavior |
|----------|----------|
| SP-API Down | Use cached data, queue updates, alert user |
| Keepa Down | Use last known competitor data, reduce monitoring |
| Royal Mail Down | Use cached shipping rates, flag for review |
| Database Down | Critical failure, service unavailable |

---

## 9. Monitoring & Observability

### 9.1 Metrics to Track

| Category | Metrics |
|----------|---------|
| **System** | CPU, Memory, Disk, Network |
| **API** | Request count, latency, error rate |
| **Jobs** | Queue depth, processing time, failures |
| **Business** | Listings synced, scores calculated, rules triggered |
| **External APIs** | Rate limit usage, response times, errors |

### 9.2 Logging Strategy

```
┌─────────────────────────────────────────────────────┐
│                    LOG LEVELS                        │
│  ┌─────────────────────────────────────────────┐    │
│  │ ERROR   │ Failures requiring attention       │    │
│  │ WARN    │ Unexpected but handled situations  │    │
│  │ INFO    │ Business events (listing updated)  │    │
│  │ DEBUG   │ Detailed flow for troubleshooting  │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### 9.3 Alerting

| Alert | Trigger | Action |
|-------|---------|--------|
| API Rate Limit Near | >80% of limit used | Throttle requests |
| Sync Failure | 3+ consecutive failures | Notify user |
| Score Drop | ASIN score drops >20% | Create task |
| Competitor Alert | Significant competitor change | In-app notification |

---

## Next Document: Database Schema →
