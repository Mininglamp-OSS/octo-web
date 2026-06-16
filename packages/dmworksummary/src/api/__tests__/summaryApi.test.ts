import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

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
            put: vi.fn(),
            delete: vi.fn(),
            interceptors: {
                request: { use: mockRequestUse },
                response: { use: mockResponseUse },
            },
        }),
        isCancel: (err: unknown) => !!(err as { __CANCEL__?: boolean })?.__CANCEL__,
    },
}));

import { getTopicTemplates, getTemplates, listSummaries } from '../summaryApi';

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

            expect(result).toEqual(templates);
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
});
