/**
 * CredentialsProvider Module
 *
 * Single source of truth for all credential access and publish mode configuration.
 * SECURITY: Only loads credentials from environment variables.
 * Never reads from disk files to prevent accidental secret exposure.
 *
 * Required environment variables for SP-API:
 *   - SP_API_REFRESH_TOKEN
 *   - SP_API_CLIENT_ID
 *   - SP_API_CLIENT_SECRET
 *   - SP_API_SELLER_ID (optional)
 *   - SP_API_MARKETPLACE_ID (optional, defaults to UK)
 *
 * Required for Keepa:
 *   - KEEPA_API_KEY
 *
 * Publish Mode Configuration:
 *   - ENABLE_PUBLISH: Set to 'true' to allow publish operations (default: false)
 *   - AMAZON_WRITE_MODE: 'simulate' or 'live' (default: 'simulate')
 *
 * Publish behavior matrix:
 *   | ENABLE_PUBLISH | AMAZON_WRITE_MODE | Behavior                           |
 *   |----------------|-------------------|------------------------------------|
 *   | false          | any               | Publish blocked with safe error    |
 *   | true           | simulate          | Validation + logging, no SP-API    |
 *   | true           | live              | Full SP-API write operations       |
 *
 * @module CredentialsProvider
 */

// Cached credentials (loaded once)
let cachedCredentials = null;

/**
 * Helper to require an environment variable
 * @param {string} name - Environment variable name
 * @param {string} [fallback] - Optional fallback value
 * @returns {string} The environment variable value
 * @throws {Error} If required and not found
 */
function requireEnv(name, fallback = undefined) {
  const value = process.env[name];
  if (!value && fallback === undefined) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
      `Set this in your environment or Railway variables.`
    );
  }
  return value || fallback;
}

/**
 * Get environment variable with optional default
 * @param {string} name - Environment variable name
 * @param {string} defaultValue - Default value if not set
 * @returns {string} The environment variable value or default
 */
function getEnv(name, defaultValue = '') {
  return process.env[name] || defaultValue;
}

/**
 * Load credentials from environment variables
 * @returns {Object} Credentials object
 */
function loadCredentials() {
  if (cachedCredentials) {
    return cachedCredentials;
  }

  // Load from environment variables only
  cachedCredentials = {
    refreshToken: getEnv('SP_API_REFRESH_TOKEN'),
    clientId: getEnv('SP_API_CLIENT_ID'),
    clientSecret: getEnv('SP_API_CLIENT_SECRET'),
    sellerId: getEnv('SP_API_SELLER_ID'),
    marketplaceId: getEnv('SP_API_MARKETPLACE_ID', 'A1F83G8C2ARO7P'), // Default to UK
    keepaKey: getEnv('KEEPA_API_KEY'),
  };

  return cachedCredentials;
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
    refreshToken: creds.refreshToken,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    sellerId: creds.sellerId,
    marketplaceId: creds.marketplaceId,
  };
}

/**
 * Get SP-API credentials with validation
 * Throws if required credentials are missing
 * @returns {Object} Validated SP-API credentials
 * @throws {Error} If required credentials are missing
 */
export function getSpApiCredentialsRequired() {
  const refreshToken = requireEnv('SP_API_REFRESH_TOKEN');
  const clientId = requireEnv('SP_API_CLIENT_ID');
  const clientSecret = requireEnv('SP_API_CLIENT_SECRET');

  return {
    refreshToken,
    clientId,
    clientSecret,
    sellerId: getEnv('SP_API_SELLER_ID'),
    marketplaceId: getEnv('SP_API_MARKETPLACE_ID', 'A1F83G8C2ARO7P'),
  };
}

/**
 * Get Keepa API key
 * @returns {string} Keepa API key (empty string if not set)
 */
export function getKeepaApiKey() {
  const creds = loadCredentials();
  return creds.keepaKey;
}

/**
 * Get Keepa API key with validation
 * @returns {string} Keepa API key
 * @throws {Error} If KEEPA_API_KEY is not set
 */
export function getKeepaApiKeyRequired() {
  return requireEnv('KEEPA_API_KEY');
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
    source: 'environment_variables',
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
      // Increase retry attempts for throttled requests (default is 3)
      max_retries: 5,
      // Wait times in ms for retries (exponential backoff)
      use_sandbox: false,
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

/**
 * Validate all required credentials are present
 * Call this at application startup to fail fast
 * @param {Object} options - Validation options
 * @param {boolean} options.requireSpApi - Require SP-API credentials
 * @param {boolean} options.requireKeepa - Require Keepa credentials
 * @throws {Error} If required credentials are missing
 */
export function validateCredentials({ requireSpApi = false, requireKeepa = false } = {}) {
  const missing = [];

  if (requireSpApi) {
    if (!process.env.SP_API_REFRESH_TOKEN) missing.push('SP_API_REFRESH_TOKEN');
    if (!process.env.SP_API_CLIENT_ID) missing.push('SP_API_CLIENT_ID');
    if (!process.env.SP_API_CLIENT_SECRET) missing.push('SP_API_CLIENT_SECRET');
  }

  if (requireKeepa) {
    if (!process.env.KEEPA_API_KEY) missing.push('KEEPA_API_KEY');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
      `Please configure these in Railway or your .env file.`
    );
  }
}

// ============================================================================
// PUBLISH MODE CONFIGURATION
// ============================================================================

/**
 * Write mode enum values
 * @readonly
 * @enum {string}
 */
export const WRITE_MODE = {
  SIMULATE: 'simulate',
  LIVE: 'live',
};

/**
 * Check if publishing is enabled
 * @returns {boolean} True if ENABLE_PUBLISH=true
 */
export function isPublishEnabled() {
  return process.env.ENABLE_PUBLISH === 'true';
}

/**
 * Get the Amazon write mode
 * @returns {string} 'simulate' or 'live'
 */
export function getWriteMode() {
  const mode = process.env.AMAZON_WRITE_MODE?.toLowerCase();
  if (mode === 'live') {
    return WRITE_MODE.LIVE;
  }
  return WRITE_MODE.SIMULATE;
}

/**
 * Check if we should execute actual SP-API write operations
 * Returns true only if ENABLE_PUBLISH=true AND AMAZON_WRITE_MODE=live
 * @returns {boolean}
 */
export function shouldExecuteSpApiWrites() {
  return isPublishEnabled() && getWriteMode() === WRITE_MODE.LIVE;
}

/**
 * Get publish configuration for responses
 * Returns an object that should be included in all publish-related responses
 * @returns {Object} Publish configuration status
 */
export function getPublishConfig() {
  const enabled = isPublishEnabled();
  const writeMode = getWriteMode();
  return {
    publish_enabled: enabled,
    write_mode: writeMode,
    will_execute_writes: enabled && writeMode === WRITE_MODE.LIVE,
  };
}

/**
 * Validate publish operation is allowed
 * Throws an error if publishing is not enabled
 * @param {string} operation - Name of the operation for error message
 * @throws {Error} If ENABLE_PUBLISH is not true
 */
export function requirePublishEnabled(operation = 'publish') {
  if (!isPublishEnabled()) {
    const error = new Error(
      `Publish operation '${operation}' blocked: ENABLE_PUBLISH is not set to 'true'. ` +
      `This is a safety feature. Set ENABLE_PUBLISH=true in your environment to allow publish operations.`
    );
    error.code = 'PUBLISH_DISABLED';
    error.statusCode = 403;
    throw error;
  }
}

/**
 * Get comprehensive publish status (for health checks and diagnostics)
 * @returns {Object} Full publish configuration status
 */
export function getPublishStatus() {
  const enabled = isPublishEnabled();
  const writeMode = getWriteMode();
  const hasCredentials = hasSpApiCredentials();

  return {
    enabled,
    write_mode: writeMode,
    will_execute_writes: enabled && writeMode === WRITE_MODE.LIVE,
    has_sp_api_credentials: hasCredentials,
    ready_for_live: enabled && writeMode === WRITE_MODE.LIVE && hasCredentials,
    configuration: {
      ENABLE_PUBLISH: process.env.ENABLE_PUBLISH || '(not set)',
      AMAZON_WRITE_MODE: process.env.AMAZON_WRITE_MODE || '(not set, defaults to simulate)',
    },
  };
}

export default {
  getSpApiCredentials,
  getSpApiCredentialsRequired,
  getSpApiClientConfig,
  getKeepaApiKey,
  getKeepaApiKeyRequired,
  hasSpApiCredentials,
  hasKeepaCredentials,
  getCredentialsStatus,
  getDefaultMarketplaceId,
  getSellerId,
  clearCredentialsCache,
  validateCredentials,
  // Publish mode exports
  WRITE_MODE,
  isPublishEnabled,
  getWriteMode,
  shouldExecuteSpApiWrites,
  getPublishConfig,
  requirePublishEnabled,
  getPublishStatus,
};
