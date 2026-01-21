/**
 * BOM (Bill of Materials) API
 */

import { get, post, put, del } from './client';

export interface Component {
  id: number;
  component_sku: string;
  name: string;
  description: string | null;
  unit_cost_ex_vat: number;
  supplier_id: number | null;
  lead_time_days: number | null;
  created_at: string;
  updated_at: string;
}

export interface BomLine {
  id: number;
  bom_id: number;
  component_id: number;
  quantity: number;
  wastage_rate: number;
  component?: Component;
}

export interface Bom {
  id: number;
  listing_id: number | null;
  asin_entity_id: number | null;
  scope_type: 'LISTING' | 'ASIN_SCENARIO';
  version: number;
  is_active: boolean;
  notes: string | null;
  lines: BomLine[];
  total_cost_ex_vat: number;
  created_at: string;
  activated_at: string | null;
}

export interface CreateBomRequest {
  listing_id?: number;
  asin_entity_id?: number;
  scope_type: 'LISTING' | 'ASIN_SCENARIO';
  notes?: string;
  lines: {
    component_id: number;
    quantity: number;
    wastage_rate?: number;
  }[];
}

export interface UpdateBomLinesRequest {
  lines: {
    component_id: number;
    quantity: number;
    wastage_rate?: number;
  }[];
}

// Components
export async function getComponents(): Promise<Component[]> {
  return get<Component[]>('/api/v2/components');
}

export async function getComponent(id: number): Promise<Component> {
  return get<Component>(`/api/v2/components/${id}`);
}

export async function createComponent(
  data: Omit<Component, 'id' | 'created_at' | 'updated_at'>
): Promise<Component> {
  return post<Component>('/api/v2/components', data);
}

export async function updateComponent(
  id: number,
  data: Partial<Omit<Component, 'id' | 'created_at' | 'updated_at'>>
): Promise<Component> {
  return put<Component>(`/api/v2/components/${id}`, data);
}

export async function deleteComponent(id: number): Promise<void> {
  return del(`/api/v2/components/${id}`);
}

// BOMs
export async function getBoms(listingId?: number): Promise<Bom[]> {
  const params = listingId ? { listing_id: listingId } : undefined;
  return get<Bom[]>('/api/v2/boms', params);
}

export async function getBom(id: number): Promise<Bom> {
  return get<Bom>(`/api/v2/boms/${id}`);
}

export async function getActiveBomForListing(listingId: number): Promise<Bom | null> {
  try {
    return await get<Bom>(`/api/v2/listings/${listingId}/bom`);
  } catch {
    return null;
  }
}

export async function createBom(data: CreateBomRequest): Promise<Bom> {
  return post<Bom>('/api/v2/boms', data);
}

export async function updateBomLines(
  bomId: number,
  data: UpdateBomLinesRequest
): Promise<Bom> {
  return put<Bom>(`/api/v2/boms/${bomId}/lines`, data);
}

export async function activateBom(bomId: number): Promise<Bom> {
  return post<Bom>(`/api/v2/boms/${bomId}/activate`, {});
}

export async function getBomHistory(listingId: number): Promise<Bom[]> {
  return get<Bom[]>(`/api/v2/listings/${listingId}/bom/history`);
}
