/**
 * Jobs API
 *
 * API client for job visibility and management.
 */

import { get, post } from './client';

export interface Job {
  id: number;
  job_type: string;
  scope_type: string;
  listing_id: number | null;
  asin_entity_id: number | null;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  priority: number;
  input_json: Record<string, unknown> | null;
  result_json: Record<string, unknown> | null;
  error_message: string | null;
  attempts: number;
  max_attempts: number;
  scheduled_for: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  listing_sku?: string;
}

export interface JobStats {
  PENDING: number;
  RUNNING: number;
  SUCCEEDED: number;
  FAILED: number;
  CANCELLED: number;
}

// Get all jobs with optional filters
export async function getJobs(params?: {
  types?: string;
  statuses?: string;
  limit?: number;
  offset?: number;
}): Promise<Job[]> {
  return get<Job[]>('/api/v2/jobs', params);
}

// Get job statistics by status
export async function getJobStats(): Promise<JobStats> {
  return get<JobStats>('/api/v2/jobs/stats');
}

// Get a specific job
export async function getJob(id: number): Promise<Job> {
  return get<Job>(`/api/v2/jobs/${id}`);
}

// Retry a failed job
export async function retryJob(id: number): Promise<Job> {
  return post<Job>(`/api/v2/jobs/${id}/retry`);
}

// Cancel a pending or running job
export async function cancelJob(id: number): Promise<{ cancelled: boolean; job_id: number }> {
  return post<{ cancelled: boolean; job_id: number }>(`/api/v2/jobs/${id}/cancel`);
}

// Get jobs for a specific listing
export async function getListingJobs(
  listingId: number,
  params?: {
    types?: string;
    statuses?: string;
    limit?: number;
  }
): Promise<Job[]> {
  return get<Job[]>(`/api/v2/listings/${listingId}/jobs`, params);
}
