/**
 * summaryMenuBadge test — 侧边栏「智能总结」菜单未处理邀请红点 (#1359)。
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
    getPendingInvitationBadge,
    setPendingInvitationBadge,
    refreshPendingInvitationBadge,
} from '../summaryMenuBadge';

import { WKApp } from '@octo/base';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
}

describe('summaryMenuBadge (#1359)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        WKApp.shared.currentSpaceId = 'space-123';
        WKApp.loginInfo.uid = 'test-uid';
        vi.spyOn(WKApp.loginInfo, 'isLogined').mockReturnValue(true);
        vi.spyOn(WKApp.menus, 'refresh').mockImplementation(() => {});
        // 重置模块级计数
        setPendingInvitationBadge(0);
        vi.mocked(WKApp.menus.refresh).mockClear();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it('getPendingInvitationBadge 初始返回 0', () => {
        expect(getPendingInvitationBadge()).toBe(0);
    });

    it('setPendingInvitationBadge 更新计数并触发 menus.refresh', () => {
        setPendingInvitationBadge(3);
        expect(getPendingInvitationBadge()).toBe(3);
        expect(WKApp.menus.refresh).toHaveBeenCalledTimes(1);
    });

    it('setPendingInvitationBadge 相同值不重复触发 refresh', () => {
        setPendingInvitationBadge(2);
        setPendingInvitationBadge(2);
        expect(WKApp.menus.refresh).toHaveBeenCalledTimes(1);
    });

    it('setPendingInvitationBadge 先规范化非有限值、小数和负数再比较', () => {
        setPendingInvitationBadge(-1);
        setPendingInvitationBadge(Number.NaN);
        setPendingInvitationBadge(Number.POSITIVE_INFINITY);
        expect(getPendingInvitationBadge()).toBe(0);
        expect(WKApp.menus.refresh).not.toHaveBeenCalled();

        setPendingInvitationBadge(3.9);
        expect(getPendingInvitationBadge()).toBe(3);
        expect(WKApp.menus.refresh).toHaveBeenCalledTimes(1);
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

    it('refreshPendingInvitationBadge 未登录或 Space 未就绪时不发请求', async () => {
        vi.mocked(WKApp.loginInfo.isLogined).mockReturnValue(false);
        await refreshPendingInvitationBadge();

        vi.mocked(WKApp.loginInfo.isLogined).mockReturnValue(true);
        WKApp.shared.currentSpaceId = '';
        await refreshPendingInvitationBadge();

        expect(api.listSummaries).not.toHaveBeenCalled();
    });

    it('refreshPendingInvitationBadge 在 E2E mock 未 ready 前不发后台请求', async () => {
        vi.stubEnv('VITE_E2E_MOCK', '1');
        vi.stubGlobal('window', {});

        await refreshPendingInvitationBadge();

        expect(api.listSummaries).not.toHaveBeenCalled();
    });

    it('refreshPendingInvitationBadge 在 E2E mock ready 后走正常请求路径', async () => {
        vi.stubEnv('VITE_E2E_MOCK', '1');
        vi.stubGlobal('window', { __MSW_READY__: true });
        vi.mocked(api.listSummaries).mockResolvedValue({
            items: [],
            total: 0,
            attention_count: 0,
            unread_count: 0,
            pending_invitation_count: 2,
        } as any);

        await refreshPendingInvitationBadge();

        expect(api.listSummaries).toHaveBeenCalledWith({ page: 1, page_size: 1 });
        expect(getPendingInvitationBadge()).toBe(2);
    });

    it('refreshPendingInvitationBadge 丢弃跨 Space 的迟到响应', async () => {
        const responseA = deferred<any>();
        const responseB = deferred<any>();
        vi.mocked(api.listSummaries)
            .mockReturnValueOnce(responseA.promise)
            .mockReturnValueOnce(responseB.promise);

        WKApp.shared.currentSpaceId = 'space-a';
        const pendingA = refreshPendingInvitationBadge();
        WKApp.shared.currentSpaceId = 'space-b';
        const pendingB = refreshPendingInvitationBadge();

        responseB.resolve({ pending_invitation_count: 2 });
        await pendingB;
        expect(getPendingInvitationBadge()).toBe(2);

        responseA.resolve({ pending_invitation_count: 9 });
        await pendingA;
        expect(getPendingInvitationBadge()).toBe(2);
    });
});
