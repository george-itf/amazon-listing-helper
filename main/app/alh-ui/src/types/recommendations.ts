/**
 * Recommendation Types
 *
 * Aligned with backend schema from recommendation.service.js
 */

// Recommendation types from backend
export type RecommendationType =
  | 'PRICE_DECREASE_REGAIN_BUYBOX'
  | 'PRICE_INCREASE_MARGIN_OPPORTUNITY'
  | 'STOCK_INCREASE_STOCKOUT_RISK'
  | 'STOCK_DECREASE_OVERSTOCK'
  | 'MARGIN_AT_RISK_COMPONENT_COST'
  | 'ANOMALY_SALES_DROP'
  | 'ANOMALY_CONVERSION_DROP'
  | 'ANOMALY_BUY_BOX_LOSS'
  | 'OPPORTUNITY_CREATE_LISTING';

// Confidence levels from backend (used like severity)
export type RecommendationConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

// Status values from backend
export type RecommendationStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'SNOOZED'
  | 'EXPIRED'
  | 'SUPERSEDED'
  | 'APPLIED'   // Successfully applied via job
  | 'FAILED';   // Job failed to apply

// Entity types
export type RecommendationEntityType = 'LISTING' | 'ASIN';

// Action payload for price changes
export interface PriceActionPayload {
  action: 'CHANGE_PRICE';
  suggested_price_inc_vat: number;
  current_price_inc_vat: number;
  price_change: number;
}

// Action payload for stock changes
export interface StockActionPayload {
  action: 'CHANGE_STOCK';
  suggested_quantity: number;
  current_quantity: number;
  quantity_change: number;
}

// Action payload for cost review
export interface ReviewCostsActionPayload {
  action: 'REVIEW_COSTS';
  current_margin: number;
  min_margin: number;
  break_even_price_inc_vat: number;
}

// Action payload for investigation
export interface InvestigateActionPayload {
  action: 'INVESTIGATE';
  anomaly_type: string;
}

// Action payload for creating listing
export interface CreateListingActionPayload {
  action: 'CREATE_LISTING';
  asin: string;
  estimated_margin: number;
  estimated_profit: number;
}

export type ActionPayload =
  | PriceActionPayload
  | StockActionPayload
  | ReviewCostsActionPayload
  | InvestigateActionPayload
  | CreateListingActionPayload;

// Evidence JSON structure
export interface RecommendationEvidence {
  notes?: string;

  // Price-related evidence
  current_price_inc_vat?: number;
  suggested_price_inc_vat?: number;
  buy_box_status?: string;
  buy_box_percentage_30d?: number | null;
  competitor_price_position?: string;
  current_margin?: number;

  // Keepa evidence
  keepa_price_median_90d?: number | null;
  keepa_price_p25_90d?: number | null;
  keepa_price_p75_90d?: number | null;

  // Inventory evidence
  current_stock?: number;
  days_of_cover?: number | null;
  sales_velocity_30d?: number;
  lead_time_days?: number;
  stockout_risk?: string;

  // Cost evidence
  bom_cost_ex_vat?: number;
  total_cost_ex_vat?: number;
  min_margin_threshold?: number;

  // Anomaly evidence
  sales_anomaly_score?: number;
  units_7d?: number;
  units_30d?: number;

  // ASIN opportunity evidence
  asin?: string;
  title?: string;
  brand?: string;
  category?: string;
  price_current?: number;
  scenario_bom_cost_ex_vat?: number;
  sales_rank_current?: number;
  offers_count_current?: number;

  // Allow additional fields
  [key: string]: unknown;
}

// Guardrails JSON structure
export interface RecommendationGuardrails {
  passed?: boolean;
  new_margin?: number;
  min_margin?: number;
  violation?: string;
  actual?: number;
  threshold?: number;
}

// Impact JSON structure
export interface RecommendationImpact {
  estimated_margin_change?: number;
  estimated_profit_change?: number;
  buy_box_recovery_likelihood?: string;
  buy_box_risk?: string;
  prevented_stockout_days?: number;
  estimated_revenue_protected?: number;
  margin_gap?: number;
  price_increase_needed?: number;
  urgency?: string;
  potential_causes?: string[];
  estimated_margin?: number;
  estimated_profit_per_unit?: number;
}

// Main Recommendation interface - matches backend response
export interface Recommendation {
  id: number;
  recommendation_type: RecommendationType;
  entity_type: RecommendationEntityType;
  entity_id: number;
  status: RecommendationStatus;
  action_payload_json: ActionPayload;
  evidence_json: RecommendationEvidence;
  guardrails_json: RecommendationGuardrails | null;
  impact_json: RecommendationImpact;
  confidence: RecommendationConfidence;
  confidence_score: number; // 0.0 - 1.0
  generation_job_id: number | null;
  expires_at: string | null;
  snoozed_until: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  applied_at: string | null;
  accepted_job_id: number | null;
  generated_at: string;
  created_at: string;
  updated_at: string;

  // Extended response fields (from acceptRecommendation)
  job_id?: number;
  job_type?: string;
  job_created?: boolean;

  // Joined fields from related tables
  listing_sku?: string | null;
  listing_title?: string | null;
  asin?: string | null;
  asin_title?: string | null;
}

export interface RecommendationActionRequest {
  notes?: string;
}

export interface RecommendationSnoozeRequest {
  snooze_until: string; // ISO date
  notes?: string;
}

// Helper to get human-readable title from recommendation type
export function getRecommendationTitle(rec: Recommendation): string {
  const titles: Record<RecommendationType, string> = {
    PRICE_DECREASE_REGAIN_BUYBOX: 'Price Decrease to Regain Buy Box',
    PRICE_INCREASE_MARGIN_OPPORTUNITY: 'Price Increase Opportunity',
    STOCK_INCREASE_STOCKOUT_RISK: 'Restock Warning - Low Inventory',
    STOCK_DECREASE_OVERSTOCK: 'Reduce Excess Stock',
    MARGIN_AT_RISK_COMPONENT_COST: 'Margin At Risk',
    ANOMALY_SALES_DROP: 'Sales Anomaly Detected',
    ANOMALY_CONVERSION_DROP: 'Conversion Rate Anomaly',
    ANOMALY_BUY_BOX_LOSS: 'Unexpected Buy Box Loss',
    OPPORTUNITY_CREATE_LISTING: 'New Listing Opportunity',
  };
  return titles[rec.recommendation_type] || rec.recommendation_type;
}

// Helper to get description from evidence
export function getRecommendationDescription(rec: Recommendation): string {
  return rec.evidence_json?.notes || '';
}

// Helper to get action text from action payload
export function getRecommendationActionText(rec: Recommendation): string {
  const payload = rec.action_payload_json;

  switch (payload.action) {
    case 'CHANGE_PRICE': {
      const p = payload as PriceActionPayload;
      const direction = p.price_change > 0 ? 'Increase' : 'Decrease';
      return `${direction} price from £${p.current_price_inc_vat.toFixed(2)} to £${p.suggested_price_inc_vat.toFixed(2)}`;
    }
    case 'CHANGE_STOCK': {
      const s = payload as StockActionPayload;
      return `Adjust stock from ${s.current_quantity} to ${s.suggested_quantity} units`;
    }
    case 'REVIEW_COSTS': {
      const r = payload as ReviewCostsActionPayload;
      return `Review costs - current margin ${(r.current_margin * 100).toFixed(1)}% is below ${(r.min_margin * 100).toFixed(1)}%`;
    }
    case 'INVESTIGATE':
      return 'Investigate the anomaly and take corrective action';
    case 'CREATE_LISTING': {
      const c = payload as CreateListingActionPayload;
      return `Create listing for ASIN ${c.asin} with estimated ${(c.estimated_margin * 100).toFixed(1)}% margin`;
    }
    default:
      return 'Take recommended action';
  }
}

// Helper to get entity display name
export function getRecommendationEntityName(rec: Recommendation): string {
  if (rec.entity_type === 'LISTING') {
    return rec.listing_sku || rec.listing_title || `Listing #${rec.entity_id}`;
  }
  return rec.asin || rec.asin_title || `ASIN #${rec.entity_id}`;
}
