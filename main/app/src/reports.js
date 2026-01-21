// Reporting System Module
// Phase 7: Advanced Features - PDF/Excel Reports, Scheduling

import { readFileSync, writeFileSync, existsSync } from 'fs';

const DATA_DIR = process.env.DATA_DIR || '/opt/alh/data';
const REPORTS_FILE = `${DATA_DIR}/reports.json`;
const SCHEDULED_REPORTS_FILE = `${DATA_DIR}/scheduled-reports.json`;

// Initialize data files
function initDataFiles() {
  if (!existsSync(REPORTS_FILE)) {
    writeFileSync(REPORTS_FILE, JSON.stringify({ reports: [] }, null, 2));
  }
  if (!existsSync(SCHEDULED_REPORTS_FILE)) {
    writeFileSync(SCHEDULED_REPORTS_FILE, JSON.stringify({ scheduled: [] }, null, 2));
  }
}

// ============ REPORT TEMPLATES ============

export const REPORT_TEMPLATES = {
  portfolio_overview: {
    id: 'portfolio_overview',
    name: 'Portfolio Overview',
    description: 'Complete overview of all listings with scores and pricing',
    sections: ['summary', 'score_distribution', 'listings_table', 'top_performers', 'needs_attention'],
    formats: ['csv', 'json', 'html']
  },
  profit_analysis: {
    id: 'profit_analysis',
    name: 'Profit Analysis',
    description: 'Detailed profit and margin analysis',
    sections: ['summary', 'profit_by_listing', 'margin_distribution', 'cost_breakdown'],
    formats: ['csv', 'json', 'html']
  },
  competitive_report: {
    id: 'competitive_report',
    name: 'Competitive Intelligence',
    description: 'Competitor analysis and market positioning',
    sections: ['summary', 'buybox_analysis', 'price_comparison', 'bsr_trends'],
    formats: ['csv', 'json', 'html']
  },
  score_report: {
    id: 'score_report',
    name: 'Listing Score Report',
    description: 'Detailed scoring breakdown with recommendations',
    sections: ['summary', 'score_breakdown', 'recommendations', 'improvement_plan'],
    formats: ['csv', 'json', 'html']
  },
  alerts_report: {
    id: 'alerts_report',
    name: 'Alerts Summary',
    description: 'All alerts and actions taken',
    sections: ['summary', 'alerts_by_severity', 'alerts_by_type', 'alerts_timeline'],
    formats: ['csv', 'json', 'html']
  },
  tasks_report: {
    id: 'tasks_report',
    name: 'Tasks Report',
    description: 'Kanban task status and progress',
    sections: ['summary', 'tasks_by_stage', 'tasks_by_type', 'completed_tasks'],
    formats: ['csv', 'json', 'html']
  },
  forecast_report: {
    id: 'forecast_report',
    name: 'Sales Forecast',
    description: 'Demand forecasting and restock recommendations',
    sections: ['summary', 'forecast_by_sku', 'restock_needed', 'trends'],
    formats: ['csv', 'json', 'html']
  },
  opportunities_report: {
    id: 'opportunities_report',
    name: 'Opportunities Report',
    description: 'Improvement opportunities and quick wins',
    sections: ['summary', 'quick_wins', 'high_priority', 'bundle_opportunities'],
    formats: ['csv', 'json', 'html']
  }
};

// ============ DATA LOADERS ============

function loadListings() {
  try {
    const f = `${DATA_DIR}/listings.json`;
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {}
  return { items: [] };
}

function loadScores() {
  try {
    const f = `${DATA_DIR}/scores.json`;
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {}
  return {};
}

function loadCosts() {
  try {
    const f = `${DATA_DIR}/costs.json`;
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {}
  return {};
}

function loadKeepa() {
  try {
    const f = `${DATA_DIR}/keepa.json`;
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')).data || {};
  } catch (e) {}
  return {};
}

function loadAlerts() {
  try {
    const f = `${DATA_DIR}/alerts.json`;
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {}
  return [];
}

function loadTasks() {
  try {
    const f = `${DATA_DIR}/tasks.json`;
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')).tasks || [];
  } catch (e) {}
  return [];
}

// ============ REPORT GENERATORS ============

export function generateReport(templateId, options = {}) {
  const template = REPORT_TEMPLATES[templateId];
  if (!template) {
    return { error: 'Unknown report template' };
  }

  const format = options.format || 'json';
  const filters = options.filters || {};

  // Load all data
  const listings = loadListings();
  const scores = loadScores();
  const costs = loadCosts();
  const keepa = loadKeepa();
  const alerts = loadAlerts();
  const tasks = loadTasks();

  const context = { listings, scores, costs, keepa, alerts, tasks, filters };

  let reportData;
  switch (templateId) {
    case 'portfolio_overview':
      reportData = generatePortfolioOverview(context);
      break;
    case 'profit_analysis':
      reportData = generateProfitAnalysis(context);
      break;
    case 'competitive_report':
      reportData = generateCompetitiveReport(context);
      break;
    case 'score_report':
      reportData = generateScoreReport(context);
      break;
    case 'alerts_report':
      reportData = generateAlertsReport(context);
      break;
    case 'tasks_report':
      reportData = generateTasksReport(context);
      break;
    case 'opportunities_report':
      reportData = generateOpportunitiesReport(context);
      break;
    default:
      return { error: 'Report generator not implemented' };
  }

  // Format output
  const report = {
    id: `RPT-${Date.now()}`,
    template: templateId,
    name: template.name,
    generatedAt: new Date().toISOString(),
    format,
    data: reportData
  };

  // Save report
  saveReport(report);

  // Return in requested format
  if (format === 'csv') {
    return { ...report, content: convertToCSV(reportData) };
  } else if (format === 'html') {
    return { ...report, content: convertToHTML(report) };
  }

  return report;
}

function generatePortfolioOverview(context) {
  const { listings, scores, costs, keepa } = context;
  const items = listings.items || [];
  const scoreValues = Object.values(scores);

  // Summary
  const summary = {
    totalListings: items.length,
    activeListings: items.filter(l => l.status === 'Active').length,
    avgScore: scoreValues.length > 0
      ? Math.round(scoreValues.reduce((sum, s) => sum + s.totalScore, 0) / scoreValues.length)
      : 0,
    excellent: scoreValues.filter(s => s.totalScore >= 80).length,
    good: scoreValues.filter(s => s.totalScore >= 60 && s.totalScore < 80).length,
    needsWork: scoreValues.filter(s => s.totalScore < 60).length,
    lastSync: listings.lastSync
  };

  // Listings table
  const listingsTable = items.map(l => {
    const score = scores[l.sku];
    const k = keepa[l.asin] || {};
    const cost = costs[l.sku] || {};

    return {
      sku: l.sku,
      asin: l.asin,
      title: l.title,
      price: l.price,
      score: score?.totalScore || 0,
      status: l.status,
      buyBox: k.buyBoxPrice,
      bsr: k.salesRank,
      reviews: k.reviewCount
    };
  });

  // Top performers
  const topPerformers = listingsTable
    .filter(l => l.score >= 80)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  // Needs attention
  const needsAttention = listingsTable
    .filter(l => l.score > 0 && l.score < 60)
    .sort((a, b) => a.score - b.score)
    .slice(0, 10);

  return {
    summary,
    scoreDistribution: {
      excellent: summary.excellent,
      good: summary.good,
      needsWork: summary.needsWork
    },
    listingsTable,
    topPerformers,
    needsAttention
  };
}

function generateProfitAnalysis(context) {
  const { listings, costs, keepa } = context;
  const items = listings.items || [];

  const profitData = items.map(l => {
    const cost = costs[l.sku] || {};
    const k = keepa[l.asin] || {};

    const productCost = cost.productCost || 0;
    const shippingCost = cost.shippingCost || 0;
    const packagingCost = cost.packagingCost || 0;
    const totalCost = productCost + shippingCost + packagingCost;

    const price = l.price || 0;
    const fees = price * 0.15 + 0.25;
    const profit = price - totalCost - fees;
    const margin = price > 0 ? (profit / price) * 100 : 0;

    return {
      sku: l.sku,
      title: l.title,
      price,
      productCost,
      shippingCost,
      packagingCost,
      totalCost,
      fees: Math.round(fees * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      margin: Math.round(margin * 10) / 10,
      hasCostData: totalCost > 0
    };
  });

  const withCosts = profitData.filter(p => p.hasCostData);
  const profitable = withCosts.filter(p => p.profit > 0);
  const unprofitable = withCosts.filter(p => p.profit <= 0);

  const summary = {
    totalListings: items.length,
    withCostData: withCosts.length,
    profitable: profitable.length,
    unprofitable: unprofitable.length,
    totalProfit: Math.round(profitable.reduce((sum, p) => sum + p.profit, 0) * 100) / 100,
    totalLoss: Math.round(unprofitable.reduce((sum, p) => sum + Math.abs(p.profit), 0) * 100) / 100,
    avgMargin: withCosts.length > 0
      ? Math.round(withCosts.reduce((sum, p) => sum + p.margin, 0) / withCosts.length * 10) / 10
      : 0
  };

  // Margin distribution
  const marginDistribution = {
    negative: withCosts.filter(p => p.margin < 0).length,
    low: withCosts.filter(p => p.margin >= 0 && p.margin < 10).length,
    medium: withCosts.filter(p => p.margin >= 10 && p.margin < 20).length,
    good: withCosts.filter(p => p.margin >= 20 && p.margin < 30).length,
    excellent: withCosts.filter(p => p.margin >= 30).length
  };

  return {
    summary,
    marginDistribution,
    profitByListing: profitData.sort((a, b) => b.profit - a.profit),
    mostProfitable: profitData.filter(p => p.hasCostData).sort((a, b) => b.profit - a.profit).slice(0, 10),
    leastProfitable: profitData.filter(p => p.hasCostData).sort((a, b) => a.profit - b.profit).slice(0, 10)
  };
}

function generateCompetitiveReport(context) {
  const { listings, keepa } = context;
  const items = listings.items || [];

  const competitive = items.map(l => {
    const k = keepa[l.asin] || {};

    const priceDiff = k.buyBoxPrice && l.price
      ? Math.round((l.price - k.buyBoxPrice) * 100) / 100
      : null;

    const pricePosition = priceDiff === null ? 'unknown'
      : priceDiff < 0 ? 'below'
        : priceDiff > 0 ? 'above'
          : 'at';

    return {
      sku: l.sku,
      asin: l.asin,
      title: l.title,
      yourPrice: l.price,
      buyBoxPrice: k.buyBoxPrice,
      priceDiff,
      pricePosition,
      bsr: k.salesRank,
      competitorCount: k.newOfferCount || 0,
      rating: k.rating,
      reviewCount: k.reviewCount
    };
  });

  const withBuyBox = competitive.filter(c => c.buyBoxPrice);
  const aboveBuyBox = withBuyBox.filter(c => c.pricePosition === 'above');
  const atBuyBox = withBuyBox.filter(c => c.pricePosition === 'at');
  const belowBuyBox = withBuyBox.filter(c => c.pricePosition === 'below');

  const summary = {
    totalListings: items.length,
    withBuyBoxData: withBuyBox.length,
    aboveBuyBox: aboveBuyBox.length,
    atBuyBox: atBuyBox.length,
    belowBuyBox: belowBuyBox.length,
    avgCompetitors: withBuyBox.length > 0
      ? Math.round(withBuyBox.reduce((sum, c) => sum + c.competitorCount, 0) / withBuyBox.length)
      : 0
  };

  return {
    summary,
    buyBoxAnalysis: {
      above: aboveBuyBox.slice(0, 10),
      below: belowBuyBox.slice(0, 10)
    },
    priceComparison: competitive.sort((a, b) => (b.priceDiff || 0) - (a.priceDiff || 0)),
    mostCompetitive: competitive.sort((a, b) => b.competitorCount - a.competitorCount).slice(0, 10)
  };
}

function generateScoreReport(context) {
  const { listings, scores } = context;
  const items = listings.items || [];

  const scoreData = items.map(l => {
    const score = scores[l.sku] || {};

    return {
      sku: l.sku,
      title: l.title,
      totalScore: score.totalScore || 0,
      breakdown: score.breakdown || {},
      recommendations: score.recommendations || [],
      recommendationCount: (score.recommendations || []).length
    };
  }).filter(s => s.totalScore > 0);

  const avgBreakdown = {};
  const breakdownKeys = ['title', 'bullets', 'images', 'keywords', 'description', 'price'];
  for (const key of breakdownKeys) {
    const values = scoreData.map(s => s.breakdown[key] || 0).filter(v => v > 0);
    avgBreakdown[key] = values.length > 0
      ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10
      : 0;
  }

  // Common recommendations
  const recCounts = {};
  for (const item of scoreData) {
    for (const rec of item.recommendations) {
      recCounts[rec] = (recCounts[rec] || 0) + 1;
    }
  }

  const commonRecommendations = Object.entries(recCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([rec, count]) => ({ recommendation: rec, count }));

  return {
    summary: {
      totalScored: scoreData.length,
      avgScore: Math.round(scoreData.reduce((sum, s) => sum + s.totalScore, 0) / scoreData.length),
      avgBreakdown
    },
    scoreBreakdown: scoreData.sort((a, b) => b.totalScore - a.totalScore),
    commonRecommendations,
    improvementPlan: scoreData
      .filter(s => s.totalScore < 60)
      .map(s => ({
        sku: s.sku,
        score: s.totalScore,
        topIssues: s.recommendations.slice(0, 3)
      }))
  };
}

function generateAlertsReport(context) {
  const { alerts } = context;

  const bySeverity = {
    critical: alerts.filter(a => a.severity === 'critical'),
    high: alerts.filter(a => a.severity === 'high'),
    medium: alerts.filter(a => a.severity === 'medium'),
    low: alerts.filter(a => a.severity === 'low')
  };

  const byType = {};
  for (const alert of alerts) {
    const type = alert.type || 'other';
    if (!byType[type]) byType[type] = [];
    byType[type].push(alert);
  }

  return {
    summary: {
      total: alerts.length,
      unread: alerts.filter(a => !a.read).length,
      critical: bySeverity.critical.length,
      high: bySeverity.high.length,
      medium: bySeverity.medium.length,
      low: bySeverity.low.length
    },
    alertsBySeverity: bySeverity,
    alertsByType: byType,
    timeline: alerts.slice(0, 50)
  };
}

function generateTasksReport(context) {
  const { tasks } = context;

  const byStage = {
    backlog: tasks.filter(t => t.stage === 'backlog'),
    todo: tasks.filter(t => t.stage === 'todo'),
    in_progress: tasks.filter(t => t.stage === 'in_progress'),
    review: tasks.filter(t => t.stage === 'review'),
    done: tasks.filter(t => t.stage === 'done')
  };

  const byType = {};
  for (const task of tasks) {
    const type = task.type || 'other';
    if (!byType[type]) byType[type] = [];
    byType[type].push(task);
  }

  return {
    summary: {
      total: tasks.length,
      active: byStage.todo.length + byStage.in_progress.length + byStage.review.length,
      completed: byStage.done.length,
      backlog: byStage.backlog.length
    },
    tasksByStage: byStage,
    tasksByType: byType,
    recentlyCompleted: byStage.done.slice(-10).reverse()
  };
}

function generateOpportunitiesReport(context) {
  const { listings, scores, keepa } = context;
  const items = listings.items || [];

  // Simple opportunity detection
  const opportunities = items.map(l => {
    const score = scores[l.sku];
    const k = keepa[l.asin] || {};
    const opps = [];

    if (score && score.totalScore < 60) {
      opps.push({ type: 'low_score', priority: 'high', impact: 'Improve listing quality' });
    }
    if (score && score.breakdown?.images < 15) {
      opps.push({ type: 'images', priority: 'medium', impact: 'Add more images' });
    }
    if (k.buyBoxPrice && l.price > k.buyBoxPrice * 1.1) {
      opps.push({ type: 'overpriced', priority: 'medium', impact: 'Consider price reduction' });
    }

    return {
      sku: l.sku,
      title: l.title,
      score: score?.totalScore || 0,
      opportunities: opps,
      opportunityCount: opps.length
    };
  }).filter(o => o.opportunityCount > 0);

  const highPriority = opportunities.filter(o => o.opportunities.some(op => op.priority === 'high'));

  return {
    summary: {
      totalOpportunities: opportunities.reduce((sum, o) => sum + o.opportunityCount, 0),
      listingsWithOpportunities: opportunities.length,
      highPriority: highPriority.length
    },
    quickWins: opportunities.filter(o => o.opportunities.some(op => op.priority === 'medium')).slice(0, 10),
    highPriorityItems: highPriority.slice(0, 10),
    allOpportunities: opportunities.sort((a, b) => b.opportunityCount - a.opportunityCount)
  };
}

// ============ FORMAT CONVERTERS ============

function convertToCSV(data) {
  // Find the main table data
  const tableData = data.listingsTable || data.profitByListing || data.scoreBreakdown ||
    data.priceComparison || data.timeline || data.allOpportunities || [];

  if (tableData.length === 0) {
    return 'No data available';
  }

  const headers = Object.keys(tableData[0]);
  const csvRows = [headers.join(',')];

  for (const row of tableData) {
    const values = headers.map(h => {
      let val = row[h];
      if (val === null || val === undefined) val = '';
      if (typeof val === 'object') val = JSON.stringify(val);
      if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
        val = `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    });
    csvRows.push(values.join(','));
  }

  return csvRows.join('\n');
}

function convertToHTML(report) {
  const { name, generatedAt, data } = report;

  let html = `<!DOCTYPE html>
<html>
<head>
  <title>${name}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    h2 { color: #666; border-bottom: 1px solid #ddd; padding-bottom: 10px; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
    .summary { background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0; }
    .summary p { margin: 5px 0; }
    .good { color: green; }
    .bad { color: red; }
  </style>
</head>
<body>
  <h1>${name}</h1>
  <p>Generated: ${new Date(generatedAt).toLocaleString()}</p>
`;

  // Add summary section
  if (data.summary) {
    html += '<div class="summary"><h2>Summary</h2>';
    for (const [key, value] of Object.entries(data.summary)) {
      html += `<p><strong>${key.replace(/([A-Z])/g, ' $1').trim()}:</strong> ${value}</p>`;
    }
    html += '</div>';
  }

  // Add tables
  const tableKeys = ['listingsTable', 'profitByListing', 'scoreBreakdown', 'priceComparison',
    'topPerformers', 'needsAttention', 'mostProfitable', 'timeline'];

  for (const key of tableKeys) {
    if (data[key] && Array.isArray(data[key]) && data[key].length > 0) {
      html += `<h2>${key.replace(/([A-Z])/g, ' $1').trim()}</h2>`;
      html += '<table><thead><tr>';

      const headers = Object.keys(data[key][0]);
      for (const h of headers) {
        html += `<th>${h}</th>`;
      }
      html += '</tr></thead><tbody>';

      for (const row of data[key].slice(0, 50)) {
        html += '<tr>';
        for (const h of headers) {
          let val = row[h];
          if (val === null || val === undefined) val = '-';
          if (typeof val === 'object') val = JSON.stringify(val);
          html += `<td>${val}</td>`;
        }
        html += '</tr>';
      }

      html += '</tbody></table>';
    }
  }

  html += '</body></html>';
  return html;
}

// ============ REPORT STORAGE ============

function saveReport(report) {
  initDataFiles();
  const data = JSON.parse(readFileSync(REPORTS_FILE, 'utf8'));
  const reports = data.reports || [];

  reports.unshift({
    id: report.id,
    template: report.template,
    name: report.name,
    format: report.format,
    generatedAt: report.generatedAt
  });

  // Keep last 100 reports
  writeFileSync(REPORTS_FILE, JSON.stringify({ reports: reports.slice(0, 100) }, null, 2));
}

export function getReportHistory(limit = 20) {
  initDataFiles();
  const data = JSON.parse(readFileSync(REPORTS_FILE, 'utf8'));
  return (data.reports || []).slice(0, limit);
}

// ============ SCHEDULED REPORTS ============

export function getScheduledReports() {
  initDataFiles();
  const data = JSON.parse(readFileSync(SCHEDULED_REPORTS_FILE, 'utf8'));
  return data.scheduled || [];
}

export function createScheduledReport(reportData) {
  initDataFiles();
  const data = JSON.parse(readFileSync(SCHEDULED_REPORTS_FILE, 'utf8'));
  const scheduled = data.scheduled || [];

  const newSchedule = {
    id: `SRPT-${Date.now()}`,
    name: reportData.name,
    template: reportData.template,
    format: reportData.format || 'csv',
    schedule: {
      type: reportData.schedule.type, // daily, weekly, monthly
      time: reportData.schedule.time || '09:00',
      dayOfWeek: reportData.schedule.dayOfWeek, // for weekly
      dayOfMonth: reportData.schedule.dayOfMonth // for monthly
    },
    delivery: {
      method: reportData.delivery?.method || 'download', // download, email, webhook
      email: reportData.delivery?.email,
      webhookId: reportData.delivery?.webhookId
    },
    enabled: reportData.enabled !== false,
    lastRun: null,
    nextRun: calculateNextRun(reportData.schedule),
    createdAt: new Date().toISOString()
  };

  scheduled.push(newSchedule);
  writeFileSync(SCHEDULED_REPORTS_FILE, JSON.stringify({ scheduled }, null, 2));
  return newSchedule;
}

function calculateNextRun(schedule) {
  const now = new Date();
  const [hours, minutes] = (schedule.time || '09:00').split(':').map(Number);

  let next = new Date(now);
  next.setHours(hours, minutes, 0, 0);

  if (schedule.type === 'daily') {
    if (next <= now) next.setDate(next.getDate() + 1);
  } else if (schedule.type === 'weekly') {
    const targetDay = schedule.dayOfWeek || 1;
    const currentDay = now.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil < 0 || (daysUntil === 0 && next <= now)) daysUntil += 7;
    next.setDate(now.getDate() + daysUntil);
  } else if (schedule.type === 'monthly') {
    const targetDate = schedule.dayOfMonth || 1;
    next.setDate(targetDate);
    if (next <= now) next.setMonth(next.getMonth() + 1);
  }

  return next.toISOString();
}

export function updateScheduledReport(reportId, updates) {
  initDataFiles();
  const data = JSON.parse(readFileSync(SCHEDULED_REPORTS_FILE, 'utf8'));
  const scheduled = data.scheduled || [];

  const index = scheduled.findIndex(r => r.id === reportId);
  if (index === -1) return null;

  if (updates.schedule) {
    updates.nextRun = calculateNextRun(updates.schedule);
  }

  scheduled[index] = { ...scheduled[index], ...updates };
  writeFileSync(SCHEDULED_REPORTS_FILE, JSON.stringify({ scheduled }, null, 2));
  return scheduled[index];
}

export function deleteScheduledReport(reportId) {
  initDataFiles();
  const data = JSON.parse(readFileSync(SCHEDULED_REPORTS_FILE, 'utf8'));
  let scheduled = data.scheduled || [];

  const index = scheduled.findIndex(r => r.id === reportId);
  if (index === -1) return false;

  scheduled.splice(index, 1);
  writeFileSync(SCHEDULED_REPORTS_FILE, JSON.stringify({ scheduled }, null, 2));
  return true;
}

export default {
  REPORT_TEMPLATES,
  generateReport,
  getReportHistory,
  getScheduledReports,
  createScheduledReport,
  updateScheduledReport,
  deleteScheduledReport
};
