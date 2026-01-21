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

// Helper to create mock response
function createMockResponse(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : status === 429 ? 'Too Many Requests' : 'Error',
    headers: new Map(Object.entries(headers)),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('Keepa Service', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
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

      global.fetch = jest.fn().mockResolvedValue(createMockResponse(mockResponse));

      const result = await fetchKeepaData('B001234567');

      expect(result.products).toHaveLength(1);
      expect(result.products[0].asin).toBe('B001234567');
      expect(global.fetch).toHaveBeenCalledTimes(1);
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

      global.fetch = jest.fn().mockResolvedValue(createMockResponse(mockResponse));

      const result = await fetchKeepaData(asins);

      expect(result.products).toHaveLength(3);
      // Verify ASINs are comma-separated in request
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`asin=${asins.join('%2C')}`)
      );
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
      global.fetch = jest.fn()
        .mockResolvedValueOnce(createMockResponse({ error: 'Rate limited' }, 429))
        .mockResolvedValueOnce(createMockResponse(mockResponse));

      const fetchPromise = fetchKeepaData('B001234567');

      // Advance timers to allow retry
      await jest.advanceTimersByTimeAsync(5000);

      const result = await fetchPromise;

      expect(result.products).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    }, 15000);

    it('should retry on 5xx server errors', async () => {
      jest.useFakeTimers();

      const mockResponse = {
        products: [{ asin: 'B001234567', title: 'Test' }],
      };

      // First call returns 500, second succeeds
      global.fetch = jest.fn()
        .mockResolvedValueOnce(createMockResponse('Server Error', 500))
        .mockResolvedValueOnce(createMockResponse(mockResponse));

      const fetchPromise = fetchKeepaData('B001234567');

      await jest.advanceTimersByTimeAsync(5000);

      const result = await fetchPromise;

      expect(result.products).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    }, 15000);

    it('should throw after max retries exceeded', async () => {
      // All calls return 400 (non-retryable error) to avoid long retry delays
      global.fetch = jest.fn().mockResolvedValue(
        createMockResponse({ error: 'Bad request' }, 400)
      );

      await expect(fetchKeepaData('B001234567')).rejects.toThrow('400');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchKeepaDataBatched', () => {
    it('should split ASINs into batches of 10', async () => {
      const asins = Array.from({ length: 25 }, (_, i) => `B00${i.toString().padStart(7, '0')}`);

      // Mock to return different products for each batch
      global.fetch = jest.fn().mockImplementation((url) => {
        const params = new URLSearchParams(url.split('?')[1]);
        const requestedAsins = params.get('asin').split(',');
        return Promise.resolve(createMockResponse({
          products: requestedAsins.map(asin => ({ asin, title: `Product ${asin}` })),
        }));
      });

      const results = await fetchKeepaDataBatched(asins);

      expect(results.size).toBe(25);
      // Should make 3 API calls (10 + 10 + 5)
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should deduplicate ASINs', async () => {
      const asins = ['B001234567', 'B001234567', 'B002345678', 'B001234567'];

      global.fetch = jest.fn().mockResolvedValue(createMockResponse({
        products: [
          { asin: 'B001234567', title: 'Product 1' },
          { asin: 'B002345678', title: 'Product 2' },
        ],
      }));

      const results = await fetchKeepaDataBatched(asins);

      // Should only have 2 unique ASINs
      expect(results.size).toBe(2);
      // Should only make 1 API call (2 unique ASINs < 10)
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should continue with other batches if one fails', async () => {
      const asins = Array.from({ length: 15 }, (_, i) => `B00${i.toString().padStart(7, '0')}`);

      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First batch fails with non-retryable 400 error
          return Promise.resolve(createMockResponse({ error: 'Bad request' }, 400));
        }
        // Second batch succeeds
        return Promise.resolve(createMockResponse({
          products: asins.slice(10).map(asin => ({ asin, title: `Product ${asin}` })),
        }));
      });

      const results = await fetchKeepaDataBatched(asins);

      // First batch should have error markers (ASINs 0-9)
      expect(results.get('B000000000').failed).toBe(true);
      expect(results.get('B000000000').error).toContain('400');
      // Second batch should succeed (ASINs 10-14)
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
