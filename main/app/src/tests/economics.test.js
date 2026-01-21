/**
 * Economics Service Unit Tests
 *
 * Tests for DATA_CONTRACTS.md §4 Economics DTO Contract.
 * Acceptance test from SPEC §16.1:
 *   price_inc_vat=24.00, vat_rate=0.20 -> price_ex_vat=20.00
 *   bom=6.00, ship=2.00, pack=0.50, fees=3.00
 *   profit_ex_vat=8.50, margin=0.425
 */

import {
  roundMoney,
  calculatePriceExVat,
  calculateBreakEvenPriceIncVat,
  calculateAmazonFeesExVat,
} from '../services/economics.service.js';

describe('Economics Service', () => {
  describe('roundMoney', () => {
    it('rounds to 2 decimal places', () => {
      expect(roundMoney(10.125)).toBe(10.13);
      expect(roundMoney(10.124)).toBe(10.12);
      expect(roundMoney(10.1)).toBe(10.1);
      expect(roundMoney(10)).toBe(10);
    });

    it('handles negative numbers', () => {
      expect(roundMoney(-10.125)).toBe(-10.12);
      expect(roundMoney(-10.126)).toBe(-10.13);
    });

    it('handles zero', () => {
      expect(roundMoney(0)).toBe(0);
      expect(roundMoney(-0)).toBe(0);
    });
  });

  describe('calculatePriceExVat', () => {
    it('UK VAT 20%', () => {
      // £24.00 inc VAT at 20% = £20.00 ex VAT
      const result = calculatePriceExVat(24.00, 0.20);
      expect(result).toBe(20.00);
    });

    it('zero VAT', () => {
      const result = calculatePriceExVat(24.00, 0);
      expect(result).toBe(24.00);
    });

    it('different VAT rates', () => {
      // 5% VAT: £10.50 / 1.05 = £10.00
      expect(calculatePriceExVat(10.50, 0.05)).toBe(10.00);

      // 19% VAT (Germany): €11.90 / 1.19 = €10.00
      expect(calculatePriceExVat(11.90, 0.19)).toBe(10.00);
    });
  });

  describe('calculateBreakEvenPriceIncVat', () => {
    it('basic calculation', () => {
      // Total cost ex VAT = £10.00, VAT = 20%
      // Break-even inc VAT = £10.00 * 1.20 = £12.00
      const result = calculateBreakEvenPriceIncVat(10.00, 0.20);
      expect(result).toBe(12.00);
    });

    it('zero cost', () => {
      const result = calculateBreakEvenPriceIncVat(0, 0.20);
      expect(result).toBe(0);
    });

    it('high cost scenario', () => {
      // Total cost = £15.50, VAT = 20%
      // Break-even = £15.50 * 1.20 = £18.60
      const result = calculateBreakEvenPriceIncVat(15.50, 0.20);
      expect(result).toBe(18.60);
    });
  });

  describe('calculateAmazonFeesExVat', () => {
    it('FBM basic referral', () => {
      // £20.00 price, 15% referral = £3.00
      const result = calculateAmazonFeesExVat(20.00, 'FBM', 'General');
      expect(result).toBe(3.00);
    });

    it('FBA includes fulfillment fee', () => {
      // £20.00 price, 15% referral + £2.50 FBA = £5.50
      const result = calculateAmazonFeesExVat(20.00, 'FBA', 'General');
      expect(result).toBe(5.50);
    });

    it('media category adds per-item fee', () => {
      // £20.00 price, 15% referral + £0.50 per-item = £3.50
      const result = calculateAmazonFeesExVat(20.00, 'FBM', 'Books');
      expect(result).toBe(3.50);
    });
  });

  describe('Acceptance Tests (SPEC §16.1)', () => {
    it('full economics calculation matches SPEC', () => {
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
      expect(priceExVat).toBe(20.00);
      expect(totalCostExVat).toBe(11.50);
      expect(profitExVat).toBe(8.50);
      expect(margin).toBe(0.425);
    });

    it('break-even price calculation', () => {
      // Given total cost ex VAT = 11.50, VAT = 20%
      // Break-even inc VAT = 11.50 * 1.20 = 13.80
      const breakEven = calculateBreakEvenPriceIncVat(11.50, 0.20);
      expect(breakEven).toBe(13.80);
    });
  });

  describe('Edge Cases', () => {
    it('very small price', () => {
      const priceExVat = calculatePriceExVat(0.01, 0.20);
      expect(priceExVat).toBe(0.01); // Rounds to nearest penny
    });

    it('large price', () => {
      const priceExVat = calculatePriceExVat(9999.99, 0.20);
      expect(priceExVat).toBe(8333.33);
    });

    it('zero price', () => {
      const priceExVat = calculatePriceExVat(0, 0.20);
      expect(priceExVat).toBe(0);
    });
  });
});
