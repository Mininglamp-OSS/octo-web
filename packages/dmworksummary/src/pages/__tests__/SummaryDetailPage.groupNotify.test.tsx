import { describe, expect, it, vi, beforeEach } from 'vitest';

// octo-web#289 (review 返工): 群内总结 tip 的可靠性口径。
// 覆盖 sendGroupSummaryNotify:
//  - 仅发起人（creator）、仅群聊源、COMPLETED 才发；
//  - 去重按 (task_id, source_id) 持久化到 localStorage —— 跨实例(多 tab / reload)不重发；
//  - 单个源失败不落标记，下次可重试（不永久漏发）;
//  - 已解散群跳过;
//  - 同实例并发触发不重复发。

const sendMock = vi.hoisted(() => vi.fn());
const disbandedMock = vi.hoisted(() => vi.fn((_ch?: any) => false));

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
    return page;
}

describe('SummaryDetailPage.sendGroupSummaryNotify (octo-web#289)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        sendMock.mockResolvedValue(undefined);
        disbandedMock.mockReturnValue(false);
    });

    it('sends one tip per group source, skips non-group sources', async () => {
        await newPage().sendGroupSummaryNotify(makeDetail());
        expect(sendMock).toHaveBeenCalledTimes(2);
        const channelIds = sendMock.mock.calls.map((c) => c[1].channelID).sort();
        expect(channelIds).toEqual(['group-a', 'group-b']);
        sendMock.mock.calls.forEach((c) => expect(c[1].channelType).toBe(2));
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

    it('does not resend across instances (multi-tab / reload) via persistent marker', async () => {
        const detail = makeDetail();
        await newPage().sendGroupSummaryNotify(detail);
        expect(sendMock).toHaveBeenCalledTimes(2);
        // 新实例（模拟 reload / 另一个 tab）：持久标记已记录 → 不再重发。
        await newPage().sendGroupSummaryNotify(detail);
        expect(sendMock).toHaveBeenCalledTimes(2);
    });

    it('retries a source that failed to send (no marker on failure)', async () => {
        // group-b 首次发送失败、之后成功；其余源始终成功。
        let bAttempts = 0;
        sendMock.mockImplementation((_msg: any, ch: any) => {
            if (ch.channelID === 'group-b') {
                bAttempts += 1;
                if (bAttempts === 1) return Promise.reject(new Error('transient'));
            }
            return Promise.resolve(undefined);
        });
        const detail = makeDetail();
        await newPage().sendGroupSummaryNotify(detail); // a ok, b fail
        // 再次触发（同 task）：a 已标记跳过，b 未标记 → 只重试 b，且这次成功。
        await newPage().sendGroupSummaryNotify(detail);
        const targets = sendMock.mock.calls.map((c) => c[1].channelID);
        expect(targets.filter((id) => id === 'group-a')).toEqual(['group-a']); // a 只发一次
        expect(targets.filter((id) => id === 'group-b').length).toBe(2); // b 失败后重试
        // 重试成功后再触发不应再发。
        sendMock.mockClear();
        await newPage().sendGroupSummaryNotify(detail);
        expect(sendMock).not.toHaveBeenCalled();
    });

    it('skips disbanded group sources and does not mark them', async () => {
        disbandedMock.mockImplementation((ch: any) => ch.channelID === 'group-b');
        const detail = makeDetail();
        await newPage().sendGroupSummaryNotify(detail);
        const targets = sendMock.mock.calls.map((c) => c[1].channelID);
        expect(targets).toEqual(['group-a']); // group-b 已解散被跳过
        // group-b 未落标记：若之后恢复（不再解散），仍可补发。
        disbandedMock.mockReturnValue(false);
        sendMock.mockClear();
        await newPage().sendGroupSummaryNotify(detail);
        expect(sendMock.mock.calls.map((c) => c[1].channelID)).toEqual(['group-b']);
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
});
