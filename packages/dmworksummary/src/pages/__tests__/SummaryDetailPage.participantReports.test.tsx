import React from 'react';
import { render as rtlRender } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// OCT-16 / upstream #495 regression: renderParticipantReports() rendering verdict
// for declined / pending / submitted combinations.
//
// Bug: declined members have no submitted_at; the old `pending` filter only looked
// at "no submitted content", so declined members were misclassified as pending and
// rendered as "{name} · waiting to submit", contradicting the member-status area's
// "declined". Fix: pending filter explicitly excludes m.status === "declined";
// declined members render on their own line as "Participation declined"
// (summary.confirmPage.declined), and declined is counted in the early-return guard.
//
// Strategy: SummaryDetailPage is a class component; renderParticipantReports() reads
// this.state / this.context. We instantiate directly, inject state/context, render
// the returned JSX into jsdom, and assert on DOM text. Heavy children (CitationText /
// SummaryEditor / semi-ui / semi-icons) are mocked to lightweight placeholders so we
// only observe the three visible outputs we care about: waiting-submit / declined /
// submitted body.

const I18N = {
    'summary.detail.participantReports': 'Participant reports',
    'summary.detail.waitingSubmit': '{{name}} - waiting to submit...',
    'summary.confirmPage.declined': 'Participation declined',
    'summary.detail.collapse': 'Collapse',
    'summary.detail.expandAll': 'Expand all',
    'summary.detail.editMyReport': 'Edit',
    'summary.detail.processingTitle': 'Generating summary...',
    'summary.detail.processingDesc': 'Please wait',
    'summary.detail.workflowUnderstandQuestion': 'Understand request',
    'summary.detail.workflowFindRelevantChats': 'Find chats',
    'summary.detail.workflowFilterUsefulContent': 'Filter content',
    'summary.detail.workflowAnalyzeChatContent': 'Analyze content',
    'summary.detail.workflowGenerateSummary': 'Generate summary',
};
const t = (key, opts) => {
    let s = I18N[key] ?? key;
    const values = opts?.values ?? {};
    Object.keys(values).forEach((k) => {
        s = s.replace(`{{${k}}}`, String(values[k]));
    });
    return s;
};

vi.mock('wukongimjssdk', () => ({
    Channel: class {},
    ChannelTypeGroup: 2,
    ChannelTypePerson: 1,
    MessageText: class {},
    WKSDK: { shared: () => ({ chatManager: { send: vi.fn() } }) },
}));

vi.mock('@douyinfe/semi-ui', () => {
    const Passthrough = ({ children }) => children ?? null;
    const Typography = Passthrough;
    Typography.Text = Passthrough;
    const Dropdown = Passthrough;
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
    IconPlus: () => null,
    IconClock: () => <i data-testid="icon-clock" />,
    IconArrowLeft: () => null,
    IconRefresh: () => null,
    IconDelete: () => null,
    IconEdit: () => null,
    IconMore: () => null,
    IconSend: () => null,
    IconChevronDown: () => null,
    IconUser: () => null,
    IconTick: () => null,
    IconClose: () => <i data-testid="icon-close" />,
    IconInfoCircle: () => null,
    IconHistory: () => null,
    IconSearch: () => null,
    IconMinusCircle: () => null,
    IconExit: () => null,
}));

vi.mock('../../components/CitationText', () => ({
    default: ({ content }) => <div data-testid="citation-text">{content}</div>,
}));

vi.mock('../../components/SummaryEditor', () => ({
    default: () => <div data-testid="summary-editor" />,
}));

import SummaryDetailPage from '../SummaryDetailPage';
import { SummaryMode, TaskStatus } from '../../types/summary';

function makeMember(over) {
    return {
        user_name: `user-${over.user_id}`,
        status: 'pending',
        submitted_at: null,
        ...over,
    };
}

// Build an instance, inject state/context, render the returned JSX.
// personalResult omitted by default -> shouldShowMySubmit() returns false.
function renderReports(members, stateOver = {}) {
    const page = new SummaryDetailPage({ taskId: 1 });
    page.context = { t };
    page.state = {
        ...page.state,
        members,
        membersLoading: false,
        expandedReports: {},
        editingPersonalReport: false,
        personalResult: null,
        isEditing: false,
        editingTeamSummary: false,
        detail: {
            task_id: 1,
            summary_mode: 1, // non BY_PERSON -> isMultiCollab()=false -> shouldShowMySubmit()=false
            permissions: { can_edit_personal: false },
            ...(stateOver.detail ?? {}),
        },
        ...stateOver,
    };
    const out = page.renderParticipantReports();
    if (out === null) return { container: null, isNull: true };
    const { container } = rtlRender(out);
    return { container, isNull: false };
}

describe('SummaryDetailPage.renderParticipantReports - OCT-16 / #495 declined/pending/submitted', () => {
    beforeEach(() => vi.clearAllMocks());

    // Scenario 1: single declined, no submitted, no pending.
    it('1. single declined: shows declined line, not waiting-submit', () => {
        const { container, isNull } = renderReports([
            makeMember({ user_id: 'creator', user_name: 'Creator', status: 'submitted', submitted_at: '2026-01-01T00:00:00Z', content: 'my summary' }),
            makeMember({ user_id: 'u2', user_name: 'Ming', status: 'declined' }),
        ]);
        expect(isNull).toBe(false);
        const text = container.textContent || '';
        expect(text).toContain('Ming');
        expect(text).toContain('Participation declined');
        expect(text).not.toContain('waiting to submit');
        expect(container.querySelectorAll('[data-testid="icon-close"]').length).toBe(1);
        expect(container.querySelectorAll('[data-testid="icon-clock"]').length).toBe(0);
        expect(container.querySelector('.summary-detail-participant-report-pending--declined')).not.toBeNull();
    });

    // Scenario 2: single pending (non-declined, no submitted_at). Behavior unchanged.
    it('2. single pending: shows waiting-submit line, behavior unchanged', () => {
        const { container, isNull } = renderReports([
            makeMember({ user_id: 'creator', user_name: 'Creator', status: 'submitted', submitted_at: '2026-01-01T00:00:00Z', content: 'my summary' }),
            makeMember({ user_id: 'u2', user_name: 'Hong', status: 'pending' }),
        ]);
        expect(isNull).toBe(false);
        const text = container.textContent || '';
        expect(text).toContain('Hong - waiting to submit...');
        expect(text).not.toContain('Participation declined');
        expect(container.querySelectorAll('[data-testid="icon-clock"]').length).toBe(1);
        expect(container.querySelectorAll('[data-testid="icon-close"]').length).toBe(0);
    });

    // Scenario 3: declined + pending mixed. Each on its own line; declined not in pending.
    it('3. declined + pending mixed: separate lines, declined not mixed into pending', () => {
        const { container, isNull } = renderReports([
            makeMember({ user_id: 'creator', user_name: 'Creator', status: 'submitted', submitted_at: '2026-01-01T00:00:00Z', content: 'body' }),
            makeMember({ user_id: 'u2', user_name: 'Ming', status: 'declined' }),
            makeMember({ user_id: 'u3', user_name: 'Hong', status: 'pending' }),
        ]);
        expect(isNull).toBe(false);
        const text = container.textContent || '';
        expect(text).toContain('Hong - waiting to submit...');
        expect(text).toContain('Ming');
        expect(text).toContain('Participation declined');
        expect(text).not.toContain('Ming - waiting to submit');
        expect(container.querySelectorAll('[data-testid="icon-clock"]').length).toBe(1);
        expect(container.querySelectorAll('[data-testid="icon-close"]').length).toBe(1);
    });

    // Scenario 4: declined + submitted mixed. submitted shows body; declined own line.
    it('4. declined + submitted mixed: submitted shows body, declined own line', () => {
        const { container, isNull } = renderReports([
            makeMember({ user_id: 'u1', user_name: 'Submitter', status: 'submitted', submitted_at: '2026-01-01T00:00:00Z', content: 'this is the submitted summary body' }),
            makeMember({ user_id: 'u2', user_name: 'Decliner', status: 'declined' }),
        ]);
        expect(isNull).toBe(false);
        const text = container.textContent || '';
        expect(text).toContain('this is the submitted summary body');
        expect(text).toContain('Decliner');
        expect(text).toContain('Participation declined');
        expect(text).not.toContain('waiting to submit');
        // submitted row renders an item container (not a pending/declined line);
        // declined still renders exactly one IconClose line.
        expect(container.querySelector('.summary-detail-participant-report-item')).not.toBeNull();
        expect(container.querySelectorAll('[data-testid="icon-close"]').length).toBe(1);
    });

    // Scenario 5: only creator (members.length <= 1) -> early return null.
    it('5. only creator: participant reports not rendered (early return null)', () => {
        const { isNull } = renderReports([
            makeMember({ user_id: 'creator', user_name: 'Creator', status: 'submitted', submitted_at: '2026-01-01T00:00:00Z', content: 'body' }),
        ]);
        expect(isNull).toBe(true);
    });

    // Scenario 6: showMyPending branch (self not submitted).
    // personalResult.worker_status=2 with no submitted_at + BY_PERSON multi-person ->
    // shouldShowMySubmit()=true. Verify this fix does not affect showMyPending, and
    // co-existing others' pending / declined still split correctly.
    it('6. showMyPending branch: self-not-submitted still renders own row, others declined/pending split intact', () => {
        const { container, isNull } = renderReports(
            [
                // "me" = test-uid (WKApp mock loginInfo.uid)
                makeMember({ user_id: 'test-uid', user_name: 'Me', status: 'pending' }),
                makeMember({ user_id: 'u2', user_name: 'Hong', status: 'pending' }),
                makeMember({ user_id: 'u3', user_name: 'Ming', status: 'declined' }),
            ],
            {
                detail: { summary_mode: 2 /* BY_PERSON */, permissions: { can_edit_personal: false } },
                personalResult: { worker_status: 2, submitted_at: null, content: 'my draft body', citations: [] },
            },
        );
        expect(isNull).toBe(false);
        const text = container.textContent || '';
        expect(text).toContain('Hong - waiting to submit...');
        expect(text).toContain('Participation declined');
        expect(text).not.toContain('Me - waiting to submit');
        expect(container.querySelectorAll('[data-testid="icon-close"]').length).toBe(1);
    });

    // Scenario 7: all declined (submitted=0 && pending=0); guard counts declined.
    it('7. all declined: not early-returned by submitted=0 && pending=0, renders declined lines', () => {
        const { container, isNull } = renderReports([
            makeMember({ user_id: 'u1', user_name: 'Alpha', status: 'declined' }),
            makeMember({ user_id: 'u2', user_name: 'Beta', status: 'declined' }),
        ]);
        expect(isNull).toBe(false);
        const text = container.textContent || '';
        expect(text).toContain('Alpha');
        expect(text).toContain('Beta');
        expect(container.querySelectorAll('[data-testid="icon-close"]').length).toBe(2);
        expect((text.match(/Participation declined/g) || []).length).toBe(2);
        expect(text).not.toContain('waiting to submit');
    });
});

describe('SummaryDetailPage workflow processing card', () => {
    beforeEach(() => vi.clearAllMocks());

    it('keeps the generic processing card for non-personal modes', () => {
        const page = new SummaryDetailPage({ taskId: 1 });
        page.context = { t };
        page.state = {
            ...page.state,
            detail: {
                task_id: 1,
                summary_mode: SummaryMode.BY_GROUP,
                status: TaskStatus.PROCESSING,
            },
            personalResult: null,
        };

        expect((page as any).shouldShowProcessingCard()).toBe(true);
        const { container } = rtlRender(page.renderProcessing());
        const text = container.textContent || '';
        expect(text).toContain('Generating summary...');
        expect(text).toContain('Please wait');
        expect(text).not.toContain('Understand request');
    });

    it('renders localized workflow stage labels for personal mode', () => {
        const page = new SummaryDetailPage({ taskId: 1 });
        page.context = { t };
        page.state = {
            ...page.state,
            detail: {
                task_id: 1,
                summary_mode: SummaryMode.BY_PERSON,
                status: TaskStatus.PROCESSING,
            },
            personalResult: { worker_status: 1, workflow_stage: 'understand_question' },
            workflowDisplayIndex: 0,
            workflowRevealDone: false,
        };

        const { container } = rtlRender(page.renderProcessing());
        const text = container.textContent || '';
        expect(text).toContain('Understand request');
        expect(text).toContain('Find chats');
        expect(text).toContain('Filter content');
        expect(text).toContain('Analyze content');
        expect(text).toContain('Generate summary');
    });
});
