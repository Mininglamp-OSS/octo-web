import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    createAttentionSync,
    shouldRefreshForMessage,
    SUMMARY_NOTIFY_CONTENT_TYPE,
    SUMMARY_TIP_CONTENT_TYPE,
} from '../summaryAttentionSync';

describe('shouldRefreshForMessage', () => {
    it('认群内总结完成提示（type-21）', () => {
        expect(shouldRefreshForMessage({ contentType: SUMMARY_NOTIFY_CONTENT_TYPE })).toBe(true);
    });

    // PR1534(#1379) 把提示改成 WK_TIP(2000) 让 App 免适配，两代都要认，
    // 否则新老服务端各坏一半。
    it('只认总结 WK_TIP 2000，不把整个系统消息号段都当总结事件', () => {
        expect(shouldRefreshForMessage({ contentType: SUMMARY_TIP_CONTENT_TYPE })).toBe(true);
        expect(shouldRefreshForMessage({ contentType: 1000 })).toBe(false);
        expect(shouldRefreshForMessage({ contentType: 1002 })).toBe(false);
        expect(shouldRefreshForMessage({ contentType: 1005 })).toBe(false);
        expect(shouldRefreshForMessage({ contentType: 1500 })).toBe(false);
    });

    // 普通聊天消息是最高频的事件源。若把它们也算上，等于给每条群消息挂一个
    // page_size=1 的 GET——那就是 #1213 被砍掉的那种量级。
    it('忽略普通消息，不把红点变成聊天流量的放大器', () => {
        expect(shouldRefreshForMessage({ contentType: 1 })).toBe(false);
        expect(shouldRefreshForMessage({ contentType: 999 })).toBe(false);
        expect(shouldRefreshForMessage({ contentType: 2001 })).toBe(false);
    });

    it('对畸形输入安全返回 false', () => {
        expect(shouldRefreshForMessage(null)).toBe(false);
        expect(shouldRefreshForMessage(undefined)).toBe(false);
        expect(shouldRefreshForMessage({})).toBe(false);
        expect(shouldRefreshForMessage({ contentType: '21' })).toBe(false);
        expect(shouldRefreshForMessage({ contentType: NaN })).toBe(false);
    });
});

describe('createAttentionSync', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('去抖：成簇触发只打一次请求', () => {
        const refresh = vi.fn();
        const sync = createAttentionSync({ refresh, debounceMs: 800 });

        // 切回标签页时 visibilitychange 与 focus 相继到达，是最常见的成簇场景。
        sync.trigger();
        sync.trigger();
        sync.trigger();
        expect(refresh).not.toHaveBeenCalled();

        vi.advanceTimersByTime(800);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('窗口结束后可以再次触发', () => {
        const refresh = vi.fn();
        const sync = createAttentionSync({ refresh, debounceMs: 800 });

        sync.trigger();
        vi.advanceTimersByTime(800);
        expect(refresh).toHaveBeenCalledTimes(1);

        sync.trigger();
        vi.advanceTimersByTime(800);
        expect(refresh).toHaveBeenCalledTimes(2);
    });

    it('cancel 之后不再触发（模块卸载/热更）', () => {
        const refresh = vi.fn();
        const sync = createAttentionSync({ refresh, debounceMs: 800 });

        sync.trigger();
        sync.cancel();
        vi.advanceTimersByTime(5000);
        expect(refresh).not.toHaveBeenCalled();
    });

    it('triggerNow 立即执行并清掉待触发的窗口', () => {
        const refresh = vi.fn();
        const sync = createAttentionSync({ refresh, debounceMs: 800 });

        sync.trigger();
        sync.triggerNow();
        expect(refresh).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(5000);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    // 这是"不要变成轮询"的承重断言：即便事件雨点般落下，请求数也由去抖窗口
    // 决定，而不是由事件数决定。
    it('高频事件不会被放大成高频请求', () => {
        const refresh = vi.fn();
        const sync = createAttentionSync({ refresh, debounceMs: 800 });

        for (let i = 0; i < 100; i++) sync.trigger();
        vi.advanceTimersByTime(800);
        expect(refresh).toHaveBeenCalledTimes(1);
    });
});
