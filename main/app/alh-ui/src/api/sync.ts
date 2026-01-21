/**
 * Sync API - Amazon SP-API listing sync
 */

import { post, get } from './client';

export interface SyncResult {
  message: string;
  success: boolean;
  listingsProcessed: number;
  listingsCreated: number;
  listingsUpdated: number;
  errors: Array<{ sku?: string; error: string }>;
  duration: number;
}

export interface SyncStatus {
  spApiConfigured: boolean;
  listingCount: number;
  lastSync: string | null;
}

// Sync listings from Amazon SP-API
export async function syncListingsFromAmazon(): Promise<SyncResult> {
  return post<SyncResult>('/api/v2/sync/listings');
}

// Get sync status
export async function getSyncStatus(): Promise<SyncStatus> {
  return get<SyncStatus>('/api/v2/sync/status');
}
