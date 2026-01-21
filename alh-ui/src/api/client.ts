/**
 * API Client - Single entry point for all API calls
 *
 * Per work order: All API calls go through this module.
 * Base URL comes from VITE_API_BASE environment variable.
 */

import axios, { type AxiosInstance, type AxiosError } from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || '';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ApiError {
  message: string;
  status: number;
  details?: unknown;
}

// Create axios instance with defaults
export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
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

// Generic GET request
export async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const response = await apiClient.get<ApiResponse<T>>(url, { params });
  if (response.data.success === false) {
    throw new Error(response.data.error || 'Request failed');
  }
  return response.data.data as T;
}

// Generic POST request
export async function post<T>(url: string, data?: unknown): Promise<T> {
  const response = await apiClient.post<ApiResponse<T>>(url, data);
  if (response.data.success === false) {
    throw new Error(response.data.error || 'Request failed');
  }
  return response.data.data as T;
}

// Generic PUT request
export async function put<T>(url: string, data?: unknown): Promise<T> {
  const response = await apiClient.put<ApiResponse<T>>(url, data);
  if (response.data.success === false) {
    throw new Error(response.data.error || 'Request failed');
  }
  return response.data.data as T;
}

// Generic DELETE request
export async function del<T>(url: string): Promise<T> {
  const response = await apiClient.delete<ApiResponse<T>>(url);
  if (response.data.success === false) {
    throw new Error(response.data.error || 'Request failed');
  }
  return response.data.data as T;
}

export default apiClient;
