// AI-Powered Recommendations for Amazon Listings
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '..', 'data');

function loadJSON(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf8'));
  } catch { return null; }
}

// Generate AI recommendations based on scoring data
function generateRecommendations(sku) {
  const scores = loadJSON('scores.json') || {};
  const listings = loadJSON('listings.json');
  const item = listings?.items?.find(i => i.sku === sku);
  const scoreData = scores[sku];
  
  if (!item || !scoreData) return { error: 'Listing not found' };
  
  const recommendations = [];
  const components = scoreData.components || {};
  
  // Title recommendations
  if (components.seo?.score < 80) {
    const title = item.title || '';
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
  if (components.content?.score < 70) {
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
  if (components.pricing?.score < 70) {
    const price = item.price || 0;
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
  if (components.images?.score < 80) {
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
    asin: item.asin,
    title: item.title,
    currentScore: scoreData.totalScore,
    recommendations,
    quickWins: recommendations
      .filter(r => r.priority === 'high')
      .slice(0, 3)
      .map(r => r.category)
  };
}

// Bulk recommendations for worst performers
function getBulkRecommendations(limit = 10) {
  const scores = loadJSON('scores.json') || {};
  const listings = loadJSON('listings.json');
  const items = listings?.items || [];
  
  // Sort by score ascending (worst first)
  const sorted = items
    .filter(i => scores[i.sku])
    .map(i => ({ ...i, score: scores[i.sku].totalScore }))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);
  
  return sorted.map(item => ({
    sku: item.sku,
    title: (item.title || '').substring(0, 60) + '...',
    score: item.score,
    topIssue: getTopIssue(scores[item.sku])
  }));
}

function getTopIssue(scoreData) {
  if (!scoreData?.components) return 'Review listing';
  const comps = scoreData.components;
  const worst = Object.entries(comps)
    .map(([name, data]) => ({ name, score: data.score }))
    .sort((a, b) => a.score - b.score)[0];
  return worst ? `Improve ${worst.name} (${worst.score}/100)` : 'Review listing';
}

export { generateRecommendations, getBulkRecommendations };
