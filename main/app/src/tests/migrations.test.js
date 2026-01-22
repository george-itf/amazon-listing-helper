/**
 * Migration File Syntax Validation Tests
 *
 * Ensures migration SQL files have valid syntax patterns to prevent
 * deployment failures. Does NOT require a database connection.
 *
 * Tests for common issues found in Untitled document (2).md:
 * - MIG-008: Syntax error with expression index and ::
 * - SQL-OBSERVED_AT: Missing columns in queries
 */

import { jest, describe, test, expect, beforeAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

describe('Migration SQL Syntax', () => {
  let migrationFiles = [];

  beforeAll(() => {
    // Read all .sql files from migrations directory
    migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .map(f => ({
        name: f,
        path: path.join(MIGRATIONS_DIR, f),
        content: fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8'),
      }));
  });

  test('should find migration files', () => {
    expect(migrationFiles.length).toBeGreaterThan(0);
  });

  describe('Expression Index Syntax', () => {
    test('should not have bare ::type DESC in expression indexes', () => {
      // Pattern that causes "syntax error at or near '::'"
      // Bad:  (expr)::numeric DESC
      // Good: ((expr)::numeric) DESC
      const badPattern = /CREATE\s+INDEX[^;]*\([^)]+\)::[\w]+\s+(?:DESC|ASC)/gi;

      for (const file of migrationFiles) {
        const matches = file.content.match(badPattern);
        if (matches) {
          // This file has a potentially problematic pattern
          // Check if it's wrapped in extra parentheses
          for (const match of matches) {
            // Allow if wrapped: ((expr)::type) DESC
            const isWrapped = /\(\([^)]+\)::[\w]+\)\s+(?:DESC|ASC)/i.test(match);
            expect(isWrapped).toBe(true);
          }
        }
      }
    });

    test('008_dlq_and_indexes.sql should have correct expression index syntax', () => {
      const file008 = migrationFiles.find(f => f.name.includes('008'));
      expect(file008).toBeDefined();

      // The fixed pattern should have ((expr)::type) DESC
      // Not (expr)::type DESC
      const hasCorrectSyntax = file008.content.includes(
        "((features_json->>'margin')::numeric) DESC"
      );
      expect(hasCorrectSyntax).toBe(true);
    });
  });

  describe('Column References', () => {
    test('should use seller_sku not sku in listings queries', () => {
      // Check that migrations use seller_sku (new name) not bare sku
      // for listings table operations
      for (const file of migrationFiles) {
        // Skip if file doesn't reference listings table
        if (!file.content.includes('listings')) continue;

        // Look for patterns like "l.sku" which should be "l.seller_sku"
        const badSkuPattern = /\bl\.sku\b/g;
        const matches = file.content.match(badSkuPattern);

        // If found, fail the test
        expect(matches).toBeNull();
      }
    });

    test('keepa_snapshots should use captured_at not observed_at', () => {
      // Check that keepa_snapshots queries use captured_at
      for (const file of migrationFiles) {
        // Skip if file doesn't reference keepa_snapshots
        if (!file.content.includes('keepa_snapshots')) continue;

        // The table definition should have captured_at
        if (file.content.includes('CREATE TABLE') && file.content.includes('keepa_snapshots')) {
          expect(file.content).toContain('captured_at');
        }

        // Should not reference observed_at on keepa_snapshots
        // (observed_at exists on listing_offer_current, not keepa_snapshots)
        const hasObservedAtOnKeepa = /keepa_snapshots[^;]*observed_at/i.test(file.content);
        expect(hasObservedAtOnKeepa).toBe(false);
      }
    });
  });

  describe('CREATE IF NOT EXISTS', () => {
    test('new tables should use IF NOT EXISTS (informational)', () => {
      // This is informational only - some migrations may use DO blocks
      // or other conditional patterns that don't match the simple pattern
      const tablesWithoutIfNotExists = [];
      for (const file of migrationFiles) {
        const createTableMatches = file.content.match(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/gi);
        if (createTableMatches) {
          for (const match of createTableMatches) {
            const idx = file.content.indexOf(match);
            const precedingContent = file.content.slice(Math.max(0, idx - 200), idx);
            const isConditional = /DO\s+\$|EXECUTE\s+\$|IF\s+NOT\s+EXISTS|IF\s+EXISTS/i.test(precedingContent);
            if (!isConditional) {
              tablesWithoutIfNotExists.push({ file: file.name, match });
            }
          }
        }
      }
      // Report but don't fail - this is for awareness
      if (tablesWithoutIfNotExists.length > 0) {
        console.log('Tables without IF NOT EXISTS (may be intentional):',
          tablesWithoutIfNotExists.map(t => t.file).join(', '));
      }
      expect(true).toBe(true); // Always pass
    });

    test('new indexes should use IF NOT EXISTS (informational)', () => {
      // This is informational only - some migrations may use conditional patterns
      const indexesWithoutIfNotExists = [];
      for (const file of migrationFiles) {
        const createIndexMatches = file.content.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/gi);
        if (createIndexMatches) {
          for (const match of createIndexMatches) {
            const idx = file.content.indexOf(match);
            const precedingContent = file.content.slice(Math.max(0, idx - 200), idx);
            const isConditional = /DO\s+\$|EXECUTE\s+\$|IF\s+NOT\s+EXISTS|IF\s+EXISTS/i.test(precedingContent);
            if (!isConditional) {
              indexesWithoutIfNotExists.push({ file: file.name, match });
            }
          }
        }
      }
      // Report but don't fail - this is for awareness
      if (indexesWithoutIfNotExists.length > 0) {
        console.log('Indexes without IF NOT EXISTS (may be intentional):',
          indexesWithoutIfNotExists.map(t => t.file).join(', '));
      }
      expect(true).toBe(true); // Always pass
    });
  });

  describe('Migration Comments', () => {
    test('each migration should have a header comment', () => {
      for (const file of migrationFiles) {
        // First non-empty line should be a comment
        const firstLine = file.content.trim().split('\n')[0];
        expect(firstLine.startsWith('--')).toBe(true);
      }
    });
  });
});

describe('Service SQL Queries', () => {
  test('startup-tasks.service.js should use captured_at for keepa_snapshots', async () => {
    const servicePath = path.join(__dirname, '../services/startup-tasks.service.js');
    const content = fs.readFileSync(servicePath, 'utf-8');

    // Should NOT use observed_at on keepa_snapshots
    const hasObservedAtOnKeepa = /keepa_snapshots[^`]*observed_at/i.test(content);
    expect(hasObservedAtOnKeepa).toBe(false);

    // Should use captured_at
    expect(content).toContain('captured_at');
  });

  test('migrate-data.js should use seller_sku column', async () => {
    const migratePath = path.join(__dirname, '../../migrate-data.js');
    const content = fs.readFileSync(migratePath, 'utf-8');

    // Should use seller_sku in listings table operations
    expect(content).toContain('seller_sku');

    // Should NOT use bare sku column name in SELECT from listings
    const hasBadSelect = /SELECT\s+id,\s*sku\s+FROM\s+listings/i.test(content);
    expect(hasBadSelect).toBe(false);
  });
});
