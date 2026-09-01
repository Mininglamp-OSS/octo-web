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
    SUMMARY_ATTENTION_TIMEOUT_MS,
} from '../summaryApi';

const ATTENTION_PATH = '/summary/api/v1/summaries/attention';
const LIST_PATH = '/summary/api/v1/summaries';

/**
 * 窄端点的请求配置。timeout 是【必须】断言的一部分，不是可有可无的细节：
 * 兜底轮询内部有请求互斥，一个挂死的请求会把整条轮询链停摆到浏览器自己超时
 * 为止，而「无人值守时红点会自己亮」正是这条轮询唯一的存在理由。
 */
function attentionCfg(params?: Record<string, unknown>) {
    return { params, timeout: SUMMARY_ATTENTION_TIMEOUT_MS };
}

/**
 * 兜底（列表端点）路径的请求配置。
 *
 * 同样【必须】断言 timeout，且理由比窄端点更强一层：这条路径被 404 记忆锁定之后，
 * 就是老后端上轮询唯一的取数来源。
 *
 * 澄清一点，免得后人误读这条断言的目的：这【不】是「从无超时改成有超时」。
 * summaryAxios 会继承 axios.create 那一刻的 axios.defaults，而 @octo/base 的
 * APIClient 在模块求值期就设了 20s 全局默认（YUJ-2628），所以兜底请求本来就有
 * 隐式超时。问题是 20s > 轮询基础间隔 15s：挂死的请求会跨过下一拍（被 fetching
 * 互斥跳掉），并在这段时间里让 inFlightReads ≥1 拒掉全部跨标签页广播。取 10s
 * 是为了让失败在下一拍之前销账，同时把这条不变量从「另一个包的全局默认值恰好
 * 合适」变成本地显式声明。
 *
 * 列表端点【没有】fresh 语义，所以 params 恒为分页那两个字段。
 */
function listFallbackCfg() {
    return { params: { page: 1, page_size: 1 }, timeout: SUMMARY_ATTENTION_TIMEOUT_MS };
}

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

        expect(mockGet).toHaveBeenCalledWith(ATTENTION_PATH, attentionCfg({ fresh: 1 }));
    });

    it('不传 fresh 时【不】带该参数（后台轮询吃缓存）', async () => {
        mockGet.mockResolvedValueOnce({ data: { data: { attention_count: 0 } } });

        await getSummaryAttention();

        expect(mockGet).toHaveBeenCalledWith(ATTENTION_PATH, attentionCfg(undefined));
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
        expect(mockGet).toHaveBeenCalledWith(ATTENTION_PATH, attentionCfg(undefined));
    });

    it('窄端点 404 时回落到 listSummaries({page:1,page_size:1}) 读同一字段', async () => {
        mockGet
            .mockRejectedValueOnce(httpError(404))
            .mockResolvedValueOnce({
                data: { data: { items: [], total: 0, attention_count: 3, unread_count: 3, pending_invitation_count: 0, pending_submission_count: 0 } },
            });

        // 本次调用不算失败：老后端上红点必须照常亮。
        await expect(fetchSummaryAttentionCounts()).resolves.toMatchObject({ attention_count: 3 });

        expect(mockGet).toHaveBeenNthCalledWith(2, LIST_PATH, listFallbackCfg());
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
        expect(mockGet).toHaveBeenLastCalledWith(ATTENTION_PATH, attentionCfg(undefined));
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

        expect(mockGet).toHaveBeenNthCalledWith(1, ATTENTION_PATH, attentionCfg({ fresh: 1 }));
        // 列表端点没有 fresh 语义（它本来就不走那层 5s 缓存），别凭空塞参数。
        expect(mockGet).toHaveBeenNthCalledWith(2, LIST_PATH, listFallbackCfg());
    });

    /**
     * 🔴 CR：窄端点拿到了 10s 超时，兜底路径当时没有显式超时。
     *
     * 这一组钉的是「挂死不会拖掉下一拍」。诊断错这一条的代价特别高：故障表现是
     * 红点该动的时候没动、控制台无错误、用户不会报 bug，而 fetching / inFlightReads
     * 两个标志位在挂死期间都停在「有请求在飞」上，轮询丢拍、跨标签页广播全被拒。
     *
     * 精确一点：兜底请求本来就有 @octo/base 设的 20s 全局默认超时（见 listFallbackCfg
     * 注释），所以这不是「永久停摆」而是「丢拍」。要防的是 20s > 15s 基础间隔。
     */
    describe('兜底路径的超时（🔴 CR）', () => {
        it('兜底请求带上和窄端点同一个 timeout，不是无超时', async () => {
            mockGet
                .mockRejectedValueOnce(httpError(404))
                .mockResolvedValueOnce({ data: { data: { items: [], total: 0, attention_count: 4 } } });

            await fetchSummaryAttentionCounts();

            const [, cfg] = mockGet.mock.calls[1];
            // 断言具体数值而不只是 toBeDefined：写成 0 或 undefined 在 axios 里都等于
            // 「永不超时」，那正是本条要防的故障。
            expect(cfg).toMatchObject({ timeout: SUMMARY_ATTENTION_TIMEOUT_MS });
            expect(cfg.timeout).toBeGreaterThan(0);
        });

        it('超时短于轮询基础间隔：失败要在下一拍之前销账，不能因互斥跳拍', () => {
            // 15_000 是 summaryAttentionPoll 的 POLL_BASE_INTERVAL_MS。取值一旦被调大到
            // 超过基础间隔，超时就不再能阻止「一拍挂死拖掉下一拍」，这条断言会先炸。
            expect(SUMMARY_ATTENTION_TIMEOUT_MS).toBeLessThan(15_000);
        });

        it('兜底请求超时后向上抛，让轮询走退避分支而不是拖住下一拍', async () => {
            mockGet
                .mockRejectedValueOnce(httpError(404))
                // axios 超时的形状：无 response，code=ECONNABORTED。
                .mockRejectedValueOnce(
                    Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' }),
                );

            // 关键在于它【会 settle】。挂死的实现下这个 await 永远不返回，
            // 用例会以超时失败——正是要抓的那个故障。
            await expect(fetchSummaryAttentionCounts()).rejects.toThrow(/timeout/i);
        });

        it('超时【不】被误判成端点缺失：下一次仍走兜底，不会反过来重探窄端点', async () => {
            mockGet
                .mockRejectedValueOnce(httpError(404))
                .mockRejectedValueOnce(
                    Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' }),
                );
            await expect(fetchSummaryAttentionCounts()).rejects.toBeTruthy();
            const callsAfterTimeout = mockGet.mock.calls.length;             // 404 + 超时 = 2

            // 一次超时不该动摇「窄端点不存在」这个已经成立的结论：重探会在老后端上
            // 把每拍的请求量翻回两个。
            mockGet.mockResolvedValueOnce({ data: { data: { items: [], total: 0, attention_count: 5 } } });
            await expect(fetchSummaryAttentionCounts()).resolves.toMatchObject({ attention_count: 5 });

            expect(mockGet.mock.calls.length).toBe(callsAfterTimeout + 1);
            expect(mockGet).toHaveBeenLastCalledWith(LIST_PATH, listFallbackCfg());
        });
    });
});
