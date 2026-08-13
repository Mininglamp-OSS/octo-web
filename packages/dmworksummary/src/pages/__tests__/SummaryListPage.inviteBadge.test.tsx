/**
 * SummaryListPage 侧边栏邀请红点接线测试 (#1359)。
 *
 * 只有全局列表 loadData 成功时才用 pending_invitation_count 同步 NavRail；
 * 聊天侧栏是嵌入式 channel 实例，不拥有全局导航状态。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return { ...actual };
});
vi.mock('@douyinfe/semi-ui', () => ({
    Button: () => null,
    Dropdown: () => null,
    Toast: { success: vi.fn(), error: vi.fn() },
    Banner: () => null,
    Tooltip: () => null,
}));
vi.mock('@douyinfe/semi-icons', () => ({
    IconSearch: () => null,
    IconPlus: () => null,
    IconRefresh: () => null,
}));
vi.mock('../../components/SummaryCard', () => ({ default: () => null }));
vi.mock('../SummaryCreatePage', () => ({ default: () => null }));
vi.mock('../SummaryDetailPage', () => ({ default: () => null }));
vi.mock('../../api/summaryApi');

import * as api from '../../api/summaryApi';
import { WKApp } from '@octo/base';
import SummaryListPage from '../SummaryListPage';
import { getPendingInvitationBadge, setPendingInvitationBadge } from '../../utils/summaryMenuBadge';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
}

function makePage(props: Record<string, unknown> = {}) {
    const page = new SummaryListPage(props as any);
    (page as any).state = {
        ...(page.state as any),
        items: [],
        page: 1,
        pageSize: 20,
        statusFilter: undefined,
        keyword: '',
        loading: false,
        loadingMore: false,
        hasMore: false,
    };
    (page as any).isMounted_ = true;
    (page as any).setState = function (this: any, patch: any, cb?: () => void) {
        const resolved = typeof patch === 'function' ? patch(this.state) : patch;
        this.state = { ...this.state, ...resolved };
        cb?.();
    };
    vi.spyOn(page as any, 'maybeStartBatchPoll').mockImplementation(() => {});
    vi.spyOn(page as any, 'stopBatchPoll').mockImplementation(() => {});
    return page;
}

describe('SummaryListPage — 侧边栏邀请红点同步 (#1359)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        WKApp.shared.currentSpaceId = 'space-123';
        setPendingInvitationBadge(0);
    });

    it('全局列表 loadData 用后端 pending_invitation_count 同步红点', async () => {
        vi.mocked(api.listSummaries).mockResolvedValue({
            items: [],
            total: 0,
            attention_count: 0,
            unread_count: 0,
            pending_invitation_count: 3,
        } as any);

        const page = makePage();
        await (page as any).loadData();

        expect(getPendingInvitationBadge()).toBe(3);
    });

    it('聊天侧栏（带 channelId）不覆盖全局 Space badge', async () => {
        vi.mocked(api.listSummaries).mockResolvedValue({
            items: [],
            total: 0,
            attention_count: 0,
            unread_count: 0,
            pending_invitation_count: 9,
        } as any);

        setPendingInvitationBadge(2);
        const page = makePage({ channelId: 'ch-1' });
        await (page as any).loadData();

        expect(getPendingInvitationBadge()).toBe(2);
    });

    it('后端未返回 pending_invitation_count 时红点归零', async () => {
        vi.mocked(api.listSummaries).mockResolvedValue({ items: [], total: 0 } as any);

        setPendingInvitationBadge(4);
        const page = makePage();
        await (page as any).loadData();

        expect(getPendingInvitationBadge()).toBe(0);
    });

    it('跨 Space 的迟到列表响应不覆盖新 Space badge', async () => {
        const response = deferred<any>();
        vi.mocked(api.listSummaries).mockReturnValueOnce(response.promise);
        setPendingInvitationBadge(2);

        WKApp.shared.currentSpaceId = 'space-a';
        const page = makePage();
        const pending = (page as any).loadData();
        WKApp.shared.currentSpaceId = 'space-b';
        response.resolve({ items: [], total: 0, pending_invitation_count: 9 });
        await pending;

        expect(getPendingInvitationBadge()).toBe(2);
    });

    it('卸载后的列表响应不再写全局 badge', async () => {
        const response = deferred<any>();
        vi.mocked(api.listSummaries).mockReturnValueOnce(response.promise);
        setPendingInvitationBadge(2);

        const page = makePage();
        const pending = (page as any).loadData();
        (page as any).isMounted_ = false;
        response.resolve({ items: [], total: 0, pending_invitation_count: 9 });
        await pending;

        expect(getPendingInvitationBadge()).toBe(2);
    });
});
