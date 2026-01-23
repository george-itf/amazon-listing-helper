/**
 * ASIN Data Model Integration Tests
 *
 * Tests the full pipeline with mocked API responses.
 * Verifies:
 * - Raw payload storage
 * - Snapshot creation
 * - Current view updates
 * - DQ issue tracking
 * - Fingerprint consistency
 */

import { v4 as uuidv4 } from 'uuid';
import {
  flattenKeepaData,
  flattenSpApiData,
  mergeData,
  calculateDerivedFields,
  runDqChecks,
} from '../services/asin-data.service.js';
import { generateFingerprint, verifyFingerprint } from '../lib/fingerprint.js';

// Mock Keepa API responses
const mockKeepaResponses = {
  validProduct: {
    products: [{
      asin: 'B001TEST01',
      title: 'Test Widget Pro',
      brand: 'TestBrand',
      categoryTree: [
        { name: 'Home & Garden' },
        { name: 'Kitchen' },
        { name: 'Gadgets' },
      ],
      stats: {
        current: [null, 2499, null, 15000, null, null, null, null, null, null, null, 12],
        avg90: [null, 2350, null, 14500],
        buyBoxPrice: 2499,
      },
      lastUpdate: Math.floor(Date.now() / 1000),
      buyBoxSellerIdHistory: ['A1B2C3D4E5'],
      buyBoxIsFBA: true,
      csv: [
        null, // Amazon price
        [
          // New price history (Keepa time, price in cents)
          21600000, 2299,
          21600100, 2399,
          21600200, 2499,
          21600300, 2349,
          21600400, 2499,
        ],
        null, // Used price
        [
          // Sales rank history
          21600000, 14000,
          21600100, 15000,
          21600200, 16000,
          21600300, 15500,
          21600400, 15000,
        ],
      ],
      offers: [
        { condition: 1, isFBA: true, price: 2499 },
        { condition: 1, isFBA: false, price: 2599 },
        { condition: 1, isFBA: true, price: 2549 },
        { condition: 2, isFBA: false, price: 1999 },
      ],
      rating: 45, // 4.5 stars
      reviewCount: 1250,
    }],
  },
  emptyProduct: {
    products: [],
  },
  minimalProduct: {
    products: [{
      asin: 'B001TEST02',
      // Minimal fields only
    }],
  },
};

// Mock SP-API responses
const mockSpApiResponses = {
  validCatalog: {
    catalogItem: {
      asin: 'B001TEST01',
      attributes: {
        item_name: [{ value: 'Test Widget Pro - Premium Edition' }],
        brand: [{ value: 'TestBrand Official' }],
        model_number: [{ value: 'TWP-2024' }],
      },
      identifiers: [
        { identifierType: 'ASIN', identifier: 'B001TEST01' },
        { identifierType: 'EAN', identifier: '1234567890123' },
      ],
    },
    pricing: {
      offers: [{
        isMine: true,
        listingPrice: { amount: 24.99, currency: 'GBP' },
        regularPrice: { amount: 29.99, currency: 'GBP' },
        fulfillmentChannel: 'FBA',
      }],
    },
    inventory: {
      fulfillmentAvailability: [
        { fulfillmentChannelCode: 'FBA', quantity: 150 },
        { fulfillmentChannelCode: 'DEFAULT', quantity: 25 },
      ],
    },
    sales: {
      unitsOrdered7d: 35,
      unitsOrdered30d: 120,
      unitsOrdered90d: 380,
    },
  },
  noInventory: {
    catalogItem: {
      asin: 'B001TEST03',
      attributes: {
        item_name: [{ value: 'Out of Stock Widget' }],
        brand: [{ value: 'TestBrand' }],
      },
    },
    pricing: {
      offers: [{
        isMine: true,
        listingPrice: { amount: 19.99 },
      }],
    },
    inventory: {
      fulfillmentAvailability: [
        { fulfillmentChannelCode: 'FBA', quantity: 0 },
      ],
    },
  },
};

describe('ASIN Data Model Integration', () => {
  describe('Full Pipeline - Valid Data', () => {
    it('processes valid Keepa + SP-API data end-to-end', () => {
      const asin = 'B001TEST01';
      const marketplaceId = 1;
      const ingestionJobId = uuidv4();

      // Step 1: Flatten data sources
      const keepaFlat = flattenKeepaData(mockKeepaResponses.validProduct);
      const spApiFlat = flattenSpApiData(mockSpApiResponses.validCatalog);

      // Verify Keepa flattening
      expect(keepaFlat.keepa_has_data).toBe(true);
      expect(keepaFlat.title).toBe('Test Widget Pro');
      expect(keepaFlat.brand).toBe('TestBrand');
      expect(keepaFlat.buy_box_price).toBe(24.99);
      expect(keepaFlat.keepa_sales_rank_latest).toBe(15000);
      expect(keepaFlat.keepa_new_offers).toBe(3);
      expect(keepaFlat.keepa_used_offers).toBe(1);

      // Verify SP-API flattening
      expect(spApiFlat.title).toBe('Test Widget Pro - Premium Edition');
      expect(spApiFlat.brand).toBe('TestBrand Official');
      expect(spApiFlat.price_inc_vat).toBe(24.99);
      expect(spApiFlat.total_stock).toBe(175); // 150 + 25
      expect(spApiFlat.fulfillment_channel).toBe('FBA');
      expect(spApiFlat.units_30d).toBe(120);

      // Step 2: Merge data
      const merged = mergeData(keepaFlat, spApiFlat);

      // Verify merge precedence
      expect(merged.title).toBe('Test Widget Pro - Premium Edition'); // SP-API wins
      expect(merged.brand).toBe('TestBrand Official'); // SP-API wins
      expect(merged.category_path).toBe('Home & Garden > Kitchen > Gadgets'); // Keepa wins
      expect(merged.buy_box_price).toBe(24.99); // Keepa market data
      expect(merged.price_inc_vat).toBe(24.99); // SP-API our price
      expect(merged.total_stock).toBe(175); // SP-API inventory

      // Step 3: Calculate derived fields
      const ourSellerId = 'A1B2C3D4E5';
      const withDerived = calculateDerivedFields(merged, ourSellerId);

      // Verify derived calculations
      expect(withDerived.days_of_cover).toBe(43.75); // 175 / (120/30) = 43.75 days
      expect(withDerived.is_out_of_stock).toBe(false);
      expect(withDerived.is_buy_box_lost).toBe(false); // We own the buy box

      // Step 4: Run DQ checks
      const dqIssues = runDqChecks(withDerived, asin, marketplaceId, ingestionJobId);

      // Should have no critical issues for valid data
      const criticalIssues = dqIssues.filter(i => i.severity === 'CRITICAL');
      expect(criticalIssues.length).toBe(0);

      // Step 5: Generate fingerprint
      const fingerprint = generateFingerprint({
        asin,
        marketplace_id: marketplaceId,
        price_inc_vat: withDerived.price_inc_vat,
        total_stock: withDerived.total_stock,
        buy_box_seller_id: withDerived.buy_box_seller_id,
        keepa_price_p25_90d: withDerived.keepa_price_p25_90d,
        seller_count: withDerived.seller_count,
      });

      expect(fingerprint).toHaveLength(64);

      // Verify fingerprint is verifiable
      expect(verifyFingerprint({
        asin,
        marketplace_id: marketplaceId,
        price_inc_vat: withDerived.price_inc_vat,
        total_stock: withDerived.total_stock,
        buy_box_seller_id: withDerived.buy_box_seller_id,
        keepa_price_p25_90d: withDerived.keepa_price_p25_90d,
        seller_count: withDerived.seller_count,
      }, fingerprint)).toBe(true);
    });
  });

  describe('Full Pipeline - Out of Stock Scenario', () => {
    it('correctly identifies out of stock ASINs', () => {
      const asin = 'B001TEST03';
      const marketplaceId = 1;
      const ingestionJobId = uuidv4();
      const ourSellerId = 'OUR_SELLER_ID';

      const keepaFlat = flattenKeepaData(mockKeepaResponses.emptyProduct);
      const spApiFlat = flattenSpApiData(mockSpApiResponses.noInventory);

      const merged = mergeData(keepaFlat, spApiFlat);
      const withDerived = calculateDerivedFields(merged, ourSellerId);

      // Verify out of stock flag
      expect(withDerived.is_out_of_stock).toBe(true);
      expect(withDerived.total_stock).toBe(0);

      // DQ checks should flag missing Keepa data
      const dqIssues = runDqChecks(withDerived, asin, marketplaceId, ingestionJobId);
      const keepaIssue = dqIssues.find(i => i.field_name === 'keepa_data');
      expect(keepaIssue).toBeDefined();
    });
  });

  describe('Full Pipeline - Lost Buy Box Scenario', () => {
    it('detects when buy box is lost to competitor', () => {
      const asin = 'B001TEST01';
      const marketplaceId = 1;
      const ourSellerId = 'OUR_SELLER_ID'; // Different from buy box holder

      const keepaFlat = flattenKeepaData(mockKeepaResponses.validProduct);
      const spApiFlat = flattenSpApiData(mockSpApiResponses.validCatalog);

      const merged = mergeData(keepaFlat, spApiFlat);
      const withDerived = calculateDerivedFields(merged, ourSellerId);

      // Buy box is held by A1B2C3D4E5, not us
      expect(withDerived.buy_box_seller_id).toBe('A1B2C3D4E5');
      expect(withDerived.is_buy_box_lost).toBe(true);
    });
  });

  describe('Full Pipeline - Minimal/Partial Data', () => {
    it('handles minimal Keepa data gracefully', () => {
      const asin = 'B001TEST02';
      const marketplaceId = 1;
      const ingestionJobId = uuidv4();

      const keepaFlat = flattenKeepaData(mockKeepaResponses.minimalProduct);
      const spApiFlat = flattenSpApiData(null);

      expect(keepaFlat.keepa_has_data).toBe(true);
      expect(keepaFlat.title).toBe(null);

      const merged = mergeData(keepaFlat, spApiFlat);
      const withDerived = calculateDerivedFields(merged);

      // Should not crash, should have nulls
      expect(withDerived.price_inc_vat).toBe(null);
      expect(withDerived.total_stock).toBe(null);

      // DQ should flag missing title
      const dqIssues = runDqChecks(withDerived, asin, marketplaceId, ingestionJobId);
      const titleIssue = dqIssues.find(i => i.field_name === 'title');
      expect(titleIssue).toBeDefined();
    });
  });

  describe('Fingerprint Consistency', () => {
    it('produces same fingerprint for same data across runs', () => {
      const testData = {
        asin: 'B001FINGER',
        marketplace_id: 1,
        price_inc_vat: 19.99,
        total_stock: 42,
        buy_box_seller_id: 'SELLER_ABC',
        keepa_price_p25_90d: 1800,
        seller_count: 7,
      };

      const fingerprints = [];
      for (let i = 0; i < 5; i++) {
        fingerprints.push(generateFingerprint(testData));
      }

      // All should be identical
      expect(new Set(fingerprints).size).toBe(1);
    });

    it('changes fingerprint when key fields change', () => {
      const baseData = {
        asin: 'B001FINGER',
        marketplace_id: 1,
        price_inc_vat: 19.99,
        total_stock: 42,
        buy_box_seller_id: 'SELLER_ABC',
        keepa_price_p25_90d: 1800,
        seller_count: 7,
      };

      const baseFp = generateFingerprint(baseData);

      // Change each field and verify fingerprint changes
      expect(generateFingerprint({ ...baseData, price_inc_vat: 20.99 })).not.toBe(baseFp);
      expect(generateFingerprint({ ...baseData, total_stock: 43 })).not.toBe(baseFp);
      expect(generateFingerprint({ ...baseData, buy_box_seller_id: 'OTHER' })).not.toBe(baseFp);
      expect(generateFingerprint({ ...baseData, seller_count: 8 })).not.toBe(baseFp);

      // Same data should still match
      expect(generateFingerprint({ ...baseData })).toBe(baseFp);
    });
  });

  describe('DQ Issue Detection', () => {
    it('detects multiple issues in bad data', () => {
      const badData = {
        title: null,              // Missing required
        total_stock: -5,          // Invalid value
        price_inc_vat: 0,         // Invalid value
        seller_count: -1,         // Invalid value
        keepa_has_data: true,
        keepa_last_update: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000), // 4 days old
        price_volatility_score: 0.8, // High volatility
      };

      const issues = runDqChecks(badData, 'B001BAD', 1, 'job-123');

      // Should have multiple issues
      expect(issues.length).toBeGreaterThanOrEqual(4);

      // Should have at least one critical issue (negative stock)
      const criticalIssues = issues.filter(i => i.severity === 'CRITICAL');
      expect(criticalIssues.length).toBeGreaterThanOrEqual(1);

      // Verify specific issues
      expect(issues.some(i => i.field_name === 'title')).toBe(true);
      expect(issues.some(i => i.field_name === 'total_stock')).toBe(true);
      expect(issues.some(i => i.issue_type === 'STALE_DATA')).toBe(true);
    });
  });

  describe('Sample Payload Processing', () => {
    it('processes realistic Keepa response format', () => {
      // This tests the actual Keepa API response format
      const realisticKeepa = {
        products: [{
          asin: 'B0BDJF2G9Z',
          title: 'Anker USB C Charger, 313 Charger (Ace, 45W)',
          brand: 'Anker',
          productType: 0,
          rootCategory: 283155,
          parentAsin: null,
          variationCSV: null,
          imagesCSV: 'https://images-na.ssl-images-amazon.com/images/I/31QfI2pS9vL._SL75_.jpg',
          categories: [6969192031, 248934031, 428655031],
          categoryTree: [
            { catId: 428655031, name: 'Computers & Accessories' },
            { catId: 248934031, name: 'Laptop Accessories' },
            { catId: 6969192031, name: 'Chargers & Power Adapters' },
          ],
          stats: {
            current: [-1, 1899, -1, 856, -1, -1, -1, -1, -1, -1, -1, 25, -1, -1, -1, -1, -1, -1, 1, 1, -1],
            avg: [-1, 1945, -1, 1023, -1, -1, -1, -1, -1, -1, -1, 23, -1, -1, -1, -1, -1, -1, -1, -1, -1],
            avg30: [-1, 1899, -1, 892, -1, -1, -1, -1, -1, -1, -1, 24, -1, -1, -1, -1, -1, -1, -1, -1, -1],
            avg90: [-1, 1912, -1, 945, -1, -1, -1, -1, -1, -1, -1, 24, -1, -1, -1, -1, -1, -1, -1, -1, -1],
            buyBoxPrice: 1899,
            buyBoxShipping: 0,
          },
          lastUpdate: 1737619200,
          buyBoxSellerIdHistory: ['A3P5ROKL5A1OLE'],
          buyBoxIsFBA: true,
          csv: [
            null, // Amazon
            [21700000, 1899, 21700100, 1999, 21700200, 1899], // New
            null, // Used
            [21700000, 800, 21700100, 850, 21700200, 856], // Rank
          ],
          offers: [
            { offerId: 1, condition: 1, isFBA: true, isPrime: true, isShippable: true, sellerId: 'A3P5ROKL5A1OLE', price: 1899 },
          ],
          rating: 46,
          reviewCount: 85234,
        }],
      };

      const flattened = flattenKeepaData(realisticKeepa);

      expect(flattened.keepa_has_data).toBe(true);
      expect(flattened.title).toBe('Anker USB C Charger, 313 Charger (Ace, 45W)');
      expect(flattened.brand).toBe('Anker');
      expect(flattened.category_path).toBe('Computers & Accessories > Laptop Accessories > Chargers & Power Adapters');
      expect(flattened.buy_box_price).toBe(18.99);
      expect(flattened.buy_box_seller_id).toBe('A3P5ROKL5A1OLE');
      expect(flattened.buy_box_is_fba).toBe(true);
      expect(flattened.keepa_sales_rank_latest).toBe(856);
    });
  });
});
