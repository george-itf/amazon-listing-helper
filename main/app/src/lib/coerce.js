/**
 * Safe Coercion Helpers
 *
 * CRITICAL: These helpers prevent accidental corruption of falsy values (0, false)
 * into NULL when persisting to the database.
 *
 * Problem: JavaScript's `value || null` pattern converts 0 and false to null.
 * Solution: Use these helpers which use `??` (nullish coalescing) or explicit type checks.
 *
 * @module Coerce
 */

/**
 * Coerce a value to null only if it's null or undefined.
 * Preserves 0, false, '', NaN, etc.
 *
 * @param {*} value - Any value
 * @returns {*|null} - Value or null (only if value was null/undefined)
 */
export function toNullish(value) {
  return value ?? null;
}

/**
 * Coerce a numeric value for database storage.
 * - Returns null if value is null, undefined, or not a finite number
 * - Preserves 0
 * - Rejects NaN, Infinity, -Infinity
 *
 * @param {*} value - Potential numeric value
 * @returns {number|null} - Number or null
 */
export function toNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  // Try to parse strings
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

/**
 * Coerce an integer value for database storage.
 * - Returns null if value is null, undefined, or not a finite integer
 * - Preserves 0
 * - Rejects NaN, Infinity, floats
 *
 * @param {*} value - Potential integer value
 * @returns {number|null} - Integer or null
 */
export function toInteger(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }
  // Try to parse strings
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

/**
 * Coerce a boolean value for database storage.
 * - Returns null if value is null or undefined
 * - Returns true/false for boolean values
 * - Preserves false (does NOT convert false to null!)
 *
 * @param {*} value - Potential boolean value
 * @returns {boolean|null} - Boolean or null
 */
export function toBoolean(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  // Handle common string representations
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
  }
  // Handle numbers
  if (value === 1) return true;
  if (value === 0) return false;
  return null;
}

/**
 * Coerce a string value for database storage.
 * - Returns null if value is null, undefined, or empty string
 * - Trims whitespace
 * - Returns null for whitespace-only strings
 *
 * @param {*} value - Potential string value
 * @returns {string|null} - Non-empty string or null
 */
export function toString(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  // Convert other types to string
  return String(value);
}

/**
 * Coerce a Date value for database storage.
 * - Returns null if value is null, undefined, or invalid
 * - Accepts Date objects, ISO strings, or timestamps
 *
 * @param {*} value - Potential date value
 * @returns {Date|null} - Valid Date or null
 */
export function toDate(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export default {
  toNullish,
  toNumber,
  toInteger,
  toBoolean,
  toString,
  toDate,
};
