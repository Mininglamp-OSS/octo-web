/**
 * summaryAttentionPoll test —— 侧边栏待关注红点的自适应兜底轮询。
 *
 * 全部依赖注入（时钟、setTimeout、可见性、取数、随机数），所以这里不用假定时器
 * 也不用等真实时间：直接手动执行被排期的回调，断言【下一次被排在多久之后】。
 * 这样测的是调度决策本身，而不是宿主定时器的实现。
 */
import { describe, expect, it, vi } from 'vitest';

import {
    createAttentionPoll,
    POLL_BASE_INTERVAL_MS,
    POLL_JITTER_RATIO,
    POLL_MAX_INTERVAL_MS,
    POLL_UNCHANGED_THRESHOLD,
} from '../summaryAttentionPoll';

/**
 * 手动时间轴：记下每个被排期的回调与它的延时，测试自己决定什么时候「到点」。
 */
function createHarness(options: { visible?: boolean; random?: () => number } = {}) {
    const scheduled: Array<{ handle: number; handler: () => void; timeout: number }> = [];
    let nextHandle = 1;
    let visible = options.visible ?? true;

    return {
        scheduled,
        get visible() { return visible; },
        set visible(v: boolean) { visible = v; },
        deps: {
            isVisible: () => visible,
            setTimeoutFn: (handler: () => void, timeout: number) => {
                const handle = nextHandle++;
                scheduled.push({ handle, handler, timeout });
                return handle;
            },
            clearTimeoutFn: (handle: unknown) => {
                const idx = scheduled.findIndex((s) => s.handle === handle);
                if (idx >= 0) scheduled.splice(idx, 1);
            },
            // 默认不抖动（factor = 1），抖动单独测。
            random: options.random ?? (() => 0.5),
        },
        /** 最近一次排期的延时。 */
        lastDelay(): number {
            return scheduled[scheduled.length - 1]?.timeout ?? -1;
        },
        /** 触发最早的一个排期回调（并把它从队列摘掉）。 */
        async fire(): Promise<void> {
            const next = scheduled.shift();
            if (!next) throw new Error('没有排期中的 tick');
            next.handler();
            // tick 是 async 的，让它内部的 await 链跑完。
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        },
    };
}

describe('createAttentionPoll —— 基础调度', () => {
    it('start 后按基础间隔排第一拍；stop 后不再排', async () => {
        const h = createHarness();
        const fetchCount = vi.fn().mockResolvedValue(0);
        const poll = createAttentionPoll({ ...h.deps, fetchCount });

        poll.start();
        expect(h.scheduled).toHaveLength(1);
        expect(h.lastDelay()).toBe(POLL_BASE_INTERVAL_MS);
        // 排期本身不发请求：start 不该在用户什么都没做时立刻打一枪，
        // 冷启动首刷是 space-ready 的职责。
        expect(fetchCount).not.toHaveBeenCalled();

        poll.stop();
        expect(h.scheduled).toHaveLength(0);
    });

    it('重复 start 幂等，不会叠出两条调度链', () => {
        const h = createHarness();
        const poll = createAttentionPoll({ ...h.deps, fetchCount: vi.fn().mockResolvedValue(0) });

        poll.start();
        poll.start();
        poll.start();

        expect(h.scheduled).toHaveLength(1);
    });

    it('每拍取数后自动排下一拍（调度链不断）', async () => {
        const h = createHarness();
        const fetchCount = vi.fn().mockResolvedValue(0);
        const poll = createAttentionPoll({ ...h.deps, fetchCount });

        poll.start();
        await h.fire();
        expect(fetchCount).toHaveBeenCalledTimes(1);
        expect(h.scheduled).toHaveLength(1);

        await h.fire();
        expect(fetchCount).toHaveBeenCalledTimes(2);
        expect(h.scheduled).toHaveLength(1);
    });

    it('stop 之后已在飞的请求返回也不再排下一拍', async () => {
        const h = createHarness();
        let resolveFetch!: (v: number) => void;
        const fetchCount = vi.fn(() => new Promise<number>((res) => { resolveFetch = res; }));
        const poll = createAttentionPoll({ ...h.deps, fetchCount });

        poll.start();
        const pending = h.fire();
        poll.stop();
        resolveFetch(3);
        await pending;

        // 这是热更/卸载最容易漏的一条：请求在飞时拆线，回来的那一下又把定时器种回去。
        expect(h.scheduled).toHaveLength(0);
    });
});

describe('createAttentionPoll —— 自适应退避', () => {
    it(`连续 ${POLL_UNCHANGED_THRESHOLD} 次值未变才升一档：15 → 30 → 60，封顶 60`, async () => {
        const h = createHarness();
        const poll = createAttentionPoll({ ...h.deps, fetchCount: vi.fn().mockResolvedValue(7) });

        poll.start();

        // 第一次成功取数：lastCount 从 undefined 变成 7，算「有变化」，仍是基础档。
        await h.fire();
        expect(poll.getCurrentIntervalMs()).toBe(POLL_BASE_INTERVAL_MS);

        // 之后每 3 次未变化升一档。
        for (let i = 0; i < POLL_UNCHANGED_THRESHOLD; i += 1) await h.fire();
        expect(poll.getCurrentIntervalMs()).toBe(30_000);
        expect(h.lastDelay()).toBe(30_000);

        for (let i = 0; i < POLL_UNCHANGED_THRESHOLD; i += 1) await h.fire();
        expect(poll.getCurrentIntervalMs()).toBe(POLL_MAX_INTERVAL_MS);

        // 封顶：再怎么安静也不会超过 60s，否则「轮到你提交」的感知延迟不可接受。
        for (let i = 0; i < POLL_UNCHANGED_THRESHOLD * 3; i += 1) await h.fire();
        expect(poll.getCurrentIntervalMs()).toBe(POLL_MAX_INTERVAL_MS);
    });

    it('未到阈值不升档（1 次未变化不该触发退避）', async () => {
        const h = createHarness();
        const poll = createAttentionPoll({ ...h.deps, fetchCount: vi.fn().mockResolvedValue(1) });

        poll.start();
        await h.fire();                                  // 首次成功 = 有变化
        await h.fire();                                  // 未变化 ×1
        await h.fire();                                  // 未变化 ×2
        expect(poll.getCurrentIntervalMs()).toBe(POLL_BASE_INTERVAL_MS);
    });

    it('值一变就立刻回到基础档', async () => {
        const h = createHarness();
        const fetchCount = vi.fn().mockResolvedValue(0);
        const poll = createAttentionPoll({ ...h.deps, fetchCount });

        poll.start();
        for (let i = 0; i < 1 + POLL_UNCHANGED_THRESHOLD * 2; i += 1) await h.fire();
        expect(poll.getCurrentIntervalMs()).toBe(POLL_MAX_INTERVAL_MS);

        // 被拉进一个多人总结 / 轮到你提交：值变了，节奏必须马上恢复，
        // 否则用户在最需要及时性的那一刻反而处在最慢的档位上。
        fetchCount.mockResolvedValue(2);
        await h.fire();
        expect(poll.getCurrentIntervalMs()).toBe(POLL_BASE_INTERVAL_MS);
        expect(h.lastDelay()).toBe(POLL_BASE_INTERVAL_MS);
    });

    it('升档后重新计数，不会一越过阈值就每拍都升', async () => {
        const h = createHarness();
        const poll = createAttentionPoll({ ...h.deps, fetchCount: vi.fn().mockResolvedValue(4) });

        poll.start();
        await h.fire();                                             // 首次
        for (let i = 0; i < POLL_UNCHANGED_THRESHOLD; i += 1) await h.fire();
        expect(poll.getCurrentIntervalMs()).toBe(30_000);

        // 再来一拍未变化：若升档后没清零计数，这里会直接冲到 60s。
        await h.fire();
        expect(poll.getCurrentIntervalMs()).toBe(30_000);
    });
});

describe('createAttentionPoll —— 失败处理', () => {
    it('失败直接升一档（比未变化更强的退避），且不打扰用户', async () => {
        const h = createHarness();
        const fetchCount = vi.fn().mockRejectedValue(new Error('network'));
        const poll = createAttentionPoll({ ...h.deps, fetchCount });

        poll.start();
        // 断网/5xx 时按正常节奏重试只会给已经出问题的服务端继续加压。
        await expect(h.fire()).resolves.toBeUndefined();
        expect(poll.getCurrentIntervalMs()).toBe(30_000);

        await h.fire();
        expect(poll.getCurrentIntervalMs()).toBe(POLL_MAX_INTERVAL_MS);

        await h.fire();
        expect(poll.getCurrentIntervalMs()).toBe(POLL_MAX_INTERVAL_MS);
    });

    it('失败后仍然继续排期（不会自杀，网络恢复后能自愈）', async () => {
        const h = createHarness();
        const poll = createAttentionPoll({
            ...h.deps,
            fetchCount: vi.fn().mockRejectedValue(new Error('boom')),
        });

        poll.start();
        await h.fire();
        expect(h.scheduled).toHaveLength(1);
    });

    it('失败不写红点、不通知 onCount：值保持原样', async () => {
        const h = createHarness();
        const onCount = vi.fn();
        const poll = createAttentionPoll({
            ...h.deps,
            fetchCount: vi.fn().mockRejectedValue(new Error('boom')),
            onCount,
        });

        poll.start();
        await h.fire();
        expect(onCount).not.toHaveBeenCalled();
    });

    it('失败不污染「变没变」的判据：恢复后同值仍算未变化', async () => {
        const h = createHarness();
        const fetchCount = vi.fn().mockResolvedValue(5);
        const poll = createAttentionPoll({ ...h.deps, fetchCount });

        poll.start();
        await h.fire();                                  // 首次成功，lastCount = 5
        await h.fire();                                  // 未变化 ×1

        fetchCount.mockRejectedValueOnce(new Error('flaky'));
        await h.fire();                                  // 失败：升档，但不动 unchangedRuns
        expect(poll.getCurrentIntervalMs()).toBe(30_000);

        // 恢复后仍返回 5。若失败被记成一次「未变化」，这一拍就凑满 3 次又升一档；
        // 若失败清空了计数，则要再等 3 拍。正确行为是：失败那拍不计入，这拍是第 2 次。
        await h.fire();
        expect(poll.getCurrentIntervalMs()).toBe(30_000);

        // 这拍才是第 3 次未变化 → 升到 60s。
        await h.fire();
        expect(poll.getCurrentIntervalMs()).toBe(POLL_MAX_INTERVAL_MS);
    });

    it('失败不动 lastCount：恢复后拿到不同值仍能识别为变化', async () => {
        const h = createHarness();
        const fetchCount = vi.fn().mockResolvedValue(5);
        const poll = createAttentionPoll({ ...h.deps, fetchCount });

        poll.start();
        await h.fire();
        await h.fire();
        await h.fire();
        await h.fire();
        expect(poll.getCurrentIntervalMs()).toBe(30_000);

        fetchCount.mockRejectedValueOnce(new Error('flaky'));
        await h.fire();
        fetchCount.mockResolvedValue(9);
        await h.fire();
        expect(poll.getCurrentIntervalMs()).toBe(POLL_BASE_INTERVAL_MS);
    });
});

describe('createAttentionPoll —— 事件唤醒', () => {
    it('notifyActivity 立刻取一次数并把间隔拉回基础档', async () => {
        const h = createHarness();
        const fetchCount = vi.fn().mockResolvedValue(0);
        const poll = createAttentionPoll({ ...h.deps, fetchCount });

        poll.start();
        for (let i = 0; i < 1 + POLL_UNCHANGED_THRESHOLD * 2; i += 1) await h.fire();
        expect(poll.getCurrentIntervalMs()).toBe(POLL_MAX_INTERVAL_MS);

        poll.notifyActivity();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(poll.getCurrentIntervalMs()).toBe(POLL_BASE_INTERVAL_MS);
        expect(h.lastDelay()).toBe(POLL_BASE_INTERVAL_MS);
    });

    it('notifyActivity 撤掉已排期的那拍，不会立刻打两枪', async () => {
        const h = createHarness();
        const fetchCount = vi.fn().mockResolvedValue(0);
        const poll = createAttentionPoll({ ...h.deps, fetchCount });

        poll.start();
        expect(h.scheduled).toHaveLength(1);

        poll.notifyActivity();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // 立刻这次 + 重排的下一拍 = 1 个请求 + 1 个排期，而不是两个排期并存。
        expect(fetchCount).toHaveBeenCalledTimes(1);
        expect(h.scheduled).toHaveLength(1);
    });

    it('未 start 时 notifyActivity 不发请求（模块还没接线就不该有流量）', () => {
        const h = createHarness();
        const fetchCount = vi.fn().mockResolvedValue(0);
        const poll = createAttentionPoll({ ...h.deps, fetchCount });

        poll.notifyActivity();

        expect(fetchCount).not.toHaveBeenCalled();
        expect(h.scheduled).toHaveLength(0);
    });
});

describe('createAttentionPoll —— 可见性门控', () => {
    it('不可见时【停表】：定时器被清掉，而不是留着空转跳拍', () => {
        const h = createHarness();
        const poll = createAttentionPoll({ ...h.deps, fetchCount: vi.fn().mockResolvedValue(0) });

        poll.start();
        expect(h.scheduled).toHaveLength(1);

        h.visible = false;
        poll.setVisible(false);

        // 留着定时器空转是没意义的：浏览器会把后台 setTimeout 节流到 ≥1min，
        // 醒来只为判空，还会在 bfcache 里留一个悬挂回调。
        expect(h.scheduled).toHaveLength(0);
    });

    it('不可见期间即使有拍到点也不取数', async () => {
        const h = createHarness();
        const fetchCount = vi.fn().mockResolvedValue(0);
        const poll = createAttentionPoll({ ...h.deps, fetchCount });

        poll.start();
        const pendingTick = h.scheduled[0];
        h.visible = false;
        pendingTick.handler();
        await Promise.resolve();

        expect(fetchCount).not.toHaveBeenCalled();
    });

    it('重新可见 = 一次活动：立刻取数并回到基础档', async () => {
        const h = createHarness();
        const fetchCount = vi.fn().mockResolvedValue(0);
        const poll = createAttentionPoll({ ...h.deps, fetchCount });

        poll.start();
        for (let i = 0; i < 1 + POLL_UNCHANGED_THRESHOLD * 2; i += 1) await h.fire();
        expect(poll.getCurrentIntervalMs()).toBe(POLL_MAX_INTERVAL_MS);
        fetchCount.mockClear();

        h.visible = false;
        poll.setVisible(false);
        h.visible = true;
        poll.setVisible(true);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // 用户回到页面时看到的第一眼必须是新的。
        expect(fetchCount).toHaveBeenCalledTimes(1);
        expect(poll.getCurrentIntervalMs()).toBe(POLL_BASE_INTERVAL_MS);
        expect(h.scheduled).toHaveLength(1);
    });

    it('未 start 时变可见不会自己起表', () => {
        const h = createHarness();
        const fetchCount = vi.fn().mockResolvedValue(0);
        const poll = createAttentionPoll({ ...h.deps, fetchCount });

        poll.setVisible(true);

        expect(fetchCount).not.toHaveBeenCalled();
        expect(h.scheduled).toHaveLength(0);
    });
});

describe('createAttentionPoll —— 请求互斥', () => {
    it('上一拍还在飞时跳过这一拍，绝不并发两个轮询', async () => {
        const h = createHarness();
        let resolveFetch!: (v: number) => void;
        const fetchCount = vi.fn(() => new Promise<number>((res) => { resolveFetch = res; }));
        const poll = createAttentionPoll({ ...h.deps, fetchCount });

        poll.start();
        const firstTick = h.scheduled.shift()!;
        firstTick.handler();
        await Promise.resolve();
        expect(poll.isFetching()).toBe(true);
        expect(fetchCount).toHaveBeenCalledTimes(1);

        // 手工再敲一拍（模拟「上一拍没回来时又到点了」）。
        firstTick.handler();
        await Promise.resolve();
        expect(fetchCount).toHaveBeenCalledTimes(1);

        resolveFetch(1);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(poll.isFetching()).toBe(false);
    });

    it('被互斥挡掉的那拍不重排，避免调度链分裂成两倍频率', async () => {
        const h = createHarness();
        let resolveFetch!: (v: number) => void;
        const fetchCount = vi.fn(() => new Promise<number>((res) => { resolveFetch = res; }));
        const poll = createAttentionPoll({ ...h.deps, fetchCount });

        poll.start();
        const tick = h.scheduled.shift()!;
        tick.handler();
        await Promise.resolve();
        tick.handler();                                   // 被互斥挡掉
        await Promise.resolve();
        expect(h.scheduled).toHaveLength(0);

        resolveFetch(1);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        // 在飞的那次收尾时自己排下一拍，全程只有一条链。
        expect(h.scheduled).toHaveLength(1);
    });

    it('notifyActivity 也受互斥保护，不会插队发第二个请求', async () => {
        const h = createHarness();
        let resolveFetch!: (v: number) => void;
        const fetchCount = vi.fn(() => new Promise<number>((res) => { resolveFetch = res; }));
        const poll = createAttentionPoll({ ...h.deps, fetchCount });

        poll.start();
        h.scheduled.shift()!.handler();
        await Promise.resolve();
        expect(fetchCount).toHaveBeenCalledTimes(1);

        // 切回标签页 + 窗口聚焦 + 菜单激活可能在同一瞬间三连击。
        poll.notifyActivity();
        poll.notifyActivity();
        poll.notifyActivity();
        await Promise.resolve();

        expect(fetchCount).toHaveBeenCalledTimes(1);

        resolveFetch(1);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(h.scheduled).toHaveLength(1);
    });
});

describe('createAttentionPoll —— 抖动', () => {
    it(`实际延时落在 ±${POLL_JITTER_RATIO * 100}% 区间内`, () => {
        const lower = createHarness({ random: () => 0 });        // factor = 1 - 0.1
        const pollLow = createAttentionPoll({ ...lower.deps, fetchCount: vi.fn().mockResolvedValue(0) });
        pollLow.start();
        expect(lower.lastDelay()).toBe(Math.round(POLL_BASE_INTERVAL_MS * (1 - POLL_JITTER_RATIO)));

        const upper = createHarness({ random: () => 0.999999 }); // factor ≈ 1 + 0.1
        const pollHigh = createAttentionPoll({ ...upper.deps, fetchCount: vi.fn().mockResolvedValue(0) });
        pollHigh.start();
        expect(upper.lastDelay()).toBeLessThanOrEqual(Math.round(POLL_BASE_INTERVAL_MS * (1 + POLL_JITTER_RATIO)));
        expect(upper.lastDelay()).toBeGreaterThan(POLL_BASE_INTERVAL_MS);
    });

    it('真随机下多次排期都落在区间内，且确实分散（不是常量）', () => {
        const delays = new Set<number>();
        for (let i = 0; i < 50; i += 1) {
            const h = createHarness({ random: Math.random });
            const poll = createAttentionPoll({ ...h.deps, fetchCount: vi.fn().mockResolvedValue(0) });
            poll.start();
            const delay = h.lastDelay();
            expect(delay).toBeGreaterThanOrEqual(POLL_BASE_INTERVAL_MS * (1 - POLL_JITTER_RATIO) - 1);
            expect(delay).toBeLessThanOrEqual(POLL_BASE_INTERVAL_MS * (1 + POLL_JITTER_RATIO) + 1);
            delays.add(delay);
        }
        // 抖动的全部意义就是让相位发散；退化成常量等于没做。
        expect(delays.size).toBeGreaterThan(1);
    });

    it('抖动永不产生负延时（注入的 random 给出边界值也不行）', () => {
        const h = createHarness({ random: () => 0 });
        const poll = createAttentionPoll({ ...h.deps, fetchCount: vi.fn().mockResolvedValue(0) });
        poll.start();
        expect(h.lastDelay()).toBeGreaterThan(0);
    });

    it('退避后的间隔同样带抖动（不是只有基础档才抖）', async () => {
        const h = createHarness({ random: () => 0 });
        const poll = createAttentionPoll({ ...h.deps, fetchCount: vi.fn().mockResolvedValue(2) });

        poll.start();
        await h.fire();
        for (let i = 0; i < POLL_UNCHANGED_THRESHOLD; i += 1) await h.fire();

        expect(poll.getCurrentIntervalMs()).toBe(30_000);
        expect(h.lastDelay()).toBe(Math.round(30_000 * (1 - POLL_JITTER_RATIO)));
    });
});

describe('createAttentionPoll —— onCount 回调', () => {
    it('每次成功取数都回调（含值未变化的那些）', async () => {
        const h = createHarness();
        const onCount = vi.fn<(count: number) => void>();
        const poll = createAttentionPoll({
            ...h.deps,
            fetchCount: vi.fn().mockResolvedValue(3),
            onCount,
        });

        poll.start();
        await h.fire();
        await h.fire();

        // 值没变也要广播：新加入的标签页需要一个值，不能等到下次变化才拿到。
        expect(onCount).toHaveBeenCalledTimes(2);
        expect(onCount).toHaveBeenLastCalledWith(3);
    });
});
