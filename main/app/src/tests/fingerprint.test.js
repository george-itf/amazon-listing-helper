/**
 * Fingerprint Generation Unit Tests
 *
 * Tests for deterministic fingerprint generation per specification:
 * - Canonical input fields (exact order)
 * - Explicit null for missing values
 * - Deterministic JSON serialization
 * - SHA-256 hashing
 */

import {
  generateFingerprint,
  verifyFingerprint,
  hasChanged,
  buildFingerprintInput,
  serializeFingerprintInput,
  hashFingerprint,
  toPence,
  toIntOrNull,
  toStringOrNull,
} from '../lib/fingerprint.js';

describe('Fingerprint Generation', () => {
  describe('toPence', () => {
    it('converts pounds to pence', () => {
      expect(toPence(10.50)).toBe(1050);
      expect(toPence(0.99)).toBe(99);
      expect(toPence(100.00)).toBe(10000);
    });

    it('handles edge cases', () => {
      expect(toPence(null)).toBe(null);
      expect(toPence(undefined)).toBe(null);
      expect(toPence(0)).toBe(0);
      expect(toPence('invalid')).toBe(null);
    });

    it('rounds to nearest pence', () => {
      expect(toPence(10.999)).toBe(1100);
      expect(toPence(10.001)).toBe(1000);
      expect(toPence(10.005)).toBe(1001);
    });
  });

  describe('toIntOrNull', () => {
    it('converts to integer', () => {
      expect(toIntOrNull(42)).toBe(42);
      expect(toIntOrNull('42')).toBe(42);
      expect(toIntOrNull(42.7)).toBe(42);
    });

    it('returns null for invalid inputs', () => {
      expect(toIntOrNull(null)).toBe(null);
      expect(toIntOrNull(undefined)).toBe(null);
      expect(toIntOrNull('invalid')).toBe(null);
      expect(toIntOrNull(NaN)).toBe(null);
    });
  });

  describe('toStringOrNull', () => {
    it('converts to string', () => {
      expect(toStringOrNull('test')).toBe('test');
      expect(toStringOrNull(123)).toBe('123');
    });

    it('returns null for empty/missing values', () => {
      expect(toStringOrNull(null)).toBe(null);
      expect(toStringOrNull(undefined)).toBe(null);
      expect(toStringOrNull('')).toBe(null);
    });
  });

  describe('buildFingerprintInput', () => {
    it('builds canonical object with all fields', () => {
      const data = {
        asin: 'B001234567',
        marketplace_id: 1,
        price_inc_vat: 24.99,
        total_stock: 100,
        buy_box_seller_id: 'SELLER123',
        keepa_price_p25_90d: 2000, // Already in pence
        seller_count: 5,
      };

      const result = buildFingerprintInput(data);

      expect(result).toEqual({
        asin: 'B001234567',
        marketplace: 'UK',
        price_inc_vat_pence: 2499,
        total_stock: 100,
        buy_box_seller_id: 'SELLER123',
        keepa_price_p25_90d_pence: 2000,
        seller_count: 5,
      });
    });

    it('includes null for missing values', () => {
      const data = {
        asin: 'B001234567',
        marketplace_id: 1,
        // All optional fields missing
      };

      const result = buildFingerprintInput(data);

      expect(result).toEqual({
        asin: 'B001234567',
        marketplace: 'UK',
        price_inc_vat_pence: null,
        total_stock: null,
        buy_box_seller_id: null,
        keepa_price_p25_90d_pence: null,
        seller_count: null,
      });
    });

    it('throws error for missing ASIN', () => {
      expect(() => buildFingerprintInput({ marketplace_id: 1 })).toThrow('ASIN is required');
    });

    it('throws error for missing marketplace_id', () => {
      expect(() => buildFingerprintInput({ asin: 'B001234567' })).toThrow('marketplace_id is required');
    });

    it('handles different marketplace IDs', () => {
      expect(buildFingerprintInput({ asin: 'B001', marketplace_id: 2 }).marketplace).toBe('DE');
      expect(buildFingerprintInput({ asin: 'B001', marketplace_id: 6 }).marketplace).toBe('US');
      expect(buildFingerprintInput({ asin: 'B001', marketplace_id: 99 }).marketplace).toBe('MARKETPLACE_99');
    });
  });

  describe('serializeFingerprintInput', () => {
    it('serializes deterministically with sorted keys', () => {
      const input1 = {
        asin: 'B001234567',
        marketplace: 'UK',
        price_inc_vat_pence: 2499,
        total_stock: 100,
        buy_box_seller_id: 'SELLER123',
        keepa_price_p25_90d_pence: 2000,
        seller_count: 5,
      };

      const input2 = {
        seller_count: 5,
        asin: 'B001234567',
        total_stock: 100,
        marketplace: 'UK',
        buy_box_seller_id: 'SELLER123',
        price_inc_vat_pence: 2499,
        keepa_price_p25_90d_pence: 2000,
      };

      // Same data, different order - should serialize identically
      expect(serializeFingerprintInput(input1)).toBe(serializeFingerprintInput(input2));
    });

    it('includes nulls explicitly', () => {
      const input = {
        asin: 'B001234567',
        marketplace: 'UK',
        price_inc_vat_pence: null,
        total_stock: null,
        buy_box_seller_id: null,
        keepa_price_p25_90d_pence: null,
        seller_count: null,
      };

      const serialized = serializeFingerprintInput(input);
      expect(serialized).toContain('"price_inc_vat_pence":null');
      expect(serialized).toContain('"total_stock":null');
    });
  });

  describe('hashFingerprint', () => {
    it('produces 64-character hex digest', () => {
      const hash = hashFingerprint('test input');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it('produces different hashes for different inputs', () => {
      const hash1 = hashFingerprint('input 1');
      const hash2 = hashFingerprint('input 2');
      expect(hash1).not.toBe(hash2);
    });

    it('produces same hash for same input', () => {
      const hash1 = hashFingerprint('test');
      const hash2 = hashFingerprint('test');
      expect(hash1).toBe(hash2);
    });
  });

  describe('generateFingerprint', () => {
    it('generates consistent fingerprint for same data', () => {
      const data = {
        asin: 'B001234567',
        marketplace_id: 1,
        price_inc_vat: 24.99,
        total_stock: 100,
        buy_box_seller_id: 'SELLER123',
        keepa_price_p25_90d: 2000,
        seller_count: 5,
      };

      const hash1 = generateFingerprint(data);
      const hash2 = generateFingerprint(data);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('generates different fingerprint when data changes', () => {
      const data1 = {
        asin: 'B001234567',
        marketplace_id: 1,
        price_inc_vat: 24.99,
        total_stock: 100,
      };

      const data2 = {
        asin: 'B001234567',
        marketplace_id: 1,
        price_inc_vat: 25.99, // Changed price
        total_stock: 100,
      };

      const hash1 = generateFingerprint(data1);
      const hash2 = generateFingerprint(data2);

      expect(hash1).not.toBe(hash2);
    });

    it('generates same fingerprint regardless of field order', () => {
      const data1 = {
        asin: 'B001234567',
        marketplace_id: 1,
        price_inc_vat: 24.99,
        total_stock: 100,
      };

      const data2 = {
        total_stock: 100,
        marketplace_id: 1,
        asin: 'B001234567',
        price_inc_vat: 24.99,
      };

      const hash1 = generateFingerprint(data1);
      const hash2 = generateFingerprint(data2);

      expect(hash1).toBe(hash2);
    });

    it('handles minimal data (only required fields)', () => {
      const data = {
        asin: 'B001234567',
        marketplace_id: 1,
      };

      const hash = generateFingerprint(data);
      expect(hash).toHaveLength(64);
    });
  });

  describe('verifyFingerprint', () => {
    it('returns true for matching fingerprint', () => {
      const data = {
        asin: 'B001234567',
        marketplace_id: 1,
        price_inc_vat: 24.99,
      };

      const hash = generateFingerprint(data);
      expect(verifyFingerprint(data, hash)).toBe(true);
    });

    it('returns false for non-matching fingerprint', () => {
      const data = {
        asin: 'B001234567',
        marketplace_id: 1,
        price_inc_vat: 24.99,
      };

      expect(verifyFingerprint(data, 'wrong_hash')).toBe(false);
    });
  });

  describe('hasChanged', () => {
    it('detects changes', () => {
      expect(hasChanged('abc123', 'def456')).toBe(true);
    });

    it('detects no change', () => {
      expect(hasChanged('abc123', 'abc123')).toBe(false);
    });
  });

  describe('Determinism', () => {
    it('produces identical fingerprints across multiple runs', () => {
      // This test ensures fingerprints are reproducible
      const testData = {
        asin: 'B000TEST01',
        marketplace_id: 1,
        price_inc_vat: 19.99,
        total_stock: 50,
        buy_box_seller_id: 'ABC123',
        keepa_price_p25_90d: 1800,
        seller_count: 3,
      };

      const hashes = [];
      for (let i = 0; i < 10; i++) {
        hashes.push(generateFingerprint(testData));
      }

      // All hashes should be identical
      const allSame = hashes.every(h => h === hashes[0]);
      expect(allSame).toBe(true);
    });

    it('handles floating point precision correctly', () => {
      // Floating point can be tricky - ensure we handle it
      const data1 = {
        asin: 'B001234567',
        marketplace_id: 1,
        price_inc_vat: 0.1 + 0.2, // 0.30000000000000004
      };

      const data2 = {
        asin: 'B001234567',
        marketplace_id: 1,
        price_inc_vat: 0.3,
      };

      // Both should round to 30 pence
      const hash1 = generateFingerprint(data1);
      const hash2 = generateFingerprint(data2);

      expect(hash1).toBe(hash2);
    });
  });
});
