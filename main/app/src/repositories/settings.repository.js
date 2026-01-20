/**
 * Settings Repository
 * Handles all database operations for application settings
 */

import { query } from '../database/connection.js';

/**
 * Get a setting by key
 * @param {string} key - Setting key
 * @returns {Promise<Object|null>} Setting object or null
 */
export async function get(key) {
  const sql = `SELECT * FROM settings WHERE key = $1`;
  const result = await query(sql, [key]);
  return result.rows[0] || null;
}

/**
 * Get setting value by key
 * @param {string} key - Setting key
 * @param {any} defaultValue - Default value if not found
 * @returns {Promise<any>} Setting value
 */
export async function getValue(key, defaultValue = null) {
  const setting = await get(key);
  return setting ? setting.value : defaultValue;
}

/**
 * Get all settings
 * @returns {Promise<Array>} Array of settings
 */
export async function getAll() {
  const sql = `SELECT * FROM settings ORDER BY key`;
  const result = await query(sql);
  return result.rows;
}

/**
 * Get all settings as key-value object
 * @returns {Promise<Object>} Settings object
 */
export async function getAllAsObject() {
  const settings = await getAll();
  return settings.reduce((acc, setting) => {
    acc[setting.key] = setting.value;
    return acc;
  }, {});
}

/**
 * Set a setting value (upsert)
 * @param {string} key - Setting key
 * @param {any} value - Setting value
 * @param {string} description - Optional description
 * @returns {Promise<Object>} Updated setting
 */
export async function set(key, value, description = null) {
  const sql = `
    INSERT INTO settings (key, value, description, "updatedAt")
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      description = COALESCE(EXCLUDED.description, settings.description),
      "updatedAt" = NOW()
    RETURNING *
  `;

  // Handle JSONB value - convert objects/arrays to JSON
  const jsonValue = typeof value === 'object' ? value : value;

  const result = await query(sql, [key, JSON.stringify(jsonValue), description]);
  return result.rows[0];
}

/**
 * Delete a setting
 * @param {string} key - Setting key
 * @returns {Promise<boolean>} True if deleted
 */
export async function remove(key) {
  const result = await query('DELETE FROM settings WHERE key = $1 RETURNING key', [key]);
  return result.rowCount > 0;
}

/**
 * Check if a setting exists
 * @param {string} key - Setting key
 * @returns {Promise<boolean>} True if exists
 */
export async function exists(key) {
  const sql = `SELECT 1 FROM settings WHERE key = $1`;
  const result = await query(sql, [key]);
  return result.rowCount > 0;
}

/**
 * Get settings by prefix
 * @param {string} prefix - Key prefix
 * @returns {Promise<Array>} Matching settings
 */
export async function getByPrefix(prefix) {
  const sql = `SELECT * FROM settings WHERE key LIKE $1 ORDER BY key`;
  const result = await query(sql, [`${prefix}%`]);
  return result.rows;
}

/**
 * Bulk set settings
 * @param {Object} settings - Object of key-value pairs
 * @returns {Promise<number>} Number of settings updated
 */
export async function bulkSet(settings) {
  let count = 0;
  for (const [key, value] of Object.entries(settings)) {
    await set(key, value);
    count++;
  }
  return count;
}

// Convenience methods for specific settings

/**
 * Get Amazon SP-API credentials
 * @returns {Promise<Object|null>} SP-API credentials
 */
export async function getSpApiCredentials() {
  const setting = await get('sp_api_credentials');
  if (!setting) return null;

  const value = typeof setting.value === 'string'
    ? JSON.parse(setting.value)
    : setting.value;

  return value;
}

/**
 * Set Amazon SP-API credentials
 * @param {Object} credentials - SP-API credentials
 * @returns {Promise<Object>} Updated setting
 */
export async function setSpApiCredentials(credentials) {
  return set('sp_api_credentials', credentials, 'Amazon SP-API OAuth credentials');
}

/**
 * Get Keepa API credentials
 * @returns {Promise<Object|null>} Keepa credentials
 */
export async function getKeepaCredentials() {
  const setting = await get('keepa_credentials');
  if (!setting) return null;

  const value = typeof setting.value === 'string'
    ? JSON.parse(setting.value)
    : setting.value;

  return value;
}

/**
 * Set Keepa API credentials
 * @param {Object} credentials - Keepa credentials
 * @returns {Promise<Object>} Updated setting
 */
export async function setKeepaCredentials(credentials) {
  return set('keepa_credentials', credentials, 'Keepa API access key');
}

/**
 * Get scoring weights
 * @returns {Promise<Object>} Scoring weights
 */
export async function getScoringWeights() {
  const setting = await get('scoring_weights');
  if (!setting) {
    // Default weights
    return {
      seo: 0.20,
      content: 0.20,
      images: 0.15,
      competitive: 0.20,
      compliance: 0.25,
    };
  }

  return typeof setting.value === 'string'
    ? JSON.parse(setting.value)
    : setting.value;
}

/**
 * Set scoring weights
 * @param {Object} weights - Scoring weights
 * @returns {Promise<Object>} Updated setting
 */
export async function setScoringWeights(weights) {
  return set('scoring_weights', weights, 'ML scoring engine weight configuration');
}

export default {
  get,
  getValue,
  getAll,
  getAllAsObject,
  set,
  remove,
  exists,
  getByPrefix,
  bulkSet,
  getSpApiCredentials,
  setSpApiCredentials,
  getKeepaCredentials,
  setKeepaCredentials,
  getScoringWeights,
  setScoringWeights,
};
