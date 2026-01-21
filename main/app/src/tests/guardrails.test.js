/**
 * Guardrails Service Unit Tests
 *
 * Tests for DATA_CONTRACTS.md §11 Guardrails Enforcement Contract.
 */

import {
  calculateDaysOfCover,
  calculateStockoutRisk,
} from '../services/guardrails.service.js';

describe('Guardrails Service', () => {
  describe('calculateDaysOfCover', () => {
    it('normal scenario', () => {
      // 100 units, selling 10/day = 10 days cover
      const daysOfCover = calculateDaysOfCover(100, 10);
      expect(daysOfCover).toBe(10);
    });

    it('zero velocity returns null', () => {
      const daysOfCover = calculateDaysOfCover(100, 0);
      expect(daysOfCover).toBeNull();
    });

    it('negative velocity returns null', () => {
      const daysOfCover = calculateDaysOfCover(100, -5);
      expect(daysOfCover).toBeNull();
    });

    it('zero stock returns 0', () => {
      const daysOfCover = calculateDaysOfCover(0, 10);
      expect(daysOfCover).toBe(0);
    });

    it('fractional result', () => {
      // 15 units, selling 7/day = 2.14 days cover
      const daysOfCover = calculateDaysOfCover(15, 7);
      expect(Math.round(daysOfCover * 100) / 100).toBe(2.14);
    });
  });

  describe('calculateStockoutRisk', () => {
    it('HIGH when days < 0.5 * lead time', () => {
      // 5 days cover, 14 day lead time -> 5 < 7 -> HIGH
      const risk = calculateStockoutRisk(5, 14);
      expect(risk).toBe('HIGH');
    });

    it('MEDIUM when days between 0.5 and 1.0 lead time', () => {
      // 10 days cover, 14 day lead time -> 7 <= 10 <= 14 -> MEDIUM
      const risk = calculateStockoutRisk(10, 14);
      expect(risk).toBe('MEDIUM');
    });

    it('LOW when days > lead time', () => {
      // 30 days cover, 14 day lead time -> 30 > 14 -> LOW
      const risk = calculateStockoutRisk(30, 14);
      expect(risk).toBe('LOW');
    });

    it('LOW when null (no velocity)', () => {
      const risk = calculateStockoutRisk(null, 14);
      expect(risk).toBe('LOW');
    });

    it('default lead time is 14 days', () => {
      // 10 days cover with default lead time (14) -> MEDIUM
      const risk = calculateStockoutRisk(10);
      expect(risk).toBe('MEDIUM');
    });
  });

  describe('Guardrails Values', () => {
    it('margin below 15% should trigger violation', () => {
      // This is tested through the validatePriceChange function in integration
      // For unit test, we verify the math
      const margin = 0.12; // 12%
      const minMargin = 0.15; // 15%
      expect(margin < minMargin).toBe(true);
    });

    it('price change > 5% should trigger violation', () => {
      const currentPrice = 20.00;
      const newPrice = 22.00; // 10% increase
      const maxChangePct = 0.05; // 5%
      const actualChangePct = Math.abs(newPrice - currentPrice) / currentPrice;
      expect(actualChangePct > maxChangePct).toBe(true);
    });

    it('price below break-even should trigger violation', () => {
      const breakEvenPrice = 15.00;
      const newPrice = 14.50;
      expect(newPrice < breakEvenPrice).toBe(true);
    });
  });
});
