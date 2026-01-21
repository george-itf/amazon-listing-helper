// Scoring Engine - Enhanced with Compliance, Competitive, and History
// Weights: SEO 20%, Content 20%, Images 15%, Competitive 20%, Compliance 25%
// Updated to use PostgreSQL repositories

import * as ScoreRepository from './repositories/score.repository.js';
import * as ListingRepository from './repositories/listing.repository.js';

// Amazon blocked/restricted words and phrases
const BLOCKED_TERMS = {
  superlatives: [
    'best', 'fastest', 'cheapest', 'top rated', '#1', 'number one', 'leading',
    'most popular', 'best seller', 'best-selling', 'award winning', 'award-winning'
  ],
  healthClaims: [
    'cure', 'cures', 'treat', 'treats', 'heal', 'heals', 'prevent', 'prevents',
    'diagnosis', 'therapeutic', 'clinically proven', 'fda approved', 'medical grade',
    'antibacterial', 'antimicrobial', 'antiviral', 'kills germs', 'kills bacteria',
    'disinfect', 'sanitize', 'sterilize'
  ],
  guarantees: [
    'guarantee', 'guaranteed', 'warranty', 'lifetime warranty', 'money back',
    'risk free', 'risk-free', '100% satisfaction', 'no questions asked'
  ],
  environmental: [
    'eco-friendly', 'eco friendly', 'green', 'sustainable', 'biodegradable',
    'recyclable', 'organic', 'natural', 'non-toxic', 'chemical free', 'chemical-free'
  ],
  pesticides: [
    'kills insects', 'insect killer', 'pest control', 'bug killer', 'rodent',
    'kills ants', 'kills roaches', 'mosquito', 'flea', 'tick', 'pesticide'
  ],
  safety: [
    'fireproof', 'fire proof', 'fire-proof', 'bulletproof', 'bullet proof',
    'explosion proof', 'childproof', 'child proof', 'tamper proof', 'waterproof rating'
  ],
  certifications: [
    'ce certified', 'ul listed', 'iso certified', 'rohs', 'fcc certified',
    'tuv certified', 'etl listed'
  ]
};

// Words that suggest potential issues
const WARNING_TERMS = {
  competitorBrands: [
    'dewalt', 'makita', 'bosch', 'milwaukee', 'hilti', 'festool', 'metabo',
    'ryobi', 'black & decker', 'black and decker', 'craftsman', 'kobalt',
    'ridgid', 'porter cable', 'porter-cable', 'hitachi', 'snap-on', 'snap on'
  ],
  timeframes: [
    'limited time', 'sale ends', 'offer expires', 'today only', 'act now',
    'hurry', 'last chance', 'while supplies last'
  ],
  exaggeration: [
    'amazing', 'incredible', 'unbelievable', 'revolutionary', 'miracle',
    'magic', 'secret', 'exclusive', 'unique', 'one of a kind'
  ]
};

// Legacy loadJSON/saveJSON removed - using PostgreSQL repositories now

// Main scoring function - now accepts keepaData for competitive scoring
export function calculateScore(listing, keepaData = null, competitorData = null) {
  const seoScore = calculateSEOScore(listing);
  const contentScore = calculateContentScore(listing);
  const imageScore = calculateImageScore(listing);
  const complianceScore = calculateComplianceScore(listing);
  const competitiveScore = calculateCompetitiveScore(listing, keepaData, competitorData);

  // New weights: SEO 20%, Content 20%, Images 15%, Competitive 20%, Compliance 25%
  const totalScore = Math.round(
    (seoScore.score * 0.20) +
    (contentScore.score * 0.20) +
    (imageScore.score * 0.15) +
    (competitiveScore.score * 0.20) +
    (complianceScore.score * 0.25)
  );

  return {
    totalScore,
    components: {
      seo: seoScore,
      content: contentScore,
      images: imageScore,
      competitive: competitiveScore,
      compliance: complianceScore
    },
    recommendations: [
      ...seoScore.recommendations,
      ...contentScore.recommendations,
      ...imageScore.recommendations,
      ...competitiveScore.recommendations,
      ...complianceScore.recommendations
    ].sort((a, b) => b.impact - a.impact)
  };
}

// Calculate and save score with history tracking (PostgreSQL)
export async function calculateAndSaveScore(listing, keepaData = null, competitorData = null) {
  const sku = listing.sku;
  if (!sku || !listing.id) return null;

  const score = calculateScore(listing, keepaData, competitorData);

  try {
    // Save score to PostgreSQL
    await ScoreRepository.create({
      listingId: listing.id,
      totalScore: score.totalScore,
      seoScore: score.components.seo.score,
      contentScore: score.components.content.score,
      imageScore: score.components.images.score,
      competitiveScore: score.components.competitive.score,
      complianceScore: score.components.compliance.score,
      seoViolations: score.components.seo.violations || [],
      contentViolations: score.components.content.violations || [],
      imageViolations: score.components.images.violations || [],
      competitiveViolations: score.components.competitive.violations || [],
      complianceViolations: score.components.compliance.violations || [],
      breakdown: score.components,
      recommendations: score.recommendations || []
    });

    // Update denormalized score on listing
    await ListingRepository.update(sku, {
      currentScore: score.totalScore
    });
  } catch (error) {
    console.error('Error saving score:', error.message);
  }

  return score;
}

// Get score history for a SKU (PostgreSQL)
export async function getScoreHistory(sku, days = 30) {
  try {
    // Get listing ID from SKU
    const listing = await ListingRepository.getBySku(sku);
    if (!listing) return [];

    // Get score history from PostgreSQL
    const history = await ScoreRepository.getHistoryByListingId(listing.id, days);

    // Format for compatibility with existing code
    return history.map(h => ({
      date: h.calculatedAt ? h.calculatedAt.toISOString().split('T')[0] : null,
      timestamp: h.calculatedAt ? h.calculatedAt.toISOString() : null,
      totalScore: parseFloat(h.totalScore),
      components: {
        seo: parseFloat(h.seoScore) || 0,
        content: parseFloat(h.contentScore) || 0,
        images: parseFloat(h.imageScore) || 0,
        competitive: parseFloat(h.competitiveScore) || 0,
        compliance: parseFloat(h.complianceScore) || 0
      }
    }));
  } catch (error) {
    console.error('Error getting score history:', error.message);
    return [];
  }
}

// Get score trends (improvement/decline analysis) (PostgreSQL)
export async function getScoreTrends(sku) {
  const history = await getScoreHistory(sku, 30);

  if (history.length < 2) {
    return { trend: 'insufficient_data', change: 0, entries: history.length };
  }

  const recent = history.slice(-7); // Last 7 entries
  const older = history.slice(0, Math.min(7, history.length - 7)); // First 7 entries

  if (older.length === 0) {
    return { trend: 'insufficient_data', change: 0, entries: history.length };
  }

  const recentAvg = recent.reduce((sum, e) => sum + e.totalScore, 0) / recent.length;
  const olderAvg = older.reduce((sum, e) => sum + e.totalScore, 0) / older.length;
  const change = recentAvg - olderAvg;

  let trend = 'stable';
  if (change >= 5) trend = 'improving';
  else if (change <= -5) trend = 'declining';

  // Component trends
  const componentTrends = {};
  const components = ['seo', 'content', 'images', 'competitive', 'compliance'];

  for (const comp of components) {
    const recentCompAvg = recent.reduce((sum, e) => sum + (e.components?.[comp] || 0), 0) / recent.length;
    const olderCompAvg = older.reduce((sum, e) => sum + (e.components?.[comp] || 0), 0) / older.length;
    const compChange = recentCompAvg - olderCompAvg;

    componentTrends[comp] = {
      change: Math.round(compChange),
      trend: compChange >= 5 ? 'improving' : compChange <= -5 ? 'declining' : 'stable'
    };
  }

  return {
    trend,
    change: Math.round(change),
    recentAvg: Math.round(recentAvg),
    olderAvg: Math.round(olderAvg),
    entries: history.length,
    componentTrends
  };
}

// ============ COMPLIANCE SCORING ============
function calculateComplianceScore(listing) {
  const title = listing.title || '';
  const titleLower = title.toLowerCase();
  const recommendations = [];
  let score = 100; // Start at 100, deduct for violations
  const violations = [];

  // Check blocked terms
  for (const [category, terms] of Object.entries(BLOCKED_TERMS)) {
    for (const term of terms) {
      if (titleLower.includes(term.toLowerCase())) {
        const severity = getSeverity(category);
        score -= severity.deduction;
        violations.push({
          term,
          category,
          severity: severity.level
        });
      }
    }
  }

  // Check warning terms (less severe)
  for (const [category, terms] of Object.entries(WARNING_TERMS)) {
    for (const term of terms) {
      // For competitor brands, only flag if it's not YOUR brand
      if (category === 'competitorBrands') {
        // Check if this appears to be comparing/compatible rather than being the brand
        if (titleLower.includes(term.toLowerCase()) &&
            !titleLower.startsWith(term.toLowerCase())) {
          // Might be "compatible with DeWalt" which is OK
          if (!titleLower.includes('compatible') &&
              !titleLower.includes('fits') &&
              !titleLower.includes('for ')) {
            score -= 5;
            violations.push({
              term,
              category: 'potentialBrandIssue',
              severity: 'warning'
            });
          }
        }
      } else {
        if (titleLower.includes(term.toLowerCase())) {
          score -= 3;
          violations.push({
            term,
            category,
            severity: 'warning'
          });
        }
      }
    }
  }

  // Check for excessive CAPS (Amazon style violation)
  const capsWords = title.split(' ').filter(w => w.length > 2 && w === w.toUpperCase());
  if (capsWords.length > 3) {
    score -= 10;
    violations.push({
      term: `${capsWords.length} ALL CAPS words`,
      category: 'formatting',
      severity: 'medium'
    });
    recommendations.push({
      type: 'compliance',
      priority: 'high',
      title: 'Reduce ALL CAPS usage',
      description: `Found ${capsWords.length} words in ALL CAPS. Amazon prefers title case. This can trigger listing suppression.`,
      impact: 15
    });
  }

  // Check for emoji/special characters
  const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
  const emojis = title.match(emojiRegex);
  if (emojis && emojis.length > 0) {
    score -= 15;
    violations.push({
      term: `${emojis.length} emoji(s)`,
      category: 'formatting',
      severity: 'high'
    });
    recommendations.push({
      type: 'compliance',
      priority: 'critical',
      title: 'Remove emojis from title',
      description: 'Emojis in titles violate Amazon style guidelines and will cause listing suppression.',
      impact: 25
    });
  }

  // Check for HTML/special formatting
  if (/<[^>]+>/.test(title) || /&[a-z]+;/i.test(title)) {
    score -= 20;
    violations.push({
      term: 'HTML tags or entities',
      category: 'formatting',
      severity: 'critical'
    });
    recommendations.push({
      type: 'compliance',
      priority: 'critical',
      title: 'Remove HTML from title',
      description: 'HTML tags and entities are not allowed in Amazon titles.',
      impact: 30
    });
  }

  // Check for promotional language
  const promoPatterns = /\bsale\b|\bdiscount\b|\bfree shipping\b|\bbogo\b|\bbuy one get one\b/i;
  if (promoPatterns.test(title)) {
    score -= 15;
    violations.push({
      term: 'promotional language',
      category: 'promotionalContent',
      severity: 'high'
    });
    recommendations.push({
      type: 'compliance',
      priority: 'critical',
      title: 'Remove promotional language',
      description: 'Sales, discounts, and shipping mentions are not allowed in titles.',
      impact: 20
    });
  }

  // Generate recommendations for violations
  const criticalViolations = violations.filter(v => v.severity === 'critical' || v.severity === 'high');
  const mediumViolations = violations.filter(v => v.severity === 'medium');
  const warningViolations = violations.filter(v => v.severity === 'warning');

  if (criticalViolations.length > 0) {
    recommendations.push({
      type: 'compliance',
      priority: 'critical',
      title: 'Critical compliance issues found',
      description: `Remove these terms: ${criticalViolations.map(v => `"${v.term}"`).join(', ')}. These can cause listing suppression.`,
      impact: 30
    });
  }

  if (mediumViolations.length > 0) {
    recommendations.push({
      type: 'compliance',
      priority: 'high',
      title: 'Compliance warnings',
      description: `Consider removing: ${mediumViolations.map(v => `"${v.term}"`).join(', ')}. These may trigger Amazon reviews.`,
      impact: 15
    });
  }

  if (warningViolations.length > 0 && recommendations.length < 5) {
    recommendations.push({
      type: 'compliance',
      priority: 'medium',
      title: 'Minor compliance suggestions',
      description: `Review usage of: ${warningViolations.slice(0, 3).map(v => `"${v.term}"`).join(', ')}.`,
      impact: 5
    });
  }

  // Ensure score doesn't go below 0
  score = Math.max(0, score);

  return {
    score,
    maxScore: 100,
    violations,
    violationCount: violations.length,
    recommendations
  };
}

function getSeverity(category) {
  const severities = {
    superlatives: { level: 'high', deduction: 15 },
    healthClaims: { level: 'critical', deduction: 25 },
    guarantees: { level: 'high', deduction: 15 },
    environmental: { level: 'medium', deduction: 10 },
    pesticides: { level: 'critical', deduction: 30 },
    safety: { level: 'high', deduction: 15 },
    certifications: { level: 'medium', deduction: 10 }
  };
  return severities[category] || { level: 'low', deduction: 5 };
}

// ============ COMPETITIVE SCORING ============
function calculateCompetitiveScore(listing, keepaData = null, competitorData = null) {
  const recommendations = [];
  let score = 50; // Neutral if no data

  // If no Keepa data, return neutral score
  if (!keepaData) {
    recommendations.push({
      type: 'competitive',
      priority: 'medium',
      title: 'Sync competitive data',
      description: 'Run Keepa sync to get competitive analysis (BSR, pricing, competitors).',
      impact: 20
    });

    return {
      score: 50,
      maxScore: 100,
      dataAvailable: false,
      recommendations
    };
  }

  const price = listing.price || 0;
  let totalPoints = 0;
  let maxPoints = 0;

  // 1. Buy Box Analysis (30 points max)
  maxPoints += 30;
  const buyBoxPrice = keepaData.buyBoxPrice;
  if (buyBoxPrice && price > 0) {
    const priceRatio = price / buyBoxPrice;

    if (priceRatio <= 1.0) {
      // At or below buy box - excellent
      totalPoints += 30;
    } else if (priceRatio <= 1.05) {
      // Within 5% - good
      totalPoints += 25;
    } else if (priceRatio <= 1.10) {
      // Within 10% - okay
      totalPoints += 15;
      recommendations.push({
        type: 'competitive',
        priority: 'medium',
        title: 'Price slightly above Buy Box',
        description: `Your price (£${price.toFixed(2)}) is ${((priceRatio - 1) * 100).toFixed(1)}% above the Buy Box (£${buyBoxPrice.toFixed(2)}). Consider adjusting.`,
        impact: 10
      });
    } else if (priceRatio <= 1.20) {
      // Within 20% - concerning
      totalPoints += 5;
      recommendations.push({
        type: 'competitive',
        priority: 'high',
        title: 'Price above Buy Box',
        description: `Your price (£${price.toFixed(2)}) is ${((priceRatio - 1) * 100).toFixed(1)}% above the Buy Box (£${buyBoxPrice.toFixed(2)}). Unlikely to win Buy Box.`,
        impact: 20
      });
    } else {
      // More than 20% above
      totalPoints += 0;
      recommendations.push({
        type: 'competitive',
        priority: 'critical',
        title: 'Price significantly above market',
        description: `Your price (£${price.toFixed(2)}) is ${((priceRatio - 1) * 100).toFixed(1)}% above Buy Box (£${buyBoxPrice.toFixed(2)}). Very unlikely to sell.`,
        impact: 30
      });
    }
  } else {
    totalPoints += 15; // Neutral if no buy box data
  }

  // 2. BSR (Best Seller Rank) Analysis (25 points max)
  maxPoints += 25;
  const bsr = keepaData.salesRank || keepaData.bsr;
  if (bsr) {
    if (bsr <= 1000) {
      totalPoints += 25; // Top 1000 - excellent
    } else if (bsr <= 5000) {
      totalPoints += 22; // Top 5000 - very good
    } else if (bsr <= 20000) {
      totalPoints += 18; // Top 20000 - good
    } else if (bsr <= 50000) {
      totalPoints += 12; // Top 50000 - okay
      recommendations.push({
        type: 'competitive',
        priority: 'low',
        title: 'Moderate BSR',
        description: `BSR is ${bsr.toLocaleString()}. Consider optimizing listing to improve ranking.`,
        impact: 5
      });
    } else if (bsr <= 100000) {
      totalPoints += 8; // Top 100000 - below average
      recommendations.push({
        type: 'competitive',
        priority: 'medium',
        title: 'Low BSR ranking',
        description: `BSR is ${bsr.toLocaleString()}. Product may have low visibility. Focus on PPC and listing optimization.`,
        impact: 10
      });
    } else {
      totalPoints += 3; // Poor BSR
      recommendations.push({
        type: 'competitive',
        priority: 'high',
        title: 'Very low BSR',
        description: `BSR is ${bsr.toLocaleString()}. Consider if this product is worth continuing or needs major changes.`,
        impact: 15
      });
    }
  } else {
    totalPoints += 12; // Neutral if no BSR
  }

  // 3. Competition Level (20 points max)
  maxPoints += 20;
  const offerCount = keepaData.offerCount || keepaData.offers?.length || 0;
  if (offerCount > 0) {
    if (offerCount <= 2) {
      totalPoints += 20; // Low competition
    } else if (offerCount <= 5) {
      totalPoints += 16; // Moderate competition
    } else if (offerCount <= 10) {
      totalPoints += 12; // High competition
      recommendations.push({
        type: 'competitive',
        priority: 'medium',
        title: 'Competitive listing',
        description: `${offerCount} sellers on this listing. Differentiate with better price or Prime badge.`,
        impact: 8
      });
    } else {
      totalPoints += 5; // Very high competition
      recommendations.push({
        type: 'competitive',
        priority: 'high',
        title: 'Highly competitive listing',
        description: `${offerCount} sellers competing. Consider if margins justify the competition.`,
        impact: 12
      });
    }
  } else {
    totalPoints += 10; // Neutral
  }

  // 4. Rating Analysis (15 points max)
  maxPoints += 15;
  const rating = keepaData.rating;
  const reviewCount = keepaData.reviewCount || keepaData.reviews;
  if (rating) {
    if (rating >= 4.5) {
      totalPoints += 15;
    } else if (rating >= 4.0) {
      totalPoints += 12;
    } else if (rating >= 3.5) {
      totalPoints += 8;
      recommendations.push({
        type: 'competitive',
        priority: 'medium',
        title: 'Average product rating',
        description: `Rating is ${rating}/5. Work on product quality and customer service to improve.`,
        impact: 8
      });
    } else {
      totalPoints += 3;
      recommendations.push({
        type: 'competitive',
        priority: 'high',
        title: 'Low product rating',
        description: `Rating is ${rating}/5. Address quality issues or consider discontinuing.`,
        impact: 15
      });
    }
  } else {
    totalPoints += 7; // Neutral
  }

  // 5. Price Trend (10 points max)
  maxPoints += 10;
  const priceHistory = keepaData.priceHistory || keepaData.avgPrice;
  if (priceHistory && price > 0) {
    const avgPrice = typeof priceHistory === 'number' ? priceHistory : null;
    if (avgPrice) {
      const priceVsAvg = price / avgPrice;
      if (priceVsAvg >= 0.9 && priceVsAvg <= 1.1) {
        totalPoints += 10; // Within 10% of average
      } else if (priceVsAvg < 0.9) {
        totalPoints += 7; // Below average - might be leaving money on table
        recommendations.push({
          type: 'competitive',
          priority: 'low',
          title: 'Price below historical average',
          description: `Current price is ${((1 - priceVsAvg) * 100).toFixed(0)}% below average. Consider if you can increase.`,
          impact: 5
        });
      } else {
        totalPoints += 5; // Above average
      }
    } else {
      totalPoints += 5;
    }
  } else {
    totalPoints += 5;
  }

  score = Math.round((totalPoints / maxPoints) * 100);

  return {
    score,
    maxScore: 100,
    dataAvailable: true,
    analysis: {
      buyBoxPrice: keepaData.buyBoxPrice,
      bsr,
      offerCount,
      rating,
      reviewCount,
      currentPrice: price
    },
    recommendations
  };
}

// ============ SEO SCORING (existing, unchanged) ============
function calculateSEOScore(listing) {
  const title = listing.title || '';
  const recommendations = [];
  let score = 0;
  let maxScore = 0;

  // Title Length (optimal: 150-200 chars)
  maxScore += 25;
  const titleLen = title.length;
  if (titleLen >= 150 && titleLen <= 200) {
    score += 25;
  } else if (titleLen >= 100 && titleLen < 150) {
    score += 15;
    recommendations.push({
      type: 'seo',
      priority: 'medium',
      title: 'Title too short',
      description: `Title is ${titleLen} characters. Optimal is 150-200. Add more keywords or product details.`,
      impact: 10
    });
  } else if (titleLen > 200) {
    score += 15;
    recommendations.push({
      type: 'seo',
      priority: 'low',
      title: 'Title slightly long',
      description: `Title is ${titleLen} characters. Consider trimming to under 200 for better readability.`,
      impact: 5
    });
  } else {
    score += 5;
    recommendations.push({
      type: 'seo',
      priority: 'high',
      title: 'Title too short',
      description: `Title is only ${titleLen} characters. Add keywords, brand, key features to reach 150+ characters.`,
      impact: 20
    });
  }

  // Brand at start of title
  maxScore += 15;
  const brandPatterns = /^(dewalt|makita|bosch|milwaukee|stanley|draper|silverline|bahco|irwin|faithfull)/i;
  if (brandPatterns.test(title)) {
    score += 15;
  } else {
    score += 5;
    recommendations.push({
      type: 'seo',
      priority: 'medium',
      title: 'Brand not at title start',
      description: 'For DIY/Tools, putting the brand name first helps with search and trust.',
      impact: 10
    });
  }

  // Has key product identifiers
  maxScore += 20;
  const hasModel = /[A-Z]{2,}[\d-]+|[\d]+[A-Z]+/i.test(title);
  const hasSize = /\d+\s*(mm|cm|m|inch|"|v|volt|w|watt|ah|amp)/i.test(title);
  const hasQuantity = /\d+\s*(pcs?|pieces?|pack|set|x\s)/i.test(title);

  let identifierScore = 0;
  if (hasModel) identifierScore += 7;
  if (hasSize) identifierScore += 7;
  if (hasQuantity) identifierScore += 6;
  score += identifierScore;

  if (!hasModel) {
    recommendations.push({
      type: 'seo',
      priority: 'medium',
      title: 'Add model number to title',
      description: 'Include the product model/part number for better search matching.',
      impact: 7
    });
  }
  if (!hasSize) {
    recommendations.push({
      type: 'seo',
      priority: 'high',
      title: 'Add size/specs to title',
      description: 'Include key specifications (voltage, size, wattage) in title.',
      impact: 10
    });
  }
  if (!hasQuantity) {
    recommendations.push({
      type: 'seo',
      priority: 'medium',
      title: 'Add quantity to title',
      description: 'If selling multiple items, add quantity (e.g., "Pack of 10", "3x").',
      impact: 5
    });
  }

  // No keyword stuffing (repeated words)
  maxScore += 15;
  const words = title.toLowerCase().split(/\s+/);
  const wordCounts = {};
  words.forEach(w => { if (w.length > 3) wordCounts[w] = (wordCounts[w] || 0) + 1; });
  const maxRepeats = Math.max(...Object.values(wordCounts), 0);
  if (maxRepeats <= 2) {
    score += 15;
  } else {
    score += 5;
    recommendations.push({
      type: 'seo',
      priority: 'high',
      title: 'Avoid keyword stuffing',
      description: 'Some words are repeated too many times. This can hurt rankings.',
      impact: 15
    });
  }

  // Readability - no ALL CAPS
  maxScore += 10;
  const capsRatio = (title.match(/[A-Z]/g) || []).length / Math.max(title.length, 1);
  if (capsRatio < 0.5) {
    score += 10;
  } else {
    score += 3;
    recommendations.push({
      type: 'seo',
      priority: 'medium',
      title: 'Reduce ALL CAPS usage',
      description: 'Too many capital letters reduces readability. Use normal case.',
      impact: 7
    });
  }

  // Special characters check
  maxScore += 15;
  const hasGoodSeparators = /[-|,]/.test(title);
  const hasBadChars = /[!@#$%^&*()+=\[\]{}\\;':"<>?\/]/.test(title);
  if (hasGoodSeparators && !hasBadChars) {
    score += 15;
  } else if (!hasBadChars) {
    score += 10;
  } else {
    score += 5;
    recommendations.push({
      type: 'seo',
      priority: 'medium',
      title: 'Remove special characters',
      description: 'Avoid using special characters like !, @, #, etc. Use hyphens or commas as separators.',
      impact: 8
    });
  }

  return {
    score: Math.round((score / maxScore) * 100),
    maxScore: 100,
    recommendations
  };
}

// ============ CONTENT SCORING (enhanced to check bullets and description) ============
function calculateContentScore(listing) {
  const title = listing.title || '';
  const bullets = listing.bulletPoints || listing.bullets || [];
  const description = listing.description || '';
  const allContent = [title, ...bullets, description].join(' ');
  const recommendations = [];
  let score = 0;
  let maxScore = 0;

  // Check if title has benefit-focused language
  maxScore += 25;
  const benefitWords = /professional|heavy.?duty|premium|durable|precision|high.?quality|reliable|powerful|efficient|long.?lasting/i;
  if (benefitWords.test(title)) {
    score += 25;
  } else if (benefitWords.test(allContent)) {
    score += 15; // Partial credit if in bullets/description
  } else {
    score += 5;
    recommendations.push({
      type: 'content',
      priority: 'medium',
      title: 'Add benefit language',
      description: 'Use words like "Professional", "Heavy Duty", "Precision" to highlight quality.',
      impact: 15
    });
  }

  // Check for compatibility mentions (important for DIY/Tools)
  maxScore += 20;
  const compatWords = /compatible|fits|for use with|works with|suitable for/i;
  if (compatWords.test(allContent)) {
    score += 20;
  } else {
    score += 5;
    recommendations.push({
      type: 'content',
      priority: 'high',
      title: 'Add compatibility info',
      description: 'Mention what tools/systems this product is compatible with.',
      impact: 15
    });
  }

  // Check for material/construction info
  maxScore += 20;
  const materialWords = /steel|chrome|carbide|titanium|metal|alloy|plastic|rubber|carbon|stainless|vanadium|copper|brass/i;
  if (materialWords.test(allContent)) {
    score += 20;
  } else {
    score += 5;
    recommendations.push({
      type: 'content',
      priority: 'medium',
      title: 'Mention materials',
      description: 'Include material information (e.g., "Chrome Vanadium Steel").',
      impact: 12
    });
  }

  // Application/use case
  maxScore += 20;
  const useWords = /drilling|cutting|fastening|measuring|woodwork|metalwork|construction|diy|home|garden|workshop|automotive|plumbing|electrical/i;
  if (useWords.test(allContent)) {
    score += 20;
  } else {
    score += 5;
    recommendations.push({
      type: 'content',
      priority: 'medium',
      title: 'Add use case',
      description: 'Mention the application (e.g., "For Woodworking", "Ideal for Construction").',
      impact: 10
    });
  }

  // NEW: Check bullet point quality
  maxScore += 15;
  if (bullets.length >= 5) {
    score += 15;
  } else if (bullets.length >= 3) {
    score += 10;
    recommendations.push({
      type: 'content',
      priority: 'medium',
      title: 'Add more bullet points',
      description: `Only ${bullets.length} bullets. Amazon allows 5 bullets - use them all for better conversion.`,
      impact: 8
    });
  } else {
    score += 3;
    recommendations.push({
      type: 'content',
      priority: 'high',
      title: 'Add bullet points',
      description: 'Missing bullet points. Add 5 benefit-focused bullets to improve conversion.',
      impact: 15
    });
  }

  return {
    score: Math.round((score / maxScore) * 100),
    maxScore: 100,
    bulletCount: bullets.length,
    recommendations
  };
}

// ============ IMAGE SCORING (existing, unchanged) ============
function calculateImageScore(listing) {
  const recommendations = [];
  let score = 0;
  let maxScore = 0;

  // We don't have image data from the basic report
  // Score neutral and recommend fetching catalog data
  maxScore += 100;
  score += 50; // Neutral score

  recommendations.push({
    type: 'images',
    priority: 'low',
    title: 'Verify image quality',
    description: 'Check that you have 7+ images including lifestyle shots, infographics, and size reference.',
    impact: 25
  });

  return {
    score: Math.round((score / maxScore) * 100),
    maxScore: 100,
    recommendations
  };
}

export {
  calculateSEOScore,
  calculateContentScore,
  calculateImageScore,
  calculateComplianceScore,
  calculateCompetitiveScore,
  BLOCKED_TERMS,
  WARNING_TERMS
};
