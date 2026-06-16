import React from 'react';
import { render as rtlRender, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ChatSelectorModal from '../ChatSelectorModal';
import WKApp from '@octo/base/src/App';
import type { ChatCandidate } from '../../types/summary';

const mockGetChatCandidates = vi.fn();
const mockSidebarSync = vi.fn();

vi.mock('../../api/summaryApi', () => ({
    getChatCandidates: (...args: any[]) => mockGetChatCandidates(...args),
}));

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return actual;
});

// Controllable SidebarService mock. `sync` is called twice per loadCandidates
// (tab:"follow" then tab:"recent"); keep SidebarTargetType a real object so the
// component's chatTypeToTargetType reads .DM/.THREAD/.CHANNEL synchronously.
vi.mock('@octo/base/src/Service/SidebarService', () => ({
    default: { sync: (...args: any[]) => mockSidebarSync(...args) },
    SidebarTargetType: { DM: 1, CHANNEL: 2, THREAD: 5 },
}));

vi.mock('@octo/base/src/Components/AiBadge', () => ({
    default: () => <span data-testid="ai-badge" />,
}));

vi.mock('@douyinfe/semi-icons', () => ({
    IconSearch: () => <span data-testid="icon-search" />,
}));

vi.mock('@douyinfe/semi-ui', () => ({
    Modal: ({ children, visible, footer }: any) =>
        visible ? (
            <div data-testid="modal">
                <div data-testid="modal-body">{children}</div>
                <div data-testid="modal-footer">{footer}</div>
            </div>
        ) : null,
    Input: ({ value, onChange, placeholder }: any) => (
        <input
            data-testid="search-input"
            value={value}
            placeholder={placeholder}
            onChange={(e: any) => onChange(e.target.value)}
        />
    ),
    // Render each tab as a clickable control wired to onChange(itemKey) so tests
    // can drive tab switching.
    Tabs: ({ children, onChange }: any) => (
        <div data-testid="tabs">
            {React.Children.map(children, (child: any) => (
                <button
                    data-testid={`tab-${child.props.itemKey}`}
                    onClick={() => onChange?.(child.props.itemKey)}
                >
                    {child.props.tab}
                </button>
            ))}
        </div>
    ),
    TabPane: ({ tab }: any) => <span>{tab}</span>,
    Checkbox: ({ checked, disabled }: any) => (
        <input type="checkbox" readOnly checked={!!checked} disabled={disabled} />
    ),
    Switch: ({ checked, onChange }: any) => (
        <input
            type="checkbox"
            data-testid="include-archived-switch"
            checked={!!checked}
            onChange={(e: any) => onChange(e.target.checked)}
        />
    ),
    Button: ({ children, onClick, disabled }: any) => (
        <button onClick={onClick} disabled={disabled}>{children}</button>
    ),
    Spin: () => <div data-testid="spinner">loading</div>,
    Empty: ({ description }: any) => <div data-testid="empty">{description}</div>,
    Tag: ({ children }: any) => <span data-testid="tag">{children}</span>,
}));

function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

const TARGET_TYPE: Record<ChatCandidate['chat_type'], number> = {
    direct: 1,
    group: 2,
    thread: 5,
};

// Build a backend SidebarItem for a candidate. Only the fields the component
// reads (target_type/target_id/is_followed/timestamp) matter.
function sidebarItem(c: ChatCandidate, overrides: Record<string, unknown> = {}) {
    return {
        target_type: TARGET_TYPE[c.chat_type],
        target_id: c.chat_id,
        channel_type: 0,
        channel_id: c.chat_id,
        timestamp: 0,
        unread: 0,
        is_pinned: false,
        is_followed: true,
        ...overrides,
    };
}

// Drive the follow/recent responses keyed on req.tab (sync is called once per tab).
function setupSidebar(followItems: unknown[] = [], recentItems: unknown[] = []) {
    mockSidebarSync.mockImplementation((req: any) => {
        if (req?.tab === 'recent') {
            return Promise.resolve({ items: recentItems, version: 0, follow_version: 0 });
        }
        return Promise.resolve({ items: followItems, version: 0, follow_version: 0 });
    });
}

const ACTIVE_THREAD: ChatCandidate = {
    chat_id: 't-active',
    chat_type: 'thread',
    name: 'Active Thread',
    member_count: 3,
    is_archived: false,
};

const ARCHIVED_THREAD: ChatCandidate = {
    chat_id: 't-archived',
    chat_type: 'thread',
    name: 'Archived Thread',
    member_count: 2,
    is_archived: true,
};

const baseProps = {
    selected: [],
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
};

// The modal loads candidates on a visible false→true transition
// (componentDidUpdate), so we mount closed then re-render open.
async function open(initialCandidates: ChatCandidate[]) {
    mockGetChatCandidates.mockResolvedValue(initialCandidates);
    let utils: ReturnType<typeof rtlRender>;
    await act(async () => {
        utils = rtlRender(<ChatSelectorModal {...baseProps} visible={false} />, { legacyRoot: true });
    });
    await act(async () => {
        utils!.rerender(<ChatSelectorModal {...baseProps} visible={true} />);
        await flushPromises();
    });
    return utils!;
}

async function switchTab(utils: ReturnType<typeof rtlRender>, key: string) {
    await act(async () => {
        fireEvent.click(utils.getByTestId(`tab-${key}`));
        await flushPromises();
    });
}

describe('ChatSelectorModal — include-archived toggle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default tab is "followed"; mark both threads as followed so the
        // archived-toggle assertions (which run on the followed tab) are not
        // filtered out by the follow set.
        setupSidebar([sidebarItem(ACTIVE_THREAD), sidebarItem(ARCHIVED_THREAD)]);
    });

    it('fetches candidates without include_archived when toggle is off (default)', async () => {
        await open([ACTIVE_THREAD]);

        expect(mockGetChatCandidates).toHaveBeenCalledTimes(1);
        const firstCallArg = mockGetChatCandidates.mock.calls[0][0];
        expect(firstCallArg?.include_archived).toBeFalsy();
    });

    it('shows the include-archived label and helper text', async () => {
        const utils = await open([ACTIVE_THREAD]);

        expect(utils.getByText('包含已归档子区')).toBeInTheDocument();
        expect(utils.getByText('默认不含已归档子区，开启后可选择归档子区')).toBeInTheDocument();
    });

    it('re-fetches with include_archived=true and renders an Archived tag when toggled on', async () => {
        const utils = await open([ACTIVE_THREAD]);

        // archived row absent before opting in
        expect(utils.queryByText('Archived Thread')).not.toBeInTheDocument();

        // backend returns the archived thread once the flag is set
        mockGetChatCandidates.mockResolvedValueOnce([ACTIVE_THREAD, ARCHIVED_THREAD]);

        const toggle = utils.getByTestId('include-archived-switch');
        await act(async () => {
            fireEvent.click(toggle);
            await flushPromises();
        });

        expect(mockGetChatCandidates).toHaveBeenCalledTimes(2);
        expect(mockGetChatCandidates.mock.calls[1][0]).toEqual({ include_archived: true });

        expect(utils.getByText('Archived Thread')).toBeInTheDocument();
        const tags = utils.getAllByTestId('tag').map((el) => el.textContent);
        expect(tags).toContain('已归档');
    });

    it('resets the toggle and fetches without include_archived on reopen after archived was on', async () => {
        const utils = await open([ACTIVE_THREAD]);

        // opt in to archived
        mockGetChatCandidates.mockResolvedValueOnce([ACTIVE_THREAD, ARCHIVED_THREAD]);
        const toggle = utils.getByTestId('include-archived-switch');
        await act(async () => {
            fireEvent.click(toggle);
            await flushPromises();
        });
        expect(mockGetChatCandidates.mock.calls[1][0]).toEqual({ include_archived: true });

        // close the modal (the instance is never unmounted; parent drives `visible`)
        await act(async () => {
            utils.rerender(<ChatSelectorModal {...baseProps} visible={false} />);
            await flushPromises();
        });

        // reopen — the first fetch must NOT carry the archived flag despite the
        // prior toggle, because setState is async and we pass the value explicitly.
        mockGetChatCandidates.mockResolvedValueOnce([ACTIVE_THREAD]);
        await act(async () => {
            utils.rerender(<ChatSelectorModal {...baseProps} visible={true} />);
            await flushPromises();
        });

        expect(mockGetChatCandidates).toHaveBeenCalledTimes(3);
        const reopenArg = mockGetChatCandidates.mock.calls[2][0];
        expect(reopenArg?.include_archived).toBeFalsy();

        // and the Switch renders OFF
        expect((utils.getByTestId('include-archived-switch') as HTMLInputElement).checked).toBe(false);
    });

    it('drops a stale response when an earlier request resolves after a later one', async () => {
        // First load (open) resolves immediately with the active thread.
        const utils = await open([ACTIVE_THREAD]);

        // Set up two overlapping loads with manually controlled resolution.
        let resolveFirst!: (v: ChatCandidate[]) => void;
        let resolveSecond!: (v: ChatCandidate[]) => void;
        const firstPromise = new Promise<ChatCandidate[]>((r) => { resolveFirst = r; });
        const secondPromise = new Promise<ChatCandidate[]>((r) => { resolveSecond = r; });

        mockGetChatCandidates.mockReturnValueOnce(firstPromise);
        mockGetChatCandidates.mockReturnValueOnce(secondPromise);

        const toggle = utils.getByTestId('include-archived-switch');

        // Kick off the first overlapping load (archived ON) — does not resolve yet.
        await act(async () => {
            fireEvent.click(toggle);
        });
        // Kick off the second overlapping load (archived OFF) — does not resolve yet.
        await act(async () => {
            fireEvent.click(toggle);
        });

        // The LATER request resolves first...
        await act(async () => {
            resolveSecond([ACTIVE_THREAD]);
            await flushPromises();
        });
        // ...then the EARLIER (stale) request resolves last with different data.
        await act(async () => {
            resolveFirst([ACTIVE_THREAD, ARCHIVED_THREAD]);
            await flushPromises();
        });

        // Final state must reflect the LATER request, not the stale earlier one.
        expect(utils.queryByText('Archived Thread')).not.toBeInTheDocument();
        expect(utils.getByText('Active Thread')).toBeInTheDocument();
    });
});

describe('ChatSelectorModal — composite key helpers', () => {
    it('maps chat_type to the SidebarTargetType enum (group as default)', () => {
        expect(ChatSelectorModal.chatTypeToTargetType('direct')).toBe(1);
        expect(ChatSelectorModal.chatTypeToTargetType('thread')).toBe(5);
        expect(ChatSelectorModal.chatTypeToTargetType('group')).toBe(2);
        expect(ChatSelectorModal.chatTypeToTargetType('something-unknown')).toBe(2);
    });

    it('builds a type-prefixed composite key', () => {
        expect(ChatSelectorModal.compositeKey('direct', 'x')).toBe('1::x');
        expect(ChatSelectorModal.compositeKey('thread', 'x')).toBe('5::x');
        expect(ChatSelectorModal.compositeKey('group', 'x')).toBe('2::x');
    });

    it('does not collide across types sharing the same id', () => {
        expect(ChatSelectorModal.compositeKey('direct', '42')).not.toBe(
            ChatSelectorModal.compositeKey('group', '42'),
        );
    });
});

const GROUP_A: ChatCandidate = { chat_id: 'g-a', chat_type: 'group', name: 'Group A', member_count: 5 };
const GROUP_B: ChatCandidate = { chat_id: 'g-b', chat_type: 'group', name: 'Group B', member_count: 6 };
const GROUP_C: ChatCandidate = { chat_id: 'g-c', chat_type: 'group', name: 'Group C', member_count: 7 };
const DIRECT_X: ChatCandidate = { chat_id: 'd-x', chat_type: 'direct', name: 'Direct X', member_count: null };

describe('ChatSelectorModal — followed tab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders only candidates whose composite key is followed, excluding is_followed:false', async () => {
        setupSidebar([
            sidebarItem(GROUP_A, { is_followed: true }),
            sidebarItem(GROUP_B, { is_followed: false }),
        ]);
        const utils = await open([GROUP_A, GROUP_B]);

        expect(utils.getByText('Group A')).toBeInTheDocument();
        expect(utils.queryByText('Group B')).not.toBeInTheDocument();
    });
});

describe('ChatSelectorModal — recent tab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders only recent candidates, sorted by timestamp DESC, missing order falls back to 0', async () => {
        setupSidebar(
            [],
            [
                sidebarItem(GROUP_B, { timestamp: 300 }),
                sidebarItem(GROUP_A, { timestamp: 100 }),
                // GROUP_C is recent but carries no timestamp → order falls back to 0
                sidebarItem(GROUP_C, { timestamp: undefined }),
            ],
        );
        const utils = await open([GROUP_A, GROUP_B, GROUP_C, DIRECT_X]);

        await switchTab(utils, 'recent');

        // DIRECT_X is not in the recent set → hidden
        expect(utils.queryByText('Direct X')).not.toBeInTheDocument();
        expect(utils.getByText('Group A')).toBeInTheDocument();
        expect(utils.getByText('Group B')).toBeInTheDocument();
        expect(utils.getByText('Group C')).toBeInTheDocument();

        const body = utils.getByTestId('modal-body').textContent ?? '';
        const iB = body.indexOf('Group B');
        const iA = body.indexOf('Group A');
        const iC = body.indexOf('Group C');
        // 300 > 100 > 0 (fallback), no NaN ordering glitches
        expect(iB).toBeGreaterThanOrEqual(0);
        expect(iB).toBeLessThan(iA);
        expect(iA).toBeLessThan(iC);
    });
});

describe('ChatSelectorModal — group/direct tabs ignore sidebar sync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // empty follow/recent — these tabs must still show their full type
        setupSidebar([], []);
    });

    it('group tab shows all groups and threads regardless of sync, and hides directs', async () => {
        const utils = await open([GROUP_A, ACTIVE_THREAD, DIRECT_X]);

        await switchTab(utils, 'group');

        expect(utils.getByText('Group A')).toBeInTheDocument();
        expect(utils.getByText('Active Thread')).toBeInTheDocument();
        expect(utils.queryByText('Direct X')).not.toBeInTheDocument();
    });

    it('direct tab shows all directs regardless of sync', async () => {
        const utils = await open([GROUP_A, DIRECT_X]);

        await switchTab(utils, 'direct');

        expect(utils.getByText('Direct X')).toBeInTheDocument();
        expect(utils.queryByText('Group A')).not.toBeInTheDocument();
    });
});

describe('ChatSelectorModal — sidebar sync behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupSidebar([], []);
    });

    it('calls sync twice per load with the correct tab and device_uuid', async () => {
        await open([GROUP_A]);

        expect(mockSidebarSync).toHaveBeenCalledTimes(2);
        const tabs = mockSidebarSync.mock.calls.map((c) => c[0]);
        expect(tabs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ tab: 'follow', device_uuid: 'test-device-uuid' }),
                expect.objectContaining({ tab: 'recent', device_uuid: 'test-device-uuid' }),
            ]),
        );
    });

    it('falls back gracefully when sync rejects: modal renders, non-filtering tabs still show candidates', async () => {
        mockSidebarSync.mockRejectedValue(new Error('boom'));

        const utils = await open([GROUP_A]);

        // modal renders, no throw
        expect(utils.getByTestId('modal')).toBeInTheDocument();
        // followed tab (default) has an empty follow set → group filtered out
        expect(utils.queryByText('Group A')).not.toBeInTheDocument();

        // group tab does not depend on the follow set → candidate displays
        await switchTab(utils, 'group');
        expect(utils.getByText('Group A')).toBeInTheDocument();
    });

    it('skips both sync calls when deviceId is empty (doomed request guard)', async () => {
        const original = WKApp.shared.deviceId;
        WKApp.shared.deviceId = '';
        try {
            const utils = await open([GROUP_A]);

            expect(mockSidebarSync).not.toHaveBeenCalled();
            expect(utils.getByTestId('modal')).toBeInTheDocument();

            // group tab still works (does not need the follow/recent sets)
            await switchTab(utils, 'group');
            expect(utils.getByText('Group A')).toBeInTheDocument();
        } finally {
            WKApp.shared.deviceId = original;
        }
    });
});
