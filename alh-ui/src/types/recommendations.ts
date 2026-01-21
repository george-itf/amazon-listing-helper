/**
 * Recommendation Types (per SPEC)
 */

export type RecommendationType =
  | 'PRICE_DECREASE_REGAIN_BUYBOX'
  | 'PRICE_INCREASE_MARGIN_IMPROVEMENT'
  | 'RESTOCK_RISK'
  | 'MARGIN_ALERT'
  | 'OPPORTUNITY_ASIN'
  | 'ANOMALY_ALERT';

export type RecommendationSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type RecommendationStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'SNOOZED'
  | 'EXPIRED';

export interface Recommendation {
  id: number;
  listing_id: number | null;
  asin_entity_id: number | null;
  type: RecommendationType;
  severity: RecommendationSeverity;
  status: RecommendationStatus;
  title: string;
  description: string;
  action_text: string;
  evidence_json: RecommendationEvidence;
  expected_impact: ExpectedImpact | null;
  confidence: number; // 0.0 - 1.0
  expires_at: string | null;
  snoozed_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecommendationEvidence {
  // Common fields
  computed_at: string;
  data_sources: string[];
  notes?: string;

  // Price-related evidence
  current_price_inc_vat?: number;
  suggested_price_inc_vat?: number;
  buy_box_price?: number;
  competitor_price_position?: string;

  // Buy Box evidence
  buy_box_status?: string;
  buy_box_percentage_30d?: number | null;

  // Inventory evidence
  available_quantity?: number;
  days_of_cover?: number | null;
  sales_velocity?: number;

  // Keepa evidence
  keepa_price_median_90d?: number | null;
  keepa_price_p25_90d?: number | null;
  keepa_price_p75_90d?: number | null;

  // Additional context
  [key: string]: unknown;
}

export interface ExpectedImpact {
  metric: string;
  current_value: number;
  projected_value: number;
  change_percent: number;
}

export interface RecommendationActionRequest {
  notes?: string;
}

export interface RecommendationSnoozeRequest {
  snooze_until: string; // ISO date
  notes?: string;
}
