/**
 * Sync API - Amazon SP-API listing sync
 */

import { get } from './client';
import { apiClient } from './client';

export interface SyncResult {
  message: string;
  success: boolean;
  listingsProcessed: number;
  listingsCreated: number;
  listingsUpdated: number;
  errors: Array<{ sku?: string; error: string }>;
  duration: number;
  stage?: string;
}

export interface SyncStatus {
  spApiConfigured: boolean;
  listingCount: number;
  lastSync: string | null;
}

export interface ConnectionTestResult {
  success: boolean;
  configured: boolean;
  error?: string;
  marketplaces?: number;
}

// Test SP-API connection
export async function testSpApiConnection(): Promise<ConnectionTestResult> {
  return get<ConnectionTestResult>('/api/v2/sync/test');
}

// Sync listings from Amazon SP-API
// Note: This can take several minutes - using a 10 minute timeout
export async function syncListingsFromAmazon(): Promise<SyncResult> {
  const response = await apiClient.post<{ success: boolean; data: SyncResult; error?: string }>(
    '/api/v2/sync/listings',
    {},
    { timeout: 600000 } // 10 minute timeout
  );

  if (response.data.success === false) {
    throw new Error(response.data.error || 'Sync failed');
  }

  return response.data.data;
}

// Get sync status
export async function getSyncStatus(): Promise<SyncStatus> {
  return get<SyncStatus>('/api/v2/sync/status');
}
