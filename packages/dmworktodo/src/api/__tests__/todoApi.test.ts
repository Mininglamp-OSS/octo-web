import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

// Mock axios before importing the module under test
vi.mock('axios', () => {
  const mockInstance = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  };
  return {
    default: {
      create: vi.fn(() => mockInstance),
      ...mockInstance,
    },
    __mockInstance: mockInstance,
  };
});

vi.mock('@octo/base', () => {
  const messages: Record<string, string> = {
    'todo.status.pending': '待处理',
    'todo.status.done': '已完成',
    'todo.status.archived': '已归档',
  };
  const t = (key: string) => messages[key] ?? key;

  return {
    WKApp: {
      loginInfo: { token: 'test-token-abc', uid: 'test-uid' },
      shared: {
        currentSpaceId: 'space-123',
        logout: vi.fn(),
      },
    },
    buildAcceptLanguage: () => 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    useI18n: () => ({
      locale: 'zh-CN',
      setLocale: () => {},
      t,
      format: {},
    }),
    t,
  };
});

// We need to import after mocking
import * as matterApi from '../../api/todoApi';

// Get the mock instance that axios.create() returned
const getMockInstance = () => {
  const axiosDefault = axios as any;
  return axiosDefault.create.mock.results[0]?.value || axiosDefault.__mockInstance || axiosDefault;
};

describe('matterApi', () => {
  let mockAxios: any;

  beforeEach(() => {
    mockAxios = getMockInstance();
    vi.clearAllMocks();
  });

  describe('interceptors', () => {
    it('injects language, token, and space headers', async () => {
      vi.resetModules();
      mockAxios.interceptors.request.use.mockClear();
      await import('../../api/todoApi');
      const requestInterceptor = mockAxios.interceptors.request.use.mock.calls[0]?.[0];
      const config = { headers: {} } as any;

      const result = requestInterceptor(config);

      expect(result.headers['Accept-Language']).toBe('zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7');
      expect(result.headers['token']).toBe('test-token-abc');
      expect(result.headers['X-Space-Id']).toBe('space-123');
    });
  });

  describe('listMatters', () => {
    it('calls GET /matters with params', async () => {
      const mockResponse = { data: { data: [], pagination: { has_more: false } } };
      mockAxios.get.mockResolvedValueOnce(mockResponse);

      const result = await matterApi.listMatters({ status: 'open' });

      expect(mockAxios.get).toHaveBeenCalledWith(
        '/matter/api/v1/matters',
        { params: { status: 'open' } },
      );
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('createMatter', () => {
    it('sends POST to /matters with body', async () => {
      const mockResponse = { data: { id: 't1', title: 'Test' } };
      mockAxios.post.mockResolvedValueOnce(mockResponse);

      const result = await matterApi.createMatter({ title: 'Test' });

      expect(mockAxios.post).toHaveBeenCalledWith(
        '/matter/api/v1/matters',
        { title: 'Test' },
      );
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('transitionMatter', () => {
    it('sends PUT to /matters/:id/status', async () => {
      const mockResponse = { data: { id: 't1', status: 'done' } };
      mockAxios.put.mockResolvedValueOnce(mockResponse);

      const result = await matterApi.transitionMatter('t1', 'done');

      expect(mockAxios.put).toHaveBeenCalledWith(
        '/matter/api/v1/matters/t1/status',
        { status: 'done' },
      );
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('getMatter', () => {
    it('sends GET to /matters/:id', async () => {
      const mockResponse = { data: { id: 't1', title: 'Test', assignees: [] } };
      mockAxios.get.mockResolvedValueOnce(mockResponse);

      const result = await matterApi.getMatter('t1');

      expect(mockAxios.get).toHaveBeenCalledWith(
        '/matter/api/v1/matters/t1',
        { params: {} },
      );
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('addComment', () => {
    it('sends POST to /matters/:id/timeline with content', async () => {
      const mockResponse = { data: { id: 'c1', content: 'hello' } };
      mockAxios.post.mockResolvedValueOnce(mockResponse);

      const result = await matterApi.addComment('t1', 'hello');

      expect(mockAxios.post).toHaveBeenCalledWith(
        '/matter/api/v1/matters/t1/timeline',
        { content: 'hello', attachments: undefined },
      );
      expect(result).toEqual(mockResponse.data);
    });

    it('sends POST with attachments', async () => {
      const mockResponse = { data: { id: 'c1', content: 'see file', attachments: [{ id: 'a1' }] } };
      mockAxios.post.mockResolvedValueOnce(mockResponse);

      const result = await matterApi.addComment('t1', 'see file', [{ file_url: 'https://example.com/file.pdf' }]);

      expect(mockAxios.post).toHaveBeenCalledWith(
        '/matter/api/v1/matters/t1/timeline',
        { content: 'see file', attachments: [{ file_url: 'https://example.com/file.pdf' }] },
      );
      expect(result).toEqual(mockResponse.data);
    });

    it('sends POST with empty content (content becomes undefined)', async () => {
      const mockResponse = { data: { id: 'c1', content: '' } };
      mockAxios.post.mockResolvedValueOnce(mockResponse);

      const result = await matterApi.addComment('t1', '');

      expect(mockAxios.post).toHaveBeenCalledWith(
        '/matter/api/v1/matters/t1/timeline',
        { content: undefined, attachments: undefined },
      );
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('deleteMatter', () => {
    it('sends DELETE to /matters/:id', async () => {
      mockAxios.delete.mockResolvedValueOnce({ data: null });

      await matterApi.deleteMatter('t1');

      expect(mockAxios.delete).toHaveBeenCalledWith(
        '/matter/api/v1/matters/t1',
      );
    });
  });

  describe('addAssignee', () => {
    it('sends POST to /matters/:id/assignees', async () => {
      mockAxios.post.mockResolvedValueOnce({ data: null });

      await matterApi.addAssignee('t1', 'u1');

      expect(mockAxios.post).toHaveBeenCalledWith(
        '/matter/api/v1/matters/t1/assignees',
        { user_id: 'u1' },
      );
    });
  });

  describe('linkChannel', () => {
    it('sends POST to /matters/:id/channels', async () => {
      const mockResponse = { data: { id: 'mc1', channel_id: 'ch1' } };
      mockAxios.post.mockResolvedValueOnce(mockResponse);

      const result = await matterApi.linkChannel('t1', { channel_id: 'ch1', channel_type: 2 });

      expect(mockAxios.post).toHaveBeenCalledWith(
        '/matter/api/v1/matters/t1/channels',
        { channel_id: 'ch1', channel_type: 2 },
      );
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('unlinkChannel', () => {
    it('sends DELETE to /matters/:id/channels/:channel_id', async () => {
      mockAxios.delete.mockResolvedValueOnce({ data: null });

      await matterApi.unlinkChannel('t1', 'ch1');

      expect(mockAxios.delete).toHaveBeenCalledWith(
        '/matter/api/v1/matters/t1/channels/ch1',
      );
    });
  });

  describe('listComments', () => {
    it('sends GET to /matters/:id/timeline with pagination', async () => {
      const mockResponse = { data: { data: [{ id: 'c1' }], pagination: { has_more: false } } };
      mockAxios.get.mockResolvedValueOnce(mockResponse);

      const result = await matterApi.listComments('t1', { limit: 20 });

      expect(mockAxios.get).toHaveBeenCalledWith(
        '/matter/api/v1/matters/t1/timeline',
        { params: { limit: '20' } },
      );
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('listOutputs', () => {
    it('sends GET to /matters/:id/outputs with limit/cursor/q params', async () => {
      const mockResponse = {
        data: {
          data: [{ id: 'o1', file_url: 'https://cdn.example/file.pdf' }],
          pagination: { has_more: true, next_cursor: 'next123' },
        },
      };
      mockAxios.get.mockResolvedValueOnce(mockResponse);

      const result = await matterApi.listOutputs('t1', {
        limit: 50,
        cursor: 'abc',
        q: 'report',
      });

      expect(mockAxios.get).toHaveBeenCalledWith(
        '/matter/api/v1/matters/t1/outputs',
        { params: { limit: '50', cursor: 'abc', q: 'report' } },
      );
      expect(result).toEqual(mockResponse.data);
    });

    it('omits undefined params (no q on initial load)', async () => {
      const mockResponse = { data: { data: [], pagination: { has_more: false } } };
      mockAxios.get.mockResolvedValueOnce(mockResponse);

      await matterApi.listOutputs('t1', { limit: 50 });

      expect(mockAxios.get).toHaveBeenCalledWith(
        '/matter/api/v1/matters/t1/outputs',
        { params: { limit: '50' } },
      );
    });

    it('works without params (defaults applied server-side)', async () => {
      const mockResponse = { data: { data: [], pagination: { has_more: false } } };
      mockAxios.get.mockResolvedValueOnce(mockResponse);

      await matterApi.listOutputs('t1');

      expect(mockAxios.get).toHaveBeenCalledWith(
        '/matter/api/v1/matters/t1/outputs',
        { params: {} },
      );
    });
  });

  describe('MatterStatusBadge rendering', () => {
    it('renders correct labels and classNames for all statuses', async () => {
      const { MatterStatusBadge } = await import('../../ui/TodoStatusBadge');

      const openEl = MatterStatusBadge({ status: 'open' });
      expect(openEl.props.children).toBe('待处理');
      expect(openEl.props.className).toContain('wk-matter-status-badge--open');

      const doneEl = MatterStatusBadge({ status: 'done' });
      expect(doneEl.props.children).toBe('已完成');
      expect(doneEl.props.className).toContain('wk-matter-status-badge--done');

      const archivedEl = MatterStatusBadge({ status: 'archived' });
      expect(archivedEl.props.children).toBe('已归档');
      expect(archivedEl.props.className).toContain('wk-matter-status-badge--archived');
    });
  });
});
