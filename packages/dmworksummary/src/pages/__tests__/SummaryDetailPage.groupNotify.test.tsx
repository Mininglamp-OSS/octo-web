import { describe, expect, it, vi, beforeEach } from 'vitest';

// octo-web#289: 群内总结 tip 的 v1 行为。
// 覆盖 sendGroupSummaryNotify:
//  - 仅发起人（creator）、仅群聊源、COMPLETED 才发；
//  - 同一完成轮次只发一次；同一 task 重新生成产生新 result_id 后再次发送；
//  - 单个源失败 console.warn 且不影响其余源;
//  - 已解散群跳过;
//  - 同实例并发触发不重复发。

const sendMock = vi.hoisted(() => vi.fn());
const disbandedMock = vi.hoisted(() => vi.fn((_ch?: any) => false));
const getSummaryDetailMock = vi.hoisted(() => vi.fn());
const batchStatusMock = vi.hoisted(() => vi.fn());

vi.mock('../../api/summaryApi', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getSummaryDetail: getSummaryDetailMock,
    batchStatus: batchStatusMock,
}));

vi.mock('wukongimjssdk', () => ({
    Channel: class {
        channelID: string;
        channelType: number;
        constructor(channelID: string, channelType: number) {
            this.channelID = channelID;
            this.channelType = channelType;
        }
    },
    ChannelTypeGroup: 2,
    ChannelTypePerson: 1,
    MessageContent: class {},
    MessageText: class {},
    WKSDK: { shared: () => ({ chatManager: { send: sendMock } }) },
}));

// @octo/base 在 vitest.config 里已被 alias 到 __mocks__/dmworkBase.ts；这里只覆盖
// isConversationDisbanded 为可控 mock，其余（WKApp / t / SummaryNotifyContent）保持原样。
vi.mock('@octo/base', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, isConversationDisbanded: disbandedMock };
});

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
        Dropdown,
        Popover: Passthrough,
        Toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    };
});

vi.mock('@douyinfe/semi-icons', () => ({
    IconEdit: () => null,
    IconMore: () => null,
    IconSend: () => null,
    IconClock: () => null,
    IconTick: () => null,
    IconClose: () => null,
    IconInfoCircle: () => null,
    IconHistory: () => null,
    IconUser: () => null,
    IconPlus: () => null,
    IconMinusCircle: () => null,
    IconExit: () => null,
}));
vi.mock('../../components/CitationText', () => ({ default: () => null }));
vi.mock('../../components/SummaryEditor', () => ({ default: () => null }));

import SummaryDetailPage from '../SummaryDetailPage';
import { SummaryMode, TaskStatus, SourceType } from '../../types/summary';

// creator = "test-uid"（见 __mocks__/dmworkBase.ts 的 WKApp.loginInfo.uid）
const ME = 'test-uid';

function makeDetail(over: any = {}) {
    return {
        task_id: 1,
        result_id: 10,
        updated_at: '2026-08-05T00:00:00Z',
        summary_mode: SummaryMode.BY_GROUP,
        status: TaskStatus.COMPLETED,
        creator_id: ME,
        sources: [
            { source_type: SourceType.GROUP_CHAT, source_id: 'group-a' },
            { source_type: SourceType.GROUP_CHAT, source_id: 'group-b' },
            { source_type: SourceType.DIRECT_MESSAGE, source_id: 'dm-c' },
        ],
        ...over,
    };
}

function newPage() {
    const page: any = new SummaryDetailPage({ taskId: 1 });
    // React 未挂载实例的 setState 是 no-op；测试私有事件接线时同步合并状态。
    page.setState = (next: any) => {
        const patch = typeof next === 'function' ? next(page.state, page.props) : next;
        page.state = { ...page.state, ...patch };
    };
    return page;
}

describe('SummaryDetailPage.sendGroupSummaryNotify (octo-web#289)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        sendMock.mockResolvedValue(undefined);
        disbandedMock.mockReturnValue(false);
        getSummaryDetailMock.mockReset();
        batchStatusMock.mockReset();
    });

    it('sends one tip per group source, skips non-group sources', async () => {
        await newPage().sendGroupSummaryNotify(makeDetail());
        expect(sendMock).toHaveBeenCalledTimes(2);
        const channelIds = sendMock.mock.calls.map((c) => c[1].channelID).sort();
        expect(channelIds).toEqual(['group-a', 'group-b']);
        sendMock.mock.calls.forEach((c) => expect(c[1].channelType).toBe(2));
        sendMock.mock.calls.forEach((c) => {
            expect(c[0]).toMatchObject({
                fromUID: ME,
                fromName: 'Verified Test User',
            });
        });
    });

    it('deduplicates repeated group source ids within one detail response', async () => {
        const detail = makeDetail({
            sources: [
                { source_type: SourceType.GROUP_CHAT, source_id: 'group-a' },
                { source_type: SourceType.GROUP_CHAT, source_id: 'group-a' },
            ],
        });
        await newPage().sendGroupSummaryNotify(detail);
        expect(sendMock).toHaveBeenCalledTimes(1);
        expect(sendMock.mock.calls[0][1].channelID).toBe('group-a');
    });

    it('does not send when the current user is not the creator', async () => {
        await newPage().sendGroupSummaryNotify(makeDetail({ creator_id: 'someone-else' }));
        expect(sendMock).not.toHaveBeenCalled();
    });

    it('does not send when status is not COMPLETED', async () => {
        await newPage().sendGroupSummaryNotify(makeDetail({ status: TaskStatus.PROCESSING }));
        expect(sendMock).not.toHaveBeenCalled();
    });

    it('does not send when there are no group sources', async () => {
        await newPage().sendGroupSummaryNotify(
            makeDetail({ sources: [{ source_type: SourceType.DIRECT_MESSAGE, source_id: 'dm-c' }] })
        );
        expect(sendMock).not.toHaveBeenCalled();
    });

    it('sends again when the same task completes in a new result run (AC5)', async () => {
        await newPage().sendGroupSummaryNotify(makeDetail({ result_id: 10 }));
        expect(sendMock).toHaveBeenCalledTimes(2);
        await newPage().sendGroupSummaryNotify(makeDetail({ result_id: 11 }));
        expect(sendMock).toHaveBeenCalledTimes(4);
    });

    it('does not resend the same completion run across instances', async () => {
        const detail = makeDetail({ result_id: 10 });
        await newPage().sendGroupSummaryNotify(detail);
        await newPage().sendGroupSummaryNotify(detail);
        expect(sendMock).toHaveBeenCalledTimes(2);
    });

    it('warns once with channel and error when one source fails, then continues', async () => {
        const error = new Error('transient');
        sendMock.mockImplementation((_msg: any, ch: any) => {
            if (ch.channelID === 'group-a') return Promise.reject(error);
            return Promise.resolve(undefined);
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await newPage().sendGroupSummaryNotify(makeDetail());

        expect(sendMock.mock.calls.map((c) => c[1].channelID)).toEqual(['group-a', 'group-b']);
        expect(warn).toHaveBeenCalledOnce();
        expect(warn).toHaveBeenCalledWith(
            'Failed to send group summary notification',
            expect.objectContaining({ channelID: 'group-a', channelType: 2 }),
            error,
        );
        warn.mockRestore();
    });

    it('skips disbanded group sources', async () => {
        disbandedMock.mockImplementation((ch: any) => ch.channelID === 'group-b');
        const detail = makeDetail();
        await newPage().sendGroupSummaryNotify(detail);
        const targets = sendMock.mock.calls.map((c) => c[1].channelID);
        expect(targets).toEqual(['group-a']); // group-b 已解散被跳过
    });

    it('does not double-send under concurrent invocations on the same instance', async () => {
        const page = newPage();
        const detail = makeDetail();
        await Promise.all([
            page.sendGroupSummaryNotify(detail),
            page.sendGroupSummaryNotify(detail),
        ]);
        expect(sendMock).toHaveBeenCalledTimes(2);
        expect(sendMock.mock.calls.map((c) => c[1].channelID).sort()).toEqual(['group-a', 'group-b']);
    });

    it('wires an observed status event transition to the notify path', async () => {
        const page = newPage();
        const detail = makeDetail();
        page.state.lastKnownStatus = TaskStatus.PROCESSING;
        getSummaryDetailMock.mockResolvedValue(detail);
        const notify = vi.spyOn(page, 'sendGroupSummaryNotify').mockResolvedValue(undefined);

        await page.handleStatusChangeEvent(new CustomEvent('status', { detail: { taskIds: [1] } }));

        expect(notify).toHaveBeenCalledOnce();
        expect(notify).toHaveBeenCalledWith(detail);
    });

    it('notifies on both COMPLETED transitions when the same task is regenerated', async () => {
        const page = newPage();
        const processing = makeDetail({ status: TaskStatus.PROCESSING });
        const firstCompleted = makeDetail({ result_id: 10 });
        const secondCompleted = makeDetail({ result_id: 11 });
        page.state.lastKnownStatus = TaskStatus.PROCESSING;
        getSummaryDetailMock
            .mockResolvedValueOnce(firstCompleted)
            .mockResolvedValueOnce(processing)
            .mockResolvedValueOnce(secondCompleted);
        const notify = vi.spyOn(page, 'sendGroupSummaryNotify').mockResolvedValue(undefined);
        const event = new CustomEvent('status', { detail: { taskIds: [1] } });

        await page.handleStatusChangeEvent(event); // PROCESSING -> COMPLETED
        await page.handleStatusChangeEvent(event); // regenerate: COMPLETED -> PROCESSING
        await page.handleStatusChangeEvent(event); // PROCESSING -> COMPLETED again

        expect(notify).toHaveBeenCalledTimes(2);
        expect(notify).toHaveBeenNthCalledWith(1, firstCompleted);
        expect(notify).toHaveBeenNthCalledWith(2, secondCompleted);
    });

    it('does not notify when the first observed status is already COMPLETED', async () => {
        const page = newPage();
        page.state.lastKnownStatus = undefined;
        getSummaryDetailMock.mockResolvedValue(makeDetail());
        const notify = vi.spyOn(page, 'sendGroupSummaryNotify').mockResolvedValue(undefined);

        await page.handleStatusChangeEvent(new CustomEvent('status', { detail: { taskIds: [1] } }));

        expect(notify).not.toHaveBeenCalled();
    });

    it('wires an observed fallback-poll transition to the notify path', async () => {
        const page = newPage();
        const detail = makeDetail();
        page.state.lastKnownStatus = TaskStatus.PROCESSING;
        batchStatusMock.mockResolvedValue([{ id: 1, status: TaskStatus.COMPLETED }]);
        getSummaryDetailMock.mockResolvedValue(detail);
        const notify = vi.spyOn(page, 'sendGroupSummaryNotify').mockResolvedValue(undefined);

        await page.doFallbackPollOnce();

        expect(notify).toHaveBeenCalledOnce();
        expect(notify).toHaveBeenCalledWith(detail);
    });
});
