# Amazon Seller ML Listing Helper - Architecture Documentation

## 📋 Table of Contents

| Document | Description |
|----------|-------------|
| [01-SYSTEM-OVERVIEW.md](./01-SYSTEM-OVERVIEW.md) | High-level architecture, principles, data flow |
| [02-DATABASE-SCHEMA.md](./02-DATABASE-SCHEMA.md) | Complete PostgreSQL + TimescaleDB schema |
| [03-SERVICE-ARCHITECTURE.md](./03-SERVICE-ARCHITECTURE.md) | Backend services, APIs, directory structure |
| [04-ML-SCORING-ENGINE.md](./04-ML-SCORING-ENGINE.md) | Scoring rules, benchmarking, recommendations |
| [05-FRONTEND-ARCHITECTURE.md](./05-FRONTEND-ARCHITECTURE.md) | React components, state management, UI design |
| [06-INTEGRATION-LAYER.md](./06-INTEGRATION-LAYER.md) | SP-API, Keepa, Royal Mail integrations |
| [07-AUTOMATION-ENGINE.md](./07-AUTOMATION-ENGINE.md) | Rules engine, triggers, actions |
| [08-IMPLEMENTATION-ROADMAP.md](./08-IMPLEMENTATION-ROADMAP.md) | Phased development plan |

---

## 🎯 Project Summary

### What We're Building

A comprehensive Amazon seller platform for UK DIY & Tools sellers featuring:

- **ML-Powered Listing Optimization** - Score and improve listings with DIY-specific rules
- **Intelligent Pricing** - Margin-protected optimization with BOM and landed cost tracking
- **Competitive Intelligence** - Real-time competitor monitoring with Keepa integration
- **Workflow Automation** - Rules-based actions with Kanban task management
- **Portfolio Analytics** - Performance tracking, attribution, and forecasting

### Target User

- UK Amazon seller (FBM, working toward SFP)
- DIY & Tools category focus
- 50-500 ASINs
- Single user (no multi-user auth needed)

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Tailwind CSS, shadcn/ui |
| Backend | Node.js 20, Fastify, TypeScript |
| Database | PostgreSQL 15 + TimescaleDB |
| Cache/Queue | Redis 7, BullMQ |
| Integrations | Amazon SP-API, Keepa API, Royal Mail API |

---

## 🏗️ Architecture Highlights

### Data Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   SP-API     │     │    Keepa     │     │ Royal Mail   │
│   Amazon     │     │    Data      │     │   Shipping   │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       └────────────────────┼────────────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │   Integration Layer     │
              │   (Rate Limit, Cache)   │
              └───────────┬─────────────┘
                          │
                          ▼
              ┌─────────────────────────┐
              │     Service Layer       │
              │   (Business Logic)      │
              └───────────┬─────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Scoring    │  │   Pricing    │  │  Automation  │
│   Engine     │  │   Engine     │  │   Engine     │
└──────────────┘  └──────────────┘  └──────────────┘
```

### Scoring Engine

- **5 Score Components**: SEO (25%), Content (25%), Images (20%), Competitive (15%), Compliance (15%)
- **Category-Specific Rules**: DIY & Tools optimizations for technical specs, compatibility
- **Learning Module**: Adjusts weights based on actual performance correlation

### Key Features

1. **Listing Management**: Full CRUD, versioning, templates, push to Amazon
2. **Scoring**: 50+ rules, benchmarking, actionable recommendations
3. **Pricing**: BOM costs, Royal Mail shipping, margin-protected optimization
4. **Competitors**: Keepa integration, threat scoring, real-time alerts
5. **Automation**: Threshold, competitive, time-based, and event triggers
6. **Analytics**: Attribution, forecasting, cannibalization detection
7. **Workflow**: Customizable Kanban, smart task prioritization

---

## ⏱️ Implementation Timeline

| Phase | Weeks | Focus |
|-------|-------|-------|
| 1. Foundation | 1-3 | Setup, SP-API, basic UI |
| 2. Scoring | 4-6 | ML scoring engine, recommendations |
| 3. Competitive | 7-9 | Keepa, competitors, alerts |
| 4. Pricing | 10-12 | BOM, margins, Royal Mail |
| 5. Workflow | 13-15 | Kanban, automation, versioning |
| 6. Analytics | 16-18 | Metrics, attribution, forecasting |
| 7. Advanced | 19-21 | Dashboard, bundles, reports |
| 8. Polish | 22-24 | Performance, testing, deployment |

**Total: ~24 weeks to complete production system**

---

## 💰 External Costs

| Service | Cost | Notes |
|---------|------|-------|
| Keepa API | Existing (21 tokens/min) | Your current subscription |
| Amazon SP-API | Free | Included with Seller account |
| Royal Mail API | Free/Low | Business account rates |
| Hosting (VPS) | ~£20-50/mo | DigitalOcean/Hetzner |
| PostgreSQL | Included | Self-hosted |
| Redis | Included | Self-hosted |

**Estimated monthly cost: £20-50** (hosting only, using your existing Keepa)

---

## 🚀 Getting Started

Once architecture is approved, we'll begin with:

1. **Day 1**: Project setup, monorepo initialization
2. **Day 2**: Docker environment, database setup
3. **Day 3**: SP-API authentication implementation
4. **Day 4-5**: Basic listing sync working

By end of Week 1, you'll have listings syncing from Amazon to your local database.

---

## 📝 Questions to Confirm

Before proceeding, please confirm:

1. ✅ Architecture approach looks good?
2. ✅ Tech stack acceptable?
3. ✅ Timeline realistic for your needs?
4. ✅ Phasing priorities correct?
5. ✅ Any features missing or de-prioritized?

---

**Created for George | georgeinvictatools@gmail.com**
