/**
 * summaryAttentionTicket.poll test —— 【定时器作为号段第三个并发写者】的 ticket liveness。
 *
 * 号段（beginSummaryAttentionRead / commitSummaryAttentionBadge /
 * abandonSummaryAttentionRead）原本只有两个写者：SummaryListPage.loadData 与
 * 用户动作触发的探测。兜底轮询（utils/summaryAttentionPoll.ts）是第三个，而且
 * 性质与前两个不同：
 *
 *   - 它是唯一一个在【没有任何用户动作】时也会开火的写者。前两个写者的交错都
 *     需要用户配合（打开列表、点开详情），轮询不需要——用户坐着不动，它照样在
 *     发请求。于是「轮询先发、用户随后读、轮询的旧响应最后到」这类交错从
 *     「边界情况」变成了【日常路径】。
 *   - 它自带失败退避与可见性停表，所以它的读取被中途放弃的概率比另外两个高。
 *     每一条放弃路径都必须还号，否则号段停在一个再也不会提交的号上，一个发出
 *     更早、仍在飞、携带正确值的读取会被一并作废，红点卡在陈值。
 *
 * 已有的 7 个 liveness 用例覆盖的是前两个写者。这里补的是「定时器参与」的那些。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return { ...actual };
});
vi.mock('../../api/summaryApi');

import * as api from '../../api/summaryApi';
import { WKApp } from '@octo/base';
import {
    getSummaryAttentionBadge,
    setSummaryAttentionBadge,
    readSummaryAttentionCount,
    refreshSummaryAttentionBadge,
    beginSummaryAttentionRead,
    commitSummaryAttentionBadge,
} from '../summaryAttentionBadge';
import { createAttentionPoll } from '../summaryAttentionPoll';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/** 手动时间轴（与 summaryAttentionPoll.test 同构），tick 由测试自己敲。 */
function createHarness() {
    const scheduled: Array<{ handle: number; handler: () => void; timeout: number }> = [];
    let nextHandle = 1;
    return {
        scheduled,
        deps: {
            isVisible: () => true,
            setTimeoutFn: (handler: () => void, timeout: number) => {
                const handle = nextHandle++;
                scheduled.push({ handle, handler, timeout });
                return handle;
            },
            clearTimeoutFn: (handle: unknown) => {
                const idx = scheduled.findIndex((s) => s.handle === handle);
                if (idx >= 0) scheduled.splice(idx, 1);
            },
            random: () => 0.5,
        },
        /** 敲响最早的一拍，但【不】等它内部的取数完成（用来制造在飞状态）。 */
        fireWithoutSettling(): void {
            const next = scheduled.shift();
            if (!next) throw new Error('没有排期中的 tick');
            next.handler();
        },
    };
}

async function flush(times = 4): Promise<void> {
    for (let i = 0; i < times; i += 1) await Promise.resolve();
}

/** 与 module.tsx 的接线保持一致：轮询的 fetchCount 走 readSummaryAttentionCount。 */
function makePoll(harness: ReturnType<typeof createHarness>, onCount?: (c: number) => void) {
    return createAttentionPoll({
        ...harness.deps,
        fetchCount: async () => {
            // readSummaryAttentionCount 现在返回 { count, sampleAt }：sampleAt 是
            // 广播排序用的样本时刻，调度器只关心 count。与 module.tsx 接线一致。
            const sample = await readSummaryAttentionCount();
            return sample?.count ?? getSummaryAttentionBadge();
        },
        onCount,
    });
}

describe('ticket liveness —— 定时轮询作为第三个并发写者', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        WKApp.shared.currentSpaceId = 'space-123';
        WKApp.loginInfo.uid = 'test-uid';
        vi.spyOn(WKApp.loginInfo, 'isLogined').mockReturnValue(true);
        vi.spyOn(WKApp.menus, 'refresh').mockImplementation(() => {});
        setSummaryAttentionBadge(0);
        vi.mocked(WKApp.menus.refresh).mockClear();
    });

    // 核心场景：轮询先发（拿的是用户动作【之前】的快照），用户随后打开列表并
    // 读到新值落盘，轮询的旧响应最后才到。按到达顺序写就会把新值盖成陈值——
    // 而且这条路径不需要用户做任何配合去「制造」，定时器自己就会撞上。
    it('轮询先发出、用户读随后落盘，迟到的轮询响应不得覆盖新值', async () => {
        const pollResponse = deferred<any>();
        vi.mocked(api.fetchSummaryAttentionCounts).mockReturnValueOnce(pollResponse.promise);

        const h = createHarness();
        const poll = makePoll(h);
        poll.start();
        h.fireWithoutSettling();                          // 轮询领号在前
        await flush();

        // 用户打开列表 / 标记已读：领号在后，先返回。
        const userTicket = beginSummaryAttentionRead();
        commitSummaryAttentionBadge(userTicket, 2);
        expect(getSummaryAttentionBadge()).toBe(2);

        // 轮询的旧快照最后到达：它的号已不是最新，必须被丢弃。
        pollResponse.resolve({ attention_count: 9 });
        await flush();

        expect(getSummaryAttentionBadge()).toBe(2);
    });

    // 反向：用户读先发出仍在飞，轮询随后失败。轮询失败必须【还号】，
    // 否则号段停在轮询那个再也不会提交的号上，用户那份正确值被一并作废。
    it('轮询在用户读之后失败：号还回去，用户在飞的正确值仍能落盘', async () => {
        const userResponse = deferred<any>();
        vi.mocked(api.fetchSummaryAttentionCounts)
            .mockReturnValueOnce(userResponse.promise)                       // 用户读，先发
            .mockRejectedValueOnce(new Error('network'));                    // 轮询，后发且失败

        const pendingUser = refreshSummaryAttentionBadge();

        const h = createHarness();
        const poll = makePoll(h);
        poll.start();
        h.fireWithoutSettling();
        await flush();

        // 失败静默，红点保持旧值。
        expect(getSummaryAttentionBadge()).toBe(0);

        // 关键：轮询失败已把号还回，用户那份正确值落盘。
        // 不还号的实现里它会被作废，红点永远卡 0。
        userResponse.resolve({ attention_count: 4 });
        await pendingUser;
        expect(getSummaryAttentionBadge()).toBe(4);
    });

    // 轮询飞行途中用户切了 Space：这次读取属于旧 Space，必须早退 + 还号，
    // 且绝不能把旧 Space 的数字写进新 Space 的红点。
    it('轮询飞行中切 Space：号还回去，且不写入跨 Space 的陈值', async () => {
        const pollResponse = deferred<any>();
        vi.mocked(api.fetchSummaryAttentionCounts).mockReturnValueOnce(pollResponse.promise);

        WKApp.shared.currentSpaceId = 'space-a';
        const h = createHarness();
        const poll = makePoll(h);
        poll.start();
        h.fireWithoutSettling();                          // 为 space-a 发出
        await flush();

        // 用户切到 space-b，并且 space-b 的读取先落盘。
        WKApp.shared.currentSpaceId = 'space-b';
        const spaceBTicket = beginSummaryAttentionRead();
        commitSummaryAttentionBadge(spaceBTicket, 1);
        expect(getSummaryAttentionBadge()).toBe(1);

        // space-a 的轮询响应到达：既被 Space 检查拦下，也被号段拦下。
        pollResponse.resolve({ attention_count: 8 });
        await flush();

        expect(getSummaryAttentionBadge()).toBe(1);
    });

    it('轮询跨 Space 早退后还号：更早发出的读取仍能把正确值落盘', async () => {
        const older = deferred<any>();
        const pollResponse = deferred<any>();
        vi.mocked(api.fetchSummaryAttentionCounts)
            .mockReturnValueOnce(older.promise)                              // 更早的用户读
            .mockReturnValueOnce(pollResponse.promise);                      // 随后的轮询

        WKApp.shared.currentSpaceId = 'space-a';
        const pendingOlder = refreshSummaryAttentionBadge();

        const h = createHarness();
        const poll = makePoll(h);
        poll.start();
        h.fireWithoutSettling();
        await flush();

        // 轮询在飞时用户切走又切回：轮询成了弃子。
        WKApp.shared.currentSpaceId = 'space-b';
        pollResponse.resolve({ attention_count: 7 });
        await flush();
        WKApp.shared.currentSpaceId = 'space-a';

        expect(getSummaryAttentionBadge()).toBe(0);

        // 更早那份属于 space-a 的读取仍然有效：号段已还给它。
        older.resolve({ attention_count: 3 });
        await pendingOlder;
        expect(getSummaryAttentionBadge()).toBe(3);
    });

    // 互斥本应让「两个轮询同时在飞」不可能发生。这里直接对着号段断言它确实成立：
    // 若互斥漏了，两个轮询会各领一个号，其中一个的结果注定被自己人作废。
    it('互斥确实成立：上一拍在飞时再敲一拍不会领第二个号', async () => {
        const first = deferred<any>();
        vi.mocked(api.fetchSummaryAttentionCounts).mockReturnValue(first.promise);

        const h = createHarness();
        const poll = makePoll(h);
        poll.start();

        const tick = h.scheduled[0];
        h.scheduled.shift();
        tick.handler();
        await flush();
        expect(api.fetchSummaryAttentionCounts).toHaveBeenCalledTimes(1);
        expect(poll.isFetching()).toBe(true);

        // 再敲两拍：都该被互斥挡掉，一个新号都不该领。
        tick.handler();
        await flush();
        tick.handler();
        await flush();
        expect(api.fetchSummaryAttentionCounts).toHaveBeenCalledTimes(1);

        // 号段没有被多占：这一刻新领的号能正常落盘。
        first.resolve({ attention_count: 5 });
        await flush();
        expect(getSummaryAttentionBadge()).toBe(5);
        expect(poll.isFetching()).toBe(false);
    });

    it('互斥下 notifyActivity 与在飞轮询不会各领一号互相作废', async () => {
        const inFlight = deferred<any>();
        vi.mocked(api.fetchSummaryAttentionCounts).mockReturnValue(inFlight.promise);

        const h = createHarness();
        const poll = makePoll(h);
        poll.start();
        h.fireWithoutSettling();
        await flush();
        expect(api.fetchSummaryAttentionCounts).toHaveBeenCalledTimes(1);

        // 切回标签页 + 聚焦 + 菜单激活三连击。
        poll.notifyActivity();
        poll.notifyActivity();
        await flush();
        expect(api.fetchSummaryAttentionCounts).toHaveBeenCalledTimes(1);

        inFlight.resolve({ attention_count: 6 });
        await flush();
        expect(getSummaryAttentionBadge()).toBe(6);
    });

    // 停表（标签页转入后台）时在飞的那次请求仍会回来。它不该把红点写坏，
    // 也不该把号段留在一个悬空的位置上。
    it('停表后在飞的轮询响应仍按号段规则处理，不作废后续读取', async () => {
        const inFlight = deferred<any>();
        vi.mocked(api.fetchSummaryAttentionCounts).mockReturnValueOnce(inFlight.promise);

        const h = createHarness();
        const poll = makePoll(h);
        poll.start();
        h.fireWithoutSettling();
        await flush();

        poll.stop();                                      // 标签页转入后台
        inFlight.resolve({ attention_count: 2 });
        await flush();

        // 它是当时最新的号，正常落盘。
        expect(getSummaryAttentionBadge()).toBe(2);

        // 之后的用户读依然能落盘：号段没有被悬空的号卡住。
        vi.mocked(api.fetchSummaryAttentionCounts).mockResolvedValueOnce({ attention_count: 5 } as any);
        await refreshSummaryAttentionBadge();
        expect(getSummaryAttentionBadge()).toBe(5);
    });

    // 轮询要靠「值变没变」决定退避档位，而红点是否真的被写入由号段决定。
    // 两件事必须解耦：一次被更新读取顶掉的轮询，其取回的值仍然是新鲜样本。
    it('轮询的结果被更新的读取顶掉，但退避判据仍拿到真实取值', async () => {
        const counts: number[] = [];
        vi.mocked(api.fetchSummaryAttentionCounts).mockResolvedValue({ attention_count: 3 } as any);

        const h = createHarness();
        const poll = makePoll(h, (c) => counts.push(c));
        poll.start();
        h.fireWithoutSettling();
        await flush();

        expect(counts).toEqual([3]);
        expect(getSummaryAttentionBadge()).toBe(3);
    });

    // 前置条件不满足时 readSummaryAttentionCount 返回 null：它既不是失败也不是
    // 「值没变」，更重要的是它【没有领号】，不该扰动号段。
    it('未登录时轮询不领号、不发请求，也不打断在飞的用户读', async () => {
        const userResponse = deferred<any>();
        vi.mocked(api.fetchSummaryAttentionCounts).mockReturnValueOnce(userResponse.promise);
        const pendingUser = refreshSummaryAttentionBadge();

        vi.mocked(WKApp.loginInfo.isLogined).mockReturnValue(false);

        const h = createHarness();
        const poll = makePoll(h);
        poll.start();
        h.fireWithoutSettling();
        await flush();

        // 只有用户那一次请求。
        expect(api.fetchSummaryAttentionCounts).toHaveBeenCalledTimes(1);

        vi.mocked(WKApp.loginInfo.isLogined).mockReturnValue(true);
        userResponse.resolve({ attention_count: 7 });
        await pendingUser;
        expect(getSummaryAttentionBadge()).toBe(7);
    });

    // 三个写者同时在场的综合交错：列表 loadData 式的直接领号、用户探测、轮询。
    it('三写者交错：最后发出的那次读取赢，更早的迟到响应一律丢弃', async () => {
        const pollResponse = deferred<any>();
        const userResponse = deferred<any>();
        vi.mocked(api.fetchSummaryAttentionCounts)
            .mockReturnValueOnce(pollResponse.promise)                       // ① 轮询最先发
            .mockReturnValueOnce(userResponse.promise);                      // ② 用户探测随后

        const h = createHarness();
        const poll = makePoll(h);
        poll.start();
        h.fireWithoutSettling();
        await flush();

        const pendingUser = refreshSummaryAttentionBadge();

        // ③ 列表最后领号（模拟 SummaryListPage.loadData）。
        const listTicket = beginSummaryAttentionRead();

        // 到达顺序完全打乱：轮询 → 用户 → 列表。
        pollResponse.resolve({ attention_count: 9 });
        await flush();
        expect(getSummaryAttentionBadge()).toBe(0);       // 号最旧，丢弃

        userResponse.resolve({ attention_count: 8 });
        await pendingUser;
        expect(getSummaryAttentionBadge()).toBe(0);       // 号也不是最新，丢弃

        commitSummaryAttentionBadge(listTicket, 1);       // 发出最晚，落盘
        expect(getSummaryAttentionBadge()).toBe(1);
    });
});
