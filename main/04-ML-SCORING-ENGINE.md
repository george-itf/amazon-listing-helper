# ML Scoring Engine Architecture

## Overview

The ML Scoring Engine is the intelligence core of the system. It analyzes listings across multiple dimensions, benchmarks against competitors, learns from outcomes, and generates actionable recommendations.

---

## 1. Scoring Philosophy

### 1.1 Design Principles

1. **Conversion-Centric**: All metrics ultimately tie back to conversion impact
2. **Category-Aware**: DIY & Tools has specific patterns we optimize for
3. **Data-Driven Weights**: Weights adjust based on observed correlations
4. **Transparent**: Every score is explainable with clear reasoning
5. **Actionable**: Scores translate directly into improvement recommendations

### 1.2 Scoring Framework

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           SCORING FRAMEWORK                                      │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                         TOTAL SCORE (0-100)                              │    │
│  │                                                                          │    │
│  │   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐      │    │
│  │   │   SEO   │  │ Content │  │ Images  │  │Competitv│  │Complianc│      │    │
│  │   │  Score  │  │  Score  │  │  Score  │  │  Score  │  │  Score  │      │    │
│  │   │   25%   │  │   25%   │  │   20%   │  │   15%   │  │   15%   │      │    │
│  │   └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘      │    │
│  │        │            │            │            │            │            │    │
│  │   ┌────┴────┐  ┌────┴────┐  ┌────┴────┐  ┌────┴────┐  ┌────┴────┐      │    │
│  │   │ Metrics │  │ Metrics │  │ Metrics │  │ Metrics │  │ Metrics │      │    │
│  │   │ - Title │  │ - Bullets│  │ - Count │  │ - Price │  │ - Policy│      │    │
│  │   │ - Keywords│ │ - A+    │  │ - Quality│ │ - BSR   │  │ - Attrs │      │    │
│  │   │ - Backend│  │ - EBC   │  │ - Format│  │ - Reviews│ │ - Safety│      │    │
│  │   └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘      │    │
│  │                                                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                      ADAPTIVE WEIGHT SYSTEM                              │    │
│  │                                                                          │    │
│  │   Base Weights → Category Adjustments → Performance Correlation →        │    │
│  │   → Final Weights                                                        │    │
│  │                                                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Scores

### 2.1 SEO Score (25%)

Measures discoverability and search ranking potential.

```typescript
interface SEOScore {
  totalScore: number;  // 0-100

  metrics: {
    // Title Optimization (35% of SEO score)
    titleLength: {
      score: number;
      value: number;      // Actual character count
      optimal: [number, number]; // Optimal range [150, 200]
      explanation: string;
    };

    titleKeywordPlacement: {
      score: number;
      primaryKeywordPosition: number | null;
      topKeywordsPresent: string[];
      missingKeywords: string[];
      explanation: string;
    };

    titleReadability: {
      score: number;
      hasAllCaps: boolean;
      hasKeywordStuffing: boolean;
      brandPosition: 'front' | 'end' | 'missing';
      explanation: string;
    };

    // Backend Keywords (25% of SEO score)
    searchTermsUsage: {
      score: number;
      characterCount: number;
      maxAllowed: number;   // 249 bytes for UK
      uniqueKeywords: number;
      duplicatesWithFrontend: string[];
      explanation: string;
    };

    searchTermsQuality: {
      score: number;
      hasCommas: boolean;   // Shouldn't have
      hasRepetition: boolean;
      misspellingsCovered: boolean;
      spanishVariants: boolean; // For UK, less relevant
      explanation: string;
    };

    // Keyword Ranking (25% of SEO score)
    keywordRankings: {
      score: number;
      trackedKeywords: number;
      page1Rankings: number;
      avgPosition: number | null;
      topRankingKeyword: { keyword: string; position: number } | null;
      explanation: string;
    };

    // Category & Browse Node (15% of SEO score)
    categoryOptimization: {
      score: number;
      primaryCategory: string;
      browseNodePath: string[];
      isOptimalCategory: boolean;
      suggestedCategories: string[];
      explanation: string;
    };
  };
}
```

### 2.2 Content Score (25%)

Measures persuasiveness and conversion potential of copy.

```typescript
interface ContentScore {
  totalScore: number;

  metrics: {
    // Bullet Points (40% of Content score)
    bulletCount: {
      score: number;
      count: number;
      optimal: number;  // 5
      explanation: string;
    };

    bulletLength: {
      score: number;
      avgLength: number;
      minLength: number;
      maxLength: number;
      optimal: [number, number]; // [150, 250] chars
      explanation: string;
    };

    bulletStructure: {
      score: number;
      hasCapitalizedStart: boolean[];
      hasBenefitFocus: boolean[];
      hasFeatureDump: boolean;  // Bad pattern
      usesFormatting: boolean;  // CAPS for emphasis
      explanation: string;
    };

    bulletKeywords: {
      score: number;
      keywordsPerBullet: number[];
      keywordDensity: number;
      isOverStuffed: boolean;
      explanation: string;
    };

    // Description (20% of Content score)
    descriptionQuality: {
      score: number;
      length: number;
      hasHTML: boolean;
      hasFormatting: boolean;
      readabilityScore: number; // Flesch-Kincaid adapted
      explanation: string;
    };

    // A+ Content (25% of Content score)
    aplusPresence: {
      score: number;
      hasAplus: boolean;
      moduleCount: number;
      hasComparisonChart: boolean;
      hasBrandStory: boolean;
      imageCount: number;
      explanation: string;
    };

    // Emotional & Persuasive Elements (15% of Content score)
    persuasionScore: {
      score: number;
      hasSocialProof: boolean;      // "Best selling", "Award winning"
      hasUrgency: boolean;          // Limited time, etc.
      hasBenefits: boolean;         // Not just features
      hasSpecifications: boolean;   // Technical details for DIY
      explanation: string;
    };
  };
}
```

### 2.3 Image Score (20%)

Measures visual appeal and compliance.

```typescript
interface ImageScore {
  totalScore: number;

  metrics: {
    // Image Count (30% of Image score)
    imageCount: {
      score: number;
      count: number;
      optimal: number;  // 7-9
      hasMain: boolean;
      explanation: string;
    };

    // Main Image Quality (35% of Image score)
    mainImageQuality: {
      score: number;
      dimensions: { width: number; height: number };
      isSquare: boolean;
      meetsMinSize: boolean;  // 1000x1000 for zoom
      hasWhiteBackground: boolean;
      fillsFrame: boolean;   // Product fills 85%+
      hasText: boolean;      // Should be false for main
      hasWatermark: boolean; // Should be false
      explanation: string;
    };

    // Secondary Images (25% of Image score)
    secondaryImagesQuality: {
      score: number;
      hasLifestyle: boolean;
      hasInfographic: boolean;
      hasScaleReference: boolean;
      hasDimensionImage: boolean;
      hasPackageContents: boolean;
      hasInUseShot: boolean;
      varietyScore: number;
      explanation: string;
    };

    // Technical Quality (10% of Image score)
    technicalQuality: {
      score: number;
      avgResolution: number;
      allMeetMinimum: boolean;
      hasConsistentStyle: boolean;
      explanation: string;
    };
  };
}
```

### 2.4 Competitive Score (15%)

Measures position relative to competitors.

```typescript
interface CompetitiveScore {
  totalScore: number;

  metrics: {
    // Price Position (35% of Competitive score)
    pricePosition: {
      score: number;
      currentPrice: number;
      avgCompetitorPrice: number;
      pricePercentile: number;  // Where you sit in price range
      isCompetitive: boolean;
      explanation: string;
    };

    // BSR Position (25% of Competitive score)
    bsrPosition: {
      score: number;
      currentBSR: number | null;
      categoryBSR: number | null;
      bsrTrend: 'improving' | 'stable' | 'declining';
      bsrPercentile: number;
      explanation: string;
    };

    // Review Strength (25% of Competitive score)
    reviewStrength: {
      score: number;
      reviewCount: number;
      avgRating: number;
      vsCompetitorAvgCount: number;
      vsCompetitorAvgRating: number;
      recentReviewVelocity: number;
      explanation: string;
    };

    // Listing Completeness vs Competitors (15% of Competitive score)
    completenessVsCompetitors: {
      score: number;
      yourCompleteness: number;
      avgCompetitorCompleteness: number;
      advantageAreas: string[];
      disadvantageAreas: string[];
      explanation: string;
    };
  };
}
```

### 2.5 Compliance Score (15%)

Measures adherence to Amazon UK policies and best practices.

```typescript
interface ComplianceScore {
  totalScore: number;

  metrics: {
    // Policy Compliance (40% of Compliance score)
    policyCompliance: {
      score: number;
      violations: PolicyViolation[];
      warnings: PolicyWarning[];
      passedChecks: string[];
      explanation: string;
    };

    // Required Attributes (30% of Compliance score)
    attributeCompleteness: {
      score: number;
      requiredAttributes: string[];
      missingRequired: string[];
      recommendedMissing: string[];
      completionPercentage: number;
      explanation: string;
    };

    // UK-Specific Compliance (20% of Compliance score)
    ukCompliance: {
      score: number;
      hasUKCAMark: boolean | null;  // If applicable
      hasCEMark: boolean | null;    // If applicable
      hasCorrectUnits: boolean;     // Metric vs Imperial
      hasVATInfo: boolean;
      hasReturnPolicy: boolean;
      explanation: string;
    };

    // Safety & Restricted (10% of Compliance score)
    safetyCompliance: {
      score: number;
      hasRestrictedWords: string[];
      hasMedicalClaims: boolean;
      hasSafetyWarnings: boolean;  // If required
      explanation: string;
    };
  };
}

interface PolicyViolation {
  rule: string;
  severity: 'critical' | 'high' | 'medium';
  field: string;
  issue: string;
  suggestion: string;
}
```

---

## 3. Scoring Rules Engine

### 3.1 Rule Structure

```typescript
interface ScoringRule {
  id: string;
  category: 'seo' | 'content' | 'images' | 'competitive' | 'compliance';
  metric: string;
  name: string;
  description: string;

  // Evaluation
  evaluate: (listing: Listing, context: ScoringContext) => RuleResult;

  // Scoring
  weight: number;        // Weight within category
  maxScore: number;      // Maximum points possible

  // Category-specific adjustments
  categoryAdjustments?: {
    [category: string]: {
      weightMultiplier?: number;
      thresholdAdjustments?: Record<string, number>;
    };
  };
}

interface RuleResult {
  score: number;
  maxScore: number;
  value: unknown;           // The measured value
  threshold: unknown;       // The target/threshold
  passed: boolean;
  explanation: string;
  suggestions?: string[];
}

interface ScoringContext {
  listing: Listing;
  competitors: Competitor[];
  categoryBenchmarks: CategoryBenchmark;
  keywords: Keyword[];
  historicalPerformance: PerformanceMetrics;
}
```

### 3.2 Example Rules Implementation

```typescript
// src/scoring/rules/seo.rules.ts

export const titleLengthRule: ScoringRule = {
  id: 'seo_title_length',
  category: 'seo',
  metric: 'titleLength',
  name: 'Title Length',
  description: 'Evaluates if title length is within optimal range',
  weight: 0.15,  // 15% of SEO score
  maxScore: 100,

  categoryAdjustments: {
    'power_tools': {
      thresholdAdjustments: { optimal_min: 160, optimal_max: 200 }
    },
    'screws': {
      thresholdAdjustments: { optimal_min: 140, optimal_max: 180 }
    }
  },

  evaluate: (listing, context) => {
    const title = listing.title;
    const length = title.length;

    // Get thresholds (with category adjustments)
    const category = listing.custom_category || 'default';
    const adjustments = titleLengthRule.categoryAdjustments?.[category];
    const optimalMin = adjustments?.thresholdAdjustments?.optimal_min ?? 150;
    const optimalMax = adjustments?.thresholdAdjustments?.optimal_max ?? 200;

    let score: number;
    let explanation: string;
    const suggestions: string[] = [];

    if (length >= optimalMin && length <= optimalMax) {
      score = 100;
      explanation = `Title length (${length} chars) is within optimal range`;
    } else if (length < optimalMin) {
      // Score decreases as we get further from optimal
      const deficit = optimalMin - length;
      score = Math.max(0, 100 - (deficit * 1.5));
      explanation = `Title is ${deficit} characters shorter than optimal`;
      suggestions.push(`Add ${deficit}+ characters to reach optimal length`);
      suggestions.push('Consider adding more keywords or product details');
    } else {
      // Too long
      const excess = length - optimalMax;
      score = Math.max(0, 100 - (excess * 2)); // Penalize excess more heavily
      explanation = `Title is ${excess} characters over optimal length`;
      suggestions.push('Shorten title to improve readability');
      suggestions.push('Focus on most important keywords');
    }

    return {
      score,
      maxScore: 100,
      value: length,
      threshold: { min: optimalMin, max: optimalMax },
      passed: score >= 70,
      explanation,
      suggestions
    };
  }
};

export const titleKeywordPlacementRule: ScoringRule = {
  id: 'seo_title_keyword_placement',
  category: 'seo',
  metric: 'titleKeywordPlacement',
  name: 'Primary Keyword Placement',
  description: 'Checks if primary keywords appear early in title',
  weight: 0.20,
  maxScore: 100,

  evaluate: (listing, context) => {
    const title = listing.title.toLowerCase();
    const primaryKeywords = context.keywords
      .filter(k => k.is_primary)
      .map(k => k.keyword.toLowerCase());

    if (primaryKeywords.length === 0) {
      return {
        score: 50,
        maxScore: 100,
        value: null,
        threshold: 'First 80 characters',
        passed: false,
        explanation: 'No primary keywords defined for this listing',
        suggestions: ['Define primary keywords to enable this analysis']
      };
    }

    const positions: { keyword: string; position: number }[] = [];

    for (const keyword of primaryKeywords) {
      const position = title.indexOf(keyword);
      if (position !== -1) {
        positions.push({ keyword, position });
      }
    }

    // Score based on position of first primary keyword
    const firstPosition = positions.length > 0
      ? Math.min(...positions.map(p => p.position))
      : -1;

    let score: number;
    let explanation: string;
    const suggestions: string[] = [];

    if (firstPosition === -1) {
      score = 0;
      explanation = 'Primary keywords not found in title';
      suggestions.push('Add your primary keyword to the title');
    } else if (firstPosition <= 30) {
      score = 100;
      explanation = `Primary keyword appears within first 30 characters (position ${firstPosition})`;
    } else if (firstPosition <= 80) {
      score = 75;
      explanation = `Primary keyword appears at position ${firstPosition}`;
      suggestions.push('Consider moving primary keyword closer to the beginning');
    } else {
      score = 40;
      explanation = `Primary keyword appears late in title (position ${firstPosition})`;
      suggestions.push('Move primary keyword to the first 80 characters');
    }

    // Bonus for multiple keywords present
    const keywordsFound = positions.length;
    const keywordsTotal = primaryKeywords.length;
    if (keywordsFound < keywordsTotal) {
      score = Math.max(0, score - ((keywordsTotal - keywordsFound) * 10));
      suggestions.push(`Add missing keywords: ${primaryKeywords.filter(k =>
        !positions.some(p => p.keyword === k)
      ).join(', ')}`);
    }

    return {
      score,
      maxScore: 100,
      value: { positions, keywordsFound, keywordsTotal },
      threshold: 'Position <= 80',
      passed: score >= 70,
      explanation,
      suggestions
    };
  }
};
```

### 3.3 DIY & Tools Category-Specific Rules

```typescript
// src/scoring/rules/diy-tools.rules.ts

export const diyToolsSpecificRules: ScoringRule[] = [
  {
    id: 'diy_specifications',
    category: 'content',
    metric: 'technicalSpecifications',
    name: 'Technical Specifications',
    description: 'DIY products need detailed specs',
    weight: 0.15,
    maxScore: 100,

    evaluate: (listing, context) => {
      const bullets = listing.bullet_points || [];
      const description = listing.description || '';
      const allContent = [...bullets, description].join(' ').toLowerCase();

      const requiredSpecs = {
        power_tools: ['watts', 'voltage', 'rpm', 'torque', 'battery'],
        screws: ['size', 'length', 'material', 'thread', 'head type'],
        accessories: ['compatibility', 'dimensions', 'material'],
        default: ['size', 'dimensions', 'material']
      };

      const category = listing.custom_category || 'default';
      const specs = requiredSpecs[category] || requiredSpecs.default;

      const foundSpecs = specs.filter(spec =>
        allContent.includes(spec) ||
        allContent.includes(spec.replace(' ', ''))
      );

      const score = Math.round((foundSpecs.length / specs.length) * 100);

      return {
        score,
        maxScore: 100,
        value: { found: foundSpecs, required: specs },
        threshold: 'All specifications present',
        passed: score >= 70,
        explanation: `Found ${foundSpecs.length}/${specs.length} expected specifications`,
        suggestions: specs
          .filter(s => !foundSpecs.includes(s))
          .map(s => `Add ${s} specification to your listing`)
      };
    }
  },

  {
    id: 'diy_compatibility',
    category: 'content',
    metric: 'compatibilityInfo',
    name: 'Compatibility Information',
    description: 'DIY products should list compatible items/systems',
    weight: 0.10,
    maxScore: 100,

    evaluate: (listing, context) => {
      const allContent = [
        listing.title,
        ...(listing.bullet_points || []),
        listing.description || ''
      ].join(' ').toLowerCase();

      const compatibilityIndicators = [
        'compatible with',
        'fits',
        'works with',
        'suitable for',
        'designed for',
        'for use with'
      ];

      const hasCompatibility = compatibilityIndicators.some(ind =>
        allContent.includes(ind)
      );

      // Check for specific brand/model mentions
      const hasBrandMentions = /\b(dewalt|makita|bosch|milwaukee|ryobi|black\s*&?\s*decker)\b/i
        .test(allContent);

      let score: number;
      if (hasCompatibility && hasBrandMentions) {
        score = 100;
      } else if (hasCompatibility) {
        score = 70;
      } else {
        score = 30;
      }

      return {
        score,
        maxScore: 100,
        value: { hasCompatibility, hasBrandMentions },
        threshold: 'Clear compatibility statement',
        passed: score >= 70,
        explanation: hasCompatibility
          ? 'Compatibility information present'
          : 'Missing compatibility information',
        suggestions: hasCompatibility ? [] : [
          'Add compatibility information (e.g., "Compatible with DeWalt 18V range")',
          'Specify which tools or systems this product works with'
        ]
      };
    }
  },

  {
    id: 'diy_quantity_packaging',
    category: 'content',
    metric: 'quantityClarity',
    name: 'Quantity & Packaging Clarity',
    description: 'Clear indication of what customer receives',
    weight: 0.10,
    maxScore: 100,

    evaluate: (listing, context) => {
      const title = listing.title.toLowerCase();
      const bullets = (listing.bullet_points || []).join(' ').toLowerCase();

      // Check for quantity indicators
      const quantityPatterns = [
        /\d+\s*(pcs?|pieces?|pack|set)/,
        /pack\s*of\s*\d+/,
        /\d+\s*x\s*/,
        /set\s*of\s*\d+/,
        /\bsingle\b/,
        /\bpair\b/
      ];

      const hasQuantityInTitle = quantityPatterns.some(p => p.test(title));
      const hasQuantityInBullets = quantityPatterns.some(p => p.test(bullets));

      // Check for "includes" or "contains"
      const hasIncludesStatement = /includes|contains|comes with|what's in/
        .test(bullets);

      let score: number;
      const suggestions: string[] = [];

      if (hasQuantityInTitle && hasIncludesStatement) {
        score = 100;
      } else if (hasQuantityInTitle) {
        score = 80;
        suggestions.push('Add "Package includes:" bullet point');
      } else if (hasQuantityInBullets) {
        score = 60;
        suggestions.push('Add quantity to title (e.g., "100pcs", "Pack of 50")');
      } else {
        score = 20;
        suggestions.push('Add quantity to title');
        suggestions.push('Add "Package includes:" bullet point');
      }

      return {
        score,
        maxScore: 100,
        value: { hasQuantityInTitle, hasQuantityInBullets, hasIncludesStatement },
        threshold: 'Clear quantity in title + package contents',
        passed: score >= 70,
        explanation: hasQuantityInTitle
          ? 'Quantity clearly stated'
          : 'Quantity information could be clearer',
        suggestions
      };
    }
  }
];
```

---

## 4. Benchmarking System

### 4.1 Competitor Benchmarking

```typescript
// src/scoring/benchmarking/competitor.benchmark.ts

interface CompetitorBenchmark {
  listingId: string;
  calculatedAt: Date;

  overallPosition: {
    rank: number;        // Your rank among competitors
    totalCompetitors: number;
    percentile: number;  // Top X%
  };

  categoryComparisons: {
    seo: CategoryComparison;
    content: CategoryComparison;
    images: CategoryComparison;
    pricing: CategoryComparison;
    reviews: CategoryComparison;
  };

  strengthsVsCompetitors: string[];
  weaknessesVsCompetitors: string[];
  opportunities: string[];
}

interface CategoryComparison {
  yourScore: number;
  avgCompetitorScore: number;
  bestCompetitorScore: number;
  yourRank: number;
  gap: number;  // Positive = you're ahead
}

async function calculateCompetitorBenchmark(
  listingId: string,
  competitors: Competitor[]
): Promise<CompetitorBenchmark> {
  const listing = await listingRepository.getById(listingId);
  const listingScore = await scoringService.calculateScore(listingId);

  // Calculate scores for each competitor
  const competitorScores = await Promise.all(
    competitors.map(async (comp) => ({
      competitor: comp,
      score: await analyzeCompetitorListing(comp)
    }))
  );

  // Rank by total score
  const allScores = [
    { id: listingId, score: listingScore.totalScore, isYours: true },
    ...competitorScores.map(cs => ({
      id: cs.competitor.id,
      score: cs.score.totalScore,
      isYours: false
    }))
  ].sort((a, b) => b.score - a.score);

  const yourRank = allScores.findIndex(s => s.isYours) + 1;

  // Category comparisons
  const categoryComparisons = calculateCategoryComparisons(
    listingScore,
    competitorScores
  );

  // Identify strengths and weaknesses
  const { strengths, weaknesses, opportunities } = identifyInsights(
    listingScore,
    competitorScores,
    categoryComparisons
  );

  return {
    listingId,
    calculatedAt: new Date(),
    overallPosition: {
      rank: yourRank,
      totalCompetitors: competitors.length,
      percentile: Math.round((1 - (yourRank - 1) / allScores.length) * 100)
    },
    categoryComparisons,
    strengthsVsCompetitors: strengths,
    weaknessesVsCompetitors: weaknesses,
    opportunities
  };
}
```

### 4.2 Category Benchmarking

```typescript
// src/scoring/benchmarking/category.benchmark.ts

interface CategoryBenchmarks {
  category: string;
  calculatedAt: Date;
  sampleSize: number;

  averages: {
    totalScore: number;
    seoScore: number;
    contentScore: number;
    imageScore: number;
    competitiveScore: number;
    complianceScore: number;
  };

  percentiles: {
    p25: typeof averages;
    p50: typeof averages;
    p75: typeof averages;
    p90: typeof averages;
  };

  topPerformerPatterns: {
    avgTitleLength: number;
    avgBulletCount: number;
    avgImageCount: number;
    commonKeywords: string[];
    commonPhrases: string[];
  };
}

async function calculateCategoryBenchmarks(
  category: string
): Promise<CategoryBenchmarks> {
  // Get top performers in category (by BSR)
  const topListings = await listingRepository.getByCategory(category, {
    sortBy: 'bsr',
    limit: 100
  });

  // Calculate scores for all
  const scores = await Promise.all(
    topListings.map(l => scoringService.calculateScore(l.id))
  );

  // Calculate statistics
  const averages = calculateAverages(scores);
  const percentiles = calculatePercentiles(scores);

  // Analyze top performer patterns
  const topPerformerPatterns = analyzeTopPerformers(
    topListings.slice(0, 20),
    scores.slice(0, 20)
  );

  return {
    category,
    calculatedAt: new Date(),
    sampleSize: topListings.length,
    averages,
    percentiles,
    topPerformerPatterns
  };
}
```

---

## 5. Learning Module

### 5.1 Correlation Analysis

The system learns which factors actually correlate with performance.

```typescript
// src/scoring/learning/correlation.ts

interface CorrelationAnalysis {
  metric: string;
  correlation: number;     // -1 to 1
  significance: number;    // p-value
  sampleSize: number;
  timeRange: DateRange;
}

async function analyzeCorrelations(): Promise<CorrelationAnalysis[]> {
  // Get all listings with sufficient history
  const listings = await listingRepository.getWithHistory(90); // 90 days

  const correlations: CorrelationAnalysis[] = [];

  // For each metric, calculate correlation with performance
  const metrics = [
    'seo.titleLength',
    'seo.titleKeywordPlacement',
    'content.bulletCount',
    'content.bulletLength',
    'images.imageCount',
    'images.mainImageQuality',
    // ... all metrics
  ];

  for (const metric of metrics) {
    const dataPoints = await getMetricPerformancePairs(listings, metric);

    if (dataPoints.length < 30) continue; // Need sufficient data

    const correlation = calculatePearsonCorrelation(
      dataPoints.map(d => d.metricValue),
      dataPoints.map(d => d.conversionRate)
    );

    const significance = calculatePValue(correlation, dataPoints.length);

    correlations.push({
      metric,
      correlation,
      significance,
      sampleSize: dataPoints.length,
      timeRange: { start: subDays(new Date(), 90), end: new Date() }
    });
  }

  return correlations.sort((a, b) =>
    Math.abs(b.correlation) - Math.abs(a.correlation)
  );
}
```

### 5.2 Adaptive Weight Adjustment

```typescript
// src/scoring/learning/weights.ts

interface WeightAdjustment {
  previousWeights: ScoringWeights;
  newWeights: ScoringWeights;
  adjustments: {
    metric: string;
    previousWeight: number;
    newWeight: number;
    reason: string;
  }[];
  confidence: number;
}

async function adjustWeightsBasedOnLearning(): Promise<WeightAdjustment> {
  const currentWeights = await settingsService.get('scoring.weights');
  const correlations = await analyzeCorrelations();

  const newWeights = { ...currentWeights };
  const adjustments: WeightAdjustment['adjustments'] = [];

  // Group correlations by category
  const byCategory = groupBy(correlations, c => c.metric.split('.')[0]);

  for (const [category, categoryCorrelations] of Object.entries(byCategory)) {
    // Calculate category-level adjustment
    const avgCorrelation = mean(categoryCorrelations.map(c => Math.abs(c.correlation)));
    const significantCorrelations = categoryCorrelations.filter(c => c.significance < 0.05);

    if (significantCorrelations.length < 3) continue; // Need enough evidence

    // Adjust category weight based on correlation strength
    const currentCategoryWeight = currentWeights[category];
    const correlationStrength = avgCorrelation; // 0 to 1

    // Only adjust if correlation is meaningfully different from current weight
    const expectedWeight = correlationStrength * 0.4; // Scale to reasonable range
    const weightDiff = expectedWeight - currentCategoryWeight;

    if (Math.abs(weightDiff) > 0.03) { // Only adjust if > 3% difference
      // Gradual adjustment (move 20% toward expected)
      const adjustment = weightDiff * 0.2;
      newWeights[category] = currentCategoryWeight + adjustment;

      adjustments.push({
        metric: category,
        previousWeight: currentCategoryWeight,
        newWeight: newWeights[category],
        reason: `Correlation analysis suggests ${category} has ${
          correlationStrength > currentCategoryWeight ? 'stronger' : 'weaker'
        } impact on conversions than current weight reflects`
      });
    }
  }

  // Normalize weights to sum to 1
  const total = Object.values(newWeights).reduce((a, b) => a + b, 0);
  for (const key of Object.keys(newWeights)) {
    newWeights[key] = newWeights[key] / total;
  }

  return {
    previousWeights: currentWeights,
    newWeights,
    adjustments,
    confidence: adjustments.length > 0 ? 0.7 : 0.5
  };
}
```

---

## 6. Recommendation Generator

### 6.1 Recommendation Structure

```typescript
interface Recommendation {
  id: string;
  listingId: string;
  generatedAt: Date;

  // Classification
  type: 'seo' | 'content' | 'image' | 'pricing' | 'competitive' | 'compliance';
  priority: 'critical' | 'high' | 'medium' | 'low';

  // The recommendation
  title: string;
  description: string;
  currentValue: string | number | null;
  suggestedValue: string | number | null;

  // Impact estimation
  estimatedImpact: {
    scoreImprovement: number;  // Points
    conversionImpact: 'high' | 'medium' | 'low';
    confidence: number;
  };

  // Implementation
  effort: 'trivial' | 'easy' | 'moderate' | 'significant';
  autoApplicable: boolean;  // Can system apply this automatically?

  // Evidence
  reasoning: string[];
  competitorExamples?: {
    competitorAsin: string;
    relevantValue: string;
  }[];
}
```

### 6.2 Recommendation Generation

```typescript
// src/scoring/recommendations/generator.ts

async function generateRecommendations(
  listingId: string,
  score: ListingScore,
  benchmark: CompetitorBenchmark
): Promise<Recommendation[]> {
  const recommendations: Recommendation[] = [];
  const listing = await listingRepository.getById(listingId);

  // Process each score component
  for (const [category, componentScore] of Object.entries(score.components)) {
    for (const metric of componentScore.metrics) {
      if (metric.score < metric.maxScore * 0.7) {
        // Below 70% - generate recommendation

        const recommendation = await generateRecommendationForMetric(
          listing,
          category,
          metric,
          benchmark
        );

        if (recommendation) {
          recommendations.push(recommendation);
        }
      }
    }
  }

  // Add competitive recommendations
  const competitiveRecs = generateCompetitiveRecommendations(
    listing,
    benchmark
  );
  recommendations.push(...competitiveRecs);

  // Sort by priority and estimated impact
  return recommendations.sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;

    return b.estimatedImpact.scoreImprovement - a.estimatedImpact.scoreImprovement;
  });
}

async function generateRecommendationForMetric(
  listing: Listing,
  category: string,
  metric: MetricResult,
  benchmark: CompetitorBenchmark
): Promise<Recommendation | null> {
  // Use templates and patterns to generate specific recommendations

  const templates = recommendationTemplates[category]?.[metric.name];
  if (!templates) return null;

  const template = selectBestTemplate(templates, metric, listing);

  return {
    id: generateId(),
    listingId: listing.id,
    generatedAt: new Date(),
    type: category as Recommendation['type'],
    priority: calculatePriority(metric, benchmark),
    title: interpolateTemplate(template.title, { listing, metric }),
    description: interpolateTemplate(template.description, { listing, metric }),
    currentValue: metric.value,
    suggestedValue: template.suggestValue?.(listing, metric, benchmark),
    estimatedImpact: {
      scoreImprovement: estimateScoreImprovement(metric),
      conversionImpact: estimateConversionImpact(metric, category),
      confidence: template.confidence || 0.7
    },
    effort: template.effort,
    autoApplicable: template.autoApplicable || false,
    reasoning: template.generateReasoning(listing, metric, benchmark)
  };
}
```

---

## 7. Scoring Engine Orchestration

### 7.1 Main Engine

```typescript
// src/scoring/engine.ts

class ScoringEngine {
  private rules: Map<string, ScoringRule[]>;
  private weights: ScoringWeights;
  private benchmarks: Map<string, CategoryBenchmarks>;

  async calculateScore(listingId: string): Promise<ListingScore> {
    const listing = await this.loadListing(listingId);
    const context = await this.buildScoringContext(listing);

    const componentScores: Record<string, ComponentScore> = {};

    // Calculate each component
    for (const category of ['seo', 'content', 'images', 'competitive', 'compliance']) {
      componentScores[category] = await this.calculateComponentScore(
        listing,
        context,
        category
      );
    }

    // Calculate total score with weights
    const totalScore = this.calculateWeightedTotal(componentScores);

    // Collect all issues
    const issues = this.collectIssues(componentScores);

    const score: ListingScore = {
      listingId,
      totalScore,
      components: componentScores as ListingScore['components'],
      issues,
      calculatedAt: new Date()
    };

    // Persist score
    await this.persistScore(score);

    // Emit event
    await eventBus.emit('listing.scored', {
      listingId,
      score: totalScore,
      previousScore: listing.current_score
    });

    return score;
  }

  private async calculateComponentScore(
    listing: Listing,
    context: ScoringContext,
    category: string
  ): Promise<ComponentScore> {
    const rules = this.rules.get(category) || [];
    const metrics: ComponentScore['metrics'] = [];

    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const rule of rules) {
      const result = rule.evaluate(listing, context);

      // Apply category-specific adjustments
      const adjustedWeight = this.getAdjustedWeight(
        rule,
        listing.custom_category
      );

      metrics.push({
        name: rule.metric,
        score: result.score,
        maxScore: result.maxScore,
        details: result.explanation
      });

      totalWeightedScore += (result.score / result.maxScore) * adjustedWeight;
      totalWeight += adjustedWeight;
    }

    const componentScore = totalWeight > 0
      ? (totalWeightedScore / totalWeight) * 100
      : 0;

    return {
      score: Math.round(componentScore * 100) / 100,
      maxScore: 100,
      weight: this.weights[category],
      metrics
    };
  }

  private calculateWeightedTotal(
    components: Record<string, ComponentScore>
  ): number {
    let total = 0;

    for (const [category, component] of Object.entries(components)) {
      total += component.score * this.weights[category];
    }

    return Math.round(total * 100) / 100;
  }
}
```

---

## Next Document: Frontend Architecture →
