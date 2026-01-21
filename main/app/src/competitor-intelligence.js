/**
 * Competitor Intelligence Module
 * Tracks competitor pricing trends, Buy Box win rates, and analyzes market gaps
 * Uses Keepa data for competitive analysis
 */

import fs from 'fs';

const DATA_DIR = '/opt/alh/data';
const COMPETITOR_FILE = `${DATA_DIR}/competitors.json`;
const MARKET_ANALYSIS_FILE = `${DATA_DIR}/market-analysis.json`;

// ============================================
// DATA MANAGEMENT
// ============================================

function loadCompetitors() {
  try {
    if (fs.existsSync(COMPETITOR_FILE)) {
      return JSON.parse(fs.readFileSync(COMPETITOR_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading competitors:', e);
  }
  return { tracked: {}, history: {}, lastUpdate: null };
}

function saveCompetitors(data) {
  fs.writeFileSync(COMPETITOR_FILE, JSON.stringify(data, null, 2));
}

function loadMarketAnalysis() {
  try {
    if (fs.existsSync(MARKET_ANALYSIS_FILE)) {
      return JSON.parse(fs.readFileSync(MARKET_ANALYSIS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading market analysis:', e);
  }
  return { analyses: {}, lastUpdate: null };
}

function saveMarketAnalysis(data) {
  fs.writeFileSync(MARKET_ANALYSIS_FILE, JSON.stringify(data, null, 2));
}

function loadKeepaData() {
  try {
    const keepaFile = `${DATA_DIR}/keepa.json`;
    if (fs.existsSync(keepaFile)) {
      const data = JSON.parse(fs.readFileSync(keepaFile, 'utf8'));
      return data.data || data || {};
    }
  } catch (e) {
    console.error('Error loading Keepa data:', e);
  }
  return {};
}

function loadListings() {
  try {
    const listingsFile = `${DATA_DIR}/listings.json`;
    if (fs.existsSync(listingsFile)) {
      return JSON.parse(fs.readFileSync(listingsFile, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading listings:', e);
  }
  return { items: [], lastSync: null };
}

// ============================================
// COMPETITOR TRACKING
// ============================================

/**
 * Add a competitor to track for an ASIN
 */
function trackCompetitor(asin, competitorData) {
  const data = loadCompetitors();

  if (!data.tracked[asin]) {
    data.tracked[asin] = [];
  }

  const competitor = {
    id: `comp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    sellerName: competitorData.sellerName || 'Unknown',
    sellerId: competitorData.sellerId || null,
    isFBA: competitorData.isFBA || false,
    price: parseFloat(competitorData.price) || 0,
    rating: competitorData.rating || null,
    addedAt: new Date().toISOString(),
    notes: competitorData.notes || ''
  };

  // Check if competitor already tracked
  const exists = data.tracked[asin].find(c =>
    c.sellerName === competitor.sellerName ||
    (c.sellerId && c.sellerId === competitor.sellerId)
  );

  if (exists) {
    // Update existing
    Object.assign(exists, competitor, { id: exists.id, addedAt: exists.addedAt });
  } else {
    data.tracked[asin].push(competitor);
  }

  data.lastUpdate = new Date().toISOString();
  saveCompetitors(data);

  return competitor;
}

/**
 * Remove a tracked competitor
 */
function untrackCompetitor(asin, competitorId) {
  const data = loadCompetitors();

  if (!data.tracked[asin]) return false;

  const index = data.tracked[asin].findIndex(c => c.id === competitorId);
  if (index === -1) return false;

  data.tracked[asin].splice(index, 1);
  data.lastUpdate = new Date().toISOString();
  saveCompetitors(data);

  return true;
}

/**
 * Get tracked competitors for an ASIN
 */
function getTrackedCompetitors(asin) {
  const data = loadCompetitors();
  return data.tracked[asin] || [];
}

/**
 * Get all tracked competitors
 */
function getAllTrackedCompetitors() {
  const data = loadCompetitors();
  return data.tracked;
}

// ============================================
// PRICE HISTORY & TRENDS
// ============================================

/**
 * Record competitor price point
 */
function recordCompetitorPrice(asin, competitorId, price) {
  const data = loadCompetitors();

  if (!data.history[asin]) {
    data.history[asin] = {};
  }

  if (!data.history[asin][competitorId]) {
    data.history[asin][competitorId] = [];
  }

  data.history[asin][competitorId].push({
    price: parseFloat(price),
    timestamp: new Date().toISOString()
  });

  // Keep last 90 days of history
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  data.history[asin][competitorId] = data.history[asin][competitorId].filter(
    h => new Date(h.timestamp) > cutoff
  );

  data.lastUpdate = new Date().toISOString();
  saveCompetitors(data);

  return data.history[asin][competitorId];
}

/**
 * Get price history for a competitor
 */
function getCompetitorPriceHistory(asin, competitorId, days = 30) {
  const data = loadCompetitors();

  if (!data.history[asin] || !data.history[asin][competitorId]) {
    return [];
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  return data.history[asin][competitorId].filter(
    h => new Date(h.timestamp) > cutoff
  );
}

/**
 * Analyze price trends for an ASIN
 */
function analyzePriceTrends(asin, days = 30) {
  const keepaData = loadKeepaData();
  const asinData = keepaData[asin];
  const competitorData = loadCompetitors();

  const analysis = {
    asin,
    period: `${days} days`,
    buyBox: {
      current: null,
      average: null,
      min: null,
      max: null,
      trend: 'stable'
    },
    competitors: [],
    priceVolatility: 'low',
    recommendations: []
  };

  // Get Keepa Buy Box data
  if (asinData) {
    analysis.buyBox.current = asinData.buyBoxPrice;

    // Calculate average from tracked competitors if available
    const trackedComps = competitorData.tracked[asin] || [];
    if (trackedComps.length > 0) {
      const prices = trackedComps.map(c => c.price).filter(p => p > 0);
      if (prices.length > 0) {
        analysis.buyBox.average = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length * 100) / 100;
        analysis.buyBox.min = Math.min(...prices);
        analysis.buyBox.max = Math.max(...prices);
      }
    }

    // Analyze competitor count for volatility
    const competitorCount = asinData.competitorCount || asinData.newOfferCount || 0;
    if (competitorCount > 10) {
      analysis.priceVolatility = 'high';
      analysis.recommendations.push({
        type: 'warning',
        message: 'High competition - monitor prices frequently'
      });
    } else if (competitorCount > 5) {
      analysis.priceVolatility = 'medium';
    }
  }

  // Add tracked competitor analysis
  if (competitorData.tracked[asin]) {
    competitorData.tracked[asin].forEach(comp => {
      const history = getCompetitorPriceHistory(asin, comp.id, days);

      let trend = 'stable';
      let changePercent = 0;

      if (history.length >= 2) {
        const oldest = history[0].price;
        const newest = history[history.length - 1].price;
        changePercent = Math.round((newest - oldest) / oldest * 100 * 10) / 10;

        if (changePercent > 5) trend = 'increasing';
        else if (changePercent < -5) trend = 'decreasing';
      }

      analysis.competitors.push({
        id: comp.id,
        name: comp.sellerName,
        currentPrice: comp.price,
        isFBA: comp.isFBA,
        trend,
        changePercent,
        dataPoints: history.length
      });
    });
  }

  // Generate recommendations
  if (analysis.buyBox.current && analysis.buyBox.average) {
    const diff = analysis.buyBox.current - analysis.buyBox.average;
    if (diff > 1) {
      analysis.recommendations.push({
        type: 'opportunity',
        message: `Buy Box is £${diff.toFixed(2)} above average - potential to win with competitive pricing`
      });
    }
  }

  return analysis;
}

// ============================================
// BUY BOX ANALYSIS
// ============================================

/**
 * Calculate Buy Box win rate estimate
 */
function calculateBuyBoxWinRate(asin, ourPrice, ourIsFBA = false) {
  const keepaData = loadKeepaData();
  const asinData = keepaData[asin];
  const competitorData = loadCompetitors();

  const analysis = {
    asin,
    ourPrice,
    ourIsFBA,
    buyBoxPrice: null,
    competitorCount: 0,
    estimatedWinRate: 0,
    factors: [],
    recommendation: ''
  };

  if (!asinData) {
    analysis.factors.push({ factor: 'No Keepa data', impact: 'unknown' });
    return analysis;
  }

  analysis.buyBoxPrice = asinData.buyBoxPrice;
  analysis.competitorCount = asinData.competitorCount || asinData.newOfferCount || 0;

  // Base win rate calculation
  let winRate = 50; // Start at 50%

  // Price factor (most important)
  if (asinData.buyBoxPrice) {
    const priceDiff = ourPrice - asinData.buyBoxPrice;
    const priceDiffPercent = (priceDiff / asinData.buyBoxPrice) * 100;

    if (priceDiffPercent <= -3) {
      winRate += 25;
      analysis.factors.push({ factor: 'Price below Buy Box', impact: '+25%' });
    } else if (priceDiffPercent <= 0) {
      winRate += 15;
      analysis.factors.push({ factor: 'Price at/near Buy Box', impact: '+15%' });
    } else if (priceDiffPercent <= 3) {
      winRate -= 10;
      analysis.factors.push({ factor: 'Price slightly above Buy Box', impact: '-10%' });
    } else if (priceDiffPercent <= 10) {
      winRate -= 25;
      analysis.factors.push({ factor: 'Price 3-10% above Buy Box', impact: '-25%' });
    } else {
      winRate -= 40;
      analysis.factors.push({ factor: 'Price >10% above Buy Box', impact: '-40%' });
    }
  }

  // FBA factor
  if (ourIsFBA) {
    winRate += 10;
    analysis.factors.push({ factor: 'FBA fulfilled', impact: '+10%' });
  } else {
    winRate -= 5;
    analysis.factors.push({ factor: 'FBM (not Prime)', impact: '-5%' });
  }

  // Competition factor
  if (analysis.competitorCount > 10) {
    winRate -= 15;
    analysis.factors.push({ factor: 'High competition (10+ sellers)', impact: '-15%' });
  } else if (analysis.competitorCount > 5) {
    winRate -= 5;
    analysis.factors.push({ factor: 'Moderate competition (5-10 sellers)', impact: '-5%' });
  } else if (analysis.competitorCount <= 2) {
    winRate += 10;
    analysis.factors.push({ factor: 'Low competition (1-2 sellers)', impact: '+10%' });
  }

  // Clamp win rate
  analysis.estimatedWinRate = Math.max(0, Math.min(100, Math.round(winRate)));

  // Generate recommendation
  if (analysis.estimatedWinRate >= 70) {
    analysis.recommendation = 'Strong position - likely to win Buy Box frequently';
  } else if (analysis.estimatedWinRate >= 50) {
    analysis.recommendation = 'Competitive position - consider price adjustments for more wins';
  } else if (analysis.estimatedWinRate >= 30) {
    analysis.recommendation = 'Below average - review pricing strategy';
  } else {
    analysis.recommendation = 'Low win probability - significant changes needed';
  }

  return analysis;
}

/**
 * Get Buy Box analysis for all listings
 */
function getBulkBuyBoxAnalysis() {
  const listings = loadListings();
  const keepaData = loadKeepaData();

  const results = [];

  for (const listing of listings.items) {
    const asinData = keepaData[listing.asin];

    if (!asinData) continue;

    const analysis = calculateBuyBoxWinRate(listing.asin, listing.price, false);

    results.push({
      sku: listing.sku,
      asin: listing.asin,
      title: listing.title?.substring(0, 50),
      ourPrice: listing.price,
      buyBoxPrice: asinData.buyBoxPrice,
      competitorCount: analysis.competitorCount,
      estimatedWinRate: analysis.estimatedWinRate,
      status: analysis.estimatedWinRate >= 60 ? 'good' :
              analysis.estimatedWinRate >= 40 ? 'fair' : 'poor'
    });
  }

  // Sort by win rate (lowest first - needs attention)
  results.sort((a, b) => a.estimatedWinRate - b.estimatedWinRate);

  return {
    items: results,
    summary: {
      total: results.length,
      good: results.filter(r => r.status === 'good').length,
      fair: results.filter(r => r.status === 'fair').length,
      poor: results.filter(r => r.status === 'poor').length,
      averageWinRate: results.length > 0
        ? Math.round(results.reduce((sum, r) => sum + r.estimatedWinRate, 0) / results.length)
        : 0
    }
  };
}

// ============================================
// MARKET GAP ANALYSIS
// ============================================

/**
 * Analyze market gaps and opportunities
 */
function analyzeMarketGaps(category = null) {
  const listings = loadListings();
  const keepaData = loadKeepaData();

  const gaps = [];
  const opportunities = [];

  // Group listings by inferred category
  const categories = {};

  for (const listing of listings.items) {
    // Simple category inference from title
    const title = (listing.title || '').toLowerCase();
    let cat = 'other';

    if (title.includes('drill') || title.includes('hammer')) cat = 'power-tools';
    else if (title.includes('screwdriver') || title.includes('wrench') || title.includes('spanner')) cat = 'hand-tools';
    else if (title.includes('bit') || title.includes('blade')) cat = 'accessories';
    else if (title.includes('set') || title.includes('kit')) cat = 'sets';
    else if (title.includes('tape') || title.includes('glue') || title.includes('adhesive')) cat = 'consumables';

    if (!categories[cat]) {
      categories[cat] = [];
    }
    categories[cat].push(listing);
  }

  // Analyze each category
  for (const [cat, catListings] of Object.entries(categories)) {
    if (category && category !== cat) continue;

    const prices = catListings.map(l => l.price).filter(p => p > 0);
    const avgPrice = prices.length > 0
      ? prices.reduce((a, b) => a + b, 0) / prices.length
      : 0;

    // Find price gaps
    prices.sort((a, b) => a - b);

    for (let i = 1; i < prices.length; i++) {
      const gap = prices[i] - prices[i - 1];
      const gapPercent = (gap / prices[i - 1]) * 100;

      if (gapPercent > 30 && gap > 5) {
        gaps.push({
          category: cat,
          type: 'price_gap',
          lowerPrice: prices[i - 1],
          upperPrice: prices[i],
          gap,
          gapPercent: Math.round(gapPercent),
          opportunity: `No products between £${prices[i - 1].toFixed(2)} and £${prices[i].toFixed(2)}`
        });
      }
    }

    // Check for underserved price points using Keepa
    catListings.forEach(listing => {
      const asinData = keepaData[listing.asin];
      if (!asinData) return;

      // High demand (low sales rank) but low competition
      if (asinData.salesRank && asinData.salesRank < 50000 &&
          (asinData.competitorCount || 0) < 5) {
        opportunities.push({
          sku: listing.sku,
          asin: listing.asin,
          title: listing.title?.substring(0, 50),
          category: cat,
          type: 'low_competition_high_demand',
          salesRank: asinData.salesRank,
          competitorCount: asinData.competitorCount || 0,
          price: listing.price,
          opportunity: 'High demand with few competitors'
        });
      }

      // Good reviews but poor sales rank - marketing opportunity
      if (asinData.rating && asinData.rating >= 4.0 &&
          asinData.salesRank && asinData.salesRank > 100000) {
        opportunities.push({
          sku: listing.sku,
          asin: listing.asin,
          title: listing.title?.substring(0, 50),
          category: cat,
          type: 'underperforming_quality',
          rating: asinData.rating,
          reviewCount: asinData.reviewCount,
          salesRank: asinData.salesRank,
          opportunity: 'Good product rating but poor sales - improve visibility'
        });
      }
    });
  }

  // Save analysis
  const analysis = {
    categories: Object.keys(categories).map(cat => ({
      name: cat,
      listingCount: categories[cat].length,
      avgPrice: categories[cat].reduce((sum, l) => sum + (l.price || 0), 0) / categories[cat].length
    })),
    gaps,
    opportunities,
    analyzedAt: new Date().toISOString()
  };

  const marketData = loadMarketAnalysis();
  marketData.analyses.latest = analysis;
  marketData.lastUpdate = new Date().toISOString();
  saveMarketAnalysis(marketData);

  return analysis;
}

/**
 * Get competitor pricing position summary
 */
function getCompetitorPositionSummary() {
  const listings = loadListings();
  const keepaData = loadKeepaData();

  const positions = {
    belowBuyBox: [],
    atBuyBox: [],
    aboveBuyBox: [],
    noBuyBoxData: []
  };

  for (const listing of listings.items) {
    const asinData = keepaData[listing.asin];

    if (!asinData || !asinData.buyBoxPrice) {
      positions.noBuyBoxData.push({
        sku: listing.sku,
        asin: listing.asin,
        price: listing.price
      });
      continue;
    }

    const diff = listing.price - asinData.buyBoxPrice;
    const diffPercent = (diff / asinData.buyBoxPrice) * 100;

    const item = {
      sku: listing.sku,
      asin: listing.asin,
      title: listing.title?.substring(0, 40),
      ourPrice: listing.price,
      buyBoxPrice: asinData.buyBoxPrice,
      difference: Math.round(diff * 100) / 100,
      differencePercent: Math.round(diffPercent * 10) / 10
    };

    if (diffPercent < -2) {
      positions.belowBuyBox.push(item);
    } else if (diffPercent <= 2) {
      positions.atBuyBox.push(item);
    } else {
      positions.aboveBuyBox.push(item);
    }
  }

  return {
    summary: {
      total: listings.items.length,
      belowBuyBox: positions.belowBuyBox.length,
      atBuyBox: positions.atBuyBox.length,
      aboveBuyBox: positions.aboveBuyBox.length,
      noBuyBoxData: positions.noBuyBoxData.length
    },
    positions
  };
}

/**
 * Generate competitive intelligence report
 */
function generateCompetitiveReport() {
  const buyBoxAnalysis = getBulkBuyBoxAnalysis();
  const positionSummary = getCompetitorPositionSummary();
  const marketGaps = analyzeMarketGaps();

  return {
    generatedAt: new Date().toISOString(),
    buyBoxPerformance: {
      averageWinRate: buyBoxAnalysis.summary.averageWinRate,
      distribution: {
        good: buyBoxAnalysis.summary.good,
        fair: buyBoxAnalysis.summary.fair,
        poor: buyBoxAnalysis.summary.poor
      },
      needsAttention: buyBoxAnalysis.items.filter(i => i.status === 'poor').slice(0, 10)
    },
    pricingPosition: positionSummary.summary,
    opportunities: marketGaps.opportunities.slice(0, 10),
    priceGaps: marketGaps.gaps.slice(0, 5),
    recommendations: [
      buyBoxAnalysis.summary.poor > 0 ?
        `${buyBoxAnalysis.summary.poor} listings have poor Buy Box win rates - review pricing` : null,
      positionSummary.summary.aboveBuyBox > 3 ?
        `${positionSummary.summary.aboveBuyBox} listings priced above Buy Box - consider price reductions` : null,
      marketGaps.opportunities.filter(o => o.type === 'low_competition_high_demand').length > 0 ?
        'Found products with high demand and low competition - prioritize inventory' : null
    ].filter(Boolean)
  };
}

// ============================================
// EXPORTS
// ============================================

export {
  // Competitor tracking
  trackCompetitor,
  untrackCompetitor,
  getTrackedCompetitors,
  getAllTrackedCompetitors,

  // Price history
  recordCompetitorPrice,
  getCompetitorPriceHistory,
  analyzePriceTrends,

  // Buy Box analysis
  calculateBuyBoxWinRate,
  getBulkBuyBoxAnalysis,

  // Market analysis
  analyzeMarketGaps,
  getCompetitorPositionSummary,
  generateCompetitiveReport
};
