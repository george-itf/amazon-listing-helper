# Service Architecture

## Overview

This document defines the backend service layer architecture. We follow a modular monolith pattern - services are logically separated but deployed as a single application initially, with clear boundaries that enable future microservice extraction if needed.

---

## 1. Service Map

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              SERVICE LAYER                                       │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                         CORE SERVICES                                    │    │
│  │                                                                          │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │    │
│  │  │ ListingService  │  │ KeywordService  │  │ InventoryService│         │    │
│  │  │                 │  │                 │  │                 │         │    │
│  │  │ - CRUD listings │  │ - Research      │  │ - Stock levels  │         │    │
│  │  │ - Versioning    │  │ - Tracking      │  │ - Forecasting   │         │    │
│  │  │ - Templates     │  │ - Ranking       │  │ - Reorder       │         │    │
│  │  │ - A+ Content    │  │ - Suggestions   │  │ - Alerts        │         │    │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘         │    │
│  │                                                                          │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │    │
│  │  │ PricingService  │  │ CostService     │  │ CompetitorSvc   │         │    │
│  │  │                 │  │                 │  │                 │         │    │
│  │  │ - Price mgmt    │  │ - BOM calc      │  │ - Tracking      │         │    │
│  │  │ - Optimization  │  │ - Landed cost   │  │ - Threat score  │         │    │
│  │  │ - Rules engine  │  │ - Suppliers     │  │ - Alerts        │         │    │
│  │  │ - History       │  │ - Margins       │  │ - History       │         │    │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘         │    │
│  │                                                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                      INTELLIGENCE SERVICES                               │    │
│  │                                                                          │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │    │
│  │  │ ScoringService  │  │ PredictionSvc   │  │ AnalyticsService│         │    │
│  │  │                 │  │                 │  │                 │         │    │
│  │  │ - Calculate     │  │ - Demand        │  │ - Attribution   │         │    │
│  │  │ - Benchmark     │  │ - BSR forecast  │  │ - Cohorts       │         │    │
│  │  │ - Recommend     │  │ - Seasonality   │  │ - Trends        │         │    │
│  │  │ - Learn         │  │ - Opportunity   │  │ - Cannibalize   │         │    │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘         │    │
│  │                                                                          │    │
│  │  ┌─────────────────┐  ┌─────────────────┐                               │    │
│  │  │ ComplianceSvc   │  │ BundleService   │                               │    │
│  │  │                 │  │                 │                               │    │
│  │  │ - UK rules      │  │ - Suggestions   │                               │    │
│  │  │ - Policy check  │  │ - Optimization  │                               │    │
│  │  │ - Risk score    │  │ - Tracking      │                               │    │
│  │  └─────────────────┘  └─────────────────┘                               │    │
│  │                                                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                       WORKFLOW SERVICES                                  │    │
│  │                                                                          │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │    │
│  │  │ TaskService     │  │ AutomationSvc   │  │ AlertService    │         │    │
│  │  │                 │  │                 │  │                 │         │    │
│  │  │ - Kanban        │  │ - Rules engine  │  │ - Create        │         │    │
│  │  │ - Priorities    │  │ - Triggers      │  │ - Route         │         │    │
│  │  │ - Assignments   │  │ - Actions       │  │ - History       │         │    │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘         │    │
│  │                                                                          │    │
│  │  ┌─────────────────┐  ┌─────────────────┐                               │    │
│  │  │ ReportService   │  │ LaunchService   │                               │    │
│  │  │                 │  │                 │                               │    │
│  │  │ - Generate      │  │ - Playbooks     │                               │    │
│  │  │ - Templates     │  │ - Checklists    │                               │    │
│  │  │ - Schedule      │  │ - Tracking      │                               │    │
│  │  └─────────────────┘  └─────────────────┘                               │    │
│  │                                                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                      INTEGRATION SERVICES                                │    │
│  │                                                                          │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │    │
│  │  │ SyncService     │  │ KeepaService    │  │ ShippingService │         │    │
│  │  │                 │  │                 │  │                 │         │    │
│  │  │ - SP-API sync   │  │ - Fetch data    │  │ - Royal Mail    │         │    │
│  │  │ - Orchestrate   │  │ - Cache mgmt    │  │ - Rate calc     │         │    │
│  │  │ - Conflict res  │  │ - Rate limit    │  │ - Tracking      │         │    │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘         │    │
│  │                                                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory Structure

```
src/
├── api/                          # HTTP API Layer
│   ├── routes/                   # Route definitions
│   │   ├── listings.routes.ts
│   │   ├── pricing.routes.ts
│   │   ├── competitors.routes.ts
│   │   ├── keywords.routes.ts
│   │   ├── analytics.routes.ts
│   │   ├── tasks.routes.ts
│   │   ├── reports.routes.ts
│   │   └── index.ts
│   ├── middleware/               # API middleware
│   │   ├── auth.middleware.ts
│   │   ├── validation.middleware.ts
│   │   ├── rateLimit.middleware.ts
│   │   └── error.middleware.ts
│   ├── schemas/                  # Request/Response schemas (Zod)
│   │   ├── listing.schema.ts
│   │   ├── pricing.schema.ts
│   │   └── ...
│   └── server.ts                 # Fastify server setup
│
├── services/                     # Business Logic Layer
│   ├── catalog/
│   │   ├── listing.service.ts
│   │   ├── keyword.service.ts
│   │   ├── image.service.ts
│   │   └── template.service.ts
│   ├── pricing/
│   │   ├── pricing.service.ts
│   │   ├── cost.service.ts
│   │   ├── margin.service.ts
│   │   └── priceRule.service.ts
│   ├── competitors/
│   │   ├── competitor.service.ts
│   │   ├── threat.service.ts
│   │   └── alert.service.ts
│   ├── intelligence/
│   │   ├── scoring.service.ts
│   │   ├── prediction.service.ts
│   │   ├── analytics.service.ts
│   │   ├── compliance.service.ts
│   │   └── bundle.service.ts
│   ├── inventory/
│   │   ├── inventory.service.ts
│   │   ├── forecast.service.ts
│   │   └── supplier.service.ts
│   ├── workflow/
│   │   ├── task.service.ts
│   │   ├── automation.service.ts
│   │   ├── alert.service.ts
│   │   └── launch.service.ts
│   └── reports/
│       ├── report.service.ts
│       └── export.service.ts
│
├── integrations/                 # External API Adapters
│   ├── amazon/
│   │   ├── spApi.client.ts       # Low-level SP-API client
│   │   ├── catalog.adapter.ts    # Catalog Items API
│   │   ├── orders.adapter.ts     # Orders API
│   │   ├── reports.adapter.ts    # Reports API
│   │   ├── feeds.adapter.ts      # Feeds API (for updates)
│   │   └── types.ts
│   ├── keepa/
│   │   ├── keepa.client.ts
│   │   ├── product.adapter.ts
│   │   ├── deals.adapter.ts
│   │   └── types.ts
│   ├── royalmail/
│   │   ├── royalmail.client.ts
│   │   ├── shipping.adapter.ts
│   │   ├── tracking.adapter.ts
│   │   └── types.ts
│   ├── google/
│   │   ├── trends.adapter.ts
│   │   └── vision.adapter.ts     # Future
│   └── orchestrator.ts           # Coordinates multi-API operations
│
├── scoring/                      # ML Scoring Engine
│   ├── engine.ts                 # Main scoring orchestrator
│   ├── rules/
│   │   ├── seo.rules.ts          # SEO scoring rules
│   │   ├── content.rules.ts      # Content quality rules
│   │   ├── image.rules.ts        # Image scoring rules
│   │   ├── compliance.rules.ts   # UK compliance rules
│   │   └── index.ts
│   ├── benchmarking/
│   │   ├── competitor.benchmark.ts
│   │   └── category.benchmark.ts
│   ├── learning/
│   │   ├── correlation.ts        # Find change → result correlations
│   │   ├── weights.ts            # Adaptive weight adjustment
│   │   └── feedback.ts           # Incorporate outcomes
│   └── recommendations/
│       ├── generator.ts
│       └── templates.ts
│
├── automation/                   # Rules Engine
│   ├── engine.ts                 # Rule evaluation engine
│   ├── triggers/
│   │   ├── threshold.trigger.ts
│   │   ├── competitive.trigger.ts
│   │   ├── time.trigger.ts
│   │   └── event.trigger.ts
│   ├── actions/
│   │   ├── task.action.ts
│   │   ├── price.action.ts
│   │   ├── alert.action.ts
│   │   └── tag.action.ts
│   └── scheduler.ts              # Cron-based scheduling
│
├── jobs/                         # Background Job Handlers
│   ├── sync/
│   │   ├── syncListings.job.ts
│   │   ├── syncOrders.job.ts
│   │   ├── syncReports.job.ts
│   │   └── syncKeepa.job.ts
│   ├── scoring/
│   │   ├── calculateScores.job.ts
│   │   └── updateBenchmarks.job.ts
│   ├── analytics/
│   │   ├── attributeChanges.job.ts
│   │   └── detectCannibalization.job.ts
│   ├── alerts/
│   │   ├── checkCompetitors.job.ts
│   │   └── checkInventory.job.ts
│   └── queue.ts                  # BullMQ setup
│
├── db/                           # Database Layer
│   ├── prisma/
│   │   ├── schema.prisma         # Prisma schema
│   │   └── migrations/
│   ├── repositories/             # Data access patterns
│   │   ├── listing.repository.ts
│   │   ├── pricing.repository.ts
│   │   ├── competitor.repository.ts
│   │   └── ...
│   └── timescale/                # TimescaleDB specific
│       ├── queries.ts
│       └── aggregations.ts
│
├── events/                       # Event System
│   ├── bus.ts                    # Event bus implementation
│   ├── handlers/
│   │   ├── listing.handlers.ts
│   │   ├── pricing.handlers.ts
│   │   └── competitor.handlers.ts
│   └── types.ts                  # Event type definitions
│
├── utils/                        # Shared Utilities
│   ├── logger.ts
│   ├── cache.ts                  # Redis cache wrapper
│   ├── crypto.ts                 # Encryption helpers
│   ├── validation.ts
│   └── errors.ts                 # Custom error classes
│
├── config/                       # Configuration
│   ├── index.ts                  # Config loader
│   ├── database.ts
│   ├── redis.ts
│   └── integrations.ts
│
└── types/                        # Global TypeScript types
    ├── index.ts
    ├── listing.types.ts
    ├── pricing.types.ts
    └── ...
```

---

## 3. Service Interfaces

### 3.1 ListingService

```typescript
// src/services/catalog/listing.service.ts

interface ListingService {
  // CRUD
  getAll(filters: ListingFilters): Promise<PaginatedResult<Listing>>;
  getById(id: string): Promise<Listing | null>;
  getByAsin(asin: string): Promise<Listing | null>;
  getBySku(sku: string): Promise<Listing | null>;
  create(data: CreateListingDto): Promise<Listing>;
  update(id: string, data: UpdateListingDto): Promise<Listing>;
  delete(id: string): Promise<void>;

  // Batch Operations
  bulkUpdate(updates: BulkUpdateDto[]): Promise<BulkResult>;
  bulkTag(listingIds: string[], tags: string[]): Promise<void>;

  // Versioning
  getVersions(listingId: string): Promise<ListingVersion[]>;
  revertToVersion(listingId: string, versionId: string): Promise<Listing>;

  // Templates
  saveAsTemplate(listingId: string, name: string): Promise<ListingTemplate>;
  applyTemplate(listingId: string, templateId: string): Promise<Listing>;

  // Portfolio
  getByCategory(category: string): Promise<Listing[]>;
  getByTags(tags: string[]): Promise<Listing[]>;
  getByLifecycleStage(stage: LifecycleStage): Promise<Listing[]>;

  // Variations
  getParentWithChildren(parentAsin: string): Promise<ListingFamily>;
  analyzeVariationPerformance(parentAsin: string): Promise<VariationAnalysis>;

  // Apply Changes to Amazon
  pushToAmazon(listingId: string, fields: string[]): Promise<FeedSubmissionResult>;
}

interface ListingFilters {
  search?: string;
  status?: ListingStatus[];
  categories?: string[];
  tags?: string[];
  lifecycleStage?: LifecycleStage[];
  scoreRange?: { min: number; max: number };
  hasIssues?: boolean;
  sortBy?: 'score' | 'updated' | 'bsr' | 'revenue';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}
```

### 3.2 PricingService

```typescript
// src/services/pricing/pricing.service.ts

interface PricingService {
  // Current Prices
  getCurrentPrice(listingId: string): Promise<CurrentPrice>;
  updatePrice(listingId: string, price: number): Promise<CurrentPrice>;
  bulkUpdatePrices(updates: PriceUpdate[]): Promise<BulkResult>;

  // Optimization
  calculateOptimalPrice(listingId: string): Promise<PriceRecommendation>;
  runPriceOptimization(listingIds?: string[]): Promise<OptimizationResult[]>;

  // Margin Analysis
  calculateMargins(listingId: string): Promise<MarginAnalysis>;
  findMarginOpportunities(): Promise<MarginOpportunity[]>;

  // Buy Box
  analyzeBuyBox(listingId: string): Promise<BuyBoxAnalysis>;
  getBuyBoxHistory(listingId: string, days: number): Promise<BuyBoxHistory>;

  // History
  getPriceHistory(listingId: string, range: DateRange): Promise<PricePoint[]>;

  // Rules
  createRule(rule: CreatePriceRuleDto): Promise<PriceRule>;
  evaluateRules(listingId: string): Promise<RuleEvaluation[]>;
  applyRuleResult(listingId: string, ruleId: string): Promise<CurrentPrice>;

  // Push to Amazon
  pushPriceToAmazon(listingId: string): Promise<FeedSubmissionResult>;
}

interface PriceRecommendation {
  listingId: string;
  currentPrice: number;
  recommendedPrice: number;
  confidence: number;
  reasoning: {
    factor: string;
    impact: number;
    explanation: string;
  }[];
  projectedImpact: {
    marginChange: number;
    buyBoxProbability: number;
    revenueChange: number;
  };
}
```

### 3.3 CompetitorService

```typescript
// src/services/competitors/competitor.service.ts

interface CompetitorService {
  // Tracking
  getTrackedCompetitors(listingId?: string): Promise<Competitor[]>;
  addCompetitor(asin: string, forListings: string[]): Promise<Competitor>;
  removeCompetitor(competitorId: string): Promise<void>;
  setTrackingPriority(competitorId: string, priority: TrackingPriority): Promise<void>;

  // Analysis
  calculateThreatScore(competitorId: string): Promise<ThreatScore>;
  compareWithCompetitor(listingId: string, competitorId: string): Promise<CompetitorComparison>;
  findNewCompetitors(listingId: string): Promise<PotentialCompetitor[]>;

  // Alerts
  getAlerts(filters: AlertFilters): Promise<CompetitorAlert[]>;
  acknowledgeAlert(alertId: string): Promise<void>;
  createAlertRule(rule: CreateAlertRuleDto): Promise<AlertRule>;

  // History
  getCompetitorHistory(competitorId: string, range: DateRange): Promise<CompetitorHistoryPoint[]>;
  detectSignificantChanges(competitorId: string): Promise<SignificantChange[]>;

  // Insights
  getCompetitiveInsights(listingId: string): Promise<CompetitiveInsights>;
  detectPricingWar(category: string): Promise<PricingWarAnalysis | null>;
}

interface ThreatScore {
  competitorId: string;
  totalScore: number; // 0-100
  components: {
    bsrProximity: number;    // How close in BSR
    priceUndercutting: number; // Price advantage
    keywordOverlap: number;  // Keyword competition
    reviewVelocity: number;  // Review growth rate
    trendDirection: number;  // Improving or declining
  };
  recommendation: 'monitor' | 'watch_closely' | 'take_action';
}
```

### 3.4 ScoringService

```typescript
// src/services/intelligence/scoring.service.ts

interface ScoringService {
  // Scoring
  calculateScore(listingId: string): Promise<ListingScore>;
  calculateScoresBatch(listingIds: string[]): Promise<ListingScore[]>;
  recalculateAllScores(): Promise<BatchJobResult>;

  // Score Details
  getScoreBreakdown(listingId: string): Promise<ScoreBreakdown>;
  getScoreHistory(listingId: string, range: DateRange): Promise<ScorePoint[]>;

  // Benchmarking
  benchmarkAgainstCompetitors(listingId: string): Promise<CompetitiveBenchmark>;
  benchmarkAgainstCategory(listingId: string): Promise<CategoryBenchmark>;

  // Recommendations
  getRecommendations(listingId: string): Promise<Recommendation[]>;
  generateOptimizedContent(listingId: string, field: ContentField): Promise<ContentSuggestion[]>;

  // Learning
  recordOutcome(listingId: string, changeId: string, outcome: Outcome): Promise<void>;
  adjustWeights(): Promise<WeightAdjustment>;

  // Configuration
  getWeights(): Promise<ScoringWeights>;
  setWeights(weights: ScoringWeights): Promise<void>;
}

interface ListingScore {
  listingId: string;
  totalScore: number;
  components: {
    seo: ComponentScore;
    content: ComponentScore;
    images: ComponentScore;
    competitive: ComponentScore;
    compliance: ComponentScore;
  };
  issues: ScoringIssue[];
  calculatedAt: Date;
}

interface ComponentScore {
  score: number;
  maxScore: number;
  weight: number;
  metrics: {
    name: string;
    score: number;
    maxScore: number;
    details: string;
  }[];
}
```

### 3.5 AutomationService

```typescript
// src/services/workflow/automation.service.ts

interface AutomationService {
  // Rules Management
  getRules(): Promise<AutomationRule[]>;
  getRule(ruleId: string): Promise<AutomationRule>;
  createRule(rule: CreateRuleDto): Promise<AutomationRule>;
  updateRule(ruleId: string, updates: UpdateRuleDto): Promise<AutomationRule>;
  deleteRule(ruleId: string): Promise<void>;
  toggleRule(ruleId: string, active: boolean): Promise<AutomationRule>;

  // Manual Execution
  testRule(ruleId: string, listingId: string): Promise<RuleTestResult>;
  executeRule(ruleId: string, listingIds?: string[]): Promise<ExecutionResult>;

  // Evaluation
  evaluateAllRules(): Promise<void>;
  evaluateForListing(listingId: string): Promise<TriggeredRule[]>;
  evaluateForEvent(event: SystemEvent): Promise<TriggeredRule[]>;

  // History
  getRuleHistory(ruleId: string): Promise<RuleExecution[]>;
  getExecutionStats(): Promise<ExecutionStats>;
}

interface AutomationRule {
  id: string;
  name: string;
  description: string;

  trigger: {
    type: 'threshold' | 'competitive' | 'time_based' | 'event';
    config: Record<string, unknown>;
  };

  conditions: Condition[];

  action: {
    type: 'create_task' | 'update_price' | 'send_alert' | 'apply_template' | 'tag_listing';
    config: Record<string, unknown>;
  };

  cooldownMinutes: number;
  maxDailyTriggers: number | null;
  isActive: boolean;

  stats: {
    lastTriggeredAt: Date | null;
    triggerCount: number;
    successCount: number;
    failureCount: number;
  };
}
```

### 3.6 AnalyticsService

```typescript
// src/services/intelligence/analytics.service.ts

interface AnalyticsService {
  // Performance Metrics
  getPerformanceMetrics(listingId: string, range: DateRange): Promise<PerformanceMetrics>;
  getPortfolioMetrics(range: DateRange): Promise<PortfolioMetrics>;

  // Attribution
  attributeChange(listingId: string, changeId: string): Promise<AttributionResult>;
  getAttributionHistory(listingId: string): Promise<Attribution[]>;

  // Cohorts
  createCohort(criteria: CohortCriteria): Promise<Cohort>;
  compareCohorts(cohortIds: string[]): Promise<CohortComparison>;

  // Trends
  detectTrends(listingId: string): Promise<Trend[]>;
  detectSeasonality(listingId: string): Promise<SeasonalityPattern>;

  // Cannibalization
  detectCannibalization(): Promise<CannibalizationReport>;
  analyzeKeywordOverlap(listingIds: string[]): Promise<KeywordOverlapAnalysis>;

  // Forecasting
  forecastDemand(listingId: string, days: number): Promise<DemandForecast>;
  forecastBSR(listingId: string, days: number): Promise<BSRForecast>;

  // Opportunity
  findOpportunities(): Promise<Opportunity[]>;
  scoreOpportunity(listingId: string): Promise<OpportunityScore>;
}

interface PerformanceMetrics {
  listingId: string;
  range: DateRange;

  traffic: {
    sessions: number;
    sessionsChange: number;
    pageViews: number;
    pageViewsChange: number;
  };

  conversion: {
    unitsOrdered: number;
    unitsChange: number;
    conversionRate: number;
    conversionRateChange: number;
  };

  revenue: {
    total: number;
    totalChange: number;
    avgOrderValue: number;
    avgOrderValueChange: number;
  };

  buyBox: {
    percentage: number;
    percentageChange: number;
  };

  ranking: {
    currentBSR: number;
    bsrChange: number;
    organicRankAvg: number;
  };

  timeSeries: TimeSeriesPoint[];
}
```

---

## 4. API Routes

### 4.1 Route Structure

```
/api/v1
├── /listings
│   ├── GET    /                    # List listings with filters
│   ├── POST   /                    # Create listing (manual)
│   ├── GET    /:id                 # Get listing details
│   ├── PATCH  /:id                 # Update listing
│   ├── DELETE /:id                 # Delete listing
│   ├── GET    /:id/versions        # Get version history
│   ├── POST   /:id/revert/:versionId # Revert to version
│   ├── GET    /:id/score           # Get score breakdown
│   ├── POST   /:id/score/recalculate # Recalculate score
│   ├── GET    /:id/recommendations # Get optimization recommendations
│   ├── POST   /:id/push            # Push changes to Amazon
│   ├── GET    /:id/keywords        # Get keywords for listing
│   ├── GET    /:id/competitors     # Get tracked competitors
│   └── GET    /:id/analytics       # Get performance analytics
│
├── /pricing
│   ├── GET    /                    # List all prices
│   ├── GET    /:listingId          # Get price details
│   ├── PATCH  /:listingId          # Update price
│   ├── POST   /:listingId/optimize # Calculate optimal price
│   ├── POST   /:listingId/push     # Push price to Amazon
│   ├── GET    /:listingId/history  # Price history
│   ├── GET    /rules               # List price rules
│   ├── POST   /rules               # Create price rule
│   ├── PATCH  /rules/:ruleId       # Update price rule
│   └── DELETE /rules/:ruleId       # Delete price rule
│
├── /competitors
│   ├── GET    /                    # List all tracked competitors
│   ├── POST   /                    # Add competitor to track
│   ├── GET    /:id                 # Get competitor details
│   ├── DELETE /:id                 # Stop tracking competitor
│   ├── GET    /:id/history         # Competitor price/BSR history
│   ├── GET    /alerts              # Get all alerts
│   ├── PATCH  /alerts/:id          # Acknowledge alert
│   └── POST   /discover            # Find new competitors
│
├── /keywords
│   ├── GET    /                    # List all tracked keywords
│   ├── POST   /research            # Research keywords for listing
│   ├── GET    /:listingId          # Get keywords for listing
│   ├── POST   /:listingId          # Add keyword to listing
│   └── DELETE /:listingId/:keywordId # Remove keyword
│
├── /inventory
│   ├── GET    /                    # Get all inventory levels
│   ├── GET    /:listingId          # Get inventory for listing
│   ├── PATCH  /:listingId          # Update inventory
│   ├── GET    /:listingId/forecast # Get demand forecast
│   ├── GET    /suppliers           # List suppliers
│   ├── POST   /suppliers           # Add supplier
│   ├── GET    /components          # List components
│   ├── POST   /components          # Add component
│   └── GET    /:listingId/bom      # Get BOM for listing
│
├── /analytics
│   ├── GET    /dashboard           # Dashboard metrics
│   ├── GET    /portfolio           # Portfolio performance
│   ├── GET    /:listingId/metrics  # Listing performance metrics
│   ├── GET    /:listingId/attribution # Attribution analysis
│   ├── POST   /cohorts             # Create cohort analysis
│   ├── GET    /cannibalization     # Cannibalization report
│   └── GET    /opportunities       # Optimization opportunities
│
├── /tasks
│   ├── GET    /                    # List tasks (kanban)
│   ├── POST   /                    # Create task
│   ├── GET    /:id                 # Get task details
│   ├── PATCH  /:id                 # Update task
│   ├── DELETE /:id                 # Delete task
│   ├── POST   /:id/move            # Move task to stage
│   └── GET    /stages              # Get kanban stages
│
├── /automation
│   ├── GET    /rules               # List automation rules
│   ├── POST   /rules               # Create rule
│   ├── GET    /rules/:id           # Get rule details
│   ├── PATCH  /rules/:id           # Update rule
│   ├── DELETE /rules/:id           # Delete rule
│   ├── POST   /rules/:id/test      # Test rule against listing
│   └── GET    /rules/:id/history   # Rule execution history
│
├── /reports
│   ├── GET    /templates           # List report templates
│   ├── POST   /generate            # Generate report
│   ├── GET    /:id                 # Get report
│   └── GET    /:id/download        # Download report (PDF/CSV)
│
├── /sync
│   ├── POST   /listings            # Trigger listing sync
│   ├── POST   /orders              # Trigger order sync
│   ├── POST   /reports             # Trigger report sync
│   ├── GET    /status              # Get sync status
│   └── GET    /history             # Get sync history
│
└── /settings
    ├── GET    /                    # Get all settings
    ├── PATCH  /                    # Update settings
    ├── GET    /credentials         # Get credential status (not values)
    ├── POST   /credentials/amazon  # Set Amazon credentials
    ├── POST   /credentials/keepa   # Set Keepa credentials
    └── POST   /credentials/royalmail # Set Royal Mail credentials
```

---

## 5. Event System

### 5.1 Event Types

```typescript
// src/events/types.ts

type SystemEvent =
  // Listing Events
  | { type: 'listing.created'; payload: { listingId: string } }
  | { type: 'listing.updated'; payload: { listingId: string; fields: string[] } }
  | { type: 'listing.deleted'; payload: { listingId: string } }
  | { type: 'listing.synced'; payload: { listingId: string; changes: string[] } }
  | { type: 'listing.scored'; payload: { listingId: string; score: number; previousScore: number } }

  // Pricing Events
  | { type: 'price.changed'; payload: { listingId: string; oldPrice: number; newPrice: number } }
  | { type: 'price.optimized'; payload: { listingId: string; recommendation: PriceRecommendation } }
  | { type: 'buybox.won'; payload: { listingId: string } }
  | { type: 'buybox.lost'; payload: { listingId: string; wonBy: string } }

  // Competitor Events
  | { type: 'competitor.detected'; payload: { competitorId: string; forListings: string[] } }
  | { type: 'competitor.priceChanged'; payload: { competitorId: string; oldPrice: number; newPrice: number } }
  | { type: 'competitor.listingChanged'; payload: { competitorId: string; changes: string[] } }
  | { type: 'competitor.outOfStock'; payload: { competitorId: string } }

  // Inventory Events
  | { type: 'inventory.low'; payload: { listingId: string; quantity: number; threshold: number } }
  | { type: 'inventory.outOfStock'; payload: { listingId: string } }
  | { type: 'inventory.restocked'; payload: { listingId: string; quantity: number } }

  // Automation Events
  | { type: 'rule.triggered'; payload: { ruleId: string; listingId: string } }
  | { type: 'rule.executed'; payload: { ruleId: string; result: ExecutionResult } }

  // Sync Events
  | { type: 'sync.started'; payload: { syncType: string } }
  | { type: 'sync.completed'; payload: { syncType: string; results: SyncResult } }
  | { type: 'sync.failed'; payload: { syncType: string; error: string } };
```

### 5.2 Event Handlers

```typescript
// src/events/handlers/listing.handlers.ts

export const listingEventHandlers: EventHandler[] = [
  {
    event: 'listing.synced',
    handler: async ({ listingId, changes }) => {
      // Recalculate score if content changed
      if (changes.some(c => ['title', 'bullets', 'images'].includes(c))) {
        await scoringService.calculateScore(listingId);
      }
    }
  },

  {
    event: 'listing.scored',
    handler: async ({ listingId, score, previousScore }) => {
      // Check if score dropped significantly
      if (previousScore - score > 10) {
        await taskService.create({
          type: 'optimization',
          listingId,
          title: `Score dropped ${previousScore - score} points`,
          priority: 'high'
        });
      }

      // Evaluate automation rules
      await automationService.evaluateForListing(listingId);
    }
  }
];
```

---

## 6. Background Jobs

### 6.1 Job Definitions

```typescript
// src/jobs/queue.ts

export const jobDefinitions = {
  // Sync Jobs
  'sync:listings': {
    cron: '0 * * * *', // Every hour
    handler: syncListingsJob,
    options: { removeOnComplete: 100, removeOnFail: 50 }
  },

  'sync:orders': {
    cron: '*/15 * * * *', // Every 15 minutes
    handler: syncOrdersJob,
    options: { removeOnComplete: 100 }
  },

  'sync:reports': {
    cron: '0 6 * * *', // Daily at 6am
    handler: syncReportsJob,
    options: { timeout: 300000 } // 5 min timeout
  },

  'sync:keepa': {
    cron: '*/5 * * * *', // Every 5 minutes (rate-limited internally)
    handler: syncKeepaJob,
    options: { removeOnComplete: 50 }
  },

  // Scoring Jobs
  'scoring:calculate': {
    cron: '0 */4 * * *', // Every 4 hours
    handler: calculateScoresJob,
    options: { timeout: 600000 }
  },

  'scoring:benchmark': {
    cron: '0 2 * * *', // Daily at 2am
    handler: updateBenchmarksJob,
    options: { timeout: 600000 }
  },

  // Analytics Jobs
  'analytics:attribution': {
    cron: '0 3 * * *', // Daily at 3am
    handler: attributeChangesJob,
    options: { timeout: 600000 }
  },

  'analytics:seasonality': {
    cron: '0 4 * * 0', // Weekly on Sunday at 4am
    handler: detectSeasonalityJob,
    options: { timeout: 600000 }
  },

  // Competitor Jobs
  'competitors:check': {
    cron: '*/30 * * * *', // Every 30 minutes
    handler: checkCompetitorsJob,
    options: { removeOnComplete: 100 }
  },

  'competitors:discover': {
    cron: '0 5 * * *', // Daily at 5am
    handler: discoverCompetitorsJob,
    options: { timeout: 600000 }
  },

  // Automation Jobs
  'automation:evaluate': {
    cron: '*/10 * * * *', // Every 10 minutes
    handler: evaluateRulesJob,
    options: { removeOnComplete: 100 }
  },

  // Cleanup Jobs
  'cleanup:oldData': {
    cron: '0 0 * * 0', // Weekly on Sunday at midnight
    handler: cleanupOldDataJob,
    options: { timeout: 600000 }
  }
};
```

---

## Next Document: ML Scoring Engine →
