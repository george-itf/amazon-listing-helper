/**
 * Attention Queue API
 *
 * API client for fetching prioritized attention items.
 */

import { get } from './client';

export interface AttentionItem {
  id: string;
  type: 'FAILED_JOB' | 'BUY_BOX_LOST' | 'MARGIN_AT_RISK' | 'STOCKOUT_RISK' | 'STALE_DATA';
  priority: number;
  title: string;
  description: string;
  listing_id?: number;
  listing_sku?: string;
  listing_title?: string;
  job_id?: number;
  features?: Record<string, unknown>;
  timestamp?: string;
  action: string;
}

// Get attention queue items
export async function getAttentionQueue(params?: {
  limit?: number;
}): Promise<AttentionItem[]> {
  return get<AttentionItem[]>('/api/v2/attention-queue', params);
}
