// Automation Rules Engine for Amazon Listings Helper
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '..', 'data');

// Rule templates
const RULE_TEMPLATES = [
  {
    id: 'low_margin',
    name: 'Low Margin Alert',
    description: 'Alert when profit margin falls below threshold',
    trigger: { type: 'threshold', metric: 'margin', operator: 'lt', value: 10 },
    action: { type: 'alert', severity: 'high' }
  },
  {
    id: 'negative_profit',
    name: 'Unprofitable Listing',
    description: 'Alert when listing is losing money',
    trigger: { type: 'threshold', metric: 'profit', operator: 'lt', value: 0 },
    action: { type: 'alert', severity: 'critical' }
  },
  {
    id: 'overpriced',
    name: 'Above Buy Box',
    description: 'Alert when price is above competitive price',
    trigger: { type: 'competitive', event: 'above_buybox', threshold: 5 },
    action: { type: 'alert', severity: 'medium' }
  },
  {
    id: 'low_score',
    name: 'Low Listing Score',
    description: 'Alert when listing quality score is low',
    trigger: { type: 'threshold', metric: 'score', operator: 'lt', value: 60 },
    action: { type: 'alert', severity: 'medium' }
  }
];

function loadJSON(filename) {
  try {
    const filepath = path.join(DATA_DIR, filename);
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveJSON(filename, data) {
  const filepath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

function evaluateRules(listings, keepa, costs, scores, rules) {
  const alerts = [];
  
  // Handle listings.items array format
  const listingItems = listings?.items || [];
  
  for (const listing of listingItems) {
    const sku = listing.sku;
    if (!sku) continue;
    
    const score = scores?.[sku]?.totalScore;
    const cost = costs?.[sku];
    const keepaData = keepa?.[sku];
    const price = listing.price || 0;
    
    // Calculate margin if we have cost data
    let margin = null;
    let profit = null;
    if (cost?.productCost && price > 0) {
      const totalCost = (cost.productCost || 0) + (cost.shippingCost || 0) + (cost.fbaFee || 0);
      profit = price - totalCost;
      margin = (profit / price) * 100;
    }
    
    for (const rule of rules) {
      let triggered = false;
      let message = '';
      
      if (rule.trigger.type === 'threshold') {
        const metric = rule.trigger.metric;
        let value = null;
        
        if (metric === 'margin' && margin !== null) {
          value = margin;
        } else if (metric === 'profit' && profit !== null) {
          value = profit;
        } else if (metric === 'score' && score !== undefined) {
          value = score;
        }
        
        if (value !== null) {
          if (rule.trigger.operator === 'lt' && value < rule.trigger.value) {
            triggered = true;
            message = `${metric} is ${value.toFixed(1)} (below ${rule.trigger.value})`;
          } else if (rule.trigger.operator === 'gt' && value > rule.trigger.value) {
            triggered = true;
            message = `${metric} is ${value.toFixed(1)} (above ${rule.trigger.value})`;
          }
        }
      } else if (rule.trigger.type === 'competitive' && keepaData) {
        const buyBox = keepaData.buyBoxPrice;
        if (buyBox && price > buyBox * (1 + rule.trigger.threshold / 100)) {
          triggered = true;
          message = `Price £${price} is ${((price/buyBox - 1) * 100).toFixed(1)}% above buy box £${buyBox}`;
        }
      }
      
      if (triggered) {
        alerts.push({
          id: `${rule.id}-${sku}-${Date.now()}`,
          ruleId: rule.id,
          ruleName: rule.name,
          sku: sku,
          asin: listing.asin || '',
          title: listing.title || listing.name || sku,
          message: message,
          severity: rule.action.severity,
          timestamp: new Date().toISOString(),
          read: false
        });
      }
    }
  }
  
  return alerts;
}

async function runAutomation() {
  const listings = loadJSON('listings.json');
  const keepa = loadJSON('keepa.json');
  const costs = loadJSON('costs.json') || {};
  const scores = loadJSON('scores.json') || {};
  const existingAlerts = loadJSON('alerts.json') || [];
  
  // Use default rules (or load custom rules if they exist)
  const rules = loadJSON('rules.json') || RULE_TEMPLATES;
  
  // Evaluate rules
  const newAlerts = evaluateRules(listings, keepa, costs, scores, rules);
  
  // Deduplicate - don't add alert if same rule+sku alerted in last 24h
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentAlertKeys = new Set(
    existingAlerts
      .filter(a => a.timestamp && new Date(a.timestamp).getTime() > oneDayAgo)
      .map(a => `${a.ruleId}-${a.sku}`)
  );
  
  const filteredNewAlerts = newAlerts.filter(a => !recentAlertKeys.has(`${a.ruleId}-${a.sku}`));
  
  // Merge and save
  const allAlerts = [...filteredNewAlerts, ...existingAlerts.filter(a => a.id)].slice(0, 500);
  saveJSON('alerts.json', allAlerts);
  
  return {
    newAlerts: filteredNewAlerts.length,
    totalAlerts: allAlerts.length,
    alerts: filteredNewAlerts
  };
}

export { RULE_TEMPLATES, evaluateRules, runAutomation, loadJSON, saveJSON };
