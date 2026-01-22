/**
 * Feature Store Types (per DATA_CONTRACTS.md §9)
 * D.4 FIX: Properly typed feature records instead of loose Record<string, unknown>
 */

import type { ListingFeatures } from './listings';

export type EntityType = 'LISTING' | 'ASIN';

/**
 * D.4 FIX: Typed feature record for listings
 */
export interface ListingFeatureRecord {
  id: number;
  entity_type: 'LISTING';
  entity_id: number;
  feature_version: number;
  features_json: ListingFeatures;
  computed_at: string;
  created_at: string;
}

/**
 * D.4 FIX: ASIN features have a different shape than listing features
 */
export interface AsinFeatures {
  // Price data from Keepa
  keepa_price_current: number | null;
  keepa_price_median_90d: number | null;
  keepa_price_p25_90d: number | null;
  keepa_price_p75_90d: number | null;
  keepa_volatility_90d: number | null;

  // Market data
  keepa_offers_count_current: number | null;
  keepa_offers_trend_30d: number | null;
  keepa_rank_current: number | null;
  keepa_rank_trend_90d: number | null;

  // Category info
  category: string | null;
  brand: string | null;

  // Metadata
  computed_at: string;
}

export interface AsinFeatureRecord {
  id: number;
  entity_type: 'ASIN';
  entity_id: number;
  feature_version: number;
  features_json: AsinFeatures;
  computed_at: string;
  created_at: string;
}

/**
 * Union type for any feature record
 */
export type FeatureRecord = ListingFeatureRecord | AsinFeatureRecord;

/**
 * Generic feature store entry with proper typing
 */
export interface FeatureStoreEntry<T extends ListingFeatures | AsinFeatures = ListingFeatures> {
  entity_type: EntityType;
  entity_id: number;
  features: T;
  computed_at: string;
  feature_version: number;
}
