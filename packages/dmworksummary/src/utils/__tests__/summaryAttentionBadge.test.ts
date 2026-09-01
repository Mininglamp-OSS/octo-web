/**
 * summaryAttentionBadge test — 侧边栏「智能总结」菜单待关注红点 (#1359)。
 *
 * 独立成文件的原因与 chatSummaryActions 相同：module.tsx 引入
 * react-dom/client，单测不便直接 import。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return { ...actual };
});
vi.mock('../../api/summaryApi');

import * as api from '../../api/summaryApi';
import {
    getSummaryAttentionBadge,
    setSummaryAttentionBadge,
    refreshSummaryAttentionBadge,
    beginSummaryAttentionRead,
    commitSummaryAttentionBadge,
    abandonSummaryAttentionRead,
    acceptRemoteAttentionCount,
    attentionSampleAt,
    hasInFlightAttentionRead,
    readSummaryAttentionCount,
    resetSummaryAttentionOrdering,
    setSummaryAttentionPublisher,
    ATTENTION_CACHE_TTL_MS,
    REMOTE_SAMPLE_FUTURE_TOLERANCE_MS,
} from '../summaryAttentionBadge';

import { WKApp } from '@octo/base';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

describe('summaryAttentionBadge (#1359)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        WKApp.shared.currentSpaceId = 'space-123';
        WKApp.loginInfo.uid = 'test-uid';
        vi.spyOn(WKApp.loginInfo, 'isLogined').mockReturnValue(true);
        vi.spyOn(WKApp.menus, 'refresh').mockImplementation(() => {});
        // 重置模块级计数与样本时刻水位（都会跨用例串）
        resetSummaryAttentionOrdering();
        setSummaryAttentionBadge(0);
        vi.mocked(WKApp.menus.refresh).mockClear();
    });

    it('getSummaryAttentionBadge 初始返回 0', () => {
        expect(getSummaryAttentionBadge()).toBe(0);
    });

    it('setSummaryAttentionBadge 更新计数并触发 menus.refresh', () => {
        setSummaryAttentionBadge(3);
        expect(getSummaryAttentionBadge()).toBe(3);
        expect(WKApp.menus.refresh).toHaveBeenCalledTimes(1);
    });

    it('setSummaryAttentionBadge 相同值不重复触发 refresh', () => {
        setSummaryAttentionBadge(2);
        setSummaryAttentionBadge(2);
        expect(WKApp.menus.refresh).toHaveBeenCalledTimes(1);
    });

    it('setSummaryAttentionBadge 先规范化非有限值、小数和负数再比较', () => {
        setSummaryAttentionBadge(-1);
        setSummaryAttentionBadge(Number.NaN);
        setSummaryAttentionBadge(Number.POSITIVE_INFINITY);
        expect(getSummaryAttentionBadge()).toBe(0);
        expect(WKApp.menus.refresh).not.toHaveBeenCalled();

        setSummaryAttentionBadge(3.9);
        expect(getSummaryAttentionBadge()).toBe(3);
        expect(WKApp.menus.refresh).toHaveBeenCalledTimes(1);
    });

    it('refreshSummaryAttentionBadge 拉取 attention_count（未读∪邀请∪待提交）', async () => {
        vi.mocked(api.fetchSummaryAttentionCounts).mockResolvedValue({
            items: [],
            total: 0,
            attention_count: 5,
            unread_count: 2,
            pending_invitation_count: 1,
            pending_submission_count: 2,
        } as any);

        await refreshSummaryAttentionBadge();

        expect(api.fetchSummaryAttentionCounts).toHaveBeenCalledWith({ fresh: true });
        expect(getSummaryAttentionBadge()).toBe(5);
    });

    // 口径回归：#1359 首版读 pending_invitation_count，侧边栏数字会小于卡片红点数。
    // 侧边栏必须与 needs_attention 同源，否则「显示 1 条、进去 3 个红点」。
    it('refreshSummaryAttentionBadge 不再只读 pending_invitation_count', async () => {
        vi.mocked(api.fetchSummaryAttentionCounts).mockResolvedValue({
            items: [],
            total: 0,
            attention_count: 3,
            unread_count: 3,
            pending_invitation_count: 0,
            pending_submission_count: 0,
        } as any);

        await refreshSummaryAttentionBadge();

        expect(getSummaryAttentionBadge()).toBe(3);
    });

    it('refreshSummaryAttentionBadge 网络异常静默失败，不抛错', async () => {
        vi.mocked(api.fetchSummaryAttentionCounts).mockRejectedValue(new Error('network'));
        setSummaryAttentionBadge(4);

        await expect(refreshSummaryAttentionBadge()).resolves.toBeUndefined();
        // 保持旧值，不清零
        expect(getSummaryAttentionBadge()).toBe(4);
    });

    it('refreshSummaryAttentionBadge 响应缺 attention_count 时归零', async () => {
        vi.mocked(api.fetchSummaryAttentionCounts).mockResolvedValue({
            items: [],
            total: 0,
            unread_count: 0,
            pending_invitation_count: 4,
        } as any);

        setSummaryAttentionBadge(7);
        await refreshSummaryAttentionBadge();
        expect(getSummaryAttentionBadge()).toBe(0);
    });

    it('refreshSummaryAttentionBadge 未登录或 Space 未就绪时不发请求', async () => {
        vi.mocked(WKApp.loginInfo.isLogined).mockReturnValue(false);
        await refreshSummaryAttentionBadge();

        vi.mocked(WKApp.loginInfo.isLogined).mockReturnValue(true);
        WKApp.shared.currentSpaceId = '';
        await refreshSummaryAttentionBadge();

        expect(api.fetchSummaryAttentionCounts).not.toHaveBeenCalled();
    });

    it('refreshSummaryAttentionBadge 丢弃跨 Space 的迟到响应', async () => {
        const responseA = deferred<any>();
        const responseB = deferred<any>();
        vi.mocked(api.fetchSummaryAttentionCounts)
            .mockReturnValueOnce(responseA.promise)
            .mockReturnValueOnce(responseB.promise);

        WKApp.shared.currentSpaceId = 'space-a';
        const pendingA = refreshSummaryAttentionBadge();
        WKApp.shared.currentSpaceId = 'space-b';
        const pendingB = refreshSummaryAttentionBadge();

        responseB.resolve({ attention_count: 2 });
        await pendingB;
        expect(getSummaryAttentionBadge()).toBe(2);

        responseA.resolve({ attention_count: 9 });
        await pendingA;
        expect(getSummaryAttentionBadge()).toBe(2);
    });
});

// 写入必须按【请求发出时刻】排序，不是按响应到达顺序。两个写者（全局列表
// loadData 与 page_size=1 探测）并行存活，而且打开一条 BY_PERSON 总结天然会发
// 两次 markSummaryRead（loadDetail 一次，loadPersonalResult 再一次），所以这里的
// 交错是日常路径而非边界情况。
describe('summaryAttentionBadge — 按发出时刻排序', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        WKApp.shared.currentSpaceId = 'space-123';
        WKApp.loginInfo.uid = 'test-uid';
        vi.spyOn(WKApp.loginInfo, 'isLogined').mockReturnValue(true);
        vi.spyOn(WKApp.menus, 'refresh').mockImplementation(() => {});
        resetSummaryAttentionOrdering();
        setSummaryAttentionBadge(0);
        vi.mocked(WKApp.menus.refresh).mockClear();
    });

    // 回归：曾经按同 Space 合并在飞请求，第二个调用直接复用第一个的 promise。
    // 但第二次变更（个人未读标读）是在第一个请求【发出之后】才提交的，而后端
    // unread = 团队未读 OR 个人未读，所以第一次探测的快照里计数还没降——复用它
    // 就是拿一份早于自己变更的陈旧值，且不会再补一次请求。
    it('在飞期间发起的刷新会另发请求，并以后发者为准', async () => {
        const first = deferred<any>();
        const second = deferred<any>();
        vi.mocked(api.fetchSummaryAttentionCounts)
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);

        const pendingFirst = refreshSummaryAttentionBadge();   // 团队标读后
        const pendingSecond = refreshSummaryAttentionBadge();  // 个人标读后

        expect(api.fetchSummaryAttentionCounts).toHaveBeenCalledTimes(2);

        // 早发的探测带回变更前的快照，不得落盘。
        first.resolve({ attention_count: 1 });
        await pendingFirst;
        expect(getSummaryAttentionBadge()).toBe(0);

        second.resolve({ attention_count: 0 });
        await pendingSecond;
        expect(getSummaryAttentionBadge()).toBe(0);
    });

    it('后发的探测先返回时，早发的陈旧响应不得覆盖它', async () => {
        const first = deferred<any>();
        const second = deferred<any>();
        vi.mocked(api.fetchSummaryAttentionCounts)
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);

        const pendingFirst = refreshSummaryAttentionBadge();
        const pendingSecond = refreshSummaryAttentionBadge();

        second.resolve({ attention_count: 2 });
        await pendingSecond;
        expect(getSummaryAttentionBadge()).toBe(2);

        first.resolve({ attention_count: 7 });
        await pendingFirst;
        expect(getSummaryAttentionBadge()).toBe(2);
    });

    // 回归：setSummaryAttentionBadge 曾经无条件 refreshSeq++，连值没变的 no-op 写入
    // 都会把刚发出的探测杀掉。一个什么都没改的写者不应该能作废更新的读取。
    it('直接设值（含 no-op）不会作废在飞探测', async () => {
        const probe = deferred<any>();
        vi.mocked(api.fetchSummaryAttentionCounts).mockReturnValueOnce(probe.promise);
        setSummaryAttentionBadge(3);

        const pending = refreshSummaryAttentionBadge();
        // 列表写入一个相同值（no-op），不得影响探测。
        setSummaryAttentionBadge(3);

        probe.resolve({ attention_count: 2 });
        await pending;
        expect(getSummaryAttentionBadge()).toBe(2);
    });

    // 列表在发请求前领 ticket：它的快照早于探测，就算先返回也不能盖。
    it('先领号的列表写入不能覆盖后领号的探测', async () => {
        const probe = deferred<any>();
        vi.mocked(api.fetchSummaryAttentionCounts).mockReturnValueOnce(probe.promise);

        const listTicket = beginSummaryAttentionRead();   // 列表先发请求
        const pending = refreshSummaryAttentionBadge();   // 用户随后标读

        commitSummaryAttentionBadge(listTicket, 3);       // 列表先返回，快照更旧
        expect(getSummaryAttentionBadge()).toBe(0);

        probe.resolve({ attention_count: 2 });
        await pending;
        expect(getSummaryAttentionBadge()).toBe(2);
    });

    it('后领号的列表写入可以落盘', () => {
        const ticket = beginSummaryAttentionRead();
        commitSummaryAttentionBadge(ticket, 5);
        expect(getSummaryAttentionBadge()).toBe(5);
    });
});

// Ticket liveness：失败/放弃的读取若不还号，
// 号段就停在它那里，把一个发出更早、仍在飞、携带正确值的读取一并作废，
// 角标卡在陈值。放弃路径必须 `if (ticket === issueSeq) issueSeq--`。
describe('summaryAttentionBadge — 放弃路径还号 (ticket liveness)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        WKApp.shared.currentSpaceId = 'space-123';
        WKApp.loginInfo.uid = 'test-uid';
        vi.spyOn(WKApp.loginInfo, 'isLogined').mockReturnValue(true);
        vi.spyOn(WKApp.menus, 'refresh').mockImplementation(() => {});
        resetSummaryAttentionOrdering();
        setSummaryAttentionBadge(0);
        vi.mocked(WKApp.menus.refresh).mockClear();
    });

    it('探测失败后还号：更早的在飞读取得以落盘', async () => {
        const older = deferred<any>();
        const newer = deferred<any>();
        vi.mocked(api.fetchSummaryAttentionCounts)
            .mockReturnValueOnce(older.promise)
            .mockReturnValueOnce(newer.promise);

        const pendingOlder = refreshSummaryAttentionBadge();
        const pendingNewer = refreshSummaryAttentionBadge();

        // 后发的探测失败 → 号还回去，旧值保持。
        newer.reject(new Error('network'));
        await pendingNewer;
        expect(getSummaryAttentionBadge()).toBe(0);

        // 先发的读取带着正确值到达：号段已还给它，落盘成功。
        older.resolve({ attention_count: 3 });
        await pendingOlder;
        expect(getSummaryAttentionBadge()).toBe(3);
    });

    it('探测跨 Space 早退后还号：更早的在飞读取不被卡死', async () => {
        const older = deferred<any>();
        const newer = deferred<any>();
        vi.mocked(api.fetchSummaryAttentionCounts)
            .mockReturnValueOnce(older.promise)
            .mockReturnValueOnce(newer.promise);

        const pendingOlder = refreshSummaryAttentionBadge();  // 为 space-123 发出
        WKApp.shared.currentSpaceId = 'space-b';
        const pendingNewer = refreshSummaryAttentionBadge();  // 为 space-b 发出

        // 用户又切回 space-123：space-b 的探测成了弃子 → 早退、还号。
        WKApp.shared.currentSpaceId = 'space-123';
        newer.resolve({ attention_count: 7 });
        await pendingNewer;
        expect(getSummaryAttentionBadge()).toBe(0);

        // space-123 的旧读取仍然有效：号段已还给它，正确值落盘。
        // 不还号的旧实现里它会被作废，角标卡 0。
        older.resolve({ attention_count: 2 });
        await pendingOlder;
        expect(getSummaryAttentionBadge()).toBe(2);
    });

    it('号已不是最新时放弃是 no-op：不得回退到更旧的号', () => {
        const t1 = beginSummaryAttentionRead();
        const t2 = beginSummaryAttentionRead();
        beginSummaryAttentionRead();                          // t3 = 最新

        abandonSummaryAttentionRead(t2);                      // 2 !== 3 → no-op

        commitSummaryAttentionBadge(t1, 9);                   // 1 !== 3 → 丢弃
        expect(getSummaryAttentionBadge()).toBe(0);
    });

    it('连续放弃两次只回退一次（幂等由票号相等守护）', () => {
        const t1 = beginSummaryAttentionRead();
        const t2 = beginSummaryAttentionRead();

        abandonSummaryAttentionRead(t2);                      // issueSeq 2 → 1
        abandonSummaryAttentionRead(t2);                      // 2 !== 1 → no-op

        commitSummaryAttentionBadge(t1, 4);                   // 1 === 1 → 落盘
        expect(getSummaryAttentionBadge()).toBe(4);
    });
});

// ═══ 广播的排序（跨标签页） ═══
//
// 🔴 回归组。此前 module.tsx 的 onRemoteCount 直接 setSummaryAttentionBadge，
// 完全绕开号段，是 last-write-wins。可达交错：
//   1. leader 的轮询发出（不带 fresh，可能命中服务端 5s 缓存）；
//   2. 跟随者标签页上用户做了动作（已读/提交），本地 fresh=1 读取发出、先返回、
//      按票号 commit 了新值；
//   3. leader 的响应此时才到达并广播旧值 → 跟随者无条件写入，把刚 commit 的
//      新值盖回旧值。
// 观感就是「明明点完了红点还挂着」——恰好是本 PR 用 fresh=1 刻意规避的那件事。
//
// 号段解决不了它：广播来自另一个标签页，它的票号属于那边的号段，两个号段之间
// 没有任何可比性。所以引入一个跨标签页可比的刻度——样本时刻（同源标签页共用
// 系统时钟），广播与本地写入进同一个排序域。
describe('summaryAttentionBadge — 广播排序', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        WKApp.shared.currentSpaceId = 'space-123';
        WKApp.loginInfo.uid = 'test-uid';
        vi.spyOn(WKApp.loginInfo, 'isLogined').mockReturnValue(true);
        vi.spyOn(WKApp.menus, 'refresh').mockImplementation(() => {});
        setSummaryAttentionBadge(0);
        resetSummaryAttentionOrdering();
        vi.mocked(WKApp.menus.refresh).mockClear();
    });

    it('样本时刻折算：不带 fresh 的读按最坏情况往前推一个缓存 TTL', () => {
        // 不带 fresh 的读可能命中服务端 5s 缓存，那条缓存最早可能是 5 秒前建的，
        // 所以它代表的状态时刻要按最坏情况算。带 fresh 的读绕过缓存，发出即代表。
        expect(attentionSampleAt(1_000_000, true)).toBe(1_000_000);
        expect(attentionSampleAt(1_000_000, false)).toBe(1_000_000 - ATTENTION_CACHE_TTL_MS);
    });

    it('本地没有在飞读取、且广播更新时，广播落盘', () => {
        expect(acceptRemoteAttentionCount(4, 2_000)).toBe(true);
        expect(getSummaryAttentionBadge()).toBe(4);
    });

    it('🔴 leader 迟到的旧广播不得覆盖本地刚 commit 的新值', () => {
        // 1) leader 的轮询在 t=1000 发出，不带 fresh → 样本时刻折算成 1000-5000。
        const leaderSampleAt = attentionSampleAt(1_000, false);

        // 2) 跟随者上用户做了动作，本地 fresh 读在 t=2000 发出并先返回、落盘。
        const ticket = beginSummaryAttentionRead();
        commitSummaryAttentionBadge(ticket, 0, attentionSampleAt(2_000, true));
        expect(getSummaryAttentionBadge()).toBe(0);

        // 3) leader 的响应此刻才到达并广播旧值。
        expect(acceptRemoteAttentionCount(3, leaderSampleAt)).toBe(false);
        expect(getSummaryAttentionBadge()).toBe(0);   // 旧实现这里会变回 3
    });

    it('🔴 缓存窗口内的广播被折算后拒收（5s 缓存把窗口拉得更宽）', () => {
        // 用户动作在 t=10000 落盘；leader 的非 fresh 轮询在 t=12000 发出，
        // 看似更晚，但它可能吃到 t=7000 建的缓存 → 折算后是 7000，排不过 10000。
        const ticket = beginSummaryAttentionRead();
        commitSummaryAttentionBadge(ticket, 0, attentionSampleAt(10_000, true));

        expect(acceptRemoteAttentionCount(5, attentionSampleAt(12_000, false))).toBe(false);
        expect(getSummaryAttentionBadge()).toBe(0);
    });

    it('在飞读取不比广播旧时不收广播（本地那份马上就会带回更新的值）', () => {
        const now = Date.now();
        // 用户动作的 fresh 读在飞：样本时刻就是发出时刻。
        beginSummaryAttentionRead(attentionSampleAt(now, true));
        expect(hasInFlightAttentionRead()).toBe(true);

        // 广播的样本时刻更旧 → 本地在飞那份更权威，收它只是徒增一次闪烁。
        expect(acceptRemoteAttentionCount(9, now - 1)).toBe(false);
        expect(getSummaryAttentionBadge()).toBe(0);
    });

    it('不传样本时刻的调用方按「现在」记，行为与加闸前一致（在飞即拦）', () => {
        beginSummaryAttentionRead();
        expect(hasInFlightAttentionRead()).toBe(true);
        expect(acceptRemoteAttentionCount(9, Date.now() - 1_000)).toBe(false);
        expect(getSummaryAttentionBadge()).toBe(0);
    });

    it('在飞读取结束后广播恢复接收（commit 与 abandon 都要销账）', async () => {
        const t1 = beginSummaryAttentionRead();
        commitSummaryAttentionBadge(t1, 1, 1_000);
        expect(hasInFlightAttentionRead()).toBe(false);

        const t2 = beginSummaryAttentionRead();
        abandonSummaryAttentionRead(t2);
        expect(hasInFlightAttentionRead()).toBe(false);

        // 销账漏掉任何一条，广播就会被永久堵死——一个不会报错、只会「红点不准」
        // 的静默故障。
        expect(acceptRemoteAttentionCount(6, 2_000)).toBe(true);
        expect(getSummaryAttentionBadge()).toBe(6);
    });

    it('被更新读取顶掉的 commit 同样销账，不会把广播堵死', () => {
        const older = beginSummaryAttentionRead();
        const newer = beginSummaryAttentionRead();

        commitSummaryAttentionBadge(newer, 2, 2_000);
        commitSummaryAttentionBadge(older, 8, 1_000);     // 号不是最新 → 丢弃

        expect(hasInFlightAttentionRead()).toBe(false);
        expect(getSummaryAttentionBadge()).toBe(2);
    });

    it('相同样本时刻的广播不重复写（同一份样本广播两次也无害）', () => {
        expect(acceptRemoteAttentionCount(4, 5_000)).toBe(true);
        expect(acceptRemoteAttentionCount(7, 5_000)).toBe(false);
        expect(getSummaryAttentionBadge()).toBe(4);
    });

    it('畸形广播（非有限数）被拒，不写坏红点', () => {
        setSummaryAttentionBadge(3);
        expect(acceptRemoteAttentionCount(Number.NaN, 9_000)).toBe(false);
        expect(acceptRemoteAttentionCount(2, Number.NaN)).toBe(false);
        expect(getSummaryAttentionBadge()).toBe(3);
    });

    it('广播落盘后会推进本地水位：更旧的广播随后到达也进不来', () => {
        expect(acceptRemoteAttentionCount(4, 5_000)).toBe(true);
        expect(acceptRemoteAttentionCount(9, 4_000)).toBe(false);
        expect(getSummaryAttentionBadge()).toBe(4);
    });
});

// 每一次成功的本地读取都要广播出去，不只是 leader 的轮询：一个标签页里用户
// 点掉红点，其它标签页本来就该跟着灭，而不是等 leader 下一拍（最长 60s）。
describe('summaryAttentionBadge — 读取路径广播钩子', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        WKApp.shared.currentSpaceId = 'space-123';
        WKApp.loginInfo.uid = 'test-uid';
        vi.spyOn(WKApp.loginInfo, 'isLogined').mockReturnValue(true);
        vi.spyOn(WKApp.menus, 'refresh').mockImplementation(() => {});
        setSummaryAttentionBadge(0);
        resetSummaryAttentionOrdering();
        vi.mocked(WKApp.menus.refresh).mockClear();
    });

    it('成功读取后广播计数与样本时刻', async () => {
        const publisher = vi.fn();
        setSummaryAttentionPublisher(publisher);
        vi.mocked(api.fetchSummaryAttentionCounts).mockResolvedValueOnce({ attention_count: 3 } as any);

        const sample = await readSummaryAttentionCount({ fresh: true });

        expect(sample).toEqual({ count: 3, sampleAt: expect.any(Number) });
        expect(publisher).toHaveBeenCalledWith(3, sample!.sampleAt);
    });

    it('用户动作的读带 fresh，样本时刻不折算', async () => {
        const publisher = vi.fn();
        setSummaryAttentionPublisher(publisher);
        vi.mocked(api.fetchSummaryAttentionCounts).mockResolvedValueOnce({ attention_count: 1 } as any);

        const before = Date.now();
        const sample = await readSummaryAttentionCount({ fresh: true });

        // 绕过了缓存，所以样本时刻就是发出时刻，不往前推 TTL。
        expect(sample!.sampleAt).toBeGreaterThanOrEqual(before);
    });

    it('后台轮询的读不带 fresh，样本时刻往前推一个 TTL', async () => {
        vi.mocked(api.fetchSummaryAttentionCounts).mockResolvedValueOnce({ attention_count: 1 } as any);

        const before = Date.now();
        const sample = await readSummaryAttentionCount();

        expect(sample!.sampleAt).toBeLessThanOrEqual(before - ATTENTION_CACHE_TTL_MS);
    });

    it('失败、跨 Space 早退、未登录都不广播', async () => {
        const publisher = vi.fn();
        setSummaryAttentionPublisher(publisher);

        vi.mocked(api.fetchSummaryAttentionCounts).mockRejectedValueOnce(new Error('network'));
        await expect(readSummaryAttentionCount()).rejects.toBeTruthy();
        expect(publisher).not.toHaveBeenCalled();

        vi.mocked(api.fetchSummaryAttentionCounts).mockImplementationOnce(async () => {
            WKApp.shared.currentSpaceId = 'space-b';
            return { attention_count: 5 } as any;
        });
        await expect(readSummaryAttentionCount()).resolves.toBeNull();
        expect(publisher).not.toHaveBeenCalled();

        WKApp.shared.currentSpaceId = 'space-123';
        vi.mocked(WKApp.loginInfo.isLogined).mockReturnValue(false);
        await expect(readSummaryAttentionCount()).resolves.toBeNull();
        expect(publisher).not.toHaveBeenCalled();
    });

    it('没有接钩子时读取照常工作（拆线后不得抛异常）', async () => {
        setSummaryAttentionPublisher(null);
        vi.mocked(api.fetchSummaryAttentionCounts).mockResolvedValueOnce({ attention_count: 2 } as any);

        await expect(readSummaryAttentionCount()).resolves.toMatchObject({ count: 2 });
    });
});

// 本地写入的样本时刻闸。票号只排【发出顺序】，排不了【数据新鲜度】——服务端
// 那 5s 缓存让这两件事分了家：不带 fresh 的轮询发得更晚（票号更新），取回的
// 却可能是一个 TTL 之前建的缓存。广播那侧早就按样本时刻排了序，本地这侧曾经
// 没有，于是同一条交错换个入口就能把用户刚点掉的红点重新点亮。
describe('summaryAttentionBadge — 本地 commit 的样本时刻闸', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        WKApp.shared.currentSpaceId = 'space-123';
        WKApp.loginInfo.uid = 'test-uid';
        vi.spyOn(WKApp.loginInfo, 'isLogined').mockReturnValue(true);
        vi.spyOn(WKApp.menus, 'refresh').mockImplementation(() => {});
        resetSummaryAttentionOrdering();
        setSummaryAttentionBadge(0);
        vi.mocked(WKApp.menus.refresh).mockClear();
    });

    // 评审点名的交错，逐拍钉死：
    //   T      用户标读 → fresh 读(ticket N) → 落盘 V-1
    //   T+3s   轮询 → 非 fresh 读(ticket N+1) → 命中 ≤5s 前的缓存 → 拿回旧值 V
    //   T+3.2s commit(N+1)：票号最新 → 旧实现让 V 盖掉 V-1
    it('🔴 非 fresh 轮询的缓存旧值不得覆盖刚落盘的 fresh 新值', () => {
        setSummaryAttentionBadge(3);

        // T = 10000：用户标读后的 fresh 读落盘 2。
        const userTicket = beginSummaryAttentionRead();
        commitSummaryAttentionBadge(userTicket, 2, attentionSampleAt(10_000, true));
        expect(getSummaryAttentionBadge()).toBe(2);

        // T+3000：轮询的非 fresh 读【发出更晚、票号更新】，但它可能吃到
        // 8000 时刻建的缓存 → 折算后样本时刻 8000，比 10000 旧。
        const pollTicket = beginSummaryAttentionRead();
        commitSummaryAttentionBadge(pollTicket, 3, attentionSampleAt(13_000, false));

        expect(getSummaryAttentionBadge()).toBe(2);   // 旧实现这里会变回 3
    });

    it('缓存窗口过去之后，非 fresh 轮询照常落盘（闸不是永久拦截）', () => {
        const userTicket = beginSummaryAttentionRead();
        commitSummaryAttentionBadge(userTicket, 2, attentionSampleAt(10_000, true));

        // T+15000（一个基础轮询间隔）：折算后 10000 + 5000，已越过水位。
        const pollTicket = beginSummaryAttentionRead();
        commitSummaryAttentionBadge(pollTicket, 7, attentionSampleAt(20_000, false));

        expect(getSummaryAttentionBadge()).toBe(7);
    });

    // 严格小于（而不是 <=）的理由：样本时刻相同说明两份数据一样新，
    // 此时该由票号定胜负，本地后发者理应写得进去。
    it('样本时刻相同时按票号定胜负，后发者写得进去', () => {
        const first = beginSummaryAttentionRead();
        commitSummaryAttentionBadge(first, 1, 10_000);
        expect(getSummaryAttentionBadge()).toBe(1);

        const second = beginSummaryAttentionRead();
        commitSummaryAttentionBadge(second, 4, 10_000);
        expect(getSummaryAttentionBadge()).toBe(4);
    });

    it('被闸拦下的 commit 仍然销账，广播不会被堵死', () => {
        const userTicket = beginSummaryAttentionRead();
        commitSummaryAttentionBadge(userTicket, 2, attentionSampleAt(10_000, true));

        const pollTicket = beginSummaryAttentionRead();
        commitSummaryAttentionBadge(pollTicket, 9, attentionSampleAt(11_000, false));

        // 销账写在票号判定与样本闸【之前】，两条早退路径都不能漏。
        expect(hasInFlightAttentionRead()).toBe(false);
        expect(acceptRemoteAttentionCount(6, 20_000)).toBe(true);
        expect(getSummaryAttentionBadge()).toBe(6);
    });

    it('被闸拦下也不推进水位：更旧的样本仍然进不来，更新的仍然进得来', () => {
        const t1 = beginSummaryAttentionRead();
        commitSummaryAttentionBadge(t1, 2, 10_000);

        const t2 = beginSummaryAttentionRead();
        commitSummaryAttentionBadge(t2, 9, 8_000);        // 被拦
        const t3 = beginSummaryAttentionRead();
        commitSummaryAttentionBadge(t3, 5, 9_000);        // 仍旧于 10000 → 也被拦
        expect(getSummaryAttentionBadge()).toBe(2);

        const t4 = beginSummaryAttentionRead();
        commitSummaryAttentionBadge(t4, 8, 11_000);
        expect(getSummaryAttentionBadge()).toBe(8);
    });

    // 没有折算信息的调用方（SummaryListPage.loadData）按“现在”记，
    // 行为与加闸之前一致：列表响应刚到，之后到达的旧样本理应排不过它。
    it('不带 sampleAt 的调用方按“现在”记，行为不变', () => {
        const listTicket = beginSummaryAttentionRead();
        commitSummaryAttentionBadge(listTicket, 4);
        expect(getSummaryAttentionBadge()).toBe(4);

        expect(acceptRemoteAttentionCount(9, 1_000)).toBe(false);
        expect(getSummaryAttentionBadge()).toBe(4);
    });

    // 端到端走一遍真实读取路径，确认闸装在 readSummaryAttentionCount 的落盘端。
    it('端到端：轮询读（非 fresh）不覆盖紧随其后的用户读（fresh）结果', async () => {
        vi.mocked(api.fetchSummaryAttentionCounts).mockResolvedValueOnce({ attention_count: 0 } as any);
        await readSummaryAttentionCount({ fresh: true });
        expect(getSummaryAttentionBadge()).toBe(0);

        // 轮询紧接着读到一份缓存里的旧值（3）。它折算后落在 fresh 读之前。
        vi.mocked(api.fetchSummaryAttentionCounts).mockResolvedValueOnce({ attention_count: 3 } as any);
        const sample = await readSummaryAttentionCount();

        // 值仍要返回给轮询做退避判据（它拿到的确实是服务端此刻给的数），
        // 但红点不能被它写回去。
        expect(sample).toMatchObject({ count: 3 });
        expect(getSummaryAttentionBadge()).toBe(0);
    });
});

// E2E mock 就绪门。MSW worker 是异步启动的，在它接管之前发出的请求会穿透到
// Vite proxy → mock 后端没在监听 → ECONNREFUSED → 502 → console error，而
// e2e gate 对 proxy error 是硬阻断。这条读取尤其需要这道门：它挂在无人值守的
// 兜底轮询上，冷启动那一刻正好撞在 worker 启动窗口里。
// 形态沿用 PR #1608 给 summaryMenuBadge 加的守卫（那个文件已被删除，守卫随
// 读取路径迁到这里）。
describe('summaryAttentionBadge — E2E mock 就绪门', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        WKApp.shared.currentSpaceId = 'space-123';
        WKApp.loginInfo.uid = 'test-uid';
        vi.spyOn(WKApp.loginInfo, 'isLogined').mockReturnValue(true);
        vi.spyOn(WKApp.menus, 'refresh').mockImplementation(() => {});
        resetSummaryAttentionOrdering();
        setSummaryAttentionBadge(0);
        vi.mocked(WKApp.menus.refresh).mockClear();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it('E2E mock 未就绪时不发请求，且返回 null（不记账、不领号）', async () => {
        vi.stubEnv('VITE_E2E_MOCK', '1');
        vi.stubGlobal('window', {});

        await expect(readSummaryAttentionCount()).resolves.toBeNull();

        expect(api.fetchSummaryAttentionCounts).not.toHaveBeenCalled();
        // 没领号就没有要还的号：号段不受扰动，在飞计数保持干净。
        expect(hasInFlightAttentionRead()).toBe(false);
    });

    it('E2E mock 就绪后走正常请求路径', async () => {
        vi.stubEnv('VITE_E2E_MOCK', '1');
        vi.stubGlobal('window', { __MSW_READY__: true });
        vi.mocked(api.fetchSummaryAttentionCounts).mockResolvedValueOnce({ attention_count: 2 } as any);

        await expect(readSummaryAttentionCount({ fresh: true })).resolves.toMatchObject({ count: 2 });
        expect(getSummaryAttentionBadge()).toBe(2);
    });

    it('非 E2E mock 构建下这道门恒开（生产路径不受影响）', async () => {
        vi.stubEnv('VITE_E2E_MOCK', '');
        vi.stubGlobal('window', {});
        vi.mocked(api.fetchSummaryAttentionCounts).mockResolvedValueOnce({ attention_count: 1 } as any);

        await expect(readSummaryAttentionCount({ fresh: true })).resolves.toMatchObject({ count: 1 });
        expect(api.fetchSummaryAttentionCounts).toHaveBeenCalledTimes(1);
    });
});

// ═══ 广播样本时刻的范围校验（P2 CR） ═══
//
// `sampleAt` 是【外部输入】：它由另一个标签页写进 BroadcastChannel 载荷，而本地
// 水位 `lastCommittedSampleAt` 单调不减。于是一条越界的未来时刻不是「丢一次广播」
// 而是「把红点钉死到本会话结束」——此后所有广播与本地写入都排不进去。
//
// 越界不需要恶意：跨版本标签页写坏字段、系统时钟被 NTP 往前跳、虚拟机挂起恢复，
// 都会产出一个远在未来的时刻。校验加在最外层，越界即丢、【不】动水位。
describe('summaryAttentionBadge — 广播样本时刻的范围校验（P2 CR）', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        WKApp.shared.currentSpaceId = 'space-123';
        WKApp.loginInfo.uid = 'test-uid';
        vi.spyOn(WKApp.loginInfo, 'isLogined').mockReturnValue(true);
        vi.spyOn(WKApp.menus, 'refresh').mockImplementation(() => {});
        setSummaryAttentionBadge(0);
        resetSummaryAttentionOrdering();
        vi.mocked(WKApp.menus.refresh).mockClear();
    });

    it('未来样本时刻的广播被拒，且【不】污染水位（合法广播随后照常落盘）', () => {
        const now = Date.now();

        expect(acceptRemoteAttentionCount(7, now + 30 * 60_000)).toBe(false);
        expect(getSummaryAttentionBadge()).toBe(0);

        // 后半段才是这条用例真正的目的：水位单调不减，一旦被未来时刻钉住，本会话
        // 余下时间的每一条广播都排不进去，红点从此永久停摆且无任何报错。
        expect(acceptRemoteAttentionCount(7, now - 1_000)).toBe(true);
        expect(getSummaryAttentionBadge()).toBe(7);
    });

    it('Number.MAX_SAFE_INTEGER 这类明显越界的时刻被拒（有限数不等于合理）', () => {
        // `Number.isFinite` 对它是 true，所以只靠原来那道有限性校验挡不住。
        expect(acceptRemoteAttentionCount(9, Number.MAX_SAFE_INTEGER)).toBe(false);
        expect(getSummaryAttentionBadge()).toBe(0);

        expect(acceptRemoteAttentionCount(3, Date.now() - 1_000)).toBe(true);
        expect(getSummaryAttentionBadge()).toBe(3);
    });

    it('容差之内的轻微超前仍然接受（取样与广播之间本就有毫秒级间隔）', () => {
        // 留 50ms 余量，抵消本用例自身两次 Date.now() 之间的漂移。
        expect(
            acceptRemoteAttentionCount(2, Date.now() + REMOTE_SAMPLE_FUTURE_TOLERANCE_MS - 50),
        ).toBe(true);
        expect(getSummaryAttentionBadge()).toBe(2);
    });

    it('容差明显小于缓存 TTL：越界判定不会吃掉正常的折算余量', () => {
        // 折算把非 fresh 读往前推一个 TTL，容差往后放一点点。两者一旦可比，
        // 校验就会开始误伤正常广播。
        expect(REMOTE_SAMPLE_FUTURE_TOLERANCE_MS).toBeLessThan(ATTENTION_CACHE_TTL_MS);
        expect(REMOTE_SAMPLE_FUTURE_TOLERANCE_MS).toBeGreaterThan(0);
    });
});

// ═══ 在飞闸从「有读在飞」收窄到「在飞那份更新」（P2 CR） ═══
//
// 原来的闸是一个计数器：只要本地有读在飞就拒掉全部广播，理由写的是「本地读带
// fresh、更权威」。可轮询那条读【不】带 fresh，它拿回来的可能是 5s 前建的缓存。
// 于是闸的前提在轮询这条路径上不成立，而后果不是丢一次广播：在飞那份陈旧值随后
// 会 commit 上去，把跟随者刚广播的新值盖回旧值。
//
// 修法不是按 fresh 分支（那只是把前提近似一下），而是让闸自己去比样本时刻：
// 在飞计数换成 Map<票号, 样本时刻>，只有当在飞的那份【确实不比广播旧】时才拦。
describe('summaryAttentionBadge — 在飞闸按样本时刻收窄（P2 CR）', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        WKApp.shared.currentSpaceId = 'space-123';
        WKApp.loginInfo.uid = 'test-uid';
        vi.spyOn(WKApp.loginInfo, 'isLogined').mockReturnValue(true);
        vi.spyOn(WKApp.menus, 'refresh').mockImplementation(() => {});
        setSummaryAttentionBadge(0);
        resetSummaryAttentionOrdering();
        vi.mocked(WKApp.menus.refresh).mockClear();
    });

    it('🟡 在飞的非 fresh 轮询不再拦掉更新的广播（旧实现拦掉后还会盖回旧值）', () => {
        const now = Date.now();
        setSummaryAttentionBadge(3);

        // leader 的轮询发出，不带 fresh → 样本时刻按最坏情况折算到一个 TTL 之前。
        const pollSampleAt = attentionSampleAt(now, false);
        const pollTicket = beginSummaryAttentionRead(pollSampleAt);
        expect(hasInFlightAttentionRead()).toBe(true);

        // 跟随者上用户点掉了红点，它的 fresh 读先回来并广播 0。
        expect(acceptRemoteAttentionCount(0, now - 1)).toBe(true);
        expect(getSummaryAttentionBadge()).toBe(0);

        // 轮询的陈旧响应此刻才到，被样本时刻闸挡住 —— 红点保持灭。
        commitSummaryAttentionBadge(pollTicket, 3, pollSampleAt);
        expect(getSummaryAttentionBadge()).toBe(0);
        expect(hasInFlightAttentionRead()).toBe(false);
    });

    it('闸只看最新的那份在飞读取：多个读在飞时按其中最新的样本时刻判', () => {
        const now = Date.now();
        beginSummaryAttentionRead(attentionSampleAt(now, false));   // 陈旧的轮询
        beginSummaryAttentionRead(attentionSampleAt(now, true));    // 用户动作的 fresh 读

        // 有一份 fresh 读在飞且不比广播旧 → 该拦。若实现取的是「最旧那份」，
        // 这条会被放进来，随后又被那份 fresh 的结果覆盖，白闪一次。
        expect(acceptRemoteAttentionCount(9, now - 1)).toBe(false);
        expect(getSummaryAttentionBadge()).toBe(0);
    });

    it('销账仍然是幂等的：commit 与 abandon 都摘掉在飞项，广播不会被堵死', () => {
        const t1 = beginSummaryAttentionRead(1_000);
        commitSummaryAttentionBadge(t1, 1, 1_000);
        commitSummaryAttentionBadge(t1, 1, 1_000);           // 重复 settle
        expect(hasInFlightAttentionRead()).toBe(false);

        const t2 = beginSummaryAttentionRead(2_000);
        abandonSummaryAttentionRead(t2);
        abandonSummaryAttentionRead(t2);
        expect(hasInFlightAttentionRead()).toBe(false);

        expect(acceptRemoteAttentionCount(6, 3_000)).toBe(true);
        expect(getSummaryAttentionBadge()).toBe(6);
    });
});

// ═══ 已放弃后缀的折叠（票号活性，P2 CR） ═══
//
// 原来的还号是 `if (ticket === issueSeq) issueSeq--`：只有最新号失败才回退。乱序
// 失败因此有死角 —— A/B/C 三个读在飞，B 先失败（不是最新号，不回退），C 随后失败
// （回退到 B），号段停在 B 上，而 B 已经不在飞了。A 带着正确值回来时被判过期丢掉。
// 下一次读取（≤60s）会自愈，但这 60s 内红点就是不准的。
//
// 修法是折叠「连续的已放弃后缀」：还号时记下被放弃的号，然后从最新号往下一直
// 退过所有已放弃的号。
describe('summaryAttentionBadge — 已放弃后缀的折叠（票号活性，P2 CR）', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        WKApp.shared.currentSpaceId = 'space-123';
        WKApp.loginInfo.uid = 'test-uid';
        vi.spyOn(WKApp.loginInfo, 'isLogined').mockReturnValue(true);
        vi.spyOn(WKApp.menus, 'refresh').mockImplementation(() => {});
        setSummaryAttentionBadge(0);
        resetSummaryAttentionOrdering();
        vi.mocked(WKApp.menus.refresh).mockClear();
    });

    it('🟡 乱序放弃（先 B 后 C）后 A 照常落盘，不必等下一次读取自愈', () => {
        const a = beginSummaryAttentionRead(1_000);
        const b = beginSummaryAttentionRead(2_000);
        const c = beginSummaryAttentionRead(3_000);

        abandonSummaryAttentionRead(b);   // 不是最新号，此刻不能回退（C 还在飞）
        abandonSummaryAttentionRead(c);   // 连同已放弃的 B 一起折叠，号段回到 A

        commitSummaryAttentionBadge(a, 5, 1_000);
        expect(getSummaryAttentionBadge()).toBe(5);   // 修复前是 0：A 的号被判过期
    });

    it('顺序放弃（先 C 后 B）同样收敛到 A', () => {
        const a = beginSummaryAttentionRead(1_000);
        const b = beginSummaryAttentionRead(2_000);
        const c = beginSummaryAttentionRead(3_000);

        abandonSummaryAttentionRead(c);
        abandonSummaryAttentionRead(b);

        commitSummaryAttentionBadge(a, 5, 1_000);
        expect(getSummaryAttentionBadge()).toBe(5);
    });

    it('折叠只吃已放弃的后缀：落在中间的在飞号仍然是最新号', () => {
        const a = beginSummaryAttentionRead(1_000);
        const b = beginSummaryAttentionRead(2_000);
        const c = beginSummaryAttentionRead(3_000);

        abandonSummaryAttentionRead(c);        // 号段回到 B，B 仍在飞

        commitSummaryAttentionBadge(a, 9, 1_000);
        expect(getSummaryAttentionBadge()).toBe(0);   // A 此刻确实过期，该丢

        commitSummaryAttentionBadge(b, 6, 2_000);
        expect(getSummaryAttentionBadge()).toBe(6);
    });

    it('重复放弃同一个号不留残渣：残渣会在号段回升后把在飞的号折下去', () => {
        // 第一代 A/B/C。
        const a = beginSummaryAttentionRead(1_000);
        const b = beginSummaryAttentionRead(2_000);
        const c = beginSummaryAttentionRead(3_000);

        abandonSummaryAttentionRead(c);   // 号段回到 B
        abandonSummaryAttentionRead(c);   // 重试路径 / 双重 catch：必须是彻底的 no-op
        abandonSummaryAttentionRead(b);   // 号段回到 A

        // 第二代：号被回收后重新发出去，于是又出现 2 和 3。
        const e = beginSummaryAttentionRead(4_000);
        const f = beginSummaryAttentionRead(5_000);

        // e 不是最新号（f 才是），折叠不该动 f。
        abandonSummaryAttentionRead(e);

        // 少了幂等守护时，第一代那次重复放弃会把「3 已放弃」留在集合里；此处的
        // 折叠链会一路走过它，把号段折到 f 之下 —— f 的正确取值随后被判过期丢掉，
        // 表现只有「红点不准」，不报错。
        commitSummaryAttentionBadge(f, 6, 5_000);
        expect(getSummaryAttentionBadge()).toBe(6);

        // 顺带确认第一代那个仍在飞的 A 不会因为号段被踩低而混进来。
        commitSummaryAttentionBadge(a, 9, 1_000);
        expect(getSummaryAttentionBadge()).toBe(6);
    });
});
