/**
 * SP-API Identifiers Normalizer Unit Tests
 *
 * Tests for normalizeSpApiIdentifiers function:
 * - Comma-separated string input
 * - Array input with empty strings and duplicates
 * - Oversized array slicing
 * - Null/undefined/empty array handling
 * - ASIN format validation
 */

import { normalizeSpApiIdentifiers } from '../workers/asin-ingestion-worker.js';

describe('normalizeSpApiIdentifiers', () => {
  describe('valid inputs', () => {
    it('normalizes array of valid ASINs', () => {
      const result = normalizeSpApiIdentifiers(['B001234567', 'B009876543', 'B005555555']);

      expect(result.valid).toBe(true);
      expect(result.identifiers).toBe('B001234567,B009876543,B005555555');
      expect(result.asinArray).toEqual(['B001234567', 'B009876543', 'B005555555']);
      expect(result.skipped).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    it('normalizes comma-separated string input', () => {
      const result = normalizeSpApiIdentifiers('B001234567,B009876543,B005555555');

      expect(result.valid).toBe(true);
      expect(result.identifiers).toBe('B001234567,B009876543,B005555555');
      expect(result.asinArray).toEqual(['B001234567', 'B009876543', 'B005555555']);
      expect(result.skipped).toEqual([]);
    });

    it('handles comma-separated string with spaces', () => {
      const result = normalizeSpApiIdentifiers('B001234567 , B009876543, B005555555 ');

      expect(result.valid).toBe(true);
      expect(result.identifiers).toBe('B001234567,B009876543,B005555555');
      expect(result.asinArray).toHaveLength(3);
    });

    it('converts lowercase ASINs to uppercase', () => {
      const result = normalizeSpApiIdentifiers(['b001234567', 'B009876543']);

      expect(result.valid).toBe(true);
      expect(result.identifiers).toBe('B001234567,B009876543');
    });

    it('handles single ASIN', () => {
      const result = normalizeSpApiIdentifiers(['B001234567']);

      expect(result.valid).toBe(true);
      expect(result.identifiers).toBe('B001234567');
      expect(result.asinArray).toEqual(['B001234567']);
    });
  });

  describe('deduplication', () => {
    it('removes duplicate ASINs', () => {
      const result = normalizeSpApiIdentifiers([
        'B001234567',
        'B009876543',
        'B001234567', // duplicate
        'B005555555',
        'B009876543', // duplicate
      ]);

      expect(result.valid).toBe(true);
      expect(result.asinArray).toEqual(['B001234567', 'B009876543', 'B005555555']);
      expect(result.identifiers).toBe('B001234567,B009876543,B005555555');
    });

    it('deduplicates case-insensitive', () => {
      const result = normalizeSpApiIdentifiers(['B001234567', 'b001234567', 'B001234567']);

      expect(result.valid).toBe(true);
      expect(result.asinArray).toEqual(['B001234567']);
    });
  });

  describe('filtering invalid ASINs', () => {
    it('filters empty strings', () => {
      const result = normalizeSpApiIdentifiers(['B001234567', '', 'B009876543', '  ', 'B005555555']);

      expect(result.valid).toBe(true);
      expect(result.asinArray).toEqual(['B001234567', 'B009876543', 'B005555555']);
      expect(result.skipped).toEqual([]);
    });

    it('filters invalid ASIN formats', () => {
      const result = normalizeSpApiIdentifiers([
        'B001234567',     // valid
        'INVALID',        // too short
        '12345678901234', // too long
        'B00-INVALID',    // contains hyphen
        'B009876543',     // valid
        'ABC123',         // too short
      ]);

      expect(result.valid).toBe(true);
      expect(result.asinArray).toEqual(['B001234567', 'B009876543']);
      expect(result.skipped).toContain('INVALID');
      expect(result.skipped).toContain('12345678901234');
      expect(result.skipped).toContain('B00-INVALID');
      expect(result.skipped).toContain('ABC123');
    });

    it('filters non-string array elements', () => {
      const result = normalizeSpApiIdentifiers([
        'B001234567',
        null,
        undefined,
        123,
        'B009876543',
        { asin: 'B005555555' },
      ]);

      expect(result.valid).toBe(true);
      expect(result.asinArray).toEqual(['B001234567', 'B009876543']);
    });
  });

  describe('batch size limiting', () => {
    it('slices to default maxSize of 20', () => {
      const asins = Array.from({ length: 30 }, (_, i) =>
        `B00${String(i).padStart(7, '0')}`
      );

      const result = normalizeSpApiIdentifiers(asins);

      expect(result.valid).toBe(true);
      expect(result.asinArray).toHaveLength(20);
      expect(result.identifiers.split(',')).toHaveLength(20);
    });

    it('respects custom maxSize option', () => {
      const asins = Array.from({ length: 30 }, (_, i) =>
        `B00${String(i).padStart(7, '0')}`
      );

      const result = normalizeSpApiIdentifiers(asins, { maxSize: 10 });

      expect(result.valid).toBe(true);
      expect(result.asinArray).toHaveLength(10);
    });

    it('does not slice when under maxSize', () => {
      const asins = ['B001234567', 'B009876543', 'B005555555'];

      const result = normalizeSpApiIdentifiers(asins, { maxSize: 20 });

      expect(result.valid).toBe(true);
      expect(result.asinArray).toHaveLength(3);
    });
  });

  describe('invalid inputs - should not call API', () => {
    it('rejects null input', () => {
      const result = normalizeSpApiIdentifiers(null);

      expect(result.valid).toBe(false);
      expect(result.identifiers).toBe('');
      expect(result.asinArray).toEqual([]);
      expect(result.error).toBe('Input is null or undefined');
    });

    it('rejects undefined input', () => {
      const result = normalizeSpApiIdentifiers(undefined);

      expect(result.valid).toBe(false);
      expect(result.identifiers).toBe('');
      expect(result.asinArray).toEqual([]);
      expect(result.error).toBe('Input is null or undefined');
    });

    it('rejects empty array', () => {
      const result = normalizeSpApiIdentifiers([]);

      expect(result.valid).toBe(false);
      expect(result.identifiers).toBe('');
      expect(result.asinArray).toEqual([]);
      expect(result.error).toBe('No valid ASINs after filtering');
    });

    it('rejects empty string', () => {
      const result = normalizeSpApiIdentifiers('');

      expect(result.valid).toBe(false);
      expect(result.identifiers).toBe('');
      expect(result.error).toBe('No valid ASINs after filtering');
    });

    it('rejects array with only invalid ASINs', () => {
      const result = normalizeSpApiIdentifiers(['', 'INVALID', '123']);

      expect(result.valid).toBe(false);
      expect(result.identifiers).toBe('');
      expect(result.asinArray).toEqual([]);
      expect(result.error).toBe('No valid ASINs after filtering');
    });

    it('rejects non-array non-string input', () => {
      const result = normalizeSpApiIdentifiers({ asins: ['B001234567'] });

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid input type: object');
    });

    it('rejects number input', () => {
      const result = normalizeSpApiIdentifiers(12345);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid input type: number');
    });
  });

  describe('edge cases', () => {
    it('handles mixed valid/invalid with comma string', () => {
      const result = normalizeSpApiIdentifiers('B001234567,,INVALID,B009876543,');

      expect(result.valid).toBe(true);
      expect(result.asinArray).toEqual(['B001234567', 'B009876543']);
      expect(result.skipped).toContain('INVALID');
    });

    it('handles ASIN with leading/trailing whitespace in array', () => {
      const result = normalizeSpApiIdentifiers(['  B001234567  ', '  B009876543']);

      expect(result.valid).toBe(true);
      expect(result.asinArray).toEqual(['B001234567', 'B009876543']);
    });

    it('preserves order of first occurrence when deduplicating', () => {
      const result = normalizeSpApiIdentifiers([
        'B003333333',
        'B001111111',
        'B002222222',
        'B001111111', // duplicate
        'B003333333', // duplicate
      ]);

      expect(result.valid).toBe(true);
      expect(result.asinArray).toEqual(['B003333333', 'B001111111', 'B002222222']);
    });
  });
});

describe('SP-API request shape validation', () => {
  it('produces comma-separated string suitable for query param', () => {
    const result = normalizeSpApiIdentifiers(['B001234567', 'B009876543']);

    // The identifiers string should be directly usable in SP-API query
    expect(typeof result.identifiers).toBe('string');
    expect(result.identifiers).not.toContain('[');
    expect(result.identifiers).not.toContain(']');
    expect(result.identifiers).toBe('B001234567,B009876543');
  });

  it('asinArray can be used for result mapping', () => {
    const result = normalizeSpApiIdentifiers('B001234567,B009876543,B005555555');

    // asinArray should be useful for iterating results
    expect(Array.isArray(result.asinArray)).toBe(true);
    expect(result.asinArray.every(a => typeof a === 'string')).toBe(true);
  });
});
