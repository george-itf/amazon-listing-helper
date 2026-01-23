/**
 * ASIN Data Service Unit Tests
 *
 * Tests for:
 * - Keepa data flattening
 * - SP-API data flattening
 * - Data merging
 * - Derived field calculation
 * - DQ rule triggering
 */

import {
  flattenKeepaData,
  flattenSpApiData,
  mergeData,
  calculateDerivedFields,
  runDqChecks,
} from '../services/asin-data.service.js';

describe('ASIN Data Service', () => {
  describe('flattenKeepaData', () => {
    it('flattens complete Keepa product data', () => {
      const keepaPayload = {
        products: [{
          asin: 'B001234567',
          title: 'Test Product',
          brand: 'Test Brand',
          categoryTree: [
            { name: 'Electronics' },
            { name: 'Computers' },
          ],
          stats: {
            current: [
              1999, // Amazon price (index 0)
              2199, // New price (index 1)
              null, // Used price (index 2)
              5000, // Sales rank (index 3)
            ],
            buyBoxPrice: 2199,
          },
          lastUpdate: Math.floor(Date.now() / 1000),
          buyBoxSellerIdHistory: ['SELLER123'],
          buyBoxIsFBA: true,
          csv: [
            null, // Amazon price history
            [21564000, 2000, 21564001, 2100, 21564002, 2200], // New price history
          ],
          offers: [
            { condition: 1, isFBA: true },
            { condition: 1, isFBA: false },
            { condition: 2, isFBA: false },
          ],
        }],
      };

      const result = flattenKeepaData(keepaPayload);

      expect(result.keepa_has_data).toBe(true);
      expect(result.title).toBe('Test Product');
      expect(result.brand).toBe('Test Brand');
      expect(result.category_path).toBe('Electronics > Computers');
      expect(result.keepa_sales_rank_latest).toBe(5000);
      expect(result.buy_box_price).toBe(21.99);
      expect(result.buy_box_seller_id).toBe('SELLER123');
      expect(result.buy_box_is_fba).toBe(true);
      expect(result.keepa_new_offers).toBe(2);
      expect(result.keepa_used_offers).toBe(1);
    });

    it('handles empty Keepa response', () => {
      const result = flattenKeepaData(null);

      expect(result.keepa_has_data).toBe(false);
      expect(result.title).toBe(null);
      expect(result.brand).toBe(null);
      expect(result.keepa_price_median_90d).toBe(null);
    });

    it('handles Keepa response with no products', () => {
      const result = flattenKeepaData({ products: [] });

      expect(result.keepa_has_data).toBe(false);
    });

    it('handles missing optional fields gracefully', () => {
      const keepaPayload = {
        products: [{
          asin: 'B001234567',
          // Minimal data
        }],
      };

      const result = flattenKeepaData(keepaPayload);

      expect(result.keepa_has_data).toBe(true);
      expect(result.title).toBe(null);
      expect(result.brand).toBe(null);
      expect(result.category_path).toBe(null);
    });
  });

  describe('flattenSpApiData', () => {
    it('flattens complete SP-API data', () => {
      const spApiPayload = {
        catalogItem: {
          asin: 'B001234567',
          attributes: {
            item_name: [{ value: 'SP-API Product Title' }],
            brand: [{ value: 'SP-API Brand' }],
          },
        },
        pricing: {
          offers: [{
            isMine: true,
            listingPrice: { amount: 29.99 },
            regularPrice: { amount: 34.99 },
          }],
        },
        inventory: {
          fulfillmentAvailability: [{
            fulfillmentChannelCode: 'FBA',
            quantity: 100,
          }],
        },
        sales: {
          unitsOrdered7d: 10,
          unitsOrdered30d: 45,
          unitsOrdered90d: 150,
        },
      };

      const result = flattenSpApiData(spApiPayload);

      expect(result.title).toBe('SP-API Product Title');
      expect(result.brand).toBe('SP-API Brand');
      expect(result.price_inc_vat).toBe(29.99);
      expect(result.price_ex_vat).toBe(24.99); // 29.99 / 1.20
      expect(result.list_price).toBe(34.99);
      expect(result.total_stock).toBe(100);
      expect(result.fulfillment_channel).toBe('FBA');
      expect(result.units_7d).toBe(10);
      expect(result.units_30d).toBe(45);
      expect(result.units_90d).toBe(150);
    });

    it('handles null SP-API data', () => {
      const result = flattenSpApiData(null);

      expect(result.title).toBe(null);
      expect(result.price_inc_vat).toBe(null);
      expect(result.total_stock).toBe(null);
    });

    it('handles partial SP-API data', () => {
      const spApiPayload = {
        catalogItem: {
          asin: 'B001234567',
          attributes: {
            item_name: [{ value: 'Product Title' }],
          },
        },
        // No pricing or inventory
      };

      const result = flattenSpApiData(spApiPayload);

      expect(result.title).toBe('Product Title');
      expect(result.price_inc_vat).toBe(null);
      expect(result.total_stock).toBe(null);
    });
  });

  describe('mergeData', () => {
    it('merges Keepa and SP-API data with correct precedence', () => {
      const keepaData = {
        title: 'Keepa Title',
        brand: 'Keepa Brand',
        category_path: 'Electronics > Gadgets',
        buy_box_price: 21.99,
        buy_box_seller_id: 'SELLER123',
        buy_box_is_fba: true,
        seller_count: 5,
        keepa_has_data: true,
        keepa_last_update: new Date(),
        keepa_price_p25_90d: 1900,
        keepa_price_median_90d: 2100,
        keepa_price_p75_90d: 2300,
        keepa_lowest_90d: 1800,
        keepa_highest_90d: 2500,
        keepa_sales_rank_latest: 5000,
        keepa_new_offers: 4,
        keepa_used_offers: 2,
        price_volatility_score: 0.12,
      };

      const spApiData = {
        title: 'SP-API Title', // Should take precedence
        brand: 'SP-API Brand', // Should take precedence
        price_inc_vat: 24.99,
        price_ex_vat: 20.83,
        list_price: 29.99,
        total_stock: 150,
        fulfillment_channel: 'FBA',
        units_7d: 20,
        units_30d: 80,
        units_90d: 250,
      };

      const result = mergeData(keepaData, spApiData);

      // SP-API takes precedence for our own data
      expect(result.title).toBe('SP-API Title');
      expect(result.brand).toBe('SP-API Brand');
      expect(result.price_inc_vat).toBe(24.99);
      expect(result.total_stock).toBe(150);

      // Keepa provides market data
      expect(result.category_path).toBe('Electronics > Gadgets');
      expect(result.buy_box_price).toBe(21.99);
      expect(result.buy_box_seller_id).toBe('SELLER123');
      expect(result.seller_count).toBe(5);
      expect(result.keepa_price_median_90d).toBe(2100);
    });

    it('falls back to Keepa when SP-API data is missing', () => {
      const keepaData = {
        title: 'Keepa Title',
        brand: 'Keepa Brand',
        keepa_has_data: true,
      };

      const spApiData = {
        title: null,
        brand: null,
      };

      const result = mergeData(keepaData, spApiData);

      expect(result.title).toBe('Keepa Title');
      expect(result.brand).toBe('Keepa Brand');
    });
  });

  describe('calculateDerivedFields', () => {
    it('calculates days of cover', () => {
      const data = {
        total_stock: 300,
        units_30d: 90, // 3 units per day
      };

      const result = calculateDerivedFields(data);

      expect(result.days_of_cover).toBe(100); // 300 / 3 = 100 days
    });

    it('handles zero sales for days of cover', () => {
      const data = {
        total_stock: 100,
        units_30d: 0,
      };

      const result = calculateDerivedFields(data);

      expect(result.days_of_cover).toBe(null);
    });

    it('calculates is_out_of_stock flag', () => {
      expect(calculateDerivedFields({ total_stock: 0 }).is_out_of_stock).toBe(true);
      expect(calculateDerivedFields({ total_stock: -5 }).is_out_of_stock).toBe(true);
      expect(calculateDerivedFields({ total_stock: 10 }).is_out_of_stock).toBe(false);
      expect(calculateDerivedFields({ total_stock: null }).is_out_of_stock).toBe(false);
    });

    it('calculates is_buy_box_lost flag', () => {
      const ourSellerId = 'OUR_SELLER_ID';

      // We have the buy box
      expect(
        calculateDerivedFields({ buy_box_seller_id: 'OUR_SELLER_ID' }, ourSellerId).is_buy_box_lost
      ).toBe(false);

      // Competitor has the buy box
      expect(
        calculateDerivedFields({ buy_box_seller_id: 'OTHER_SELLER' }, ourSellerId).is_buy_box_lost
      ).toBe(true);

      // No seller ID provided
      expect(
        calculateDerivedFields({ buy_box_seller_id: 'OTHER_SELLER' }, null).is_buy_box_lost
      ).toBe(null);
    });
  });

  describe('runDqChecks', () => {
    const asin = 'B001234567';
    const marketplaceId = 1;
    const ingestionJobId = 'test-job-123';

    it('detects missing required fields', () => {
      const data = {
        title: null, // Required field missing
      };

      const issues = runDqChecks(data, asin, marketplaceId, ingestionJobId);

      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(i => i.issue_type === 'MISSING_FIELD' && i.field_name === 'title')).toBe(true);
    });

    it('detects negative stock (CRITICAL)', () => {
      const data = {
        title: 'Test Product',
        total_stock: -10,
      };

      const issues = runDqChecks(data, asin, marketplaceId, ingestionJobId);

      const stockIssue = issues.find(i => i.field_name === 'total_stock');
      expect(stockIssue).toBeDefined();
      expect(stockIssue.severity).toBe('CRITICAL');
      expect(stockIssue.issue_type).toBe('INVALID_VALUE');
    });

    it('detects zero/negative price (WARN)', () => {
      const data = {
        title: 'Test Product',
        price_inc_vat: 0,
      };

      const issues = runDqChecks(data, asin, marketplaceId, ingestionJobId);

      const priceIssue = issues.find(i => i.field_name === 'price_inc_vat');
      expect(priceIssue).toBeDefined();
      expect(priceIssue.severity).toBe('WARN');
    });

    it('detects stale Keepa data', () => {
      const staleDate = new Date();
      staleDate.setDate(staleDate.getDate() - 4); // 4 days ago (> 72 hours)

      const data = {
        title: 'Test Product',
        keepa_has_data: true,
        keepa_last_update: staleDate,
      };

      const issues = runDqChecks(data, asin, marketplaceId, ingestionJobId);

      const staleIssue = issues.find(i => i.issue_type === 'STALE_DATA');
      expect(staleIssue).toBeDefined();
    });

    it('detects missing Keepa data', () => {
      const data = {
        title: 'Test Product',
        keepa_has_data: false,
      };

      const issues = runDqChecks(data, asin, marketplaceId, ingestionJobId);

      const keepaIssue = issues.find(i => i.field_name === 'keepa_data');
      expect(keepaIssue).toBeDefined();
    });

    it('detects high price volatility', () => {
      const data = {
        title: 'Test Product',
        price_volatility_score: 0.6, // > 0.5 threshold
      };

      const issues = runDqChecks(data, asin, marketplaceId, ingestionJobId);

      const volatilityIssue = issues.find(i => i.field_name === 'price_volatility_score');
      expect(volatilityIssue).toBeDefined();
      expect(volatilityIssue.issue_type).toBe('OUT_OF_RANGE');
    });

    it('returns no issues for valid data', () => {
      const data = {
        title: 'Valid Product',
        total_stock: 100,
        price_inc_vat: 24.99,
        seller_count: 5,
        keepa_has_data: true,
        keepa_last_update: new Date(), // Recent
        price_volatility_score: 0.1, // Low volatility
      };

      const issues = runDqChecks(data, asin, marketplaceId, ingestionJobId);

      // Should only have the standard "no keepa data" warning since keepa_has_data is true
      const criticalIssues = issues.filter(i => i.severity === 'CRITICAL');
      expect(criticalIssues.length).toBe(0);
    });

    it('includes correct metadata in issues', () => {
      const data = {
        title: null,
      };

      const issues = runDqChecks(data, asin, marketplaceId, ingestionJobId);

      expect(issues[0].asin).toBe(asin);
      expect(issues[0].marketplace_id).toBe(marketplaceId);
      expect(issues[0].ingestion_job_id).toBe(ingestionJobId);
      expect(issues[0].message).toBeTruthy();
      expect(issues[0].details).toBeDefined();
    });
  });

  describe('Integration - Full Pipeline', () => {
    it('processes sample Keepa + SP-API data correctly', () => {
      // Realistic sample data
      const keepaPayload = {
        products: [{
          asin: 'B08N5WRWNW',
          title: 'Apple AirPods Pro (2nd Generation)',
          brand: 'Apple',
          categoryTree: [
            { name: 'Electronics' },
            { name: 'Headphones' },
            { name: 'In-Ear' },
          ],
          stats: {
            current: [null, 22900, null, 1250, null, null, null, null, null, null, null, 45],
            buyBoxPrice: 22900,
          },
          lastUpdate: Math.floor(Date.now() / 1000),
          buyBoxSellerIdHistory: ['A3TVFNQPRVMZ7C'],
          buyBoxIsFBA: true,
          csv: [
            null,
            [21600000, 22900, 21600001, 23500, 21600002, 22900], // Price history
          ],
        }],
      };

      const spApiPayload = {
        catalogItem: {
          asin: 'B08N5WRWNW',
          attributes: {
            item_name: [{ value: 'Apple AirPods Pro (2nd Gen) Wireless Earbuds' }],
            brand: [{ value: 'Apple' }],
          },
        },
        pricing: {
          offers: [{
            isMine: true,
            listingPrice: { amount: 229.00 },
          }],
        },
        inventory: {
          fulfillmentAvailability: [{
            fulfillmentChannelCode: 'FBA',
            quantity: 50,
          }],
        },
      };

      // Run through pipeline
      const keepaFlat = flattenKeepaData(keepaPayload);
      const spApiFlat = flattenSpApiData(spApiPayload);
      const merged = mergeData(keepaFlat, spApiFlat);
      const withDerived = calculateDerivedFields(merged, 'A3TVFNQPRVMZ7C');
      const issues = runDqChecks(withDerived, 'B08N5WRWNW', 1, 'test-job');

      // Verify merged data
      expect(merged.title).toBe('Apple AirPods Pro (2nd Gen) Wireless Earbuds');
      expect(merged.brand).toBe('Apple');
      expect(merged.price_inc_vat).toBe(229.00);
      expect(merged.total_stock).toBe(50);
      expect(merged.buy_box_price).toBe(229.00);
      expect(merged.category_path).toBe('Electronics > Headphones > In-Ear');

      // Verify derived fields
      expect(withDerived.is_out_of_stock).toBe(false);
      expect(withDerived.is_buy_box_lost).toBe(false); // We own the buy box

      // No critical issues
      const criticalIssues = issues.filter(i => i.severity === 'CRITICAL');
      expect(criticalIssues.length).toBe(0);
    });
  });
});
