/**
 * summaryAttentionBadge test — 侧边栏「智能总结」菜单待关注红点 (#1359)。
 *
 * 独立成文件的原因与 chatSummaryActions 相同：module.tsx 引入
 * react-dom/client，单测不便直接 import。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
        // 重置模块级计数
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

    it('本地有读取在飞时一律不收广播（本地读取更权威）', () => {
        beginSummaryAttentionRead();
        expect(hasInFlightAttentionRead()).toBe(true);

        // 本地在飞的那个读带 fresh、反映本标签页用户刚做完的动作，
        // 它回来时会写正确值；此刻收广播只是徒增一次闪烁。
        expect(acceptRemoteAttentionCount(9, Number.MAX_SAFE_INTEGER)).toBe(false);
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
