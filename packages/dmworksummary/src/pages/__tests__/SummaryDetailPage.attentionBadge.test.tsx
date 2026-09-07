/**
 * SummaryDetailPage — 侧边栏待关注红点的刷新触点。
 *
 * attention_count 现在包含未读 ∪ 未处理邀请 ∪ 待提交，但侧边栏红点只由全局
 * SummaryListPage.loadData 回写。详情页这三条路径都会改变 space 级计数，而
 * 全局列表可能根本没挂载（聊天侧栏打开详情 / 深链直进），或者挂载了却不会
 * 因此重拉（summary-read 不触发 loadData）。所以必须在详情页显式重算。
 *
 * 其中「标已读」是最要命的一条：读是 attention_count 最频繁的减少来源。不刷
 * 的话，用户读完三条未读，三个卡片红点都消失、导航栏依旧显示 3，直到切模块
 * 或切 Space 才自愈。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('wukongimjssdk', () => ({
    Channel: class {
        constructor(public channelID: string, public channelType: number) {}
    },
    ChannelTypeGroup: 2,
    ChannelTypePerson: 1,
    MessageText: class {},
    WKSDK: { shared: () => ({ chatManager: { send: vi.fn() } }) },
}));
vi.mock('@douyinfe/semi-ui', () => {
    const Passthrough = ({ children }: any) => children ?? null;
    const Typography: any = Passthrough;
    Typography.Text = Passthrough;
    const Dropdown: any = Passthrough;
    Dropdown.Menu = Passthrough;
    Dropdown.Item = Passthrough;
    return {
        Button: Passthrough,
        Typography,
        Tag: Passthrough,
        Avatar: Passthrough,
        Spin: Passthrough,
        Modal: Passthrough,
        Banner: Passthrough,
        Input: Passthrough,
        Checkbox: Passthrough,
        Empty: Passthrough,
        Popconfirm: Passthrough,
        Dropdown,
        Toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    };
});
vi.mock('@douyinfe/semi-icons', () => ({
    IconPlus: () => null,
    IconClock: () => null,
    IconArrowLeft: () => null,
    IconRefresh: () => null,
    IconDelete: () => null,
    IconEdit: () => null,
    IconMore: () => null,
    IconSend: () => null,
    IconChevronDown: () => null,
    IconUser: () => null,
    IconTick: () => null,
    IconClose: () => null,
    IconInfoCircle: () => null,
    IconHistory: () => null,
    IconSearch: () => null,
    IconMinusCircle: () => null,
    IconExit: () => null,
}));
vi.mock('../../utils/summaryAttentionBadge', () => ({
    refreshSummaryAttentionBadge: vi.fn(),
}));
vi.mock('../../api/summaryApi');

import * as api from '../../api/summaryApi';
import SummaryDetailPage from '../SummaryDetailPage';
import { refreshSummaryAttentionBadge } from '../../utils/summaryAttentionBadge';
import { TaskStatus } from '../../types/summary';

function makePage(taskId: number) {
    const page = new SummaryDetailPage({ taskId } as any);
    (page as any).context = { t: (k: string) => k };
    (page as any).setState = function (this: any, patch: any) {
        this.state = { ...this.state, ...(typeof patch === 'function' ? patch(this.state) : patch) };
    };
    // taskId 是从 props 派生的 getter（数字直用，字符串 task_no 深链回填），
    // 不可直写——传 props 就够了。
    return page;
}

describe('SummaryDetailPage — attention badge refresh triggers', () => {
    beforeEach(() => vi.clearAllMocks());

    it('提交个人总结后重算侧边栏计数', async () => {
        vi.mocked(api.submitPersonalResult).mockResolvedValue(undefined as any);
        const page = makePage(11);
        // 这三个是提交成功后的连带刷新，与本测试无关，打桩掉。
        vi.spyOn(page as any, 'loadPersonalResult').mockImplementation(() => {});
        vi.spyOn(page as any, 'loadMembers').mockImplementation(() => {});
        vi.spyOn(page as any, 'loadDetail').mockImplementation(() => {});

        await page.handleSubmitPersonal();

        expect(api.submitPersonalResult).toHaveBeenCalledWith(11);
        expect(refreshSummaryAttentionBadge).toHaveBeenCalledTimes(1);
    });

    it('提交失败不重算（计数没变，不该白发一次请求）', async () => {
        vi.mocked(api.submitPersonalResult).mockRejectedValue(new Error('boom'));
        const page = makePage(11);
        vi.spyOn(page as any, 'loadPersonalResult').mockImplementation(() => {});
        vi.spyOn(page as any, 'loadMembers').mockImplementation(() => {});
        vi.spyOn(page as any, 'loadDetail').mockImplementation(() => {});

        await page.handleSubmitPersonal();

        expect(refreshSummaryAttentionBadge).not.toHaveBeenCalled();
    });

    it.each(['accept', 'reject'] as const)('应答邀请（%s）后重算侧边栏计数', async (action) => {
        vi.mocked(api.respondToTask).mockResolvedValue(undefined as any);
        const page = makePage(12);
        vi.spyOn(page as any, 'loadDetail').mockImplementation(() => {});

        await page.handleRespondToTask(action);

        expect(api.respondToTask).toHaveBeenCalledWith(12, action);
        expect(refreshSummaryAttentionBadge).toHaveBeenCalledTimes(1);
    });

    it('应答失败不重算', async () => {
        vi.mocked(api.respondToTask).mockRejectedValue(new Error('boom'));
        const page = makePage(12);
        vi.spyOn(page as any, 'loadDetail').mockImplementation(() => {});

        await page.handleRespondToTask('accept');

        expect(refreshSummaryAttentionBadge).not.toHaveBeenCalled();
    });

    // P1：读是 attention_count 最频繁的减少来源。标读后不重算，卡片红点消失
    // 而导航栏数字停在旧值，直到切模块/切 Space 才自愈。
    it('团队总结标已读后重算侧边栏计数，并透传 hasPendingSubmission', async () => {
        vi.mocked(api.getSummaryDetail).mockResolvedValue({
            task_id: 21, status: TaskStatus.COMPLETED, result_id: 501, result: 'team',
        } as any);
        vi.mocked(api.markSummaryRead).mockResolvedValue({
            is_unread: false, has_pending_invitation: false,
            has_pending_submission: true, needs_attention: true,
        } as any);

        const events: any[] = [];
        const listener = (e: Event) => events.push((e as CustomEvent).detail);
        window.addEventListener('summary-read', listener);
        try {
            const page = makePage(21);
            vi.spyOn(page as any, 'loadVersions').mockImplementation(() => {});
            vi.spyOn(page as any, 'publishDetailTitle').mockImplementation(() => {});
            vi.spyOn(page as any, 'notifyGroupsOnCompletion').mockImplementation(() => {});

            await page.loadDetail();
            await Promise.resolve();
            await Promise.resolve();
        } finally {
            window.removeEventListener('summary-read', listener);
        }

        expect(api.markSummaryRead).toHaveBeenCalledWith(21, { team_result_id: 501 });
        expect(refreshSummaryAttentionBadge).toHaveBeenCalledTimes(1);
        // 服务端刚回的待提交态必须随事件送出，否则列表无法区分
        // 「旧后端没返回」和「确实不欠提交」。
        expect(events.at(-1)).toMatchObject({ taskId: 21, isUnread: false, hasPendingSubmission: true });
    });
});
