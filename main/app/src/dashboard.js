// Dashboard Analytics for Amazon Listings Helper
// Updated to use PostgreSQL repositories

import * as ListingRepository from './repositories/listing.repository.js';
import * as ScoreRepository from './repositories/score.repository.js';
import * as AlertRepository from './repositories/alert.repository.js';
import * as SettingsRepository from './repositories/settings.repository.js';

/**
 * Get comprehensive dashboard statistics
 * @returns {Promise<Object>} Dashboard stats
 */
async function getDashboardStats() {
  // Get data from PostgreSQL
  const listings = await ListingRepository.getAll();
  const scoreStats = await ScoreRepository.getStatistics();
  const scoreDistribution = await ScoreRepository.getDistribution();
  const unreadAlertCount = await AlertRepository.getUnreadCount();
  const alertsGrouped = await AlertRepository.getGroupedByType();
  const lastSync = await SettingsRepository.getValue('last_sync');

  const totalListings = listings.length;

  // Price statistics
  const prices = listings.map(l => parseFloat(l.price)).filter(p => p > 0);
  const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;

  // Score statistics from repository
  const avgScore = parseFloat(scoreStats?.avg_score) || 0;
  const totalScored = parseInt(scoreStats?.total_scored) || 0;

  // Count listings by score range
  const scores = listings.map(l => parseFloat(l.currentScore)).filter(s => !isNaN(s));
  const lowScoreCount = scores.filter(s => s < 60).length;
  const goodScoreCount = scores.filter(s => s >= 80).length;

  // Score distribution for chart (convert from PostgreSQL format)
  const distributionMap = {};
  for (const d of scoreDistribution) {
    distributionMap[d.bucket] = parseInt(d.count);
  }

  const scoreDistributionChart = [
    { range: '0-20', count: scores.filter(s => s < 20).length },
    { range: '21-40', count: scores.filter(s => s >= 20 && s < 40).length },
    { range: '41-60', count: scores.filter(s => s >= 40 && s < 60).length },
    { range: '61-80', count: scores.filter(s => s >= 60 && s < 80).length },
    { range: '81-100', count: scores.filter(s => s >= 80).length }
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
  const criticalAlerts = alertsGrouped
    .filter(g => g.severity === 'critical')
    .reduce((sum, g) => sum + parseInt(g.count), 0);
  const highAlerts = alertsGrouped
    .filter(g => g.severity === 'high')
    .reduce((sum, g) => sum + parseInt(g.count), 0);

  // Listings needing attention (lowest scores)
  const needsAttention = listings
    .filter(l => l.currentScore !== null && parseFloat(l.currentScore) < 50)
    .map(l => ({
      sku: l.sku,
      title: l.title || l.sku,
      score: parseFloat(l.currentScore) || 0,
      price: parseFloat(l.price) || 0
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
      unreadAlerts: unreadAlertCount,
      criticalAlerts,
      highAlerts
    },
    charts: {
      scoreDistribution: scoreDistributionChart,
      priceRanges
    },
    topIssues: [], // Would need to aggregate from score breakdown - TODO
    needsAttention,
    lastSync
  };
}

/**
 * Export listings as CSV
 * @returns {Promise<string>} CSV content
 */
async function exportCSV() {
  const listings = await ListingRepository.getAll();

  const headers = ['SKU', 'ASIN', 'Title', 'Price', 'Score', 'Status'];
  const rows = listings.map(l => {
    const score = parseFloat(l.currentScore);
    const status = isNaN(score) ? 'N/A' : score >= 80 ? 'Good' : score >= 60 ? 'OK' : 'Needs Work';
    return [
      l.sku,
      l.asin || '',
      `"${(l.title || '').replace(/"/g, '""')}"`,
      l.price || 0,
      isNaN(score) ? 'N/A' : score.toFixed(1),
      status
    ];
  });

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

export { getDashboardStats, exportCSV };
