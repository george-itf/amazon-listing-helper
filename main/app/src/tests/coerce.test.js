/**
 * Coerce Helper Unit Tests
 *
 * Critical tests ensuring falsy values (0, false) are NOT corrupted to NULL.
 */

import {
  toNullish,
  toNumber,
  toInteger,
  toBoolean,
  toDate,
  toString,
} from '../lib/coerce.js';

describe('Coerce Helpers', () => {
  describe('toNullish', () => {
    it('preserves 0', () => {
      expect(toNullish(0)).toBe(0);
    });

    it('preserves false', () => {
      expect(toNullish(false)).toBe(false);
    });

    it('preserves empty string', () => {
      expect(toNullish('')).toBe('');
    });

    it('converts null to null', () => {
      expect(toNullish(null)).toBe(null);
    });

    it('converts undefined to null', () => {
      expect(toNullish(undefined)).toBe(null);
    });

    it('preserves valid values', () => {
      expect(toNullish(42)).toBe(42);
      expect(toNullish('hello')).toBe('hello');
      expect(toNullish(true)).toBe(true);
    });
  });

  describe('toNumber', () => {
    it('preserves 0', () => {
      expect(toNumber(0)).toBe(0);
    });

    it('preserves negative zero', () => {
      expect(toNumber(-0)).toBe(-0);
    });

    it('preserves positive numbers', () => {
      expect(toNumber(42)).toBe(42);
      expect(toNumber(3.14)).toBe(3.14);
    });

    it('preserves negative numbers', () => {
      expect(toNumber(-42)).toBe(-42);
      expect(toNumber(-3.14)).toBe(-3.14);
    });

    it('converts null to null', () => {
      expect(toNumber(null)).toBe(null);
    });

    it('converts undefined to null', () => {
      expect(toNumber(undefined)).toBe(null);
    });

    it('converts NaN to null', () => {
      expect(toNumber(NaN)).toBe(null);
    });

    it('converts Infinity to null', () => {
      expect(toNumber(Infinity)).toBe(null);
      expect(toNumber(-Infinity)).toBe(null);
    });

    it('parses numeric strings', () => {
      expect(toNumber('42')).toBe(42);
      expect(toNumber('3.14')).toBe(3.14);
      expect(toNumber('-42')).toBe(-42);
    });

    it('returns null for non-numeric strings', () => {
      expect(toNumber('hello')).toBe(null);
      expect(toNumber('')).toBe(null);
    });
  });

  describe('toInteger', () => {
    it('preserves 0', () => {
      expect(toInteger(0)).toBe(0);
    });

    it('preserves positive integers', () => {
      expect(toInteger(42)).toBe(42);
    });

    it('preserves negative integers', () => {
      expect(toInteger(-42)).toBe(-42);
    });

    it('rounds floats to nearest integer', () => {
      expect(toInteger(3.14)).toBe(3);
      expect(toInteger(3.9)).toBe(4);
      expect(toInteger(-3.5)).toBe(-3);
    });

    it('converts null to null', () => {
      expect(toInteger(null)).toBe(null);
    });

    it('converts undefined to null', () => {
      expect(toInteger(undefined)).toBe(null);
    });

    it('parses integer strings', () => {
      expect(toInteger('42')).toBe(42);
      expect(toInteger('-42')).toBe(-42);
    });
  });

  describe('toBoolean', () => {
    it('preserves false - CRITICAL for is_out_of_stock, is_buy_box_lost, etc.', () => {
      expect(toBoolean(false)).toBe(false);
    });

    it('preserves true', () => {
      expect(toBoolean(true)).toBe(true);
    });

    it('converts null to null', () => {
      expect(toBoolean(null)).toBe(null);
    });

    it('converts undefined to null', () => {
      expect(toBoolean(undefined)).toBe(null);
    });

    it('handles string "true" and "false"', () => {
      expect(toBoolean('true')).toBe(true);
      expect(toBoolean('false')).toBe(false);
      expect(toBoolean('TRUE')).toBe(true);
      expect(toBoolean('FALSE')).toBe(false);
    });

    it('handles numeric 0 and 1', () => {
      expect(toBoolean(0)).toBe(false);
      expect(toBoolean(1)).toBe(true);
    });

    it('returns null for other values', () => {
      expect(toBoolean('yes')).toBe(null);
      expect(toBoolean(42)).toBe(null);
    });
  });

  describe('toString', () => {
    it('returns null for null', () => {
      expect(toString(null)).toBe(null);
    });

    it('returns null for undefined', () => {
      expect(toString(undefined)).toBe(null);
    });

    it('returns null for empty string', () => {
      expect(toString('')).toBe(null);
    });

    it('returns null for whitespace-only string', () => {
      expect(toString('   ')).toBe(null);
      expect(toString('\n\t')).toBe(null);
    });

    it('trims whitespace', () => {
      expect(toString('  hello  ')).toBe('hello');
    });

    it('preserves non-empty strings', () => {
      expect(toString('hello')).toBe('hello');
    });
  });

  describe('toDate', () => {
    it('preserves valid Date objects', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(toDate(date)).toEqual(date);
    });

    it('converts null to null', () => {
      expect(toDate(null)).toBe(null);
    });

    it('converts undefined to null', () => {
      expect(toDate(undefined)).toBe(null);
    });

    it('parses ISO strings', () => {
      const result = toDate('2024-01-15T10:30:00Z');
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe('2024-01-15T10:30:00.000Z');
    });

    it('converts invalid Date to null', () => {
      expect(toDate(new Date('invalid'))).toBe(null);
    });

    it('returns null for invalid strings', () => {
      expect(toDate('not a date')).toBe(null);
    });

    it('handles timestamps', () => {
      const timestamp = 1705312200000; // 2024-01-15T10:30:00Z
      const result = toDate(timestamp);
      expect(result).toBeInstanceOf(Date);
    });
  });

  describe('Critical Falsy Value Preservation', () => {
    // These tests document the key problem we're solving:
    // JavaScript's `value || null` pattern corrupts 0 and false

    it('demonstrates the problem with || null pattern', () => {
      // This is what the OLD code did - WRONG!
      const oldWay = (value) => value || null;

      // These are WRONG - they corrupt valid values
      expect(oldWay(0)).toBe(null);     // Should be 0!
      expect(oldWay(false)).toBe(null); // Should be false!
      expect(oldWay('')).toBe(null);    // Debatable, but || null does this

      // The new coerce functions preserve these
      expect(toInteger(0)).toBe(0);
      expect(toBoolean(false)).toBe(false);
    });

    it('preserves seller_count = 0', () => {
      // seller_count = 0 is a valid value meaning "no other sellers"
      const sellerCount = 0;
      expect(toInteger(sellerCount)).toBe(0);
    });

    it('preserves total_stock = 0', () => {
      // total_stock = 0 is crucial for out-of-stock detection
      const totalStock = 0;
      expect(toInteger(totalStock)).toBe(0);
    });

    it('preserves is_out_of_stock = false', () => {
      // false means "in stock" - converting to NULL loses this info
      const isOutOfStock = false;
      expect(toBoolean(isOutOfStock)).toBe(false);
    });

    it('preserves is_buy_box_lost = false', () => {
      // false means "we have the buy box" - converting to NULL loses this info
      const isBuyBoxLost = false;
      expect(toBoolean(isBuyBoxLost)).toBe(false);
    });

    it('preserves buy_box_is_fba = false', () => {
      // false means "merchant fulfilled" - valid data
      const buyBoxIsFba = false;
      expect(toBoolean(buyBoxIsFba)).toBe(false);
    });

    it('preserves keepa_new_offers = 0', () => {
      // 0 offers is valid data, different from "unknown"
      const keepaNewOffers = 0;
      expect(toInteger(keepaNewOffers)).toBe(0);
    });
  });
});
