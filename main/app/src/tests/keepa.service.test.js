/**
 * Keepa Service Tests
 *
 * Tests for Keepa API integration including:
 * - Batching behavior
 * - Exponential backoff and retry logic
 * - Rate limit handling
 * - Response parsing
 */

import { jest } from '@jest/globals';
import nock from 'nock';

// Mock the credentials provider
jest.unstable_mockModule('../credentials-provider.js', () => ({
  hasKeepaCredentials: jest.fn(() => true),
  getKeepaApiKey: jest.fn(() => 'test-api-key'),
}));

// Import after mocking
const {
  fetchKeepaData,
  fetchKeepaDataBatched,
  parseKeepaResponse,
  getConfig,
} = await import('../services/keepa.service.js');

describe('Keepa Service', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('fetchKeepaData', () => {
    it('should fetch data for a single ASIN', async () => {
      const mockResponse = {
        products: [
          {
            asin: 'B001234567',
            title: 'Test Product',
            stats: { current: [1000, 1500, 0, 5000] },
          },
        ],
      };

      nock('https://api.keepa.com')
        .get('/product')
        .query(true)
        .reply(200, mockResponse);

      const result = await fetchKeepaData('B001234567');

      expect(result.products).toHaveLength(1);
      expect(result.products[0].asin).toBe('B001234567');
    });

    it('should fetch data for multiple ASINs in a single request', async () => {
      const asins = ['B001234567', 'B002345678', 'B003456789'];
      const mockResponse = {
        products: asins.map(asin => ({
          asin,
          title: `Product ${asin}`,
          stats: {},
        })),
      };

      nock('https://api.keepa.com')
        .get('/product')
        .query((query) => {
          // Verify ASINs are comma-separated
          return query.asin === asins.join(',');
        })
        .reply(200, mockResponse);

      const result = await fetchKeepaData(asins);

      expect(result.products).toHaveLength(3);
    });

    it('should throw error if more than 10 ASINs requested', async () => {
      const asins = Array.from({ length: 11 }, (_, i) => `B00${i.toString().padStart(7, '0')}`);

      await expect(fetchKeepaData(asins)).rejects.toThrow('Maximum 10 ASINs');
    });

    it('should retry on 429 rate limit with exponential backoff', async () => {
      jest.useFakeTimers();

      const mockResponse = {
        products: [{ asin: 'B001234567', title: 'Test' }],
      };

      // First call returns 429, second succeeds
      nock('https://api.keepa.com')
        .get('/product')
        .query(true)
        .reply(429, { error: 'Rate limited' });

      nock('https://api.keepa.com')
        .get('/product')
        .query(true)
        .reply(200, mockResponse);

      const fetchPromise = fetchKeepaData('B001234567');

      // Fast-forward through the backoff delay
      await jest.advanceTimersByTimeAsync(3000);

      const result = await fetchPromise;

      expect(result.products).toHaveLength(1);

      jest.useRealTimers();
    }, 15000);

    it('should retry on 5xx server errors', async () => {
      jest.useFakeTimers();

      const mockResponse = {
        products: [{ asin: 'B001234567', title: 'Test' }],
      };

      // First call returns 500, second succeeds
      nock('https://api.keepa.com')
        .get('/product')
        .query(true)
        .reply(500, 'Server Error');

      nock('https://api.keepa.com')
        .get('/product')
        .query(true)
        .reply(200, mockResponse);

      const fetchPromise = fetchKeepaData('B001234567');

      await jest.advanceTimersByTimeAsync(3000);

      const result = await fetchPromise;

      expect(result.products).toHaveLength(1);

      jest.useRealTimers();
    }, 15000);

    it('should throw after max retries exceeded', async () => {
      jest.useFakeTimers();

      // All calls return 429
      for (let i = 0; i < 10; i++) {
        nock('https://api.keepa.com')
          .get('/product')
          .query(true)
          .reply(429, { error: 'Rate limited' });
      }

      const fetchPromise = fetchKeepaData('B001234567');

      // Advance through all retries
      for (let i = 0; i < 7; i++) {
        await jest.advanceTimersByTimeAsync(70000);
      }

      await expect(fetchPromise).rejects.toThrow();

      jest.useRealTimers();
    }, 30000);
  });

  describe('fetchKeepaDataBatched', () => {
    it('should split ASINs into batches of 10', async () => {
      const asins = Array.from({ length: 25 }, (_, i) => `B00${i.toString().padStart(7, '0')}`);

      // Expect 3 API calls (10 + 10 + 5)
      nock('https://api.keepa.com')
        .get('/product')
        .query(true)
        .times(3)
        .reply(200, (uri) => {
          const params = new URLSearchParams(uri.split('?')[1]);
          const requestedAsins = params.get('asin').split(',');
          return {
            products: requestedAsins.map(asin => ({ asin, title: `Product ${asin}` })),
          };
        });

      const results = await fetchKeepaDataBatched(asins);

      expect(results.size).toBe(25);
      expect(nock.isDone()).toBe(true);
    });

    it('should deduplicate ASINs', async () => {
      const asins = ['B001234567', 'B001234567', 'B002345678', 'B001234567'];

      nock('https://api.keepa.com')
        .get('/product')
        .query(true)
        .reply(200, {
          products: [
            { asin: 'B001234567', title: 'Product 1' },
            { asin: 'B002345678', title: 'Product 2' },
          ],
        });

      const results = await fetchKeepaDataBatched(asins);

      // Should only have 2 unique ASINs
      expect(results.size).toBe(2);
    });

    it('should continue with other batches if one fails', async () => {
      const asins = Array.from({ length: 15 }, (_, i) => `B00${i.toString().padStart(7, '0')}`);

      // First batch fails
      nock('https://api.keepa.com')
        .get('/product')
        .query(true)
        .reply(500, 'Server Error');

      // Second batch succeeds
      nock('https://api.keepa.com')
        .get('/product')
        .query(true)
        .reply(200, {
          products: asins.slice(10).map(asin => ({ asin, title: `Product ${asin}` })),
        });

      const results = await fetchKeepaDataBatched(asins);

      // First batch should have error markers
      expect(results.get('B000000000').failed).toBe(true);
      // Second batch should succeed
      expect(results.get('B000000010').asin).toBe('B000000010');
    });
  });

  describe('parseKeepaResponse', () => {
    it('should return found: false for empty products', () => {
      const result = parseKeepaResponse({ products: [] });
      expect(result.found).toBe(false);
      expect(result.metrics).toBeNull();
    });

    it('should parse product metrics correctly', () => {
      const rawData = {
        products: [
          {
            asin: 'B001234567',
            title: 'Test Product',
            brand: 'Test Brand',
            categoryTree: [{ name: 'Electronics' }, { name: 'Computers' }],
            stats: {
              current: [1000, 1500, 0, 5000], // Amazon price, New price, Used price, Sales rank
              avg90: [0, 0, 0, 6000],
              buyBoxPrice: 1450,
            },
            csv: [
              [], // Amazon price history
              [21600000, 1400, 21600100, 1500], // New price history
              [], // Used price
              [21600000, 5500, 21600100, 5000], // Sales rank history
            ],
            offers: [
              { isFBA: true },
              { isFBA: true },
              { isFBA: false },
            ],
            rating: 45, // 4.5 stars
            reviewCount: 1234,
          },
        ],
      };

      const result = parseKeepaResponse(rawData);

      expect(result.found).toBe(true);
      expect(result.metrics.asin).toBe('B001234567');
      expect(result.metrics.title).toBe('Test Product');
      expect(result.metrics.brand).toBe('Test Brand');
      expect(result.metrics.category).toBe('Electronics');
      expect(result.metrics.price_current).toBe(15); // 1500 pence = £15
      expect(result.metrics.price_amazon).toBe(10); // 1000 pence = £10
      expect(result.metrics.buy_box_price).toBe(14.5); // 1450 pence = £14.50
      expect(result.metrics.sales_rank_current).toBe(5000);
      expect(result.metrics.offers_count_current).toBe(3);
      expect(result.metrics.offers_fba_count).toBe(2);
      expect(result.metrics.offers_fbm_count).toBe(1);
      expect(result.metrics.rating).toBe(4.5);
      expect(result.metrics.rating_count).toBe(1234);
    });

    it('should extract specific ASIN from batch response', () => {
      const rawData = {
        products: [
          { asin: 'B001234567', title: 'Product 1', stats: {} },
          { asin: 'B002345678', title: 'Product 2', stats: {} },
          { asin: 'B003456789', title: 'Product 3', stats: {} },
        ],
      };

      const result = parseKeepaResponse(rawData, 'B002345678');

      expect(result.found).toBe(true);
      expect(result.metrics.asin).toBe('B002345678');
      expect(result.metrics.title).toBe('Product 2');
    });

    it('should return not found for non-existent ASIN in batch', () => {
      const rawData = {
        products: [
          { asin: 'B001234567', title: 'Product 1', stats: {} },
        ],
      };

      const result = parseKeepaResponse(rawData, 'B999999999');

      expect(result.found).toBe(false);
    });
  });

  describe('getConfig', () => {
    it('should return configuration with defaults', () => {
      const config = getConfig();

      expect(config.maxBatchSize).toBe(10);
      expect(config.maxRetries).toBe(6);
      expect(config.baseDelayMs).toBe(2000);
      expect(config.maxDelayMs).toBe(64000);
    });
  });
});
