/**
 * Economics Types (per DATA_CONTRACTS.md §4)
 */

export interface EconomicsRequest {
  listing_id: number;
  scenario?: {
    price_inc_vat?: number;
    bom_cost_multiplier?: number;
  };
}

export interface EconomicsResponse {
  listing_id: number;
  marketplace_id: number;
  vat_rate: number;

  // Price fields
  price_inc_vat: number;
  price_ex_vat: number;

  // Cost fields (all VAT-exclusive)
  bom_cost_ex_vat: number;
  shipping_cost_ex_vat: number;
  packaging_cost_ex_vat: number;
  amazon_fees_ex_vat: number;
  total_cost_ex_vat: number;

  // Derived fields
  net_revenue_ex_vat: number;
  profit_ex_vat: number;
  margin: number;
  break_even_price_inc_vat: number;

  // Metadata
  computed_at: string;
  bom_version: number | null;
  fee_snapshot_id: number | null;
}

export interface GuardrailsResult {
  passed: boolean;
  violations: GuardrailViolation[];
}

export interface GuardrailViolation {
  rule: string;
  threshold: number;
  actual: number;
  message: string;
}
