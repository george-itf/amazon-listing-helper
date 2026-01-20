// Opportunity Scoring Module
// Phase 6: Analytics & Predictions - Opportunity identification

import { readFileSync, existsSync } from 'fs';

const DATA_DIR = process.env.DATA_DIR || '/opt/alh/data';

// ============ OPPORTUNITY DETECTION ============

export function analyzeOpportunities(listings, scores, keepaData = {}) {
  const opportunities = [];

  for (const listing of listings) {
    const sku = listing.sku;
    const score = scores?.[sku];
    const keepa = keepaData?.[listing.asin];

    if (!score) continue;

    const listingOpps = [];

    // 1. Low Score, High Potential
    if (score.totalScore < 60 && listing.price > 15) {
      const potentialGain = Math.round((80 - score.totalScore) * 0.5);
      listingOpps.push({
        type: 'score_improvement',
        priority: 'high',
        title: 'Score Improvement Opportunity',
        description: `Current score ${score.totalScore}/100. Improving to 80+ could increase visibility.`,
        estimatedImpact: `+${potentialGain}% visibility`,
        actions: getScoreImprovementActions(score)
      });
    }

    // 2. Price Optimization
    if (keepa?.avgPrice && listing.price) {
      const priceDiff = ((listing.price - keepa.avgPrice) / keepa.avgPrice) * 100;
      if (priceDiff > 15) {
        listingOpps.push({
          type: 'price_optimization',
          priority: 'medium',
          title: 'Price Above Market Average',
          description: `Your price £${listing.price} is ${Math.round(priceDiff)}% above category average £${keepa.avgPrice.toFixed(2)}`,
          estimatedImpact: 'Potential +10-20% conversion',
          actions: [
            { action: 'Review competitor pricing', effort: 'low' },
            { action: 'Consider promotional pricing', effort: 'medium' },
            { action: 'Add value through bundling', effort: 'high' }
          ]
        });
      } else if (priceDiff < -20) {
        listingOpps.push({
          type: 'price_increase',
          priority: 'medium',
          title: 'Price Below Market - Margin Opportunity',
          description: `Your price £${listing.price} is ${Math.abs(Math.round(priceDiff))}% below average. Consider price increase.`,
          estimatedImpact: `+£${Math.round((keepa.avgPrice - listing.price) * 0.7)} per unit profit`,
          actions: [
            { action: 'Test gradual price increase', effort: 'low' },
            { action: 'Monitor conversion rate changes', effort: 'low' }
          ]
        });
      }
    }

    // 3. Image Optimization
    if (score.breakdown?.images < 15) {
      listingOpps.push({
        type: 'image_optimization',
        priority: 'high',
        title: 'Image Quality Improvement',
        description: 'Images are below optimal quality. Better images = higher conversion.',
        estimatedImpact: '+15-25% conversion rate',
        actions: [
          { action: 'Add lifestyle images', effort: 'medium' },
          { action: 'Include infographics', effort: 'medium' },
          { action: 'Show product in use', effort: 'medium' },
          { action: 'Add size/scale reference', effort: 'low' }
        ]
      });
    }

    // 4. Title Optimization
    if (score.breakdown?.title < 18) {
      listingOpps.push({
        type: 'title_optimization',
        priority: 'high',
        title: 'Title Needs Work',
        description: 'Title could be optimized for better search ranking.',
        estimatedImpact: '+10-15% search visibility',
        actions: [
          { action: 'Front-load main keywords', effort: 'low' },
          { action: 'Include key specifications', effort: 'low' },
          { action: 'Add brand name if missing', effort: 'low' }
        ]
      });
    }

    // 5. Bullet Points
    if (score.breakdown?.bullets < 15) {
      listingOpps.push({
        type: 'bullets_optimization',
        priority: 'medium',
        title: 'Bullet Points Improvement',
        description: 'Bullet points need enhancement for better conversion.',
        estimatedImpact: '+5-10% conversion',
        actions: [
          { action: 'Lead with benefits, not features', effort: 'low' },
          { action: 'Use all 5 bullet points', effort: 'low' },
          { action: 'Include keywords naturally', effort: 'low' }
        ]
      });
    }

    // 6. Keywords/Backend
    if (score.breakdown?.keywords < 8) {
      listingOpps.push({
        type: 'keyword_optimization',
        priority: 'medium',
        title: 'Keyword Optimization',
        description: 'Backend keywords need improvement.',
        estimatedImpact: '+5-15% search visibility',
        actions: [
          { action: 'Research competitor keywords', effort: 'medium' },
          { action: 'Use all 250 bytes', effort: 'low' },
          { action: 'Include misspellings and variants', effort: 'low' }
        ]
      });
    }

    // 7. BSR Opportunity (if Keepa data available)
    if (keepa?.bsr && keepa.bsr > 50000 && score.totalScore >= 70) {
      listingOpps.push({
        type: 'bsr_improvement',
        priority: 'medium',
        title: 'BSR Improvement Potential',
        description: `Good listing score but BSR is ${keepa.bsr.toLocaleString()}. Opportunity to climb ranks.`,
        estimatedImpact: 'Potential to reach top 10,000 BSR',
        actions: [
          { action: 'Run promotional campaign', effort: 'medium' },
          { action: 'Increase PPC budget temporarily', effort: 'medium' },
          { action: 'Request customer reviews', effort: 'low' }
        ]
      });
    }

    // 8. Review Velocity
    if (listing.reviewCount < 10) {
      listingOpps.push({
        type: 'reviews',
        priority: 'high',
        title: 'Build Review Base',
        description: `Only ${listing.reviewCount || 0} reviews. More reviews = more trust = more sales.`,
        estimatedImpact: '+20-40% conversion with 25+ reviews',
        actions: [
          { action: 'Enroll in Amazon Vine (if eligible)', effort: 'medium' },
          { action: 'Use Request a Review button', effort: 'low' },
          { action: 'Include insert card with instructions', effort: 'low' }
        ]
      });
    }

    // 9. A+ Content
    if (!listing.hasAPlus && listing.price > 20) {
      listingOpps.push({
        type: 'aplus_content',
        priority: 'medium',
        title: 'Add A+ Content',
        description: 'A+ Content can significantly boost conversion on higher-priced items.',
        estimatedImpact: '+3-10% conversion rate',
        actions: [
          { action: 'Create brand story module', effort: 'medium' },
          { action: 'Add comparison charts', effort: 'medium' },
          { action: 'Include lifestyle imagery', effort: 'medium' }
        ]
      });
    }

    // Calculate opportunity score for this listing
    if (listingOpps.length > 0) {
      const highPriority = listingOpps.filter(o => o.priority === 'high').length;
      const mediumPriority = listingOpps.filter(o => o.priority === 'medium').length;
      const opportunityScore = (highPriority * 30) + (mediumPriority * 15);

      opportunities.push({
        sku,
        asin: listing.asin,
        title: listing.title,
        currentScore: score.totalScore,
        price: listing.price,
        opportunityScore,
        opportunityCount: listingOpps.length,
        opportunities: listingOpps,
        quickWins: listingOpps.filter(o =>
          o.actions.some(a => a.effort === 'low')
        ).length
      });
    }
  }

  // Sort by opportunity score
  return opportunities.sort((a, b) => b.opportunityScore - a.opportunityScore);
}

function getScoreImprovementActions(score) {
  const actions = [];
  const breakdown = score.breakdown || {};

  if (breakdown.title < 20) actions.push({ action: 'Optimize title with keywords', effort: 'low' });
  if (breakdown.bullets < 15) actions.push({ action: 'Enhance bullet points', effort: 'low' });
  if (breakdown.images < 15) actions.push({ action: 'Add more quality images', effort: 'medium' });
  if (breakdown.keywords < 8) actions.push({ action: 'Update backend keywords', effort: 'low' });
  if (breakdown.description < 10) actions.push({ action: 'Improve product description', effort: 'medium' });

  return actions.slice(0, 5);
}

// ============ QUICK WINS ============

export function getQuickWins(opportunities, limit = 10) {
  const quickWinItems = [];

  for (const opp of opportunities) {
    const quickOpps = opp.opportunities.filter(o =>
      o.actions.some(a => a.effort === 'low')
    );

    for (const quickOpp of quickOpps) {
      const lowEffortActions = quickOpp.actions.filter(a => a.effort === 'low');
      quickWinItems.push({
        sku: opp.sku,
        title: opp.title?.substring(0, 60) + '...',
        opportunityType: quickOpp.type,
        opportunityTitle: quickOpp.title,
        estimatedImpact: quickOpp.estimatedImpact,
        actions: lowEffortActions.map(a => a.action)
      });
    }
  }

  return quickWinItems.slice(0, limit);
}

// ============ OPPORTUNITY SUMMARY ============

export function getOpportunitySummary(opportunities) {
  const byType = {};
  let totalQuickWins = 0;
  let totalHighPriority = 0;

  for (const opp of opportunities) {
    totalQuickWins += opp.quickWins;

    for (const o of opp.opportunities) {
      byType[o.type] = (byType[o.type] || 0) + 1;
      if (o.priority === 'high') totalHighPriority++;
    }
  }

  return {
    totalListingsWithOpportunities: opportunities.length,
    totalOpportunities: opportunities.reduce((sum, o) => sum + o.opportunityCount, 0),
    totalQuickWins,
    totalHighPriority,
    byType,
    topOpportunityTypes: Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count })),
    averageOpportunityScore: opportunities.length > 0 ?
      Math.round(opportunities.reduce((sum, o) => sum + o.opportunityScore, 0) / opportunities.length) : 0
  };
}

// ============ BUNDLE OPPORTUNITIES ============

export function findBundleOpportunities(listings) {
  const bundles = [];
  const categories = {};

  // Group by category
  for (const listing of listings) {
    const cat = listing.category || 'Other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(listing);
  }

  // Find complementary products within categories
  for (const [category, items] of Object.entries(categories)) {
    if (items.length < 2) continue;

    // Sort by price
    const sorted = items.sort((a, b) => (a.price || 0) - (b.price || 0));

    // Find pairs with complementary price points
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const item1 = sorted[i];
        const item2 = sorted[j];

        // Check if items are complementary (different price ranges, similar category)
        const price1 = item1.price || 0;
        const price2 = item2.price || 0;
        const combinedPrice = price1 + price2;
        const suggestedBundlePrice = combinedPrice * 0.9; // 10% discount

        // Only suggest if bundle makes sense
        if (combinedPrice > 15 && combinedPrice < 100) {
          const marginImprovement = (price1 * 0.05) + (price2 * 0.05); // Estimated

          bundles.push({
            category,
            items: [
              { sku: item1.sku, title: item1.title?.substring(0, 50), price: price1 },
              { sku: item2.sku, title: item2.title?.substring(0, 50), price: price2 }
            ],
            combinedPrice,
            suggestedBundlePrice: Math.round(suggestedBundlePrice * 100) / 100,
            savings: Math.round((combinedPrice - suggestedBundlePrice) * 100) / 100,
            estimatedMarginImprovement: Math.round(marginImprovement * 100) / 100,
            rationale: `Complementary ${category} items at different price points`
          });
        }
      }
    }
  }

  return bundles.slice(0, 20);
}

// ============ SEASONALITY OPPORTUNITIES ============

export function getSeasonalOpportunities(listings, month = new Date().getMonth()) {
  const seasonal = [];

  // UK seasonal events calendar
  const ukSeasons = {
    0: ['New Year', 'Winter Sales', 'DIY Projects'],
    1: ['Valentines', 'Half Term DIY'],
    2: ['Spring Prep', 'Garden Start', 'Mothering Sunday'],
    3: ['Easter', 'Spring Cleaning', 'Garden Season'],
    4: ['Bank Holidays', 'Garden Peak', 'Home Improvement'],
    5: ['Summer Prep', 'Fathers Day', 'Outdoor Living'],
    6: ['Summer Peak', 'Holiday Prep'],
    7: ['Back to School Prep', 'Summer Projects'],
    8: ['Back to School', 'Autumn Prep'],
    9: ['Halloween', 'Autumn DIY', 'Pre-Christmas'],
    10: ['Black Friday', 'Christmas Shopping Start'],
    11: ['Christmas Peak', 'Gift Buying', 'Winter Prep']
  };

  const currentSeasons = ukSeasons[month] || [];
  const nextMonth = (month + 1) % 12;
  const upcomingSeasons = ukSeasons[nextMonth] || [];

  // DIY/Tools specific keywords
  const diyKeywords = {
    spring: ['garden', 'outdoor', 'fence', 'deck', 'patio', 'lawn', 'plant', 'shed'],
    summer: ['bbq', 'outdoor', 'garden', 'water', 'pool', 'camping'],
    autumn: ['insulation', 'heating', 'draught', 'leaf', 'gutter', 'firewood'],
    winter: ['snow', 'ice', 'heating', 'insulation', 'draft', 'christmas']
  };

  const currentSeason = month >= 2 && month <= 4 ? 'spring' :
    month >= 5 && month <= 7 ? 'summer' :
      month >= 8 && month <= 10 ? 'autumn' : 'winter';

  const relevantKeywords = diyKeywords[currentSeason] || [];

  for (const listing of listings) {
    const titleLower = (listing.title || '').toLowerCase();
    const keywordsLower = (listing.keywords || '').toLowerCase();

    const matchedKeywords = relevantKeywords.filter(kw =>
      titleLower.includes(kw) || keywordsLower.includes(kw)
    );

    if (matchedKeywords.length > 0) {
      seasonal.push({
        sku: listing.sku,
        title: listing.title?.substring(0, 60),
        seasonalRelevance: 'high',
        matchedKeywords,
        currentSeasons,
        upcomingSeasons,
        recommendations: [
          'Consider increasing stock levels',
          'Update listing with seasonal keywords',
          'Prepare promotional pricing',
          'Boost PPC budget'
        ]
      });
    }
  }

  return {
    month: new Date(2024, month).toLocaleString('default', { month: 'long' }),
    currentSeasons,
    upcomingSeasons,
    seasonalListings: seasonal,
    totalSeasonalItems: seasonal.length,
    generalAdvice: `Prepare for ${upcomingSeasons.join(', ')} in the coming weeks.`
  };
}

export default {
  analyzeOpportunities,
  getQuickWins,
  getOpportunitySummary,
  findBundleOpportunities,
  getSeasonalOpportunities
};
