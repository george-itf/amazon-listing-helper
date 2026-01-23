/**
 * Fingerprint Generation Utility
 *
 * Generates deterministic fingerprints for ASIN snapshots.
 * Used for deduplication, suppression, and change detection.
 *
 * FINGERPRINT SPEC:
 * - Canonical input fields (exact order):
 *   1. asin
 *   2. marketplace (string, e.g., 'UK')
 *   3. price_inc_vat (integer pence, or null)
 *   4. total_stock (integer, or null)
 *   5. buy_box_seller_id (string, or null)
 *   6. keepa_price_p25_90d (integer pence, or null)
 *   7. seller_count (integer, or null)
 *
 * - Build a canonical JSON object with these keys in order
 * - Explicitly include null for missing values
 * - Serialize deterministically (sorted keys)
 * - Hash using SHA-256
 * - Store hex digest in fingerprint_hash
 *
 * @module fingerprint
 */

import crypto from 'crypto';

/**
 * Marketplace ID to code mapping
 */
const MARKETPLACE_CODES = {
  1: 'UK',     // Amazon UK
  2: 'DE',     // Amazon Germany
  3: 'FR',     // Amazon France
  4: 'IT',     // Amazon Italy
  5: 'ES',     // Amazon Spain
  6: 'US',     // Amazon US
};

/**
 * Convert price in pounds to integer pence
 * @param {number|null|undefined} priceInPounds
 * @returns {number|null}
 */
export function toPence(priceInPounds) {
  if (priceInPounds === null || priceInPounds === undefined) {
    return null;
  }
  const parsed = parseFloat(priceInPounds);
  if (isNaN(parsed)) {
    return null;
  }
  // Round to nearest pence to avoid floating point issues
  return Math.round(parsed * 100);
}

/**
 * Normalize a value to integer or null
 * @param {number|null|undefined} value
 * @returns {number|null}
 */
export function toIntOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    return null;
  }
  return parsed;
}

/**
 * Normalize a value to string or null
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
export function toStringOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

/**
 * Build canonical fingerprint input object
 *
 * The order of keys is critical for determinism.
 * This function builds the canonical object per the spec.
 *
 * @param {Object} data - Snapshot data
 * @param {string} data.asin - ASIN (required)
 * @param {number} data.marketplace_id - Marketplace ID (required)
 * @param {number|null} [data.price_inc_vat] - Price including VAT (in pounds)
 * @param {number|null} [data.total_stock] - Total stock count
 * @param {string|null} [data.buy_box_seller_id] - Buy box seller ID
 * @param {number|null} [data.keepa_price_p25_90d] - Keepa 25th percentile price (in pence already)
 * @param {number|null} [data.seller_count] - Number of sellers
 * @returns {Object} Canonical fingerprint input object
 */
export function buildFingerprintInput(data) {
  if (!data.asin) {
    throw new Error('ASIN is required for fingerprint generation');
  }

  if (!data.marketplace_id) {
    throw new Error('marketplace_id is required for fingerprint generation');
  }

  const marketplace = MARKETPLACE_CODES[data.marketplace_id] || `MARKETPLACE_${data.marketplace_id}`;

  // Build canonical object with explicit order
  // Using an array of key-value pairs to ensure order
  const canonicalFields = [
    ['asin', toStringOrNull(data.asin)],
    ['marketplace', marketplace],
    ['price_inc_vat_pence', toPence(data.price_inc_vat)],
    ['total_stock', toIntOrNull(data.total_stock)],
    ['buy_box_seller_id', toStringOrNull(data.buy_box_seller_id)],
    ['keepa_price_p25_90d_pence', toIntOrNull(data.keepa_price_p25_90d)],
    ['seller_count', toIntOrNull(data.seller_count)],
  ];

  // Convert to object while preserving order (for JSON.stringify)
  const result = {};
  for (const [key, value] of canonicalFields) {
    result[key] = value;
  }

  return result;
}

/**
 * Serialize fingerprint input deterministically
 *
 * Uses sorted keys for deterministic JSON output.
 *
 * @param {Object} fingerprintInput - Canonical fingerprint input object
 * @returns {string} Deterministic JSON string
 */
export function serializeFingerprintInput(fingerprintInput) {
  // JSON.stringify with sorted keys for determinism
  return JSON.stringify(fingerprintInput, Object.keys(fingerprintInput).sort());
}

/**
 * Generate SHA-256 hash of serialized input
 *
 * @param {string} serialized - Serialized fingerprint input
 * @returns {string} SHA-256 hex digest
 */
export function hashFingerprint(serialized) {
  return crypto
    .createHash('sha256')
    .update(serialized, 'utf8')
    .digest('hex');
}

/**
 * Generate deterministic fingerprint hash for an ASIN snapshot
 *
 * This is the main entry point for fingerprint generation.
 *
 * @param {Object} data - Snapshot data
 * @param {string} data.asin - ASIN (required)
 * @param {number} data.marketplace_id - Marketplace ID (required)
 * @param {number|null} [data.price_inc_vat] - Price including VAT (in pounds)
 * @param {number|null} [data.total_stock] - Total stock count
 * @param {string|null} [data.buy_box_seller_id] - Buy box seller ID
 * @param {number|null} [data.keepa_price_p25_90d] - Keepa 25th percentile price (in pence already)
 * @param {number|null} [data.seller_count] - Number of sellers
 * @returns {string} SHA-256 hex digest (64 characters)
 */
export function generateFingerprint(data) {
  const input = buildFingerprintInput(data);
  const serialized = serializeFingerprintInput(input);
  return hashFingerprint(serialized);
}

/**
 * Verify a fingerprint matches the expected value
 *
 * @param {Object} data - Snapshot data
 * @param {string} expectedHash - Expected fingerprint hash
 * @returns {boolean} True if fingerprint matches
 */
export function verifyFingerprint(data, expectedHash) {
  const computed = generateFingerprint(data);
  return computed === expectedHash;
}

/**
 * Compare two fingerprints to detect changes
 *
 * @param {string} oldHash - Previous fingerprint hash
 * @param {string} newHash - New fingerprint hash
 * @returns {boolean} True if fingerprints are different (data changed)
 */
export function hasChanged(oldHash, newHash) {
  return oldHash !== newHash;
}

export default {
  generateFingerprint,
  verifyFingerprint,
  hasChanged,
  buildFingerprintInput,
  serializeFingerprintInput,
  hashFingerprint,
  toPence,
  toIntOrNull,
  toStringOrNull,
};
