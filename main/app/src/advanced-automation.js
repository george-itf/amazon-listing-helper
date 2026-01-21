// Advanced Automation Module
// Phase 7: Advanced Features - Complex Triggers, Actions, Webhooks

import { readFileSync, writeFileSync, existsSync } from 'fs';

const DATA_DIR = process.env.DATA_DIR || '/opt/alh/data';
const ADVANCED_RULES_FILE = `${DATA_DIR}/advanced-rules.json`;
const WEBHOOKS_FILE = `${DATA_DIR}/webhooks.json`;
const SCHEDULED_FILE = `${DATA_DIR}/scheduled-tasks.json`;
const EXECUTION_LOG_FILE = `${DATA_DIR}/automation-log.json`;

// Initialize data files
function initDataFiles() {
  if (!existsSync(ADVANCED_RULES_FILE)) {
    writeFileSync(ADVANCED_RULES_FILE, JSON.stringify({ rules: [] }, null, 2));
  }
  if (!existsSync(WEBHOOKS_FILE)) {
    writeFileSync(WEBHOOKS_FILE, JSON.stringify({ webhooks: [] }, null, 2));
  }
  if (!existsSync(SCHEDULED_FILE)) {
    writeFileSync(SCHEDULED_FILE, JSON.stringify({ scheduled: [] }, null, 2));
  }
  if (!existsSync(EXECUTION_LOG_FILE)) {
    writeFileSync(EXECUTION_LOG_FILE, JSON.stringify({ logs: [] }, null, 2));
  }
}

// ============ TRIGGER TYPES ============

export const TRIGGER_TYPES = {
  threshold: {
    id: 'threshold',
    name: 'Threshold',
    description: 'Triggers when a value crosses a threshold',
    fields: ['metric', 'operator', 'value'],
    metrics: ['score', 'price', 'margin', 'bsr', 'stock', 'reviews']
  },
  competitive: {
    id: 'competitive',
    name: 'Competitive Event',
    description: 'Triggers on competitor activity',
    fields: ['event'],
    events: ['price_drop', 'price_increase', 'new_competitor', 'buybox_lost', 'bsr_change']
  },
  time_based: {
    id: 'time_based',
    name: 'Time-Based',
    description: 'Triggers at scheduled times',
    fields: ['schedule', 'timezone'],
    schedules: ['daily', 'weekly', 'monthly', 'custom']
  },
  event: {
    id: 'event',
    name: 'System Event',
    description: 'Triggers on system events',
    fields: ['eventType'],
    eventTypes: ['sync_complete', 'score_change', 'alert_created', 'task_completed']
  },
  compound: {
    id: 'compound',
    name: 'Compound',
    description: 'Multiple conditions combined',
    fields: ['conditions', 'logic'],
    logic: ['AND', 'OR']
  }
};

// ============ ACTION TYPES ============

export const ACTION_TYPES = {
  create_alert: {
    id: 'create_alert',
    name: 'Create Alert',
    description: 'Create a new alert',
    fields: ['severity', 'message']
  },
  create_task: {
    id: 'create_task',
    name: 'Create Task',
    description: 'Create a Kanban task',
    fields: ['title', 'description', 'priority', 'stage']
  },
  update_price: {
    id: 'update_price',
    name: 'Update Price',
    description: 'Queue a price change',
    fields: ['priceAction', 'value'],
    priceActions: ['set', 'increase_percent', 'decrease_percent', 'match_buybox', 'undercut_buybox']
  },
  apply_template: {
    id: 'apply_template',
    name: 'Apply Template',
    description: 'Apply a listing template',
    fields: ['templateId']
  },
  send_webhook: {
    id: 'send_webhook',
    name: 'Send Webhook',
    description: 'Send data to external URL',
    fields: ['webhookId']
  },
  send_email: {
    id: 'send_email',
    name: 'Send Email',
    description: 'Send email notification',
    fields: ['recipient', 'subject', 'template']
  },
  tag_listing: {
    id: 'tag_listing',
    name: 'Tag Listing',
    description: 'Add a tag to the listing',
    fields: ['tag']
  },
  chain_actions: {
    id: 'chain_actions',
    name: 'Chain Actions',
    description: 'Execute multiple actions in sequence',
    fields: ['actions', 'stopOnError']
  }
};

// ============ ADVANCED RULES ============

export function getAdvancedRules() {
  initDataFiles();
  const data = JSON.parse(readFileSync(ADVANCED_RULES_FILE, 'utf8'));
  return data.rules || [];
}

export function getAdvancedRule(ruleId) {
  const rules = getAdvancedRules();
  return rules.find(r => r.id === ruleId);
}

export function createAdvancedRule(ruleData) {
  initDataFiles();
  const data = JSON.parse(readFileSync(ADVANCED_RULES_FILE, 'utf8'));
  const rules = data.rules || [];

  const newRule = {
    id: `ADV-${Date.now()}`,
    name: ruleData.name,
    description: ruleData.description || '',
    enabled: ruleData.enabled !== false,
    trigger: {
      type: ruleData.trigger.type,
      config: ruleData.trigger.config || {}
    },
    conditions: ruleData.conditions || [],
    actions: ruleData.actions || [],
    cooldownMinutes: ruleData.cooldownMinutes || 60,
    lastTriggered: null,
    triggerCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  rules.push(newRule);
  writeFileSync(ADVANCED_RULES_FILE, JSON.stringify({ rules }, null, 2));
  return newRule;
}

export function updateAdvancedRule(ruleId, updates) {
  initDataFiles();
  const data = JSON.parse(readFileSync(ADVANCED_RULES_FILE, 'utf8'));
  const rules = data.rules || [];

  const index = rules.findIndex(r => r.id === ruleId);
  if (index === -1) return null;

  rules[index] = {
    ...rules[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  writeFileSync(ADVANCED_RULES_FILE, JSON.stringify({ rules }, null, 2));
  return rules[index];
}

export function deleteAdvancedRule(ruleId) {
  initDataFiles();
  const data = JSON.parse(readFileSync(ADVANCED_RULES_FILE, 'utf8'));
  let rules = data.rules || [];

  const index = rules.findIndex(r => r.id === ruleId);
  if (index === -1) return false;

  rules.splice(index, 1);
  writeFileSync(ADVANCED_RULES_FILE, JSON.stringify({ rules }, null, 2));
  return true;
}

// ============ WEBHOOKS ============

export function getWebhooks() {
  initDataFiles();
  const data = JSON.parse(readFileSync(WEBHOOKS_FILE, 'utf8'));
  return data.webhooks || [];
}

export function getWebhook(webhookId) {
  const webhooks = getWebhooks();
  return webhooks.find(w => w.id === webhookId);
}

export function createWebhook(webhookData) {
  initDataFiles();
  const data = JSON.parse(readFileSync(WEBHOOKS_FILE, 'utf8'));
  const webhooks = data.webhooks || [];

  const newWebhook = {
    id: `WH-${Date.now()}`,
    name: webhookData.name,
    url: webhookData.url,
    method: webhookData.method || 'POST',
    headers: webhookData.headers || { 'Content-Type': 'application/json' },
    authType: webhookData.authType || 'none', // none, bearer, basic, api_key
    authValue: webhookData.authValue || '',
    payloadTemplate: webhookData.payloadTemplate || '{{data}}',
    enabled: webhookData.enabled !== false,
    retryCount: webhookData.retryCount || 3,
    timeoutMs: webhookData.timeoutMs || 10000,
    lastCalled: null,
    successCount: 0,
    failureCount: 0,
    createdAt: new Date().toISOString()
  };

  webhooks.push(newWebhook);
  writeFileSync(WEBHOOKS_FILE, JSON.stringify({ webhooks }, null, 2));
  return newWebhook;
}

export function updateWebhook(webhookId, updates) {
  initDataFiles();
  const data = JSON.parse(readFileSync(WEBHOOKS_FILE, 'utf8'));
  const webhooks = data.webhooks || [];

  const index = webhooks.findIndex(w => w.id === webhookId);
  if (index === -1) return null;

  webhooks[index] = { ...webhooks[index], ...updates };
  writeFileSync(WEBHOOKS_FILE, JSON.stringify({ webhooks }, null, 2));
  return webhooks[index];
}

export function deleteWebhook(webhookId) {
  initDataFiles();
  const data = JSON.parse(readFileSync(WEBHOOKS_FILE, 'utf8'));
  let webhooks = data.webhooks || [];

  const index = webhooks.findIndex(w => w.id === webhookId);
  if (index === -1) return false;

  webhooks.splice(index, 1);
  writeFileSync(WEBHOOKS_FILE, JSON.stringify({ webhooks }, null, 2));
  return true;
}

export async function executeWebhook(webhookId, payload) {
  const webhook = getWebhook(webhookId);
  if (!webhook || !webhook.enabled) {
    return { success: false, error: 'Webhook not found or disabled' };
  }

  const headers = { ...webhook.headers };

  // Add auth header
  if (webhook.authType === 'bearer' && webhook.authValue) {
    headers['Authorization'] = `Bearer ${webhook.authValue}`;
  } else if (webhook.authType === 'basic' && webhook.authValue) {
    headers['Authorization'] = `Basic ${Buffer.from(webhook.authValue).toString('base64')}`;
  } else if (webhook.authType === 'api_key' && webhook.authValue) {
    headers['X-API-Key'] = webhook.authValue;
  }

  // Process payload template
  let body = webhook.payloadTemplate;
  if (body === '{{data}}') {
    body = JSON.stringify(payload);
  } else {
    // Simple template replacement
    body = body.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return payload[key] !== undefined ? JSON.stringify(payload[key]) : match;
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), webhook.timeoutMs);

    const response = await fetch(webhook.url, {
      method: webhook.method,
      headers,
      body: webhook.method !== 'GET' ? body : undefined,
      signal: controller.signal
    });

    clearTimeout(timeout);

    const result = {
      success: response.ok,
      status: response.status,
      statusText: response.statusText
    };

    // Update webhook stats
    updateWebhook(webhookId, {
      lastCalled: new Date().toISOString(),
      successCount: webhook.successCount + (response.ok ? 1 : 0),
      failureCount: webhook.failureCount + (response.ok ? 0 : 1)
    });

    logExecution('webhook', webhookId, result);
    return result;

  } catch (error) {
    const result = { success: false, error: error.message };

    updateWebhook(webhookId, {
      lastCalled: new Date().toISOString(),
      failureCount: webhook.failureCount + 1
    });

    logExecution('webhook', webhookId, result);
    return result;
  }
}

export async function testWebhook(webhookId) {
  return executeWebhook(webhookId, {
    test: true,
    timestamp: new Date().toISOString(),
    message: 'Test webhook from Amazon Listing Helper'
  });
}

// ============ SCHEDULED TASKS ============

export function getScheduledTasks() {
  initDataFiles();
  const data = JSON.parse(readFileSync(SCHEDULED_FILE, 'utf8'));
  return data.scheduled || [];
}

export function createScheduledTask(taskData) {
  initDataFiles();
  const data = JSON.parse(readFileSync(SCHEDULED_FILE, 'utf8'));
  const scheduled = data.scheduled || [];

  const newTask = {
    id: `SCHED-${Date.now()}`,
    name: taskData.name,
    description: taskData.description || '',
    schedule: {
      type: taskData.schedule.type, // daily, weekly, monthly, cron
      time: taskData.schedule.time, // HH:MM
      dayOfWeek: taskData.schedule.dayOfWeek, // 0-6 for weekly
      dayOfMonth: taskData.schedule.dayOfMonth, // 1-31 for monthly
      cron: taskData.schedule.cron, // cron expression for custom
      timezone: taskData.schedule.timezone || 'Europe/London'
    },
    action: taskData.action, // { type, config }
    enabled: taskData.enabled !== false,
    lastRun: null,
    nextRun: calculateNextRun(taskData.schedule),
    runCount: 0,
    createdAt: new Date().toISOString()
  };

  scheduled.push(newTask);
  writeFileSync(SCHEDULED_FILE, JSON.stringify({ scheduled }, null, 2));
  return newTask;
}

export function updateScheduledTask(taskId, updates) {
  initDataFiles();
  const data = JSON.parse(readFileSync(SCHEDULED_FILE, 'utf8'));
  const scheduled = data.scheduled || [];

  const index = scheduled.findIndex(t => t.id === taskId);
  if (index === -1) return null;

  if (updates.schedule) {
    updates.nextRun = calculateNextRun(updates.schedule);
  }

  scheduled[index] = { ...scheduled[index], ...updates };
  writeFileSync(SCHEDULED_FILE, JSON.stringify({ scheduled }, null, 2));
  return scheduled[index];
}

export function deleteScheduledTask(taskId) {
  initDataFiles();
  const data = JSON.parse(readFileSync(SCHEDULED_FILE, 'utf8'));
  let scheduled = data.scheduled || [];

  const index = scheduled.findIndex(t => t.id === taskId);
  if (index === -1) return false;

  scheduled.splice(index, 1);
  writeFileSync(SCHEDULED_FILE, JSON.stringify({ scheduled }, null, 2));
  return true;
}

function calculateNextRun(schedule) {
  const now = new Date();
  const [hours, minutes] = (schedule.time || '09:00').split(':').map(Number);

  let next = new Date(now);
  next.setHours(hours, minutes, 0, 0);

  if (schedule.type === 'daily') {
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
  } else if (schedule.type === 'weekly') {
    const targetDay = schedule.dayOfWeek || 1; // Monday default
    const currentDay = now.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil < 0 || (daysUntil === 0 && next <= now)) {
      daysUntil += 7;
    }
    next.setDate(now.getDate() + daysUntil);
  } else if (schedule.type === 'monthly') {
    const targetDate = schedule.dayOfMonth || 1;
    next.setDate(targetDate);
    if (next <= now) {
      next.setMonth(next.getMonth() + 1);
    }
  }

  return next.toISOString();
}

export function getDueScheduledTasks() {
  const tasks = getScheduledTasks();
  const now = new Date();

  return tasks.filter(t => t.enabled && new Date(t.nextRun) <= now);
}

export function markScheduledTaskRun(taskId) {
  const task = getScheduledTasks().find(t => t.id === taskId);
  if (!task) return null;

  return updateScheduledTask(taskId, {
    lastRun: new Date().toISOString(),
    nextRun: calculateNextRun(task.schedule),
    runCount: task.runCount + 1
  });
}

// ============ EXECUTION ENGINE ============

export async function evaluateRule(rule, context) {
  if (!rule.enabled) return { triggered: false, reason: 'Rule disabled' };

  // Check cooldown
  if (rule.lastTriggered) {
    const lastTrigger = new Date(rule.lastTriggered);
    const cooldownMs = (rule.cooldownMinutes || 60) * 60 * 1000;
    if (Date.now() - lastTrigger.getTime() < cooldownMs) {
      return { triggered: false, reason: 'In cooldown period' };
    }
  }

  // Evaluate trigger
  const triggerResult = evaluateTrigger(rule.trigger, context);
  if (!triggerResult.matched) {
    return { triggered: false, reason: triggerResult.reason || 'Trigger not matched' };
  }

  // Evaluate additional conditions
  if (rule.conditions && rule.conditions.length > 0) {
    const conditionsResult = evaluateConditions(rule.conditions, context);
    if (!conditionsResult.matched) {
      return { triggered: false, reason: 'Conditions not met' };
    }
  }

  return { triggered: true, context: triggerResult.context };
}

function evaluateTrigger(trigger, context) {
  switch (trigger.type) {
    case 'threshold':
      return evaluateThresholdTrigger(trigger.config, context);
    case 'competitive':
      return evaluateCompetitiveTrigger(trigger.config, context);
    case 'event':
      return evaluateEventTrigger(trigger.config, context);
    case 'compound':
      return evaluateCompoundTrigger(trigger.config, context);
    default:
      return { matched: false, reason: 'Unknown trigger type' };
  }
}

function evaluateThresholdTrigger(config, context) {
  const { metric, operator, value } = config;
  const actualValue = getMetricValue(metric, context);

  if (actualValue === null) {
    return { matched: false, reason: `Metric ${metric} not available` };
  }

  let matched = false;
  switch (operator) {
    case 'gt': matched = actualValue > value; break;
    case 'gte': matched = actualValue >= value; break;
    case 'lt': matched = actualValue < value; break;
    case 'lte': matched = actualValue <= value; break;
    case 'eq': matched = actualValue === value; break;
    case 'neq': matched = actualValue !== value; break;
  }

  return { matched, context: { metric, actualValue, operator, threshold: value } };
}

function evaluateCompetitiveTrigger(config, context) {
  const { event } = config;
  const competitiveEvents = context.competitiveEvents || [];

  const matched = competitiveEvents.some(e => e.type === event);
  return { matched, context: { event, matchedEvents: competitiveEvents.filter(e => e.type === event) } };
}

function evaluateEventTrigger(config, context) {
  const { eventType } = config;
  const systemEvents = context.systemEvents || [];

  const matched = systemEvents.some(e => e.type === eventType);
  return { matched, context: { eventType, matchedEvents: systemEvents.filter(e => e.type === eventType) } };
}

function evaluateCompoundTrigger(config, context) {
  const { conditions, logic } = config;

  const results = conditions.map(c => evaluateTrigger(c, context));

  let matched;
  if (logic === 'AND') {
    matched = results.every(r => r.matched);
  } else {
    matched = results.some(r => r.matched);
  }

  return { matched, context: { logic, results } };
}

function evaluateConditions(conditions, context) {
  // All conditions must be met (AND logic)
  for (const condition of conditions) {
    const result = evaluateTrigger({ type: 'threshold', config: condition }, context);
    if (!result.matched) {
      return { matched: false, reason: `Condition failed: ${condition.metric}` };
    }
  }
  return { matched: true };
}

function getMetricValue(metric, context) {
  switch (metric) {
    case 'score': return context.listing?.score || context.score;
    case 'price': return context.listing?.price || context.price;
    case 'margin': return context.margin;
    case 'bsr': return context.bsr || context.listing?.bsr;
    case 'stock': return context.stock || context.listing?.quantity;
    case 'reviews': return context.reviews || context.listing?.reviewCount;
    default: return null;
  }
}

export async function executeActions(actions, context) {
  const results = [];

  for (const action of actions) {
    try {
      const result = await executeAction(action, context);
      results.push({ action: action.type, success: true, result });
    } catch (error) {
      results.push({ action: action.type, success: false, error: error.message });
      if (action.stopOnError) break;
    }
  }

  return results;
}

async function executeAction(action, context) {
  switch (action.type) {
    case 'create_alert':
      return createAlertAction(action.config, context);
    case 'create_task':
      return createTaskAction(action.config, context);
    case 'send_webhook':
      return await executeWebhook(action.config.webhookId, { ...context, action });
    case 'tag_listing':
      return tagListingAction(action.config, context);
    case 'update_price':
      return queuePriceAction(action.config, context);
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

function createAlertAction(config, context) {
  const alertsFile = `${DATA_DIR}/alerts.json`;
  let alerts = [];
  if (existsSync(alertsFile)) {
    alerts = JSON.parse(readFileSync(alertsFile, 'utf8')) || [];
  }

  const alert = {
    id: `ALT-${Date.now()}`,
    type: 'automation',
    severity: config.severity || 'medium',
    message: config.message.replace(/\{\{(\w+)\}\}/g, (m, k) => context[k] || m),
    sku: context.sku,
    timestamp: new Date().toISOString(),
    read: false,
    source: 'advanced_automation'
  };

  alerts.unshift(alert);
  writeFileSync(alertsFile, JSON.stringify(alerts.slice(0, 500), null, 2));
  return alert;
}

function createTaskAction(config, context) {
  const tasksFile = `${DATA_DIR}/tasks.json`;
  let data = { tasks: [], nextId: 1 };
  if (existsSync(tasksFile)) {
    data = JSON.parse(readFileSync(tasksFile, 'utf8'));
  }

  const task = {
    id: data.nextId++,
    title: config.title.replace(/\{\{(\w+)\}\}/g, (m, k) => context[k] || m),
    description: config.description || '',
    sku: context.sku,
    type: 'automation',
    priority: config.priority || 'medium',
    stage: config.stage || 'backlog',
    createdAt: new Date().toISOString(),
    source: 'advanced_automation'
  };

  data.tasks.push(task);
  writeFileSync(tasksFile, JSON.stringify(data, null, 2));
  return task;
}

function tagListingAction(config, context) {
  // Would integrate with listings module
  return { tagged: context.sku, tag: config.tag };
}

function queuePriceAction(config, context) {
  // Would integrate with amazon-push module
  return { queued: context.sku, action: config.priceAction, value: config.value };
}

// ============ EXECUTION LOG ============

function logExecution(type, id, result) {
  initDataFiles();
  const data = JSON.parse(readFileSync(EXECUTION_LOG_FILE, 'utf8'));
  const logs = data.logs || [];

  logs.unshift({
    timestamp: new Date().toISOString(),
    type,
    id,
    result
  });

  // Keep last 1000 logs
  writeFileSync(EXECUTION_LOG_FILE, JSON.stringify({ logs: logs.slice(0, 1000) }, null, 2));
}

export function getExecutionLogs(limit = 100) {
  initDataFiles();
  const data = JSON.parse(readFileSync(EXECUTION_LOG_FILE, 'utf8'));
  return (data.logs || []).slice(0, limit);
}

export default {
  TRIGGER_TYPES,
  ACTION_TYPES,
  getAdvancedRules,
  getAdvancedRule,
  createAdvancedRule,
  updateAdvancedRule,
  deleteAdvancedRule,
  getWebhooks,
  getWebhook,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  executeWebhook,
  testWebhook,
  getScheduledTasks,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  getDueScheduledTasks,
  markScheduledTaskRun,
  evaluateRule,
  executeActions,
  getExecutionLogs
};
