/**
 * ASIN Analyzer API
 */

import { get, post, patch } from './client';

// Pipeline stages for opportunity tracking
export type PipelineStage = 'INBOX' | 'QUALIFIED' | 'COSTED' | 'READY' | 'CONVERTED' | 'REJECTED';

export const PIPELINE_STAGES: PipelineStage[] = [
  'INBOX',
  'QUALIFIED',
  'COSTED',
  'READY',
  'CONVERTED',
  'REJECTED',
];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  INBOX: 'Inbox',
  QUALIFIED: 'Qualified',
  COSTED: 'Costed',
  READY: 'Ready',
  CONVERTED: 'Converted',
  REJECTED: 'Rejected',
};

export const STAGE_DESCRIPTIONS: Record<PipelineStage, string> = {
  INBOX: 'Newly tracked ASINs awaiting review',
  QUALIFIED: 'Meets minimum criteria (margin, rank)',
  COSTED: 'BOM scenario attached',
  READY: 'Full analysis complete, decision pending',
  CONVERTED: 'Became a listing',
  REJECTED: 'Not pursuing',
};

export interface AsinEntity {
  id: number;
  asin: string;
  marketplace_id: number;
  title: string | null;
  category: string | null;
  brand: string | null;
  status: 'NEW' | 'ANALYZING' | 'READY' | 'CONVERTED' | 'REJECTED';
  pipeline_stage: PipelineStage;
  is_tracked: boolean;
  tracked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface KeepaMarketData {
  // Product info
  title: string | null;
  brand: string | null;
  category: string | null;
  main_image_url: string | null;

  // Current prices
  price_current: number | null;
  price_amazon: number | null;
  buy_box_price: number | null;

  // Price statistics (90 day)
  keepa_price_median_90d: number | null;
  keepa_price_p25_90d: number | null;
  keepa_price_p75_90d: number | null;
  keepa_price_min_90d: number | null;
  keepa_price_max_90d: number | null;
  keepa_volatility_90d: number | null;

  // Sales rank
  sales_rank_current: number | null;
  sales_rank_avg_90d: number | null;
  keepa_rank_trend_90d: number | null;

  // Offers/Competition
  keepa_offers_count_current: number | null;
  offers_fba_count: number | null;
  offers_fbm_count: number | null;

  // Buy Box info
  buy_box_is_amazon: boolean | null;

  // Rating
  rating: number | null;
  rating_count: number | null;

  // Stock/Availability
  out_of_stock_percentage_90d: number | null;

  // Timestamps
  last_update: string | null;
  last_price_change: string | null;
}

export interface AsinAnalysis {
  asin_entity_id: number;
  asin: string;
  sync_job_id?: number;
  market_data?: KeepaMarketData;
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

// Response type for ASIN list with stage counts
export interface AsinListResponse {
  items: AsinEntity[];
  stage_counts: Record<PipelineStage, number>;
}

// Get all tracked ASINs with optional stage filter
export async function getTrackedAsins(stage?: PipelineStage): Promise<AsinListResponse> {
  const params: Record<string, string> = { tracked_only: 'true' };
  if (stage) {
    params.stage = stage;
  }
  return get<AsinListResponse>('/api/v2/asins', params);
}

// Get all ASINs (not just tracked)
export async function getAllAsins(): Promise<AsinListResponse> {
  return get<AsinListResponse>('/api/v2/asins');
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

// Update pipeline stage for a single ASIN
export async function updateAsinStage(
  asinEntityId: number,
  stage: PipelineStage
): Promise<AsinEntity> {
  return patch<AsinEntity>(`/api/v2/asins/${asinEntityId}/stage`, { stage });
}

// Batch update pipeline stage for multiple ASINs
export interface BatchStageResponse {
  updated_count: number;
  updated_ids: number[];
  stage: PipelineStage;
}

export async function batchUpdateAsinStage(
  ids: number[],
  stage: PipelineStage
): Promise<BatchStageResponse> {
  return post<BatchStageResponse>('/api/v2/asins/batch-stage', { ids, stage });
}
