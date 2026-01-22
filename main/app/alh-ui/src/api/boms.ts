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
  current_stock: number;
  supplier_id: number | null;
  lead_time_days: number | null;
  created_at: string;
  updated_at: string;
}

export interface BomLine {
  id: number;
  bom_id?: number;
  component_id: number;
  quantity: number;
  wastage_rate: number;
  notes?: string | null;
  // Flattened component fields from backend (not nested)
  component_sku?: string;
  component_name?: string;
  unit_cost_ex_vat?: number;
  line_cost_ex_vat?: number;
  // Legacy nested component (kept for backwards compatibility)
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

// Bulk operations
export interface ImportComponentRow {
  component_sku: string;
  name: string;
  description?: string;
  category?: string;
  unit_cost_ex_vat?: number;
  supplier_sku?: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  errors: Array<{ row: number; error: string }>;
}

export interface BulkUpdateResult {
  updated: number;
  failed: number;
  errors: Array<{ id: number | null; error: string }>;
}

export async function importComponents(rows: ImportComponentRow[]): Promise<ImportResult> {
  return post<ImportResult>('/api/v2/components/import', { rows });
}

export async function bulkUpdateComponents(
  updates: Array<{ id: number } & Partial<Omit<Component, 'id' | 'created_at' | 'updated_at'>>>
): Promise<BulkUpdateResult> {
  return put<BulkUpdateResult>('/api/v2/components/bulk', { updates });
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
