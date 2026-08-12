/**
 * summaryMenuBadge test — 侧边栏「智能总结」菜单未处理邀请红点 (#1359)。
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
    getPendingInvitationBadge,
    setPendingInvitationBadge,
    refreshPendingInvitationBadge,
} from '../summaryMenuBadge';

// 给 mock WKApp.menus 补上 refresh（生产 MenusManager 有，mock 缺）。
import { WKApp } from '@octo/base';

describe('summaryMenuBadge (#1359)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // 重置模块级计数
        setPendingInvitationBadge(0);
        (WKApp.menus as any).refresh = vi.fn();
    });

    it('getPendingInvitationBadge 初始返回 0', () => {
        expect(getPendingInvitationBadge()).toBe(0);
    });

    it('setPendingInvitationBadge 更新计数并触发 menus.refresh', () => {
        setPendingInvitationBadge(3);
        expect(getPendingInvitationBadge()).toBe(3);
        expect((WKApp.menus as any).refresh).toHaveBeenCalledTimes(1);
    });

    it('setPendingInvitationBadge 相同值不重复触发 refresh', () => {
        setPendingInvitationBadge(2);
        setPendingInvitationBadge(2);
        expect((WKApp.menus as any).refresh).toHaveBeenCalledTimes(1);
    });

    it('refreshPendingInvitationBadge 从 listSummaries 拉取 pending_invitation_count', async () => {
        vi.mocked(api.listSummaries).mockResolvedValue({
            items: [],
            total: 0,
            attention_count: 0,
            unread_count: 0,
            pending_invitation_count: 5,
        } as any);

        await refreshPendingInvitationBadge();

        expect(api.listSummaries).toHaveBeenCalledWith({ page: 1, page_size: 1 });
        expect(getPendingInvitationBadge()).toBe(5);
    });

    it('refreshPendingInvitationBadge 网络异常静默失败，不抛错', async () => {
        vi.mocked(api.listSummaries).mockRejectedValue(new Error('network'));
        setPendingInvitationBadge(4);

        await expect(refreshPendingInvitationBadge()).resolves.toBeUndefined();
        // 保持旧值，不清零
        expect(getPendingInvitationBadge()).toBe(4);
    });

    it('refreshPendingInvitationBadge 响应缺 pending_invitation_count 时归零', async () => {
        vi.mocked(api.listSummaries).mockResolvedValue({
            items: [],
            total: 0,
            attention_count: 0,
            unread_count: 0,
        } as any);

        setPendingInvitationBadge(7);
        await refreshPendingInvitationBadge();
        expect(getPendingInvitationBadge()).toBe(0);
    });
});
