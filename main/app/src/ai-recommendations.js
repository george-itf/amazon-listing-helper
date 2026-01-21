// AI-Powered Recommendations for Amazon Listings
// Updated to use PostgreSQL repositories

import * as ListingRepository from './repositories/listing.repository.js';
import * as ScoreRepository from './repositories/score.repository.js';

/**
 * Generate AI recommendations based on scoring data
 * @param {string} sku - Listing SKU
 * @returns {Promise<Object>} Recommendations
 */
async function generateRecommendations(sku) {
  try {
    const listing = await ListingRepository.getBySku(sku);
    if (!listing) return { error: 'Listing not found' };

    const scoreData = listing.id ? await ScoreRepository.getLatestByListingId(listing.id) : null;
    if (!scoreData) return { error: 'Score data not found' };

    const recommendations = [];
    const breakdown = scoreData.breakdown || {};

    // Title recommendations
    if (parseFloat(scoreData.seoScore) < 80) {
      const title = listing.title || '';
      recommendations.push({
        category: 'Title Optimization',
        priority: 'high',
        current: title.substring(0, 100) + (title.length > 100 ? '...' : ''),
        suggestions: [
          title.length < 150 ? `Expand title to 150+ characters (currently ${title.length})` : null,
          !title.match(/\d/) ? 'Add specific numbers (dimensions, quantities, specs)' : null,
          'Include primary keyword at the beginning',
          'Add brand name if missing',
          'Include key product benefits'
        ].filter(Boolean)
      });
    }

    // Bullet point recommendations
    if (parseFloat(scoreData.contentScore) < 70) {
      recommendations.push({
        category: 'Bullet Points',
        priority: 'high',
        suggestions: [
          'Start each bullet with a CAPITAL benefit word',
          'Include specific measurements and specifications',
          'Address common customer questions',
          'Highlight unique selling points',
          'Use all 5 bullet point slots'
        ]
      });
    }

    // Pricing recommendations
    if (breakdown.pricing?.score && breakdown.pricing.score < 70) {
      const price = parseFloat(listing.price) || 0;
      recommendations.push({
        category: 'Pricing Strategy',
        priority: 'medium',
        current: `£${price.toFixed(2)}`,
        suggestions: [
          'Review competitor pricing on similar items',
          'Consider psychological pricing (e.g., £X.99)',
          'Evaluate if bundling could increase value',
          'Check if price matches perceived quality'
        ]
      });
    }

    // Image recommendations
    if (parseFloat(scoreData.imageScore) < 80) {
      recommendations.push({
        category: 'Image Optimization',
        priority: 'high',
        suggestions: [
          'Use high-resolution images (1000x1000 minimum)',
          'Add lifestyle images showing product in use',
          'Include size comparison images',
          'Add infographic images highlighting features',
          'Ensure main image has white background'
        ]
      });
    }

    // Compliance recommendations
    if (parseFloat(scoreData.complianceScore) < 80) {
      recommendations.push({
        category: 'Compliance',
        priority: 'critical',
        suggestions: [
          'Review title for blocked terms',
          'Remove any superlatives or unverified claims',
          'Check for promotional language',
          'Verify all certifications are documented'
        ]
      });
    }

    // Keyword recommendations
    recommendations.push({
      category: 'Keyword Optimization',
      priority: 'medium',
      suggestions: [
        'Research top search terms for your category',
        'Include long-tail keywords in backend',
        'Add common misspellings to search terms',
        'Use all available search term fields'
      ]
    });

    return {
      sku,
      asin: listing.asin,
      title: listing.title,
      currentScore: parseFloat(scoreData.totalScore),
      recommendations,
      quickWins: recommendations
        .filter(r => r.priority === 'high' || r.priority === 'critical')
        .slice(0, 3)
        .map(r => r.category)
    };
  } catch (error) {
    console.error('Generate recommendations error:', error);
    return { error: error.message };
  }
}

/**
 * Get bulk recommendations for worst performers
 * @param {number} limit - Max number of listings
 * @returns {Promise<Array>} Recommendations for worst performers
 */
async function getBulkRecommendations(limit = 10) {
  try {
    // Get listings with scores, sorted by lowest score first
    const listings = await ListingRepository.getAll({ status: 'active' });

    // Sort by score ascending (worst first)
    const sorted = listings
      .filter(l => l.currentScore !== null)
      .map(l => ({
        sku: l.sku,
        asin: l.asin,
        title: l.title,
        score: parseFloat(l.currentScore)
      }))
      .sort((a, b) => a.score - b.score)
      .slice(0, limit);

    // Get top issue for each
    const results = [];
    for (const item of sorted) {
      const listing = await ListingRepository.getBySku(item.sku);
      const scoreData = listing?.id ? await ScoreRepository.getLatestByListingId(listing.id) : null;

      results.push({
        sku: item.sku,
        title: (item.title || '').substring(0, 60) + '...',
        score: item.score,
        topIssue: getTopIssue(scoreData)
      });
    }

    return results;
  } catch (error) {
    console.error('Bulk recommendations error:', error);
    return [];
  }
}

/**
 * Get the top issue from score data
 * @param {Object} scoreData - Score data object
 * @returns {string} Top issue description
 */
function getTopIssue(scoreData) {
  if (!scoreData) return 'Review listing';

  const components = {
    seo: parseFloat(scoreData.seoScore) || 0,
    content: parseFloat(scoreData.contentScore) || 0,
    images: parseFloat(scoreData.imageScore) || 0,
    competitive: parseFloat(scoreData.competitiveScore) || 0,
    compliance: parseFloat(scoreData.complianceScore) || 0
  };

  const worst = Object.entries(components)
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => a.score - b.score)[0];

  return worst ? `Improve ${worst.name} (${worst.score}/100)` : 'Review listing';
}

export { generateRecommendations, getBulkRecommendations };
