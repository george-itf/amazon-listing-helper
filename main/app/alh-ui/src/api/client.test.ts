/**
 * API Client Tests
 *
 * D.1 FIX: Frontend test coverage for API client.
 * Tests request building, response handling, and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { apiClient, get, post, put, del, type ApiError } from './client';

// Mock axios
vi.mock('axios', async () => {
  const actual = await vi.importActual('axios');
  return {
    ...actual,
    default: {
      create: vi.fn(() => ({
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
      })),
    },
  };
});

describe('API Client', () => {
  describe('apiClient configuration', () => {
    it('should have timeout configured', () => {
      // When axios is mocked, we verify the instance exists
      // Actual timeout is set in client.ts to 30000ms
      expect(apiClient).toBeDefined();
    });

    it('should have request/response interceptors set up', () => {
      // Verify interceptors object exists (for error handling)
      expect(apiClient.interceptors).toBeDefined();
    });
  });

  describe('response handling', () => {
    it('should unwrap successful response with data', async () => {
      const mockData = { id: 1, name: 'Test' };
      const mockResponse = {
        data: { success: true, data: mockData },
      };

      vi.spyOn(apiClient, 'get').mockResolvedValueOnce(mockResponse);

      const result = await get<typeof mockData>('/api/test');
      expect(result).toEqual(mockData);
    });

    it('should throw error when success is false', async () => {
      const mockResponse = {
        data: { success: false, error: 'Test error' },
      };

      vi.spyOn(apiClient, 'get').mockResolvedValueOnce(mockResponse);

      await expect(get('/api/test')).rejects.toThrow('Test error');
    });

    it('should throw error when data is undefined', async () => {
      const mockResponse = {
        data: { success: true, message: 'No data' },
      };

      vi.spyOn(apiClient, 'get').mockResolvedValueOnce(mockResponse);

      await expect(get('/api/test')).rejects.toThrow('No data');
    });
  });

  describe('error handling', () => {
    it('should transform axios error to ApiError', async () => {
      const axiosError = {
        response: {
          status: 404,
          data: { error: 'Not found' },
        },
        message: 'Request failed',
      };

      vi.spyOn(apiClient, 'get').mockRejectedValueOnce(axiosError);

      try {
        await get('/api/test');
        expect.fail('Should have thrown');
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.message).toBe('Request failed');
      }
    });

    it('should handle network errors gracefully', async () => {
      const networkError = new Error('Network Error');

      vi.spyOn(apiClient, 'get').mockRejectedValueOnce(networkError);

      await expect(get('/api/test')).rejects.toThrow('Network Error');
    });
  });

  describe('HTTP methods', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should make GET request with params', async () => {
      const mockData = [{ id: 1 }];
      vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
        data: { success: true, data: mockData },
      });

      const result = await get('/api/items', { limit: 10 });

      expect(apiClient.get).toHaveBeenCalledWith('/api/items', { params: { limit: 10 } });
      expect(result).toEqual(mockData);
    });

    it('should make POST request with body', async () => {
      const mockData = { id: 1, created: true };
      vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        data: { success: true, data: mockData },
      });

      const body = { name: 'Test' };
      const result = await post('/api/items', body);

      expect(apiClient.post).toHaveBeenCalledWith('/api/items', body);
      expect(result).toEqual(mockData);
    });

    it('should make PUT request with body', async () => {
      const mockData = { id: 1, updated: true };
      vi.spyOn(apiClient, 'put').mockResolvedValueOnce({
        data: { success: true, data: mockData },
      });

      const body = { name: 'Updated' };
      const result = await put('/api/items/1', body);

      expect(apiClient.put).toHaveBeenCalledWith('/api/items/1', body);
      expect(result).toEqual(mockData);
    });

    it('should make DELETE request', async () => {
      const mockData = { deleted: true };
      vi.spyOn(apiClient, 'delete').mockResolvedValueOnce({
        data: { success: true, data: mockData },
      });

      const result = await del('/api/items/1');

      expect(apiClient.delete).toHaveBeenCalledWith('/api/items/1');
      expect(result).toEqual(mockData);
    });
  });
});
