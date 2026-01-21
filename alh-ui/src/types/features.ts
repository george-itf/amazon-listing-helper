/**
 * Feature Store Types (per DATA_CONTRACTS.md §9)
 */

export type EntityType = 'LISTING' | 'ASIN';

export interface FeatureRecord {
  id: number;
  entity_type: EntityType;
  entity_id: number;
  feature_version: number;
  features_json: Record<string, unknown>;
  computed_at: string;
  created_at: string;
}

export interface FeatureStoreEntry<T = Record<string, unknown>> {
  entity_type: EntityType;
  entity_id: number;
  features: T;
  computed_at: string;
  feature_version: number;
}
