// A+ Content Generator - Generate Enhanced Brand Content for Amazon listings
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

// A+ Content Module Types (Amazon EBC modules)
const MODULE_TYPES = {
  // Text-focused modules
  STANDARD_HEADER: {
    id: 'standard_header',
    name: 'Standard Header with Text',
    description: 'Large headline with supporting text',
    fields: ['headline', 'subheadline', 'bodyText'],
    imageCount: 0,
    maxChars: { headline: 150, subheadline: 200, bodyText: 1000 }
  },
  STANDARD_TEXT: {
    id: 'standard_text',
    name: 'Standard Text Block',
    description: 'Rich text paragraph with optional header',
    fields: ['headline', 'bodyText'],
    imageCount: 0,
    maxChars: { headline: 100, bodyText: 2000 }
  },

  // Image-focused modules
  STANDARD_IMAGE_HEADER: {
    id: 'standard_image_header',
    name: 'Image Header',
    description: 'Full-width hero image with overlay text',
    fields: ['headline', 'subheadline'],
    imageCount: 1,
    imageDimensions: { width: 970, height: 600 },
    maxChars: { headline: 100, subheadline: 150 }
  },
  STANDARD_SINGLE_IMAGE: {
    id: 'standard_single_image',
    name: 'Single Image with Text',
    description: 'Image on left/right with text',
    fields: ['headline', 'bodyText', 'imageAlt'],
    imageCount: 1,
    imageDimensions: { width: 300, height: 300 },
    maxChars: { headline: 100, bodyText: 500, imageAlt: 100 }
  },

  // Multi-image modules
  STANDARD_THREE_IMAGE: {
    id: 'standard_three_image',
    name: 'Three Image Row',
    description: '3 images in a row with captions',
    fields: ['image1Alt', 'image1Caption', 'image2Alt', 'image2Caption', 'image3Alt', 'image3Caption'],
    imageCount: 3,
    imageDimensions: { width: 300, height: 300 },
    maxChars: { caption: 160, imageAlt: 100 }
  },
  STANDARD_FOUR_IMAGE: {
    id: 'standard_four_image',
    name: 'Four Image Grid',
    description: '4 images in a 2x2 grid with highlight text',
    fields: ['headline', 'image1Alt', 'image2Alt', 'image3Alt', 'image4Alt'],
    imageCount: 4,
    imageDimensions: { width: 220, height: 220 },
    maxChars: { headline: 100, imageAlt: 100 }
  },

  // Comparison modules
  COMPARISON_TABLE: {
    id: 'comparison_table',
    name: 'Comparison Chart',
    description: 'Compare your product against alternatives',
    fields: ['headline', 'products', 'features'],
    imageCount: 5, // Max products to compare
    imageDimensions: { width: 150, height: 150 },
    maxProducts: 5,
    maxFeatures: 10
  },

  // Technical/Spec modules
  TECH_SPECS: {
    id: 'tech_specs',
    name: 'Technical Specifications',
    description: 'Detailed product specifications table',
    fields: ['headline', 'specs'],
    imageCount: 1,
    imageDimensions: { width: 300, height: 300 },
    maxSpecs: 15
  }
};

// A+ Content Templates for different product types
const APLUS_TEMPLATES = {
  tool: {
    name: 'Professional Tool',
    modules: [
      { type: 'STANDARD_IMAGE_HEADER', purpose: 'Hero shot of tool in use' },
      { type: 'STANDARD_THREE_IMAGE', purpose: 'Key features highlight' },
      { type: 'TECH_SPECS', purpose: 'Detailed specifications' },
      { type: 'COMPARISON_TABLE', purpose: 'Compare to basic alternatives' },
      { type: 'STANDARD_TEXT', purpose: 'Quality assurance and warranty info' }
    ]
  },
  set: {
    name: 'Tool Set / Kit',
    modules: [
      { type: 'STANDARD_IMAGE_HEADER', purpose: 'Complete set laid out' },
      { type: 'STANDARD_FOUR_IMAGE', purpose: 'Individual tools highlight' },
      { type: 'STANDARD_THREE_IMAGE', purpose: 'Use cases' },
      { type: 'TECH_SPECS', purpose: 'What is included' },
      { type: 'STANDARD_TEXT', purpose: 'Value proposition' }
    ]
  },
  consumable: {
    name: 'Consumable / Fasteners',
    modules: [
      { type: 'STANDARD_IMAGE_HEADER', purpose: 'Product in application' },
      { type: 'TECH_SPECS', purpose: 'Specifications and sizes' },
      { type: 'STANDARD_THREE_IMAGE', purpose: 'Material and quality details' },
      { type: 'COMPARISON_TABLE', purpose: 'Size/type comparison' }
    ]
  },
  accessory: {
    name: 'Accessory / Attachment',
    modules: [
      { type: 'STANDARD_SINGLE_IMAGE', purpose: 'Product with compatible tool' },
      { type: 'STANDARD_TEXT', purpose: 'Compatibility information' },
      { type: 'STANDARD_THREE_IMAGE', purpose: 'Different uses' },
      { type: 'TECH_SPECS', purpose: 'Specifications' }
    ]
  }
};

// Generate A+ content for a listing
function generateAPlusContent(listing, productType = 'tool', options = {}) {
  const template = APLUS_TEMPLATES[productType] || APLUS_TEMPLATES.tool;
  const title = listing.title || '';
  const brand = extractBrand(title);
  const productName = extractProductName(title, brand);

  const modules = [];

  for (const moduleSpec of template.modules) {
    const moduleType = MODULE_TYPES[moduleSpec.type];
    if (!moduleType) continue;

    const content = generateModuleContent(moduleType, {
      brand,
      productName,
      title,
      listing,
      purpose: moduleSpec.purpose,
      ...options
    });

    modules.push({
      type: moduleSpec.type,
      typeInfo: moduleType,
      purpose: moduleSpec.purpose,
      content,
      imageRequirements: moduleType.imageCount > 0 ? {
        count: moduleType.imageCount,
        dimensions: moduleType.imageDimensions
      } : null
    });
  }

  return {
    sku: listing.sku,
    asin: listing.asin,
    productType,
    template: template.name,
    modules,
    generatedAt: new Date().toISOString(),
    status: 'draft',
    tips: generateAPlusTips(productType)
  };
}

// Generate content for a specific module type
function generateModuleContent(moduleType, context) {
  const { brand, productName, title, purpose } = context;
  const content = {};

  switch (moduleType.id) {
    case 'standard_header':
      content.headline = `Introducing ${brand} ${productName}`;
      content.subheadline = `Professional Grade Quality for Demanding Applications`;
      content.bodyText = generateHeroText(context);
      break;

    case 'standard_text':
      content.headline = purpose.includes('warranty') ? 'Quality You Can Trust' : 'Why Choose Us';
      content.bodyText = generateBodyText(context, purpose);
      break;

    case 'standard_image_header':
      content.headline = brand ? `${brand} ${productName}` : productName;
      content.subheadline = 'Built for Professionals, Perfect for DIY';
      content.imageRequirement = `Hero image: ${purpose}. Dimensions: ${moduleType.imageDimensions.width}x${moduleType.imageDimensions.height}px`;
      break;

    case 'standard_single_image':
      content.headline = extractKeyFeature(title);
      content.bodyText = generateFeatureText(context);
      content.imageAlt = `${productName} ${purpose}`;
      content.imageRequirement = `Single image showing ${purpose}. Dimensions: ${moduleType.imageDimensions.width}x${moduleType.imageDimensions.height}px`;
      break;

    case 'standard_three_image':
      content.images = [
        { alt: `${productName} feature 1`, caption: generateFeatureCaption(context, 1) },
        { alt: `${productName} feature 2`, caption: generateFeatureCaption(context, 2) },
        { alt: `${productName} feature 3`, caption: generateFeatureCaption(context, 3) }
      ];
      content.imageRequirement = `3 images showing ${purpose}. Each: ${moduleType.imageDimensions.width}x${moduleType.imageDimensions.height}px`;
      break;

    case 'standard_four_image':
      content.headline = 'Key Features';
      content.images = [
        { alt: `${productName} quality` },
        { alt: `${productName} durability` },
        { alt: `${productName} precision` },
        { alt: `${productName} versatility` }
      ];
      content.imageRequirement = `4 images in grid showing ${purpose}. Each: ${moduleType.imageDimensions.width}x${moduleType.imageDimensions.height}px`;
      break;

    case 'comparison_table':
      content.headline = 'Why Choose This Product?';
      content.products = generateComparisonProducts(context);
      content.features = generateComparisonFeatures(context);
      content.imageRequirement = `Product images for comparison. Each: ${moduleType.imageDimensions.width}x${moduleType.imageDimensions.height}px`;
      break;

    case 'tech_specs':
      content.headline = 'Technical Specifications';
      content.specs = generateTechSpecs(context);
      content.imageRequirement = `Technical/detailed product image. Dimensions: ${moduleType.imageDimensions.width}x${moduleType.imageDimensions.height}px`;
      break;
  }

  return content;
}

// Helper: Generate hero section text
function generateHeroText(context) {
  const { brand, productName } = context;
  return `The ${brand ? brand + ' ' : ''}${productName} represents the perfect balance of quality, durability, and value. ` +
    `Designed for both professional tradespeople and dedicated DIY enthusiasts, this product delivers exceptional performance ` +
    `in even the most demanding applications. With premium materials and precision engineering, you can trust this product ` +
    `to get the job done right, every time.`;
}

// Helper: Generate body text based on purpose
function generateBodyText(context, purpose) {
  const { brand, productName } = context;

  if (purpose.includes('warranty') || purpose.includes('quality')) {
    return `At ${brand || 'our company'}, we stand behind every product we sell. The ${productName} is manufactured to the highest standards ` +
      `using premium materials and rigorous quality control processes. We are committed to your complete satisfaction. ` +
      `If you have any questions or concerns about your purchase, our dedicated customer service team is here to help.`;
  }

  if (purpose.includes('value')) {
    return `The ${productName} offers exceptional value without compromising on quality. Every component has been carefully selected ` +
      `to deliver professional-grade performance at a price point that makes sense for your budget. ` +
      `Whether you're a professional tradesperson or a weekend warrior, this product will exceed your expectations.`;
  }

  return `Discover why professionals and DIY enthusiasts alike choose the ${productName}. ` +
    `With its combination of durability, precision, and ease of use, this product has become a trusted choice ` +
    `for a wide range of applications. Experience the difference quality makes.`;
}

// Helper: Extract key feature from title
function extractKeyFeature(title) {
  const features = ['Professional', 'Heavy Duty', 'Precision', 'Durable', 'Premium', 'High Quality'];
  for (const feature of features) {
    if (title.toLowerCase().includes(feature.toLowerCase())) {
      return `${feature} Performance`;
    }
  }
  return 'Superior Quality';
}

// Helper: Generate feature text
function generateFeatureText(context) {
  return `Designed with precision and built to last. This product features premium construction that stands up to ` +
    `heavy use while maintaining excellent performance. Perfect for professional and DIY applications alike.`;
}

// Helper: Generate feature caption
function generateFeatureCaption(context, index) {
  const captions = [
    ['Premium Materials', 'Precision Engineered', 'Ergonomic Design'],
    ['Built to Last', 'Professional Grade', 'Versatile Use'],
    ['Quality Construction', 'Reliable Performance', 'Easy to Use']
  ];
  return captions[index % captions.length][context.productName?.length % 3 || 0];
}

// Helper: Generate comparison products
function generateComparisonProducts(context) {
  const { productName, brand } = context;
  return [
    { name: `${brand || ''} ${productName}`.trim(), isYours: true },
    { name: 'Basic Alternative', isYours: false },
    { name: 'Budget Option', isYours: false }
  ];
}

// Helper: Generate comparison features
function generateComparisonFeatures(context) {
  return [
    { name: 'Premium Materials', yours: true, alt1: false, alt2: false },
    { name: 'Professional Grade', yours: true, alt1: false, alt2: false },
    { name: 'Durable Construction', yours: true, alt1: true, alt2: false },
    { name: 'Precision Engineered', yours: true, alt1: false, alt2: false },
    { name: 'Quality Guaranteed', yours: true, alt1: true, alt2: true }
  ];
}

// Helper: Generate tech specs
function generateTechSpecs(context) {
  const { title, listing } = context;
  const specs = [];

  // Extract specs from title
  const sizeMatch = title.match(/(\d+(?:\.\d+)?)\s*(?:mm|cm|inch|"|m)/i);
  if (sizeMatch) {
    specs.push({ label: 'Size', value: sizeMatch[0] });
  }

  const voltMatch = title.match(/(\d+)\s*[Vv](?:olt)?/);
  if (voltMatch) {
    specs.push({ label: 'Voltage', value: voltMatch[0] });
  }

  const quantityMatch = title.match(/(\d+)\s*(?:pc|pcs|piece|pieces|pack)/i);
  if (quantityMatch) {
    specs.push({ label: 'Quantity', value: quantityMatch[0] });
  }

  // Add standard specs
  specs.push({ label: 'Material', value: extractMaterial(title) || 'Premium Quality' });
  specs.push({ label: 'Suitable For', value: 'Professional & DIY Use' });
  specs.push({ label: 'Package Contents', value: 'As pictured' });

  return specs;
}

// Helper: Extract brand from title
function extractBrand(title) {
  const commonBrands = ['dewalt', 'makita', 'bosch', 'milwaukee', 'stanley', 'draper', 'silverline', 'bahco', 'irwin', 'faithfull', 'invicta'];
  const titleLower = title.toLowerCase();

  for (const brand of commonBrands) {
    if (titleLower.startsWith(brand)) {
      return brand.charAt(0).toUpperCase() + brand.slice(1);
    }
  }

  // Try first word
  const firstWord = title.split(/[\s-]/)[0];
  if (firstWord && firstWord.length > 2 && firstWord.length < 15 && /^[A-Z]/.test(firstWord)) {
    return firstWord;
  }

  return '';
}

// Helper: Extract product name
function extractProductName(title, brand) {
  let name = title;
  if (brand && name.toLowerCase().startsWith(brand.toLowerCase())) {
    name = name.substring(brand.length).trim();
  }
  // Remove trailing specs/numbers
  name = name.replace(/[\-–]\s*\d+.*$/, '').trim();
  // Limit length
  return name.length > 50 ? name.substring(0, 50) + '...' : name;
}

// Helper: Extract material from title
function extractMaterial(title) {
  const materials = {
    'chrome vanadium': 'Chrome Vanadium Steel',
    'carbon steel': 'Carbon Steel',
    'stainless steel': 'Stainless Steel',
    'hardened steel': 'Hardened Steel',
    'titanium': 'Titanium Coated',
    'alloy': 'Alloy Steel',
    'brass': 'Brass',
    'copper': 'Copper'
  };

  const titleLower = title.toLowerCase();
  for (const [key, value] of Object.entries(materials)) {
    if (titleLower.includes(key)) {
      return value;
    }
  }
  return null;
}

// Generate tips for A+ content
function generateAPlusTips(productType) {
  const baseTips = [
    'Use high-resolution images (minimum 1000px on longest side)',
    'Include lifestyle images showing product in use',
    'Ensure all text is easy to read on mobile devices',
    'Avoid promotional language like "best" or "#1"',
    'Include your brand logo consistently',
    'Use infographics to highlight key specifications'
  ];

  const typeTips = {
    tool: ['Show the tool being used in a real workshop setting', 'Include close-ups of quality features like materials'],
    set: ['Lay out all items clearly so customers can see what\'s included', 'Show the storage case or organization'],
    consumable: ['Show scale reference for size comparison', 'Include application/installation images'],
    accessory: ['Show compatibility with popular tools', 'Include before/after if applicable']
  };

  return [...baseTips, ...(typeTips[productType] || [])];
}

// Save A+ content draft
function saveAPlusContent(data) {
  const saved = loadJSON('aplus-content.json') || { content: [] };
  const existing = saved.content.findIndex(c => c.sku === data.sku);

  const record = {
    ...data,
    id: data.id || `aplus-${Date.now()}`,
    updatedAt: new Date().toISOString()
  };

  if (existing >= 0) {
    saved.content[existing] = record;
  } else {
    saved.content.unshift(record);
  }

  // Keep only last 100
  saved.content = saved.content.slice(0, 100);
  saveJSON('aplus-content.json', saved);

  return record.id;
}

// Get A+ content for a SKU
function getAPlusContent(sku) {
  const saved = loadJSON('aplus-content.json') || { content: [] };
  return saved.content.find(c => c.sku === sku) || null;
}

// Get all saved A+ content
function getAllAPlusContent() {
  const saved = loadJSON('aplus-content.json') || { content: [] };
  return saved.content;
}

// Delete A+ content
function deleteAPlusContent(id) {
  const saved = loadJSON('aplus-content.json') || { content: [] };
  saved.content = saved.content.filter(c => c.id !== id);
  saveJSON('aplus-content.json', saved);
  return true;
}

// Update A+ content status
function updateAPlusStatus(id, status) {
  const saved = loadJSON('aplus-content.json') || { content: [] };
  const idx = saved.content.findIndex(c => c.id === id);
  if (idx >= 0) {
    saved.content[idx].status = status;
    saved.content[idx].updatedAt = new Date().toISOString();
    saveJSON('aplus-content.json', saved);
    return true;
  }
  return false;
}

// Export module as HTML preview
function generateHTMLPreview(aplusContent) {
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>A+ Content Preview - ${aplusContent.sku}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; max-width: 970px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    .module { background: white; margin-bottom: 20px; padding: 20px; border: 1px solid #ddd; }
    .module-header { background: #232f3e; color: white; padding: 10px; margin: -20px -20px 20px; font-size: 12px; }
    h1 { font-size: 28px; margin-bottom: 10px; }
    h2 { font-size: 22px; margin-bottom: 8px; color: #232f3e; }
    h3 { font-size: 18px; margin-bottom: 6px; }
    p { line-height: 1.6; color: #333; }
    .image-placeholder { background: #e0e0e0; display: flex; align-items: center; justify-content: center; color: #666; font-size: 14px; }
    .three-col { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
    .four-col { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; }
    .comparison-table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    .comparison-table th, .comparison-table td { border: 1px solid #ddd; padding: 10px; text-align: center; }
    .comparison-table th { background: #f0f0f0; }
    .check { color: #00a650; font-weight: bold; }
    .cross { color: #cc0000; }
    .specs-table { width: 100%; }
    .specs-table tr:nth-child(even) { background: #f9f9f9; }
    .specs-table td { padding: 8px; border-bottom: 1px solid #eee; }
    .specs-table td:first-child { font-weight: bold; width: 40%; }
  </style>
</head>
<body>
  <h1 style="text-align: center; margin-bottom: 30px;">A+ Content Preview</h1>
  <p style="text-align: center; margin-bottom: 30px; color: #666;">SKU: ${aplusContent.sku} | Template: ${aplusContent.template}</p>
`;

  for (const module of aplusContent.modules) {
    html += `<div class="module">
      <div class="module-header">${module.typeInfo.name} - ${module.purpose}</div>`;

    switch (module.type) {
      case 'STANDARD_IMAGE_HEADER':
        html += `
          <div class="image-placeholder" style="height: 300px; margin-bottom: 20px;">[Hero Image: ${module.typeInfo.imageDimensions.width}x${module.typeInfo.imageDimensions.height}px]</div>
          <h1>${module.content.headline}</h1>
          <p style="font-size: 18px; color: #666;">${module.content.subheadline}</p>`;
        break;

      case 'STANDARD_HEADER':
        html += `
          <h1>${module.content.headline}</h1>
          <h3>${module.content.subheadline}</h3>
          <p style="margin-top: 15px;">${module.content.bodyText}</p>`;
        break;

      case 'STANDARD_TEXT':
        html += `
          <h2>${module.content.headline}</h2>
          <p style="margin-top: 10px;">${module.content.bodyText}</p>`;
        break;

      case 'STANDARD_SINGLE_IMAGE':
        html += `
          <div style="display: grid; grid-template-columns: 300px 1fr; gap: 20px; align-items: center;">
            <div class="image-placeholder" style="height: 300px;">[Image: ${module.typeInfo.imageDimensions.width}x${module.typeInfo.imageDimensions.height}px]</div>
            <div>
              <h2>${module.content.headline}</h2>
              <p style="margin-top: 10px;">${module.content.bodyText}</p>
            </div>
          </div>`;
        break;

      case 'STANDARD_THREE_IMAGE':
        html += `<div class="three-col">`;
        for (const img of module.content.images) {
          html += `
            <div style="text-align: center;">
              <div class="image-placeholder" style="height: 200px; margin-bottom: 10px;">[Image]</div>
              <p style="font-weight: bold;">${img.caption}</p>
            </div>`;
        }
        html += `</div>`;
        break;

      case 'STANDARD_FOUR_IMAGE':
        html += `<h2 style="text-align: center; margin-bottom: 15px;">${module.content.headline}</h2>
          <div class="four-col">`;
        for (const img of module.content.images) {
          html += `
            <div style="text-align: center;">
              <div class="image-placeholder" style="height: 150px;">[${img.alt}]</div>
            </div>`;
        }
        html += `</div>`;
        break;

      case 'COMPARISON_TABLE':
        html += `<h2>${module.content.headline}</h2>
          <table class="comparison-table">
            <thead>
              <tr>
                <th>Feature</th>`;
        for (const prod of module.content.products) {
          html += `<th>${prod.isYours ? '✓ ' : ''}${prod.name}</th>`;
        }
        html += `</tr></thead><tbody>`;
        for (const feat of module.content.features) {
          html += `<tr><td>${feat.name}</td>
            <td class="${feat.yours ? 'check' : 'cross'}">${feat.yours ? '✓' : '✗'}</td>
            <td class="${feat.alt1 ? 'check' : 'cross'}">${feat.alt1 ? '✓' : '✗'}</td>
            <td class="${feat.alt2 ? 'check' : 'cross'}">${feat.alt2 ? '✓' : '✗'}</td>
          </tr>`;
        }
        html += `</tbody></table>`;
        break;

      case 'TECH_SPECS':
        html += `
          <div style="display: grid; grid-template-columns: 300px 1fr; gap: 20px;">
            <div class="image-placeholder" style="height: 300px;">[Product Image]</div>
            <div>
              <h2>${module.content.headline}</h2>
              <table class="specs-table">`;
        for (const spec of module.content.specs) {
          html += `<tr><td>${spec.label}</td><td>${spec.value}</td></tr>`;
        }
        html += `</table></div></div>`;
        break;
    }

    html += `</div>`;
  }

  html += `
  <div style="margin-top: 30px; padding: 20px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px;">
    <h3 style="color: #856404;">Image Requirements</h3>
    <ul style="margin-top: 10px; padding-left: 20px;">`;

  for (const module of aplusContent.modules) {
    if (module.imageRequirements) {
      html += `<li style="margin-bottom: 5px;">${module.typeInfo.name}: ${module.imageRequirements.count} image(s), ${module.imageRequirements.dimensions.width}x${module.imageRequirements.dimensions.height}px</li>`;
    }
  }

  html += `</ul></div>
</body>
</html>`;

  return html;
}

export {
  MODULE_TYPES,
  APLUS_TEMPLATES,
  generateAPlusContent,
  saveAPlusContent,
  getAPlusContent,
  getAllAPlusContent,
  deleteAPlusContent,
  updateAPlusStatus,
  generateHTMLPreview
};
