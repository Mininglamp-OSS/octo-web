import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return { ...actual };
});
vi.mock('@douyinfe/semi-ui', () => ({
    Button: () => null,
    Input: () => null,
    Select: () => null,
    Spin: () => null,
    Pagination: () => null,
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

import SummaryListPage from '../SummaryListPage';

function makePage(items: Record<string, unknown>[]) {
    const page = new SummaryListPage({});
    (page as any).state = {
        ...(page.state as any),
        items,
    };
    (page as any).setState = function (this: any, patch: any) {
        this.state = { ...this.state, ...(typeof patch === 'function' ? patch(this.state) : patch) };
    };
    return page;
}

describe('SummaryListPage summary-read synchronization', () => {
    beforeEach(() => vi.clearAllMocks());

    it('applies is_unread/needs_attention from the summary-read event to the matching item', () => {
        const page = makePage([{ task_id: 1, is_unread: true, has_pending_invitation: false, needs_attention: true }]);

        (page as any).handleSummaryRead_(new CustomEvent('summary-read', {
            detail: { taskId: 1, isUnread: false, needsAttention: false },
        }));

        expect((page.state as any).items[0]).toMatchObject({ is_unread: false, needs_attention: false });
    });

    it('does not clear other items: a team cursor may be read while a personal cursor remains unread', () => {
        const page = makePage([
            { task_id: 1, is_unread: true, has_pending_invitation: false, needs_attention: true },
            { task_id: 2, is_unread: true, has_pending_invitation: true, needs_attention: true },
        ]);

        // Team summary 1 is read while personal summary 2 still has a pending invitation.
        (page as any).handleSummaryRead_(new CustomEvent('summary-read', {
            detail: { taskId: 1, isUnread: false, needsAttention: false },
        }));

        expect((page.state as any).items[0]).toMatchObject({ is_unread: false, needs_attention: false });
        expect((page.state as any).items[1]).toMatchObject({ is_unread: true, needs_attention: true });
    });

    it('re-derives needs_attention from has_pending_invitation when the event omits needsAttention', () => {
        const page = makePage([
            { task_id: 1, is_unread: true, has_pending_invitation: true, needs_attention: true },
            { task_id: 2, is_unread: true, has_pending_invitation: false, needs_attention: true },
        ]);

        // Event without needsAttention: flag falls back to the item's pending invitation state.
        (page as any).handleSummaryRead_(new CustomEvent('summary-read', {
            detail: { taskId: 1, isUnread: false },
        }));
        (page as any).handleSummaryRead_(new CustomEvent('summary-read', {
            detail: { taskId: 2, isUnread: false },
        }));

        expect((page.state as any).items[0]).toMatchObject({ is_unread: false, needs_attention: true });
        expect((page.state as any).items[1]).toMatchObject({ is_unread: false, needs_attention: false });
    });

    // Reading is not submitting (owner decision 2026-08-26). A server that
    // returns needsAttention keeps the dot; the legacy fallback path must not
    // undo it either, or opening the detail page silently drops the "your turn
    // to submit" signal for every multi-person summary.
    it('keeps the dot for a pending submission, both from the server flag and the fallback', () => {
        const page = makePage([
            { task_id: 1, is_unread: true, has_pending_invitation: false, has_pending_submission: true, needs_attention: true },
            { task_id: 2, is_unread: true, has_pending_invitation: false, has_pending_submission: true, needs_attention: true },
        ]);

        // Server-provided needsAttention (MarkSummaryRead re-derives it including
        // the submission signal).
        (page as any).handleSummaryRead_(new CustomEvent('summary-read', {
            detail: { taskId: 1, isUnread: false, needsAttention: true },
        }));
        // Legacy/omitted needsAttention: the fallback must consider both signals.
        (page as any).handleSummaryRead_(new CustomEvent('summary-read', {
            detail: { taskId: 2, isUnread: false },
        }));

        expect((page.state as any).items[0]).toMatchObject({ is_unread: false, needs_attention: true });
        expect((page.state as any).items[1]).toMatchObject({ is_unread: false, needs_attention: true });
    });

    // The branch that actually runs against a backend without the paired change:
    // it returns needs_attention=false (its formula excludes pending submission),
    // which wins the ?? and would clear a dot the user still owes. The forwarded
    // hasPendingSubmission from the mark-read response has to override it.
    it('holds the dot when an older backend reports needs_attention=false but a submit is owed', () => {
        const page = makePage([
            { task_id: 1, is_unread: true, has_pending_invitation: false, has_pending_submission: true, needs_attention: true },
        ]);

        (page as any).handleSummaryRead_(new CustomEvent('summary-read', {
            detail: { taskId: 1, isUnread: false, needsAttention: false, hasPendingSubmission: true },
        }));

        expect((page.state as any).items[0]).toMatchObject({
            is_unread: false, has_pending_submission: true, needs_attention: true,
        });
    });

    // The mirror case: the server says the submission landed (another tab, or the
    // system back-fill on a scheduled task), so the stale list flag must not
    // resurrect the dot.
    it('clears the dot when the server reports the submission is no longer pending', () => {
        const page = makePage([
            { task_id: 1, is_unread: true, has_pending_invitation: false, has_pending_submission: true, needs_attention: true },
        ]);

        (page as any).handleSummaryRead_(new CustomEvent('summary-read', {
            detail: { taskId: 1, isUnread: false, needsAttention: false, hasPendingSubmission: false },
        }));

        expect((page.state as any).items[0]).toMatchObject({
            is_unread: false, has_pending_submission: false, needs_attention: false,
        });
    });

    it('ignores events without a taskId', () => {
        const page = makePage([{ task_id: 1, is_unread: true, needs_attention: true }]);

        (page as any).handleSummaryRead_(new CustomEvent('summary-read', { detail: { isUnread: false } }));

        expect((page.state as any).items[0]).toMatchObject({ is_unread: true, needs_attention: true });
    });
});
