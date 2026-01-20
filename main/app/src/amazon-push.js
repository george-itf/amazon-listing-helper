// Push Changes to Amazon via SP-API Feeds
import fs from 'fs';
import path from 'path';
import SellingPartner from 'amazon-sp-api';

const DATA_DIR = path.join(process.cwd(), '..', 'data');

function loadJSON(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf8'));
  } catch { return null; }
}

function saveJSON(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

function getSpClient() {
  const creds = loadJSON('credentials.json');
  if (!creds?.clientId || !creds?.clientSecret || !creds?.refreshToken) {
    return null;
  }
  
  return new SellingPartner({
    region: 'eu',
    refresh_token: creds.refreshToken,
    credentials: {
      SELLING_PARTNER_APP_CLIENT_ID: creds.clientId,
      SELLING_PARTNER_APP_CLIENT_SECRET: creds.clientSecret
    }
  });
}

// Store pending changes
function initPendingChanges() {
  const pending = loadJSON('pending-changes.json');
  if (!pending) {
    saveJSON('pending-changes.json', { changes: [], lastId: 0 });
  }
  return loadJSON('pending-changes.json');
}

function getPendingChanges() {
  return initPendingChanges().changes.filter(c => c.status === 'pending');
}

function getAllChanges() {
  return initPendingChanges().changes;
}

// Queue a price change
function queuePriceChange(sku, newPrice, reason = '') {
  const data = initPendingChanges();
  const listings = loadJSON('listings.json');
  const item = listings?.items?.find(i => i.sku === sku);
  
  if (!item) return { error: 'Listing not found' };
  
  const change = {
    id: ++data.lastId,
    type: 'price',
    sku,
    asin: item.asin,
    title: item.title?.substring(0, 60),
    oldValue: item.price,
    newValue: newPrice,
    reason,
    status: 'pending', // pending, submitted, completed, failed
    createdAt: new Date().toISOString(),
    submittedAt: null,
    completedAt: null,
    feedId: null,
    error: null
  };
  
  data.changes.push(change);
  saveJSON('pending-changes.json', data);
  
  return change;
}

// Queue a listing update (title, bullets, etc)
function queueListingUpdate(sku, updates, reason = '') {
  const data = initPendingChanges();
  const listings = loadJSON('listings.json');
  const item = listings?.items?.find(i => i.sku === sku);
  
  if (!item) return { error: 'Listing not found' };
  
  const change = {
    id: ++data.lastId,
    type: 'listing',
    sku,
    asin: item.asin,
    title: item.title?.substring(0, 60),
    updates, // { title: '...', bullets: [...], etc }
    reason,
    status: 'pending',
    createdAt: new Date().toISOString(),
    submittedAt: null,
    completedAt: null,
    feedId: null,
    error: null
  };
  
  data.changes.push(change);
  saveJSON('pending-changes.json', data);
  
  return change;
}

// Cancel a pending change
function cancelChange(changeId) {
  const data = initPendingChanges();
  const change = data.changes.find(c => c.id === changeId);
  
  if (!change) return { error: 'Change not found' };
  if (change.status !== 'pending') return { error: 'Can only cancel pending changes' };
  
  change.status = 'cancelled';
  change.completedAt = new Date().toISOString();
  saveJSON('pending-changes.json', data);
  
  return change;
}

// Submit pending changes to Amazon (price feed)
async function submitPriceChanges() {
  const sp = getSpClient();
  if (!sp) return { error: 'SP-API not configured' };
  
  const data = initPendingChanges();
  const pendingPrices = data.changes.filter(c => c.type === 'price' && c.status === 'pending');
  
  if (pendingPrices.length === 0) {
    return { message: 'No pending price changes' };
  }
  
  // Build price feed XML
  const feedContent = buildPriceFeed(pendingPrices);
  
  try {
    // Create feed document
    const createResponse = await sp.callAPI({
      operation: 'createFeedDocument',
      body: { contentType: 'text/xml; charset=UTF-8' }
    });
    
    const feedDocumentId = createResponse.feedDocumentId;
    const uploadUrl = createResponse.url;
    
    // Upload feed content
    await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
      body: feedContent
    });
    
    // Submit feed
    const feedResponse = await sp.callAPI({
      operation: 'createFeed',
      body: {
        feedType: 'POST_PRODUCT_PRICING_DATA',
        marketplaceIds: ['A1F83G8C2ARO7P'], // UK
        inputFeedDocumentId: feedDocumentId
      }
    });
    
    const feedId = feedResponse.feedId;
    
    // Update change records
    pendingPrices.forEach(c => {
      c.status = 'submitted';
      c.submittedAt = new Date().toISOString();
      c.feedId = feedId;
    });
    saveJSON('pending-changes.json', data);
    
    return { 
      success: true, 
      feedId, 
      changesSubmitted: pendingPrices.length 
    };
    
  } catch (error) {
    pendingPrices.forEach(c => {
      c.status = 'failed';
      c.error = error.message;
    });
    saveJSON('pending-changes.json', data);
    
    return { error: error.message };
  }
}

function buildPriceFeed(priceChanges) {
  const items = priceChanges.map((c, i) => `
    <Message>
      <MessageID>${i + 1}</MessageID>
      <Price>
        <SKU>${escapeXml(c.sku)}</SKU>
        <StandardPrice currency="GBP">${c.newValue.toFixed(2)}</StandardPrice>
      </Price>
    </Message>
  `).join('');
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<AmazonEnvelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="amzn-envelope.xsd">
  <Header>
    <DocumentVersion>1.01</DocumentVersion>
    <MerchantIdentifier>YOUR_MERCHANT_ID</MerchantIdentifier>
  </Header>
  <MessageType>Price</MessageType>
  ${items}
</AmazonEnvelope>`;
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
}

// Check feed status
async function checkFeedStatus(feedId) {
  const sp = getSpClient();
  if (!sp) return { error: 'SP-API not configured' };
  
  try {
    const response = await sp.callAPI({
      operation: 'getFeed',
      path: { feedId }
    });
    
    return response;
  } catch (error) {
    return { error: error.message };
  }
}

export { 
  getPendingChanges, 
  getAllChanges, 
  queuePriceChange, 
  queueListingUpdate, 
  cancelChange,
  submitPriceChanges,
  checkFeedStatus
};
