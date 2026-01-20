# Frontend Architecture

## Overview

The frontend is a React 18 application with TypeScript, designed for full mobile parity with a customizable dashboard system. It prioritizes data density for power users while maintaining clarity and usability.

---

## 1. Design System

### 1.1 Design Principles

1. **Data-Dense but Clear**: Show maximum useful information without overwhelming
2. **Action-Oriented**: Every view leads to actionable insights
3. **Consistent**: Same patterns throughout the application
4. **Responsive**: Full functionality on mobile devices
5. **Fast**: Optimistic updates, skeleton loading, data prefetching

### 1.2 Visual Language

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           DESIGN TOKENS                                          │
│                                                                                  │
│  COLORS                                                                          │
│  ─────────────────────────────────────────────────────────────────────────────  │
│  Primary:     #2563EB (Blue 600)     - Actions, links, focus states            │
│  Secondary:   #475569 (Slate 600)    - Secondary text, borders                 │
│  Success:     #16A34A (Green 600)    - Positive metrics, success states        │
│  Warning:     #D97706 (Amber 600)    - Warnings, attention needed              │
│  Danger:      #DC2626 (Red 600)      - Errors, critical alerts                 │
│  Neutral:     #F8FAFC → #0F172A      - Background spectrum (Slate)             │
│                                                                                  │
│  SCORE COLORS (Gradient)                                                         │
│  ─────────────────────────────────────────────────────────────────────────────  │
│  0-40:        #EF4444 (Red)          - Poor                                    │
│  41-60:       #F59E0B (Amber)        - Needs Work                              │
│  61-80:       #3B82F6 (Blue)         - Good                                    │
│  81-100:      #22C55E (Green)        - Excellent                               │
│                                                                                  │
│  TYPOGRAPHY                                                                      │
│  ─────────────────────────────────────────────────────────────────────────────  │
│  Font:        Inter (system fallback: -apple-system, Segoe UI)                 │
│  Headings:    font-semibold                                                    │
│  Body:        font-normal                                                      │
│  Mono:        JetBrains Mono (for data, ASINs, SKUs)                          │
│                                                                                  │
│  SPACING                                                                         │
│  ─────────────────────────────────────────────────────────────────────────────  │
│  Base unit:   4px                                                              │
│  Scale:       4, 8, 12, 16, 24, 32, 48, 64                                     │
│                                                                                  │
│  RADIUS                                                                          │
│  ─────────────────────────────────────────────────────────────────────────────  │
│  Small:       4px  (buttons, inputs)                                           │
│  Medium:      8px  (cards, modals)                                             │
│  Large:       12px (panels)                                                    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Component Library

Using shadcn/ui as the base with customizations:

```typescript
// Core Components (from shadcn/ui)
- Button, Input, Select, Checkbox, Radio
- Card, Dialog, Sheet, Popover
- Table, DataTable (with sorting, filtering)
- Tabs, Accordion
- Toast, Alert
- Command (for search)
- Calendar, DatePicker

// Custom Components (built for this app)
- ScoreGauge        - Circular score visualization
- ScoreBar          - Horizontal score with breakdown
- MetricCard        - KPI display with trend
- TrendChart        - Sparkline with context
- CompetitorRow     - Competitor comparison display
- ListingCard       - Compact listing preview
- PriceEditor       - Inline price editing with margin calc
- KanbanBoard       - Drag-and-drop task board
- TimelineChart     - Time-series with events overlay
- HeatmapCalendar   - Activity/performance calendar view
```

---

## 2. Application Structure

### 2.1 Route Structure

```
/
├── /dashboard                    # Customizable dashboard
│   └── /dashboard/edit           # Dashboard layout editor
│
├── /listings                     # Listing management
│   ├── /listings                 # List view with filters
│   ├── /listings/:id             # Listing detail
│   ├── /listings/:id/edit        # Edit listing content
│   ├── /listings/:id/score       # Score breakdown
│   ├── /listings/:id/history     # Version history
│   └── /listings/:id/analytics   # Performance analytics
│
├── /pricing                      # Pricing management
│   ├── /pricing                  # Price overview
│   ├── /pricing/rules            # Price rules
│   └── /pricing/optimization     # Optimization queue
│
├── /competitors                  # Competitive intelligence
│   ├── /competitors              # Tracked competitors
│   ├── /competitors/:id          # Competitor detail
│   ├── /competitors/alerts       # Alert center
│   └── /competitors/discover     # Discover new competitors
│
├── /keywords                     # Keyword research
│   ├── /keywords                 # Keyword overview
│   └── /keywords/research        # Research tool
│
├── /inventory                    # Inventory & BOM
│   ├── /inventory                # Stock levels
│   ├── /inventory/suppliers      # Supplier management
│   ├── /inventory/components     # Components/BOM
│   └── /inventory/forecasts      # Demand forecasting
│
├── /tasks                        # Kanban workflow
│   └── /tasks                    # Kanban board
│
├── /analytics                    # Analytics & reports
│   ├── /analytics                # Overview
│   ├── /analytics/attribution    # Change attribution
│   ├── /analytics/cohorts        # Cohort analysis
│   └── /analytics/opportunities  # Opportunity finder
│
├── /reports                      # Report generation
│   ├── /reports                  # Report list
│   └── /reports/generate         # Generate new report
│
├── /automation                   # Automation rules
│   ├── /automation               # Rule list
│   └── /automation/new           # Create rule
│
└── /settings                     # Settings
    ├── /settings                 # General settings
    ├── /settings/integrations    # API integrations
    ├── /settings/scoring         # Scoring weights
    └── /settings/notifications   # Notification preferences
```

### 2.2 Directory Structure

```
src/
├── app/                          # Next.js App Router (or React Router)
│   ├── layout.tsx                # Root layout
│   ├── page.tsx                  # Home redirect
│   ├── dashboard/
│   ├── listings/
│   ├── pricing/
│   └── ...
│
├── components/
│   ├── ui/                       # Base UI components (shadcn)
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── data-table.tsx
│   │   └── ...
│   │
│   ├── common/                   # Shared application components
│   │   ├── Header.tsx
│   │   ├── Sidebar.tsx
│   │   ├── PageHeader.tsx
│   │   ├── LoadingState.tsx
│   │   ├── ErrorBoundary.tsx
│   │   └── EmptyState.tsx
│   │
│   ├── dashboard/                # Dashboard-specific components
│   │   ├── DashboardGrid.tsx
│   │   ├── WidgetWrapper.tsx
│   │   └── widgets/
│   │       ├── ScoreOverviewWidget.tsx
│   │       ├── AlertsWidget.tsx
│   │       ├── TopListingsWidget.tsx
│   │       ├── RevenueWidget.tsx
│   │       ├── TasksWidget.tsx
│   │       └── CompetitorWidget.tsx
│   │
│   ├── listings/                 # Listing components
│   │   ├── ListingTable.tsx
│   │   ├── ListingCard.tsx
│   │   ├── ListingFilters.tsx
│   │   ├── ListingDetail.tsx
│   │   ├── ListingEditor.tsx
│   │   ├── ScoreBreakdown.tsx
│   │   ├── RecommendationList.tsx
│   │   ├── VersionHistory.tsx
│   │   └── BulletPointEditor.tsx
│   │
│   ├── pricing/                  # Pricing components
│   │   ├── PriceTable.tsx
│   │   ├── PriceEditor.tsx
│   │   ├── MarginCalculator.tsx
│   │   ├── PriceRuleBuilder.tsx
│   │   ├── BuyBoxAnalysis.tsx
│   │   └── OptimizationQueue.tsx
│   │
│   ├── competitors/              # Competitor components
│   │   ├── CompetitorTable.tsx
│   │   ├── CompetitorDetail.tsx
│   │   ├── ThreatScoreCard.tsx
│   │   ├── AlertList.tsx
│   │   └── PriceComparison.tsx
│   │
│   ├── analytics/                # Analytics components
│   │   ├── PerformanceChart.tsx
│   │   ├── MetricCard.tsx
│   │   ├── TrendIndicator.tsx
│   │   ├── AttributionView.tsx
│   │   ├── CohortTable.tsx
│   │   └── OpportunityCard.tsx
│   │
│   ├── tasks/                    # Task/Kanban components
│   │   ├── KanbanBoard.tsx
│   │   ├── KanbanColumn.tsx
│   │   ├── TaskCard.tsx
│   │   ├── TaskDetail.tsx
│   │   └── TaskFilters.tsx
│   │
│   ├── charts/                   # Chart components
│   │   ├── ScoreGauge.tsx
│   │   ├── ScoreBar.tsx
│   │   ├── TimeSeriesChart.tsx
│   │   ├── BarChart.tsx
│   │   ├── Sparkline.tsx
│   │   ├── HeatmapCalendar.tsx
│   │   └── ComparisonChart.tsx
│   │
│   └── forms/                    # Form components
│       ├── ListingForm.tsx
│       ├── PriceRuleForm.tsx
│       ├── AutomationRuleForm.tsx
│       └── SettingsForm.tsx
│
├── hooks/                        # Custom React hooks
│   ├── useListings.ts
│   ├── usePricing.ts
│   ├── useCompetitors.ts
│   ├── useAnalytics.ts
│   ├── useTasks.ts
│   ├── useWebSocket.ts
│   ├── useDebounce.ts
│   └── useLocalStorage.ts
│
├── stores/                       # Zustand stores
│   ├── dashboardStore.ts
│   ├── listingStore.ts
│   ├── filterStore.ts
│   ├── taskStore.ts
│   └── notificationStore.ts
│
├── api/                          # API client
│   ├── client.ts                 # Axios/fetch setup
│   ├── listings.api.ts
│   ├── pricing.api.ts
│   ├── competitors.api.ts
│   ├── analytics.api.ts
│   └── types.ts
│
├── lib/                          # Utility libraries
│   ├── utils.ts
│   ├── formatters.ts
│   ├── validators.ts
│   └── constants.ts
│
├── types/                        # TypeScript types
│   ├── listing.types.ts
│   ├── pricing.types.ts
│   ├── competitor.types.ts
│   ├── analytics.types.ts
│   └── api.types.ts
│
└── styles/
    ├── globals.css
    └── tailwind.css
```

---

## 3. Key Page Layouts

### 3.1 Dashboard (Customizable)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ [Logo]  Dashboard    Listings    Pricing    Competitors    ...     [🔔] [👤]   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  CUSTOMIZABLE WIDGET GRID (react-grid-layout)                           │    │
│  │                                                                          │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │    │
│  │  │ Portfolio Score │  │ Revenue (30d)   │  │ Urgent Alerts           │  │    │
│  │  │                 │  │                 │  │                         │  │    │
│  │  │    [78]        │  │  £12,450        │  │ • Competitor undercut   │  │    │
│  │  │   ████████░░   │  │  ↑ 12% vs prev  │  │ • Low stock: SKU-123   │  │    │
│  │  │                 │  │  [sparkline]    │  │ • Score drop: ASIN-X   │  │    │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────────┘  │    │
│  │                                                                          │    │
│  │  ┌─────────────────────────────────────┐  ┌─────────────────────────┐  │    │
│  │  │ Score Distribution                  │  │ Tasks Due Today         │  │    │
│  │  │                                     │  │                         │  │    │
│  │  │  Excellent ████████████ 45         │  │ □ Optimize ASIN-A       │  │    │
│  │  │  Good      ████████ 32             │  │ □ Review pricing B      │  │    │
│  │  │  Fair      ████ 18                 │  │ □ Update images C       │  │    │
│  │  │  Poor      ██ 5                    │  │                         │  │    │
│  │  └─────────────────────────────────────┘  └─────────────────────────┘  │    │
│  │                                                                          │    │
│  │  ┌───────────────────────────────────────────────────────────────────┐  │    │
│  │  │ Listings Needing Attention                                        │  │    │
│  │  │                                                                   │  │    │
│  │  │ ASIN        Title                    Score   Issue        Action  │  │    │
│  │  │ B08XXX123   DeWalt 18V Drill...     [52]    Low images   [Fix]   │  │    │
│  │  │ B07YYY456   Makita Screwdriver...   [48]    Title SEO    [Fix]   │  │    │
│  │  │ B09ZZZ789   Bosch Accessory Kit...  [61]    Missing A+   [Fix]   │  │    │
│  │  └───────────────────────────────────────────────────────────────────┘  │    │
│  │                                                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│                                            [Edit Dashboard] [Reset Layout]      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Listing Detail Page

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ ← Back to Listings                                    [Edit] [Push to Amazon]   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │ B08XXX123 • Active • Power Tools                                        │    │
│  │                                                                          │    │
│  │ DeWalt DCD778D2T-GB 18V XR Brushless Combi Drill with 2x 2.0Ah...      │    │
│  │                                                                          │    │
│  │ Tags: [bestseller] [mature] [priority]                    [+ Add Tag]   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ Overall     │  │ Price       │  │ BSR         │  │ Buy Box     │            │
│  │ Score       │  │             │  │             │  │             │            │
│  │   [78]     │  │  £149.99   │  │  #2,450    │  │  ✓ 94%     │            │
│  │  ↑ 5 pts   │  │  ↑ £5.00   │  │  ↑ 120     │  │  ↑ 2%      │            │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │ [Score] [Content] [Images] [Keywords] [Competitors] [Analytics] [History]│    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │                                                                          │    │
│  │  SCORE BREAKDOWN                                                         │    │
│  │                                                                          │    │
│  │  SEO                 [████████░░] 82/100                                │    │
│  │  ├─ Title Length     [██████████] 100  ✓ 176 chars                     │    │
│  │  ├─ Keyword Placement[████████░░] 85   Primary keyword at pos 12       │    │
│  │  ├─ Backend Keywords [██████░░░░] 65   ⚠ 180/249 bytes used           │    │
│  │  └─ Category         [██████████] 100  ✓ Optimal category              │    │
│  │                                                                          │    │
│  │  Content             [████████░░] 78/100                                │    │
│  │  ├─ Bullet Points    [████████░░] 80   5/5 bullets, good length        │    │
│  │  ├─ Description      [██████░░░░] 60   ⚠ Could use more detail        │    │
│  │  ├─ A+ Content       [██████████] 100  ✓ A+ enabled with 6 modules    │    │
│  │  └─ Persuasion       [██████░░░░] 65   Missing social proof           │    │
│  │                                                                          │    │
│  │  Images              [██████░░░░] 68/100                                │    │
│  │  ├─ Image Count      [████████░░] 80   7/9 images                      │    │
│  │  ├─ Main Image       [██████████] 100  ✓ High quality, white BG       │    │
│  │  └─ Secondary        [████░░░░░░] 40   ⚠ Missing infographic          │    │
│  │                                                                          │    │
│  │  ──────────────────────────────────────────────────────────────────     │    │
│  │                                                                          │    │
│  │  RECOMMENDATIONS (3 items)                                  [Apply All]  │    │
│  │                                                                          │    │
│  │  ┌─ HIGH ──────────────────────────────────────────────────────────┐   │    │
│  │  │ Add infographic image showing drill specifications              │   │    │
│  │  │ Current: No infographic │ Impact: +8 pts │ Effort: Moderate    │   │    │
│  │  │                                                     [Create Task]│   │    │
│  │  └─────────────────────────────────────────────────────────────────┘   │    │
│  │                                                                          │    │
│  │  ┌─ MEDIUM ────────────────────────────────────────────────────────┐   │    │
│  │  │ Add social proof to bullet points                               │   │    │
│  │  │ Suggestion: "Best selling drill in UK - over 10,000 sold"      │   │    │
│  │  │                                               [Apply] [Dismiss] │   │    │
│  │  └─────────────────────────────────────────────────────────────────┘   │    │
│  │                                                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Kanban Board

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Tasks                                           [+ New Task] [Filter] [Sort]    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Filters: [All Categories ▼] [All Priorities ▼] [My Tasks ▼]    🔍 Search...   │
│                                                                                  │
│  ┌───────────────┬───────────────┬───────────────┬───────────────┬───────────┐ │
│  │   Backlog     │  To Analyze   │  In Progress  │    Review     │   Done    │ │
│  │      12       │       5       │       3       │       2       │     45    │ │
│  ├───────────────┼───────────────┼───────────────┼───────────────┼───────────┤ │
│  │               │               │               │               │           │ │
│  │ ┌───────────┐ │ ┌───────────┐ │ ┌───────────┐ │ ┌───────────┐ │ ┌───────┐ │ │
│  │ │ ⚡ HIGH    │ │ │ 🔵 MED    │ │ │ ⚡ HIGH    │ │ │ 🔵 MED    │ │ │ ✓     │ │ │
│  │ │           │ │ │           │ │ │           │ │ │           │ │ │       │ │ │
│  │ │ Optimize  │ │ │ Research  │ │ │ Update    │ │ │ Verify    │ │ │ Fixed │ │ │
│  │ │ B08XXX123 │ │ │ keywords  │ │ │ images    │ │ │ pricing   │ │ │ title │ │ │
│  │ │           │ │ │ for drills│ │ │ B07YYY456 │ │ │ B09ZZZ789 │ │ │       │ │ │
│  │ │ Score: 52 │ │ │           │ │ │           │ │ │           │ │ │       │ │ │
│  │ │ Due: Today│ │ │ Due: Fri  │ │ │ Started   │ │ │ Ready to  │ │ │ 2d ago│ │ │
│  │ └───────────┘ │ └───────────┘ │ │ 2h ago    │ │ │ deploy    │ │ └───────┘ │ │
│  │               │               │ └───────────┘ │ └───────────┘ │           │ │
│  │ ┌───────────┐ │ ┌───────────┐ │               │               │ ┌───────┐ │ │
│  │ │ 🔵 MED    │ │ │ ⚪ LOW    │ │ ┌───────────┐ │               │ │ ✓     │ │ │
│  │ │           │ │ │           │ │ │ 🔵 MED    │ │               │ │       │ │ │
│  │ │ Review    │ │ │ Check     │ │ │           │ │               │ │ Added │ │ │
│  │ │ competitor│ │ │ seasonal  │ │ │ Write     │ │               │ │ A+    │ │ │
│  │ │ prices    │ │ │ trends    │ │ │ new       │ │               │ │       │ │ │
│  │ │           │ │ │           │ │ │ bullets   │ │               │ │ 3d ago│ │ │
│  │ └───────────┘ │ └───────────┘ │ └───────────┘ │               │ └───────┘ │ │
│  │               │               │               │               │           │ │
│  │ ┌───────────┐ │               │               │               │           │ │
│  │ │ ⚪ LOW    │ │               │               │               │           │ │
│  │ │           │ │               │               │               │           │ │
│  │ │ Update    │ │               │               │               │           │ │
│  │ │ backend   │ │               │               │               │           │ │
│  │ │ keywords  │ │               │               │               │           │ │
│  │ └───────────┘ │               │               │               │           │ │
│  │               │               │               │               │           │ │
│  │   [+ Add]     │   [+ Add]     │   [+ Add]     │               │           │ │
│  └───────────────┴───────────────┴───────────────┴───────────────┴───────────┘ │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. State Management

### 4.1 Store Architecture

```typescript
// Using Zustand for global state + React Query for server state

// Global UI State (Zustand)
interface UIStore {
  sidebarOpen: boolean;
  activeModal: string | null;
  selectedListings: string[];
  filters: FilterState;

  // Actions
  toggleSidebar: () => void;
  openModal: (modal: string) => void;
  closeModal: () => void;
  selectListing: (id: string) => void;
  setFilters: (filters: Partial<FilterState>) => void;
}

// Dashboard State (Zustand + localStorage persistence)
interface DashboardStore {
  layout: DashboardLayout;
  widgets: WidgetConfig[];

  // Actions
  updateLayout: (layout: DashboardLayout) => void;
  addWidget: (widget: WidgetConfig) => void;
  removeWidget: (widgetId: string) => void;
  updateWidgetConfig: (widgetId: string, config: Partial<WidgetConfig>) => void;
  resetToDefault: () => void;
}

// Notification State (Zustand)
interface NotificationStore {
  notifications: Notification[];
  unreadCount: number;

  // Actions
  addNotification: (notification: Notification) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  dismissNotification: (id: string) => void;
}
```

### 4.2 Server State (React Query)

```typescript
// src/hooks/useListings.ts

export function useListings(filters: ListingFilters) {
  return useQuery({
    queryKey: ['listings', filters],
    queryFn: () => listingsApi.getAll(filters),
    staleTime: 60 * 1000, // 1 minute
  });
}

export function useListing(id: string) {
  return useQuery({
    queryKey: ['listing', id],
    queryFn: () => listingsApi.getById(id),
    staleTime: 30 * 1000,
  });
}

export function useListingScore(id: string) {
  return useQuery({
    queryKey: ['listing', id, 'score'],
    queryFn: () => listingsApi.getScore(id),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useUpdateListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateListingDto }) =>
      listingsApi.update(id, data),

    // Optimistic update
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['listing', id] });
      const previous = queryClient.getQueryData(['listing', id]);
      queryClient.setQueryData(['listing', id], (old: Listing) => ({
        ...old,
        ...data,
      }));
      return { previous };
    },

    onError: (err, variables, context) => {
      queryClient.setQueryData(['listing', variables.id], context?.previous);
    },

    onSettled: (data, error, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['listing', id] });
      queryClient.invalidateQueries({ queryKey: ['listings'] });
    },
  });
}
```

---

## 5. Real-Time Updates

### 5.1 WebSocket Integration

```typescript
// src/hooks/useWebSocket.ts

interface WebSocketMessage {
  type: string;
  payload: unknown;
}

export function useWebSocket() {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore();

  useEffect(() => {
    const ws = new WebSocket(import.meta.env.VITE_WS_URL);

    ws.onmessage = (event) => {
      const message: WebSocketMessage = JSON.parse(event.data);

      switch (message.type) {
        case 'listing.scored':
          // Invalidate listing queries
          queryClient.invalidateQueries({
            queryKey: ['listing', message.payload.listingId],
          });
          break;

        case 'competitor.alert':
          // Add notification and invalidate
          addNotification({
            type: 'alert',
            title: 'Competitor Alert',
            message: message.payload.message,
            listingId: message.payload.listingId,
          });
          queryClient.invalidateQueries({ queryKey: ['competitors', 'alerts'] });
          break;

        case 'sync.completed':
          // Refresh all listings
          queryClient.invalidateQueries({ queryKey: ['listings'] });
          break;

        case 'price.changed':
          queryClient.invalidateQueries({
            queryKey: ['pricing', message.payload.listingId],
          });
          break;
      }
    };

    return () => ws.close();
  }, [queryClient, addNotification]);
}
```

---

## 6. Key Components

### 6.1 Score Gauge Component

```typescript
// src/components/charts/ScoreGauge.tsx

interface ScoreGaugeProps {
  score: number;
  maxScore?: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  trend?: number; // +/- change
}

export function ScoreGauge({
  score,
  maxScore = 100,
  size = 'md',
  showLabel = true,
  trend,
}: ScoreGaugeProps) {
  const percentage = (score / maxScore) * 100;
  const color = getScoreColor(percentage);

  const sizes = {
    sm: { width: 60, strokeWidth: 6, fontSize: 14 },
    md: { width: 100, strokeWidth: 8, fontSize: 24 },
    lg: { width: 140, strokeWidth: 10, fontSize: 32 },
  };

  const { width, strokeWidth, fontSize } = sizes[size];
  const radius = (width - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={width} height={width} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={width / 2}
          cy={width / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-slate-200"
        />
        {/* Progress circle */}
        <circle
          cx={width / 2}
          cy={width / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-500"
        />
      </svg>

      {showLabel && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span style={{ fontSize }} className="font-semibold text-slate-900">
            {Math.round(score)}
          </span>
          {trend !== undefined && (
            <span
              className={cn(
                'text-xs',
                trend > 0 ? 'text-green-600' : trend < 0 ? 'text-red-600' : 'text-slate-400'
              )}
            >
              {trend > 0 ? '↑' : trend < 0 ? '↓' : '–'} {Math.abs(trend)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function getScoreColor(percentage: number): string {
  if (percentage >= 81) return '#22C55E'; // Green
  if (percentage >= 61) return '#3B82F6'; // Blue
  if (percentage >= 41) return '#F59E0B'; // Amber
  return '#EF4444'; // Red
}
```

### 6.2 Listing Table with Virtual Scrolling

```typescript
// src/components/listings/ListingTable.tsx

import { useVirtualizer } from '@tanstack/react-virtual';

interface ListingTableProps {
  listings: Listing[];
  onSelect: (listing: Listing) => void;
  selectedIds: string[];
}

export function ListingTable({ listings, onSelect, selectedIds }: ListingTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: listings.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64, // Row height
    overscan: 10,
  });

  return (
    <div ref={parentRef} className="h-[600px] overflow-auto">
      <table className="w-full">
        <thead className="sticky top-0 bg-white z-10">
          <tr className="border-b">
            <th className="w-10 p-2">
              <Checkbox
                checked={selectedIds.length === listings.length}
                onCheckedChange={(checked) => {
                  // Select all / none
                }}
              />
            </th>
            <th className="text-left p-2">Product</th>
            <th className="text-left p-2 w-20">Score</th>
            <th className="text-left p-2 w-24">Price</th>
            <th className="text-left p-2 w-20">BSR</th>
            <th className="text-left p-2 w-20">Buy Box</th>
            <th className="text-left p-2 w-24">Status</th>
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const listing = listings[virtualRow.index];
            const isSelected = selectedIds.includes(listing.id);

            return (
              <tr
                key={listing.id}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className={cn(
                  'border-b hover:bg-slate-50 cursor-pointer',
                  isSelected && 'bg-blue-50'
                )}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onClick={() => onSelect(listing)}
              >
                <td className="p-2">
                  <Checkbox
                    checked={isSelected}
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
                <td className="p-2">
                  <div className="flex items-center gap-3">
                    <img
                      src={listing.mainImage || '/placeholder.png'}
                      alt=""
                      className="w-10 h-10 object-cover rounded"
                    />
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate max-w-[300px]">
                        {listing.title}
                      </p>
                      <p className="text-xs text-slate-500 font-mono">
                        {listing.asin} • {listing.sku}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="p-2">
                  <ScoreGauge score={listing.currentScore || 0} size="sm" />
                </td>
                <td className="p-2 font-medium">
                  £{listing.price?.toFixed(2)}
                </td>
                <td className="p-2 text-sm">
                  {listing.bsr ? `#${listing.bsr.toLocaleString()}` : '–'}
                </td>
                <td className="p-2">
                  {listing.hasBuyBox ? (
                    <Badge variant="success">✓ {listing.buyBoxPct}%</Badge>
                  ) : (
                    <Badge variant="warning">Lost</Badge>
                  )}
                </td>
                <td className="p-2">
                  <Badge variant={listing.status === 'active' ? 'default' : 'secondary'}>
                    {listing.status}
                  </Badge>
                </td>
                <td className="p-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger>
                      <Button variant="ghost" size="sm">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem>View Details</DropdownMenuItem>
                      <DropdownMenuItem>Edit</DropdownMenuItem>
                      <DropdownMenuItem>Recalculate Score</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem>View on Amazon</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

### 6.3 Customizable Dashboard Grid

```typescript
// src/components/dashboard/DashboardGrid.tsx

import GridLayout from 'react-grid-layout';

interface DashboardGridProps {
  layout: Layout[];
  widgets: WidgetConfig[];
  onLayoutChange: (layout: Layout[]) => void;
  isEditing: boolean;
}

export function DashboardGrid({
  layout,
  widgets,
  onLayoutChange,
  isEditing,
}: DashboardGridProps) {
  const widgetComponents: Record<string, React.FC<WidgetProps>> = {
    scoreOverview: ScoreOverviewWidget,
    alerts: AlertsWidget,
    topListings: TopListingsWidget,
    revenue: RevenueWidget,
    tasks: TasksWidget,
    competitors: CompetitorWidget,
    scoreDistribution: ScoreDistributionWidget,
    recentChanges: RecentChangesWidget,
  };

  return (
    <GridLayout
      className="layout"
      layout={layout}
      cols={12}
      rowHeight={80}
      width={1200}
      onLayoutChange={onLayoutChange}
      isDraggable={isEditing}
      isResizable={isEditing}
      draggableHandle=".widget-handle"
    >
      {widgets.map((widget) => {
        const WidgetComponent = widgetComponents[widget.type];

        return (
          <div key={widget.id} className="bg-white rounded-lg shadow-sm border">
            <WidgetWrapper
              title={widget.title}
              isEditing={isEditing}
              onRemove={() => onRemoveWidget(widget.id)}
              onConfigure={() => onConfigureWidget(widget.id)}
            >
              <WidgetComponent config={widget.config} />
            </WidgetWrapper>
          </div>
        );
      })}
    </GridLayout>
  );
}

// Widget Wrapper with drag handle and controls
function WidgetWrapper({
  title,
  children,
  isEditing,
  onRemove,
  onConfigure,
}: WidgetWrapperProps) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          {isEditing && (
            <GripVertical className="h-4 w-4 text-slate-400 widget-handle cursor-move" />
          )}
          <h3 className="font-medium text-sm">{title}</h3>
        </div>
        {isEditing && (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={onConfigure}>
              <Settings className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onRemove}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
      <div className="flex-1 p-3 overflow-auto">{children}</div>
    </div>
  );
}
```

---

## 7. Mobile Responsiveness

### 7.1 Responsive Patterns

```typescript
// Responsive breakpoints
const breakpoints = {
  sm: '640px',   // Mobile landscape
  md: '768px',   // Tablet
  lg: '1024px',  // Desktop
  xl: '1280px',  // Large desktop
};

// Mobile navigation - bottom tabs
export function MobileNavigation() {
  const location = useLocation();

  const tabs = [
    { path: '/dashboard', icon: Home, label: 'Home' },
    { path: '/listings', icon: Package, label: 'Listings' },
    { path: '/tasks', icon: CheckSquare, label: 'Tasks' },
    { path: '/alerts', icon: Bell, label: 'Alerts' },
    { path: '/more', icon: Menu, label: 'More' },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t md:hidden">
      <div className="flex justify-around">
        {tabs.map((tab) => (
          <Link
            key={tab.path}
            to={tab.path}
            className={cn(
              'flex flex-col items-center py-2 px-3',
              location.pathname.startsWith(tab.path)
                ? 'text-blue-600'
                : 'text-slate-600'
            )}
          >
            <tab.icon className="h-5 w-5" />
            <span className="text-xs mt-1">{tab.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

// Responsive table that becomes cards on mobile
export function ResponsiveListingTable({ listings }: { listings: Listing[] }) {
  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block">
        <ListingTable listings={listings} />
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {listings.map((listing) => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
      </div>
    </>
  );
}
```

---

## 8. Performance Optimizations

### 8.1 Code Splitting

```typescript
// Lazy load routes
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Listings = lazy(() => import('./pages/Listings'));
const ListingDetail = lazy(() => import('./pages/ListingDetail'));
const Analytics = lazy(() => import('./pages/Analytics'));

// With loading fallback
function App() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/listings" element={<Listings />} />
        <Route path="/listings/:id" element={<ListingDetail />} />
        <Route path="/analytics" element={<Analytics />} />
      </Routes>
    </Suspense>
  );
}
```

### 8.2 Data Prefetching

```typescript
// Prefetch on hover
export function ListingRow({ listing }: { listing: Listing }) {
  const queryClient = useQueryClient();

  const handleMouseEnter = () => {
    // Prefetch listing detail
    queryClient.prefetchQuery({
      queryKey: ['listing', listing.id],
      queryFn: () => listingsApi.getById(listing.id),
      staleTime: 60 * 1000,
    });
  };

  return (
    <tr onMouseEnter={handleMouseEnter}>
      {/* ... */}
    </tr>
  );
}
```

---

## Next Document: Integration Layer →
