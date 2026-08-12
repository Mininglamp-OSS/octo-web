/**
 * SummaryListPage 侧边栏邀请红点接线测试 (#1359)。
 *
 * loadData 成功时顺带用后端 pending_invitation_count 同步 NavRail
 * 菜单红点；聊天侧栏（channelId 过滤）场景不同步，因为后端 count
 * 是 channel-scoped，不能代表整个 space 的未处理邀请数。
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
import SummaryListPage from '../SummaryListPage';
import { getPendingInvitationBadge, setPendingInvitationBadge } from '../../utils/summaryMenuBadge';

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

    it('聊天侧栏（带 channelId）loadData 不覆盖 space 级红点', async () => {
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

        // channel-scoped count 不代表整个 space，红点保持旧值
        expect(getPendingInvitationBadge()).toBe(2);
    });

    it('后端未返回 pending_invitation_count 时红点归零', async () => {
        vi.mocked(api.listSummaries).mockResolvedValue({ items: [], total: 0 } as any);

        setPendingInvitationBadge(4);
        const page = makePage();
        await (page as any).loadData();

        expect(getPendingInvitationBadge()).toBe(0);
    });
});
