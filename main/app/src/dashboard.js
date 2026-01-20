// Dashboard Analytics for Amazon Listings Helper
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '..', 'data');

function loadJSON(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf8'));
  } catch { return null; }
}

function getDashboardStats() {
  const listings = loadJSON('listings.json');
  const scores = loadJSON('scores.json') || {};
  const keepa = loadJSON('keepa.json') || {};
  const costs = loadJSON('costs.json') || {};
  const alerts = loadJSON('alerts.json') || [];
  
  const items = listings?.items || [];
  const totalListings = items.length;
  
  // Price statistics
  const prices = items.map(i => i.price).filter(p => p > 0);
  const avgPrice = prices.length ? prices.reduce((a,b) => a+b, 0) / prices.length : 0;
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  
  // Score statistics
  const scoreValues = Object.values(scores).map(s => s.totalScore).filter(s => s !== undefined);
  const avgScore = scoreValues.length ? scoreValues.reduce((a,b) => a+b, 0) / scoreValues.length : 0;
  const lowScoreCount = scoreValues.filter(s => s < 60).length;
  const goodScoreCount = scoreValues.filter(s => s >= 80).length;
  
  // Score distribution for chart
  const scoreDistribution = [
    { range: '0-20', count: scoreValues.filter(s => s < 20).length },
    { range: '21-40', count: scoreValues.filter(s => s >= 20 && s < 40).length },
    { range: '41-60', count: scoreValues.filter(s => s >= 40 && s < 60).length },
    { range: '61-80', count: scoreValues.filter(s => s >= 60 && s < 80).length },
    { range: '81-100', count: scoreValues.filter(s => s >= 80).length }
  ];
  
  // Price distribution
  const priceRanges = [
    { range: '£0-25', count: prices.filter(p => p < 25).length },
    { range: '£25-50', count: prices.filter(p => p >= 25 && p < 50).length },
    { range: '£50-100', count: prices.filter(p => p >= 50 && p < 100).length },
    { range: '£100-200', count: prices.filter(p => p >= 100 && p < 200).length },
    { range: '£200+', count: prices.filter(p => p >= 200).length }
  ];
  
  // Alert summary
  const unreadAlerts = alerts.filter(a => !a.read).length;
  const criticalAlerts = alerts.filter(a => a.severity === 'critical' && !a.read).length;
  const highAlerts = alerts.filter(a => a.severity === 'high' && !a.read).length;
  
  // Top issues (most common recommendations)
  const issueCount = {};
  Object.values(scores).forEach(s => {
    if (s.components) {
      Object.values(s.components).forEach(comp => {
        (comp.recommendations || []).forEach(rec => {
          issueCount[rec.title] = (issueCount[rec.title] || 0) + 1;
        });
      });
    }
  });
  const topIssues = Object.entries(issueCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([issue, count]) => ({ issue, count }));
  
  // Listings needing attention (lowest scores)
  const needsAttention = items
    .filter(i => scores[i.sku]?.totalScore < 50)
    .map(i => ({
      sku: i.sku,
      title: i.title || i.name || i.sku,
      score: scores[i.sku]?.totalScore || 0,
      price: i.price
    }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 10);
  
  return {
    summary: {
      totalListings,
      avgPrice: avgPrice.toFixed(2),
      minPrice: minPrice.toFixed(2),
      maxPrice: maxPrice.toFixed(2),
      avgScore: avgScore.toFixed(1),
      lowScoreCount,
      goodScoreCount,
      unreadAlerts,
      criticalAlerts,
      highAlerts
    },
    charts: {
      scoreDistribution,
      priceRanges
    },
    topIssues,
    needsAttention,
    lastSync: listings?.lastSync || null
  };
}

function exportCSV() {
  const listings = loadJSON('listings.json');
  const scores = loadJSON('scores.json') || {};
  const items = listings?.items || [];
  
  const headers = ['SKU', 'ASIN', 'Title', 'Price', 'Score', 'Status'];
  const rows = items.map(i => [
    i.sku,
    i.asin || '',
    `"${(i.title || i.name || '').replace(/"/g, '""')}"`,
    i.price || 0,
    scores[i.sku]?.totalScore || 'N/A',
    scores[i.sku]?.totalScore >= 80 ? 'Good' : scores[i.sku]?.totalScore >= 60 ? 'OK' : 'Needs Work'
  ]);
  
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

export { getDashboardStats, exportCSV };
