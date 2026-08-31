/**
 * summaryAttentionLeader test —— 跨标签页租约式 leader 选举。
 *
 * 重点覆盖两件在真实环境里最贵、在单测里最容易被漏掉的事：
 *   1. leader 被【强杀】（OOM / 系统杀 / 断电）后没人清租约 —— 必须靠租约过期
 *      让别的标签页接管。写「选一次、卸载时释放」的实现在测试里表现完美，
 *      但线上会留下一个永远暗着的红点。
 *   2. BroadcastChannel / localStorage 不可用（Electron 多窗口、隐私模式、
 *      被策略禁用）—— 必须降级成【每个标签页自己轮询】，绝不能降级成没人轮询。
 *
 * storage 与 BroadcastChannel 都用注入的替身，因此可以精确摆布时间与故障。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    createAttentionLeader,
    LEADER_HEARTBEAT_MS,
    LEADER_STALE_AFTER_MS,
} from '../summaryAttentionLeader';

/** 一份可被多个「标签页」共享的内存 storage（模拟同源 localStorage）。 */
function createMemoryStorage(): Storage & { failWrites: boolean } {
    const map = new Map<string, string>();
    return {
        failWrites: false,
        get length() { return map.size; },
        clear: () => map.clear(),
        key: (i: number) => Array.from(map.keys())[i] ?? null,
        getItem(key: string) { return map.get(key) ?? null; },
        setItem(this: { failWrites: boolean }, key: string, value: string) {
            if (this.failWrites) throw new Error('QuotaExceededError');
            map.set(key, value);
        },
        removeItem: (key: string) => { map.delete(key); },
    } as Storage & { failWrites: boolean };
}

/** 共享总线上的 BroadcastChannel 替身：同名 channel 互相收发，且不回自己。 */
function createChannelFactory() {
    const channels: Array<{ name: string; onmessage: ((e: MessageEvent) => void) | null; closed: boolean }> = [];
    class FakeChannel {
        name: string;
        onmessage: ((e: MessageEvent) => void) | null = null;
        closed = false;
        constructor(name: string) {
            this.name = name;
            channels.push(this);
        }
        postMessage(data: unknown) {
            for (const other of channels) {
                if (other === (this as unknown) || other.closed) continue;
                if (other.name !== this.name) continue;
                other.onmessage?.({ data } as MessageEvent);
            }
        }
        close() { this.closed = true; }
    }
    return { channels, ctor: FakeChannel as unknown as typeof BroadcastChannel };
}

/**
 * 一个「标签页」：自带手动时钟与手动心跳定时器，测试自己决定什么时候跳一拍。
 * 心跳走注入的 setIntervalFn，所以整个选举过程完全确定，没有真实等待。
 */
function createTab(options: {
    id: string;
    storage: Storage | null;
    ctor: typeof BroadcastChannel | null;
    clock: { now: number };
    /** 初始可见性。缺省可见——绝大多数用例不关心这一维。 */
    visible?: boolean;
}) {
    const events: string[] = [];
    const remote: Array<{ count: number; spaceId: string; sampleAt: number }> = [];
    let beatHandler: (() => void) | null = null;
    // 可见性由测试摆布：真实环境里它来自 document.visibilityState，
    // 注入之后「隐藏的 leader 会不会继续续租」才是可断言的。
    const state = { visible: options.visible ?? true };

    const leader = createAttentionLeader({
        tabId: options.id,
        storage: options.storage,
        broadcastChannelCtor: options.ctor,
        now: () => options.clock.now,
        isVisible: () => state.visible,
        setIntervalFn: (handler: () => void) => {
            beatHandler = handler;
            return 1;
        },
        clearIntervalFn: () => { beatHandler = null; },
        onBecomeLeader: () => events.push('lead'),
        onResignLeader: () => events.push('resign'),
        onRemoteCount: (count, spaceId, sampleAt) => remote.push({ count, spaceId, sampleAt }),
    });

    return {
        leader,
        events,
        remote,
        /** 手动跳一拍心跳（续租 or 抢占检查）。 */
        beat: () => beatHandler?.(),
        hasHeartbeat: () => beatHandler !== null,
        /** 切换可见性并通知 leader（与 module.tsx 的 visibilitychange 接线等价）。 */
        setVisible: (visible: boolean) => {
            state.visible = visible;
            leader.setVisible(visible);
        },
        /**
         * 只改真实可见性，【不】通知 leader —— 模拟压根不发 visibilitychange 的
         * 宿主（某些 Electron / iframe 嵌入环境）。这是 setVisible 之外唯一能把
         * 「beat 到底读缓存还是现问」区分开的手法。
         */
        setVisibleSilently: (visible: boolean) => { state.visible = visible; },
    };
}

describe('createAttentionLeader —— 正常选举', () => {
    let storage: ReturnType<typeof createMemoryStorage>;
    let factory: ReturnType<typeof createChannelFactory>;
    let clock: { now: number };

    beforeEach(() => {
        storage = createMemoryStorage();
        factory = createChannelFactory();
        clock = { now: 1_000_000 };
    });

    it('第一个启动的标签页立刻成为 leader（不必空等一个心跳周期）', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();

        expect(a.leader.isLeader()).toBe(true);
        expect(a.leader.isDegraded()).toBe(false);
        expect(a.events).toEqual(['lead']);
    });

    it('第二个标签页看到新鲜租约就当跟随者，不重复轮询', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();

        const b = createTab({ id: 'tab-b', storage, ctor: factory.ctor, clock });
        b.leader.start();

        expect(a.leader.isLeader()).toBe(true);
        expect(b.leader.isLeader()).toBe(false);
        // 开五个 OCTO 标签页不该是五倍请求。
        expect(b.events).toEqual([]);
    });

    it('leader 每拍续租，跟随者一直看到新鲜租约', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        const b = createTab({ id: 'tab-b', storage, ctor: factory.ctor, clock });
        b.leader.start();

        for (let i = 0; i < 10; i += 1) {
            clock.now += LEADER_HEARTBEAT_MS;
            a.beat();
            b.beat();
        }

        expect(a.leader.isLeader()).toBe(true);
        expect(b.leader.isLeader()).toBe(false);
        expect(a.events).toEqual(['lead']);              // 不反复触发
    });

    it('leader 正常 stop 时让出租约，跟随者下一拍立刻接管（优化路径）', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        const b = createTab({ id: 'tab-b', storage, ctor: factory.ctor, clock });
        b.leader.start();

        a.leader.stop();
        clock.now += LEADER_HEARTBEAT_MS;
        b.beat();

        // 正常卸载时清租约只是让接管【立刻】发生，不必等过期阈值。
        expect(b.leader.isLeader()).toBe(true);
    });
});

// ═══ 这一组是本文件存在的主要理由 ═══
// 标签页可以在不执行任何卸载回调的情况下消失：进程 OOM 被杀、系统强杀、断电、
// 崩溃、移动端被系统回收。此时 localStorage 里的锁还在，持锁的标签页却没了。
// 「选一次、卸载时释放」的实现在这种情况下会让【所有】标签页都认为已经有 leader，
// 于是没有任何人轮询，红点永久变暗，直到用户手动刷新全部标签页。
describe('createAttentionLeader —— 租约过期与接管（leader 被强杀）', () => {
    let storage: ReturnType<typeof createMemoryStorage>;
    let factory: ReturnType<typeof createChannelFactory>;
    let clock: { now: number };

    beforeEach(() => {
        storage = createMemoryStorage();
        factory = createChannelFactory();
        clock = { now: 1_000_000 };
    });

    it('leader 被强杀（租约留在 storage 里）后，跟随者在阈值之后接管', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        const b = createTab({ id: 'tab-b', storage, ctor: factory.ctor, clock });
        b.leader.start();
        expect(b.leader.isLeader()).toBe(false);

        // tab-a 被 OOM 杀掉：不调 stop()，不清租约，也不再续租。
        // 时间越过接管阈值。
        clock.now += LEADER_STALE_AFTER_MS + 1;
        b.beat();

        expect(b.leader.isLeader()).toBe(true);
        expect(b.events).toEqual(['lead']);
    });

    it('还没到阈值时不抢：活着的 leader 不该被一次 GC 停顿误判成死的', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        const b = createTab({ id: 'tab-b', storage, ctor: factory.ctor, clock });
        b.leader.start();

        // 刚好一个心跳周期没续上（主线程被长任务占住 / GC 停顿）。
        clock.now += LEADER_HEARTBEAT_MS + 1;
        b.beat();
        expect(b.leader.isLeader()).toBe(false);

        // 阈值是 2.5 个周期，两个周期内仍不抢，避免出现双 leader。
        clock.now += LEADER_HEARTBEAT_MS * 0.9;
        b.beat();
        expect(b.leader.isLeader()).toBe(false);
    });

    it('接管阈值 > 2 个心跳周期（连丢两拍才判死）', () => {
        expect(LEADER_STALE_AFTER_MS).toBeGreaterThan(LEADER_HEARTBEAT_MS * 2);
    });

    it('接管后旧 leader 若「复活」（长时间挂起后醒来），发现租约已易主则退位', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        const b = createTab({ id: 'tab-b', storage, ctor: factory.ctor, clock });
        b.leader.start();

        // tab-a 所在的系统休眠了很久，期间 tab-b 接管。
        clock.now += LEADER_STALE_AFTER_MS + 1;
        b.beat();
        expect(b.leader.isLeader()).toBe(true);

        // tab-a 醒来，跳一拍：它必须认清租约已经不是自己的，停掉自己的轮询。
        a.beat();
        expect(a.leader.isLeader()).toBe(false);
        expect(a.events).toEqual(['lead', 'resign']);
    });

    it('租约完全不存在（storage 被清空）时任何一个跟随者都会接管', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        const b = createTab({ id: 'tab-b', storage, ctor: factory.ctor, clock });
        b.leader.start();

        storage.clear();                                 // 别的代码清了 localStorage
        clock.now += LEADER_HEARTBEAT_MS;
        b.beat();

        expect(b.leader.isLeader()).toBe(true);
    });

    it('租约内容被写坏时按「没有租约」处理并接管，而不是整条链路抛异常', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        const b = createTab({ id: 'tab-b', storage, ctor: factory.ctor, clock });
        b.leader.start();

        storage.setItem('octo:summary-attention-leader', 'not-json{{{');
        clock.now += LEADER_HEARTBEAT_MS;
        expect(() => b.beat()).not.toThrow();
        expect(b.leader.isLeader()).toBe(true);
    });

    it('租约字段类型不对（ts 不是数字）同样按无租约处理', () => {
        const b = createTab({ id: 'tab-b', storage, ctor: factory.ctor, clock });
        storage.setItem('octo:summary-attention-leader', JSON.stringify({ id: 'ghost', ts: 'soon' }));
        b.leader.start();

        expect(b.leader.isLeader()).toBe(true);
    });

    it('一个从没被清理过的陈旧租约不会让新开的标签页永远沉默（冷启动接管）', () => {
        // 上一次浏览器会话里 leader 被强杀留下的租约，时间戳远在过去。
        storage.setItem(
            'octo:summary-attention-leader',
            JSON.stringify({ id: 'dead-tab', ts: clock.now - LEADER_STALE_AFTER_MS * 100 }),
        );

        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();

        // 这正是「选一次」实现会永久静默的场景。
        expect(a.leader.isLeader()).toBe(true);
    });
});

describe('createAttentionLeader —— 计数广播', () => {
    let storage: ReturnType<typeof createMemoryStorage>;
    let factory: ReturnType<typeof createChannelFactory>;
    let clock: { now: number };

    beforeEach(() => {
        storage = createMemoryStorage();
        factory = createChannelFactory();
        clock = { now: 1_000_000 };
    });

    it('leader 广播的计数被其它标签页收到', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        const b = createTab({ id: 'tab-b', storage, ctor: factory.ctor, clock });
        b.leader.start();

        a.leader.publish(4, 'space-1', 1_700_000_000_000);

        expect(b.remote).toEqual([{ count: 4, spaceId: 'space-1', sampleAt: 1_700_000_000_000 }]);
        expect(a.remote).toEqual([]);                    // 不回自己
    });

    it('广播必须带 Space：缺 spaceId 的消息被丢弃', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        const b = createTab({ id: 'tab-b', storage, ctor: factory.ctor, clock });
        b.leader.start();

        // 计数是 space-scoped 的；不带 Space 的值无法判断该不该用，只能丢。
        const chA = factory.channels[0] as unknown as { postMessage: (d: unknown) => void };
        chA.postMessage({ type: 'attention-count', count: 3 });
        expect(b.remote).toEqual([]);
    });

    it('畸形广播（非数字 / 未知 type）被忽略，不写坏红点', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        const b = createTab({ id: 'tab-b', storage, ctor: factory.ctor, clock });
        b.leader.start();

        const chA = factory.channels[0] as unknown as { postMessage: (d: unknown) => void };
        chA.postMessage({ type: 'attention-count', count: 'three', spaceId: 's' });
        chA.postMessage({ type: 'attention-count', count: Number.NaN, spaceId: 's' });
        chA.postMessage({ type: 'something-else', count: 1, spaceId: 's' });
        chA.postMessage(null);

        expect(b.remote).toEqual([]);
    });

    it('stop 之后不再收广播（热更/卸载不留悬挂监听）', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        const b = createTab({ id: 'tab-b', storage, ctor: factory.ctor, clock });
        b.leader.start();

        b.leader.stop();
        a.leader.publish(9, 'space-1', 1_700_000_000_000);

        expect(b.remote).toEqual([]);
    });
});

// ═══ 强制降级路径 ═══
// 本仓库还出 Electron 包，多窗口下 localStorage / BroadcastChannel 是否跨窗口共享
// 取决于渲染进程 partition 配置，未经验证；隐私模式、被策略禁用的存储同理。
// 两种失败模式不对等：「多打几个请求」可计量可承受，「没人打」是功能静默消失。
describe('createAttentionLeader —— 降级（宁可多打请求，也不能没人打）', () => {
    let clock: { now: number };

    beforeEach(() => {
        clock = { now: 1_000_000 };
    });

    it('没有 BroadcastChannel 时每个标签页各自轮询', () => {
        const storage = createMemoryStorage();
        const a = createTab({ id: 'tab-a', storage, ctor: null, clock });
        const b = createTab({ id: 'tab-b', storage, ctor: null, clock });
        a.leader.start();
        b.leader.start();

        // 选得出 leader 也没用：它取到的数送不到别的标签页，那些红点会一直是旧的。
        expect(a.leader.isDegraded()).toBe(true);
        expect(b.leader.isDegraded()).toBe(true);
        expect(a.leader.isLeader()).toBe(true);
        expect(b.leader.isLeader()).toBe(true);
        expect(a.events).toEqual(['lead']);
        expect(b.events).toEqual(['lead']);
    });

    it('没有 localStorage 时每个标签页各自轮询', () => {
        const factory = createChannelFactory();
        const a = createTab({ id: 'tab-a', storage: null, ctor: factory.ctor, clock });
        const b = createTab({ id: 'tab-b', storage: null, ctor: factory.ctor, clock });
        a.leader.start();
        b.leader.start();

        expect(a.leader.isLeader()).toBe(true);
        expect(b.leader.isLeader()).toBe(true);
    });

    it('localStorage 存在但 setItem 抛异常（Safari 隐私模式）也降级', () => {
        const storage = createMemoryStorage();
        storage.failWrites = true;                       // 对象在，功能不在
        const factory = createChannelFactory();

        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();

        // 只判 `typeof localStorage !== 'undefined'` 会漏掉这一整类环境。
        expect(a.leader.isDegraded()).toBe(true);
        expect(a.leader.isLeader()).toBe(true);
    });

    it('BroadcastChannel 构造函数抛异常时也降级，而不是把模块带崩', () => {
        const storage = createMemoryStorage();
        const ThrowingChannel = function () {
            throw new Error('not supported in this runtime');
        } as unknown as typeof BroadcastChannel;

        const a = createTab({ id: 'tab-a', storage, ctor: ThrowingChannel, clock });
        expect(() => a.leader.start()).not.toThrow();

        expect(a.leader.isDegraded()).toBe(true);
        expect(a.leader.isLeader()).toBe(true);
    });

    it('降级模式下不起心跳定时器，也不写租约（没有可协调的对象）', () => {
        const storage = createMemoryStorage();
        const a = createTab({ id: 'tab-a', storage, ctor: null, clock });
        a.leader.start();

        expect(a.hasHeartbeat()).toBe(false);
        expect(storage.getItem('octo:summary-attention-leader')).toBeNull();
    });

    it('降级模式下 publish 是 no-op，不抛异常', () => {
        const storage = createMemoryStorage();
        const a = createTab({ id: 'tab-a', storage, ctor: null, clock });
        a.leader.start();

        expect(() => a.leader.publish(3, 'space-1', 1_700_000_000_000)).not.toThrow();
    });

    it('降级模式下 stop 仍然通知调用方停表（否则轮询定时器会漏出去）', () => {
        const storage = createMemoryStorage();
        const a = createTab({ id: 'tab-a', storage, ctor: null, clock });
        a.leader.start();
        a.leader.stop();

        expect(a.events).toEqual(['lead', 'resign']);
        expect(a.leader.isLeader()).toBe(false);
    });

    it('绝不会出现「所有标签页都不轮询」：三个标签页在任一降级组合下至少有一个在轮', () => {
        const combos: Array<{ storage: Storage | null; ctor: typeof BroadcastChannel | null }> = [
            { storage: null, ctor: null },
            { storage: createMemoryStorage(), ctor: null },
            { storage: null, ctor: createChannelFactory().ctor },
        ];

        for (const combo of combos) {
            const tabs = ['t1', 't2', 't3'].map((id) =>
                createTab({ id, storage: combo.storage, ctor: combo.ctor, clock }),
            );
            tabs.forEach((t) => t.leader.start());
            expect(tabs.some((t) => t.leader.isLeader())).toBe(true);
        }
    });
});

describe('createAttentionLeader —— 生命周期', () => {
    let storage: ReturnType<typeof createMemoryStorage>;
    let factory: ReturnType<typeof createChannelFactory>;
    let clock: { now: number };

    beforeEach(() => {
        storage = createMemoryStorage();
        factory = createChannelFactory();
        clock = { now: 1_000_000 };
    });

    it('重复 start 幂等，不会叠出第二个心跳定时器', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        a.leader.start();

        expect(a.events).toEqual(['lead']);
    });

    it('stop 清掉心跳定时器（热更后不留悬挂心跳）', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        expect(a.hasHeartbeat()).toBe(true);

        a.leader.stop();
        expect(a.hasHeartbeat()).toBe(false);
    });

    it('未 start 时 stop 是 no-op', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        expect(() => a.leader.stop()).not.toThrow();
        expect(a.events).toEqual([]);
    });

    it('stop 只清自己的租约：接管发生后不会把别人的租约误删', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        const b = createTab({ id: 'tab-b', storage, ctor: factory.ctor, clock });
        b.leader.start();

        clock.now += LEADER_STALE_AFTER_MS + 1;
        b.beat();                                        // tab-b 接管
        expect(b.leader.isLeader()).toBe(true);

        a.leader.stop();                                 // 旧 leader 此时才卸载

        // 误删会让 tab-b 平白掉线，红点在下一拍之前一直不动。
        const lease = JSON.parse(storage.getItem('octo:summary-attention-leader') ?? 'null');
        expect(lease?.id).toBe('tab-b');
    });

    it('探测键不会残留在 storage 里', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();

        expect(storage.getItem('octo:summary-attention-leader:probe')).toBeNull();
    });
});

// ═══ 可见性即选主资格 ═══
//
// 🔴 回归组。此前 leader 对可见性零感知：心跳无条件续租，而 module.tsx 的
// visibilitychange 只停轮询、不通知 leader。于是「从 leader 标签页切到同窗口的
// 另一个 OCTO 标签页」——最常见不过的操作——会让隐藏的 leader 一边停着自己的表、
// 一边每 3s 照常宣告「我还活着」，其它可见标签页永远看到新鲜租约、永不接管。
// 结果是整个浏览器零轮询。
//
// 为什么不能靠浏览器节流兜底：Chrome 的节流是分级的，intensive throttling
// （≤1 次/分钟）要隐藏满约 5 分钟才介入，在那之前 ≥1s 的 setInterval 照常触发
// （只有 <1s 被钳到 1s）。也就是说这个死区最长约 5 分钟，而且恰好打在本功能
// 唯一的存在理由上：用户盯着一个可见标签页、暂时没有交互时，红点必须自己会亮。
describe('createAttentionLeader —— 可见性即选主资格', () => {
    let storage: ReturnType<typeof createMemoryStorage>;
    let factory: ReturnType<typeof createChannelFactory>;
    let clock: { now: number };

    beforeEach(() => {
        storage = createMemoryStorage();
        factory = createChannelFactory();
        clock = { now: 1_000_000 };
    });

    it('隐藏的 leader 立即让位并清掉租约，不必等租约过期', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        expect(a.leader.isLeader()).toBe(true);

        a.setVisible(false);

        expect(a.leader.isLeader()).toBe(false);
        expect(a.events).toEqual(['lead', 'resign']);
        // 主动清租约是关键：留着它，可见的跟随者还要白等 7.5s 才敢抢。
        expect(storage.getItem('octo:summary-attention-leader')).toBeNull();
    });

    it('隐藏的 leader 不再续租：可见的跟随者下一拍就接管', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        const b = createTab({ id: 'tab-b', storage, ctor: factory.ctor, clock });
        b.leader.start();
        expect(b.leader.isLeader()).toBe(false);

        a.setVisible(false);
        b.beat();

        expect(b.leader.isLeader()).toBe(true);
        expect(a.leader.isLeader()).toBe(false);
    });

    // 这一条正面钉死那个 5 分钟死区：哪怕隐藏的 leader 的心跳还在跑（节流生效前
    // 它就是在跑），它也不该把租约刷新，否则可见标签页永远没有机会。
    it('隐藏 leader 的心跳照跑也不续租，可见标签页仍能接管', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        const b = createTab({ id: 'tab-b', storage, ctor: factory.ctor, clock });
        b.leader.start();

        a.setVisible(false);
        // 模拟 intensive throttling 生效前的那几分钟：隐藏标签页的心跳照常触发。
        for (let i = 0; i < 100; i += 1) {
            clock.now += LEADER_HEARTBEAT_MS;
            a.beat();
        }

        expect(storage.getItem('octo:summary-attention-leader')).toBeNull();
        b.beat();
        expect(b.leader.isLeader()).toBe(true);
    });

    it('重新可见时立刻参与竞争，不白等一个心跳周期', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();

        a.setVisible(false);
        expect(a.leader.isLeader()).toBe(false);

        a.setVisible(true);

        // 没有别人占着，转可见的这一下就该把它拉回 leader。
        expect(a.leader.isLeader()).toBe(true);
        expect(a.events).toEqual(['lead', 'resign', 'lead']);
    });

    it('重新可见时若租约已被别人持有，老老实实当跟随者', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        const b = createTab({ id: 'tab-b', storage, ctor: factory.ctor, clock });
        b.leader.start();

        a.setVisible(false);
        b.beat();                                        // tab-b 接管
        a.setVisible(true);                              // tab-a 回到前台

        // 抢回来毫无必要：tab-b 正在正常轮询。双 leader 才是要避免的。
        expect(b.leader.isLeader()).toBe(true);
        expect(a.leader.isLeader()).toBe(false);
    });

    it('全部标签页都隐藏时没有人轮询——这是正确行为，不是 bug', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        const b = createTab({ id: 'tab-b', storage, ctor: factory.ctor, clock });
        b.leader.start();

        a.setVisible(false);
        b.setVisible(false);
        clock.now += LEADER_STALE_AFTER_MS + 1;
        a.beat();
        b.beat();

        // 没人看得见红点，请求就该归零；这正是可见性门控的收益所在。
        expect(a.leader.isLeader()).toBe(false);
        expect(b.leader.isLeader()).toBe(false);
        expect(storage.getItem('octo:summary-attention-leader')).toBeNull();
    });

    it('以隐藏状态启动的标签页不抢租约（后台开的标签页不该当 leader）', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock, visible: false });
        a.leader.start();

        expect(a.leader.isLeader()).toBe(false);
        expect(a.events).toEqual([]);
        expect(storage.getItem('octo:summary-attention-leader')).toBeNull();
    });

    // 心跳定时器不能随可见性停掉：它同时担着「观察租约、适时抢占」的职责。
    // 停了之后，若宿主根本不发 visibilitychange（某些嵌入环境），本标签页就
    // 再也没有东西把它拉回竞争。
    it('隐藏时心跳定时器仍在（它还担着观察与抢占的职责）', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();

        a.setVisible(false);

        expect(a.hasHeartbeat()).toBe(true);
    });

    it('降级模式忽略可见性：绝不能把「每个标签页自己轮询」这条保底拆掉', () => {
        const s = createMemoryStorage();
        const a = createTab({ id: 'tab-a', storage: s, ctor: null, clock });
        a.leader.start();
        expect(a.leader.isDegraded()).toBe(true);
        expect(a.leader.isLeader()).toBe(true);

        a.setVisible(false);

        // 降级下 isLeader 恒为 true；可见性对轮询的门控由 summaryAttentionPoll
        // 自己做（它本来就停表）。在这里再动一次只会把保底拆没。
        expect(a.leader.isLeader()).toBe(true);
        expect(a.events).toEqual(['lead']);
    });

    it('重复 setVisible 同一个值是 no-op，不会反复让位/夺回', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();

        a.setVisible(true);
        a.setVisible(true);
        expect(a.events).toEqual(['lead']);

        a.setVisible(false);
        a.setVisible(false);
        expect(a.events).toEqual(['lead', 'resign']);
    });
});

/**
 * beat() 每拍现问可见性，而不是只信 setVisible 留下的缓存值。
 *
 * 这一维单靠 setVisible 测不出来：那条路径本来就会把缓存值改对。要区分「读缓存」
 * 和「现问」，只能让真实可见性在【没有 visibilitychange】的情况下变化——而那恰
 * 恰是心跳定时器特意不随可见性停表所要照顾的宿主（见 start() 的注释）。心跳活着
 * 却读着一个永远不会更新的变量，等于活着也没用。
 */
describe('createAttentionLeader —— beat 现问可见性（宿主不发 visibilitychange）', () => {
    let storage: ReturnType<typeof createMemoryStorage>;
    let factory: ReturnType<typeof createChannelFactory>;
    let clock: { now: number };

    beforeEach(() => {
        storage = createMemoryStorage();
        factory = createChannelFactory();
        clock = { now: 1_000_000 };
    });

    it('leader 静默转入隐藏：下一拍就让位并清掉自己的租约', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        expect(a.leader.isLeader()).toBe(true);

        // 宿主不发事件，只有真实可见性变了。
        a.setVisibleSilently(false);
        clock.now += LEADER_HEARTBEAT_MS;
        a.beat();

        expect(a.leader.isLeader()).toBe(false);
        expect(a.events).toEqual(['lead', 'resign']);
        // 让位的同时清租约，可见的跟随者下一拍就能接管，不必空等 staleAfterMs。
        expect(storage.getItem('octo:summary-attention-leader')).toBeNull();
    });

    it('隐藏的 leader 静默转回可见：下一拍自己夺回，不必等 visibilitychange', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock, visible: false });
        a.leader.start();
        expect(a.leader.isLeader()).toBe(false);

        a.setVisibleSilently(true);
        clock.now += LEADER_HEARTBEAT_MS;
        a.beat();

        expect(a.leader.isLeader()).toBe(true);
        expect(a.events).toEqual(['lead']);
    });

    it('静默隐藏的 leader 不再续租，可见的跟随者靠这一拍接管', () => {
        const a = createTab({ id: 'tab-a', storage, ctor: factory.ctor, clock });
        a.leader.start();
        const b = createTab({ id: 'tab-b', storage, ctor: factory.ctor, clock });
        b.leader.start();
        expect(b.leader.isLeader()).toBe(false);

        a.setVisibleSilently(false);
        clock.now += LEADER_HEARTBEAT_MS;
        a.beat();   // 让位 + 清租约
        b.beat();   // 看到没有租约，抢占

        expect(a.leader.isLeader()).toBe(false);
        expect(b.leader.isLeader()).toBe(true);
    });

    it('降级模式不受影响：beat 压根不跑，isLeader 恒为 true', () => {
        const s = createMemoryStorage();
        const a = createTab({ id: 'tab-a', storage: s, ctor: null, clock });
        a.leader.start();
        expect(a.leader.isDegraded()).toBe(true);

        a.setVisibleSilently(false);
        clock.now += LEADER_HEARTBEAT_MS;
        a.beat();

        expect(a.leader.isLeader()).toBe(true);
        expect(a.events).toEqual(['lead']);
    });
});
