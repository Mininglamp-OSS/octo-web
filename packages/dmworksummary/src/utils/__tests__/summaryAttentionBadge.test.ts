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
} from '../summaryAttentionBadge';

import { WKApp } from '@octo/base';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
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

    it('refreshSummaryAttentionBadge 从 listSummaries 拉取 attention_count（未读∪邀请∪待提交）', async () => {
        vi.mocked(api.listSummaries).mockResolvedValue({
            items: [],
            total: 0,
            attention_count: 5,
            unread_count: 2,
            pending_invitation_count: 1,
            pending_submission_count: 2,
        } as any);

        await refreshSummaryAttentionBadge();

        expect(api.listSummaries).toHaveBeenCalledWith({ page: 1, page_size: 1 });
        expect(getSummaryAttentionBadge()).toBe(5);
    });

    // 口径回归：#1359 首版读 pending_invitation_count，侧边栏数字会小于卡片红点数。
    // 侧边栏必须与 needs_attention 同源，否则「显示 1 条、进去 3 个红点」。
    it('refreshSummaryAttentionBadge 不再只读 pending_invitation_count', async () => {
        vi.mocked(api.listSummaries).mockResolvedValue({
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
        vi.mocked(api.listSummaries).mockRejectedValue(new Error('network'));
        setSummaryAttentionBadge(4);

        await expect(refreshSummaryAttentionBadge()).resolves.toBeUndefined();
        // 保持旧值，不清零
        expect(getSummaryAttentionBadge()).toBe(4);
    });

    it('refreshSummaryAttentionBadge 响应缺 attention_count 时归零', async () => {
        vi.mocked(api.listSummaries).mockResolvedValue({
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

        expect(api.listSummaries).not.toHaveBeenCalled();
    });

    it('refreshSummaryAttentionBadge 丢弃跨 Space 的迟到响应', async () => {
        const responseA = deferred<any>();
        const responseB = deferred<any>();
        vi.mocked(api.listSummaries)
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
        vi.mocked(api.listSummaries)
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);

        const pendingFirst = refreshSummaryAttentionBadge();   // 团队标读后
        const pendingSecond = refreshSummaryAttentionBadge();  // 个人标读后

        expect(api.listSummaries).toHaveBeenCalledTimes(2);

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
        vi.mocked(api.listSummaries)
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
        vi.mocked(api.listSummaries).mockReturnValueOnce(probe.promise);
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
        vi.mocked(api.listSummaries).mockReturnValueOnce(probe.promise);

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
