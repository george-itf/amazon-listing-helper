// Listing Templates for Amazon Listings Helper
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

function initTemplates() {
  const templates = loadJSON('templates.json');
  if (!templates) {
    saveJSON('templates.json', { templates: [], lastId: 0 });
  }
  return loadJSON('templates.json');
}

function getTemplates() {
  const data = initTemplates();
  return data.templates;
}

function getTemplate(id) {
  const data = initTemplates();
  return data.templates.find(t => t.id === id);
}

// Save a listing as a template
function createTemplateFromListing(sku, templateName, description = '') {
  const listings = loadJSON('listings.json');
  const item = listings?.items?.find(i => i.sku === sku);
  
  if (!item) return { error: 'Listing not found' };
  
  const data = initTemplates();
  const newId = ++data.lastId;
  
  const template = {
    id: newId,
    name: templateName,
    description,
    category: item.category || 'General',
    createdAt: new Date().toISOString(),
    sourcesku: sku,
    sourceasin: item.asin,
    // Template fields
    fields: {
      titleStructure: analyzeTitleStructure(item.title),
      bulletPatterns: item.bullets || [],
      priceRange: { min: item.price * 0.8, max: item.price * 1.2 },
      keyFeatures: extractKeyFeatures(item),
      recommendedKeywords: extractKeywords(item.title)
    }
  };
  
  data.templates.push(template);
  saveJSON('templates.json', data);
  
  return template;
}

function analyzeTitleStructure(title) {
  if (!title) return { pattern: '', length: 0 };
  return {
    pattern: title.replace(/[A-Z][a-z]+/g, '[Brand]')
                  .replace(/\d+(\.\d+)?/g, '[Number]')
                  .substring(0, 100),
    length: title.length,
    hasBrand: /^[A-Z][a-z]+/.test(title),
    hasNumbers: /\d/.test(title)
  };
}

function extractKeyFeatures(item) {
  const features = [];
  if (item.title) {
    // Extract potential features from title
    const parts = item.title.split(/[-–,|]/);
    parts.forEach(p => {
      const trimmed = p.trim();
      if (trimmed.length > 3 && trimmed.length < 50) {
        features.push(trimmed);
      }
    });
  }
  return features.slice(0, 5);
}

function extractKeywords(title) {
  if (!title) return [];
  // Simple keyword extraction
  const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
  return title.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.includes(w))
    .slice(0, 10);
}

function deleteTemplate(id) {
  const data = initTemplates();
  const index = data.templates.findIndex(t => t.id === id);
  if (index === -1) return false;
  data.templates.splice(index, 1);
  saveJSON('templates.json', data);
  return true;
}

// Apply template suggestions to a listing (returns suggestions, doesn't modify)
function applyTemplate(templateId, sku) {
  const template = getTemplate(templateId);
  const listings = loadJSON('listings.json');
  const item = listings?.items?.find(i => i.sku === sku);
  
  if (!template) return { error: 'Template not found' };
  if (!item) return { error: 'Listing not found' };
  
  const suggestions = [];
  
  // Title suggestions
  if (item.title && item.title.length < template.fields.titleStructure.length * 0.7) {
    suggestions.push({
      field: 'title',
      suggestion: `Consider expanding title to ~${template.fields.titleStructure.length} characters`,
      templateValue: template.fields.titleStructure.pattern
    });
  }
  
  // Keyword suggestions
  const missingKeywords = template.fields.recommendedKeywords.filter(kw => 
    !item.title?.toLowerCase().includes(kw)
  );
  if (missingKeywords.length > 0) {
    suggestions.push({
      field: 'keywords',
      suggestion: `Consider adding keywords: ${missingKeywords.join(', ')}`,
      templateValue: missingKeywords
    });
  }
  
  return {
    template: template.name,
    targetSku: sku,
    suggestions
  };
}

export { getTemplates, getTemplate, createTemplateFromListing, deleteTemplate, applyTemplate };
