import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

const { mockGet, mockPost, mockPut, mockDelete, mockRequestUse, mockResponseUse } = vi.hoisted(() => ({
    mockGet: vi.fn(),
    mockPost: vi.fn(),
    mockPut: vi.fn(),
    mockDelete: vi.fn(),
    mockRequestUse: vi.fn(),
    mockResponseUse: vi.fn(),
}));

vi.mock('axios', () => ({
    default: {
        create: () => ({
            get: mockGet,
            post: mockPost,
            put: mockPut,
            delete: mockDelete,
            interceptors: {
                request: { use: mockRequestUse },
                response: { use: mockResponseUse },
            },
        }),
        isCancel: (err: unknown) => !!(err as { __CANCEL__?: boolean })?.__CANCEL__,
    },
}));

import {
    createCustomTopicTemplate,
    deleteCustomTopicTemplate,
    getTopicTemplates,
    getTopicTemplatesConfig,
    getTemplates,
    listSummaries,
    removeMember,
    updateCustomTopicTemplate,
} from '../summaryApi';

describe('summaryApi interceptors', () => {
  it('injects language, token, and space headers', async () => {
    vi.resetModules();
    mockRequestUse.mockClear();

    await import('../summaryApi');

    const requestInterceptor = mockRequestUse.mock.calls[0]?.[0];
    const result = requestInterceptor({ headers: {} } as any);

    expect(result.headers['Accept-Language']).toBe('zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7');
    expect(result.headers['token']).toBe('test-token-abc');
    expect(result.headers['X-Space-Id']).toBe('space-123');
  });
});

// The summary service lives at <origin>/summary/api/v1. On Web, apiClient.apiURL
// is relative ("/api/v1/") so same-origin requests work with an empty baseURL.
// In the extension/Electron the page origin is chrome-extension:// / app://, so
// the request must target the API origin derived from apiClient.config.apiURL.
// GH #420 — sidepanel forward menu could not search channels/subzones.
describe('summaryApi baseURL resolution (GH #420)', () => {
  async function getRequestInterceptor(apiClient: unknown) {
    vi.resetModules();
    mockRequestUse.mockClear();
    // Mutate the WKApp instance from the post-reset module graph — the same one
    // summaryApi will import — so the interceptor reads this apiClient at call time.
    const { default: freshWKApp } = await import('@octo/base');
    (freshWKApp as any).apiClient = apiClient;
    await import('../summaryApi');
    return mockRequestUse.mock.calls[0]?.[0];
  }

  it('uses the API origin when apiClient.apiURL is absolute (extension/Electron)', async () => {
    const interceptor = await getRequestInterceptor({ config: { apiURL: 'https://api.example.com/api/v1/' } });

    const result = interceptor({ headers: {} } as any);

    expect(result.baseURL).toBe('https://api.example.com');
  });

  it('stays same-origin (empty baseURL) when apiClient.apiURL is relative (Web)', async () => {
    const interceptor = await getRequestInterceptor({ config: { apiURL: '/api/v1/' } });

    const result = interceptor({ headers: {} } as any);

    expect(result.baseURL).toBe('');
  });

  it('stays same-origin when apiClient.config is absent', async () => {
    const interceptor = await getRequestInterceptor({});

    const result = interceptor({ headers: {} } as any);

    expect(result.baseURL).toBe('');
  });
});

describe('summaryApi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getTopicTemplates', () => {
        it('unwraps {templates: [...]} correctly', async () => {
            const templates = [
                { id: 'project_progress', label: '汇总项目进展', icon: 'FileText', description: 'desc', type: 'parameterized', pattern: '总结 {project_name} 的项目进展', placeholders: [{ key: 'project_name', label: '输入项目名称', position: [3, 9] }] },
                { id: 'weekly_report', label: '总结团队周报', icon: 'Calendar', description: 'desc2', type: 'fixed', pattern: '总结每周的工作周报' },
            ];
            mockGet.mockResolvedValue({ data: { data: { templates } } });

            const result = await getTopicTemplates();
            const config = await getTopicTemplatesConfig();

            expect(result).toEqual(templates);
            expect(config).toEqual({ templates, custom_template_limit: 30 });
        });

        it('returns empty array when templates is missing', async () => {
            mockGet.mockResolvedValue({ data: { data: {} } });

            const result = await getTopicTemplates();

            expect(result).toEqual([]);
        });

        it('returns empty array when data is null', async () => {
            mockGet.mockResolvedValue({ data: { data: null } });

            const result = await getTopicTemplates();

            expect(result).toEqual([]);
        });

        it('reads custom_template_limit when present', async () => {
            const templates = [
                { id: 'custom_a', label: 'A', icon: 'FileText', description: '', type: 'fixed', pattern: 'x', is_custom: true },
            ];
            mockGet.mockResolvedValue({ data: { data: { templates, custom_template_limit: 50 } } });

            const result = await getTopicTemplatesConfig();

            expect(result).toEqual({ templates, custom_template_limit: 50 });
        });


        it('preserves custom_template_limit 0 when returned by backend', async () => {
            mockGet.mockResolvedValue({ data: { data: { templates: [], custom_template_limit: 0 } } });

            const result = await getTopicTemplatesConfig();

            expect(result).toEqual({ templates: [], custom_template_limit: 0 });
        });
    });

    describe('getTemplates', () => {
        it('maps TopicTemplate fields to SummaryTemplate format', async () => {
            const templates = [
                { id: 'project_progress', label: '汇总项目进展', icon: 'FileText', description: '与团队一起总结', type: 'parameterized', pattern: '总结 {project_name} 的项目进展' },
                { id: 'weekly_report', label: '总结团队周报', icon: 'Calendar', description: '总结每周工作', type: 'fixed', pattern: '总结每周的工作周报' },
            ];
            mockGet.mockResolvedValue({ data: { data: { templates } } });

            const result = await getTemplates();

            expect(result).toEqual([
                { template_id: 'project_progress', name: '汇总项目进展', description: '与团队一起总结', default_mode: 1, default_time_range_type: 1 },
                { template_id: 'weekly_report', name: '总结团队周报', description: '总结每周工作', default_mode: 1, default_time_range_type: 1 },
            ]);
        });

        it('returns empty array when templates is missing', async () => {
            mockGet.mockResolvedValue({ data: { data: {} } });

            const result = await getTemplates();

            expect(result).toEqual([]);
        });
    });

    describe('custom topic templates', () => {
        it('creates a custom template', async () => {
            const template = {
                id: 'custom_1',
                label: '风险复盘',
                icon: 'FileText',
                description: '按风险整理',
                type: 'fixed',
                pattern: '按风险点总结',
                is_custom: true,
            };
            mockPost.mockResolvedValueOnce({ data: { data: { template } } });

            const result = await createCustomTopicTemplate({
                label: '风险复盘',
                description: '按风险整理',
            });

            expect(mockPost).toHaveBeenCalledWith('/summary/api/v1/summary-templates/my', {
                label: '风险复盘',
                description: '按风险整理',
            });
            expect(result).toEqual(template);
        });

        it('updates and deletes a custom template with encoded id', async () => {
            const template = {
                id: 'custom_a/b',
                label: '风险复盘',
                icon: 'FileText',
                description: '',
                type: 'fixed',
                pattern: '按风险点总结',
                is_custom: true,
            };
            mockPut.mockResolvedValueOnce({ data: { data: { template } } });
            mockDelete.mockResolvedValueOnce({ data: { data: {} } });

            const result = await updateCustomTopicTemplate('custom_a/b', {
                label: '风险复盘',
                description: '按风险点总结',
            });
            await deleteCustomTopicTemplate('custom_a/b');

            expect(mockPut).toHaveBeenCalledWith('/summary/api/v1/summary-templates/my/custom_a%2Fb', {
                label: '风险复盘',
                description: '按风险点总结',
            });
            expect(mockDelete).toHaveBeenCalledWith('/summary/api/v1/summary-templates/my/custom_a%2Fb');
            expect(result).toEqual(template);
        });
    });

    describe('extractErrorMessage', () => {
        it('reads response.data.message from backend envelope', async () => {
            mockGet.mockRejectedValue({
                response: { data: { message: 'Insufficient permissions' } },
            });

            await expect(getTopicTemplates()).rejects.toThrow('Insufficient permissions');
        });

        it('falls back to err.message when response.data.message is absent', async () => {
            mockGet.mockRejectedValue(new Error('Network Error'));

            await expect(getTopicTemplates()).rejects.toThrow('Network Error');
        });

        it('falls back to "Request failed" for non-Error rejections', async () => {
            mockGet.mockRejectedValue('string error');

            await expect(getTopicTemplates()).rejects.toThrow('Request failed');
        });

        it('truncates long error messages to 200 chars', async () => {
            const longMsg = 'x'.repeat(300);
            mockGet.mockRejectedValue({
                response: { data: { message: longMsg } },
            });

            try {
                await getTopicTemplates();
            } catch (err: any) {
                expect(err.message).toHaveLength(201);
                expect(err.message.endsWith('…')).toBe(true);
            }
        });
    });

    describe('cancellation', () => {
        it('rethrows the original cancel error so axios.isCancel still detects it', async () => {
            const cancelErr = { __CANCEL__: true, message: 'canceled' };
            mockGet.mockRejectedValue(cancelErr);

            await expect(
                listSummaries({ origin_channel_id: 'ch1', page: 1, page_size: 1 }),
            ).rejects.toBe(cancelErr);

            // The thrown value preserves cancellation identity (not wrapped in a new Error).
            try {
                await listSummaries({ origin_channel_id: 'ch1', page: 1, page_size: 1 });
            } catch (err) {
                expect(axios.isCancel(err)).toBe(true);
            }
        });

        it('still wraps non-cancel errors in a plain Error', async () => {
            mockGet.mockRejectedValue(new Error('Network Error'));

            await expect(
                listSummaries({ origin_channel_id: 'ch1', page: 1, page_size: 1 }),
            ).rejects.toThrow('Network Error');
        });
    });

    // 后端 is_active 返回 number(0/1)，前端多处用 `=== false` / `!== false` 严格判断。
    // 如果不归一，`0 === false` 为 false，会导致关闭后刷新仍被当作「定时生效」。
    describe('is_active normalization (number -> boolean)', () => {
        it('getSchedule maps numeric 0 to false and 1 to true', async () => {
            const { getSchedule } = await import('../summaryApi');

            mockGet.mockResolvedValueOnce({ data: { schedule_id: 1, is_active: 0 } });
            const off = await getSchedule(1);
            expect(off.is_active).toBe(false);

            mockGet.mockResolvedValueOnce({ data: { schedule_id: 2, is_active: 1 } });
            const on = await getSchedule(2);
            expect(on.is_active).toBe(true);
        });

        it('listSchedules normalizes every item', async () => {
            const { listSchedules } = await import('../summaryApi');
            mockGet.mockResolvedValueOnce({ data: [
                { schedule_id: 1, is_active: 0 },
                { schedule_id: 2, is_active: 1 },
            ] });
            const items = await listSchedules();
            expect(items.map((i) => i.is_active)).toEqual([false, true]);
        });
    });

    // V5：schedule 级一次性确认。POST /summary-schedules/:id/confirm，无 body。
    describe('confirmSchedule (V5 one-time schedule confirm)', () => {
        it('POSTs to /summary-schedules/:id/confirm', async () => {
            const { confirmSchedule } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({ data: { data: { confirmed: true } } });
            await confirmSchedule(42);
            expect(mockPost).toHaveBeenCalledWith(
                '/summary/api/v1/summary-schedules/42/confirm',
                undefined,
            );
        });
    });

    // FIX4: removeMember 将 uid 作为 query 参数传递并 encodeURIComponent，
    // 避免含特殊字符的 user_id（如 'a/b'、'u 1'）破坏 path 或路由。
    describe('removeMember uid encoding', () => {
        it('encodes uid into the DELETE query string', async () => {
            mockDelete.mockResolvedValueOnce({ data: { data: { removed: true } } });
            await removeMember(7, 'a/b c');
            expect(mockDelete).toHaveBeenCalledWith(
                '/summary/api/v1/summaries/7/members?uid=a%2Fb%20c',
            );
        });
    });

    // Agent 交互式问答：POST /agent/chat。agentChat 自行校验 envelope code。
    describe('agentChat (interactive Q&A)', () => {
        it('POSTs {message, session_id} to /agent/chat and unwraps {reply, session_id}', async () => {
            const { agentChat } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({
                data: { code: 0, data: { reply: '总结如下…', session_id: 's-1' } },
            });
            const res = await agentChat({ message: '总结今天', session_id: 's-1' });
            expect(mockPost).toHaveBeenCalledWith(
                '/summary/api/v1/agent/chat',
                { message: '总结今天', session_id: 's-1' },
                // agent 单次问答放宽到 120s（见 summaryApi.agentChat）。
                { timeout: 120000 },
            );
            expect(res).toEqual({ reply: '总结如下…', session_id: 's-1' });
        });

        it('throws on non-zero envelope code (no silent success)', async () => {
            const { agentChat } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({
                data: { code: 1, message: 'x', data: null },
            });
            await expect(
                agentChat({ message: '总结今天', session_id: 's-1' }),
            ).rejects.toThrow('x');
        });
    });
});
