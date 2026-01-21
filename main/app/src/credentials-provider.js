/**
 * CredentialsProvider Module
 *
 * Single source of truth for all credential access.
 * Per ARCHITECTURE_AUDIT.md §A.5: No other code should read credentials.json directly.
 *
 * @module CredentialsProvider
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = process.env.DATA_DIR || '/opt/alh/data';
const CREDENTIALS_FILE = join(DATA_DIR, 'credentials.json');

// Cached credentials (loaded once)
let cachedCredentials = null;

/**
 * Load credentials from environment variables (for Railway/cloud) or file (for local)
 * @returns {Object} Raw credentials object
 * @throws {Error} If no credentials found
 */
function loadCredentials() {
  if (cachedCredentials) {
    return cachedCredentials;
  }

  // First, try environment variables (Railway deployment)
  if (process.env.SP_API_REFRESH_TOKEN || process.env.SP_API_CLIENT_ID) {
    cachedCredentials = {
      refreshToken: process.env.SP_API_REFRESH_TOKEN,
      clientId: process.env.SP_API_CLIENT_ID,
      clientSecret: process.env.SP_API_CLIENT_SECRET,
      sellerId: process.env.SP_API_SELLER_ID,
      marketplaceId: process.env.SP_API_MARKETPLACE_ID || 'A1F83G8C2ARO7P',
      keepaKey: process.env.KEEPA_API_KEY,
    };
    return cachedCredentials;
  }

  // Fall back to credentials file (local development)
  if (!existsSync(CREDENTIALS_FILE)) {
    throw new Error(`Credentials file not found: ${CREDENTIALS_FILE}`);
  }

  try {
    const content = readFileSync(CREDENTIALS_FILE, 'utf8');
    cachedCredentials = JSON.parse(content);
    return cachedCredentials;
  } catch (error) {
    throw new Error(`Failed to parse credentials file: ${error.message}`);
  }
}

/**
 * Clear cached credentials (useful for testing or reloading)
 */
export function clearCredentialsCache() {
  cachedCredentials = null;
}

/**
 * Get SP-API credentials
 * @returns {Object} SP-API credentials
 * @property {string} refreshToken - LWA refresh token
 * @property {string} clientId - LWA client ID
 * @property {string} clientSecret - LWA client secret
 * @property {string} sellerId - Amazon seller ID
 * @property {string} marketplaceId - Amazon marketplace ID
 */
export function getSpApiCredentials() {
  const creds = loadCredentials();

  return {
    refreshToken: creds.refreshToken || creds.spApi?.refreshToken,
    clientId: creds.clientId || creds.spApi?.clientId,
    clientSecret: creds.clientSecret || creds.spApi?.clientSecret,
    sellerId: creds.sellerId || creds.spApi?.sellerId,
    marketplaceId: creds.marketplaceId || creds.spApi?.marketplaceId || 'A1F83G8C2ARO7P', // Default to UK
  };
}

/**
 * Get Keepa API key
 * @returns {string} Keepa API key
 */
export function getKeepaApiKey() {
  const creds = loadCredentials();
  return creds.keepaKey || creds.keepa?.apiKey || '';
}

/**
 * Check if SP-API credentials are configured
 * @returns {boolean} True if SP-API credentials are present
 */
export function hasSpApiCredentials() {
  try {
    const creds = getSpApiCredentials();
    return !!(creds.refreshToken && creds.clientId && creds.clientSecret);
  } catch {
    return false;
  }
}

/**
 * Check if Keepa credentials are configured
 * @returns {boolean} True if Keepa API key is present
 */
export function hasKeepaCredentials() {
  try {
    const key = getKeepaApiKey();
    return !!key;
  } catch {
    return false;
  }
}

/**
 * Get credentials status (for health checks)
 * @returns {Object} Status of each credential type
 */
export function getCredentialsStatus() {
  return {
    spApi: hasSpApiCredentials(),
    keepa: hasKeepaCredentials(),
    credentialsFileExists: existsSync(CREDENTIALS_FILE),
  };
}

/**
 * Get SP-API client configuration object
 * Use this to create amazon-sp-api SellingPartner instances.
 *
 * @param {string} [overrideMarketplaceId] - Override default marketplace
 * @returns {Object} Configuration for SellingPartner constructor
 * @example
 *   import SellingPartnerAPI from 'amazon-sp-api';
 *   const config = getSpApiClientConfig();
 *   const spClient = new SellingPartnerAPI(config);
 */
export function getSpApiClientConfig(overrideMarketplaceId = null) {
  const creds = getSpApiCredentials();
  const marketplaceId = overrideMarketplaceId || creds.marketplaceId;

  return {
    region: 'eu',  // UK marketplace is in EU region
    refresh_token: creds.refreshToken,
    credentials: {
      SELLING_PARTNER_APP_CLIENT_ID: creds.clientId,
      SELLING_PARTNER_APP_CLIENT_SECRET: creds.clientSecret,
    },
    options: {
      auto_request_tokens: true,
      auto_request_throttled: true,
    },
    // Seller info for reference
    sellerId: creds.sellerId,
    marketplaceId: marketplaceId,
  };
}

/**
 * Get default marketplace ID
 * @returns {string} Amazon marketplace ID (default: UK)
 */
export function getDefaultMarketplaceId() {
  try {
    const creds = getSpApiCredentials();
    return creds.marketplaceId;
  } catch {
    return 'A1F83G8C2ARO7P'; // UK fallback
  }
}

/**
 * Get seller ID
 * @returns {string|null} Amazon seller ID
 */
export function getSellerId() {
  try {
    const creds = getSpApiCredentials();
    return creds.sellerId || null;
  } catch {
    return null;
  }
}

export default {
  getSpApiCredentials,
  getSpApiClientConfig,
  getKeepaApiKey,
  hasSpApiCredentials,
  hasKeepaCredentials,
  getCredentialsStatus,
  getDefaultMarketplaceId,
  getSellerId,
  clearCredentialsCache,
};
