// Demand Forecasting Module
// Phase 6: Analytics & Predictions

import { readFileSync, writeFileSync, existsSync } from 'fs';

const DATA_DIR = process.env.DATA_DIR || '/opt/alh/data';
const FORECASTS_FILE = `${DATA_DIR}/forecasts.json`;
const SALES_HISTORY_FILE = `${DATA_DIR}/sales-history.json`;

// Initialize data files
function initDataFiles() {
  if (!existsSync(FORECASTS_FILE)) {
    writeFileSync(FORECASTS_FILE, JSON.stringify({ forecasts: {} }, null, 2));
  }
  if (!existsSync(SALES_HISTORY_FILE)) {
    writeFileSync(SALES_HISTORY_FILE, JSON.stringify({ history: {} }, null, 2));
  }
}

// ============ SALES HISTORY ============

export function recordSales(sku, salesData) {
  initDataFiles();
  const data = JSON.parse(readFileSync(SALES_HISTORY_FILE, 'utf8'));
  const history = data.history || {};

  if (!history[sku]) {
    history[sku] = [];
  }

  const record = {
    date: salesData.date || new Date().toISOString().split('T')[0],
    units: salesData.units || 0,
    revenue: salesData.revenue || 0,
    orders: salesData.orders || 0
  };

  // Avoid duplicates for same date
  const existingIndex = history[sku].findIndex(h => h.date === record.date);
  if (existingIndex >= 0) {
    history[sku][existingIndex] = record;
  } else {
    history[sku].push(record);
  }

  // Keep last 365 days
  history[sku] = history[sku]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(-365);

  writeFileSync(SALES_HISTORY_FILE, JSON.stringify({ history }, null, 2));
  return record;
}

export function getSalesHistory(sku, days = 90) {
  initDataFiles();
  const data = JSON.parse(readFileSync(SALES_HISTORY_FILE, 'utf8'));
  const skuHistory = data.history?.[sku] || [];

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  return skuHistory.filter(h => new Date(h.date) >= cutoffDate);
}

// ============ SIMPLE FORECASTING ============

export function forecastDemand(sku, daysAhead = 30) {
  const history = getSalesHistory(sku, 90);

  if (history.length < 14) {
    return {
      sku,
      hasEnoughData: false,
      message: 'Need at least 14 days of sales data for forecasting',
      dataPoints: history.length
    };
  }

  // Calculate daily averages
  const recentDays = history.slice(-30);
  const olderDays = history.slice(-60, -30);

  const recentAvg = recentDays.reduce((sum, d) => sum + d.units, 0) / recentDays.length;
  const olderAvg = olderDays.length > 0 ?
    olderDays.reduce((sum, d) => sum + d.units, 0) / olderDays.length : recentAvg;

  // Calculate trend (growth rate)
  const growthRate = olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : 0;

  // Detect day-of-week patterns
  const dayOfWeekAvg = {};
  for (const record of history) {
    const dayOfWeek = new Date(record.date).getDay();
    if (!dayOfWeekAvg[dayOfWeek]) {
      dayOfWeekAvg[dayOfWeek] = { total: 0, count: 0 };
    }
    dayOfWeekAvg[dayOfWeek].total += record.units;
    dayOfWeekAvg[dayOfWeek].count++;
  }

  const dayMultipliers = {};
  const overallAvg = history.reduce((sum, d) => sum + d.units, 0) / history.length;
  for (let day = 0; day < 7; day++) {
    if (dayOfWeekAvg[day] && dayOfWeekAvg[day].count > 0) {
      const dayAvg = dayOfWeekAvg[day].total / dayOfWeekAvg[day].count;
      dayMultipliers[day] = overallAvg > 0 ? dayAvg / overallAvg : 1;
    } else {
      dayMultipliers[day] = 1;
    }
  }

  // Generate forecast
  const forecast = [];
  let currentDate = new Date();

  for (let i = 1; i <= daysAhead; i++) {
    currentDate.setDate(currentDate.getDate() + 1);
    const dayOfWeek = currentDate.getDay();

    // Base forecast with trend and day-of-week adjustment
    const trendAdjustment = 1 + (growthRate * (i / 30)); // Compound trend
    const dayAdjustment = dayMultipliers[dayOfWeek] || 1;
    const predicted = Math.max(0, recentAvg * trendAdjustment * dayAdjustment);

    // Confidence interval (wider as we go further out)
    const variance = calculateVariance(history.map(h => h.units));
    const stdDev = Math.sqrt(variance);
    const confidenceMultiplier = 1 + (i / daysAhead) * 0.5; // Increases over time

    forecast.push({
      date: currentDate.toISOString().split('T')[0],
      dayOfWeek: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek],
      predictedUnits: Math.round(predicted * 10) / 10,
      lowEstimate: Math.max(0, Math.round((predicted - stdDev * confidenceMultiplier) * 10) / 10),
      highEstimate: Math.round((predicted + stdDev * confidenceMultiplier) * 10) / 10
    });
  }

  // Calculate totals
  const totalPredicted = forecast.reduce((sum, f) => sum + f.predictedUnits, 0);

  return {
    sku,
    hasEnoughData: true,
    dataPoints: history.length,
    period: daysAhead,
    methodology: 'trend-adjusted moving average with day-of-week seasonality',
    insights: {
      recentDailyAvg: Math.round(recentAvg * 10) / 10,
      trend: growthRate > 0.05 ? 'growing' : growthRate < -0.05 ? 'declining' : 'stable',
      growthRate: Math.round(growthRate * 100),
      strongestDay: Object.entries(dayMultipliers)
        .sort((a, b) => b[1] - a[1])[0]?.[0],
      weakestDay: Object.entries(dayMultipliers)
        .sort((a, b) => a[1] - b[1])[0]?.[0]
    },
    forecast,
    summary: {
      totalPredictedUnits: Math.round(totalPredicted),
      avgDailyUnits: Math.round(totalPredicted / daysAhead * 10) / 10,
      confidence: history.length >= 60 ? 'high' : history.length >= 30 ? 'medium' : 'low'
    }
  };
}

function calculateVariance(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
}

// ============ RESTOCK RECOMMENDATIONS ============

export function getRestockRecommendation(sku, currentStock, leadTimeDays = 7, safetyStockDays = 7) {
  const forecast = forecastDemand(sku, leadTimeDays + safetyStockDays + 14);

  if (!forecast.hasEnoughData) {
    return {
      sku,
      recommendation: 'insufficient_data',
      message: forecast.message,
      suggestedAction: 'Monitor sales manually until more data is available'
    };
  }

  const leadTimeForecast = forecast.forecast.slice(0, leadTimeDays);
  const safetyForecast = forecast.forecast.slice(leadTimeDays, leadTimeDays + safetyStockDays);

  const leadTimeDemand = leadTimeForecast.reduce((sum, f) => sum + f.predictedUnits, 0);
  const safetyDemand = safetyForecast.reduce((sum, f) => sum + f.predictedUnits, 0);
  const totalNeeded = leadTimeDemand + safetyDemand;

  const reorderPoint = Math.ceil(totalNeeded);
  const daysUntilStockout = currentStock / (forecast.insights.recentDailyAvg || 1);

  let recommendation;
  let urgency;
  let suggestedQuantity;

  if (currentStock <= 0) {
    recommendation = 'out_of_stock';
    urgency = 'critical';
    suggestedQuantity = Math.ceil(forecast.summary.avgDailyUnits * 30);
  } else if (currentStock < reorderPoint * 0.5) {
    recommendation = 'reorder_now';
    urgency = 'high';
    suggestedQuantity = Math.ceil(forecast.summary.avgDailyUnits * 30) + reorderPoint;
  } else if (currentStock < reorderPoint) {
    recommendation = 'reorder_soon';
    urgency = 'medium';
    suggestedQuantity = Math.ceil(forecast.summary.avgDailyUnits * 30);
  } else if (currentStock < reorderPoint * 1.5) {
    recommendation = 'monitor';
    urgency = 'low';
    suggestedQuantity = 0;
  } else {
    recommendation = 'well_stocked';
    urgency = 'none';
    suggestedQuantity = 0;
  }

  return {
    sku,
    currentStock,
    reorderPoint,
    recommendation,
    urgency,
    suggestedQuantity,
    daysUntilStockout: Math.round(daysUntilStockout),
    leadTimeDays,
    safetyStockDays,
    demandForecast: {
      leadTimeDemand: Math.round(leadTimeDemand),
      safetyStockDemand: Math.round(safetyDemand),
      next30Days: forecast.summary.totalPredictedUnits
    },
    confidence: forecast.summary.confidence
  };
}

// ============ BULK FORECASTING ============

export function bulkForecast(skus, daysAhead = 30) {
  const results = [];

  for (const sku of skus) {
    const forecast = forecastDemand(sku, daysAhead);
    results.push({
      sku,
      hasData: forecast.hasEnoughData,
      trend: forecast.insights?.trend || 'unknown',
      avgDaily: forecast.summary?.avgDailyUnits || 0,
      total: forecast.summary?.totalPredictedUnits || 0,
      confidence: forecast.summary?.confidence || 'low'
    });
  }

  // Sort by predicted volume
  results.sort((a, b) => b.total - a.total);

  const withData = results.filter(r => r.hasData);
  const totalPredicted = withData.reduce((sum, r) => sum + r.total, 0);

  return {
    period: daysAhead,
    totalSkus: skus.length,
    skusWithData: withData.length,
    totalPredictedUnits: Math.round(totalPredicted),
    items: results,
    topSellers: results.slice(0, 10),
    growing: results.filter(r => r.trend === 'growing').length,
    declining: results.filter(r => r.trend === 'declining').length,
    stable: results.filter(r => r.trend === 'stable').length
  };
}

// ============ SEASONALITY DETECTION ============

export function detectSeasonality(sku) {
  const history = getSalesHistory(sku, 365);

  if (history.length < 60) {
    return {
      sku,
      hasEnoughData: false,
      message: 'Need at least 60 days of data for seasonality detection'
    };
  }

  // Group by month
  const monthlyData = {};
  for (const record of history) {
    const month = new Date(record.date).getMonth();
    if (!monthlyData[month]) {
      monthlyData[month] = { total: 0, count: 0 };
    }
    monthlyData[month].total += record.units;
    monthlyData[month].count++;
  }

  // Calculate monthly averages
  const monthlyAvg = {};
  const overallAvg = history.reduce((sum, h) => sum + h.units, 0) / history.length;

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  for (let month = 0; month < 12; month++) {
    if (monthlyData[month] && monthlyData[month].count > 0) {
      const avg = monthlyData[month].total / monthlyData[month].count;
      monthlyAvg[month] = {
        month: monthNames[month],
        avgUnits: Math.round(avg * 10) / 10,
        index: Math.round((avg / overallAvg) * 100),
        above: avg > overallAvg
      };
    }
  }

  // Find peak and trough
  const sorted = Object.values(monthlyAvg).sort((a, b) => b.index - a.index);
  const peakMonth = sorted[0];
  const troughMonth = sorted[sorted.length - 1];

  // Calculate seasonality strength
  const variance = sorted.reduce((sum, m) => sum + Math.pow(m.index - 100, 2), 0) / sorted.length;
  const seasonalityStrength = Math.sqrt(variance);

  return {
    sku,
    hasEnoughData: true,
    dataPoints: history.length,
    seasonality: {
      strength: seasonalityStrength > 30 ? 'strong' : seasonalityStrength > 15 ? 'moderate' : 'weak',
      strengthScore: Math.round(seasonalityStrength),
      peakMonth: peakMonth?.month,
      peakIndex: peakMonth?.index,
      troughMonth: troughMonth?.month,
      troughIndex: troughMonth?.index
    },
    monthlyPattern: Object.values(monthlyAvg),
    recommendations: generateSeasonalRecommendations(monthlyAvg, seasonalityStrength)
  };
}

function generateSeasonalRecommendations(monthlyAvg, strength) {
  const recommendations = [];
  const currentMonth = new Date().getMonth();
  const nextMonth = (currentMonth + 1) % 12;
  const twoMonthsAhead = (currentMonth + 2) % 12;

  const nextMonthData = monthlyAvg[nextMonth];
  const twoMonthsData = monthlyAvg[twoMonthsAhead];

  if (strength > 20) {
    if (nextMonthData && nextMonthData.index > 110) {
      recommendations.push({
        type: 'stock_up',
        message: `${nextMonthData.month} is typically ${nextMonthData.index - 100}% above average. Stock up now.`
      });
    }

    if (twoMonthsData && twoMonthsData.index > 120) {
      recommendations.push({
        type: 'prepare',
        message: `Peak season in ${twoMonthsData.month}. Start preparing inventory and marketing.`
      });
    }

    if (nextMonthData && nextMonthData.index < 90) {
      recommendations.push({
        type: 'promotional',
        message: `${nextMonthData.month} is typically slow. Consider promotional pricing to maintain velocity.`
      });
    }
  }

  return recommendations;
}

// ============ SAVE/LOAD FORECASTS ============

export function saveForecast(sku, forecast) {
  initDataFiles();
  const data = JSON.parse(readFileSync(FORECASTS_FILE, 'utf8'));
  const forecasts = data.forecasts || {};

  forecasts[sku] = {
    ...forecast,
    generatedAt: new Date().toISOString()
  };

  writeFileSync(FORECASTS_FILE, JSON.stringify({ forecasts }, null, 2));
  return forecasts[sku];
}

export function getStoredForecast(sku) {
  initDataFiles();
  const data = JSON.parse(readFileSync(FORECASTS_FILE, 'utf8'));
  return data.forecasts?.[sku] || null;
}

export default {
  recordSales,
  getSalesHistory,
  forecastDemand,
  getRestockRecommendation,
  bulkForecast,
  detectSeasonality,
  saveForecast,
  getStoredForecast
};
