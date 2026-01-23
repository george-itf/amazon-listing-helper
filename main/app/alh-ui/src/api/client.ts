/**
 * API Client - Single entry point for all API calls
 *
 * Per work order: All API calls go through this module.
 * Base URL comes from VITE_API_BASE environment variable.
 */

import axios, { type AxiosInstance, type AxiosError } from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const API_KEY = import.meta.env.VITE_API_KEY || '';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * D.4 FIX: Properly typed API error structure
 */
export interface ApiErrorDetails {
  error?: string;
  message?: string;
  code?: string;
  field?: string;
  violations?: Array<{
    rule: string;
    message: string;
  }>;
}

export interface ApiError {
  message: string;
  status: number;
  details?: ApiErrorDetails;
}

// Create axios instance with defaults
export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
    // Include API key if configured (required in production)
    ...(API_KEY && { 'X-API-Key': API_KEY }),
  },
  timeout: 30000,
});

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: string; message?: string }>) => {
    const apiError: ApiError = {
      message: error.response?.data?.error ||
               error.response?.data?.message ||
               error.message ||
               'An unexpected error occurred',
      status: error.response?.status || 500,
      details: error.response?.data,
    };
    return Promise.reject(apiError);
  }
);

// Helper to unwrap API response safely
function unwrapResponse<T>(response: { data: ApiResponse<T> }, context: string): T {
  if (response.data.success === false) {
    throw new Error(response.data.error || `${context} failed`);
  }
  if (response.data.data === undefined) {
    throw new Error(response.data.message || `${context} returned no data`);
  }
  return response.data.data;
}

// Generic GET request
export async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const response = await apiClient.get<ApiResponse<T>>(url, { params });
  return unwrapResponse(response, `GET ${url}`);
}

// Generic POST request
export async function post<T>(url: string, data?: unknown): Promise<T> {
  const response = await apiClient.post<ApiResponse<T>>(url, data);
  return unwrapResponse(response, `POST ${url}`);
}

// Generic PUT request
export async function put<T>(url: string, data?: unknown): Promise<T> {
  const response = await apiClient.put<ApiResponse<T>>(url, data);
  return unwrapResponse(response, `PUT ${url}`);
}

// Generic PATCH request
export async function patch<T>(url: string, data?: unknown): Promise<T> {
  const response = await apiClient.patch<ApiResponse<T>>(url, data);
  return unwrapResponse(response, `PATCH ${url}`);
}

// Generic DELETE request
export async function del<T>(url: string): Promise<T> {
  const response = await apiClient.delete<ApiResponse<T>>(url);
  return unwrapResponse(response, `DELETE ${url}`);
}

export default apiClient;
