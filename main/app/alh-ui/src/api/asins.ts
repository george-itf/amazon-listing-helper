/**
 * ASIN Analyzer API
 */

import { get, post } from './client';

export interface AsinEntity {
  id: number;
  asin: string;
  marketplace_id: number;
  title: string | null;
  category: string | null;
  brand: string | null;
  status: 'NEW' | 'ANALYZING' | 'READY' | 'CONVERTED' | 'REJECTED';
  created_at: string;
  updated_at: string;
}

export interface AsinAnalysis {
  asin_entity_id: number;
  asin: string;
  sync_job_id?: number;
  market_data?: {
    keepa_price_median_90d: number | null;
    keepa_price_p25_90d: number | null;
    keepa_price_p75_90d: number | null;
    keepa_volatility_90d: number | null;
    keepa_offers_count_current: number | null;
    keepa_rank_trend_90d: number | null;
  };
  economics_scenario: {
    suggested_price_inc_vat: number;
    bom_cost_ex_vat: number;
    estimated_fees_ex_vat: number;
    estimated_profit_ex_vat: number;
    estimated_margin: number;
  } | null;
  opportunity_score: number | null;
  recommendation: string | null;
  analyzed_at: string;
}

export interface ConvertToListingRequest {
  seller_sku: string;
  initial_price_inc_vat: number;
  initial_quantity: number;
  bom_id?: number;
}

export interface ConvertToListingResponse {
  listing_id: number;
  seller_sku: string;
  asin: string;
}

// Analyze an ASIN
export async function analyzeAsin(asin: string): Promise<AsinAnalysis> {
  return post<AsinAnalysis>('/api/v2/asins/analyze', { asin });
}

// Get ASIN entity by ID
export async function getAsinEntity(id: number): Promise<AsinEntity> {
  return get<AsinEntity>(`/api/v2/asins/${id}`);
}

// Get all tracked ASINs
export async function getTrackedAsins(): Promise<AsinEntity[]> {
  return get<AsinEntity[]>('/api/v2/asins');
}

// Track a new ASIN
export async function trackAsin(asin: string): Promise<AsinEntity> {
  return post<AsinEntity>('/api/v2/asins/track', { asin });
}

// Convert ASIN to listing
export async function convertAsinToListing(
  asinEntityId: number,
  request: ConvertToListingRequest
): Promise<ConvertToListingResponse> {
  return post<ConvertToListingResponse>(
    `/api/v2/asins/${asinEntityId}/convert`,
    request
  );
}

// Get ASIN analysis (cached)
export async function getAsinAnalysis(asinEntityId: number): Promise<AsinAnalysis> {
  return get<AsinAnalysis>(`/api/v2/asins/${asinEntityId}/analysis`);
}
