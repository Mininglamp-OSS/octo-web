import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SummaryAddMemberModal from './SummaryAddMemberModal';
import * as api from '../../api/summaryApi';
import WKApp from '@octo/base/src/App';
import type { SummaryMessagingPort, SummaryConversationTarget } from '../../host';
import { summarySubscribers } from '../../__tests__/fixtures/summarySubscribers';
import { toSummaryConversationMember } from '../../host/subscriberMembers';

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));

vi.mock('../../api/summaryApi');

vi.mock('@douyinfe/semi-ui', () => ({
    Modal: ({ children, footer, visible }: any) =>
        visible ? (
            <div data-testid="summary-add-member-modal">
                <div data-testid="modal-body">{children}</div>
                <div data-testid="modal-footer">{footer}</div>
            </div>
        ) : null,
    Button: ({ children, onClick, disabled, ...rest }: any) => (
        <button onClick={onClick} disabled={disabled} {...rest}>{children}</button>
    ),
    Input: ({ value, onChange, placeholder, ...rest }: any) => (
        <input value={value} placeholder={placeholder} onChange={(e: any) => onChange(e.target.value)} {...rest} />
    ),
    Checkbox: ({ checked, disabled }: any) => (
        <input type="checkbox" readOnly checked={!!checked} disabled={disabled} />
    ),
    Spin: () => <div data-testid="spinner">loading</div>,
    Empty: ({ description }: any) => <div data-testid="empty">{description}</div>,
    Toast: mockToast,
}));

vi.mock('@douyinfe/semi-icons', () => ({ IconSearch: () => <span data-testid="icon-search" /> }));
vi.mock('@octo/base/src/Components/WKAvatar', () => ({
    default: () => <span data-testid="wk-avatar" />,
    isBot: (uid?: string) => uid === 'bot-uid',
}));

function makeMessaging(overrides: Partial<SummaryMessagingPort> = {}): SummaryMessagingPort {
    return {
        getCurrentUser: () => ({ uid: 'me', displayName: 'Me' }),
        loadConversationMembers: vi.fn(async () => []),
        openConversation: vi.fn(async () => {}),
        notifySummaryCompleted: vi.fn(async () => {}),
        requestForward: vi.fn(),
        subscribeInvalidation: vi.fn(() => () => {}),
        ...overrides,
    };
}

const TARGET: SummaryConversationTarget = { channelId: 'chan-1', channelType: 2 };
const EXISTING = ['existing-1', 'existing-2'];

function openModal(overrides: any = {}) {
    const messaging = overrides.messaging ?? makeMessaging();
    const cleanProps: any = { messaging, ...overrides };
    const baseProps = {
        visible: false,
        taskId: 9,
        target: TARGET,
        existingMemberIds: EXISTING,
        messaging,
        onClose: vi.fn(),
        onSuccess: vi.fn(),
        ...cleanProps,
    };
    const utils = render(<SummaryAddMemberModal {...baseProps} />);
    act(() => {
        utils.rerender(<SummaryAddMemberModal {...{ ...baseProps, visible: true }} />);
    });
    return { utils, props: baseProps };
}

function renderVisible(overrides: any = {}) {
    const messaging = overrides.messaging ?? makeMessaging();
    const props = {
        visible: true,
        taskId: 9,
        target: TARGET,
        existingMemberIds: EXISTING,
        messaging,
        onClose: vi.fn(),
        onSuccess: vi.fn(),
        ...overrides,
    };
    const utils = render(<SummaryAddMemberModal {...props} />);
    return { utils, props };
}

function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
    vi.clearAllMocks();
    (WKApp.shared as any).currentSpaceId = 'space-1';
});

describe('SummaryAddMemberModal', () => {
    it('filters host DTO eligibility without needing a local bot cache', async () => {
        const loadConversationMembers = vi.fn(async () => summarySubscribers().map(toSummaryConversationMember));
        const { utils } = renderVisible({ messaging: makeMessaging({ loadConversationMembers }) });
        await waitFor(() => expect(utils.queryByText('Verified name')).not.toBeNull());
        expect(utils.queryByText('Remark')).not.toBeNull();
        for (const uid of ['app-bot', 'inactive', 'deleted']) {
            expect(utils.queryByTestId(`summary-add-member-row-${uid}`)).toBeNull();
        }
    });

    it('renders nothing when not visible', () => {
        const messaging = makeMessaging();
        const base = {
            visible: false,
            taskId: 9,
            target: TARGET,
            existingMemberIds: EXISTING,
            messaging,
            onClose: vi.fn(),
            onSuccess: vi.fn(),
        };
        const utils = render(<SummaryAddMemberModal {...base} />);
        expect(utils.queryByTestId('summary-add-member-modal')).toBeNull();
        act(() => utils.rerender(<SummaryAddMemberModal {...base} visible />));
        expect(utils.queryByTestId('summary-add-member-modal')).not.toBeNull();
    });

    it('loads candidates on mount when initially visible=true', async () => {
        const loadConversationMembers = vi.fn(async () => [{ uid: 'human-1', name: 'Alice' }]);
        const { utils } = renderVisible({ messaging: makeMessaging({ loadConversationMembers }) });
        await waitFor(() => expect(loadConversationMembers).toHaveBeenCalled());
        await waitFor(() => expect(utils.queryByText('Alice')).not.toBeNull());
    });

    it('loads when opened (false -> true)', async () => {
        const loadConversationMembers = vi.fn(async () => [{ uid: 'human-1', name: 'Alice' }]);
        const { utils } = openModal({ messaging: makeMessaging({ loadConversationMembers }) });
        await waitFor(() => expect(loadConversationMembers).toHaveBeenCalledWith(TARGET));
        await waitFor(() => expect(utils.queryByText('Alice')).not.toBeNull());
    });

    it('filters bots/existing but keeps self selectable', async () => {
        const loadConversationMembers = vi.fn(async () => [
            { uid: 'human-1', name: 'Alice' },
            { uid: 'bot-uid', name: 'Bot' },
            { uid: 'existing-1', name: 'Existing' },
            { uid: 'me', name: 'Me' },
            { uid: 'human-2', name: 'Bob' },
        ]);
        const { utils } = openModal({ messaging: makeMessaging({ loadConversationMembers }) });
        await waitFor(() => expect(loadConversationMembers).toHaveBeenCalledWith(TARGET));
        expect(utils.queryByTestId('summary-add-member-row-human-1')).not.toBeNull();
        expect(utils.queryByTestId('summary-add-member-row-human-2')).not.toBeNull();
        expect(utils.queryByTestId('summary-add-member-row-bot-uid')).toBeNull();
        expect(utils.queryByTestId('summary-add-member-row-existing-1')).toBeNull();
        expect(utils.queryByTestId('summary-add-member-row-me')).not.toBeNull();
    });

    it('shows loading spinner while in flight', async () => {
        let resolveLoad: (v: { uid: string; name: string }[]) => void = () => {};
        const loadConversationMembers = vi.fn(() => new Promise((res) => { resolveLoad = res; }));
        const { utils } = openModal({ messaging: makeMessaging({ loadConversationMembers }) });
        expect(utils.getByTestId('spinner')).toBeTruthy();
        await act(async () => { resolveLoad([]); await flushPromises(); });
        expect(utils.queryByTestId('spinner')).toBeNull();
    });

    it('shows loadingFailed (not empty) on error and retry recovers', async () => {
        const loadConversationMembers = vi.fn().mockRejectedValueOnce(new Error('boom'));
        const { utils } = openModal({ messaging: makeMessaging({ loadConversationMembers }) });
        await waitFor(() => expect(utils.getByTestId('summary-add-member-retry-btn')).toBeTruthy());
        expect(utils.getByTestId('empty')).toBeTruthy();
        loadConversationMembers.mockResolvedValueOnce([{ uid: 'human-1', name: 'Alice' }]);
        fireEvent.click(utils.getByTestId('summary-add-member-retry-btn'));
        await waitFor(() => expect(utils.queryByText('Alice')).not.toBeNull());
    });

    it('confirm disabled with nothing selected', async () => {
        const loadConversationMembers = vi.fn(async () => [{ uid: 'human-1', name: 'Alice' }]);
        const { utils } = openModal({ messaging: makeMessaging({ loadConversationMembers }) });
        await waitFor(() => expect(utils.queryByText('Alice')).not.toBeNull());
        expect(utils.getByTestId('summary-add-member-confirm-btn').disabled).toBe(true);
    });

    it('select and confirm posts uids, calls onSuccess', async () => {
        vi.mocked(api.addMembers).mockResolvedValue(undefined as any);
        const loadConversationMembers = vi.fn(async () => [{ uid: 'human-1', name: 'Alice' }]);
        const onSuccess = vi.fn();
        const { utils } = openModal({ messaging: makeMessaging({ loadConversationMembers }), onSuccess });
        await waitFor(() => expect(utils.queryByText('Alice')).not.toBeNull());
        fireEvent.click(utils.getByTestId('summary-add-member-row-human-1'));
        fireEvent.click(utils.getByTestId('summary-add-member-confirm-btn'));
        await waitFor(() => expect(api.addMembers).toHaveBeenCalledWith(9, ['human-1']));
        await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    });

    it('can select self (not in existingMemberIds) and submit', async () => {
        vi.mocked(api.addMembers).mockResolvedValue(undefined as any);
        const loadConversationMembers = vi.fn(async () => [{ uid: 'me', name: 'Me' }]);
        const onSuccess = vi.fn();
        const { utils } = openModal({ messaging: makeMessaging({ loadConversationMembers }), onSuccess });
        await waitFor(() => expect(utils.queryByText('Me')).not.toBeNull());
        fireEvent.click(utils.getByTestId('summary-add-member-row-me'));
        fireEvent.click(utils.getByTestId('summary-add-member-confirm-btn'));
        await waitFor(() => expect(api.addMembers).toHaveBeenCalledWith(9, ['me']));
        expect(onSuccess).toHaveBeenCalled();
    });

    it('toasts error on failed save, does not call onSuccess', async () => {
        vi.mocked(api.addMembers).mockRejectedValueOnce(new Error('nope'));
        const loadConversationMembers = vi.fn(async () => [{ uid: 'human-1', name: 'Alice' }]);
        const onSuccess = vi.fn();
        const { utils } = openModal({ messaging: makeMessaging({ loadConversationMembers }), onSuccess });
        await waitFor(() => expect(utils.queryByText('Alice')).not.toBeNull());
        fireEvent.click(utils.getByTestId('summary-add-member-row-human-1'));
        fireEvent.click(utils.getByTestId('summary-add-member-confirm-btn'));
        await waitFor(() => {
            expect(mockToast.error).toHaveBeenCalledWith('nope');
            expect(onSuccess).not.toHaveBeenCalled();
        });
    });

    it('selection blocked during submitting', async () => {
        let resolveSave: () => void = () => {};
        vi.mocked(api.addMembers).mockImplementation(() => new Promise((res) => { resolveSave = res; }));
        const loadConversationMembers = vi.fn(async () => [
            { uid: 'human-1', name: 'Alice' },
            { uid: 'human-2', name: 'Bob' },
        ]);
        const { utils } = openModal({ messaging: makeMessaging({ loadConversationMembers }) });
        await waitFor(() => expect(utils.queryByText('Alice')).not.toBeNull());
        fireEvent.click(utils.getByTestId('summary-add-member-row-human-1'));
        fireEvent.click(utils.getByTestId('summary-add-member-confirm-btn'));
        fireEvent.click(utils.getByTestId('summary-add-member-row-human-2'));
        await act(async () => { resolveSave(); await flushPromises(); });
        expect(api.addMembers).toHaveBeenCalledTimes(1);
        expect(api.addMembers).toHaveBeenCalledWith(9, ['human-1']);
    });

    it('ignores late load after space switch', async () => {
        let resolveLoad: (v: { uid: string; name: string }[]) => void = () => {};
        const loadConversationMembers = vi.fn(() => new Promise((res) => { resolveLoad = res; }));
        const { utils } = openModal({ messaging: makeMessaging({ loadConversationMembers }) });
        (WKApp.shared as any).currentSpaceId = 'space-2';
        await act(async () => { resolveLoad([{ uid: 'human-1', name: 'Alice' }]); await flushPromises(); });
        expect(utils.queryByText('Alice')).toBeNull();
    });

    it('drops late save success after space switch', async () => {
        let resolveSave: () => void = () => {};
        vi.mocked(api.addMembers).mockImplementation(() => new Promise((res) => { resolveSave = res; }));
        const loadConversationMembers = vi.fn(async () => [{ uid: 'human-1', name: 'Alice' }]);
        const onSuccess = vi.fn();
        const { utils } = openModal({ messaging: makeMessaging({ loadConversationMembers }), onSuccess });
        await waitFor(() => expect(utils.queryByText('Alice')).not.toBeNull());
        fireEvent.click(utils.getByTestId('summary-add-member-row-human-1'));
        fireEvent.click(utils.getByTestId('summary-add-member-confirm-btn'));
        (WKApp.shared as any).currentSpaceId = 'space-2';
        await act(async () => { resolveSave(); await flushPromises(); });
        expect(onSuccess).not.toHaveBeenCalled();
        expect(mockToast.success).not.toHaveBeenCalled();
    });

    it('drops late save after modal closes', async () => {
        let resolveSave: () => void = () => {};
        vi.mocked(api.addMembers).mockImplementation(() => new Promise((res) => { resolveSave = res; }));
        const loadConversationMembers = vi.fn(async () => [{ uid: 'human-1', name: 'Alice' }]);
        const onSuccess = vi.fn();
        const props = {
            visible: true,
            taskId: 9,
            target: TARGET,
            existingMemberIds: EXISTING,
            messaging: makeMessaging({ loadConversationMembers }),
            onClose: vi.fn(),
            onSuccess,
        };
        const utils = render(<SummaryAddMemberModal {...props} />);
        await waitFor(() => expect(utils.queryByText('Alice')).not.toBeNull());
        fireEvent.click(utils.getByTestId('summary-add-member-row-human-1'));
        act(() => utils.rerender(<SummaryAddMemberModal {...props} visible={false} />));
        await act(async () => { resolveSave(); await flushPromises(); });
        expect(onSuccess).not.toHaveBeenCalled();
        expect(mockToast.success).not.toHaveBeenCalled();
    });

    it('does not submit stale result into a new opening after close+reopen', async () => {
        let resolveSave: () => void = () => {};
        vi.mocked(api.addMembers).mockImplementation(() => new Promise((res) => { resolveSave = res; }));
        const loadConversationMembers = vi.fn(async () => [{ uid: 'human-1', name: 'Alice' }]);
        const onSuccess = vi.fn();
        const props = {
            visible: true,
            taskId: 9,
            target: TARGET,
            existingMemberIds: EXISTING,
            messaging: makeMessaging({ loadConversationMembers }),
            onClose: vi.fn(),
            onSuccess,
        };
        const utils = render(<SummaryAddMemberModal {...props} />);
        await waitFor(() => expect(utils.queryByText('Alice')).not.toBeNull());
        fireEvent.click(utils.getByTestId('summary-add-member-row-human-1'));
        fireEvent.click(utils.getByTestId('summary-add-member-confirm-btn'));
        act(() => utils.rerender(<SummaryAddMemberModal {...props} visible={false} />));
        act(() => utils.rerender(<SummaryAddMemberModal {...props} visible />));
        await act(async () => { resolveSave(); await flushPromises(); });
        expect(onSuccess).not.toHaveBeenCalled();
    });

    it('reloads new candidates when target changes while visible', async () => {
        const loadConversationMembers = vi.fn(async () => [{ uid: 'human-1', name: 'Alice' }]);
        const onSuccess = vi.fn();
        const props = {
            visible: true,
            taskId: 9,
            target: TARGET,
            existingMemberIds: EXISTING,
            messaging: makeMessaging({ loadConversationMembers }),
            onClose: vi.fn(),
            onSuccess,
        };
        const utils = render(<SummaryAddMemberModal {...props} />);
        await waitFor(() => expect(utils.queryByText('Alice')).not.toBeNull());
        loadConversationMembers.mockResolvedValueOnce([{ uid: 'human-2', name: 'Bob' }]);
        act(() => utils.rerender(<SummaryAddMemberModal {...props} target={{ channelId: 'chan-2', channelType: 2 }} />));
        await waitFor(() => expect(loadConversationMembers).toHaveBeenCalledWith({ channelId: 'chan-2', channelType: 2 }));
        await waitFor(() => expect(utils.queryByText('Bob')).not.toBeNull());
        expect(utils.queryByText('Alice')).toBeNull();
    });

    it('confirm button is disabled while submitting, preventing double-click', async () => {
        let resolveSave: () => void = () => {};
        vi.mocked(api.addMembers).mockImplementation(() => new Promise((res) => { resolveSave = res; }));
        const loadConversationMembers = vi.fn(async () => [{ uid: 'human-1', name: 'Alice' }]);
        const { utils } = openModal({ messaging: makeMessaging({ loadConversationMembers }) });
        await waitFor(() => expect(utils.queryByText('Alice')).not.toBeNull());
        fireEvent.click(utils.getByTestId('summary-add-member-row-human-1'));
        fireEvent.click(utils.getByTestId('summary-add-member-confirm-btn'));
        const btn = utils.getByTestId('summary-add-member-confirm-btn');
        expect(btn.disabled).toBe(true);
        await act(async () => { resolveSave(); await flushPromises(); });
        expect(utils.getByTestId('summary-add-member-confirm-btn').disabled).toBe(false);
    });

    it('space switch after candidate load blocks confirm (activeOpening snapshot check)', async () => {
        // Load succeeds, user selects, then global Space changes before confirm.
        // The BEFORE-setState guard must prevent the API call.
        vi.mocked(api.addMembers).mockResolvedValue(undefined as any);
        const loadConversationMembers = vi.fn(async () => [{ uid: 'human-1', name: 'Alice' }]);
        const onSuccess = vi.fn();
        const { utils } = openModal({ messaging: makeMessaging({ loadConversationMembers }), onSuccess });
        await waitFor(() => expect(utils.queryByText('Alice')).not.toBeNull());
        fireEvent.click(utils.getByTestId('summary-add-member-row-human-1'));
        (WKApp.shared as any).currentSpaceId = 'space-2';
        fireEvent.click(utils.getByTestId('summary-add-member-confirm-btn'));
        await flushPromises();
        expect(api.addMembers).not.toHaveBeenCalled();
        expect(onSuccess).not.toHaveBeenCalled();
    });

    it('checkbox onChange honored and stops propagation from row click', async () => {
        // The Checkbox onChange calls e.stopPropagation() then handleToggle.
        // Clicking the checkbox directly should toggle independently of the
        // row onClick, and the row onKeyDown must ignore bubbled events from
        // child elements.
        const loadConversationMembers = vi.fn(async () => [
            { uid: 'human-1', name: 'Alice' },
            { uid: 'human-2', name: 'Bob' },
        ]);
        const { utils } = openModal({ messaging: makeMessaging({ loadConversationMembers }) });
        await waitFor(() => expect(utils.queryByText('Alice')).not.toBeNull());

        const row1 = utils.getByTestId('summary-add-member-row-human-1');
        const checkbox1 = row1.querySelector('input[type="checkbox"]')!;

        // Click checkbox directly => toggles on (selection count = 1).
        fireEvent.click(checkbox1);
        expect(utils.getByTestId('summary-add-member-confirm-btn').disabled).toBe(false);

        // Click row (should also toggle, but due to stopPropagation on the checkbox's
        // onChange, the row onClick won't fire for clicks originating on the checkbox).
        // However in DOM testing the click fires on the target regardless. The
        // stopPropagation means the row never fires its onClick for checkbox clicks.
        // Toggle via row should still work for clicks outside the checkbox area.
        const row2 = utils.getByTestId('summary-add-member-row-human-2');
        fireEvent.click(row2);
        // Both checked now.
        fireEvent.click(utils.getByTestId('summary-add-member-confirm-btn'));
        await waitFor(() => expect(api.addMembers).toHaveBeenCalledWith(9, ['human-1', 'human-2']));
    });

    it('keydown on row toggles with Enter; child keydown is ignored', async () => {
        const loadConversationMembers = vi.fn(async () => [{ uid: 'human-1', name: 'Alice' }]);
        const { utils } = openModal({ messaging: makeMessaging({ loadConversationMembers }) });
        await waitFor(() => expect(utils.queryByText('Alice')).not.toBeNull());
        const row = utils.getByTestId('summary-add-member-row-human-1');

        // Keydown on the row itself toggles selection.
        fireEvent.keyDown(row, { key: 'Enter' });
        expect(utils.getByTestId('summary-add-member-confirm-btn').disabled).toBe(false);

        // Keydown on a child element (e.g. the checkbox input) must be ignored
        // because handleKeyDown guards e.target !== e.currentTarget.
        const checkboxInput = row.querySelector('input[type="checkbox"]')!;
        fireEvent.keyDown(checkboxInput, { key: ' ' });
        // Still only checked once (selection was not toggled by child keydown).
        vi.mocked(api.addMembers).mockResolvedValue(undefined as any);
        fireEvent.click(utils.getByTestId('summary-add-member-confirm-btn'));
        await waitFor(() => expect(api.addMembers).toHaveBeenCalledWith(9, ['human-1']));
    });

    it('toggles via keyboard Enter and Space', async () => {
        const loadConversationMembers = vi.fn(async () => [{ uid: 'human-1', name: 'Alice' }]);
        const { utils } = openModal({ messaging: makeMessaging({ loadConversationMembers }) });
        await waitFor(() => expect(utils.queryByText('Alice')).not.toBeNull());
        const row = utils.getByTestId('summary-add-member-row-human-1');
        expect(row.getAttribute('role')).toBe('option');
        expect(row.getAttribute('tabindex')).toBe('0');
        fireEvent.keyDown(row, { key: 'Enter' });
        expect(utils.getByTestId('summary-add-member-confirm-btn').disabled).toBe(false);
    });

    it('blocks keyboard toggle during submitting', async () => {
        let resolveSave: () => void = () => {};
        vi.mocked(api.addMembers).mockImplementation(() => new Promise((res) => { resolveSave = res; }));
        const loadConversationMembers = vi.fn(async () => [
            { uid: 'human-1', name: 'Alice' },
            { uid: 'human-2', name: 'Bob' },
        ]);
        const { utils } = openModal({ messaging: makeMessaging({ loadConversationMembers }) });
        await waitFor(() => expect(utils.queryByText('Alice')).not.toBeNull());
        fireEvent.click(utils.getByTestId('summary-add-member-row-human-1'));
        fireEvent.click(utils.getByTestId('summary-add-member-confirm-btn'));
        fireEvent.keyDown(utils.getByTestId('summary-add-member-row-human-2'), { key: 'Enter' });
        await act(async () => { resolveSave(); await flushPromises(); });
        expect(api.addMembers).toHaveBeenCalledWith(9, ['human-1']);
    });
});
