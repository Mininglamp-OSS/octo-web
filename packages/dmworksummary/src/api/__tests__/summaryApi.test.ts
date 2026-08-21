import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { Dap } from '@octo/base';

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
    createSummaryShares,
    createCustomTopicTemplate,
    deleteCustomTopicTemplate,
    getSummaryShare,
    getTopicTemplates,
    getTopicTemplatesConfig,
    getTemplates,
    listSummaries,
    removeMember,
    revokeSummaryShare,
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

  it('preserves an explicit target Space header', async () => {
    vi.resetModules();
    mockRequestUse.mockClear();

    await import('../summaryApi');

    const requestInterceptor = mockRequestUse.mock.calls[0]?.[0];
    const result = requestInterceptor({
      headers: { 'X-Space-Id': 'space-target' },
    } as any);

    expect(result.headers['X-Space-Id']).toBe('space-target');
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

    describe('summary shares', () => {
        it('creates per-target grants with the idempotency key', async () => {
            const response = { snapshot: { id: 1 }, grants: [{ share_id: 'share-1' }] };
            mockPost.mockResolvedValue({ data: { data: response } });

            await expect(createSummaryShares('ST/42', 'request-123', [
                { channel_id: 'group-1', channel_type: 2 },
            ])).resolves.toEqual(response);

            expect(mockPost).toHaveBeenCalledWith('/summary/api/v1/summaries/ST%2F42/shares', {
                idempotency_key: 'request-123',
                targets: [{ channel_id: 'group-1', channel_type: 2 }],
            });
        });

        it('loads and revokes a share by encoded id', async () => {
            const response = { share_id: 'share/1', source_accessible: true, snapshot: { id: 1 } };
            mockGet.mockResolvedValue({ data: { data: response } });
            mockDelete.mockResolvedValue({ data: { data: { revoked: true } } });

            await expect(getSummaryShare('share/1')).resolves.toEqual(response);
            await expect(revokeSummaryShare('share/1')).resolves.toBeUndefined();

            expect(mockGet).toHaveBeenCalledWith('/summary/api/v1/summary-shares/share%2F1', { params: undefined, signal: undefined });
            expect(mockDelete).toHaveBeenCalledWith('/summary/api/v1/summary-shares/share%2F1');
        });

        it('loads a cross-Space share with an explicit Space header', async () => {
            const response = { share_id: 'share-2', source_accessible: true, snapshot: { id: 2 } };
            mockGet.mockResolvedValue({ data: { data: response } });

            await expect(getSummaryShare('share-2', 'space-b')).resolves.toEqual(response);

            expect(mockGet).toHaveBeenCalledWith('/summary/api/v1/summary-shares/share-2', {
                params: undefined,
                headers: { 'X-Space-Id': 'space-b' },
            });
        });
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

    describe('batchStatus strict envelope', () => {
        it('returns an empty task list only from a code 0 envelope', async () => {
            const { batchStatus } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({
                status: 200,
                data: { code: 0, data: { tasks: [] } },
            });

            await expect(batchStatus([1, 2])).resolves.toEqual([]);
            expect(mockPost).toHaveBeenCalledWith('/summary/api/v1/summaries/batch-status', {
                task_ids: [1, 2],
            });
        });

        it('rejects HTTP 200 with a non-zero business code', async () => {
            const { batchStatus } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({
                status: 200,
                data: { code: 40009, message: 'batch status unavailable', data: null },
            });

            await expect(batchStatus([1])).rejects.toThrow('batch status unavailable');
        });

        it.each([
            { code: 0, data: null },
            { code: 0, data: {} },
            { code: 0, data: { tasks: null } },
            { data: { tasks: [] } },
        ])('rejects a malformed success envelope: %j', async (data) => {
            const { batchStatus } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({ status: 200, data });

            await expect(batchStatus([1])).rejects.toThrow();
        });

        it('keeps friendly HTTP errors and cancellation identity', async () => {
            const { batchStatus } = await import('../summaryApi');
            mockPost.mockRejectedValueOnce({
                response: { status: 503, data: { message: 'status service unavailable' } },
            });
            await expect(batchStatus([1])).rejects.toThrow('status service unavailable');

            const cancelErr = { __CANCEL__: true, message: 'canceled' };
            mockPost.mockRejectedValueOnce(cancelErr);
            await expect(batchStatus([1])).rejects.toBe(cancelErr);
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

        it('surfaces run_id + passes request_id through (SS-11 v2 contract)', async () => {
            const { agentChat } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({
                data: { code: 0, data: { reply: 'r', session_id: 's-1', run_id: 'run-xyz' } },
            });
            const res = await agentChat({ message: 'q', session_id: 's-1', request_id: 'req-9' });
            // request_id flows through in the posted body (idempotency key).
            expect(mockPost).toHaveBeenCalledWith(
                '/summary/api/v1/agent/chat',
                { message: 'q', session_id: 's-1', request_id: 'req-9' },
                { timeout: 120000 },
            );
            expect(res).toEqual({ reply: 'r', session_id: 's-1', run_id: 'run-xyz' });
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

    describe('agent finalize save path', () => {
        it('posts to finalize with Idempotency-Key and accepts only 202 + GENERATING', async () => {
            const { finalizeAgentSummary } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({
                status: 202,
                data: { code: 0, data: { task_id: 88, status: 'GENERATING' } },
            });

            const res = await finalizeAgentSummary({ session_id: 's1', title: 't' }, 'finalize_test_key');

            expect(mockPost).toHaveBeenCalledWith(
                '/summary/api/v1/summaries/agent/finalize',
                { session_id: 's1', title: 't' },
                { headers: { 'Idempotency-Key': 'finalize_test_key' } },
            );
            expect(res).toEqual({ task_id: 88, status: 'GENERATING' });
        });

        it('lets callers provide a stable Idempotency-Key for retryable finalize saves', async () => {
            const { saveAgentSummaryViaFinalize } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({
                status: 202,
                data: { code: 0, data: { task_id: 91, status: 'GENERATING' } },
            });

            const res = await saveAgentSummaryViaFinalize(
                { session_id: 's1', title: 't' },
                { trigger_mode: 'agent' },
                { idempotencyKey: 'finalize_stable_key' },
            );

            expect(mockPost).toHaveBeenCalledWith(
                '/summary/api/v1/summaries/agent/finalize',
                { session_id: 's1', title: 't' },
                { headers: { 'Idempotency-Key': 'finalize_stable_key' } },
            );
            expect(res).toEqual({ task_id: 91, status: 'GENERATING', async_finalize: true });
        });

        it('rejects unexpected finalize task status', async () => {
            const { finalizeAgentSummary } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({
                status: 202,
                data: { code: 0, data: { task_id: 88, status: 'FAILED' } },
            });

            await expect(finalizeAgentSummary({ session_id: 's1' }, 'finalize_test_key')).rejects.toThrow(
                'finalize returned unexpected task status',
            );
        });

        it('accepts a 200 finalize replay (idempotent retry) as an acceptance', async () => {
            // 幂等重放按惯例返 200 而不是再一次 202，而重放正是本特性的重试路径（R5 P2）。
            const { finalizeAgentSummary } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({
                status: 200,
                data: { code: 0, data: { task_id: 88, status: 'GENERATING' } },
            });

            await expect(finalizeAgentSummary({ session_id: 's1' }, 'finalize_test_key')).resolves.toEqual({
                task_id: 88,
                status: 'GENERATING',
            });
        });

        it('rejects a non-2xx finalize acceptance response', async () => {
            const { finalizeAgentSummary } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({
                status: 302,
                data: { code: 0, data: { task_id: 88, status: 'GENERATING' } },
            });

            await expect(finalizeAgentSummary({ session_id: 's1' }, 'finalize_test_key')).rejects.toThrow(
                'finalize returned unexpected http status',
            );
        });

        it('does not fallback on finalize business failure', async () => {
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const { saveAgentSummaryViaFinalize } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({
                status: 200,
                data: { code: 40004, message: 'no output', data: null },
            });

            await expect(
                saveAgentSummaryViaFinalize(
                    { session_id: 's1' },
                    { trigger_mode: 'agent' },
                    { idempotencyKey: 'finalize_business_key' },
                ),
            ).rejects.toBeTruthy();
            expect(mockPost).toHaveBeenCalledTimes(1);
            expect(track.mock.calls.some((c) => c[0] === 'smart_summary_started')).toBe(false);
            track.mockRestore();
        });

        it('does not fallback on ambiguous network failure', async () => {
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const { saveAgentSummaryViaFinalize } = await import('../summaryApi');
            mockPost.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));

            await expect(
                saveAgentSummaryViaFinalize(
                    { session_id: 's1' },
                    { trigger_mode: 'agent' },
                    { idempotencyKey: 'finalize_network_key' },
                ),
            ).rejects.toThrow('Network Error');
            expect(mockPost).toHaveBeenCalledTimes(1);
            expect(track.mock.calls.some((c) => c[0] === 'smart_summary_started')).toBe(false);
            track.mockRestore();
        });

        it('sends the same Idempotency-Key when the caller retries after an ambiguous failure', async () => {
            const { saveAgentSummaryViaFinalize } = await import('../summaryApi');
            mockPost
                .mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }))
                .mockResolvedValueOnce({
                    status: 202,
                    data: { code: 0, data: { task_id: 92, status: 'GENERATING' } },
                });

            await expect(
                saveAgentSummaryViaFinalize(
                    { session_id: 's1' },
                    { trigger_mode: 'agent' },
                    { idempotencyKey: 'finalize_retry_key' },
                ),
            ).rejects.toThrow('Network Error');
            const res = await saveAgentSummaryViaFinalize(
                { session_id: 's1' },
                { trigger_mode: 'agent' },
                { idempotencyKey: 'finalize_retry_key' },
            );

            expect(res).toEqual({ task_id: 92, status: 'GENERATING', async_finalize: true });
            expect(mockPost.mock.calls[0][2]).toEqual({ headers: { 'Idempotency-Key': 'finalize_retry_key' } });
            expect(mockPost.mock.calls[1][2]).toEqual({ headers: { 'Idempotency-Key': 'finalize_retry_key' } });
        });

        it('falls back to legacy createAgentSummary when finalize route is unsupported', async () => {
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const { saveAgentSummaryViaFinalize } = await import('../summaryApi');
            mockPost
                .mockRejectedValueOnce(Object.assign(new Error('not found'), { response: { status: 404, data: { code: 404 } } }))
                .mockResolvedValueOnce({
                    data: { code: 0, data: { task_id: 89, task_no: 'n', status: 3, created_at: 'x' } },
                });

            const res = await saveAgentSummaryViaFinalize(
                { session_id: 's1' },
                { trigger_mode: 'agent' },
                { idempotencyKey: 'finalize_fallback_key' },
            );

            expect(res).toEqual({ task_id: 89, async_finalize: false });
            expect(mockPost.mock.calls[0][0]).toBe('/summary/api/v1/summaries/agent/finalize');
            expect(mockPost.mock.calls[1][0]).toBe('/summary/api/v1/summaries/agent');
            const started = track.mock.calls.filter((c) => c[0] === 'smart_summary_started');
            expect(started).toHaveLength(1);
            track.mockRestore();
        });

        it('emits smart_summary_started once when finalize is accepted', async () => {
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const { saveAgentSummaryViaFinalize } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({
                status: 202,
                data: { code: 0, data: { task_id: 90, status: 'GENERATING' } },
            });

            const res = await saveAgentSummaryViaFinalize(
                { session_id: 's1' },
                { trigger_mode: 'agent' },
                { idempotencyKey: 'finalize_track_key' },
            );

            expect(res).toEqual({ task_id: 90, status: 'GENERATING', async_finalize: true });
            const started = track.mock.calls.filter((c) => c[0] === 'smart_summary_started');
            expect(started).toHaveLength(1);
            expect(started[0][1]).toMatchObject({ trigger_mode: 'agent' });
            track.mockRestore();
        });

        it('tracks one started event for the same key across 202 acceptance and 200 replay', async () => {
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const { saveAgentSummaryViaFinalize } = await import('../summaryApi');
            mockPost
                .mockResolvedValueOnce({
                    status: 202,
                    data: { code: 0, data: { task_id: 95, status: 'GENERATING' } },
                })
                .mockResolvedValueOnce({
                    status: 200,
                    data: { code: 0, data: { task_id: 95, status: 'GENERATING' } },
                });

            const options = { idempotencyKey: 'finalize_track_replay_key' };
            await saveAgentSummaryViaFinalize({ session_id: 's1' }, { trigger_mode: 'agent' }, options);
            await saveAgentSummaryViaFinalize({ session_id: 's1' }, { trigger_mode: 'agent' }, options);

            const started = track.mock.calls.filter((c) => c[0] === 'smart_summary_started');
            expect(started).toHaveLength(1);
            track.mockRestore();
        });

        it('tracks one started event for each different finalize key', async () => {
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const { saveAgentSummaryViaFinalize } = await import('../summaryApi');
            mockPost
                .mockResolvedValueOnce({
                    status: 202,
                    data: { code: 0, data: { task_id: 96, status: 'GENERATING' } },
                })
                .mockResolvedValueOnce({
                    status: 202,
                    data: { code: 0, data: { task_id: 97, status: 'GENERATING' } },
                });

            await saveAgentSummaryViaFinalize(
                { session_id: 's1' },
                { trigger_mode: 'agent' },
                { idempotencyKey: 'finalize_track_distinct_a' },
            );
            await saveAgentSummaryViaFinalize(
                { session_id: 's1' },
                { trigger_mode: 'agent' },
                { idempotencyKey: 'finalize_track_distinct_b' },
            );

            const started = track.mock.calls.filter((c) => c[0] === 'smart_summary_started');
            expect(started).toHaveLength(2);
            track.mockRestore();
        });

        it('does not reserve the finalize key until the request is accepted', async () => {
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const { saveAgentSummaryViaFinalize } = await import('../summaryApi');
            mockPost
                .mockResolvedValueOnce({
                    status: 200,
                    data: { code: 40004, message: 'no output', data: null },
                })
                .mockResolvedValueOnce({
                    status: 202,
                    data: { code: 0, data: { task_id: 98, status: 'GENERATING' } },
                });
            const options = { idempotencyKey: 'finalize_track_after_failure' };

            await expect(
                saveAgentSummaryViaFinalize({ session_id: 's1' }, { trigger_mode: 'agent' }, options),
            ).rejects.toThrow('no output');
            await expect(
                saveAgentSummaryViaFinalize({ session_id: 's1' }, { trigger_mode: 'agent' }, options),
            ).resolves.toMatchObject({ task_id: 98, async_finalize: true });

            const started = track.mock.calls.filter((c) => c[0] === 'smart_summary_started');
            expect(started).toHaveLength(1);
            track.mockRestore();
        });

        it.each([405, 501])('falls back to legacy when finalize answers %i', async (status) => {
            const { saveAgentSummaryViaFinalize } = await import('../summaryApi');
            mockPost
                .mockRejectedValueOnce(Object.assign(new Error('unsupported'), { response: { status } }))
                .mockResolvedValueOnce({
                    data: { code: 0, data: { task_id: 93, task_no: 'n', status: 3, created_at: 'x' } },
                });

            const res = await saveAgentSummaryViaFinalize(
                { session_id: 's1' },
                { trigger_mode: 'agent' },
                { idempotencyKey: `finalize_fallback_${status}` },
            );

            expect(res).toEqual({ task_id: 93, async_finalize: false });
            expect(mockPost.mock.calls[1][0]).toBe('/summary/api/v1/summaries/agent');
        });

        it('does not fall back when a 404 carries a business envelope', async () => {
            // 后端若用 HTTP 404 表达 40009，改发 legacy 会绕过调用点的 40009 处理（R5 P2）。
            const { saveAgentSummaryViaFinalize } = await import('../summaryApi');
            mockPost.mockRejectedValueOnce(Object.assign(new Error('gone'), {
                response: { status: 404, data: { code: 40009, data: { task_id: 77 } } },
            }));

            await expect(
                saveAgentSummaryViaFinalize(
                    { session_id: 's1' },
                    { trigger_mode: 'agent' },
                    { idempotencyKey: 'finalize_404_business' },
                ),
            ).rejects.toMatchObject({ response: { data: { code: 40009 } } });
            expect(mockPost).toHaveBeenCalledTimes(1);
        });

        it('falls back when a gateway wraps the unrouted path as 200 + code 404', async () => {
            // 反方向：HTTP 不是 404 但 envelope 是 → 仍应回退，否则保存彻底砌掉（R5 P2）。
            const { saveAgentSummaryViaFinalize } = await import('../summaryApi');
            mockPost
                .mockResolvedValueOnce({ status: 200, data: { code: 404, message: 'no route', data: null } })
                .mockResolvedValueOnce({
                    data: { code: 0, data: { task_id: 94, task_no: 'n', status: 3, created_at: 'x' } },
                });

            const res = await saveAgentSummaryViaFinalize(
                { session_id: 's1' },
                { trigger_mode: 'agent' },
                { idempotencyKey: 'finalize_gateway_404' },
            );

            expect(res).toEqual({ task_id: 94, async_finalize: false });
            expect(mockPost.mock.calls[1][0]).toBe('/summary/api/v1/summaries/agent');
        });
    });

    // 二审 P1「smart_summary_started 双发」+ P2-2 + P2-5:该事件唯一收口在 api 层的 envelope gate。
    // 钉死:code===0 才发一次并带调用方 props;code≠0 / code===null 不发;agent 模式补发且业务失败不发。
    // (页面/入口层已删直接 track,发射不再可能双计 —— 见 SummaryCreatePage.test。)
    describe('smart_summary_started envelope gate (二审 P1/P2-2/P2-5)', () => {
        // NB: 前面 describe 里跑过 vi.resetModules(),模块注册表已换新;必须从**当前**注册表取 Dap
        // (与被测 summaryApi 同一份 @octo/base 实例),否则 spy 挂在旧单例上,track 抓不到(见 line 84 同款)。
        it('emits once with the caller props when envelope code===0', async () => {
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const { createSummary } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({ data: { code: 0, data: { task_id: 9 } } });
            await createSummary({ topic: 't' } as any, { trigger_mode: 'normal', source: 'summary_home' });
            const started = track.mock.calls.filter((c) => c[0] === 'smart_summary_started');
            expect(started).toHaveLength(1);
            expect(started[0][1]).toMatchObject({ trigger_mode: 'normal', source: 'summary_home' });
            track.mockRestore();
        });

        it('does NOT emit when envelope code!==0 (HTTP200 + 逻辑失败)', async () => {
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const { createSummary } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({ data: { code: 1, message: 'fail', data: null } });
            await createSummary({ topic: 't' } as any, { trigger_mode: 'normal' });
            expect(track.mock.calls.some((c) => c[0] === 'smart_summary_started')).toBe(false);
            track.mockRestore();
        });

        it('does NOT emit when envelope code===null (空/网关信封,P2-5)', async () => {
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const { createSummary } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({ data: { code: null, data: null } });
            await createSummary({ topic: 't' } as any, {});
            expect(track.mock.calls.some((c) => c[0] === 'smart_summary_started')).toBe(false);
            track.mockRestore();
        });

        it('does NOT emit when envelope code 缺省(网关 HTML/{data:null},与 null 同失败签名,六审 P2)', async () => {
            // summary 端点响应恒为 {code,message,data} 信封。缺 code 不是「后端没包信封」,而是这次响应
            // 根本不是预期信封(200 的网关错误页 / 代理 HTML / {data:null})——与 code===null 同一失败签名,
            // 不能计成动作成功。二审只堵了 null,漏了 undefined;此处钉死缺省也不发。
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const { createSummary } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({ data: { data: null } });
            await createSummary({ topic: 't' } as any, {});
            expect(track.mock.calls.some((c) => c[0] === 'smart_summary_started')).toBe(false);
            track.mockRestore();
        });

        it('agent mode emits once after envelope success (P2-2)', async () => {
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const { createAgentSummary } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({ data: { code: 0, data: { task_id: 3, task_no: 'n', status: 1, created_at: 'x' } } });
            await createAgentSummary({} as any, { trigger_mode: 'agent' });
            const started = track.mock.calls.filter((c) => c[0] === 'smart_summary_started');
            expect(started).toHaveLength(1);
            expect(started[0][1]).toMatchObject({ trigger_mode: 'agent' });
            track.mockRestore();
        });

        it('returns finish_status + gaps when the v2 backend provides them (SS-11)', async () => {
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const { createAgentSummary } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({
                data: {
                    code: 0,
                    data: {
                        task_id: 5, task_no: 'n5', status: 1, created_at: 'x',
                        finish_status: 'PARTIAL',
                        gaps: [{ kind: 'coverage', detail: '频道 X 未覆盖', error_code: 'COV_MISS' }],
                    },
                },
            });
            const res = await createAgentSummary({} as any, {});
            expect(res.task_id).toBe(5);
            expect(res.finish_status).toBe('PARTIAL');
            expect(res.gaps).toEqual([{ kind: 'coverage', detail: '频道 X 未覆盖', error_code: 'COV_MISS' }]);
            track.mockRestore();
        });

        it('omits finish_status/gaps for a legacy backend (SS-11 back-compat)', async () => {
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const { createAgentSummary } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({ data: { code: 0, data: { task_id: 6, task_no: 'n6', status: 1, created_at: 'x' } } });
            const res = await createAgentSummary({} as any, {});
            expect(res.task_id).toBe(6);
            expect(res.finish_status).toBeUndefined();
            expect(res.gaps).toBeUndefined();
            track.mockRestore();
        });

        it('propagates 422/42200 FAILED with the code accessible (SS-07b/SS-11)', async () => {
            const { createAgentSummary } = await import('../summaryApi');
            // A FAILED verdict is HTTP 422 → axios rejects; the caller keeps the chat
            // open and must be able to read err.response.data.code === 42200.
            const axiosErr = Object.assign(new Error('failed'), {
                response: { status: 422, data: { code: 42200, message: '总结未通过完成校验（FAILED），未保存' } },
            });
            mockPost.mockRejectedValueOnce(axiosErr);
            await expect(createAgentSummary({} as any, {})).rejects.toMatchObject({
                response: { data: { code: 42200 } },
            });
        });

        it('agent mode does NOT emit on business failure (code!==0)', async () => {
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const { createAgentSummary } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({ data: { code: 40004, message: 'no output', data: null } });
            await expect(createAgentSummary({} as any, {})).rejects.toBeTruthy();
            expect(track.mock.calls.some((c) => c[0] === 'smart_summary_started')).toBe(false);
            track.mockRestore();
        });

        it('agent mode 缺 code 视为失败,不发也抛错(七审 P1:与 normal 路径同口径)', async () => {
            // 一个带合法 task_id 但缺 envelope code 的响应:normal 路径已收紧到仅 code===0 才发,
            // agent 路径此前放行 undefined 会误发且误清 chat。此处钉死缺 code 即失败,两路径不再漂移。
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const { createAgentSummary } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({ data: { data: { task_id: 7, task_no: 'n', status: 1, created_at: 'x' } } });
            await expect(createAgentSummary({} as any, { trigger_mode: 'agent' })).rejects.toBeTruthy();
            expect(track.mock.calls.some((c) => c[0] === 'smart_summary_started')).toBe(false);
            track.mockRestore();
        });
    });
});
