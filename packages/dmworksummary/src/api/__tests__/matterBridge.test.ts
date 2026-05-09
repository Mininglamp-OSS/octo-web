import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockPost, mockRequestUse, mockResponseUse } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockRequestUse: vi.fn(),
  mockResponseUse: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: mockGet,
      post: mockPost,
      interceptors: {
        request: { use: mockRequestUse },
        response: { use: mockResponseUse },
      },
    }),
  },
}));

import { listMatters, addComment } from '../matterBridge';

describe('matterBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listMatters', () => {
    it('calls GET /matter/api/v1/matters with params', async () => {
      const mockData = {
        data: [{ id: '1', title: 'Test', status: 'open', creator_id: 'u1', created_at: '', updated_at: '' }],
        pagination: { has_more: false },
      };
      mockGet.mockResolvedValue({ data: mockData });

      const result = await listMatters({ status: 'open', q: 'test', limit: 50 });

      expect(mockGet).toHaveBeenCalledWith('/matter/api/v1/matters', {
        params: { status: 'open', q: 'test', limit: '50' },
      });
      expect(result).toEqual(mockData);
    });

    it('omits undefined/null params', async () => {
      mockGet.mockResolvedValue({
        data: { data: [], pagination: { has_more: false } },
      });

      await listMatters({ status: 'open', q: undefined, limit: 20 });

      expect(mockGet).toHaveBeenCalledWith('/matter/api/v1/matters', {
        params: { status: 'open', limit: '20' },
      });
    });

    it('returns resp.data directly (no envelope unwrap)', async () => {
      const rawData = { data: [], pagination: { has_more: true, next_cursor: 'abc' } };
      mockGet.mockResolvedValue({ data: rawData });

      const result = await listMatters();

      expect(result).toBe(rawData);
    });

    it('extracts error message from response', async () => {
      mockGet.mockRejectedValue({
        response: { data: { error: { message: 'Forbidden' } } },
      });

      await expect(listMatters()).rejects.toThrow('Forbidden');
    });

    it('falls back to generic error message', async () => {
      mockGet.mockRejectedValue(new Error('Network Error'));

      await expect(listMatters()).rejects.toThrow('Network Error');
    });

    it('truncates long error messages to 200 chars', async () => {
      const longMsg = 'x'.repeat(300);
      mockGet.mockRejectedValue({
        response: { data: { error: { message: longMsg } } },
      });

      try {
        await listMatters();
      } catch (err: any) {
        expect(err.message).toHaveLength(201);
        expect(err.message.endsWith('…')).toBe(true);
      }
    });
  });

  describe('addComment', () => {
    it('calls POST /matter/api/v1/matters/:id/comments with trimmed content', async () => {
      mockPost.mockResolvedValue({ data: {} });

      await addComment('m1', '  Hello World  ');

      expect(mockPost).toHaveBeenCalledWith(
        '/matter/api/v1/matters/m1/comments',
        { content: 'Hello World' },
      );
    });

    it('rejects empty content', async () => {
      await expect(addComment('m1', '')).rejects.toThrow('Comment content cannot be empty');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('rejects whitespace-only content', async () => {
      await expect(addComment('m1', '   ')).rejects.toThrow('Comment content cannot be empty');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('extracts error message on failure', async () => {
      mockPost.mockRejectedValue({
        response: { data: { error: { message: 'Matter not found' } } },
      });

      await expect(addComment('m1', 'content')).rejects.toThrow('Matter not found');
    });

    it('handles non-Error rejection gracefully', async () => {
      mockPost.mockRejectedValue('string error');

      await expect(addComment('m1', 'content')).rejects.toThrow('Request failed');
    });
  });

  describe('interceptors', () => {
    const getRequestInterceptor = () => mockRequestUse.mock.calls[mockRequestUse.mock.calls.length - 1]?.[0];
    const getResponseErrorHandler = () => mockResponseUse.mock.calls[mockResponseUse.mock.calls.length - 1]?.[1];

    it('registers request and response interceptors', async () => {
      // Re-import to trigger interceptor registration fresh
      vi.resetModules();
      mockRequestUse.mockClear();
      mockResponseUse.mockClear();
      await import('../matterBridge');
      expect(mockRequestUse).toHaveBeenCalledTimes(1);
      expect(mockResponseUse).toHaveBeenCalledTimes(1);
    });

    it('request interceptor injects token and space headers', async () => {
      vi.resetModules();
      mockRequestUse.mockClear();
      await import('../matterBridge');
      const requestInterceptor = getRequestInterceptor();
      const config = { headers: {} } as any;

      const result = requestInterceptor(config);

      expect(result.headers['token']).toBe('test-token-abc');
      expect(result.headers['X-Space-Id']).toBe('space-123');
    });

    it('response error interceptor rejects the error', async () => {
      vi.resetModules();
      mockResponseUse.mockClear();
      await import('../matterBridge');
      const errorHandler = getResponseErrorHandler();
      const err = { response: { status: 500 } };

      await expect(errorHandler(err)).rejects.toBe(err);
    });

    it('response error interceptor calls logout on 401', async () => {
      vi.resetModules();
      mockResponseUse.mockClear();
      const { WKApp } = await import('@octo/base');
      const logoutSpy = vi.spyOn(WKApp.shared, 'logout');
      await import('../matterBridge');
      const errorHandler = getResponseErrorHandler();
      const err = { response: { status: 401 } };

      await expect(errorHandler(err)).rejects.toBe(err);
      expect(logoutSpy).toHaveBeenCalledTimes(1);
    });
  });
});
