/**
 * Listings API
 *
 * Uses v2 endpoints where available, falls back to v1 for missing routes.
 */

import { get, post } from './client';
import type {
  Listing,
  ListingWithFeatures,
  ListingFeatures,
  EconomicsResponse,
  PricePublishRequest,
  StockPublishRequest,
  PublishResponse,
  PricePreviewResponse,
} from '../types';

// Get all listings
export async function getListings(): Promise<Listing[]> {
  return get<Listing[]>('/api/v2/listings');
}

// Get single listing by ID
export async function getListing(id: number): Promise<Listing> {
  return get<Listing>(`/api/v2/listings/${id}`);
}

// Get listing with features
export async function getListingWithFeatures(id: number): Promise<ListingWithFeatures> {
  const [listing, features] = await Promise.all([
    getListing(id),
    getListingFeatures(id).catch(() => null),
  ]);
  return { ...listing, features };
}

// Get listing features
export async function getListingFeatures(id: number): Promise<ListingFeatures> {
  return get<ListingFeatures>(`/api/v2/listings/${id}/features`);
}

// Get listing economics
export async function getListingEconomics(id: number): Promise<EconomicsResponse> {
  return get<EconomicsResponse>(`/api/v2/listings/${id}/economics`);
}

// Preview price change
export async function previewPriceChange(
  id: number,
  newPriceIncVat: number
): Promise<PricePreviewResponse> {
  return post<PricePreviewResponse>(`/api/v2/listings/${id}/price/preview`, {
    price_inc_vat: newPriceIncVat,
  });
}

// Publish price change
export async function publishPriceChange(
  id: number,
  request: PricePublishRequest
): Promise<PublishResponse> {
  return post<PublishResponse>(`/api/v2/listings/${id}/price/publish`, request);
}

// Preview stock change
export async function previewStockChange(
  id: number,
  newQuantity: number
): Promise<unknown> {
  return post(`/api/v2/listings/${id}/stock/preview`, {
    available_quantity: newQuantity,
  });
}

// Publish stock change
export async function publishStockChange(
  id: number,
  request: StockPublishRequest
): Promise<PublishResponse> {
  return post<PublishResponse>(`/api/v2/listings/${id}/stock/publish`, request);
}

// Get all listings with features (single API call - features now included in response)
export async function getListingsWithFeatures(): Promise<ListingWithFeatures[]> {
  // The /api/v2/listings endpoint now returns features via LEFT JOIN LATERAL
  // This eliminates N+1 API calls and prevents rate limiting issues
  return get<ListingWithFeatures[]>('/api/v2/listings');
}
