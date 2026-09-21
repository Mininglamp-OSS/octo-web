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
import { SummaryMode } from '../../types/summary';

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

describe('generation configuration analytics', () => {
    it.each([0, 1, null, undefined])('records only an accepted config save (code=%s)', async (code) => {
        const { Dap } = await import('@octo/base');
        const { saveGenerationConfig } = await import('../summaryApi');
        const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
        try {
            mockPut.mockResolvedValueOnce({ data: { code, data: { task_id: 9 } } });
            await saveGenerationConfig(9, { topic: 'private user instruction' });
            expect(track.mock.calls.filter(call => call[0] === 'smart_summary_generation_config_saved')).toHaveLength(code === 0 ? 1 : 0);
            expect(track.mock.calls.some(call => ['smart_summary_timer_configured', 'smart_summary_regenerated'].includes(call[0]))).toBe(false);
            expect(JSON.stringify(track.mock.calls)).not.toContain('private user instruction');
        } finally { track.mockRestore(); }
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
            input_origin: 'user',
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
            const data = { contract_version: '2', result_type: 'clarification' };
            mockPost.mockResolvedValueOnce({ data: { code: 0, data } });

            await expect(postSummaryWorkspaceTurn(request, { spaceId: 'space-a' })).resolves.toEqual(data);
            expect(mockPost).toHaveBeenCalledWith('/summary/api/v1/agent/chat', request, {
                headers: { 'X-Space-Id': 'space-a' },
                signal: undefined,
                timeout: 120000,
            });
        });

        it('loads capabilities and History through strict envelopes', async () => {
            const { getSummaryWorkspaceCapabilities, getSummaryWorkspaceHistory } = await import('../summaryApi');
            mockGet
                .mockResolvedValueOnce({
                    data: {
                        code: 0,
                        data: {
                            enabled: true,
                            contract_version: '3',
                            max_time_range_days: 90,
                            direct_team_workflow: false,
                            document_sources: true,
                        },
                    },
                })
                .mockResolvedValueOnce({
                    data: { code: 0, data: { session_id: 'session/1' } },
                });

            await expect(getSummaryWorkspaceCapabilities({ spaceId: 'space-a' })).resolves.toMatchObject({
                enabled: true,
            });
            await expect(getSummaryWorkspaceHistory('session/1', { spaceId: 'space-a' })).resolves.toEqual({
                session_id: 'session/1',
            });

            expect(mockGet).toHaveBeenNthCalledWith(1, '/summary/api/v1/summary-workbench/capabilities', {
                headers: { 'X-Space-Id': 'space-a' },
                signal: undefined,
            });
            expect(mockGet).toHaveBeenNthCalledWith(2, '/summary/api/v1/agent/chat/history', {
                params: { session_id: 'session/1', profile: 'summary_workspace' },
                headers: { 'X-Space-Id': 'space-a' },
                signal: undefined,
            });
        });

        it('treats a successful History envelope with data:null as an empty session', async () => {
            const { getSummaryWorkspaceHistory } = await import('../summaryApi');
            mockGet.mockResolvedValueOnce({ data: { code: 0, data: null } });

            await expect(getSummaryWorkspaceHistory('empty-session')).resolves.toBeNull();
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
                { idempotencyKey: 'confirm-key', spaceId: 'space-a' },
            );
            await saveSummaryWorkspacePreview(
                {
                    session_id: 'session/1',
                    agent_message_id: 18,
                    snapshot_version: 1,
                    scope_version: 2,
                    expected_artifact_version: 3,
                },
                { idempotencyKey: 'save-key', spaceId: 'space-a' },
            );

            expect(mockPost).toHaveBeenNthCalledWith(
                1,
                '/summary/api/v1/agent/summary-sessions/session%2F1/proposals/3/confirm',
                {
                    proposal_token: 'proposal-token',
                    scope_version: 2,
                    summary_context: request.summary_context,
                },
                {
                    headers: {
                        'Idempotency-Key': 'confirm-key',
                        'X-Space-Id': 'space-a',
                    },
                    signal: undefined,
                },
            );
            expect(mockPost).toHaveBeenNthCalledWith(
                2,
                '/summary/api/v1/summaries/agent',
                {
                    session_id: 'session/1',
                    agent_message_id: 18,
                    snapshot_version: 1,
                    scope_version: 2,
                    expected_artifact_version: 3,
                },
                {
                    headers: {
                        'Idempotency-Key': 'save-key',
                        'X-Space-Id': 'space-a',
                    },
                    signal: undefined,
                },
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

        it('accepts existing_task_id from idempotency conflict metadata', async () => {
            const { postSummaryWorkspaceTurn } = await import('../summaryApi');
            mockPost.mockRejectedValueOnce(
                Object.assign(new Error('conflict'), {
                    response: {
                        status: 409,
                        data: {
                            code: 40009,
                            message: 'idempotency key conflict',
                            data: {
                                existing_task_id: 91,
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
                taskId: 91,
                recoveryAction: 'open_existing_summary',
                retryable: false,
            });
        });

        it('classifies HTTP 40902 as retryable transport like SSE', async () => {
            const { postSummaryWorkspaceTurn } = await import('../summaryApi');
            mockPost.mockRejectedValueOnce(
                Object.assign(new Error('in progress'), {
                    response: {
                        status: 409,
                        data: {
                            code: 40902,
                            message: 'request still in progress',
                        },
                    },
                }),
            );

            await expect(postSummaryWorkspaceTurn(request)).rejects.toMatchObject({
                kind: 'transport',
                code: 40902,
                httpStatus: 409,
                retryable: true,
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

        it('agent mode does NOT emit smart_summary_started even after envelope success (DAP-247/S6)', async () => {
            // architect 裁定（spec-props.md:333 P0）：smart_summary_started 只对应 normal「快速总结」
            // 路径;createAgentSummary 是 agent 专用端点,成功后不发 started（agent 的记录事件是
            // smart_summary_agent_saved,由「保存为总结」成功回调发出）。此前固化 agent 发 started
            // 属错误行为,反转钉死:envelope 成功也不发 started。
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const { createAgentSummary } = await import('../summaryApi');
            mockPost.mockResolvedValueOnce({ data: { code: 0, data: { task_id: 3, task_no: 'n', status: 1, created_at: 'x' } } });
            await createAgentSummary({} as any, { trigger_mode: 'agent' });
            expect(track.mock.calls.some((c) => c[0] === 'smart_summary_started')).toBe(false);
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

    // DAP-110 Stage 2:4 个「动作完成」类事件的 api 层 envelope gate。与 smart_summary_started 同款——
    // 唯一收口在 api 层,仅 code===0 才命令式 track 一次,props 留空(注册契约无自定义属性);
    // code!==0 / 缺 code(逻辑失败 / 网关信封)一律不发。source/quality 由采集器按注册默认填。
    describe('DAP-110 Stage 2 envelope gate — member/cancel/version_restored', () => {
        const cases: Array<{
            name: string;
            event: string;
            mock: 'post' | 'del';
            run: (api: typeof import('../summaryApi')) => Promise<unknown>;
            props?: Record<string, unknown>;
        }> = [
            { name: 'addMembers', event: 'smart_summary_member_added', mock: 'post', run: (api) => api.addMembers(1, ['u1']), props: { summary_id: 1, added_count: 1 } },
            { name: 'removeMember', event: 'smart_summary_member_removed', mock: 'del', run: (api) => api.removeMember(1, 'u1'), props: { summary_id: 1, removed_count: 1 } },
            { name: 'cancelSummary', event: 'smart_summary_task_cancelled', mock: 'post', run: (api) => api.cancelSummary(1), props: { summary_id: 1 } },
            { name: 'restoreSummaryVersion (team)', event: 'smart_summary_version_restored', mock: 'post', run: (api) => api.restoreSummaryVersion(1, 2), props: { summary_id: 1 } },
            { name: 'restorePersonalSummaryVersion (personal)', event: 'smart_summary_version_restored', mock: 'post', run: (api) => api.restorePersonalSummaryVersion(1, 2), props: { summary_id: 1 } },
        ];

        for (const c of cases) {
            it(`${c.name}: emits ${c.event} once with DAP-266 spec props when envelope code===0`, async () => {
                const { Dap } = await import('@octo/base');
                const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
                const api = await import('../summaryApi');
                const mockFn = c.mock === 'post' ? mockPost : mockDelete;
                mockFn.mockResolvedValueOnce({ data: { code: 0, data: {} } });
                await c.run(api);
                const hits = track.mock.calls.filter((call) => call[0] === c.event);
                expect(hits).toHaveLength(1);
                // DAP-266：补齐 result doc spec_props（summary_id 等业务 id 不自动注入,须显式传）。
                expect(hits[0][1]).toEqual(c.props ?? {});
                track.mockRestore();
            });

            it(`${c.name}: does NOT emit ${c.event} when envelope code!==0 (逻辑失败)`, async () => {
                const { Dap } = await import('@octo/base');
                const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
                const api = await import('../summaryApi');
                const mockFn = c.mock === 'post' ? mockPost : mockDelete;
                mockFn.mockResolvedValueOnce({ data: { code: 1, message: 'fail', data: null } });
                await c.run(api);
                expect(track.mock.calls.some((call) => call[0] === c.event)).toBe(false);
                track.mockRestore();
            });

            it(`${c.name}: does NOT emit ${c.event} when code 缺省(网关信封)`, async () => {
                const { Dap } = await import('@octo/base');
                const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
                const api = await import('../summaryApi');
                const mockFn = c.mock === 'post' ? mockPost : mockDelete;
                mockFn.mockResolvedValueOnce({ data: { data: null } });
                await c.run(api);
                expect(track.mock.calls.some((call) => call[0] === c.event)).toBe(false);
                track.mockRestore();
            });
        }
    });
});

// DAP-218 M11：本轮补埋的 api 层「动作完成」类事件的 envelope gate。与 DAP-110 Stage 2 同款——
// 唯一收口在 api 层,仅 code===0 才命令式 track 一次,props 留空;code!==0 / 缺 code 一律不发。
describe('DAP-218 M11 envelope gate — template/member/submit/schedule', () => {
    type Api = typeof import('../summaryApi');
    const cases: Array<{
        name: string;
        event: string;
        mock: 'post' | 'put' | 'del';
        run: (api: Api) => Promise<unknown>;
        props?: Record<string, unknown>;
    }> = [
        { name: 'updateMyTopicTemplate', event: 'smart_summary_preset_template_edited', mock: 'put', run: (api) => api.updateMyTopicTemplate('tpl_1', { label: 'x', description: 'd' }), props: { template_id: 'tpl_1', is_custom: false } },
        { name: 'updateCustomTopicTemplate', event: 'smart_summary_custom_template_edited', mock: 'put', run: (api) => api.updateCustomTopicTemplate('tpl_1', { label: 'x', description: 'd' }), props: { template_id: 'tpl_1', is_custom: true } },
        { name: 'deleteCustomTopicTemplate', event: 'smart_summary_custom_template_deleted', mock: 'del', run: (api) => api.deleteCustomTopicTemplate('tpl_1') },
        { name: 'leaveSummary', event: 'smart_summary_member_exited', mock: 'post', run: (api) => api.leaveSummary(1), props: { summary_id: 1 } },
        { name: 'submitPersonalResult', event: 'smart_summary_my_report_submitted', mock: 'post', run: (api) => api.submitPersonalResult(1), props: { summary_id: 1 } },
        { name: 'confirmSchedule', event: 'smart_summary_recurring_participation_confirmed', mock: 'post', run: (api) => api.confirmSchedule(7) },
    ];

    const mockFor = (m: 'post' | 'put' | 'del') => (m === 'post' ? mockPost : m === 'put' ? mockPut : mockDelete);

    for (const c of cases) {
        it(`${c.name}: emits ${c.event} once with DAP-266 spec props when envelope code===0`, async () => {
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const api = await import('../summaryApi');
            mockFor(c.mock).mockResolvedValueOnce({ data: { code: 0, data: { template: {}, is_active: false } } });
            await c.run(api);
            const hits = track.mock.calls.filter((call) => call[0] === c.event);
            expect(hits).toHaveLength(1);
            // DAP-266：deleteCustomTopicTemplate / confirmSchedule 在本单元测试未透传 trackProps → 仍 {}；
            //   DAP-271：模板编辑改用非 PII 的 template_id + is_custom（不再上报 template_name 自由文本）。
            expect(hits[0][1]).toEqual(c.props ?? {});
            track.mockRestore();
        });

        it(`${c.name}: does NOT emit ${c.event} when envelope code!==0`, async () => {
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const api = await import('../summaryApi');
            mockFor(c.mock).mockResolvedValueOnce({ data: { code: 1, message: 'fail', data: null } });
            await c.run(api);
            expect(track.mock.calls.some((call) => call[0] === c.event)).toBe(false);
            track.mockRestore();
        });

        it(`${c.name}: does NOT emit ${c.event} when code 缺省(网关信封)`, async () => {
            const { Dap } = await import('@octo/base');
            const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
            const api = await import('../summaryApi');
            mockFor(c.mock).mockResolvedValueOnce({ data: { data: null } });
            await c.run(api);
            expect(track.mock.calls.some((call) => call[0] === c.event)).toBe(false);
            track.mockRestore();
        });
    }

    it('respondToTask(accept) emits invite_accepted (not rejected) on code===0', async () => {
        const { Dap } = await import('@octo/base');
        const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
        const api = await import('../summaryApi');
        mockPost.mockResolvedValueOnce({ data: { code: 0, data: {} } });
        await api.respondToTask(1, 'accept');
        expect(track.mock.calls.filter((c) => c[0] === 'smart_summary_invite_accepted')).toHaveLength(1);
        expect(track.mock.calls.some((c) => c[0] === 'smart_summary_invite_rejected')).toBe(false);
        track.mockRestore();
    });

    it('respondToTask(reject) emits invite_rejected (not accepted) on code===0', async () => {
        const { Dap } = await import('@octo/base');
        const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
        const api = await import('../summaryApi');
        mockPost.mockResolvedValueOnce({ data: { code: 0, data: {} } });
        await api.respondToTask(1, 'reject');
        expect(track.mock.calls.filter((c) => c[0] === 'smart_summary_invite_rejected')).toHaveLength(1);
        expect(track.mock.calls.some((c) => c[0] === 'smart_summary_invite_accepted')).toBe(false);
        track.mockRestore();
    });

    it('respondToTask does NOT emit when code!==0', async () => {
        const { Dap } = await import('@octo/base');
        const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
        const api = await import('../summaryApi');
        mockPost.mockResolvedValueOnce({ data: { code: 1, data: null } });
        await api.respondToTask(1, 'accept');
        expect(track.mock.calls.some((c) => String(c[0]).startsWith('smart_summary_invite_'))).toBe(false);
        track.mockRestore();
    });

    it('toggleSchedule(false) emits timer_disabled on code===0', async () => {
        const { Dap } = await import('@octo/base');
        const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
        const api = await import('../summaryApi');
        mockPut.mockResolvedValueOnce({ data: { code: 0, data: { is_active: false } } });
        await api.toggleSchedule(7, false);
        expect(track.mock.calls.filter((c) => c[0] === 'smart_summary_timer_disabled')).toHaveLength(1);
        track.mockRestore();
    });

    it('toggleSchedule(true) does NOT emit timer_disabled even on code===0 (re-enable edge)', async () => {
        const { Dap } = await import('@octo/base');
        const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
        const api = await import('../summaryApi');
        mockPut.mockResolvedValueOnce({ data: { code: 0, data: { is_active: true } } });
        await api.toggleSchedule(7, true);
        expect(track.mock.calls.some((c) => c[0] === 'smart_summary_timer_disabled')).toBe(false);
        track.mockRestore();
    });
});

// DAP-271:emit 站点 props 回归(经 mock track 捕获 API 传入的 props;最终 sanitizer 行为另见 dmworkbase Dap.test)。
describe('DAP-271 — emit 站点 props(finding 1 隐私 / finding 6 补齐)', () => {
    async function trackFor(run: (api: typeof import('../summaryApi')) => Promise<unknown>, event: string) {
        const { Dap } = await import('@octo/base');
        const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
        const api = await import('../summaryApi');
        await run(api);
        const hit = track.mock.calls.find((c) => c[0] === event);
        track.mockRestore();
        return hit?.[1] as Record<string, unknown> | undefined;
    }

    const PII = '客户AcmeCorp机密并购项目复盘';

    it('finding 1: custom_template_created 传 is_custom 且不含用户输入的 label/template_name', async () => {
        mockPost.mockResolvedValueOnce({ data: { code: 0, data: { template: { id: 'x' } } } });
        const props = await trackFor((api) => api.createCustomTopicTemplate({ label: PII, description: PII }, { template_count_after: 2 }), 'smart_summary_custom_template_created');
        expect(JSON.stringify(props)).not.toContain(PII);
        expect(props).not.toHaveProperty('template_name');
        expect(props).toMatchObject({ is_custom: true, template_count_after: 2 });
    });

    it('finding 1: preset/custom template_edited 传 template_id+is_custom,不含 label', async () => {
        mockPut.mockResolvedValueOnce({ data: { code: 0, data: { template: {} } } });
        const preset = await trackFor((api) => api.updateMyTopicTemplate('tpl_p', { label: PII, description: PII }), 'smart_summary_preset_template_edited');
        expect(JSON.stringify(preset)).not.toContain(PII);
        expect(preset).toMatchObject({ template_id: 'tpl_p', is_custom: false });

        mockPut.mockResolvedValueOnce({ data: { code: 0, data: { template: {} } } });
        const custom = await trackFor((api) => api.updateCustomTopicTemplate('tpl_c', { label: PII, description: PII }), 'smart_summary_custom_template_edited');
        expect(JSON.stringify(custom)).not.toContain(PII);
        expect(custom).toMatchObject({ template_id: 'tpl_c', is_custom: true });
    });

    it('finding 6: version_restored 透传 version_number(展示版本号)', async () => {
        mockPost.mockResolvedValueOnce({ data: { code: 0, data: {} } });
        const team = await trackFor((api) => api.restoreSummaryVersion(11, 22, 5), 'smart_summary_version_restored');
        expect(team).toMatchObject({ summary_id: 11, version_number: 5 });

        mockPost.mockResolvedValueOnce({ data: { code: 0, data: {} } });
        const personal = await trackFor((api) => api.restorePersonalSummaryVersion(11, 22, 7), 'smart_summary_version_restored');
        expect(personal).toMatchObject({ summary_id: 11, version_number: 7 });
    });

    it('finding 6: deleted/task_cancelled 透传受控 source 枚举', async () => {
        mockDelete.mockResolvedValueOnce({ data: { code: 0, data: null } });
        const del = await trackFor((api) => api.deleteSummary(9, 'list'), 'smart_summary_deleted');
        expect(del).toMatchObject({ summary_id: 9, source: 'list' });

        mockPost.mockResolvedValueOnce({ data: { code: 0, data: null } });
        const cancel = await trackFor((api) => api.cancelSummary(9, 'detail'), 'smart_summary_task_cancelled');
        expect(cancel).toMatchObject({ summary_id: 9, source: 'detail' });
    });

    it('finding 6: regenerated 透传 prev_status(team + personal)', async () => {
        mockPost.mockResolvedValueOnce({ data: { code: 0, data: { task_id: 1 } } });
        const team = await trackFor((api) => api.regenerateSummary(3, undefined, 4), 'smart_summary_regenerated');
        expect(team).toMatchObject({ summary_id: 3, regenerate_type: 'team', prev_status: 4 });

        mockPost.mockResolvedValueOnce({ data: { code: 0, data: { task_id: 1 } } });
        const personal = await trackFor((api) => api.regeneratePersonalSummary(3, undefined, 2), 'smart_summary_regenerated');
        expect(personal).toMatchObject({ summary_id: 3, regenerate_type: 'personal', prev_status: 2 });
    });

    it('finding 6: timer_disabled / recurring_participation_confirmed 透传 summary_id(非 scheduleId)', async () => {
        mockPut.mockResolvedValueOnce({ data: { code: 0, data: { is_active: false } } });
        const disabled = await trackFor((api) => api.toggleSchedule(50, false, 777), 'smart_summary_timer_disabled');
        expect(disabled).toMatchObject({ summary_id: 777 });

        mockPost.mockResolvedValueOnce({ data: { code: 0, data: null } });
        const confirmed = await trackFor((api) => api.confirmSchedule(60, 888), 'smart_summary_recurring_participation_confirmed');
        expect(confirmed).toMatchObject({ summary_id: 888 });
    });
});

describe('B-1 — smart_summary_timer_configured frequency_unit/frequency_n 映射', () => {
    async function trackFor(run: (api: typeof import('../summaryApi')) => Promise<unknown>, event: string) {
        const { Dap } = await import('@octo/base');
        const track = vi.spyOn(Dap.shared, 'track').mockImplementation(() => undefined);
        const api = await import('../summaryApi');
        await run(api);
        const hit = track.mock.calls.find((c) => c[0] === event);
        track.mockRestore();
        return hit?.[1] as Record<string, unknown> | undefined;
    }

    // scheduleToParams 对周调度编码为 interval_days=every*7 + day_of_week，与「每 N 天」在
    // 提交参数层字节相同。这些用例覆盖：日/周(每1)/双周/月，断言 frequency_* 正确。
    const base = {
        title: 't',
        summary_mode: SummaryMode.BY_GROUP,
        cron_expr: '',
        time_range_type: 2 as const,
        sources: [],
    };

    it('daily every 1 → {day, 1}(带 UI 真值)', async () => {
        mockPost.mockResolvedValueOnce({ data: { code: 0, data: { schedule_id: 1 } } });
        const props = await trackFor(
            (api) => api.createSchedule(
                { ...base, interval_days: 1, interval_months: 0, day_of_week: 0, day_of_month: 0, run_time: '09:00' },
                { unit: 'day', every: 1 },
            ),
            'smart_summary_timer_configured',
        );
        expect(props).toMatchObject({ frequency_unit: 'day', frequency_n: 1 });
    });

    it('weekly every 1 → {week, 1}(生产者把它编码成 interval_days=7,不能误报成 day)', async () => {
        mockPost.mockResolvedValueOnce({ data: { code: 0, data: { schedule_id: 2 } } });
        const props = await trackFor(
            (api) => api.createSchedule(
                { ...base, interval_days: 7, interval_months: 0, day_of_week: 3, day_of_month: 0, run_time: '09:00' },
                { unit: 'week', every: 1 },
            ),
            'smart_summary_timer_configured',
        );
        expect(props).toMatchObject({ frequency_unit: 'week', frequency_n: 1 });
    });

    it('biweekly → {week, 2}', async () => {
        mockPost.mockResolvedValueOnce({ data: { code: 0, data: { schedule_id: 3 } } });
        const props = await trackFor(
            (api) => api.createSchedule(
                { ...base, interval_days: 14, interval_months: 0, day_of_week: 3, day_of_month: 0, run_time: '09:00' },
                { unit: 'week', every: 2 },
            ),
            'smart_summary_timer_configured',
        );
        expect(props).toMatchObject({ frequency_unit: 'week', frequency_n: 2 });
    });

    it('monthly every 1 → {month, 1}', async () => {
        mockPut.mockResolvedValueOnce({ data: { code: 0, data: { schedule_id: 4 } } });
        const props = await trackFor(
            (api) => api.updateSchedule(4,
                { interval_days: 0, interval_months: 1, day_of_week: 0, day_of_month: 15, run_time: '09:00' },
                { unit: 'month', every: 1 },
            ),
            'smart_summary_timer_configured',
        );
        expect(props).toMatchObject({ frequency_unit: 'month', frequency_n: 1 });
    });

    it('无 UI 真值兜底：interval_days 为 7 的整数倍且指定周几 → week；纯天 → day', async () => {
        mockPost.mockResolvedValueOnce({ data: { code: 0, data: { schedule_id: 5 } } });
        const wk = await trackFor(
            (api) => api.createSchedule(
                { ...base, interval_days: 14, interval_months: 0, day_of_week: 3, day_of_month: 0, run_time: '09:00' },
            ),
            'smart_summary_timer_configured',
        );
        expect(wk).toMatchObject({ frequency_unit: 'week', frequency_n: 2 });

        mockPost.mockResolvedValueOnce({ data: { code: 0, data: { schedule_id: 6 } } });
        const dy = await trackFor(
            (api) => api.createSchedule(
                { ...base, interval_days: 3, interval_months: 0, day_of_week: 0, day_of_month: 0, run_time: '09:00' },
            ),
            'smart_summary_timer_configured',
        );
        expect(dy).toMatchObject({ frequency_unit: 'day', frequency_n: 3 });
    });
});
