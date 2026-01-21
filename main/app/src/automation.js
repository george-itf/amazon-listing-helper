// Automation Rules Engine for Amazon Listings Helper
// Updated to use PostgreSQL repositories

import * as ListingRepository from './repositories/listing.repository.js';
import * as ScoreRepository from './repositories/score.repository.js';
import * as AlertRepository from './repositories/alert.repository.js';
import * as KeepaRepository from './repositories/keepa.repository.js';
import * as SettingsRepository from './repositories/settings.repository.js';

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

/**
 * Evaluate rules against listings and generate alerts
 * @param {Array} listings - Array of listing objects
 * @param {Object} keepaMap - Map of ASIN to Keepa data
 * @param {Object} costsMap - Map of SKU to cost data
 * @param {Array} rules - Array of rule objects
 * @returns {Array} Generated alerts
 */
function evaluateRules(listings, keepaMap, costsMap, rules) {
  const alerts = [];

  for (const listing of listings) {
    const sku = listing.sku;
    if (!sku) continue;

    const score = listing.currentScore;
    const cost = costsMap?.[sku];
    const keepaData = keepaMap?.[listing.asin];
    const price = parseFloat(listing.price) || 0;

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
        } else if (metric === 'score' && score !== undefined && score !== null) {
          value = parseFloat(score);
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
          listingId: listing.id,
          sku: sku,
          type: rule.id,
          severity: rule.action.severity,
          title: rule.name,
          message: message,
          metadata: {
            ruleId: rule.id,
            asin: listing.asin || '',
            listingTitle: listing.title || sku
          }
        });
      }
    }
  }

  return alerts;
}

/**
 * Run automation rules and generate alerts
 * @returns {Promise<Object>} Result with new and total alerts count
 */
async function runAutomation() {
  try {
    // Load data from PostgreSQL
    const listings = await ListingRepository.getAll({ status: 'active' });
    const keepaRecords = await KeepaRepository.getAll();

    // Convert Keepa records to map by ASIN
    const keepaMap = {};
    for (const record of keepaRecords) {
      keepaMap[record.asin] = record;
    }

    // Load costs from settings (or create empty map)
    // Note: Costs could be moved to a separate table in future
    const costsMap = {};

    // Get rules from settings or use defaults
    const rulesSettting = await SettingsRepository.get('automation_rules');
    const rules = rulesSettting?.value ? JSON.parse(rulesSettting.value) : RULE_TEMPLATES;

    // Evaluate rules
    const newAlerts = evaluateRules(listings, keepaMap, costsMap, rules);

    // Get existing alerts from last 24 hours for deduplication
    const existingAlerts = await AlertRepository.getAll({ dismissed: false });
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentAlertKeys = new Set(
      existingAlerts
        .filter(a => a.createdAt && new Date(a.createdAt).getTime() > oneDayAgo)
        .map(a => `${a.type}-${a.sku}`)
    );

    // Filter out duplicates
    const filteredNewAlerts = newAlerts.filter(a => !recentAlertKeys.has(`${a.type}-${a.sku}`));

    // Save new alerts to PostgreSQL
    const savedAlerts = [];
    for (const alert of filteredNewAlerts) {
      try {
        const saved = await AlertRepository.create(alert);
        savedAlerts.push(saved);
      } catch (e) {
        console.error('Error saving alert:', e.message);
      }
    }

    // Get updated total count
    const totalCount = await AlertRepository.getUnreadCount();

    return {
      newAlerts: savedAlerts.length,
      totalAlerts: totalCount,
      alerts: savedAlerts
    };
  } catch (error) {
    console.error('Automation error:', error);
    return {
      newAlerts: 0,
      totalAlerts: 0,
      alerts: [],
      error: error.message
    };
  }
}

/**
 * Get all automation rules
 * @returns {Promise<Array>} Array of rules
 */
async function getRules() {
  const setting = await SettingsRepository.get('automation_rules');
  return setting?.value ? JSON.parse(setting.value) : RULE_TEMPLATES;
}

/**
 * Save automation rules
 * @param {Array} rules - Rules to save
 * @returns {Promise<Object>} Saved setting
 */
async function saveRules(rules) {
  return SettingsRepository.set('automation_rules', JSON.stringify(rules), 'Automation rule configurations');
}

export { RULE_TEMPLATES, evaluateRules, runAutomation, getRules, saveRules };
