# Integration Layer Architecture

## Overview

The integration layer manages all external API communications. It handles authentication, rate limiting, caching, error recovery, and data transformation for Amazon SP-API, Keepa, Royal Mail, and Google APIs.

---

## 1. Integration Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           INTEGRATION LAYER                                      │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                      INTEGRATION ORCHESTRATOR                            │    │
│  │                                                                          │    │
│  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │    │
│  │   │   Request   │  │    Rate     │  │   Circuit   │  │   Retry     │   │    │
│  │   │   Queue     │  │   Limiter   │  │   Breaker   │  │   Handler   │   │    │
│  │   └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │    │
│  │                                                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                      │                                           │
│           ┌──────────────────────────┼──────────────────────────┐               │
│           ▼                          ▼                          ▼               │
│  ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐         │
│  │   AMAZON        │      │     KEEPA       │      │   ROYAL MAIL    │         │
│  │   SP-API        │      │     API         │      │     API         │         │
│  │   ADAPTER       │      │    ADAPTER      │      │    ADAPTER      │         │
│  │                 │      │                 │      │                 │         │
│  │ ┌─────────────┐ │      │ ┌─────────────┐ │      │ ┌─────────────┐ │         │
│  │ │   Auth      │ │      │ │   Auth      │ │      │ │   Auth      │ │         │
│  │ │   Handler   │ │      │ │   Handler   │ │      │ │   Handler   │ │         │
│  │ └─────────────┘ │      │ └─────────────┘ │      │ └─────────────┘ │         │
│  │ ┌─────────────┐ │      │ ┌─────────────┐ │      │ ┌─────────────┐ │         │
│  │ │   Rate      │ │      │ │   Token     │ │      │ │   Request   │ │         │
│  │ │   Limiter   │ │      │ │   Bucket    │ │      │ │   Builder   │ │         │
│  │ └─────────────┘ │      │ └─────────────┘ │      │ └─────────────┘ │         │
│  │ ┌─────────────┐ │      │ ┌─────────────┐ │      │ ┌─────────────┐ │         │
│  │ │   Response  │ │      │ │   Response  │ │      │ │   Response  │ │         │
│  │ │   Parser    │ │      │ │   Parser    │ │      │ │   Parser    │ │         │
│  │ └─────────────┘ │      │ └─────────────┘ │      │ └─────────────┘ │         │
│  └─────────────────┘      └─────────────────┘      └─────────────────┘         │
│           │                          │                          │               │
│           └──────────────────────────┼──────────────────────────┘               │
│                                      ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                           CACHE LAYER                                    │    │
│  │                                                                          │    │
│  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │    │
│  │   │   Redis     │  │   Response  │  │   Smart     │  │   TTL       │   │    │
│  │   │   Store     │  │   Cache     │  │   Invalidate│  │   Manager   │   │    │
│  │   └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │    │
│  │                                                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Amazon SP-API Integration

### 2.1 Authentication

```typescript
// src/integrations/amazon/auth.ts

interface SPAPICredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  marketplaceId: string;  // A1F83G8C2ARO7P for UK
  sellerId: string;
}

interface SPAPITokens {
  accessToken: string;
  expiresAt: Date;
}

class SPAPIAuthHandler {
  private credentials: SPAPICredentials;
  private tokens: SPAPITokens | null = null;
  private refreshPromise: Promise<SPAPITokens> | null = null;

  constructor(credentials: SPAPICredentials) {
    this.credentials = credentials;
  }

  async getAccessToken(): Promise<string> {
    // Check if we have a valid token
    if (this.tokens && this.tokens.expiresAt > new Date(Date.now() + 60000)) {
      return this.tokens.accessToken;
    }

    // Prevent multiple simultaneous refresh requests
    if (this.refreshPromise) {
      const tokens = await this.refreshPromise;
      return tokens.accessToken;
    }

    // Refresh the token
    this.refreshPromise = this.refreshAccessToken();

    try {
      this.tokens = await this.refreshPromise;
      return this.tokens.accessToken;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async refreshAccessToken(): Promise<SPAPITokens> {
    const response = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.credentials.refreshToken,
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new SPAPIAuthError('Failed to refresh access token', error);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }
}
```

### 2.2 SP-API Client

```typescript
// src/integrations/amazon/spApi.client.ts

interface SPAPIClientConfig {
  credentials: SPAPICredentials;
  rateLimiter: RateLimiter;
  cache: CacheService;
}

class SPAPIClient {
  private authHandler: SPAPIAuthHandler;
  private rateLimiter: RateLimiter;
  private cache: CacheService;
  private baseUrl = 'https://sellingpartnerapi-eu.amazon.com';

  constructor(config: SPAPIClientConfig) {
    this.authHandler = new SPAPIAuthHandler(config.credentials);
    this.rateLimiter = config.rateLimiter;
    this.cache = config.cache;
  }

  async request<T>(
    endpoint: string,
    options: SPAPIRequestOptions = {}
  ): Promise<T> {
    const {
      method = 'GET',
      body,
      params,
      rateType = 'default',
      cacheKey,
      cacheTTL,
    } = options;

    // Check cache first
    if (cacheKey) {
      const cached = await this.cache.get<T>(cacheKey);
      if (cached) return cached;
    }

    // Wait for rate limit slot
    await this.rateLimiter.acquire(rateType);

    const accessToken = await this.authHandler.getAccessToken();
    const url = new URL(endpoint, this.baseUrl);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        'x-amz-access-token': accessToken,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    // Handle rate limit headers
    this.updateRateLimits(response.headers, rateType);

    if (!response.ok) {
      await this.handleError(response);
    }

    const data = await response.json();

    // Cache the response
    if (cacheKey && cacheTTL) {
      await this.cache.set(cacheKey, data, cacheTTL);
    }

    return data as T;
  }

  private updateRateLimits(headers: Headers, rateType: string): void {
    const remaining = headers.get('x-amzn-ratelimit-limit');
    if (remaining) {
      this.rateLimiter.updateLimit(rateType, parseFloat(remaining));
    }
  }

  private async handleError(response: Response): Promise<never> {
    const error = await response.json().catch(() => ({}));

    if (response.status === 429) {
      throw new SPAPIRateLimitError('Rate limit exceeded', error);
    }

    if (response.status === 403) {
      throw new SPAPIAuthError('Authentication failed', error);
    }

    throw new SPAPIError(
      `SP-API Error: ${response.status}`,
      response.status,
      error
    );
  }
}
```

### 2.3 Catalog Items Adapter

```typescript
// src/integrations/amazon/catalog.adapter.ts

interface CatalogItemsAdapter {
  getItem(asin: string): Promise<CatalogItem>;
  searchItems(query: SearchQuery): Promise<SearchResult>;
  getItemAttributes(asin: string): Promise<ItemAttributes>;
}

class SPAPICatalogAdapter implements CatalogItemsAdapter {
  private client: SPAPIClient;
  private marketplaceId: string;

  constructor(client: SPAPIClient, marketplaceId: string) {
    this.client = client;
    this.marketplaceId = marketplaceId;
  }

  async getItem(asin: string): Promise<CatalogItem> {
    const response = await this.client.request<SPAPICatalogResponse>(
      `/catalog/2022-04-01/items/${asin}`,
      {
        params: {
          marketplaceIds: this.marketplaceId,
          includedData: [
            'attributes',
            'identifiers',
            'images',
            'productTypes',
            'salesRanks',
            'summaries',
            'relationships',
          ].join(','),
        },
        rateType: 'catalogItems',
        cacheKey: `catalog:item:${asin}`,
        cacheTTL: 3600, // 1 hour
      }
    );

    return this.transformCatalogItem(response);
  }

  async searchItems(query: SearchQuery): Promise<SearchResult> {
    const response = await this.client.request<SPAPISearchResponse>(
      '/catalog/2022-04-01/items',
      {
        params: {
          marketplaceIds: this.marketplaceId,
          keywords: query.keywords,
          brandNames: query.brand,
          classificationIds: query.categoryId,
          pageSize: query.pageSize || 20,
          pageToken: query.pageToken,
          includedData: 'summaries,salesRanks',
        },
        rateType: 'catalogItems',
      }
    );

    return {
      items: response.items.map(this.transformSearchItem),
      nextPageToken: response.pagination?.nextToken,
      totalResults: response.numberOfResults,
    };
  }

  private transformCatalogItem(response: SPAPICatalogResponse): CatalogItem {
    const item = response;

    return {
      asin: item.asin,
      title: item.summaries?.[0]?.itemName || '',
      brand: item.summaries?.[0]?.brand || '',
      manufacturer: item.summaries?.[0]?.manufacturer || '',
      modelNumber: item.summaries?.[0]?.modelNumber || '',

      // Images
      images: item.images?.[0]?.images?.map(img => ({
        url: img.link,
        variant: img.variant,
        width: img.width,
        height: img.height,
      })) || [],

      // Category
      browseNodeId: item.salesRanks?.[0]?.classificationRanks?.[0]?.classificationId,
      categoryPath: item.salesRanks?.[0]?.classificationRanks?.[0]?.title,

      // BSR
      salesRank: item.salesRanks?.[0]?.classificationRanks?.[0]?.rank,

      // Relationships (variations)
      parentAsin: item.relationships?.[0]?.parentAsins?.[0],
      childAsins: item.relationships?.[0]?.childAsins || [],
      variationTheme: item.relationships?.[0]?.variationTheme?.name,

      // Raw attributes for detailed extraction
      attributes: item.attributes,
    };
  }
}
```

### 2.4 Reports Adapter

```typescript
// src/integrations/amazon/reports.adapter.ts

type ReportType =
  | 'GET_FLAT_FILE_OPEN_LISTINGS_DATA'
  | 'GET_MERCHANT_LISTINGS_ALL_DATA'
  | 'GET_SALES_AND_TRAFFIC_REPORT'
  | 'GET_SEARCH_TERMS_REPORT'
  | 'GET_FBA_INVENTORY_PLANNING_DATA';

interface ReportsAdapter {
  createReport(type: ReportType, options?: ReportOptions): Promise<string>;
  getReportStatus(reportId: string): Promise<ReportStatus>;
  getReportDocument(documentId: string): Promise<ReportDocument>;
  downloadReport(documentId: string): Promise<ParsedReport>;
}

class SPAPIReportsAdapter implements ReportsAdapter {
  private client: SPAPIClient;
  private marketplaceId: string;

  async createReport(
    type: ReportType,
    options: ReportOptions = {}
  ): Promise<string> {
    const response = await this.client.request<CreateReportResponse>(
      '/reports/2021-06-30/reports',
      {
        method: 'POST',
        body: {
          reportType: type,
          marketplaceIds: [this.marketplaceId],
          dataStartTime: options.startDate?.toISOString(),
          dataEndTime: options.endDate?.toISOString(),
          reportOptions: options.reportOptions,
        },
        rateType: 'reports',
      }
    );

    return response.reportId;
  }

  async getReportStatus(reportId: string): Promise<ReportStatus> {
    const response = await this.client.request<ReportStatusResponse>(
      `/reports/2021-06-30/reports/${reportId}`,
      { rateType: 'reports' }
    );

    return {
      status: response.processingStatus,
      documentId: response.reportDocumentId,
      completedAt: response.processingEndTime
        ? new Date(response.processingEndTime)
        : undefined,
    };
  }

  async downloadReport(documentId: string): Promise<ParsedReport> {
    // Get document URL
    const docResponse = await this.client.request<ReportDocumentResponse>(
      `/reports/2021-06-30/documents/${documentId}`,
      { rateType: 'reports' }
    );

    // Download the actual report
    const reportResponse = await fetch(docResponse.url);
    let content = await reportResponse.text();

    // Decompress if needed
    if (docResponse.compressionAlgorithm === 'GZIP') {
      content = await this.decompress(content);
    }

    // Parse based on report type
    return this.parseReport(content);
  }

  private parseReport(content: string): ParsedReport {
    // Tab-separated values
    const lines = content.split('\n');
    const headers = lines[0].split('\t');

    const rows = lines.slice(1).map(line => {
      const values = line.split('\t');
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      return row;
    });

    return { headers, rows };
  }
}
```

### 2.5 Feeds Adapter (For Updates)

```typescript
// src/integrations/amazon/feeds.adapter.ts

class SPAPIFeedsAdapter {
  private client: SPAPIClient;

  async submitListingUpdate(
    updates: ListingUpdate[]
  ): Promise<FeedSubmissionResult> {
    // Build JSON Listings Feed
    const feedContent = this.buildListingsFeed(updates);

    // Create feed document
    const docResponse = await this.client.request<CreateFeedDocResponse>(
      '/feeds/2021-06-30/documents',
      {
        method: 'POST',
        body: {
          contentType: 'application/json; charset=UTF-8',
        },
        rateType: 'feeds',
      }
    );

    // Upload feed content
    await fetch(docResponse.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: feedContent,
    });

    // Submit the feed
    const feedResponse = await this.client.request<CreateFeedResponse>(
      '/feeds/2021-06-30/feeds',
      {
        method: 'POST',
        body: {
          feedType: 'JSON_LISTINGS_FEED',
          marketplaceIds: [this.marketplaceId],
          inputFeedDocumentId: docResponse.feedDocumentId,
        },
        rateType: 'feeds',
      }
    );

    return {
      feedId: feedResponse.feedId,
      status: 'SUBMITTED',
    };
  }

  async submitPriceUpdate(
    updates: PriceUpdate[]
  ): Promise<FeedSubmissionResult> {
    const feedContent = this.buildPricingFeed(updates);

    // Similar flow to listing update...
    // ...

    return { feedId: '...', status: 'SUBMITTED' };
  }

  private buildListingsFeed(updates: ListingUpdate[]): string {
    const feed = {
      header: {
        sellerId: this.sellerId,
        version: '2.0',
      },
      messages: updates.map((update, index) => ({
        messageId: index + 1,
        sku: update.sku,
        operationType: 'PARTIAL_UPDATE',
        productType: update.productType,
        attributes: update.attributes,
      })),
    };

    return JSON.stringify(feed);
  }

  async getFeedResult(feedId: string): Promise<FeedResult> {
    // Poll for feed completion
    let status: string;
    let documentId: string | undefined;

    do {
      const response = await this.client.request<FeedStatusResponse>(
        `/feeds/2021-06-30/feeds/${feedId}`,
        { rateType: 'feeds' }
      );

      status = response.processingStatus;
      documentId = response.resultFeedDocumentId;

      if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') {
        await sleep(5000); // Wait 5 seconds
      }
    } while (status === 'IN_QUEUE' || status === 'IN_PROGRESS');

    if (status === 'DONE' && documentId) {
      // Download and parse result
      const result = await this.downloadFeedResult(documentId);
      return result;
    }

    throw new Error(`Feed failed with status: ${status}`);
  }
}
```

---

## 3. Keepa API Integration

### 3.1 Keepa Client with Token Bucket

```typescript
// src/integrations/keepa/keepa.client.ts

interface KeepaConfig {
  apiKey: string;
  tokensPerMinute: number; // 21 for your account
}

class KeepaClient {
  private apiKey: string;
  private tokenBucket: TokenBucket;
  private cache: CacheService;
  private baseUrl = 'https://api.keepa.com';

  constructor(config: KeepaConfig, cache: CacheService) {
    this.apiKey = config.apiKey;
    this.cache = cache;

    // Initialize token bucket
    this.tokenBucket = new TokenBucket({
      capacity: config.tokensPerMinute,
      refillRate: config.tokensPerMinute / 60, // Tokens per second
      refillInterval: 1000, // Refill every second
    });
  }

  async request<T>(
    endpoint: string,
    options: KeepaRequestOptions = {}
  ): Promise<T> {
    const { params = {}, tokenCost = 1, cacheKey, cacheTTL } = options;

    // Check cache first
    if (cacheKey) {
      const cached = await this.cache.get<T>(cacheKey);
      if (cached) {
        logger.debug('Keepa cache hit', { cacheKey });
        return cached;
      }
    }

    // Wait for tokens
    const acquired = await this.tokenBucket.acquire(tokenCost, {
      timeout: 60000, // Max wait 1 minute
    });

    if (!acquired) {
      throw new KeepaRateLimitError('Could not acquire tokens within timeout');
    }

    const url = new URL(endpoint, this.baseUrl);
    url.searchParams.append('key', this.apiKey);

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new KeepaError(`Keepa API error: ${response.status}`);
    }

    const data = await response.json();

    // Check for Keepa-specific errors
    if (data.error) {
      throw new KeepaError(data.error.message, data.error.type);
    }

    // Update token info from response
    if (data.tokensLeft !== undefined) {
      this.tokenBucket.setAvailable(data.tokensLeft);
    }

    // Cache the response
    if (cacheKey && cacheTTL) {
      await this.cache.set(cacheKey, data, cacheTTL);
    }

    return data as T;
  }

  getTokenStatus(): TokenStatus {
    return {
      available: this.tokenBucket.getAvailable(),
      capacity: this.tokenBucket.getCapacity(),
      refillRate: this.tokenBucket.getRefillRate(),
    };
  }
}
```

### 3.2 Token Bucket Implementation

```typescript
// src/integrations/keepa/tokenBucket.ts

interface TokenBucketConfig {
  capacity: number;
  refillRate: number; // Tokens per second
  refillInterval: number; // Milliseconds
}

class TokenBucket {
  private tokens: number;
  private capacity: number;
  private refillRate: number;
  private lastRefill: number;
  private waitQueue: Array<{
    tokens: number;
    resolve: () => void;
    reject: (err: Error) => void;
    timeout: NodeJS.Timeout;
  }> = [];

  constructor(config: TokenBucketConfig) {
    this.capacity = config.capacity;
    this.tokens = config.capacity;
    this.refillRate = config.refillRate;
    this.lastRefill = Date.now();

    // Start refill timer
    setInterval(() => this.refill(), config.refillInterval);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // Seconds
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;

    // Process waiting requests
    this.processQueue();
  }

  private processQueue(): void {
    while (this.waitQueue.length > 0) {
      const next = this.waitQueue[0];

      if (this.tokens >= next.tokens) {
        this.tokens -= next.tokens;
        clearTimeout(next.timeout);
        this.waitQueue.shift();
        next.resolve();
      } else {
        break; // Not enough tokens yet
      }
    }
  }

  async acquire(tokens: number, options: { timeout: number }): Promise<boolean> {
    // Immediate check
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }

    // Wait for tokens
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waitQueue.findIndex(w => w.resolve === resolve);
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
        }
        resolve(false); // Timeout
      }, options.timeout);

      this.waitQueue.push({
        tokens,
        resolve: () => resolve(true),
        reject,
        timeout,
      });
    });
  }

  setAvailable(tokens: number): void {
    this.tokens = Math.min(this.capacity, tokens);
    this.processQueue();
  }

  getAvailable(): number {
    return this.tokens;
  }

  getCapacity(): number {
    return this.capacity;
  }

  getRefillRate(): number {
    return this.refillRate;
  }
}
```

### 3.3 Keepa Product Adapter

```typescript
// src/integrations/keepa/product.adapter.ts

interface KeepaProductAdapter {
  getProduct(asin: string, domain?: number): Promise<KeepaProduct>;
  getProducts(asins: string[], domain?: number): Promise<KeepaProduct[]>;
  searchProducts(query: KeepaSearchQuery): Promise<KeepaSearchResult>;
}

class KeepaProductAdapterImpl implements KeepaProductAdapter {
  private client: KeepaClient;
  private defaultDomain = 3; // UK

  constructor(client: KeepaClient) {
    this.client = client;
  }

  async getProduct(
    asin: string,
    domain = this.defaultDomain
  ): Promise<KeepaProduct> {
    const products = await this.getProducts([asin], domain);
    if (products.length === 0) {
      throw new KeepaError(`Product not found: ${asin}`);
    }
    return products[0];
  }

  async getProducts(
    asins: string[],
    domain = this.defaultDomain
  ): Promise<KeepaProduct[]> {
    // Keepa allows up to 100 ASINs per request
    const batches = chunk(asins, 100);
    const results: KeepaProduct[] = [];

    for (const batch of batches) {
      const response = await this.client.request<KeepaProductResponse>(
        '/product',
        {
          params: {
            domain,
            asin: batch.join(','),
            stats: 180, // 180 days of stats
            history: 1, // Include price history
            buybox: 1, // Include Buy Box history
            rating: 1, // Include rating history
            offers: 20, // Top 20 offers
          },
          tokenCost: Math.ceil(batch.length / 10), // 1 token per 10 products
          cacheKey: `keepa:products:${domain}:${batch.sort().join(',')}`,
          cacheTTL: 3600, // 1 hour
        }
      );

      results.push(...response.products.map(this.transformProduct));
    }

    return results;
  }

  private transformProduct(raw: KeepaRawProduct): KeepaProduct {
    return {
      asin: raw.asin,
      title: raw.title,
      brand: raw.brand,
      manufacturer: raw.manufacturer,

      // Current values
      currentPrice: this.decodePriceValue(raw.csv?.[0]?.slice(-1)[0]),
      currentBuyBoxPrice: this.decodePriceValue(raw.csv?.[18]?.slice(-1)[0]),
      currentBSR: raw.csv?.[3]?.slice(-1)[0],
      currentRating: raw.csv?.[16]?.slice(-1)[0] / 10,
      currentReviewCount: raw.csv?.[17]?.slice(-1)[0],

      // Stats (180 days)
      stats: raw.stats ? {
        avgPrice: this.decodePriceValue(raw.stats.avg?.[0]),
        minPrice: this.decodePriceValue(raw.stats.min?.[0]),
        maxPrice: this.decodePriceValue(raw.stats.max?.[0]),
        avgBSR: raw.stats.avg?.[3],
        avgBuyBoxPrice: this.decodePriceValue(raw.stats.avg?.[18]),
      } : undefined,

      // Price history (decoded)
      priceHistory: this.decodePriceHistory(raw.csv?.[0]),
      buyBoxHistory: this.decodePriceHistory(raw.csv?.[18]),
      bsrHistory: this.decodeHistory(raw.csv?.[3]),

      // Offers
      offers: raw.offers?.map(offer => ({
        sellerId: offer.sellerId,
        sellerName: offer.sellerName,
        price: this.decodePriceValue(offer.offerCSV?.slice(-1)[0]),
        isPrime: offer.isPrime,
        isFBA: offer.isFBA,
        condition: offer.condition,
      })),

      // Categories
      categoryTree: raw.categoryTree,
      rootCategory: raw.rootCategory,
    };
  }

  private decodePriceValue(value: number | undefined): number | null {
    if (value === undefined || value === -1) return null;
    return value / 100; // Keepa stores prices in cents
  }

  private decodePriceHistory(
    csv: number[] | undefined
  ): PriceHistoryPoint[] | undefined {
    if (!csv || csv.length === 0) return undefined;

    const history: PriceHistoryPoint[] = [];

    // Keepa CSV format: [time1, value1, time2, value2, ...]
    for (let i = 0; i < csv.length; i += 2) {
      const keepaTime = csv[i];
      const value = csv[i + 1];

      if (keepaTime !== -1 && value !== -1) {
        history.push({
          timestamp: this.keepaTimeToDate(keepaTime),
          value: value / 100,
        });
      }
    }

    return history;
  }

  private keepaTimeToDate(keepaTime: number): Date {
    // Keepa time is minutes since 2011-01-01
    const keepaEpoch = new Date('2011-01-01T00:00:00Z').getTime();
    return new Date(keepaEpoch + keepaTime * 60 * 1000);
  }
}
```

---

## 4. Royal Mail API Integration

### 4.1 Royal Mail Client

```typescript
// src/integrations/royalmail/royalmail.client.ts

interface RoyalMailConfig {
  clientId: string;
  clientSecret: string;
  accountNumber: string;
  environment: 'sandbox' | 'production';
}

class RoyalMailClient {
  private config: RoyalMailConfig;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private baseUrl: string;

  constructor(config: RoyalMailConfig) {
    this.config = config;
    this.baseUrl = config.environment === 'production'
      ? 'https://api.royalmail.net'
      : 'https://api.sandbox.royalmail.net';
  }

  private async authenticate(): Promise<void> {
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return;
    }

    const response = await fetch(`${this.baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(
          `${this.config.clientId}:${this.config.clientSecret}`
        ).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
      }),
    });

    if (!response.ok) {
      throw new RoyalMailAuthError('Failed to authenticate with Royal Mail');
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = new Date(Date.now() + data.expires_in * 1000);
  }

  async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    await this.authenticate();

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'X-RMG-Account-Number': this.config.accountNumber,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new RoyalMailError(error.message, response.status);
    }

    return response.json();
  }
}
```

### 4.2 Shipping Adapter

```typescript
// src/integrations/royalmail/shipping.adapter.ts

interface ShippingRate {
  serviceCode: string;
  serviceName: string;
  price: number;
  vatAmount: number;
  totalPrice: number;
  deliveryDays: number;
  deliveryDateRange: {
    earliest: Date;
    latest: Date;
  };
}

interface ShippingAddress {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  county?: string;
  postcode: string;
  countryCode: string;
}

class RoyalMailShippingAdapter {
  private client: RoyalMailClient;
  private cache: CacheService;

  async getShippingRates(
    fromPostcode: string,
    toAddress: ShippingAddress,
    parcel: ParcelDimensions
  ): Promise<ShippingRate[]> {
    // Cache key based on postcode and dimensions
    const cacheKey = `rm:rates:${fromPostcode}:${toAddress.postcode}:${parcel.weight}`;
    const cached = await this.cache.get<ShippingRate[]>(cacheKey);
    if (cached) return cached;

    const response = await this.client.request<RMRatesResponse>(
      '/shipping/v3/domestic/price',
      {
        method: 'POST',
        body: {
          shipment: {
            shipper: {
              postcode: fromPostcode,
            },
            destination: {
              postcode: toAddress.postcode,
            },
            packages: [{
              weight: parcel.weight,
              dimensions: {
                length: parcel.length,
                width: parcel.width,
                height: parcel.height,
              },
            }],
          },
        },
      }
    );

    const rates = response.services.map(service => ({
      serviceCode: service.serviceCode,
      serviceName: service.serviceName,
      price: service.price.amount,
      vatAmount: service.price.vat,
      totalPrice: service.price.amount + service.price.vat,
      deliveryDays: service.deliveryWindow.daysMin,
      deliveryDateRange: {
        earliest: new Date(service.deliveryWindow.earliest),
        latest: new Date(service.deliveryWindow.latest),
      },
    }));

    // Cache for 24 hours
    await this.cache.set(cacheKey, rates, 86400);

    return rates;
  }

  async createShipment(
    shipmentDetails: ShipmentDetails
  ): Promise<ShipmentResult> {
    const response = await this.client.request<RMShipmentResponse>(
      '/shipping/v3/domestic/shipments',
      {
        method: 'POST',
        body: this.buildShipmentRequest(shipmentDetails),
      }
    );

    return {
      shipmentId: response.shipmentId,
      trackingNumber: response.trackingNumber,
      labelUrl: response.labelUrl,
      manifestNumber: response.manifestNumber,
    };
  }

  async getTracking(trackingNumber: string): Promise<TrackingInfo> {
    const response = await this.client.request<RMTrackingResponse>(
      `/tracking/v1/mailpieces/${trackingNumber}/events`
    );

    return {
      trackingNumber,
      status: this.mapTrackingStatus(response.mailPieces[0]?.status),
      estimatedDelivery: response.mailPieces[0]?.estimatedDelivery
        ? new Date(response.mailPieces[0].estimatedDelivery)
        : undefined,
      events: response.mailPieces[0]?.events?.map(event => ({
        timestamp: new Date(event.eventDateTime),
        location: event.location,
        description: event.eventDescription,
        status: event.eventCode,
      })) || [],
    };
  }
}
```

---

## 5. Integration Orchestrator

### 5.1 Coordinating Multi-API Operations

```typescript
// src/integrations/orchestrator.ts

class IntegrationOrchestrator {
  private spApi: SPAPIClient;
  private keepa: KeepaClient;
  private royalMail: RoyalMailClient;
  private cache: CacheService;
  private eventBus: EventBus;

  async syncListing(asin: string): Promise<SyncResult> {
    const results: SyncResult = {
      asin,
      success: true,
      sources: {},
      errors: [],
    };

    // Fetch from multiple sources in parallel
    const [spApiResult, keepaResult] = await Promise.allSettled([
      this.fetchFromSPAPI(asin),
      this.fetchFromKeepa(asin),
    ]);

    // Process SP-API result
    if (spApiResult.status === 'fulfilled') {
      results.sources.spApi = spApiResult.value;
    } else {
      results.errors.push({
        source: 'spApi',
        error: spApiResult.reason.message,
      });
    }

    // Process Keepa result
    if (keepaResult.status === 'fulfilled') {
      results.sources.keepa = keepaResult.value;
    } else {
      results.errors.push({
        source: 'keepa',
        error: keepaResult.reason.message,
      });
    }

    // Merge data from all sources
    if (results.sources.spApi) {
      const mergedData = this.mergeListingData(
        results.sources.spApi,
        results.sources.keepa
      );

      // Emit event for processing
      await this.eventBus.emit('listing.synced', {
        asin,
        data: mergedData,
        sources: Object.keys(results.sources),
      });
    } else {
      results.success = false;
    }

    return results;
  }

  async enrichWithCompetitorData(
    listingId: string,
    competitorAsins: string[]
  ): Promise<EnrichmentResult> {
    // Prioritize based on available Keepa tokens
    const tokenStatus = this.keepa.getTokenStatus();
    const tokensNeeded = Math.ceil(competitorAsins.length / 10);

    if (tokenStatus.available < tokensNeeded) {
      // Queue for later processing
      await this.queueForLater({
        type: 'competitor_enrichment',
        listingId,
        competitorAsins,
        tokensNeeded,
      });

      return {
        status: 'queued',
        reason: 'Insufficient Keepa tokens',
        tokensAvailable: tokenStatus.available,
        tokensNeeded,
      };
    }

    // Fetch competitor data from Keepa
    const competitors = await this.keepa.getProducts(competitorAsins);

    return {
      status: 'completed',
      competitors: competitors.map(this.transformCompetitor),
    };
  }

  async calculateShippingCost(
    listingId: string,
    destination: ShippingAddress
  ): Promise<ShippingCostResult> {
    // Get listing details for parcel dimensions
    const listing = await this.getListingWithBOM(listingId);

    // Estimate parcel dimensions from BOM
    const parcel = this.estimateParcelDimensions(listing);

    // Get shipping rates
    const rates = await this.royalMail.getShippingRates(
      this.getWarehousePostcode(),
      destination,
      parcel
    );

    // Find best rate for SFP qualification
    const sfpRate = rates.find(
      r => r.deliveryDays <= 2 // Next day or 2-day for SFP
    );

    return {
      listingId,
      rates,
      recommendedRate: sfpRate || rates[0],
      sfpQualified: !!sfpRate,
    };
  }

  private mergeListingData(
    spApiData: SPAPIListingData,
    keepaData?: KeepaProduct
  ): MergedListingData {
    return {
      // Primary data from SP-API
      ...spApiData,

      // Enrich with Keepa data
      priceHistory: keepaData?.priceHistory,
      bsrHistory: keepaData?.bsrHistory,
      buyBoxHistory: keepaData?.buyBoxHistory,

      // Keepa-specific stats
      keepaStats: keepaData?.stats,

      // Competition data from Keepa
      offers: keepaData?.offers,

      // Data freshness
      spApiSyncedAt: new Date(),
      keepaSyncedAt: keepaData ? new Date() : undefined,
    };
  }
}
```

---

## 6. Error Handling & Resilience

### 6.1 Circuit Breaker

```typescript
// src/integrations/circuitBreaker.ts

enum CircuitState {
  CLOSED = 'CLOSED',     // Normal operation
  OPEN = 'OPEN',         // Failing, reject requests
  HALF_OPEN = 'HALF_OPEN', // Testing if recovered
}

interface CircuitBreakerConfig {
  failureThreshold: number;    // Failures before opening
  successThreshold: number;    // Successes to close from half-open
  timeout: number;             // Time before trying half-open (ms)
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private lastFailure: Date | null = null;
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      // Check if timeout has passed
      if (this.shouldAttemptReset()) {
        this.state = CircuitState.HALF_OPEN;
      } else {
        throw new CircuitBreakerOpenError('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.reset();
      }
    } else {
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = new Date();

    if (this.failures >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
    }

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.successes = 0;
    }
  }

  private shouldAttemptReset(): boolean {
    if (!this.lastFailure) return true;
    return Date.now() - this.lastFailure.getTime() >= this.config.timeout;
  }

  private reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
  }

  getState(): CircuitState {
    return this.state;
  }
}
```

### 6.2 Retry Handler

```typescript
// src/integrations/retry.ts

interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;      // Initial delay in ms
  maxDelay: number;       // Maximum delay in ms
  backoffFactor: number;  // Multiplier for exponential backoff
  retryableErrors: string[];
}

async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if error is retryable
      if (!isRetryable(error, config.retryableErrors)) {
        throw error;
      }

      // Don't wait after last attempt
      if (attempt === config.maxAttempts) {
        break;
      }

      // Calculate delay with exponential backoff + jitter
      const delay = Math.min(
        config.baseDelay * Math.pow(config.backoffFactor, attempt - 1),
        config.maxDelay
      );
      const jitter = delay * 0.2 * Math.random();

      logger.warn('Retrying after error', {
        attempt,
        maxAttempts: config.maxAttempts,
        delay: delay + jitter,
        error: (error as Error).message,
      });

      await sleep(delay + jitter);
    }
  }

  throw lastError;
}

function isRetryable(error: unknown, retryableErrors: string[]): boolean {
  if (error instanceof Error) {
    // Rate limit errors are usually retryable
    if (error.name === 'RateLimitError') return true;

    // Network errors
    if (error.message.includes('ECONNRESET')) return true;
    if (error.message.includes('ETIMEDOUT')) return true;

    // Check against custom list
    return retryableErrors.some(e => error.name.includes(e) || error.message.includes(e));
  }
  return false;
}
```

---

## 7. Caching Strategy

### 7.1 Cache Configuration

```typescript
// src/integrations/cache.ts

interface CacheConfig {
  // Default TTLs by data type
  ttl: {
    listing: number;      // 3600 (1 hour)
    price: number;        // 900 (15 minutes)
    competitor: number;   // 1800 (30 minutes)
    keyword: number;      // 7200 (2 hours)
    shipping: number;     // 86400 (24 hours)
  };

  // Cache invalidation rules
  invalidation: {
    onListingUpdate: string[];
    onPriceChange: string[];
    onCompetitorAlert: string[];
  };
}

const defaultCacheConfig: CacheConfig = {
  ttl: {
    listing: 3600,
    price: 900,
    competitor: 1800,
    keyword: 7200,
    shipping: 86400,
  },
  invalidation: {
    onListingUpdate: ['listing:*', 'score:*'],
    onPriceChange: ['price:*', 'margin:*'],
    onCompetitorAlert: ['competitor:*', 'threat:*'],
  },
};
```

### 7.2 Smart Cache Service

```typescript
// src/integrations/cacheService.ts

class CacheService {
  private redis: Redis;
  private config: CacheConfig;

  async get<T>(key: string): Promise<T | null> {
    const data = await this.redis.get(key);
    if (!data) return null;

    const parsed = JSON.parse(data);

    // Check if stale (for stale-while-revalidate)
    if (parsed._staleAt && new Date(parsed._staleAt) < new Date()) {
      // Return stale data but trigger background refresh
      this.triggerBackgroundRefresh(key);
    }

    return parsed.value as T;
  }

  async set<T>(
    key: string,
    value: T,
    ttl: number,
    options?: CacheSetOptions
  ): Promise<void> {
    const data = {
      value,
      _cachedAt: new Date().toISOString(),
      _staleAt: options?.staleAfter
        ? new Date(Date.now() + options.staleAfter * 1000).toISOString()
        : undefined,
    };

    await this.redis.set(key, JSON.stringify(data), 'EX', ttl);
  }

  async invalidatePattern(pattern: string): Promise<void> {
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  async invalidateForEvent(event: string): Promise<void> {
    const patterns = this.config.invalidation[event] || [];
    await Promise.all(patterns.map(p => this.invalidatePattern(p)));
  }

  private async triggerBackgroundRefresh(key: string): Promise<void> {
    // Publish refresh request to background worker
    await this.redis.publish('cache:refresh', key);
  }
}
```

---

## Next Document: Automation & Rules Engine →
