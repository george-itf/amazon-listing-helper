// Performance Metrics & Attribution Module
// Phase 6: Analytics & Predictions

import { readFileSync, writeFileSync, existsSync } from 'fs';

const DATA_DIR = process.env.DATA_DIR || '/opt/alh/data';
const METRICS_FILE = `${DATA_DIR}/metrics.json`;
const ATTRIBUTION_FILE = `${DATA_DIR}/attribution.json`;
const SCORE_HISTORY_FILE = `${DATA_DIR}/score-history.json`;

// Initialize data files
function initDataFiles() {
  if (!existsSync(METRICS_FILE)) {
    writeFileSync(METRICS_FILE, JSON.stringify({ metrics: {} }, null, 2));
  }
  if (!existsSync(ATTRIBUTION_FILE)) {
    writeFileSync(ATTRIBUTION_FILE, JSON.stringify({ events: [] }, null, 2));
  }
  if (!existsSync(SCORE_HISTORY_FILE)) {
    writeFileSync(SCORE_HISTORY_FILE, JSON.stringify({ history: {} }, null, 2));
  }
}

// ============ PERFORMANCE METRICS ============

export function recordMetrics(sku, metricsData) {
  initDataFiles();
  const data = JSON.parse(readFileSync(METRICS_FILE, 'utf8'));
  const metrics = data.metrics || {};

  if (!metrics[sku]) {
    metrics[sku] = [];
  }

  const record = {
    date: new Date().toISOString().split('T')[0],
    timestamp: new Date().toISOString(),
    pageViews: metricsData.pageViews || 0,
    sessions: metricsData.sessions || 0,
    unitsSold: metricsData.unitsSold || 0,
    revenue: metricsData.revenue || 0,
    conversionRate: metricsData.conversionRate || 0,
    bsr: metricsData.bsr || null,
    buyBoxPercent: metricsData.buyBoxPercent || 0,
    adSpend: metricsData.adSpend || 0,
    adSales: metricsData.adSales || 0,
    acos: metricsData.acos || 0,
    tacos: metricsData.tacos || 0,
    organicSales: metricsData.organicSales || 0
  };

  // Keep last 365 days of metrics
  metrics[sku].push(record);
  if (metrics[sku].length > 365) {
    metrics[sku] = metrics[sku].slice(-365);
  }

  writeFileSync(METRICS_FILE, JSON.stringify({ metrics }, null, 2));
  return record;
}

export function getMetrics(sku, days = 30) {
  initDataFiles();
  const data = JSON.parse(readFileSync(METRICS_FILE, 'utf8'));
  const skuMetrics = data.metrics?.[sku] || [];

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  return skuMetrics.filter(m => new Date(m.date) >= cutoffDate);
}

export function getMetricsSummary(sku, days = 30) {
  const metrics = getMetrics(sku, days);
  if (metrics.length === 0) {
    return { hasData: false, sku };
  }

  const totals = metrics.reduce((acc, m) => ({
    pageViews: acc.pageViews + (m.pageViews || 0),
    sessions: acc.sessions + (m.sessions || 0),
    unitsSold: acc.unitsSold + (m.unitsSold || 0),
    revenue: acc.revenue + (m.revenue || 0),
    adSpend: acc.adSpend + (m.adSpend || 0),
    adSales: acc.adSales + (m.adSales || 0)
  }), { pageViews: 0, sessions: 0, unitsSold: 0, revenue: 0, adSpend: 0, adSales: 0 });

  const avgConversion = totals.sessions > 0 ? (totals.unitsSold / totals.sessions) * 100 : 0;
  const avgAcos = totals.adSales > 0 ? (totals.adSpend / totals.adSales) * 100 : 0;
  const latestBSR = metrics[metrics.length - 1]?.bsr;
  const earliestBSR = metrics[0]?.bsr;
  const bsrTrend = (latestBSR && earliestBSR) ? earliestBSR - latestBSR : null;

  return {
    hasData: true,
    sku,
    period: days,
    dataPoints: metrics.length,
    totals,
    averages: {
      dailyPageViews: Math.round(totals.pageViews / metrics.length),
      dailyUnitsSold: Math.round(totals.unitsSold / metrics.length * 10) / 10,
      dailyRevenue: Math.round(totals.revenue / metrics.length * 100) / 100,
      conversionRate: Math.round(avgConversion * 100) / 100,
      acos: Math.round(avgAcos * 100) / 100
    },
    bsr: {
      current: latestBSR,
      trend: bsrTrend,
      improving: bsrTrend > 0
    }
  };
}

// ============ SCORE HISTORY ============

export function recordScore(sku, score, breakdown) {
  initDataFiles();
  const data = JSON.parse(readFileSync(SCORE_HISTORY_FILE, 'utf8'));
  const history = data.history || {};

  if (!history[sku]) {
    history[sku] = [];
  }

  const record = {
    date: new Date().toISOString().split('T')[0],
    timestamp: new Date().toISOString(),
    totalScore: score,
    breakdown: breakdown || {}
  };

  // Keep last 90 days of score history
  history[sku].push(record);
  if (history[sku].length > 90) {
    history[sku] = history[sku].slice(-90);
  }

  writeFileSync(SCORE_HISTORY_FILE, JSON.stringify({ history }, null, 2));
  return record;
}

export function getScoreHistory(sku, days = 30) {
  initDataFiles();
  const data = JSON.parse(readFileSync(SCORE_HISTORY_FILE, 'utf8'));
  const skuHistory = data.history?.[sku] || [];

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  return skuHistory.filter(h => new Date(h.date) >= cutoffDate);
}

export function getScoreTrend(sku) {
  const history = getScoreHistory(sku, 30);
  if (history.length < 2) {
    return { hasTrend: false, sku };
  }

  const scores = history.map(h => h.totalScore);
  const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
  const secondHalf = scores.slice(Math.floor(scores.length / 2));

  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  const change = secondAvg - firstAvg;

  return {
    hasTrend: true,
    sku,
    currentScore: scores[scores.length - 1],
    previousScore: scores[0],
    change: Math.round(change * 10) / 10,
    trend: change > 1 ? 'improving' : change < -1 ? 'declining' : 'stable',
    sparkline: scores.slice(-7)
  };
}

// ============ ATTRIBUTION ============

export function recordChange(sku, changeType, before, after, source = 'manual') {
  initDataFiles();
  const data = JSON.parse(readFileSync(ATTRIBUTION_FILE, 'utf8'));
  const events = data.events || [];

  const event = {
    id: `CHG-${Date.now()}`,
    sku,
    timestamp: new Date().toISOString(),
    changeType, // 'title', 'bullets', 'price', 'images', 'keywords', 'backend', 'category'
    before,
    after,
    source, // 'manual', 'automation', 'template', 'ai'
    metricsSnapshot: null,
    scoreSnapshot: null,
    analyzed: false,
    impact: null
  };

  events.push(event);

  // Keep last 1000 events
  if (events.length > 1000) {
    data.events = events.slice(-1000);
  } else {
    data.events = events;
  }

  writeFileSync(ATTRIBUTION_FILE, JSON.stringify(data, null, 2));
  return event;
}

export function getChanges(sku, limit = 50) {
  initDataFiles();
  const data = JSON.parse(readFileSync(ATTRIBUTION_FILE, 'utf8'));
  const events = data.events || [];

  const filtered = sku ? events.filter(e => e.sku === sku) : events;
  return filtered.slice(-limit).reverse();
}

export function analyzeChangeImpact(changeId) {
  initDataFiles();
  const data = JSON.parse(readFileSync(ATTRIBUTION_FILE, 'utf8'));
  const events = data.events || [];

  const eventIndex = events.findIndex(e => e.id === changeId);
  if (eventIndex === -1) return null;

  const event = events[eventIndex];
  const changeDate = new Date(event.timestamp);
  const sku = event.sku;

  // Get metrics before and after change
  const metricsBefore = getMetrics(sku, 14).filter(m => new Date(m.date) < changeDate);
  const metricsAfter = getMetrics(sku, 14).filter(m => new Date(m.date) >= changeDate);

  // Get score before and after
  const scoresBefore = getScoreHistory(sku, 14).filter(s => new Date(s.date) < changeDate);
  const scoresAfter = getScoreHistory(sku, 14).filter(s => new Date(s.date) >= changeDate);

  const calcAvg = (arr, field) => arr.length > 0 ?
    arr.reduce((sum, item) => sum + (item[field] || 0), 0) / arr.length : 0;

  const impact = {
    metricsImpact: {
      conversionBefore: calcAvg(metricsBefore, 'conversionRate'),
      conversionAfter: calcAvg(metricsAfter, 'conversionRate'),
      salesBefore: calcAvg(metricsBefore, 'unitsSold'),
      salesAfter: calcAvg(metricsAfter, 'unitsSold'),
      pageViewsBefore: calcAvg(metricsBefore, 'pageViews'),
      pageViewsAfter: calcAvg(metricsAfter, 'pageViews')
    },
    scoreImpact: {
      scoreBefore: scoresBefore.length > 0 ? scoresBefore[scoresBefore.length - 1].totalScore : null,
      scoreAfter: scoresAfter.length > 0 ? scoresAfter[scoresAfter.length - 1].totalScore : null
    },
    dataPointsBefore: metricsBefore.length,
    dataPointsAfter: metricsAfter.length,
    daysAnalyzed: 14
  };

  // Calculate overall impact assessment
  const salesChange = impact.metricsImpact.salesAfter - impact.metricsImpact.salesBefore;
  const conversionChange = impact.metricsImpact.conversionAfter - impact.metricsImpact.conversionBefore;
  const scoreChange = (impact.scoreImpact.scoreAfter || 0) - (impact.scoreImpact.scoreBefore || 0);

  impact.assessment = {
    salesImpact: salesChange > 0.5 ? 'positive' : salesChange < -0.5 ? 'negative' : 'neutral',
    conversionImpact: conversionChange > 0.5 ? 'positive' : conversionChange < -0.5 ? 'negative' : 'neutral',
    scoreImpact: scoreChange > 2 ? 'positive' : scoreChange < -2 ? 'negative' : 'neutral',
    overallImpact: (salesChange > 0 && conversionChange > 0) ? 'positive' :
      (salesChange < 0 && conversionChange < 0) ? 'negative' : 'mixed',
    confidence: (metricsBefore.length >= 7 && metricsAfter.length >= 7) ? 'high' :
      (metricsBefore.length >= 3 && metricsAfter.length >= 3) ? 'medium' : 'low'
  };

  // Update event with analysis
  events[eventIndex].analyzed = true;
  events[eventIndex].impact = impact;
  writeFileSync(ATTRIBUTION_FILE, JSON.stringify({ events }, null, 2));

  return { event, impact };
}

// ============ CANNIBALIZATION DETECTION ============

export function detectCannibalization(listings) {
  const results = [];

  // Group listings by potential overlap
  for (let i = 0; i < listings.length; i++) {
    for (let j = i + 1; j < listings.length; j++) {
      const listing1 = listings[i];
      const listing2 = listings[j];

      // Check title similarity
      const words1 = (listing1.title || '').toLowerCase().split(/\s+/);
      const words2 = (listing2.title || '').toLowerCase().split(/\s+/);
      const commonWords = words1.filter(w => words2.includes(w) && w.length > 3);
      const titleOverlap = commonWords.length / Math.max(words1.length, words2.length);

      // Check keyword overlap
      const kw1 = (listing1.keywords || '').toLowerCase().split(/[,\s]+/);
      const kw2 = (listing2.keywords || '').toLowerCase().split(/[,\s]+/);
      const commonKw = kw1.filter(k => kw2.includes(k) && k.length > 2);
      const kwOverlap = kw1.length > 0 && kw2.length > 0 ?
        commonKw.length / Math.min(kw1.length, kw2.length) : 0;

      // Check category similarity
      const sameCategory = listing1.category === listing2.category;

      // Check price proximity
      const price1 = parseFloat(listing1.price) || 0;
      const price2 = parseFloat(listing2.price) || 0;
      const priceDiff = Math.abs(price1 - price2) / Math.max(price1, price2, 1);
      const priceProximity = priceDiff < 0.2;

      const overlapScore = (titleOverlap * 40) + (kwOverlap * 40) +
        (sameCategory ? 10 : 0) + (priceProximity ? 10 : 0);

      if (overlapScore > 30) {
        results.push({
          listing1: { sku: listing1.sku, title: listing1.title },
          listing2: { sku: listing2.sku, title: listing2.title },
          overlapScore: Math.round(overlapScore),
          titleOverlap: Math.round(titleOverlap * 100),
          keywordOverlap: Math.round(kwOverlap * 100),
          sameCategory,
          priceProximity,
          commonKeywords: commonKw.slice(0, 10),
          recommendation: overlapScore > 60 ?
            'High cannibalization risk - consider differentiating or consolidating' :
            'Moderate overlap - review keyword strategy'
        });
      }
    }
  }

  return results.sort((a, b) => b.overlapScore - a.overlapScore);
}

// ============ PORTFOLIO OVERVIEW ============

export function getPortfolioMetrics(skus) {
  const results = [];

  for (const sku of skus) {
    const summary = getMetricsSummary(sku, 30);
    const trend = getScoreTrend(sku);
    results.push({ sku, metrics: summary, scoreTrend: trend });
  }

  const withData = results.filter(r => r.metrics.hasData);
  const totalRevenue = withData.reduce((sum, r) => sum + (r.metrics.totals?.revenue || 0), 0);
  const totalUnits = withData.reduce((sum, r) => sum + (r.metrics.totals?.unitsSold || 0), 0);
  const avgScore = results.filter(r => r.scoreTrend.hasTrend)
    .reduce((sum, r, _, arr) => sum + (r.scoreTrend.currentScore || 0) / arr.length, 0);

  return {
    totalListings: skus.length,
    withMetrics: withData.length,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalUnits,
    avgScore: Math.round(avgScore),
    items: results.slice(0, 50),
    topPerformers: results
      .filter(r => r.metrics.hasData)
      .sort((a, b) => (b.metrics.totals?.revenue || 0) - (a.metrics.totals?.revenue || 0))
      .slice(0, 10)
  };
}

export default {
  recordMetrics,
  getMetrics,
  getMetricsSummary,
  recordScore,
  getScoreHistory,
  getScoreTrend,
  recordChange,
  getChanges,
  analyzeChangeImpact,
  detectCannibalization,
  getPortfolioMetrics
};
