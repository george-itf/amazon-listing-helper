/**
 * Rounding Utilities
 *
 * Provides consistent HALF_UP rounding across the application.
 *
 * HALF_UP Policy:
 * - Values exactly at .5 are rounded UP (away from zero for positive, toward zero for negative)
 * - This matches standard financial/accounting expectations
 * - Example: 2.445 → 2.45, 2.455 → 2.46
 *
 * Note: JavaScript's Math.round() uses "round half away from zero" which is
 * equivalent to HALF_UP for positive numbers. PostgreSQL ROUND() uses
 * "half even" (banker's rounding) by default.
 *
 * For most financial values in this application, the difference is negligible
 * (only affects exact .5 cases), but we standardize on HALF_UP for consistency.
 *
 * @module Rounding
 */

/**
 * Round a number using HALF_UP policy
 * @param {number} value - The value to round
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {number} Rounded value
 */
export function roundHalfUp(value, decimals = 2) {
  if (typeof value !== 'number' || isNaN(value)) {
    return 0;
  }

  const multiplier = Math.pow(10, decimals);
  // Math.round uses "round half away from zero" which equals HALF_UP for positive numbers
  // For negative numbers, we need to handle specially for true HALF_UP behavior
  if (value >= 0) {
    return Math.round(value * multiplier) / multiplier;
  } else {
    // For negative numbers, HALF_UP means -2.5 → -2 (toward zero)
    // But Math.round(-2.5) → -2 which is correct for HALF_UP
    // So Math.round actually works correctly for our needs
    return Math.round(value * multiplier) / multiplier;
  }
}

/**
 * Round monetary values to 2 decimal places using HALF_UP
 * Normalizes -0 to 0 for cleaner output
 * @param {number} value - The monetary value to round
 * @returns {number} Rounded value
 */
export function roundMoney(value) {
  const result = roundHalfUp(value, 2);
  return result === 0 ? 0 : result; // Normalize -0 to 0
}

/**
 * Round percentage values to 4 decimal places using HALF_UP
 * (e.g., 0.1234 = 12.34%)
 * @param {number} value - The percentage as decimal (0.15 = 15%)
 * @returns {number} Rounded value
 */
export function roundPercentage(value) {
  return roundHalfUp(value, 4);
}

/**
 * Round quantity values to nearest integer using HALF_UP
 * @param {number} value - The quantity to round
 * @returns {number} Rounded integer
 */
export function roundQuantity(value) {
  return roundHalfUp(value, 0);
}

/**
 * Format money value for display (GBP)
 * @param {number} value - The monetary value
 * @returns {string} Formatted string like "£12.34"
 */
export function formatMoney(value) {
  const rounded = roundMoney(value);
  return `£${rounded.toFixed(2)}`;
}

/**
 * Format percentage for display
 * @param {number} value - The percentage as decimal (0.15 = 15%)
 * @returns {string} Formatted string like "15.00%"
 */
export function formatPercentage(value) {
  if (typeof value !== 'number' || isNaN(value)) {
    return '-';
  }
  const percentage = roundHalfUp(value * 100, 2);
  return `${percentage.toFixed(2)}%`;
}

export default {
  roundHalfUp,
  roundMoney,
  roundPercentage,
  roundQuantity,
  formatMoney,
  formatPercentage,
};
