/**
 * Economics Service Unit Tests
 *
 * Tests for DATA_CONTRACTS.md §4 Economics DTO Contract.
 * Acceptance test from SPEC §16.1:
 *   price_inc_vat=24.00, vat_rate=0.20 -> price_ex_vat=20.00
 *   bom=6.00, ship=2.00, pack=0.50, fees=3.00
 *   profit_ex_vat=8.50, margin=0.425
 */

import assert from 'assert';
import {
  roundMoney,
  calculatePriceExVat,
  calculateBreakEvenPriceIncVat,
  calculateAmazonFeesExVat,
} from '../services/economics.service.js';

console.log('Running Economics Service Unit Tests...\n');

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
// ROUNDING TESTS
// ============================================================================

test('roundMoney: rounds to 2 decimal places', () => {
  assert.strictEqual(roundMoney(10.125), 10.13);
  assert.strictEqual(roundMoney(10.124), 10.12);
  assert.strictEqual(roundMoney(10.1), 10.1);
  assert.strictEqual(roundMoney(10), 10);
});

test('roundMoney: handles negative numbers', () => {
  assert.strictEqual(roundMoney(-10.125), -10.12);
  assert.strictEqual(roundMoney(-10.126), -10.13);
});

test('roundMoney: handles zero', () => {
  assert.strictEqual(roundMoney(0), 0);
  assert.strictEqual(roundMoney(-0), 0);
});

// ============================================================================
// VAT CALCULATION TESTS
// ============================================================================

test('calculatePriceExVat: UK VAT 20%', () => {
  // £24.00 inc VAT at 20% = £20.00 ex VAT
  const result = calculatePriceExVat(24.00, 0.20);
  assert.strictEqual(result, 20.00);
});

test('calculatePriceExVat: zero VAT', () => {
  const result = calculatePriceExVat(24.00, 0);
  assert.strictEqual(result, 24.00);
});

test('calculatePriceExVat: different VAT rates', () => {
  // 5% VAT: £10.50 / 1.05 = £10.00
  assert.strictEqual(calculatePriceExVat(10.50, 0.05), 10.00);

  // 19% VAT (Germany): €11.90 / 1.19 = €10.00
  assert.strictEqual(calculatePriceExVat(11.90, 0.19), 10.00);
});

// ============================================================================
// BREAK-EVEN CALCULATION TESTS
// ============================================================================

test('calculateBreakEvenPriceIncVat: basic calculation', () => {
  // Total cost ex VAT = £10.00, VAT = 20%
  // Break-even inc VAT = £10.00 * 1.20 = £12.00
  const result = calculateBreakEvenPriceIncVat(10.00, 0.20);
  assert.strictEqual(result, 12.00);
});

test('calculateBreakEvenPriceIncVat: zero cost', () => {
  const result = calculateBreakEvenPriceIncVat(0, 0.20);
  assert.strictEqual(result, 0);
});

test('calculateBreakEvenPriceIncVat: high cost scenario', () => {
  // Total cost = £15.50, VAT = 20%
  // Break-even = £15.50 * 1.20 = £18.60
  const result = calculateBreakEvenPriceIncVat(15.50, 0.20);
  assert.strictEqual(result, 18.60);
});

// ============================================================================
// AMAZON FEES CALCULATION TESTS
// ============================================================================

test('calculateAmazonFeesExVat: FBM basic referral', () => {
  // £20.00 price, 15% referral = £3.00
  const result = calculateAmazonFeesExVat(20.00, 'FBM', 'General');
  assert.strictEqual(result, 3.00);
});

test('calculateAmazonFeesExVat: FBA includes fulfillment fee', () => {
  // £20.00 price, 15% referral + £2.50 FBA = £5.50
  const result = calculateAmazonFeesExVat(20.00, 'FBA', 'General');
  assert.strictEqual(result, 5.50);
});

test('calculateAmazonFeesExVat: media category adds per-item fee', () => {
  // £20.00 price, 15% referral + £0.50 per-item = £3.50
  const result = calculateAmazonFeesExVat(20.00, 'FBM', 'Books');
  assert.strictEqual(result, 3.50);
});

// ============================================================================
// ACCEPTANCE TEST (SPEC §16.1)
// ============================================================================

test('ACCEPTANCE: Full economics calculation matches SPEC', () => {
  // Given:
  const priceIncVat = 24.00;
  const vatRate = 0.20;
  const bomCostExVat = 6.00;
  const shippingCostExVat = 2.00;
  const packagingCostExVat = 0.50;
  const amazonFeesExVat = 3.00;

  // Calculate:
  const priceExVat = calculatePriceExVat(priceIncVat, vatRate);
  const totalCostExVat = bomCostExVat + shippingCostExVat + packagingCostExVat + amazonFeesExVat;
  const netRevenueExVat = priceExVat;
  const profitExVat = roundMoney(netRevenueExVat - totalCostExVat);
  const margin = roundMoney(profitExVat / netRevenueExVat * 10000) / 10000;

  // Assert:
  assert.strictEqual(priceExVat, 20.00, 'price_ex_vat should be 20.00');
  assert.strictEqual(totalCostExVat, 11.50, 'total_cost_ex_vat should be 11.50');
  assert.strictEqual(profitExVat, 8.50, 'profit_ex_vat should be 8.50');
  assert.strictEqual(margin, 0.425, 'margin should be 0.425');
});

test('ACCEPTANCE: Break-even price calculation', () => {
  // Given total cost ex VAT = 11.50, VAT = 20%
  // Break-even inc VAT = 11.50 * 1.20 = 13.80
  const breakEven = calculateBreakEvenPriceIncVat(11.50, 0.20);
  assert.strictEqual(breakEven, 13.80);
});

// ============================================================================
// EDGE CASES
// ============================================================================

test('Edge case: very small price', () => {
  const priceExVat = calculatePriceExVat(0.01, 0.20);
  assert.strictEqual(priceExVat, 0.01); // Rounds to nearest penny
});

test('Edge case: large price', () => {
  const priceExVat = calculatePriceExVat(9999.99, 0.20);
  assert.strictEqual(priceExVat, 8333.33);
});

test('Edge case: zero price', () => {
  const priceExVat = calculatePriceExVat(0, 0.20);
  assert.strictEqual(priceExVat, 0);
});

console.log('\nEconomics tests complete.');
