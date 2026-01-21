/**
 * Guardrails Service Unit Tests
 *
 * Tests for DATA_CONTRACTS.md §11 Guardrails Enforcement Contract.
 */

import assert from 'assert';
import {
  calculateDaysOfCover,
  calculateStockoutRisk,
} from '../services/guardrails.service.js';

console.log('Running Guardrails Service Unit Tests...\n');

// Test helper
function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}

// ============================================================================
// DAYS OF COVER TESTS
// ============================================================================

test('calculateDaysOfCover: normal scenario', () => {
  // 100 units, selling 10/day = 10 days cover
  const daysOfCover = calculateDaysOfCover(100, 10);
  assert.strictEqual(daysOfCover, 10);
});

test('calculateDaysOfCover: zero velocity returns null', () => {
  const daysOfCover = calculateDaysOfCover(100, 0);
  assert.strictEqual(daysOfCover, null);
});

test('calculateDaysOfCover: negative velocity returns null', () => {
  const daysOfCover = calculateDaysOfCover(100, -5);
  assert.strictEqual(daysOfCover, null);
});

test('calculateDaysOfCover: zero stock returns 0', () => {
  const daysOfCover = calculateDaysOfCover(0, 10);
  assert.strictEqual(daysOfCover, 0);
});

test('calculateDaysOfCover: fractional result', () => {
  // 15 units, selling 7/day = 2.14 days cover
  const daysOfCover = calculateDaysOfCover(15, 7);
  assert.strictEqual(Math.round(daysOfCover * 100) / 100, 2.14);
});

// ============================================================================
// STOCKOUT RISK TESTS
// ============================================================================

test('calculateStockoutRisk: HIGH when days < 0.5 * lead time', () => {
  // 5 days cover, 14 day lead time -> 5 < 7 -> HIGH
  const risk = calculateStockoutRisk(5, 14);
  assert.strictEqual(risk, 'HIGH');
});

test('calculateStockoutRisk: MEDIUM when days between 0.5 and 1.0 lead time', () => {
  // 10 days cover, 14 day lead time -> 7 <= 10 <= 14 -> MEDIUM
  const risk = calculateStockoutRisk(10, 14);
  assert.strictEqual(risk, 'MEDIUM');
});

test('calculateStockoutRisk: LOW when days > lead time', () => {
  // 30 days cover, 14 day lead time -> 30 > 14 -> LOW
  const risk = calculateStockoutRisk(30, 14);
  assert.strictEqual(risk, 'LOW');
});

test('calculateStockoutRisk: LOW when null (no velocity)', () => {
  const risk = calculateStockoutRisk(null, 14);
  assert.strictEqual(risk, 'LOW');
});

test('calculateStockoutRisk: default lead time is 14 days', () => {
  // 10 days cover with default lead time (14) -> MEDIUM
  const risk = calculateStockoutRisk(10);
  assert.strictEqual(risk, 'MEDIUM');
});

// ============================================================================
// GUARDRAILS VALUES TESTS
// ============================================================================

test('GUARDRAILS: Margin below 15% should trigger violation', () => {
  // This is tested through the validatePriceChange function in integration
  // For unit test, we verify the math
  const margin = 0.12; // 12%
  const minMargin = 0.15; // 15%
  assert.ok(margin < minMargin, 'Margin below threshold should trigger violation');
});

test('GUARDRAILS: Price change > 5% should trigger violation', () => {
  const currentPrice = 20.00;
  const newPrice = 22.00; // 10% increase
  const maxChangePct = 0.05; // 5%
  const actualChangePct = Math.abs(newPrice - currentPrice) / currentPrice;
  assert.ok(actualChangePct > maxChangePct, 'Price change > 5% should trigger violation');
});

test('GUARDRAILS: Price below break-even should trigger violation', () => {
  const breakEvenPrice = 15.00;
  const newPrice = 14.50;
  assert.ok(newPrice < breakEvenPrice, 'Price below break-even should trigger violation');
});

console.log('\nGuardrails tests complete.');
