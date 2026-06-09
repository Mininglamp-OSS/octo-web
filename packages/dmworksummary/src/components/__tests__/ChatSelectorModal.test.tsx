import React from 'react';
import { render as rtlRender, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ChatSelectorModal from '../ChatSelectorModal';
import type { ChatCandidate } from '../../types/summary';

const mockGetChatCandidates = vi.fn();

vi.mock('../../api/summaryApi', () => ({
    getChatCandidates: (...args: any[]) => mockGetChatCandidates(...args),
}));

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return actual;
});

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
    Tabs: ({ children }: any) => <div data-testid="tabs">{children}</div>,
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

describe('ChatSelectorModal — include-archived toggle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
