/**
 * Recommendations API
 */

import { get, post } from './client';
import type {
  Recommendation,
  RecommendationActionRequest,
  RecommendationSnoozeRequest,
} from '../types';

// Get all recommendations
export async function getRecommendations(params?: {
  status?: string;
  type?: string;
  listing_id?: number;
}): Promise<Recommendation[]> {
  return get<Recommendation[]>('/api/v2/recommendations', params);
}

// Get recommendations for a specific listing
export async function getListingRecommendations(
  listingId: number
): Promise<Recommendation[]> {
  return get<Recommendation[]>(`/api/v2/listings/${listingId}/recommendations`);
}

// Get single recommendation
export async function getRecommendation(id: number): Promise<Recommendation> {
  return get<Recommendation>(`/api/v2/recommendations/${id}`);
}

// Accept recommendation
export async function acceptRecommendation(
  id: number,
  request?: RecommendationActionRequest
): Promise<Recommendation> {
  return post<Recommendation>(`/api/v2/recommendations/${id}/accept`, request);
}

// Reject recommendation
export async function rejectRecommendation(
  id: number,
  request?: RecommendationActionRequest
): Promise<Recommendation> {
  return post<Recommendation>(`/api/v2/recommendations/${id}/reject`, request);
}

// Snooze recommendation
export async function snoozeRecommendation(
  id: number,
  request: RecommendationSnoozeRequest
): Promise<Recommendation> {
  return post<Recommendation>(`/api/v2/recommendations/${id}/snooze`, request);
}

// Get recommendation summary/stats
export async function getRecommendationStats(): Promise<{
  total: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  by_severity: Record<string, number>;
}> {
  return get('/api/v2/recommendations/stats');
}
