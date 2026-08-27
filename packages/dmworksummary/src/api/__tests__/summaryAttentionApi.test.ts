/**
 * summaryAttentionApi test —— 待关注计数的取数路径与【端点缺失兜底】。
 *
 * 待关注红点现在多了一条无人值守的定时兜底轮询，取数频次从「用户动作驱动」变成
 * 「有人开着标签页就会发生」。为此后端新增了窄端点 GET /summaries/attention
 * （只返回四个计数，服务端带 5s 缓存）。但前后端不同步发布是常态——本仓库的 web
 * 可以指向任意一套 summary-api——所以窄端点上线【之前】红点必须照常工作。
 *
 * 这里钉死三件事：
 *   1. fresh 的分工：用户动作带 fresh=1（绕过 5s 缓存），后台轮询不带（吃缓存）；
 *   2. 404 时自动回落到 listSummaries({page:1,page_size:1}) 读同一个 attention_count；
 *   3. 404 只判一次就记下来，之后直接走兜底——否则每一拍轮询都要先撞一次 404
 *      再补一个列表请求，在老后端上把请求量【翻倍】，比不做窄端点还糟。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('axios', () => ({
    default: {
        create: () => ({
            get: mockGet,
            post: vi.fn(),
            put: vi.fn(),
            delete: vi.fn(),
            interceptors: {
                request: { use: vi.fn() },
                response: { use: vi.fn() },
            },
        }),
        isCancel: (err: unknown) => !!(err as { __CANCEL__?: boolean })?.__CANCEL__,
    },
}));

import {
    fetchSummaryAttentionCounts,
    getSummaryAttention,
    resetSummaryAttentionEndpointProbe,
} from '../summaryApi';

const ATTENTION_PATH = '/summary/api/v1/summaries/attention';
const LIST_PATH = '/summary/api/v1/summaries';

function httpError(status: number) {
    return { response: { status, data: { message: `HTTP ${status}` } } };
}

describe('getSummaryAttention —— 窄端点', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetSummaryAttentionEndpointProbe();
    });

    it('解开 {code,message,data} 信封后返回计数', async () => {
        mockGet.mockResolvedValueOnce({
            data: { code: 0, data: { attention_count: 4, unread_count: 1, pending_invitation_count: 1, pending_submission_count: 2 } },
        });

        await expect(getSummaryAttention()).resolves.toEqual({
            attention_count: 4,
            unread_count: 1,
            pending_invitation_count: 1,
            pending_submission_count: 2,
        });
    });

    it('fresh=true 时带 ?fresh=1，绕过服务端 5s 缓存', async () => {
        mockGet.mockResolvedValueOnce({ data: { data: { attention_count: 0 } } });

        await getSummaryAttention({ fresh: true });

        expect(mockGet).toHaveBeenCalledWith(ATTENTION_PATH, { params: { fresh: 1 } });
    });

    it('不传 fresh 时【不】带该参数（后台轮询吃缓存）', async () => {
        mockGet.mockResolvedValueOnce({ data: { data: { attention_count: 0 } } });

        await getSummaryAttention();

        expect(mockGet).toHaveBeenCalledWith(ATTENTION_PATH, { params: undefined });
    });

    it('把 HTTP 状态码挂到 Error 上：兜底判定必须能区分 404 与 5xx', async () => {
        mockGet.mockRejectedValueOnce(httpError(404));

        // 公共 get() 会把错误压成字符串 Error，状态码就此丢失，所以这里没走它。
        await expect(getSummaryAttention()).rejects.toMatchObject({ status: 404 });
    });
});

describe('fetchSummaryAttentionCounts —— 端点缺失兜底', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetSummaryAttentionEndpointProbe();
    });

    it('窄端点可用时直接用它，不碰列表端点', async () => {
        mockGet.mockResolvedValueOnce({ data: { data: { attention_count: 6 } } });

        await expect(fetchSummaryAttentionCounts()).resolves.toEqual({ attention_count: 6 });
        expect(mockGet).toHaveBeenCalledTimes(1);
        expect(mockGet).toHaveBeenCalledWith(ATTENTION_PATH, { params: undefined });
    });

    it('窄端点 404 时回落到 listSummaries({page:1,page_size:1}) 读同一字段', async () => {
        mockGet
            .mockRejectedValueOnce(httpError(404))
            .mockResolvedValueOnce({
                data: { data: { items: [], total: 0, attention_count: 3, unread_count: 3, pending_invitation_count: 0, pending_submission_count: 0 } },
            });

        // 本次调用不算失败：老后端上红点必须照常亮。
        await expect(fetchSummaryAttentionCounts()).resolves.toMatchObject({ attention_count: 3 });

        expect(mockGet).toHaveBeenNthCalledWith(2, LIST_PATH, {
            params: { page: 1, page_size: 1 },
        });
    });

    it('404 只判一次：之后的调用直接走兜底，不再每拍撞一次 404', async () => {
        mockGet
            .mockRejectedValueOnce(httpError(404))
            .mockResolvedValue({ data: { data: { items: [], total: 0, attention_count: 1 } } });

        await fetchSummaryAttentionCounts();
        const callsAfterFirst = mockGet.mock.calls.length;                 // 404 + 列表 = 2

        await fetchSummaryAttentionCounts();
        await fetchSummaryAttentionCounts();

        // 每次只多一个列表请求；若每次都重探窄端点，这里会是 +2 /次，
        // 也就是在老后端上把轮询流量翻倍。
        expect(mockGet.mock.calls.length).toBe(callsAfterFirst + 2);
        expect(mockGet.mock.calls.slice(callsAfterFirst).every(([path]) => path === LIST_PATH)).toBe(true);
    });

    it('5xx【不】触发兜底也不记忆：那是暂时故障，端点仍然存在', async () => {
        mockGet.mockRejectedValueOnce(httpError(503));

        await expect(fetchSummaryAttentionCounts()).rejects.toBeTruthy();
        // 只发了窄端点那一次，没有补列表请求（后端已经在冒烟了，别再加压）。
        expect(mockGet).toHaveBeenCalledTimes(1);

        // 下一次仍然优先走窄端点：一次抖动不该让它永久降级到重的那条路径。
        mockGet.mockResolvedValueOnce({ data: { data: { attention_count: 2 } } });
        await expect(fetchSummaryAttentionCounts()).resolves.toEqual({ attention_count: 2 });
        expect(mockGet).toHaveBeenLastCalledWith(ATTENTION_PATH, { params: undefined });
    });

    it('网络错误（无 response.status）同样不触发兜底', async () => {
        mockGet.mockRejectedValueOnce(new Error('Network Error'));

        await expect(fetchSummaryAttentionCounts()).rejects.toBeTruthy();
        expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('兜底路径本身失败时向上抛，让轮询据此退避', async () => {
        mockGet
            .mockRejectedValueOnce(httpError(404))
            .mockRejectedValueOnce(httpError(500));

        await expect(fetchSummaryAttentionCounts()).rejects.toBeTruthy();
    });

    it('兜底路径同样尊重 fresh 分工：用户动作走 fresh，列表端点无此参数', async () => {
        mockGet
            .mockRejectedValueOnce(httpError(404))
            .mockResolvedValueOnce({ data: { data: { items: [], total: 0, attention_count: 0 } } });

        await fetchSummaryAttentionCounts({ fresh: true });

        expect(mockGet).toHaveBeenNthCalledWith(1, ATTENTION_PATH, { params: { fresh: 1 } });
        // 列表端点没有 fresh 语义（它本来就不走那层 5s 缓存），别凭空塞参数。
        expect(mockGet).toHaveBeenNthCalledWith(2, LIST_PATH, { params: { page: 1, page_size: 1 } });
    });
});
