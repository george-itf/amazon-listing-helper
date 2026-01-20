import Fastify from 'fastify';
import cors from '@fastify/cors';
import fs from 'fs';
import SellingPartner from 'amazon-sp-api';

// PostgreSQL Repositories
import * as ListingRepository from './repositories/listing.repository.js';
import * as ScoreRepository from './repositories/score.repository.js';
import * as TaskRepository from './repositories/task.repository.js';
import * as AlertRepository from './repositories/alert.repository.js';
import * as KeepaRepository from './repositories/keepa.repository.js';
import * as SettingsRepository from './repositories/settings.repository.js';
import { closePool } from './database/connection.js';
import { calculateScore, calculateAndSaveScore, getScoreHistory, getScoreTrends, calculateComplianceScore, calculateCompetitiveScore, BLOCKED_TERMS, WARNING_TERMS } from './scoring.js';
import { getDashboardStats, exportCSV } from './dashboard.js';
import { generateRecommendations, getBulkRecommendations } from './ai-recommendations.js';
import { getTasks, getTasksByStage, createTask, updateTask, moveTask, deleteTask, getTaskStats, generateTasksFromScores, TASK_TYPES } from './tasks.js';
import { getTemplates, getTemplate, createTemplateFromListing, deleteTemplate, applyTemplate } from './templates.js';
import { getPendingChanges, getAllChanges, queuePriceChange, queueListingUpdate, cancelChange, submitPriceChanges, checkFeedStatus } from './amazon-push.js';
import { getSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier, getComponents, getComponent, createComponent, updateComponent, deleteComponent, getBOM, getAllBOMs, saveBOM, addComponentToBOM, removeComponentFromBOM, calculateLandedCost, calculateMargin, getBulkCostAnalysis, compareSupplierPrices, importBOMData } from './bom.js';
import { recordMetrics, getMetrics, getMetricsSummary, recordScore, getScoreHistory as getMetricsScoreHistory, getScoreTrend, recordChange, getChanges as getAttributionChanges, analyzeChangeImpact, detectCannibalization, getPortfolioMetrics } from './metrics.js';
import { analyzeOpportunities, getQuickWins, getOpportunitySummary, findBundleOpportunities, getSeasonalOpportunities } from './opportunities.js';
import { recordSales, getSalesHistory, forecastDemand, getRestockRecommendation, bulkForecast, detectSeasonality, saveForecast, getStoredForecast } from './forecasting.js';
import { WIDGET_TYPES, getLayouts, getActiveLayout, saveLayout, setActiveLayout, deleteLayout, resetToDefault, getWidgetConfig, updateWidgetConfig, toggleWidget, getWidgetData } from './widgets.js';
import { TRIGGER_TYPES, ACTION_TYPES, getAdvancedRules, getAdvancedRule, createAdvancedRule, updateAdvancedRule, deleteAdvancedRule, getWebhooks, getWebhook, createWebhook, updateWebhook, deleteWebhook, executeWebhook, testWebhook, getScheduledTasks, createScheduledTask, updateScheduledTask, deleteScheduledTask, getDueScheduledTasks, markScheduledTaskRun, evaluateRule, executeActions, getExecutionLogs } from './advanced-automation.js';
import { REPORT_TEMPLATES, generateReport, getReportHistory, getScheduledReports, createScheduledReport, updateScheduledReport, deleteScheduledReport } from './reports.js';
import { generateFromASIN, generateFromComponents, compareASINs, saveGeneratedListing, getSavedListings, deleteSavedListing, CATEGORY_KEYWORDS } from './listing-generator.js';
import { MODULE_TYPES, APLUS_TEMPLATES, generateAPlusContent, saveAPlusContent, getAPlusContent, getAllAPlusContent, deleteAPlusContent, updateAPlusStatus, generateHTMLPreview } from './aplus-content.js';
import { trackCompetitor, untrackCompetitor, getTrackedCompetitors, getAllTrackedCompetitors, recordCompetitorPrice, getCompetitorPriceHistory, analyzePriceTrends, calculateBuyBoxWinRate, getBulkBuyBoxAnalysis, analyzeMarketGaps, getCompetitorPositionSummary, generateCompetitiveReport } from './competitor-intelligence.js';
import * as OrderRepository from './repositories/order.repository.js';
import { syncOrders, getSyncStatus } from './orders-sync.js';
import { registerV2Routes } from './routes/v2.routes.js';
import { startWorker, stopWorker } from './workers/job-worker.js';

const fastify = Fastify({ logger: true });
await fastify.register(cors, { origin: true });

// Register v2 API routes
await registerV2Routes(fastify);
console.log('API v2 routes registered');

const DATA_DIR = '/opt/alh/data';
const CREDS_FILE = `${DATA_DIR}/credentials.json`;
const LISTINGS_FILE = `${DATA_DIR}/listings.json`;
const SCORES_FILE = `${DATA_DIR}/scores.json`;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Simple rate limiter (in-memory, per endpoint)
const rateLimitStore = new Map();
function rateLimit(key, maxRequests = 60, windowMs = 60000) {
  const now = Date.now();
  const windowStart = now - windowMs;

  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, []);
  }

  const requests = rateLimitStore.get(key).filter(t => t > windowStart);
  rateLimitStore.set(key, requests);

  if (requests.length >= maxRequests) {
    return false; // Rate limited
  }

  requests.push(now);
  return true; // Allowed
}

// Input sanitization helper
function sanitizeString(str, maxLength = 500) {
  if (typeof str !== 'string') return '';
  return str.slice(0, maxLength).replace(/<[^>]*>/g, '').trim();
}

function sanitizeASIN(asin) {
  if (typeof asin !== 'string') return '';
  return asin.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

function loadCreds() {
  try {
    if (fs.existsSync(CREDS_FILE)) return JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
  } catch (e) { console.error(e); }
  return {};
}

function saveCreds(data) {
  fs.writeFileSync(CREDS_FILE, JSON.stringify(data, null, 2));
}

function loadListings() {
  try {
    if (fs.existsSync(LISTINGS_FILE)) return JSON.parse(fs.readFileSync(LISTINGS_FILE, 'utf8'));
  } catch (e) { console.error(e); }
  return { items: [], lastSync: null };
}

function saveListings(data) {
  fs.writeFileSync(LISTINGS_FILE, JSON.stringify(data, null, 2));
}

function loadScores() {
  try {
    if (fs.existsSync(SCORES_FILE)) return JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
  } catch (e) { console.error(e); }
  return {};
}

function saveScores(data) {
  fs.writeFileSync(SCORES_FILE, JSON.stringify(data, null, 2));
}

function getSpClient() {
  const c = loadCreds();
  if (!c.clientId || !c.clientSecret || !c.refreshToken) return null;
  return new SellingPartner({
    region: 'eu',
    refresh_token: c.refreshToken,
    credentials: {
      SELLING_PARTNER_APP_CLIENT_ID: c.clientId,
      SELLING_PARTNER_APP_CLIENT_SECRET: c.clientSecret
    }
  });
}

// Health
fastify.get('/api/v1/health', async () => ({ status: 'ok' }));

// Settings (hybrid: SP-API creds in file for security, app settings in PostgreSQL)
fastify.get('/api/v1/settings', async () => {
  try {
    const c = loadCreds();
    // Get additional app settings from PostgreSQL
    const appSettings = await SettingsRepository.getAllAsObject();

    return {
      success: true,
      data: {
        configured: !!(c.clientId && c.clientSecret && c.refreshToken),
        clientIdPreview: c.clientId ? c.clientId.substring(0, 20) + '...' : '',
        keepaConfigured: !!c.keepaKey,
        scoringWeights: appSettings.scoring_weights || null,
        lastSync: appSettings.last_sync || null,
        keepaLastSync: appSettings.keepa_last_sync || null
      }
    };
  } catch (error) {
    console.error('Get settings error:', error);
    return { success: false, error: error.message };
  }
});

fastify.post('/api/v1/settings', async (req) => {
  try {
    const body = req.body;

    // SP-API credentials stored in file for security
    const current = loadCreds();
    if (body.clientId) current.clientId = body.clientId;
    if (body.clientSecret) current.clientSecret = body.clientSecret;
    if (body.refreshToken) current.refreshToken = body.refreshToken;
    if (body.keepaKey) current.keepaKey = body.keepaKey;
    saveCreds(current);

    // App settings stored in PostgreSQL
    if (body.scoringWeights) {
      await SettingsRepository.setScoringWeights(body.scoringWeights);
    }

    return { success: true };
  } catch (error) {
    console.error('Save settings error:', error);
    return { success: false, error: error.message };
  }
});

// Dashboard
fastify.get('/api/v1/dashboard', async () => {
  try {
    const c = loadCreds();
    const configured = !!(c.clientId && c.clientSecret && c.refreshToken);

    // Get listings from PostgreSQL
    const listings = await ListingRepository.getAll();
    const statusCounts = await ListingRepository.getStatusCounts();

    // Get score statistics from PostgreSQL
    const scoreStats = await ScoreRepository.getStatistics();
    const scoreDistribution = await ScoreRepository.getDistribution();

    const active = statusCounts.active || 0;
    const inactive = listings.length - active;

    // Map distribution buckets
    const excellent = scoreDistribution.find(d => d.bucket === 'excellent')?.count || 0;
    const good = scoreDistribution.find(d => d.bucket === 'good')?.count || 0;
    const fair = scoreDistribution.find(d => d.bucket === 'fair')?.count || 0;
    const poor = scoreDistribution.find(d => d.bucket === 'poor')?.count || 0;
    const needsWork = parseInt(fair) + parseInt(poor);

    return {
      success: true,
      data: {
        configured,
        totalSkus: listings.length,
        active: parseInt(active),
        inactive,
        lastSync: null, // TODO: Track last sync time in settings
        avgScore: Math.round(parseFloat(scoreStats?.avg_score) || 0),
        scoreBreakdown: { excellent: parseInt(excellent), good: parseInt(good), needsWork },
        scored: parseInt(scoreStats?.total_scored) || 0
      }
    };
  } catch (error) {
    console.error('Dashboard error:', error);
    return { success: false, error: error.message };
  }
});

// Get all listings with scores
fastify.get('/api/v1/listings', async (req) => {
  try {
    const { status, category, minScore, maxScore, limit = 100, offset = 0 } = req.query;
    const filters = {};
    if (status) filters.status = status;
    if (category) filters.category = category;
    if (minScore) filters.minScore = parseFloat(minScore);
    if (maxScore) filters.maxScore = parseFloat(maxScore);

    const listings = await ListingRepository.getAll(filters);

    // Map to expected format with score included
    const items = listings.map(item => ({
      sku: item.sku,
      asin: item.asin,
      title: item.title,
      price: parseFloat(item.price) || 0,
      quantity: item.quantity,
      status: item.status,
      fulfillment: item.fulfillment || item.fulfillmentChannel,
      openDate: item.openDate,
      imageUrl: item.imageUrl,
      score: item.currentScore ? parseFloat(item.currentScore) : null,
      images: item.images || []
    }));

    return { success: true, data: { items, lastSync: null } };
  } catch (error) {
    console.error('Get listings error:', error);
    return { success: false, error: error.message };
  }
});

// Get single listing with full score details
fastify.get('/api/v1/listings/:sku', async (req) => {
  try {
    const sku = req.params.sku;
    const listing = await ListingRepository.getBySku(sku);
    if (!listing) return { success: false, error: 'Listing not found' };

    // Get the latest score for this listing
    const score = listing.id ? await ScoreRepository.getLatestByListingId(listing.id) : null;

    return { success: true, data: { listing, score } };
  } catch (error) {
    console.error('Get listing error:', error);
    return { success: false, error: error.message };
  }
});

// Calculate scores for all listings (enhanced with Keepa data)
fastify.post('/api/v1/score', async () => {
  try {
    const listings = await ListingRepository.getAll({ status: 'active' });

    let scoredCount = 0;
    for (const listing of listings) {
      // Get Keepa data for this listing from PostgreSQL
      const keepaData = listing.asin ? await KeepaRepository.getByAsin(listing.asin) : null;

      // Calculate score using existing scoring logic
      const scoreResult = calculateScore(listing, keepaData);

      // Save score to PostgreSQL
      await ScoreRepository.create({
        listingId: listing.id,
        totalScore: scoreResult.totalScore,
        seoScore: scoreResult.components?.seo?.score,
        contentScore: scoreResult.components?.content?.score,
        imageScore: scoreResult.components?.images?.score,
        competitiveScore: scoreResult.components?.competitive?.score,
        complianceScore: scoreResult.components?.compliance?.score,
        seoViolations: scoreResult.components?.seo?.violations || [],
        contentViolations: scoreResult.components?.content?.violations || [],
        imageViolations: scoreResult.components?.images?.violations || [],
        competitiveViolations: scoreResult.components?.competitive?.violations || [],
        complianceViolations: scoreResult.components?.compliance?.violations || [],
        breakdown: scoreResult.components,
        recommendations: scoreResult.recommendations || []
      });

      // Update denormalized score on listing
      await ListingRepository.update(listing.sku, {
        currentScore: scoreResult.totalScore
      });

      scoredCount++;
    }

    return { success: true, data: { scored: scoredCount } };
  } catch (error) {
    console.error('Score calculation error:', error);
    return { success: false, error: error.message };
  }
});

// Sync FBM listings from Amazon
fastify.post('/api/v1/sync', async () => {
  const sp = getSpClient();
  if (!sp) return { success: false, error: 'SP-API not configured' };

  try {
    const createRes = await sp.callAPI({
      operation: 'createReport',
      endpoint: 'reports',
      body: {
        reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA',
        marketplaceIds: ['A1F83G8C2ARO7P']
      }
    });

    const reportId = createRes.reportId;
    console.log('Report requested:', reportId);

    let report;
    let attempts = 0;
    do {
      await new Promise(r => setTimeout(r, 5000));
      report = await sp.callAPI({
        operation: 'getReport',
        endpoint: 'reports',
        path: { reportId }
      });
      attempts++;
      console.log('Report status:', report.processingStatus);
    } while ((report.processingStatus === 'IN_QUEUE' || report.processingStatus === 'IN_PROGRESS') && attempts < 24);

    if (report.processingStatus !== 'DONE') {
      return { success: false, error: 'Report not ready: ' + report.processingStatus };
    }

    const doc = await sp.callAPI({
      operation: 'getReportDocument',
      endpoint: 'reports',
      path: { reportDocumentId: report.reportDocumentId }
    });

    const response = await fetch(doc.url);
    const text = await response.text();

    const lines = text.split('\n').filter(l => l.trim());
    const headers = lines[0].split('\t');

    const items = lines.slice(1).map(line => {
      const vals = line.split('\t');
      const item = {};
      headers.forEach((h, i) => { item[h] = vals[i] || ''; });
      return {
        sku: item['seller-sku'] || item['sku'],
        asin: item['asin1'] || item['asin'],
        title: item['item-name'] || item['product-name'],
        price: parseFloat(item['price']) || 0,
        quantity: parseInt(item['quantity']) || 0,
        status: (item['status'] || 'Active').toLowerCase(),
        fulfillment: 'FBM',
        openDate: item['open-date'],
        imageUrl: item['image-url']
      };
    }).filter(i => i.sku && i.title);

    // Save listings to PostgreSQL (upsert)
    let syncedCount = 0;
    for (const item of items) {
      try {
        await ListingRepository.upsert(item);
        syncedCount++;
      } catch (e) {
        console.error(`Error syncing ${item.sku}:`, e.message);
      }
    }

    // Save last sync time to settings
    await SettingsRepository.set('last_sync', new Date().toISOString(), 'Last Amazon sync timestamp');

    // Auto-calculate scores after sync
    let scoredCount = 0;
    for (const item of items) {
      try {
        const listing = await ListingRepository.getBySku(item.sku);
        if (!listing) continue;

        const keepaData = listing.asin ? await KeepaRepository.getByAsin(listing.asin) : null;
        const scoreResult = calculateScore(listing, keepaData);

        await ScoreRepository.create({
          listingId: listing.id,
          totalScore: scoreResult.totalScore,
          seoScore: scoreResult.components?.seo?.score,
          contentScore: scoreResult.components?.content?.score,
          imageScore: scoreResult.components?.images?.score,
          competitiveScore: scoreResult.components?.competitive?.score,
          complianceScore: scoreResult.components?.compliance?.score,
          breakdown: scoreResult.components,
          recommendations: scoreResult.recommendations || []
        });

        await ListingRepository.update(item.sku, { currentScore: scoreResult.totalScore });
        scoredCount++;
      } catch (e) {
        console.error(`Error scoring ${item.sku}:`, e.message);
      }
    }

    return { success: true, data: { synced: syncedCount, scored: scoredCount } };
  } catch (e) {
    console.error('Sync error:', e);
    return { success: false, error: e.message };
  }
});

// Keepa Integration (PostgreSQL)
fastify.get('/api/v1/keepa/:asin', async (req) => {
  const c = loadCreds();
  if (!c.keepaKey) return { success: false, error: 'Keepa API key not configured' };

  const asin = sanitizeASIN(req.params.asin);
  try {
    const url = `https://api.keepa.com/product?key=${c.keepaKey}&domain=2&asin=${asin}&stats=180&history=1&offers=20`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) return { success: false, error: data.error.message };
    if (!data.products || data.products.length === 0) return { success: false, error: 'Product not found' };

    const product = data.products[0];

    // Parse Keepa data
    const result = {
      asin,
      currentPrice: product.stats?.current?.[0] ? product.stats.current[0] / 100 : null,
      currentBSR: product.stats?.current?.[3],
      avgPrice30: product.stats?.avg30?.[0] ? product.stats.avg30[0] / 100 : null,
      avgBSR30: product.stats?.avg30?.[3],
      competitorCount: (product.offers || []).filter(o => o.condition === 1).length,
      amazonOnListing: product.offers?.some(o => o.isAmazon) || false,
      buyBoxSeller: product.offers?.find(o => o.isBuyBox)?.sellerName || null,
      buyBoxPrice: product.stats?.current?.[18] ? product.stats.current[18] / 100 : null,
      rating: product.stats?.current?.[16] ? product.stats.current[16] / 10 : null,
      reviewCount: product.stats?.current?.[17],
      salesEstimate: null // Keepa doesn't provide direct sales estimate
    };

    // Save to PostgreSQL
    await KeepaRepository.upsert(result);

    return { success: true, data: result };
  } catch (e) {
    console.error('Keepa error:', e);
    return { success: false, error: e.message };
  }
});

// Bulk Keepa fetch for all listings (PostgreSQL)
fastify.post('/api/v1/keepa/sync', async () => {
  const c = loadCreds();
  if (!c.keepaKey) return { success: false, error: 'Keepa API key not configured' };

  try {
    // Get listings from PostgreSQL
    const listings = await ListingRepository.getAll({ status: 'active' });
    const asins = [...new Set(listings.map(l => l.asin).filter(a => a))];

    // Keepa allows up to 100 ASINs per request
    const batchSize = 100;
    let syncedCount = 0;

    for (let i = 0; i < asins.length; i += batchSize) {
      const batch = asins.slice(i, i + batchSize);
      const url = `https://api.keepa.com/product?key=${c.keepaKey}&domain=2&asin=${batch.join(',')}&stats=180&offers=20`;

      try {
        const res = await fetch(url);
        const data = await res.json();

        if (data.products) {
          for (const p of data.products) {
            const keepaRecord = {
              asin: p.asin,
              currentPrice: p.stats?.current?.[0] ? p.stats.current[0] / 100 : null,
              currentBSR: p.stats?.current?.[3],
              avgPrice30: p.stats?.avg30?.[0] ? p.stats.avg30[0] / 100 : null,
              avgBSR30: p.stats?.avg30?.[3],
              competitorCount: (p.offers || []).filter(o => o.condition === 1).length,
              amazonOnListing: p.offers?.some(o => o.isAmazon) || false,
              buyBoxSeller: p.offers?.find(o => o.isBuyBox)?.sellerName || null,
              buyBoxPrice: p.stats?.current?.[18] ? p.stats.current[18] / 100 : null,
              rating: p.stats?.current?.[16] ? p.stats.current[16] / 10 : null,
              reviewCount: p.stats?.current?.[17]
            };

            await KeepaRepository.upsert(keepaRecord);
            syncedCount++;
          }
        }

        // Rate limit: wait between batches
        if (i + batchSize < asins.length) await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        console.error('Keepa batch error:', e);
      }
    }

    // Update last sync time in settings
    await SettingsRepository.set('keepa_last_sync', new Date().toISOString(), 'Last Keepa sync timestamp');

    return { success: true, data: { synced: syncedCount } };
  } catch (error) {
    console.error('Keepa sync error:', error);
    return { success: false, error: error.message };
  }
});

// Get Keepa data (PostgreSQL)
fastify.get('/api/v1/keepa', async () => {
  try {
    const keepaRecords = await KeepaRepository.getAll();
    const lastSync = await SettingsRepository.get('keepa_last_sync');

    // Convert array to object keyed by ASIN for backward compatibility
    const data = {};
    for (const record of keepaRecords) {
      data[record.asin] = record;
    }

    return { success: true, data: { data, lastSync: lastSync?.value || null } };
  } catch (error) {
    console.error('Get Keepa data error:', error);
    return { success: false, error: error.message };
  }
});

// ============ PHASE 4: PRICING & COSTS ============

const COSTS_FILE = `${DATA_DIR}/costs.json`;

function loadCosts() {
  try {
    if (fs.existsSync(COSTS_FILE)) return JSON.parse(fs.readFileSync(COSTS_FILE, 'utf8'));
  } catch (e) { console.error(e); }
  return {};
}

function saveCosts(data) {
  fs.writeFileSync(COSTS_FILE, JSON.stringify(data, null, 2));
}

// Amazon FBA/FBM fee calculator (UK)
function calculateAmazonFees(price, category = 'diy') {
  // Referral fee (typically 15% for DIY/Tools)
  const referralRate = 0.15;
  const referralFee = price * referralRate;
  
  // Per-item closing fee (£0.25 for most categories)
  const closingFee = 0.25;
  
  return {
    referralFee: Math.round(referralFee * 100) / 100,
    closingFee,
    totalFees: Math.round((referralFee + closingFee) * 100) / 100
  };
}

// Get costs for a SKU
fastify.get('/api/v1/costs/:sku', async (req) => {
  const costs = loadCosts();
  const sku = req.params.sku;
  return { success: true, data: costs[sku] || null };
});

// Save costs for a SKU
fastify.post('/api/v1/costs/:sku', async (req) => {
  const costs = loadCosts();
  const sku = req.params.sku;
  const body = req.body;
  
  costs[sku] = {
    productCost: parseFloat(body.productCost) || 0,
    shippingCost: parseFloat(body.shippingCost) || 0,
    packagingCost: parseFloat(body.packagingCost) || 0,
    otherCost: parseFloat(body.otherCost) || 0,
    updatedAt: new Date().toISOString()
  };
  
  saveCosts(costs);
  return { success: true };
});

// Calculate profit for a listing
fastify.get('/api/v1/profit/:sku', async (req) => {
  const sku = req.params.sku;
  const listings = loadListings();
  const costs = loadCosts();
  const keepa = (() => {
    try {
      const f = `${DATA_DIR}/keepa.json`;
      if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')).data || {};
    } catch (e) {}
    return {};
  })();
  
  const listing = listings.items.find(i => i.sku === sku);
  if (!listing) return { success: false, error: 'Listing not found' };
  
  const cost = costs[sku] || { productCost: 0, shippingCost: 0, packagingCost: 0, otherCost: 0 };
  const k = keepa[listing.asin] || {};
  
  const sellingPrice = listing.price || 0;
  const buyBoxPrice = k.buyBoxPrice || sellingPrice;
  
  const totalCost = cost.productCost + cost.shippingCost + cost.packagingCost + cost.otherCost;
  const fees = calculateAmazonFees(sellingPrice);
  
  const grossProfit = sellingPrice - totalCost - fees.totalFees;
  const margin = sellingPrice > 0 ? (grossProfit / sellingPrice) * 100 : 0;
  const roi = totalCost > 0 ? (grossProfit / totalCost) * 100 : 0;
  
  // Calculate at Buy Box price
  const bbFees = calculateAmazonFees(buyBoxPrice);
  const bbGrossProfit = buyBoxPrice - totalCost - bbFees.totalFees;
  const bbMargin = buyBoxPrice > 0 ? (bbGrossProfit / buyBoxPrice) * 100 : 0;
  
  return {
    success: true,
    data: {
      sku,
      asin: listing.asin,
      title: listing.title,
      sellingPrice,
      buyBoxPrice,
      costs: {
        product: cost.productCost,
        shipping: cost.shippingCost,
        packaging: cost.packagingCost,
        other: cost.otherCost,
        total: totalCost
      },
      fees: {
        referral: fees.referralFee,
        closing: fees.closingFee,
        total: fees.totalFees
      },
      profit: {
        gross: Math.round(grossProfit * 100) / 100,
        margin: Math.round(margin * 10) / 10,
        roi: Math.round(roi * 10) / 10
      },
      atBuyBox: {
        gross: Math.round(bbGrossProfit * 100) / 100,
        margin: Math.round(bbMargin * 10) / 10
      }
    }
  };
});

// Bulk profit overview
fastify.get('/api/v1/profit', async () => {
  const listings = loadListings();
  const costs = loadCosts();
  const keepa = (() => {
    try {
      const f = `${DATA_DIR}/keepa.json`;
      if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')).data || {};
    } catch (e) {}
    return {};
  })();
  
  const results = listings.items.map(listing => {
    const cost = costs[listing.sku] || { productCost: 0, shippingCost: 0, packagingCost: 0, otherCost: 0 };
    const k = keepa[listing.asin] || {};
    
    const sellingPrice = listing.price || 0;
    const totalCost = cost.productCost + cost.shippingCost + cost.packagingCost + cost.otherCost;
    const fees = calculateAmazonFees(sellingPrice);
    const grossProfit = sellingPrice - totalCost - fees.totalFees;
    const margin = sellingPrice > 0 ? (grossProfit / sellingPrice) * 100 : 0;
    
    return {
      sku: listing.sku,
      asin: listing.asin,
      title: listing.title,
      price: sellingPrice,
      buyBox: k.buyBoxPrice,
      cost: totalCost,
      fees: fees.totalFees,
      profit: Math.round(grossProfit * 100) / 100,
      margin: Math.round(margin * 10) / 10,
      hasCost: totalCost > 0
    };
  });
  
  // Summary stats
  const withCosts = results.filter(r => r.hasCost);
  const totalProfit = withCosts.reduce((sum, r) => sum + r.profit, 0);
  const avgMargin = withCosts.length > 0 ? withCosts.reduce((sum, r) => sum + r.margin, 0) / withCosts.length : 0;
  const profitable = withCosts.filter(r => r.profit > 0).length;
  const unprofitable = withCosts.filter(r => r.profit <= 0).length;
  
  return {
    success: true,
    data: {
      items: results,
      summary: {
        totalListings: results.length,
        withCosts: withCosts.length,
        profitable,
        unprofitable,
        avgMargin: Math.round(avgMargin * 10) / 10
      }
    }
  };
});

// ============================================
// PHASE 4: SHIPPING & PRICE OPTIMIZATION
// ============================================

import { calculateShipping, determineParcelType, ROYAL_MAIL_RATES } from "./shipping.js";

// Load shipping data
function loadShipping() {
  try {
    const f = DATA_DIR + "/shipping.json";
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (e) {}
  return {};
}

function saveShipping(data) {
  fs.writeFileSync(DATA_DIR + "/shipping.json", JSON.stringify(data, null, 2));
}

// GET /api/v1/shipping/rates - Calculate shipping rates
fastify.get("/api/v1/shipping/rates", async (req) => {
  const weight = parseFloat(req.query.weight) || 500;
  const length = parseFloat(req.query.length) || 200;
  const width = parseFloat(req.query.width) || 150;
  const height = parseFloat(req.query.height) || 50;
  
  const result = calculateShipping(weight, { length, width, height });
  return { success: true, data: result };
});

// GET /api/v1/shipping/:sku - Get shipping for SKU
fastify.get("/api/v1/shipping/:sku", async (req) => {
  const { sku } = req.params;
  const shippingData = loadShipping();
  const data = shippingData[sku] || { weightGrams: 500, length: 200, width: 150, height: 50 };
  const rates = calculateShipping(data.weightGrams, data);
  return { success: true, data: { ...data, rates } };
});

// POST /api/v1/shipping/:sku - Save shipping for SKU
fastify.post("/api/v1/shipping/:sku", async (req) => {
  const { sku } = req.params;
  const { weightGrams, length, width, height } = req.body;
  
  const shippingData = loadShipping();
  shippingData[sku] = {
    weightGrams: parseFloat(weightGrams) || 500,
    length: parseFloat(length) || 200,
    width: parseFloat(width) || 150,
    height: parseFloat(height) || 50,
    parcelType: determineParcelType(weightGrams, length, width, height),
    updatedAt: new Date().toISOString()
  };
  saveShipping(shippingData);
  
  const rates = calculateShipping(shippingData[sku].weightGrams, shippingData[sku]);
  return { success: true, data: { ...shippingData[sku], rates } };
});

// GET /api/v1/optimize/:sku - Price optimization recommendations
fastify.get("/api/v1/optimize/:sku", async (req) => {
  const { sku } = req.params;
  const listings = loadListings();
  const costs = loadCosts();
  const shippingData = loadShipping();
  
  let keepa = {};
  try {
    const f = DATA_DIR + "/keepa.json";
    if (fs.existsSync(f)) keepa = JSON.parse(fs.readFileSync(f, "utf8")).data || {};
  } catch (e) {}
  
  const listing = listings.items.find(l => l.sku === sku);
  if (!listing) return { success: false, error: "Listing not found" };
  
  const cost = costs[sku] || {};
  const ship = shippingData[sku] || { weightGrams: 500 };
  const k = keepa[listing.asin] || {};
  
  const currentPrice = listing.price || 0;
  const buyBoxPrice = k.buyBoxPrice || currentPrice;
  const productCost = parseFloat(cost.productCost) || 0;
  const shippingCost = calculateShipping(ship.weightGrams, ship).recommended?.price || 2.90;
  const packagingCost = parseFloat(cost.packagingCost) || 0;
  const otherCost = parseFloat(cost.otherCost) || 0;
  const totalCost = productCost + shippingCost + packagingCost + otherCost;
  
  // Calculate metrics at different price points
  function calcProfit(price) {
    const fees = calculateAmazonFees(price);
    return price - totalCost - fees.totalFees;
  }
  
  function calcMargin(price) {
    return price > 0 ? (calcProfit(price) / price) * 100 : 0;
  }
  
  // Find break-even price
  let breakEven = totalCost;
  for (let p = totalCost; p < totalCost * 3; p += 0.01) {
    if (calcProfit(p) >= 0) {
      breakEven = Math.round(p * 100) / 100;
      break;
    }
  }
  
  // Price recommendations
  const recommendations = [];
  
  // Match Buy Box
  if (buyBoxPrice && buyBoxPrice !== currentPrice) {
    const bbProfit = calcProfit(buyBoxPrice);
    recommendations.push({
      strategy: "Match Buy Box",
      price: buyBoxPrice,
      profit: Math.round(bbProfit * 100) / 100,
      margin: Math.round(calcMargin(buyBoxPrice) * 10) / 10,
      reason: bbProfit > 0 ? "Match competitors to win Buy Box" : "Warning: unprofitable at Buy Box price"
    });
  }
  
  // Undercut Buy Box by 1p
  if (buyBoxPrice && buyBoxPrice > breakEven + 0.01) {
    const undercut = Math.round((buyBoxPrice - 0.01) * 100) / 100;
    recommendations.push({
      strategy: "Undercut Buy Box",
      price: undercut,
      profit: Math.round(calcProfit(undercut) * 100) / 100,
      margin: Math.round(calcMargin(undercut) * 10) / 10,
      reason: "Beat competition by 1p"
    });
  }
  
  // Target 20% margin
  const target20 = Math.round((totalCost + calculateAmazonFees(totalCost * 1.5).totalFees) / 0.80 * 100) / 100;
  if (target20 > breakEven) {
    recommendations.push({
      strategy: "Target 20% Margin",
      price: target20,
      profit: Math.round(calcProfit(target20) * 100) / 100,
      margin: Math.round(calcMargin(target20) * 10) / 10,
      reason: "Healthy profit margin"
    });
  }
  
  // Target 30% margin
  const target30 = Math.round((totalCost + calculateAmazonFees(totalCost * 2).totalFees) / 0.70 * 100) / 100;
  if (target30 > breakEven) {
    recommendations.push({
      strategy: "Target 30% Margin",
      price: target30,
      profit: Math.round(calcProfit(target30) * 100) / 100,
      margin: Math.round(calcMargin(target30) * 10) / 10,
      reason: "Premium pricing for higher profit"
    });
  }
  
  // Competitor analysis
  const competitorCount = k.competitorCount || 0;
  let pricePosition = "unknown";
  if (buyBoxPrice) {
    if (currentPrice < buyBoxPrice) pricePosition = "below";
    else if (currentPrice > buyBoxPrice) pricePosition = "above";
    else pricePosition = "at";
  }
  
  return {
    success: true,
    data: {
      sku,
      asin: listing.asin,
      title: listing.title,
      current: {
        price: currentPrice,
        profit: Math.round(calcProfit(currentPrice) * 100) / 100,
        margin: Math.round(calcMargin(currentPrice) * 10) / 10
      },
      costs: {
        product: productCost,
        shipping: shippingCost,
        packaging: packagingCost,
        other: otherCost,
        total: totalCost
      },
      breakEven,
      buyBoxPrice,
      pricePosition,
      competitorCount,
      recommendations
    }
  };
});

// GET /api/v1/optimize - Bulk optimization overview
fastify.get("/api/v1/optimize", async () => {
  const listings = loadListings();
  const costs = loadCosts();
  
  let keepa = {};
  try {
    const f = DATA_DIR + "/keepa.json";
    if (fs.existsSync(f)) keepa = JSON.parse(fs.readFileSync(f, "utf8")).data || {};
  } catch (e) {}
  
  const opportunities = [];
  
  listings.items.forEach(listing => {
    const cost = costs[listing.sku] || {};
    const k = keepa[listing.asin] || {};
    
    const currentPrice = listing.price || 0;
    const buyBoxPrice = k.buyBoxPrice;
    const totalCost = (parseFloat(cost.productCost) || 0) + 
                      (parseFloat(cost.shippingCost) || 2.90) + 
                      (parseFloat(cost.packagingCost) || 0) + 
                      (parseFloat(cost.otherCost) || 0);
    
    const fees = calculateAmazonFees(currentPrice);
    const profit = currentPrice - totalCost - fees.totalFees;
    const margin = currentPrice > 0 ? (profit / currentPrice) * 100 : 0;
    
    let opportunity = null;
    
    // Unprofitable
    if (profit < 0 && totalCost > 0) {
      opportunity = { type: "unprofitable", severity: "high", message: "Losing money - review costs or increase price" };
    }
    // Above Buy Box
    else if (buyBoxPrice && currentPrice > buyBoxPrice * 1.05) {
      opportunity = { type: "overpriced", severity: "medium", message: "Price 5%+ above Buy Box" };
    }
    // Low margin
    else if (margin < 10 && margin > 0) {
      opportunity = { type: "low_margin", severity: "low", message: "Margin below 10%" };
    }
    // Below Buy Box opportunity
    else if (buyBoxPrice && currentPrice < buyBoxPrice * 0.95 && margin > 20) {
      opportunity = { type: "underpriced", severity: "low", message: "Could increase price - good margin and below Buy Box" };
    }
    
    if (opportunity) {
      opportunities.push({
        sku: listing.sku,
        asin: listing.asin,
        title: listing.title?.substring(0, 50),
        currentPrice,
        buyBoxPrice,
        profit: Math.round(profit * 100) / 100,
        margin: Math.round(margin * 10) / 10,
        ...opportunity
      });
    }
  });
  
  // Sort by severity
  const severityOrder = { high: 0, medium: 1, low: 2 };
  opportunities.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  
  return {
    success: true,
    data: {
      opportunities,
      summary: {
        total: opportunities.length,
        high: opportunities.filter(o => o.severity === "high").length,
        medium: opportunities.filter(o => o.severity === "medium").length,
        low: opportunities.filter(o => o.severity === "low").length
      }
    }
  };
});

console.log("Shipping & optimization endpoints loaded");

// ============================================
// PHASE 5: AUTOMATION ENGINE
// ============================================

import { RULE_TEMPLATES, runAutomation, getRules, saveRules } from "./automation.js";

// GET /api/v1/automation/templates - Get rule templates
fastify.get("/api/v1/automation/templates", async () => {
  return { success: true, data: { templates: RULE_TEMPLATES } };
});

// GET /api/v1/automation/rules - Get active rules (PostgreSQL)
fastify.get("/api/v1/automation/rules", async () => {
  try {
    const rules = await getRules();
    const enabledRules = rules.map(t => ({ ...t, enabled: true }));
    return { success: true, data: { rules: enabledRules } };
  } catch (error) {
    console.error('Get automation rules error:', error);
    return { success: false, error: error.message };
  }
});

// POST /api/v1/automation/rules - Save rules (PostgreSQL)
fastify.post("/api/v1/automation/rules", async (req) => {
  try {
    const { rules } = req.body;
    await saveRules(rules);
    return { success: true, data: { saved: rules.length } };
  } catch (error) {
    console.error('Save automation rules error:', error);
    return { success: false, error: error.message };
  }
});

// POST /api/v1/automation/run - Run automation check (PostgreSQL)
fastify.post("/api/v1/automation/run", async () => {
  try {
    const result = await runAutomation();
    return { success: true, data: result };
  } catch (error) {
    console.error('Run automation error:', error);
    return { success: false, error: error.message };
  }
});

// GET /api/v1/alerts - Get alerts (PostgreSQL)
fastify.get("/api/v1/alerts", async (req) => {
  try {
    const { severity, unread } = req.query;
    const filters = { dismissed: false };

    if (severity) filters.severity = severity;
    if (unread === "true") filters.read = false;

    const alerts = await AlertRepository.getAll(filters);
    const unreadCount = await AlertRepository.getUnreadCount();
    const grouped = await AlertRepository.getGroupedByType();

    // Build summary from grouped data
    const summary = {
      total: alerts.length,
      unread: unreadCount,
      critical: grouped.filter(g => g.severity === 'critical').reduce((sum, g) => sum + parseInt(g.count), 0),
      high: grouped.filter(g => g.severity === 'high').reduce((sum, g) => sum + parseInt(g.count), 0),
      medium: grouped.filter(g => g.severity === 'medium').reduce((sum, g) => sum + parseInt(g.count), 0),
      low: grouped.filter(g => g.severity === 'low').reduce((sum, g) => sum + parseInt(g.count), 0)
    };

    return { success: true, data: { alerts, summary } };
  } catch (error) {
    console.error('Get alerts error:', error);
    return { success: false, error: error.message };
  }
});

// POST /api/v1/alerts/:id/read - Mark alert as read (PostgreSQL)
fastify.post("/api/v1/alerts/:id/read", async (req) => {
  try {
    const { id } = req.params;
    const alert = await AlertRepository.markAsRead(id);
    if (!alert) {
      return { success: false, error: 'Alert not found' };
    }
    return { success: true, data: alert };
  } catch (error) {
    console.error('Mark alert read error:', error);
    return { success: false, error: error.message };
  }
});

// POST /api/v1/alerts/read-all - Mark all as read (PostgreSQL)
fastify.post("/api/v1/alerts/read-all", async () => {
  try {
    const count = await AlertRepository.markAllAsRead();
    return { success: true, data: { updated: count } };
  } catch (error) {
    console.error('Mark all alerts read error:', error);
    return { success: false, error: error.message };
  }
});

console.log("Automation engine loaded");

// Phase 6: Dashboard endpoints (PostgreSQL)

fastify.get('/api/v1/dashboard/stats', async (request, reply) => {
  try {
    const stats = await getDashboardStats();
    return stats;
  } catch (error) {
    console.error('Dashboard stats error:', error);
    reply.code(500).send({ error: error.message });
  }
});

fastify.get('/api/v1/dashboard/export', async (request, reply) => {
  try {
    const csv = await exportCSV();
    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', 'attachment; filename="listings-export.csv"');
    return csv;
  } catch (error) {
    console.error('Dashboard export error:', error);
    reply.code(500).send({ error: error.message });
  }
});

// Phase 7: AI Recommendations endpoints (PostgreSQL)

fastify.get('/api/v1/ai/recommendations/:sku', async (request, reply) => {
  try {
    const { sku } = request.params;
    const recommendations = await generateRecommendations(sku);
    return recommendations;
  } catch (error) {
    console.error('AI recommendations error:', error);
    return { error: error.message };
  }
});

fastify.get('/api/v1/ai/bulk-recommendations', async (request, reply) => {
  try {
    const limit = parseInt(request.query.limit) || 10;
    return await getBulkRecommendations(limit);
  } catch (error) {
    console.error('Bulk AI recommendations error:', error);
    return [];
  }
});

console.log("AI Recommendations loaded");

// Phase 5: Kanban Task Board endpoints (PostgreSQL)
fastify.get('/api/v1/tasks', async (request, reply) => {
  try {
    const tasks = await TaskRepository.getByStage();
    return tasks;
  } catch (error) {
    console.error('Get tasks error:', error);
    reply.code(500).send({ error: error.message });
  }
});

fastify.get('/api/v1/tasks/stats', async (request, reply) => {
  try {
    const stats = await TaskRepository.getStats();
    return stats;
  } catch (error) {
    console.error('Get task stats error:', error);
    reply.code(500).send({ error: error.message });
  }
});

fastify.get('/api/v1/tasks/types', async (request, reply) => {
  return TASK_TYPES;
});

fastify.post('/api/v1/tasks', async (request, reply) => {
  try {
    const task = await TaskRepository.create(request.body);
    return task;
  } catch (error) {
    console.error('Create task error:', error);
    reply.code(500).send({ error: error.message });
  }
});

fastify.patch('/api/v1/tasks/:id', async (request, reply) => {
  try {
    const taskId = request.params.id;
    const updated = await TaskRepository.update(taskId, request.body);
    if (!updated) {
      reply.code(404).send({ error: 'Task not found' });
      return;
    }
    return updated;
  } catch (error) {
    console.error('Update task error:', error);
    reply.code(500).send({ error: error.message });
  }
});

fastify.post('/api/v1/tasks/:id/move', async (request, reply) => {
  try {
    const taskId = request.params.id;
    const { stage, order } = request.body;
    const moved = await TaskRepository.moveToStage(taskId, stage);
    if (!moved) {
      reply.code(404).send({ error: 'Task not found' });
      return;
    }
    // Update order if provided
    if (order !== undefined) {
      await TaskRepository.update(taskId, { order });
    }
    return moved;
  } catch (error) {
    console.error('Move task error:', error);
    reply.code(500).send({ error: error.message });
  }
});

fastify.delete('/api/v1/tasks/:id', async (request, reply) => {
  try {
    const taskId = request.params.id;
    const deleted = await TaskRepository.remove(taskId);
    if (!deleted) {
      reply.code(404).send({ error: 'Task not found' });
      return;
    }
    return { success: true };
  } catch (error) {
    console.error('Delete task error:', error);
    reply.code(500).send({ error: error.message });
  }
});

fastify.post('/api/v1/tasks/generate', async (request, reply) => {
  try {
    const threshold = request.body?.threshold || 50;
    // Get listings with low scores from PostgreSQL
    const listings = await ListingRepository.getAll({ maxScore: threshold, status: 'active' });

    let created = 0;
    const tasks = [];
    for (const listing of listings) {
      // Check if task already exists for this listing
      const existingTasks = await TaskRepository.getAll({ listingId: listing.id, stage: 'backlog' });
      if (existingTasks.length === 0) {
        const task = await TaskRepository.create({
          listingId: listing.id,
          sku: listing.sku,
          asin: listing.asin,
          title: `Optimize: ${listing.title?.substring(0, 50) || listing.sku}`,
          description: `Listing score is ${listing.currentScore || 0}. Improve content, images, or keywords.`,
          taskType: 'optimization',
          priority: listing.currentScore < 30 ? 'high' : 'medium',
          stage: 'backlog',
          createdBy: 'system'
        });
        tasks.push(task);
        created++;
      }
    }
    return { created, tasks };
  } catch (error) {
    console.error('Generate tasks error:', error);
    reply.code(500).send({ error: error.message });
  }
});

console.log("Kanban tasks loaded");

// Phase 5: Templates endpoints
fastify.get('/api/v1/templates', async (request, reply) => {
  return getTemplates();
});

fastify.get('/api/v1/templates/:id', async (request, reply) => {
  const template = getTemplate(parseInt(request.params.id));
  if (!template) {
    reply.code(404).send({ error: 'Template not found' });
    return;
  }
  return template;
});

fastify.post('/api/v1/templates', async (request, reply) => {
  const { sku, name, description } = request.body;
  const template = createTemplateFromListing(sku, name, description);
  if (template.error) {
    reply.code(400).send(template);
    return;
  }
  return template;
});

fastify.delete('/api/v1/templates/:id', async (request, reply) => {
  const deleted = deleteTemplate(parseInt(request.params.id));
  if (!deleted) {
    reply.code(404).send({ error: 'Template not found' });
    return;
  }
  return { success: true };
});

fastify.post('/api/v1/templates/:id/apply', async (request, reply) => {
  const { sku } = request.body;
  const result = applyTemplate(parseInt(request.params.id), sku);
  if (result.error) {
    reply.code(400).send(result);
    return;
  }
  return result;
});

console.log("Templates loaded");

// Phase 5: Push to Amazon endpoints
fastify.get('/api/v1/changes', async (request, reply) => {
  const all = request.query.all === 'true';
  return all ? getAllChanges() : getPendingChanges();
});

fastify.post('/api/v1/changes/price', async (request, reply) => {
  const { sku, price, reason } = request.body;
  const result = queuePriceChange(sku, parseFloat(price), reason);
  if (result.error) {
    reply.code(400).send(result);
    return;
  }
  return result;
});

fastify.post('/api/v1/changes/listing', async (request, reply) => {
  const { sku, updates, reason } = request.body;
  const result = queueListingUpdate(sku, updates, reason);
  if (result.error) {
    reply.code(400).send(result);
    return;
  }
  return result;
});

fastify.delete('/api/v1/changes/:id', async (request, reply) => {
  const result = cancelChange(parseInt(request.params.id));
  if (result.error) {
    reply.code(400).send(result);
    return;
  }
  return result;
});

fastify.post('/api/v1/changes/submit', async (request, reply) => {
  const result = await submitPriceChanges();
  return result;
});

fastify.get('/api/v1/changes/feed/:feedId', async (request, reply) => {
  const result = await checkFeedStatus(request.params.feedId);
  return result;
});

console.log("Push to Amazon loaded");

// ============================================
// PHASE 4: BOM & COST MANAGEMENT
// ============================================

// Suppliers endpoints
fastify.get('/api/v1/suppliers', async () => {
  return { success: true, data: getSuppliers() };
});

fastify.get('/api/v1/suppliers/:id', async (request) => {
  const supplier = getSupplier(request.params.id);
  if (!supplier) return { success: false, error: 'Supplier not found' };
  return { success: true, data: supplier };
});

fastify.post('/api/v1/suppliers', async (request) => {
  const supplier = createSupplier(request.body);
  return { success: true, data: supplier };
});

fastify.patch('/api/v1/suppliers/:id', async (request, reply) => {
  const updated = updateSupplier(request.params.id, request.body);
  if (!updated) {
    reply.code(404).send({ success: false, error: 'Supplier not found' });
    return;
  }
  return { success: true, data: updated };
});

fastify.delete('/api/v1/suppliers/:id', async (request, reply) => {
  const deleted = deleteSupplier(request.params.id);
  if (!deleted) {
    reply.code(404).send({ success: false, error: 'Supplier not found' });
    return;
  }
  return { success: true };
});

// Components endpoints
fastify.get('/api/v1/components', async () => {
  return { success: true, data: getComponents() };
});

fastify.get('/api/v1/components/:id', async (request) => {
  const component = getComponent(request.params.id);
  if (!component) return { success: false, error: 'Component not found' };
  return { success: true, data: component };
});

fastify.post('/api/v1/components', async (request) => {
  const component = createComponent(request.body);
  return { success: true, data: component };
});

fastify.patch('/api/v1/components/:id', async (request, reply) => {
  const updated = updateComponent(request.params.id, request.body);
  if (!updated) {
    reply.code(404).send({ success: false, error: 'Component not found' });
    return;
  }
  return { success: true, data: updated };
});

fastify.delete('/api/v1/components/:id', async (request, reply) => {
  const deleted = deleteComponent(request.params.id);
  if (!deleted) {
    reply.code(404).send({ success: false, error: 'Component not found' });
    return;
  }
  return { success: true };
});

// BOM endpoints
fastify.get('/api/v1/bom/:sku', async (request) => {
  const bom = getBOM(request.params.sku);
  const landedCost = calculateLandedCost(request.params.sku);
  return { success: true, data: { bom, landedCost } };
});

fastify.get('/api/v1/bom', async () => {
  return { success: true, data: getAllBOMs() };
});

fastify.post('/api/v1/bom/:sku', async (request) => {
  const bom = saveBOM(request.params.sku, request.body);
  const landedCost = calculateLandedCost(request.params.sku);
  return { success: true, data: { bom, landedCost } };
});

fastify.post('/api/v1/bom/:sku/component', async (request) => {
  const { componentId, quantity } = request.body;
  const bom = addComponentToBOM(request.params.sku, componentId, quantity);
  const landedCost = calculateLandedCost(request.params.sku);
  return { success: true, data: { bom, landedCost } };
});

fastify.delete('/api/v1/bom/:sku/component/:componentId', async (request) => {
  const bom = removeComponentFromBOM(request.params.sku, request.params.componentId);
  const landedCost = calculateLandedCost(request.params.sku);
  return { success: true, data: { bom, landedCost } };
});

fastify.get('/api/v1/bom/:sku/margin', async (request) => {
  const listings = loadListings();
  const listing = listings.items.find(l => l.sku === request.params.sku);
  if (!listing) return { success: false, error: 'Listing not found' };

  const fbaFees = 0; // FBM seller
  const shippingCost = parseFloat(request.query.shipping) || 0;
  const margin = calculateMargin(request.params.sku, listing.price, fbaFees, shippingCost);
  return { success: true, data: margin };
});

fastify.get('/api/v1/bom/analysis', async () => {
  return { success: true, data: getBulkCostAnalysis() };
});

fastify.get('/api/v1/components/:id/compare', async (request) => {
  const comparison = compareSupplierPrices(request.params.id);
  if (!comparison) return { success: false, error: 'Component not found' };
  return { success: true, data: comparison };
});

// Bulk import BOM data from CSV/XLSX
fastify.post('/api/v1/bom/import', async (request) => {
  try {
    const { rows } = request.body;
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return { success: false, error: 'No valid rows provided' };
    }
    const result = importBOMData(rows);
    return { success: true, data: result };
  } catch (error) {
    console.error('BOM import error:', error);
    return { success: false, error: error.message };
  }
});

console.log("BOM & Cost Management loaded");

// ============================================
// PHASE 6: PERFORMANCE METRICS & ATTRIBUTION
// ============================================

fastify.post('/api/v1/metrics/:sku', async (request) => {
  const record = recordMetrics(request.params.sku, request.body);
  return { success: true, data: record };
});

fastify.get('/api/v1/metrics/:sku', async (request) => {
  const days = parseInt(request.query.days) || 30;
  const metrics = getMetrics(request.params.sku, days);
  const summary = getMetricsSummary(request.params.sku, days);
  return { success: true, data: { metrics, summary } };
});

fastify.get('/api/v1/metrics/:sku/trend', async (request) => {
  const trend = getScoreTrend(request.params.sku);
  return { success: true, data: trend };
});

fastify.post('/api/v1/metrics/:sku/score', async (request) => {
  const { score, breakdown } = request.body;
  const record = recordScore(request.params.sku, score, breakdown);
  return { success: true, data: record };
});

fastify.get('/api/v1/metrics/:sku/score-history', async (request) => {
  try {
    const days = parseInt(request.query.days) || 30;
    const history = await getScoreHistory(request.params.sku, days);
    return { success: true, data: history };
  } catch (error) {
    console.error('Get score history error:', error);
    return { success: false, error: error.message };
  }
});

// Attribution endpoints
fastify.post('/api/v1/attribution/change', async (request) => {
  const { sku, changeType, before, after, source } = request.body;
  const event = recordChange(sku, changeType, before, after, source);
  return { success: true, data: event };
});

fastify.get('/api/v1/attribution/changes', async (request) => {
  const sku = request.query.sku;
  const limit = parseInt(request.query.limit) || 50;
  const changes = getAttributionChanges(sku, limit);
  return { success: true, data: changes };
});

fastify.get('/api/v1/attribution/:changeId/analyze', async (request) => {
  const result = analyzeChangeImpact(request.params.changeId);
  if (!result) return { success: false, error: 'Change not found' };
  return { success: true, data: result };
});

fastify.get('/api/v1/attribution/cannibalization', async () => {
  const listings = loadListings();
  const results = detectCannibalization(listings.items);
  return { success: true, data: results };
});

fastify.get('/api/v1/portfolio/metrics', async () => {
  const listings = loadListings();
  const skus = listings.items.map(l => l.sku);
  const metrics = getPortfolioMetrics(skus);
  return { success: true, data: metrics };
});

console.log("Performance Metrics & Attribution loaded");

// ============================================
// PHASE 6: OPPORTUNITY SCORING
// ============================================

fastify.get('/api/v1/opportunities', async () => {
  const listings = loadListings();
  const scores = loadScores();

  let keepa = {};
  try {
    const f = DATA_DIR + "/keepa.json";
    if (fs.existsSync(f)) keepa = JSON.parse(fs.readFileSync(f, "utf8")).data || {};
  } catch (e) {}

  const opportunities = analyzeOpportunities(listings.items, scores, keepa);
  const summary = getOpportunitySummary(opportunities);

  return { success: true, data: { opportunities, summary } };
});

fastify.get('/api/v1/opportunities/quick-wins', async () => {
  const listings = loadListings();
  const scores = loadScores();

  let keepa = {};
  try {
    const f = DATA_DIR + "/keepa.json";
    if (fs.existsSync(f)) keepa = JSON.parse(fs.readFileSync(f, "utf8")).data || {};
  } catch (e) {}

  const opportunities = analyzeOpportunities(listings.items, scores, keepa);
  const quickWins = getQuickWins(opportunities, 15);

  return { success: true, data: quickWins };
});

fastify.get('/api/v1/opportunities/bundles', async () => {
  const listings = loadListings();
  const bundles = findBundleOpportunities(listings.items);
  return { success: true, data: bundles };
});

fastify.get('/api/v1/opportunities/seasonal', async () => {
  const listings = loadListings();
  const month = parseInt(new Date().getMonth());
  const seasonal = getSeasonalOpportunities(listings.items, month);
  return { success: true, data: seasonal };
});

console.log("Opportunity Scoring loaded");

// ============================================
// PHASE 6: DEMAND FORECASTING
// ============================================

fastify.post('/api/v1/sales/:sku', async (request) => {
  const record = recordSales(request.params.sku, request.body);
  return { success: true, data: record };
});

fastify.get('/api/v1/sales/:sku', async (request) => {
  const days = parseInt(request.query.days) || 90;
  const history = getSalesHistory(request.params.sku, days);
  return { success: true, data: history };
});

fastify.get('/api/v1/forecast/:sku', async (request) => {
  const days = parseInt(request.query.days) || 30;
  const forecast = forecastDemand(request.params.sku, days);
  return { success: true, data: forecast };
});

fastify.get('/api/v1/forecast/:sku/restock', async (request) => {
  const currentStock = parseInt(request.query.stock) || 0;
  const leadTime = parseInt(request.query.leadTime) || 7;
  const safetyDays = parseInt(request.query.safety) || 7;
  const recommendation = getRestockRecommendation(request.params.sku, currentStock, leadTime, safetyDays);
  return { success: true, data: recommendation };
});

fastify.get('/api/v1/forecast/:sku/seasonality', async (request) => {
  const seasonality = detectSeasonality(request.params.sku);
  return { success: true, data: seasonality };
});

fastify.get('/api/v1/forecast/bulk', async () => {
  const listings = loadListings();
  const skus = listings.items.map(l => l.sku);
  const days = 30;
  const results = bulkForecast(skus, days);
  return { success: true, data: results };
});

console.log("Demand Forecasting loaded");

// ============================================
// PHASE 7: CUSTOMIZABLE DASHBOARD WIDGETS
// ============================================

fastify.get('/api/v1/widgets/types', async () => {
  return { success: true, data: WIDGET_TYPES };
});

fastify.get('/api/v1/widgets/layouts', async () => {
  return { success: true, data: getLayouts() };
});

fastify.get('/api/v1/widgets/layout/active', async () => {
  return { success: true, data: getActiveLayout() };
});

fastify.post('/api/v1/widgets/layout', async (request) => {
  const { name, layout } = request.body;
  const result = saveLayout(name, layout);
  return { success: true, data: result };
});

fastify.post('/api/v1/widgets/layout/active', async (request) => {
  const { name } = request.body;
  const result = setActiveLayout(name);
  if (result.error) return { success: false, error: result.error };
  return { success: true, data: result };
});

fastify.delete('/api/v1/widgets/layout/:name', async (request, reply) => {
  const result = deleteLayout(request.params.name);
  if (result.error) {
    reply.code(400).send({ success: false, error: result.error });
    return;
  }
  return { success: true, data: result };
});

fastify.post('/api/v1/widgets/layout/reset', async () => {
  return { success: true, data: resetToDefault() };
});

fastify.get('/api/v1/widgets/config', async () => {
  return { success: true, data: getWidgetConfig() };
});

fastify.patch('/api/v1/widgets/:widgetId/config', async (request) => {
  const result = updateWidgetConfig(request.params.widgetId, request.body);
  return { success: true, data: result };
});

fastify.post('/api/v1/widgets/:widgetId/toggle', async (request) => {
  const { enabled } = request.body;
  const result = toggleWidget(request.params.widgetId, enabled);
  return { success: true, data: result };
});

fastify.get('/api/v1/widgets/:widgetId/data', async (request) => {
  const listings = loadListings();
  const scores = loadScores();
  const costs = loadCosts();

  let alerts = [];
  try {
    const f = DATA_DIR + '/alerts.json';
    if (fs.existsSync(f)) alerts = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {}

  let tasks = [];
  try {
    const f = DATA_DIR + '/tasks.json';
    if (fs.existsSync(f)) tasks = JSON.parse(fs.readFileSync(f, 'utf8')).tasks || [];
  } catch (e) {}

  let keepa = {};
  try {
    const f = DATA_DIR + '/keepa.json';
    if (fs.existsSync(f)) keepa = JSON.parse(fs.readFileSync(f, 'utf8')).data || {};
  } catch (e) {}

  const dependencies = { listings, scores, costs, alerts, tasks, keepa, opportunities: [] };
  const data = getWidgetData(request.params.widgetId, dependencies);

  return { success: true, data };
});

console.log("Dashboard Widgets loaded");

// ============================================
// PHASE 7: ADVANCED AUTOMATION
// ============================================

fastify.get('/api/v1/automation/advanced/triggers', async () => {
  return { success: true, data: TRIGGER_TYPES };
});

fastify.get('/api/v1/automation/advanced/actions', async () => {
  return { success: true, data: ACTION_TYPES };
});

fastify.get('/api/v1/automation/advanced/rules', async () => {
  return { success: true, data: getAdvancedRules() };
});

fastify.get('/api/v1/automation/advanced/rules/:id', async (request) => {
  const rule = getAdvancedRule(request.params.id);
  if (!rule) return { success: false, error: 'Rule not found' };
  return { success: true, data: rule };
});

fastify.post('/api/v1/automation/advanced/rules', async (request) => {
  const rule = createAdvancedRule(request.body);
  return { success: true, data: rule };
});

fastify.patch('/api/v1/automation/advanced/rules/:id', async (request, reply) => {
  const rule = updateAdvancedRule(request.params.id, request.body);
  if (!rule) {
    reply.code(404).send({ success: false, error: 'Rule not found' });
    return;
  }
  return { success: true, data: rule };
});

fastify.delete('/api/v1/automation/advanced/rules/:id', async (request, reply) => {
  const deleted = deleteAdvancedRule(request.params.id);
  if (!deleted) {
    reply.code(404).send({ success: false, error: 'Rule not found' });
    return;
  }
  return { success: true };
});

// Webhooks
fastify.get('/api/v1/webhooks', async () => {
  return { success: true, data: getWebhooks() };
});

fastify.get('/api/v1/webhooks/:id', async (request) => {
  const webhook = getWebhook(request.params.id);
  if (!webhook) return { success: false, error: 'Webhook not found' };
  return { success: true, data: webhook };
});

fastify.post('/api/v1/webhooks', async (request) => {
  const webhook = createWebhook(request.body);
  return { success: true, data: webhook };
});

fastify.patch('/api/v1/webhooks/:id', async (request, reply) => {
  const webhook = updateWebhook(request.params.id, request.body);
  if (!webhook) {
    reply.code(404).send({ success: false, error: 'Webhook not found' });
    return;
  }
  return { success: true, data: webhook };
});

fastify.delete('/api/v1/webhooks/:id', async (request, reply) => {
  const deleted = deleteWebhook(request.params.id);
  if (!deleted) {
    reply.code(404).send({ success: false, error: 'Webhook not found' });
    return;
  }
  return { success: true };
});

fastify.post('/api/v1/webhooks/:id/test', async (request) => {
  const result = await testWebhook(request.params.id);
  return { success: result.success, data: result };
});

// Scheduled Tasks
fastify.get('/api/v1/automation/scheduled', async () => {
  return { success: true, data: getScheduledTasks() };
});

fastify.post('/api/v1/automation/scheduled', async (request) => {
  const task = createScheduledTask(request.body);
  return { success: true, data: task };
});

fastify.patch('/api/v1/automation/scheduled/:id', async (request, reply) => {
  const task = updateScheduledTask(request.params.id, request.body);
  if (!task) {
    reply.code(404).send({ success: false, error: 'Scheduled task not found' });
    return;
  }
  return { success: true, data: task };
});

fastify.delete('/api/v1/automation/scheduled/:id', async (request, reply) => {
  const deleted = deleteScheduledTask(request.params.id);
  if (!deleted) {
    reply.code(404).send({ success: false, error: 'Scheduled task not found' });
    return;
  }
  return { success: true };
});

fastify.get('/api/v1/automation/logs', async (request) => {
  const limit = parseInt(request.query.limit) || 100;
  return { success: true, data: getExecutionLogs(limit) };
});

console.log("Advanced Automation loaded");

// ============================================
// PHASE 7: REPORTING SYSTEM
// ============================================

fastify.get('/api/v1/reports/templates', async () => {
  return { success: true, data: REPORT_TEMPLATES };
});

fastify.post('/api/v1/reports/generate', async (request) => {
  const { template, format, filters } = request.body;
  const report = generateReport(template, { format, filters });
  if (report.error) return { success: false, error: report.error };
  return { success: true, data: report };
});

fastify.get('/api/v1/reports/generate/:template', async (request) => {
  const format = request.query.format || 'json';
  const report = generateReport(request.params.template, { format });
  if (report.error) return { success: false, error: report.error };

  // For CSV/HTML, return as downloadable content
  if (format === 'csv') {
    return { success: true, data: report, content: report.content, contentType: 'text/csv' };
  } else if (format === 'html') {
    return { success: true, data: report, content: report.content, contentType: 'text/html' };
  }

  return { success: true, data: report };
});

fastify.get('/api/v1/reports/history', async (request) => {
  const limit = parseInt(request.query.limit) || 20;
  return { success: true, data: getReportHistory(limit) };
});

// Scheduled Reports
fastify.get('/api/v1/reports/scheduled', async () => {
  return { success: true, data: getScheduledReports() };
});

fastify.post('/api/v1/reports/scheduled', async (request) => {
  const scheduled = createScheduledReport(request.body);
  return { success: true, data: scheduled };
});

fastify.patch('/api/v1/reports/scheduled/:id', async (request, reply) => {
  const scheduled = updateScheduledReport(request.params.id, request.body);
  if (!scheduled) {
    reply.code(404).send({ success: false, error: 'Scheduled report not found' });
    return;
  }
  return { success: true, data: scheduled };
});

fastify.delete('/api/v1/reports/scheduled/:id', async (request, reply) => {
  const deleted = deleteScheduledReport(request.params.id);
  if (!deleted) {
    reply.code(404).send({ success: false, error: 'Scheduled report not found' });
    return;
  }
  return { success: true };
});

console.log("Reporting System loaded");

// ============ ENHANCED SCORING ENDPOINTS (PostgreSQL) ============

// Get score history for a SKU
fastify.get('/api/v1/scores/:sku/history', async (request) => {
  try {
    const { sku } = request.params;
    const days = parseInt(request.query.days) || 30;
    const history = await getScoreHistory(sku, days);
    return { success: true, data: history };
  } catch (error) {
    console.error('Get score history error:', error);
    return { success: false, error: error.message };
  }
});

// Get score trends for a SKU
fastify.get('/api/v1/scores/:sku/trends', async (request) => {
  try {
    const { sku } = request.params;
    const trends = await getScoreTrends(sku);
    return { success: true, data: trends };
  } catch (error) {
    console.error('Get score trends error:', error);
    return { success: false, error: error.message };
  }
});

// Get compliance check for a listing (PostgreSQL)
fastify.get('/api/v1/scores/:sku/compliance', async (request, reply) => {
  try {
    const { sku } = request.params;
    const listing = await ListingRepository.getBySku(sku);

    if (!listing) {
      reply.code(404).send({ success: false, error: 'Listing not found' });
      return;
    }

    const compliance = calculateComplianceScore(listing);
    return { success: true, data: compliance };
  } catch (error) {
    console.error('Get compliance error:', error);
    return { success: false, error: error.message };
  }
});

// Get competitive analysis for a listing (PostgreSQL)
fastify.get('/api/v1/scores/:sku/competitive', async (request, reply) => {
  try {
    const { sku } = request.params;
    const listing = await ListingRepository.getBySku(sku);

    if (!listing) {
      reply.code(404).send({ success: false, error: 'Listing not found' });
      return;
    }

    // Load Keepa data from PostgreSQL
    const keepaData = listing.asin ? await KeepaRepository.getByAsin(listing.asin) : null;

    const competitive = calculateCompetitiveScore(listing, keepaData);
    return { success: true, data: competitive };
  } catch (error) {
    console.error('Get competitive error:', error);
    return { success: false, error: error.message };
  }
});

// Get blocked/warning terms reference
fastify.get('/api/v1/scores/compliance-terms', async () => {
  return {
    success: true,
    data: {
      blocked: BLOCKED_TERMS,
      warnings: WARNING_TERMS
    }
  };
});

// Bulk score history (for dashboard charts) (PostgreSQL)
fastify.get('/api/v1/scores/history/bulk', async (request) => {
  try {
    const listings = await ListingRepository.getAll({ limit: parseInt(request.query.limit) || 20 });
    const days = parseInt(request.query.days) || 14;

    const historyData = {};

    for (const listing of listings) {
      const history = await getScoreHistory(listing.sku, days);
      if (history.length > 0) {
        historyData[listing.sku] = {
          title: listing.title,
          history
        };
      }
    }

    return { success: true, data: historyData };
  } catch (error) {
    console.error('Bulk score history error:', error);
    return { success: false, error: error.message };
  }
});

// Get listings with compliance issues (PostgreSQL)
fastify.get('/api/v1/scores/compliance-issues', async () => {
  try {
    const listings = await ListingRepository.getAll();
    const issues = [];

    for (const listing of listings) {
      const compliance = calculateComplianceScore(listing);
      if (compliance.violations && compliance.violations.length > 0) {
        issues.push({
          sku: listing.sku,
          asin: listing.asin,
          title: listing.title,
          score: compliance.score,
          violations: compliance.violations
        });
      }
    }

    // Sort by most violations first
    issues.sort((a, b) => b.violations.length - a.violations.length);

    return { success: true, data: issues };
  } catch (error) {
    console.error('Compliance issues error:', error);
    return { success: false, error: error.message };
  }
});

// Get score summary with all 5 components (PostgreSQL)
fastify.get('/api/v1/scores/summary', async () => {
  try {
    const listings = await ListingRepository.getAll();
    const scoreStats = await ScoreRepository.getStatistics();
    const distribution = await ScoreRepository.getDistribution();

    // Build distribution from PostgreSQL
    const distributionMap = {};
    for (const d of distribution) {
      distributionMap[d.bucket] = parseInt(d.count);
    }

    const summary = {
      totalListings: listings.length,
      scoredListings: parseInt(scoreStats?.total_scored) || 0,
      averageScore: Math.round(parseFloat(scoreStats?.avg_score) || 0),
      componentAverages: {
        seo: Math.round(parseFloat(scoreStats?.avg_seo) || 0),
        content: Math.round(parseFloat(scoreStats?.avg_content) || 0),
        images: Math.round(parseFloat(scoreStats?.avg_images) || 0),
        competitive: Math.round(parseFloat(scoreStats?.avg_competitive) || 0),
        compliance: Math.round(parseFloat(scoreStats?.avg_compliance) || 0)
      },
      distribution: {
        excellent: distributionMap.excellent || 0,
        good: distributionMap.good || 0,
        average: distributionMap.fair || 0,
        poor: distributionMap.poor || 0
      },
      complianceIssues: 0 // Would need a separate query for this
    };

    return { success: true, data: summary };
  } catch (error) {
    console.error('Score summary error:', error);
    return { success: false, error: error.message };
  }
});

console.log("Enhanced Scoring System loaded (Compliance, Competitive, History)");

// ============ LISTING GENERATOR / RECOMMENDATIONS ============

// Generate recommendation from a single ASIN
fastify.get('/api/v1/generator/asin/:asin', async (request, reply) => {
  try {
    // Rate limit: 30 requests per minute for generator endpoints
    const clientIP = request.ip || 'unknown';
    if (!rateLimit(`gen-asin-${clientIP}`, 30, 60000)) {
      reply.code(429).send({ success: false, error: 'Rate limit exceeded. Please wait before trying again.' });
      return;
    }

    const asin = sanitizeASIN(request.params.asin);
    if (!asin || asin.length !== 10) {
      reply.code(400).send({ success: false, error: 'Invalid ASIN format' });
      return;
    }

    const result = await generateFromASIN(asin);

    // Check if result has error
    if (result.error) {
      reply.code(400).send({ success: false, error: result.error });
      return;
    }

    return { success: true, data: result };
  } catch (e) {
    console.error('Generator ASIN error:', e);
    reply.code(500).send({ success: false, error: e.message });
  }
});

// Generate recommendations from multiple ASINs (comparison)
fastify.post('/api/v1/generator/compare', async (request, reply) => {
  try {
    // Rate limit
    const clientIP = request.ip || 'unknown';
    if (!rateLimit(`gen-compare-${clientIP}`, 20, 60000)) {
      reply.code(429).send({ success: false, error: 'Rate limit exceeded. Please wait before trying again.' });
      return;
    }

    const { asins } = request.body;
    if (!asins || !Array.isArray(asins) || asins.length === 0) {
      reply.code(400).send({ success: false, error: 'Provide an array of ASINs' });
      return;
    }
    if (asins.length > 10) {
      reply.code(400).send({ success: false, error: 'Maximum 10 ASINs at once' });
      return;
    }
    if (asins.length < 2) {
      reply.code(400).send({ success: false, error: 'Provide at least 2 ASINs to compare' });
      return;
    }

    // Sanitize all ASINs
    const sanitizedASINs = asins.map(a => sanitizeASIN(a)).filter(a => a.length === 10);
    if (sanitizedASINs.length < 2) {
      reply.code(400).send({ success: false, error: 'At least 2 valid ASINs required' });
      return;
    }

    const result = await compareASINs(sanitizedASINs);
    return { success: true, data: result };
  } catch (e) {
    console.error('Generator compare error:', e);
    reply.code(500).send({ success: false, error: e.message });
  }
});

// Generate listing from components/product details
fastify.post('/api/v1/generator/components', async (request, reply) => {
  try {
    // Rate limit
    const clientIP = request.ip || 'unknown';
    if (!rateLimit(`gen-components-${clientIP}`, 30, 60000)) {
      reply.code(429).send({ success: false, error: 'Rate limit exceeded. Please wait before trying again.' });
      return;
    }

    const components = request.body;
    // Accept either 'name' or 'productName'
    if (!components || (!components.productName && !components.name)) {
      reply.code(400).send({ success: false, error: 'Provide product details including name or productName' });
      return;
    }

    // Sanitize input fields
    const sanitizedComponents = {
      ...components,
      name: sanitizeString(components.name, 200),
      productName: sanitizeString(components.productName, 200),
      brand: sanitizeString(components.brand, 100),
      category: sanitizeString(components.category, 50),
      material: sanitizeString(components.material, 100),
      quantity: sanitizeString(components.quantity, 20),
      size: sanitizeString(components.size, 50),
      features: Array.isArray(components.features)
        ? components.features.slice(0, 10).map(f => sanitizeString(f, 200))
        : []
    };

    const result = generateFromComponents(sanitizedComponents);
    return { success: true, data: result };
  } catch (e) {
    console.error('Generator components error:', e);
    reply.code(500).send({ success: false, error: e.message });
  }
});

// Get category keywords reference
fastify.get('/api/v1/generator/keywords', async () => {
  return { success: true, data: CATEGORY_KEYWORDS };
});

// Save a generated listing
fastify.post('/api/v1/generator/save', async (request) => {
  const data = request.body;
  const id = saveGeneratedListing(data);
  return { success: true, data: { id } };
});

// Get saved listings
fastify.get('/api/v1/generator/saved', async () => {
  const listings = getSavedListings();
  return { success: true, data: listings };
});

// Delete a saved listing
fastify.delete('/api/v1/generator/saved/:id', async (request, reply) => {
  const { id } = request.params;
  const deleted = deleteSavedListing(id);
  if (!deleted) {
    reply.code(404).send({ success: false, error: 'Not found' });
    return;
  }
  return { success: true };
});

// Quick recommendation from existing SKU (uses our scoring data)
fastify.get('/api/v1/generator/sku/:sku', async (request, reply) => {
  const { sku } = request.params;
  const listings = loadListings();
  const listing = listings.items.find(l => l.sku === sku);

  if (!listing) {
    reply.code(404).send({ success: false, error: 'SKU not found' });
    return;
  }

  // Get ASIN-based recommendation
  const result = await generateFromASIN(listing.asin);

  // Add score data
  const scores = loadScores();
  result.scoreData = scores[sku] || null;

  return { success: true, data: result };
});

console.log("Listing Generator loaded");

// ============================================
// A+ CONTENT GENERATOR
// ============================================

// Get A+ module types reference
fastify.get('/api/v1/aplus/modules', async () => {
  return { success: true, data: MODULE_TYPES };
});

// Get A+ templates reference
fastify.get('/api/v1/aplus/templates', async () => {
  return { success: true, data: APLUS_TEMPLATES };
});

// Generate A+ content for a SKU
fastify.post('/api/v1/aplus/generate/:sku', async (request, reply) => {
  try {
    // Rate limit
    const clientIP = request.ip || 'unknown';
    if (!rateLimit(`aplus-gen-${clientIP}`, 20, 60000)) {
      reply.code(429).send({ success: false, error: 'Rate limit exceeded. Please wait before trying again.' });
      return;
    }

    const { sku } = request.params;
    const listings = loadListings();
    const listing = listings.items.find(l => l.sku === sku);

    if (!listing) {
      reply.code(404).send({ success: false, error: 'SKU not found' });
      return;
    }

    // Get optional template override and custom data
    const { template, customData } = request.body || {};

    // Merge listing data with any custom data
    const productData = {
      ...listing,
      ...customData
    };

    const result = generateAPlusContent(productData, template);
    return { success: true, data: result };
  } catch (e) {
    console.error('A+ generate error:', e);
    reply.code(500).send({ success: false, error: e.message });
  }
});

// Generate A+ content from custom product data (without existing listing)
fastify.post('/api/v1/aplus/generate', async (request, reply) => {
  try {
    // Rate limit
    const clientIP = request.ip || 'unknown';
    if (!rateLimit(`aplus-gen-custom-${clientIP}`, 20, 60000)) {
      reply.code(429).send({ success: false, error: 'Rate limit exceeded. Please wait before trying again.' });
      return;
    }

    const { productData, template } = request.body || {};

    if (!productData || !productData.title) {
      reply.code(400).send({ success: false, error: 'Product data with title is required' });
      return;
    }

    const result = generateAPlusContent(productData, template);
    return { success: true, data: result };
  } catch (e) {
    console.error('A+ generate custom error:', e);
    reply.code(500).send({ success: false, error: e.message });
  }
});

// Save A+ content
fastify.post('/api/v1/aplus/:sku', async (request, reply) => {
  try {
    const { sku } = request.params;
    const aplusData = request.body;

    if (!aplusData || !aplusData.modules) {
      reply.code(400).send({ success: false, error: 'A+ content data with modules is required' });
      return;
    }

    const result = saveAPlusContent(sku, aplusData);
    return { success: true, data: result };
  } catch (e) {
    console.error('A+ save error:', e);
    reply.code(500).send({ success: false, error: e.message });
  }
});

// Get A+ content for a SKU
fastify.get('/api/v1/aplus/:sku', async (request) => {
  const { sku } = request.params;
  const content = getAPlusContent(sku);

  if (!content) {
    return { success: true, data: null };
  }

  return { success: true, data: content };
});

// Get all A+ content
fastify.get('/api/v1/aplus', async () => {
  const all = getAllAPlusContent();
  return { success: true, data: all };
});

// Delete A+ content for a SKU
fastify.delete('/api/v1/aplus/:sku', async (request, reply) => {
  const { sku } = request.params;
  const deleted = deleteAPlusContent(sku);

  if (!deleted) {
    reply.code(404).send({ success: false, error: 'A+ content not found' });
    return;
  }

  return { success: true };
});

// Update A+ content status
fastify.patch('/api/v1/aplus/:sku/status', async (request, reply) => {
  const { sku } = request.params;
  const { status } = request.body;

  if (!status) {
    reply.code(400).send({ success: false, error: 'Status is required' });
    return;
  }

  const validStatuses = ['draft', 'pending', 'approved', 'published', 'rejected'];
  if (!validStatuses.includes(status)) {
    reply.code(400).send({ success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    return;
  }

  const updated = updateAPlusStatus(sku, status);
  if (!updated) {
    reply.code(404).send({ success: false, error: 'A+ content not found' });
    return;
  }

  return { success: true, data: updated };
});

// Generate HTML preview
fastify.get('/api/v1/aplus/:sku/preview', async (request, reply) => {
  const { sku } = request.params;
  const content = getAPlusContent(sku);

  if (!content) {
    reply.code(404).send({ success: false, error: 'A+ content not found' });
    return;
  }

  const html = generateHTMLPreview(content);
  return { success: true, data: { html, sku, status: content.status } };
});

// Generate HTML preview from provided data (without saving)
fastify.post('/api/v1/aplus/preview', async (request) => {
  const aplusData = request.body;

  if (!aplusData || !aplusData.modules) {
    return { success: false, error: 'A+ content data with modules is required' };
  }

  const html = generateHTMLPreview(aplusData);
  return { success: true, data: { html } };
});

console.log("A+ Content Generator loaded");

// ============================================
// COMPETITOR INTELLIGENCE DASHBOARD
// ============================================

// Track a competitor for an ASIN
fastify.post('/api/v1/competitors/:asin', async (request, reply) => {
  try {
    const { asin } = request.params;
    const competitorData = request.body;

    if (!competitorData || !competitorData.sellerName) {
      reply.code(400).send({ success: false, error: 'Competitor data with sellerName is required' });
      return;
    }

    const result = trackCompetitor(asin, competitorData);
    return { success: true, data: result };
  } catch (e) {
    console.error('Track competitor error:', e);
    reply.code(500).send({ success: false, error: e.message });
  }
});

// Remove a tracked competitor
fastify.delete('/api/v1/competitors/:asin/:competitorId', async (request, reply) => {
  const { asin, competitorId } = request.params;
  const deleted = untrackCompetitor(asin, competitorId);

  if (!deleted) {
    reply.code(404).send({ success: false, error: 'Competitor not found' });
    return;
  }

  return { success: true };
});

// Get tracked competitors for an ASIN
fastify.get('/api/v1/competitors/:asin', async (request) => {
  const { asin } = request.params;
  const competitors = getTrackedCompetitors(asin);
  return { success: true, data: competitors };
});

// Get all tracked competitors
fastify.get('/api/v1/competitors', async () => {
  const competitors = getAllTrackedCompetitors();
  return { success: true, data: competitors };
});

// Record competitor price point
fastify.post('/api/v1/competitors/:asin/:competitorId/price', async (request, reply) => {
  try {
    const { asin, competitorId } = request.params;
    const { price } = request.body;

    if (price === undefined || price === null) {
      reply.code(400).send({ success: false, error: 'Price is required' });
      return;
    }

    const history = recordCompetitorPrice(asin, competitorId, price);
    return { success: true, data: history };
  } catch (e) {
    console.error('Record competitor price error:', e);
    reply.code(500).send({ success: false, error: e.message });
  }
});

// Get competitor price history
fastify.get('/api/v1/competitors/:asin/:competitorId/history', async (request) => {
  const { asin, competitorId } = request.params;
  const days = parseInt(request.query.days) || 30;
  const history = getCompetitorPriceHistory(asin, competitorId, days);
  return { success: true, data: history };
});

// Analyze price trends for an ASIN
fastify.get('/api/v1/competitors/:asin/trends', async (request) => {
  const { asin } = request.params;
  const days = parseInt(request.query.days) || 30;
  const analysis = analyzePriceTrends(asin, days);
  return { success: true, data: analysis };
});

// Calculate Buy Box win rate for an ASIN
fastify.get('/api/v1/buybox/:asin', async (request) => {
  const { asin } = request.params;
  const price = parseFloat(request.query.price) || 0;
  const isFBA = request.query.fba === 'true';

  if (!price) {
    // Get price from listing
    const listings = loadListings();
    const listing = listings.items.find(l => l.asin === asin);
    if (listing) {
      const analysis = calculateBuyBoxWinRate(asin, listing.price, false);
      return { success: true, data: analysis };
    }
    return { success: false, error: 'Price required or listing not found' };
  }

  const analysis = calculateBuyBoxWinRate(asin, price, isFBA);
  return { success: true, data: analysis };
});

// Get bulk Buy Box analysis for all listings
fastify.get('/api/v1/buybox', async () => {
  const analysis = getBulkBuyBoxAnalysis();
  return { success: true, data: analysis };
});

// Analyze market gaps
fastify.get('/api/v1/market/gaps', async (request) => {
  const category = request.query.category || null;
  const analysis = analyzeMarketGaps(category);
  return { success: true, data: analysis };
});

// Get competitor position summary
fastify.get('/api/v1/market/positions', async () => {
  const summary = getCompetitorPositionSummary();
  return { success: true, data: summary };
});

// Generate full competitive intelligence report
fastify.get('/api/v1/market/report', async () => {
  const report = generateCompetitiveReport();
  return { success: true, data: report };
});

// Quick competitive overview for a SKU
fastify.get('/api/v1/competitive/:sku', async (request, reply) => {
  const { sku } = request.params;
  const listings = loadListings();
  const listing = listings.items.find(l => l.sku === sku);

  if (!listing) {
    reply.code(404).send({ success: false, error: 'SKU not found' });
    return;
  }

  // Get Buy Box analysis
  const buyBoxAnalysis = calculateBuyBoxWinRate(listing.asin, listing.price, false);

  // Get tracked competitors
  const trackedCompetitors = getTrackedCompetitors(listing.asin);

  // Get price trends
  const priceTrends = analyzePriceTrends(listing.asin, 30);

  return {
    success: true,
    data: {
      sku,
      asin: listing.asin,
      title: listing.title,
      ourPrice: listing.price,
      buyBox: buyBoxAnalysis,
      trackedCompetitors,
      priceTrends: {
        volatility: priceTrends.priceVolatility,
        recommendations: priceTrends.recommendations
      }
    }
  };
});

console.log("Competitor Intelligence Dashboard loaded");

// ============================================
// ORDERS & SALES API
// ============================================

// Get orders with filters
fastify.get('/api/v1/orders', async (request) => {
  try {
    const filters = {
      status: request.query.status,
      startDate: request.query.startDate,
      endDate: request.query.endDate,
      sku: request.query.sku,
      limit: parseInt(request.query.limit) || 50,
      offset: parseInt(request.query.offset) || 0
    };
    const orders = await OrderRepository.getOrders(filters);
    return { success: true, data: orders };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get order counts by status
fastify.get('/api/v1/orders/counts', async () => {
  try {
    const counts = await OrderRepository.getOrderCounts();
    return { success: true, data: counts };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get sales summary
fastify.get('/api/v1/sales/summary', async (request) => {
  try {
    const days = parseInt(request.query.days) || 30;
    const endDate = new Date();
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const summary = await OrderRepository.getSalesSummary(startDate, endDate);
    return { success: true, data: summary };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get daily sales for charts
fastify.get('/api/v1/sales/daily', async (request) => {
  try {
    const days = parseInt(request.query.days) || 30;
    const dailySales = await OrderRepository.getDailySales(days);
    return { success: true, data: dailySales };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get top selling SKUs
fastify.get('/api/v1/sales/top-skus', async (request) => {
  try {
    const days = parseInt(request.query.days) || 30;
    const limit = parseInt(request.query.limit) || 10;
    const topSkus = await OrderRepository.getTopSkus(days, limit);
    return { success: true, data: topSkus };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get sales history for a specific SKU
fastify.get('/api/v1/sales/sku/:sku', async (request) => {
  try {
    const days = parseInt(request.query.days) || 30;
    const history = await OrderRepository.getSkuSalesHistory(request.params.sku, days);
    return { success: true, data: history };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Trigger order sync from SP-API
fastify.post('/api/v1/orders/sync', async (request) => {
  try {
    const options = {
      fullSync: request.body?.fullSync || false,
      orderStatuses: request.body?.orderStatuses
    };
    const result = await syncOrders(options);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get sync status
fastify.get('/api/v1/orders/sync/status', async () => {
  try {
    const status = await getSyncStatus();
    return { success: true, data: status };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Combined sales dashboard data
fastify.get('/api/v1/sales/dashboard', async (request) => {
  try {
    const days = parseInt(request.query.days) || 30;
    const [summary, dailySales, topSkus, orderCounts, syncStatus] = await Promise.all([
      OrderRepository.getSalesSummary(
        new Date(Date.now() - days * 24 * 60 * 60 * 1000),
        new Date()
      ),
      OrderRepository.getDailySales(days),
      OrderRepository.getTopSkus(days, 10),
      OrderRepository.getOrderCounts(),
      getSyncStatus()
    ]);

    return {
      success: true,
      data: {
        summary,
        dailySales,
        topSkus,
        orderCounts,
        syncStatus
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

console.log("Orders & Sales API loaded");

// ============================================
// START SERVER (must be at the end after all routes are registered)
// ============================================
const start = async () => {
  try {
    await fastify.listen({ port: 4000, host: '0.0.0.0' });
    console.log('Server running on http://0.0.0.0:4000');

    // Start the job worker (Slice B)
    if (process.env.DISABLE_WORKER !== 'true') {
      startWorker();
      console.log('Job worker started');
    }
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  stopWorker();
  await fastify.close();
  await closePool();
  console.log('Server shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

start();
