import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { Dap } from '@octo/base';
import type { SummaryWorkspaceChatRequestDTO } from '../../bridge/summaryWorkbench/protocol';

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

    describe('summary workspace transport', () => {
        const request: SummaryWorkspaceChatRequestDTO = {
            session_id: 'session-1',
            profile: 'summary_workspace',
            action: 'chat',
            message: '帮我总结风险',
            request_id: 'request-1',
            scope_version: 2,
            summary_context: {
                selected_channels: [],
                participants: [],
                template: null,
                time_range: null,
                referenced_task_ids: [],
            },
        };

        it('posts the structured chat request without changing the legacy endpoint', async () => {
            const { postSummaryWorkspaceTurn } = await import('../summaryApi');
            const data = { contract_version: '1', result_type: 'clarification' };
            mockPost.mockResolvedValueOnce({ data: { code: 0, data } });

            await expect(postSummaryWorkspaceTurn(request)).resolves.toEqual(data);
            expect(mockPost).toHaveBeenCalledWith('/summary/api/v1/agent/chat', request, { signal: undefined, timeout: 120000 });
        });

        it('loads capabilities and History through strict envelopes', async () => {
            const { getSummaryWorkspaceCapabilities, getSummaryWorkspaceHistory } = await import('../summaryApi');
            mockGet
                .mockResolvedValueOnce({
                    data: { code: 0, data: { enabled: true, contract_version: '1' } },
                })
                .mockResolvedValueOnce({
                    data: { code: 0, data: { session_id: 'session/1' } },
                });

            await expect(getSummaryWorkspaceCapabilities()).resolves.toMatchObject({
                enabled: true,
            });
            await expect(getSummaryWorkspaceHistory('session/1')).resolves.toEqual({
                session_id: 'session/1',
            });

            expect(mockGet).toHaveBeenNthCalledWith(1, '/summary/api/v1/summary-workbench/capabilities', { signal: undefined });
            expect(mockGet).toHaveBeenNthCalledWith(2, '/summary/api/v1/agent/chat/history', { params: { session_id: 'session/1' }, signal: undefined });
        });

        it('sends proposal confirmation and preview save with idempotency headers', async () => {
            const { confirmSummaryWorkspaceProposal, saveSummaryWorkspacePreview } = await import('../summaryApi');
            mockPost
                .mockResolvedValueOnce({
                    data: { code: 0, data: { result_type: 'workflow_started' } },
                })
                .mockResolvedValueOnce({
                    data: {
                        code: 0,
                        data: { task_id: 89, task_no: 'SUM-89', status: 3, created_at: '2026-08-26T10:00:00Z' },
                    },
                });

            await confirmSummaryWorkspaceProposal(
                {
                    session_id: 'session/1',
                    proposal_version: 3,
                    proposal_token: 'proposal-token',
                    scope_version: 2,
                    summary_context: request.summary_context,
                },
                { idempotencyKey: 'confirm-key' },
            );
            await saveSummaryWorkspacePreview(
                {
                    session_id: 'session/1',
                    agent_message_id: 18,
                    snapshot_version: 7,
                    scope_version: 2,
                    expected_artifact_version: 3,
                },
                { idempotencyKey: 'save-key' },
            );

            expect(mockPost).toHaveBeenNthCalledWith(
                1,
                '/summary/api/v1/agent/summary-sessions/session%2F1/proposals/3/confirm',
                {
                    proposal_token: 'proposal-token',
                    scope_version: 2,
                    summary_context: request.summary_context,
                },
                { headers: { 'Idempotency-Key': 'confirm-key' }, signal: undefined },
            );
            expect(mockPost).toHaveBeenNthCalledWith(
                2,
                '/summary/api/v1/summaries/agent',
                {
                    session_id: 'session/1',
                    agent_message_id: 18,
                    snapshot_version: 7,
                    scope_version: 2,
                    expected_artifact_version: 3,
                },
                { headers: { 'Idempotency-Key': 'save-key' }, signal: undefined },
            );
        });

        it('preserves business errors instead of flattening their code', async () => {
            const { postSummaryWorkspaceTurn } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({
                data: {
                    code: 40901,
                    message: 'scope stale',
                    detail: 'reload',
                    data: null,
                },
            });

            const error = await postSummaryWorkspaceTurn(request).catch((caught) => caught);
            expect(error).toMatchObject({
                name: 'SummaryWorkspaceApiError',
                kind: 'business',
                code: 40901,
                detail: 'reload',
                retryable: false,
            });
        });

        it('preserves HTTP 409 business recovery metadata', async () => {
            const { postSummaryWorkspaceTurn } = await import('../summaryApi');
            mockPost.mockRejectedValueOnce(
                Object.assign(new Error('conflict'), {
                    response: {
                        status: 409,
                        data: {
                            code: 40009,
                            message: 'idempotency key conflict',
                            data: {
                                task_id: 89,
                                recovery_action: 'open_existing_summary',
                            },
                        },
                    },
                }),
            );

            await expect(postSummaryWorkspaceTurn(request)).rejects.toMatchObject({
                kind: 'business',
                code: 40009,
                httpStatus: 409,
                taskId: 89,
                recoveryAction: 'open_existing_summary',
                retryable: false,
            });
        });

        it('recognizes nested structured business errors', async () => {
            const { postSummaryWorkspaceTurn } = await import('../summaryApi');
            mockPost.mockRejectedValueOnce(
                Object.assign(new Error('unprocessable'), {
                    response: {
                        status: 422,
                        data: {
                            error: {
                                code: 42200,
                                message: 'summary validation failed',
                                http_status: 422,
                                details: 'coverage gap',
                            },
                        },
                    },
                }),
            );

            await expect(postSummaryWorkspaceTurn(request)).rejects.toMatchObject({
                kind: 'business',
                code: 42200,
                httpStatus: 422,
                detail: 'coverage gap',
                retryable: false,
            });
        });

        it('keeps HTTP 500 envelopes retryable transport errors', async () => {
            const { postSummaryWorkspaceTurn } = await import('../summaryApi');
            mockPost.mockRejectedValueOnce(
                Object.assign(new Error('server failed'), {
                    response: {
                        status: 500,
                        data: {
                            code: 50000,
                            message: 'temporary backend failure',
                        },
                    },
                }),
            );

            await expect(postSummaryWorkspaceTurn(request)).rejects.toMatchObject({
                kind: 'transport',
                code: 50000,
                httpStatus: 500,
                retryable: true,
            });
        });

        it('rejects a missing envelope code or data as a protocol error', async () => {
            const { postSummaryWorkspaceTurn } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({ data: { data: {} } }).mockResolvedValueOnce({ data: { code: 0, data: null } });

            await expect(postSummaryWorkspaceTurn(request)).rejects.toMatchObject({
                kind: 'protocol',
            });
            await expect(postSummaryWorkspaceTurn(request)).rejects.toMatchObject({
                kind: 'protocol',
            });
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

        it('passes request_id through on agent save so the backend can bind the Run manifest', async () => {
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const { createAgentSummary } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({ data: { code: 0, data: { task_id: 4, task_no: 'n', status: 1, created_at: 'x' } } });
            await createAgentSummary({ session_id: 's1', title: 't', request_id: 'req-save-1' }, {});
            expect(mockPost).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ session_id: 's1', title: 't', request_id: 'req-save-1' }),
            );
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
    describe('convertSummaryToDoc — 委托给 docs 能力端口 (octo-smart-summary#195)', () => {
        // 回归钉死：packages/docs 已在 #1363 从 OSS host 拆走，本包**不得**再直连
        // docs-backend 的 REST 端点。转文档必须整段走 @octo/base 的 docs 端口，
        // 建文档 / 导入 markdown / 失败回滚全部是实现方职责。
        it('把 title + markdown 原样交给端口，并回传端口给的 docId/url', async () => {
            const base = await import('@octo/base');
            const spy = vi
                .spyOn(base, 'convertMarkdownToDoc')
                .mockResolvedValueOnce({ docId: 'doc-9', url: '/d/doc-9' });

            const { convertSummaryToDoc } = await import('../summaryApi');
            const result = await convertSummaryToDoc('周报', '# 本周进展');

            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy).toHaveBeenCalledWith({ title: '周报', markdown: '# 本周进展' });
            expect(result).toEqual({ docId: 'doc-9', url: '/d/doc-9' });
            spy.mockRestore();
        });

        it('不发起任何 docs REST 请求（不 post /docs、不 delete /docs/:id）', async () => {
            const base = await import('@octo/base');
            const spy = vi
                .spyOn(base, 'convertMarkdownToDoc')
                .mockResolvedValueOnce({ docId: 'doc-9', url: '/d/doc-9' });

            mockPost.mockClear();
            mockDelete.mockClear();
            const { convertSummaryToDoc } = await import('../summaryApi');
            await convertSummaryToDoc('t', 'body');

            expect(mockPost).not.toHaveBeenCalled();
            expect(mockDelete).not.toHaveBeenCalled();
            spy.mockRestore();
        });

        it('端口失败时错误原样抛出，本层不做回滚补偿', async () => {
            const base = await import('@octo/base');
            const boom = new Error('import failed');
            const spy = vi.spyOn(base, 'convertMarkdownToDoc').mockRejectedValueOnce(boom);

            mockDelete.mockClear();
            const { convertSummaryToDoc } = await import('../summaryApi');
            await expect(convertSummaryToDoc('t', 'body')).rejects.toBe(boom);
            // 回滚（删孤儿文档）属于实现方职责 —— 只有它知道哪些错误是确定性 HTTP 拒绝、
            // 哪些只是超时（超时不代表服务端没落盘，贸然删除会丢用户内容）。
            expect(mockDelete).not.toHaveBeenCalled();
            spy.mockRestore();
        });
    });
});
