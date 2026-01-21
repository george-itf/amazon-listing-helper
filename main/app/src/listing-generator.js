// Listing Generator - Generate listing recommendations from ASINs or Components
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '..', 'data');

function loadJSON(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf8'));
  } catch { return null; }
}

function saveJSON(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

// DIY/Tools category keyword database - expanded with more terms
const CATEGORY_KEYWORDS = {
  tools: {
    benefits: ['professional', 'heavy-duty', 'durable', 'precision', 'ergonomic', 'high-quality', 'reliable', 'powerful', 'industrial-grade', 'commercial-grade', 'long-lasting', 'robust'],
    materials: ['chrome vanadium', 'carbon steel', 'stainless steel', 'hardened steel', 'titanium coated', 'rubber grip', 'drop-forged', 'heat-treated', 'alloy steel', 'S2 steel'],
    uses: ['DIY', 'professional use', 'workshop', 'construction', 'home improvement', 'woodworking', 'metalworking', 'automotive', 'plumbing', 'electrical work', 'maintenance'],
    features: ['anti-slip grip', 'corrosion resistant', 'heat treated', 'magnetic tip', 'quick release', 'adjustable', 'ratcheting', 'insulated', 'non-marring', 'polished finish']
  },
  fasteners: {
    benefits: ['strong', 'rust-resistant', 'self-tapping', 'countersunk', 'secure hold', 'corrosion-proof', 'weather-resistant', 'high-tensile'],
    materials: ['stainless steel', 'zinc plated', 'brass', 'galvanised', 'A2 grade', 'A4 marine grade', 'black oxide', 'nickel plated', 'phosphate coated'],
    uses: ['indoor', 'outdoor', 'marine', 'decking', 'woodwork', 'metal fixing', 'drywall', 'concrete', 'sheet metal', 'roofing'],
    features: ['torx drive', 'pozi drive', 'hex head', 'pan head', 'countersunk', 'thread-forming', 'self-drilling', 'flanged', 'split-point']
  },
  electrical: {
    benefits: ['safe', 'certified', 'insulated', 'VDE approved', 'rated', 'tested', 'compliant', 'reliable'],
    materials: ['copper', 'PVC insulated', 'fire retardant', 'double insulated', 'LSZH', 'XLPE'],
    uses: ['domestic', 'commercial', 'industrial', 'outdoor rated', 'wet locations', 'high temperature'],
    features: ['IP rated', 'CE marked', 'RoHS compliant', 'low voltage', 'high current', 'shielded', 'flame retardant']
  },
  storage: {
    benefits: ['organised', 'sturdy', 'stackable', 'portable', 'heavy-duty', 'secure'],
    materials: ['steel', 'polypropylene', 'ABS plastic', 'powder-coated', 'reinforced'],
    uses: ['workshop', 'garage', 'site', 'vehicle', 'home', 'professional'],
    features: ['lockable', 'removable tray', 'cantilever', 'ball-bearing slides', 'waterproof seal']
  },
  safety: {
    benefits: ['protective', 'comfortable', 'certified', 'high-visibility', 'impact-resistant'],
    materials: ['polycarbonate', 'nitrile', 'latex-free', 'breathable mesh', 'EN certified'],
    uses: ['construction', 'workshop', 'industrial', 'gardening', 'DIY'],
    features: ['adjustable', 'anti-fog', 'scratch-resistant', 'cut-resistant', 'EN388 rated']
  }
};

// Title templates by product type
const TITLE_TEMPLATES = {
  tool: '{brand} {product} {specs} - {material} {benefit} for {use} ({quantity})',
  set: '{brand} {product} Set {quantity}pc - {material} {benefit} Kit for {use}',
  consumable: '{brand} {product} {specs} - Pack of {quantity} - {material} {benefit}',
  accessory: '{brand} {product} {specs} - Compatible with {compatibility} - {benefit}'
};

// Bullet point templates
const BULLET_TEMPLATES = [
  { prefix: 'PROFESSIONAL QUALITY', template: '{benefit} construction using {material} for long-lasting durability and reliable performance' },
  { prefix: 'VERSATILE USE', template: 'Ideal for {use} - suitable for both professional tradespeople and DIY enthusiasts' },
  { prefix: 'PRECISION ENGINEERED', template: '{feature} design ensures {benefit} results every time' },
  { prefix: 'COMPLETE SOLUTION', template: 'Includes {contents} - everything you need for {use}' },
  { prefix: 'BUILT TO LAST', template: '{material} construction with {feature} for extended tool life' }
];

// Validate ASIN format
function isValidASIN(asin) {
  // ASIN is 10 characters, starts with B0 or is all alphanumeric
  return /^[A-Z0-9]{10}$/i.test(asin);
}

// Generate listing recommendation from ASIN analysis
async function generateFromASIN(asin, keepaData = null) {
  // Validate ASIN
  if (!asin || !isValidASIN(asin)) {
    return {
      error: 'Invalid ASIN format. ASIN should be 10 alphanumeric characters.',
      asin
    };
  }

  const listings = loadJSON('listings.json');
  const keepa = loadJSON('keepa.json');
  const scores = loadJSON('scores.json');

  // Find existing listing by ASIN
  const existing = listings?.items?.find(l => l.asin === asin);
  const existingKeepa = keepaData || keepa?.data?.[asin] || keepa?.[asin] || null;
  const existingScore = existing ? scores?.[existing.sku] : null;

  const analysis = {
    asin,
    existingListing: existing ? {
      sku: existing.sku,
      title: existing.title,
      price: existing.price,
      score: existingScore?.totalScore
    } : null,
    keepaData: existingKeepa ? {
      title: existingKeepa.title,
      buyBoxPrice: existingKeepa.buyBoxPrice,
      salesRank: existingKeepa.salesRank,
      rating: existingKeepa.rating,
      reviewCount: existingKeepa.reviewCount,
      competitors: existingKeepa.offerCount
    } : null
  };

  // Generate recommendations based on available data
  const recommendations = generateListingRecommendations(analysis);

  // If we have existing listing data, generate improved version
  let generatedListing = null;
  if (existing && existing.title) {
    // Extract info from existing title to improve it
    const brand = extractBrandFromTitle(existing.title);
    const productType = detectProductType(existing.title);

    generatedListing = {
      title: improveTitle(existing.title, brand),
      bulletPoints: generateImprovedBullets(existing, analysis),
      description: generateDescriptionFromExisting(existing, analysis),
      searchTerms: generateSearchTermsFromTitle(existing.title),
      pricingSuggestion: existingKeepa ? {
        min: existingKeepa.buyBoxPrice ? existingKeepa.buyBoxPrice * 0.95 : existing.price * 0.9,
        recommended: existingKeepa.buyBoxPrice || existing.price,
        max: existingKeepa.buyBoxPrice ? existingKeepa.buyBoxPrice * 1.1 : existing.price * 1.15
      } : null,
      imageRecommendations: generateImageRecommendations(productType).map(r => `${r.slot}: ${r.requirement}`),
      complianceCheck: checkComplianceIssues(existing.title)
    };
  }

  return {
    asin,
    analysis,
    recommendations,
    // Flat structure for frontend
    title: generatedListing?.title || existing?.title || `[ASIN: ${asin}] No title data available`,
    bulletPoints: generatedListing?.bulletPoints || [],
    description: generatedListing?.description || 'Sync this ASIN via SP-API to generate a full description.',
    searchTerms: generatedListing?.searchTerms || '',
    pricingSuggestion: generatedListing?.pricingSuggestion,
    imageRecommendations: generatedListing?.imageRecommendations || [],
    complianceCheck: generatedListing?.complianceCheck || { passed: true, issues: [] },
    generatedAt: new Date().toISOString()
  };
}

// Extract brand from title (usually first word/words before product name)
function extractBrandFromTitle(title) {
  const commonBrands = ['dewalt', 'makita', 'bosch', 'milwaukee', 'stanley', 'draper', 'silverline', 'bahco', 'irwin', 'faithfull', 'invicta'];
  const titleLower = title.toLowerCase();

  for (const brand of commonBrands) {
    if (titleLower.startsWith(brand)) {
      return brand.charAt(0).toUpperCase() + brand.slice(1);
    }
  }

  // Try first word
  const firstWord = title.split(/[\s-]/)[0];
  if (firstWord && firstWord.length > 2 && firstWord.length < 15) {
    return firstWord;
  }

  return '';
}

// Detect product type from title
function detectProductType(title) {
  const titleLower = title.toLowerCase();

  if (/set|kit|collection|pack of|pcs|pieces/i.test(titleLower)) return 'set';
  if (/screw|bolt|nut|nail|washer|anchor|fixing/i.test(titleLower)) return 'consumable';
  if (/blade|bit|disc|accessory|attachment|replacement/i.test(titleLower)) return 'accessory';

  return 'tool';
}

// Improve existing title
function improveTitle(existingTitle, brand) {
  let title = existingTitle;

  // Ensure proper length
  if (title.length < 100) {
    // Add keywords if title is too short
    if (!title.toLowerCase().includes('professional')) {
      title += ' - Professional Grade';
    }
    if (!title.toLowerCase().includes('quality')) {
      title += ' Quality';
    }
  }

  // Ensure brand at start if detected
  if (brand && !title.toLowerCase().startsWith(brand.toLowerCase())) {
    title = brand + ' ' + title;
  }

  // Truncate if too long
  if (title.length > 200) {
    title = title.substring(0, 197) + '...';
  }

  return title;
}

// Generate improved bullet points from existing listing
function generateImprovedBullets(existing, analysis) {
  const bullets = [];
  const title = existing.title || '';

  bullets.push(`PROFESSIONAL QUALITY - Built to professional standards for reliable, long-lasting performance in demanding applications`);

  // Extract material if mentioned in title
  const materialMatch = title.match(/steel|chrome|carbide|titanium|metal|alloy/i);
  if (materialMatch) {
    bullets.push(`DURABLE CONSTRUCTION - Made with ${materialMatch[0]} for exceptional durability and extended service life`);
  } else {
    bullets.push(`DURABLE CONSTRUCTION - Premium materials ensure extended service life and dependable performance`);
  }

  bullets.push(`VERSATILE APPLICATION - Suitable for both professional tradespeople and DIY enthusiasts`);

  // Add price-value bullet if we have pricing data
  if (analysis.keepaData?.buyBoxPrice) {
    bullets.push(`GREAT VALUE - Competitively priced with premium quality materials and construction`);
  }

  bullets.push(`QUALITY ASSURED - Backed by our commitment to customer satisfaction. Contact us with any questions`);

  return bullets;
}

// Generate description from existing listing data
function generateDescriptionFromExisting(existing, analysis) {
  const title = existing.title || 'this product';
  const price = existing.price;
  const keepa = analysis.keepaData;

  let desc = `${title}\n\n`;
  desc += `This product is designed to meet the demands of both professional users and dedicated DIY enthusiasts. `;

  if (keepa?.rating && keepa?.reviewCount) {
    desc += `With a ${keepa.rating}/5 star rating from ${keepa.reviewCount} customer reviews, this product has proven its quality and reliability.\n\n`;
  } else {
    desc += `Built with quality and reliability in mind.\n\n`;
  }

  desc += `Whether you're working on a professional project or tackling home improvements, this product delivers the performance you need. `;
  desc += `Order with confidence knowing you're getting a quality product backed by excellent customer service.`;

  return desc;
}

// Generate search terms from title
function generateSearchTermsFromTitle(title) {
  const words = title.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'from'].includes(w));

  const uniqueWords = [...new Set(words)];
  return uniqueWords.slice(0, 50).join(' ');
}

// Generate listing from component/product description
function generateFromComponents(components) {
  /*
    components: {
      productType: 'tool' | 'set' | 'consumable' | 'accessory',
      brand: string,
      name/productName: string,
      category: 'tools' | 'fasteners' | 'electrical',
      specs: { size, voltage, quantity, etc },
      targetPrice: number,
      targetAudience: 'professional' | 'diy' | 'both'
    }
  */

  const {
    productType = 'tool',
    brand = '',
    name = '',  // Frontend sends 'name'
    productName = name, // Support both field names
    category = 'tools',
    targetPrice = 0,
    targetAudience = 'both',
    features = [],
    material = '',  // Frontend sends single material
    materials = material ? [material] : [],
    compatibility = '',
    quantity = '',
    size = ''
  } = components;

  // Build specs object from individual fields if not provided
  const specs = components.specs || {};
  if (quantity && !specs.quantity) specs.quantity = quantity;
  if (size && !specs.size) specs.size = size;

  const actualProductName = productName || name;

  const categoryKeywords = CATEGORY_KEYWORDS[category] || CATEGORY_KEYWORDS.tools;
  const actualMaterials = materials.length > 0 ? materials : (material ? [material] : []);

  // Generate optimized title
  const title = generateOptimizedTitle({
    template: TITLE_TEMPLATES[productType] || TITLE_TEMPLATES.tool,
    brand,
    product: actualProductName,
    specs: formatSpecs(specs),
    material: materials[0] || pickRandom(categoryKeywords.materials),
    benefit: pickRandom(categoryKeywords.benefits),
    use: targetAudience === 'professional' ? 'Professional Use' : targetAudience === 'diy' ? 'DIY & Home' : 'Professional & DIY',
    quantity: specs.quantity || '',
    compatibility
  });

  // Generate bullet points
  const bullets = generateBulletPoints({
    categoryKeywords,
    features: features.length ? features : categoryKeywords.features.slice(0, 3),
    materials: actualMaterials.length ? actualMaterials : [categoryKeywords.materials[0]],
    use: pickRandom(categoryKeywords.uses),
    specs,
    targetAudience
  });

  // Generate search terms
  const searchTerms = generateSearchTerms({
    productName: actualProductName,
    category,
    specs,
    categoryKeywords
  });

  // Pricing suggestions
  const pricingSuggestions = generatePricingSuggestions(targetPrice, category);

  // Generate description
  const description = generateDescription({
    brand,
    productName: actualProductName,
    features: features.length ? features : categoryKeywords.features.slice(0, 3),
    materials: actualMaterials,
    categoryKeywords,
    targetAudience
  });

  const imageRecs = generateImageRecommendations(productType);
  const complianceCheck = checkComplianceIssues(title + ' ' + bullets.map(b => b.text).join(' '));

  // Return flat structure that frontend expects
  return {
    title,
    bulletPoints: bullets.map(b => b.text),
    description,
    searchTerms,
    pricingSuggestion: pricingSuggestions.suggestions ? {
      min: parseFloat(pricingSuggestions.suggestions.find(s => s.type === 'competitive')?.price) || targetPrice * 0.9,
      recommended: targetPrice || 0,
      max: parseFloat(pricingSuggestions.suggestions.find(s => s.type === 'premium')?.price) || targetPrice * 1.1
    } : null,
    imageRecommendations: imageRecs.map(r => `${r.slot}: ${r.requirement}`),
    complianceCheck,
    // Also include detailed data for advanced users
    _detailed: {
      input: components,
      titleMeta: {
        length: title.length,
        optimal: title.length >= 150 && title.length <= 200
      },
      bullets,
      pricingSuggestions,
      tips: [
        'Ensure main image has pure white background (RGB 255,255,255)',
        'Add at least 6 images including lifestyle and infographic shots',
        'Fill all backend search term fields (up to 250 bytes)',
        'Use A+ Content if Brand Registered for higher conversion'
      ]
    },
    generatedAt: new Date().toISOString()
  };
}

// Generate product description
function generateDescription(params) {
  const { brand, productName, features, materials, categoryKeywords, targetAudience } = params;

  const audienceText = targetAudience === 'professional' ? 'professionals' :
    targetAudience === 'diy' ? 'DIY enthusiasts' : 'professionals and DIY enthusiasts';

  let desc = '';

  // Opening paragraph
  if (brand) {
    desc += `The ${brand} ${productName} is designed for ${audienceText} who demand quality and reliability. `;
  } else {
    desc += `This ${productName} is designed for ${audienceText} who demand quality and reliability. `;
  }

  // Materials paragraph
  if (materials.length > 0) {
    desc += `Constructed from ${materials.join(' and ')}, this product ensures long-lasting durability and dependable performance.\n\n`;
  } else {
    desc += `Built with premium materials for long-lasting durability and dependable performance.\n\n`;
  }

  // Features paragraph
  if (features.length > 0) {
    desc += `Key features include: ${features.join(', ')}. `;
  }

  // Use cases
  const uses = categoryKeywords.uses.slice(0, 3).join(', ');
  desc += `Ideal for ${uses}.\n\n`;

  // Closing
  desc += `Whether you're a professional tradesperson or a dedicated DIY enthusiast, this ${productName} delivers the performance you need.`;

  return desc;
}

// Multi-ASIN comparison and recommendation
async function compareASINs(asins) {
  const results = [];
  const keepa = loadJSON('keepa.json');
  const listings = loadJSON('listings.json');

  for (const asin of asins) {
    const keepaData = keepa?.data?.[asin] || keepa?.[asin] || null;
    const existing = listings?.items?.find(l => l.asin === asin);

    // Build product info for comparison
    const product = {
      asin,
      title: existing?.title || keepaData?.title || `ASIN: ${asin}`,
      price: existing?.price || keepaData?.buyBoxPrice || null,
      bsr: keepaData?.salesRank || null,
      rating: keepaData?.rating || null,
      reviewCount: keepaData?.reviewCount || null
    };

    results.push(product);
  }

  // Calculate summary statistics
  const withPrices = results.filter(r => r.price);
  const withRatings = results.filter(r => r.rating);
  const withBSR = results.filter(r => r.bsr);

  const avgPrice = withPrices.length > 0
    ? withPrices.reduce((sum, r) => sum + r.price, 0) / withPrices.length
    : null;
  const avgRating = withRatings.length > 0
    ? withRatings.reduce((sum, r) => sum + r.rating, 0) / withRatings.length
    : null;
  const bestBSR = withBSR.length > 0
    ? Math.min(...withBSR.map(r => r.bsr))
    : null;

  let summary = 'Comparison Analysis: ';
  if (avgPrice) summary += `Average price £${avgPrice.toFixed(2)}. `;
  if (avgRating) summary += `Average rating ${avgRating.toFixed(1)}/5. `;
  if (bestBSR) summary += `Best BSR: ${bestBSR.toLocaleString()}. `;
  if (!avgPrice && !avgRating && !bestBSR) {
    summary += 'Limited data available. Sync Keepa data for better analysis.';
  }

  return {
    products: results,
    summary,
    statistics: {
      avgPrice,
      avgRating,
      bestBSR,
      productsAnalyzed: results.length
    },
    generatedAt: new Date().toISOString()
  };
}

// Helper functions
function generateOptimizedTitle(params) {
  let title = params.template;

  for (const [key, value] of Object.entries(params)) {
    if (key !== 'template') {
      title = title.replace(`{${key}}`, value || '');
    }
  }

  // Clean up empty placeholders and double spaces
  title = title.replace(/\{[^}]+\}/g, '').replace(/\s+/g, ' ').replace(/\s+-\s+-/g, ' -').trim();
  title = title.replace(/\(\s*\)/g, '').replace(/\s+-\s*$/g, '').trim();

  return title;
}

function generateBulletPoints(params) {
  const { categoryKeywords, features, materials, use, specs, targetAudience } = params;

  const bullets = [];

  // Bullet 1: Quality/Material
  bullets.push({
    prefix: 'PROFESSIONAL QUALITY',
    text: `PROFESSIONAL QUALITY - ${materials[0] || 'Premium'} construction ensures durability and long-lasting performance for demanding applications`
  });

  // Bullet 2: Versatility
  const audience = targetAudience === 'professional' ? 'professional tradespeople' :
    targetAudience === 'diy' ? 'DIY enthusiasts' : 'professionals and DIY enthusiasts alike';
  bullets.push({
    prefix: 'VERSATILE APPLICATION',
    text: `VERSATILE APPLICATION - Perfect for ${use}, designed for ${audience}`
  });

  // Bullet 3: Key Feature
  if (features.length > 0) {
    bullets.push({
      prefix: 'KEY FEATURES',
      text: `KEY FEATURES - ${features.slice(0, 3).join(', ')} for enhanced usability and precision`
    });
  }

  // Bullet 4: Specs
  if (Object.keys(specs).length > 0) {
    const specList = Object.entries(specs)
      .filter(([k, v]) => v)
      .map(([k, v]) => `${formatKey(k)}: ${v}`)
      .join(', ');
    if (specList) {
      bullets.push({
        prefix: 'SPECIFICATIONS',
        text: `SPECIFICATIONS - ${specList}`
      });
    }
  }

  // Bullet 5: Guarantee/Trust
  bullets.push({
    prefix: 'QUALITY ASSURED',
    text: 'QUALITY ASSURED - Backed by our commitment to quality. If you have any issues, our customer service team is here to help'
  });

  return bullets;
}

function generateSearchTerms(params) {
  const { productName, category, specs, categoryKeywords } = params;
  const terms = new Set();

  // Stopwords to exclude
  const stopwords = ['the', 'and', 'for', 'with', 'from', 'this', 'that', 'are', 'was', 'were', 'been'];

  // Add product name variations
  const cleanName = productName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  terms.add(cleanName);
  cleanName.split(' ').forEach(w => {
    if (w.length > 2 && !stopwords.includes(w)) terms.add(w);
  });

  // Add category keywords - more comprehensive
  categoryKeywords.uses.forEach(u => terms.add(u.toLowerCase()));
  categoryKeywords.benefits.slice(0, 5).forEach(b => terms.add(b.toLowerCase()));
  categoryKeywords.materials.slice(0, 3).forEach(m => terms.add(m.toLowerCase()));
  categoryKeywords.features.slice(0, 3).forEach(f => terms.add(f.toLowerCase()));

  // Add spec-based terms with variations
  if (specs.size) {
    const size = specs.size.toString().toLowerCase();
    terms.add(size);
    terms.add(size.replace(/mm$/, ' mm'));
    terms.add(size.replace(/cm$/, ' cm'));
  }
  if (specs.voltage) {
    terms.add(`${specs.voltage}v`);
    terms.add(`${specs.voltage} volt`);
  }
  if (specs.quantity) {
    terms.add(`pack of ${specs.quantity}`);
    terms.add(`${specs.quantity} pack`);
    terms.add(`${specs.quantity}pc`);
    terms.add(`${specs.quantity} piece`);
  }

  // Add common search variations
  terms.add(category);
  terms.add(`${category} uk`);
  terms.add(`buy ${productName.split(' ')[0]}`);

  // Add common misspellings/variations for tools
  const firstWord = productName.split(' ')[0].toLowerCase();
  if (firstWord.endsWith('er')) {
    terms.add(firstWord.slice(0, -2) + 'ers'); // hammer -> hammers
  }
  if (!firstWord.endsWith('s')) {
    terms.add(firstWord + 's'); // plurals
  }

  // Convert to string, limit to 250 bytes (Amazon limit)
  let result = Array.from(terms).join(' ');
  while (new TextEncoder().encode(result).length > 250) {
    const termsArray = result.split(' ');
    termsArray.pop();
    result = termsArray.join(' ');
  }

  return result;
}

function generatePricingSuggestions(targetPrice, category) {
  if (!targetPrice) {
    return {
      note: 'No target price provided',
      suggestions: [
        'Research competitor pricing for similar products',
        'Consider cost + margin approach',
        'Test different price points'
      ]
    };
  }

  const suggestions = [];
  const psychological = Math.floor(targetPrice) - 0.01;

  suggestions.push({
    type: 'psychological',
    price: psychological.toFixed(2),
    reason: 'Psychological pricing ending in .99'
  });

  suggestions.push({
    type: 'competitive',
    price: (targetPrice * 0.95).toFixed(2),
    reason: '5% below target for competitive positioning'
  });

  suggestions.push({
    type: 'premium',
    price: (targetPrice * 1.1).toFixed(2),
    reason: '10% above for premium positioning with enhanced listing'
  });

  return {
    targetPrice,
    suggestions
  };
}

function generateImageRecommendations(productType) {
  const recommendations = [
    { slot: 'Main', requirement: 'White background, product only, 1500x1500px minimum', priority: 'required' },
    { slot: 'Image 2', requirement: 'Product at angle showing key features', priority: 'required' },
    { slot: 'Image 3', requirement: 'Lifestyle shot - product in use', priority: 'high' },
    { slot: 'Image 4', requirement: 'Size/scale reference with common object', priority: 'high' },
    { slot: 'Image 5', requirement: 'Infographic highlighting key specs/benefits', priority: 'high' },
    { slot: 'Image 6', requirement: 'Close-up of quality/material detail', priority: 'medium' },
    { slot: 'Image 7', requirement: 'Package contents / what\'s included', priority: 'medium' }
  ];

  if (productType === 'set') {
    recommendations[6] = { slot: 'Image 7', requirement: 'All items laid out showing complete set', priority: 'high' };
  }

  return recommendations;
}

function checkComplianceIssues(text) {
  const issues = [];
  const textLower = text.toLowerCase();

  // Expanded blocked terms matching scoring.js
  const blockedTermsByCategory = {
    superlatives: ['best', 'cheapest', 'fastest', '#1', 'number one', 'top rated', 'leading', 'most popular', 'best seller'],
    healthClaims: ['cure', 'cures', 'treat', 'treats', 'heal', 'heals', 'prevent', 'fda approved', 'medical grade', 'antibacterial', 'antimicrobial'],
    guarantees: ['guarantee', 'guaranteed', 'warranty', 'lifetime warranty', 'money back', 'risk free', '100% satisfaction'],
    environmental: ['eco-friendly', 'organic', 'natural', 'non-toxic', 'chemical free'],
    safety: ['fireproof', 'bulletproof', 'explosion proof', 'childproof'],
    promotional: ['sale', 'discount', 'free shipping', 'limited time', 'act now', 'hurry']
  };

  // Check all blocked terms
  for (const [category, terms] of Object.entries(blockedTermsByCategory)) {
    for (const term of terms) {
      if (textLower.includes(term.toLowerCase())) {
        const severity = ['healthClaims', 'safety'].includes(category) ? 'critical' : 'high';
        issues.push({
          term,
          category,
          severity,
          message: `"${term}" may violate Amazon ${category} guidelines`
        });
      }
    }
  }

  // Check for ALL CAPS abuse
  const capsWords = text.split(' ').filter(w => w.length > 3 && w === w.toUpperCase());
  if (capsWords.length > 5) {
    issues.push({ term: 'ALL CAPS', category: 'formatting', severity: 'medium', message: 'Excessive use of capital letters' });
  } else if (capsWords.length > 3) {
    issues.push({ term: 'CAPS overuse', category: 'formatting', severity: 'low', message: 'Consider reducing capital letters' });
  }

  // Check for emoji
  const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
  if (emojiRegex.test(text)) {
    issues.push({ term: 'emoji', category: 'formatting', severity: 'critical', message: 'Emojis are not allowed in Amazon listings' });
  }

  // Check for HTML
  if (/<[^>]+>/.test(text) || /&[a-z]+;/i.test(text)) {
    issues.push({ term: 'HTML', category: 'formatting', severity: 'critical', message: 'HTML tags/entities are not allowed' });
  }

  return {
    passed: issues.filter(i => i.severity === 'critical' || i.severity === 'high').length === 0,
    issues,
    criticalCount: issues.filter(i => i.severity === 'critical').length,
    highCount: issues.filter(i => i.severity === 'high').length
  };
}

function generateListingRecommendations(analysis) {
  const recommendations = [];

  // Based on existing listing
  if (analysis.existingListing) {
    const score = analysis.existingListing.score;
    if (score < 60) {
      recommendations.push({
        priority: 'high',
        area: 'Overall Quality',
        suggestion: `Current score is ${score}. Focus on improving title, bullets, and images.`
      });
    }

    if (analysis.existingListing.title && analysis.existingListing.title.length < 150) {
      recommendations.push({
        priority: 'high',
        area: 'Title Length',
        suggestion: `Title is ${analysis.existingListing.title.length} chars. Expand to 150-200 for better SEO.`
      });
    }
  }

  // Based on Keepa data
  if (analysis.keepaData) {
    if (analysis.keepaData.rating && analysis.keepaData.rating < 4.0) {
      recommendations.push({
        priority: 'high',
        area: 'Product Quality',
        suggestion: `Rating is ${analysis.keepaData.rating}/5. Review customer feedback and address issues.`
      });
    }

    if (analysis.keepaData.competitors && analysis.keepaData.competitors > 10) {
      recommendations.push({
        priority: 'medium',
        area: 'Competition',
        suggestion: `${analysis.keepaData.competitors} sellers on this listing. Differentiate with better price or Prime.`
      });
    }

    if (analysis.keepaData.salesRank && analysis.keepaData.salesRank > 100000) {
      recommendations.push({
        priority: 'medium',
        area: 'Visibility',
        suggestion: `BSR is ${analysis.keepaData.salesRank.toLocaleString()}. Consider PPC and listing optimization.`
      });
    }
  }

  // Generic recommendations
  if (recommendations.length === 0) {
    recommendations.push({
      priority: 'medium',
      area: 'General',
      suggestion: 'Sync Keepa data and run a full listing score to get specific recommendations.'
    });
  }

  return recommendations;
}

function analyzeBestPractices(results) {
  const practices = [];

  // Find highest rated
  const withRatings = results.filter(r => r.analysis.keepaData?.rating);
  if (withRatings.length > 0) {
    const bestRated = withRatings.reduce((a, b) =>
      (a.analysis.keepaData.rating > b.analysis.keepaData.rating) ? a : b
    );
    practices.push({
      insight: 'Best Rated Product',
      asin: bestRated.asin,
      value: `${bestRated.analysis.keepaData.rating}/5 stars`,
      recommendation: 'Study this listing\'s approach to quality and customer service'
    });
  }

  // Find best BSR
  const withBSR = results.filter(r => r.analysis.keepaData?.salesRank);
  if (withBSR.length > 0) {
    const bestBSR = withBSR.reduce((a, b) =>
      (a.analysis.keepaData.salesRank < b.analysis.keepaData.salesRank) ? a : b
    );
    practices.push({
      insight: 'Best Selling Product',
      asin: bestBSR.asin,
      value: `BSR #${bestBSR.analysis.keepaData.salesRank.toLocaleString()}`,
      recommendation: 'Analyze this listing\'s title, images, and pricing strategy'
    });
  }

  return practices;
}

function generateCompetitiveStrategy(results) {
  const validResults = results.filter(r => r.analysis.keepaData);

  if (validResults.length === 0) {
    return {
      summary: 'Insufficient data for competitive analysis',
      actions: ['Ensure Keepa data is synced for the provided ASINs']
    };
  }

  const avgPrice = validResults.reduce((sum, r) => sum + (r.analysis.keepaData.buyBoxPrice || 0), 0) / validResults.length;
  const avgRating = validResults.reduce((sum, r) => sum + (r.analysis.keepaData.rating || 0), 0) / validResults.length;

  return {
    summary: 'Competitive Analysis Summary',
    metrics: {
      averagePrice: avgPrice.toFixed(2),
      averageRating: avgRating.toFixed(1),
      productsAnalyzed: validResults.length
    },
    actions: [
      avgPrice > 0 ? `Target price around £${(avgPrice * 0.95).toFixed(2)} to be competitive` : 'Research competitor pricing',
      avgRating > 4 ? 'Focus on quality - competitors have high ratings' : 'Opportunity to differentiate on quality',
      'Use high-quality images that stand out from competitors',
      'Optimize title with unique selling points not covered by competitors'
    ]
  };
}

// Utility functions
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)] || '';
}

function formatSpecs(specs) {
  const parts = [];
  if (specs.size) parts.push(specs.size);
  if (specs.voltage) parts.push(`${specs.voltage}V`);
  if (specs.wattage) parts.push(`${specs.wattage}W`);
  if (specs.length) parts.push(`${specs.length}mm`);
  return parts.join(' ');
}

function formatKey(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
}

// Save generated listing for later use
function saveGeneratedListing(data) {
  const saved = loadJSON('generated-listings.json') || { listings: [] };
  const id = `gen-${Date.now()}`;

  saved.listings.unshift({
    id,
    ...data,
    savedAt: new Date().toISOString()
  });

  // Keep only last 50
  saved.listings = saved.listings.slice(0, 50);
  saveJSON('generated-listings.json', saved);

  return id;
}

function getSavedListings() {
  const saved = loadJSON('generated-listings.json') || { listings: [] };
  return saved.listings;
}

function deleteSavedListing(id) {
  const saved = loadJSON('generated-listings.json') || { listings: [] };
  saved.listings = saved.listings.filter(l => l.id !== id);
  saveJSON('generated-listings.json', saved);
  return true;
}

export {
  generateFromASIN,
  generateFromComponents,
  compareASINs,
  saveGeneratedListing,
  getSavedListings,
  deleteSavedListing,
  CATEGORY_KEYWORDS,
  TITLE_TEMPLATES
};
