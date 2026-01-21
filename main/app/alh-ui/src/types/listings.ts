/**
 * Listing Types (per DATA_CONTRACTS.md)
 */

export type BuyBoxStatus = 'WON' | 'LOST' | 'UNKNOWN';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
export type PricePosition = 'BELOW_BAND' | 'IN_BAND' | 'ABOVE_BAND' | null;

export interface Listing {
  id: number;
  seller_sku: string;
  asin: string | null;
  title: string;
  marketplace_id: number;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: string;
  updated_at: string;
}

export interface ListingWithFeatures extends Listing {
  features: ListingFeatures | null;
}

export interface ListingFeatures {
  // Economics
  vat_rate: number;
  price_inc_vat: number;
  price_ex_vat: number;
  bom_cost_ex_vat: number;
  shipping_cost_ex_vat: number;
  packaging_cost_ex_vat: number;
  amazon_fees_ex_vat: number;
  profit_ex_vat: number;
  margin: number;
  break_even_price_inc_vat: number;

  // Sales/Performance
  units_7d: number;
  units_30d: number;
  revenue_inc_vat_7d: number;
  revenue_inc_vat_30d: number;
  sessions_30d: number | null;
  conversion_rate_30d: number | null;
  sales_velocity_units_per_day_30d: number;

  // Inventory
  available_quantity: number;
  days_of_cover: number | null;
  lead_time_days: number | null;
  stockout_risk: RiskLevel;

  // Buy Box
  buy_box_status: BuyBoxStatus;
  buy_box_percentage_30d: number | null;
  buy_box_risk: RiskLevel;
  competitor_price_position: PricePosition;

  // Keepa Signals
  keepa_price_median_90d: number | null;
  keepa_price_p25_90d: number | null;
  keepa_price_p75_90d: number | null;
  keepa_volatility_90d: number | null;
  keepa_offers_count_current: number | null;
  keepa_offers_trend_30d: number | null;
  keepa_rank_trend_90d: number | null;

  // Anomaly Signals
  sales_anomaly_score: number;
  conversion_anomaly_score: number | null;
  buy_box_anomaly_score: number | null;

  // Metadata
  computed_at: string;
}

export interface PricePublishRequest {
  price_inc_vat: number;
  reason: string;
  correlation_id?: string;
}

export interface StockPublishRequest {
  available_quantity: number;
  reason: string;
}

export interface PublishResponse {
  job_id: number;
  status: 'PENDING';
  listing_id: number;
  listing_event_id: number;
}

export interface PricePreviewResponse {
  listing_id: number;
  current_price_inc_vat: number;
  new_price_inc_vat: number;
  economics: {
    price_inc_vat: number;
    price_ex_vat: number;
    profit_ex_vat: number;
    margin: number;
    break_even_price_inc_vat?: number;
    bom_cost_ex_vat?: number;
    total_cost_ex_vat?: number;
  };
  guardrails: {
    passed: boolean;
    violations: Array<{
      rule: string;
      threshold: number;
      actual: number;
      message: string;
    }>;
  };
}
