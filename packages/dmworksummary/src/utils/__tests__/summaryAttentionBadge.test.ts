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
