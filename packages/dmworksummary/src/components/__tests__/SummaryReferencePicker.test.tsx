import React from 'react';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { SummaryListItem } from '../../types/summary';
import { TriggerType, TaskStatus, SummaryMode } from '../../types/summary';

// Use vi.hoisted so the mock variable is available when vi.mock's factory runs
const { mockListSummaries } = vi.hoisted(() => ({
    mockListSummaries: vi.fn(),
}));

// Mock @octo/base — provide I18nContext with a real t function
vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<typeof import('../../__mocks__/dmworkBase')>('../../__mocks__/dmworkBase');
    return { ...actual };
});

// Mock semi-ui with minimal stubs
vi.mock('@douyinfe/semi-ui', () => ({
    Modal: ({ children, visible }: any) => visible ? <div data-testid="modal">{children}</div> : null,
    Input: ({ value, onChange, prefix, ...rest }: any) => (
        <input data-testid="summary-agent-ref-search-input" value={value || ''} onChange={(e) => onChange?.(e.target.value)} {...rest} />
    ),
    List: Object.assign(
        ({ dataSource, renderItem }: any) => (
            <div data-testid="list">
                {(dataSource || []).map((item: any, idx: number) => (
                    <div key={idx} data-testid="list-item">
                        {renderItem(item)}
                    </div>
                ))}
            </div>
        ),
        { Item: ({ children, onClick, className }: any) => (
            <div data-testid="list-item-inner" className={className} onClick={onClick}>{children}</div>
        ) },
    ),
    Empty: ({ description }: any) => <div data-testid="empty">{description}</div>,
    Spin: () => <div data-testid="spin">Loading…</div>,
    Toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@douyinfe/semi-icons', () => ({
    IconClose: () => <span>×</span>,
    IconLink: () => <span>🔗</span>,
}));

// Mock summaryApi — the hoisted mockListSummaries is available here
vi.mock('../../api/summaryApi', () => ({
    listSummaries: (...args: any[]) => mockListSummaries(...args),
}));

// Import the component AFTER all mocks are set up
import SummaryReferencePicker from '../SummaryReferencePicker';

function makeItem(overrides: Partial<SummaryListItem> = {}): SummaryListItem {
    return {
        task_id: 1,
        task_no: 'TASK-001',
        title: '测试总结',
        summary_mode: SummaryMode.BY_GROUP,
        status: TaskStatus.COMPLETED,
        trigger_type: TriggerType.AGENT,
        time_range_start: '2026-08-05T00:00:00Z',
        time_range_end: '2026-08-06T00:00:00Z',
        sources: [],
        participants: [{ user_id: 'u1', user_name: 'User1', status: 1 }],
        total_msg_count: 10,
        creator_name: 'Tester',
        origin_channel_id: 'ch-1',
        origin_channel_type: 1,
        created_at: '2026-08-05T10:00:00Z',
        completed_at: '2026-08-06T10:00:00Z',
        is_unread: false,
        has_pending_invitation: false,
        has_pending_submission: false,
        needs_attention: false,
        activity_at: '2026-08-06T10:00:00Z',
        ...overrides,
    } as SummaryListItem;
}

/**
 * Helper: render the picker with visible transitioning from false→true.
 * The component fetches data in componentDidUpdate when visible flips to true.
 */
function renderPicker(props?: { item?: SummaryListItem; items?: SummaryListItem[] }) {
    const items = props?.items ?? (props?.item ? [props.item] : []);
    mockListSummaries.mockResolvedValue({ items, total: items.length });
    const utils = render(<SummaryReferencePicker visible={false} onCancel={() => {}} onSelect={() => {}} />);
    // Re-render with visible=true to trigger componentDidUpdate
    utils.rerender(<SummaryReferencePicker visible={true} onCancel={() => {}} onSelect={() => {}} />);
    return utils;
}

describe('SummaryReferencePicker', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    describe('isReferenceable filter (compat bridge)', () => {
        it('shows item when referenceable === true', async () => {
            const item = makeItem({ referenceable: true });
            renderPicker({ item });
            await waitFor(() => expect(screen.getByText('测试总结')).toBeInTheDocument());
        });

        it('hides item when referenceable === false', async () => {
            const item = makeItem({ referenceable: false });
            renderPicker({ item });
            await waitFor(() => expect(screen.getByTestId('empty')).toBeInTheDocument());
            expect(screen.queryByText('测试总结')).not.toBeInTheDocument();
        });

        it('falls back to trigger_type === AGENT when referenceable is undefined', async () => {
            const agentItem = makeItem({ referenceable: undefined, trigger_type: TriggerType.AGENT });
            const manualItem = makeItem({ task_id: 2, title: '手动总结', referenceable: undefined, trigger_type: TriggerType.MANUAL });
            renderPicker({ items: [agentItem, manualItem] });
            await waitFor(() => expect(screen.getByText('测试总结')).toBeInTheDocument());
            expect(screen.queryByText('手动总结')).not.toBeInTheDocument();
        });

        it('hides non-completed items even if referenceable === true', async () => {
            const item = makeItem({ referenceable: true, status: TaskStatus.PROCESSING });
            renderPicker({ item });
            await waitFor(() => expect(screen.getByTestId('empty')).toBeInTheDocument());
        });
    });

    describe('getTypeLabel', () => {
        it('renders Agent type label for trigger_type AGENT', async () => {
            const item = makeItem({ referenceable: true, trigger_type: TriggerType.AGENT });
            renderPicker({ item });
            await waitFor(() => expect(screen.getByText('Agent 总结')).toBeInTheDocument());
        });

        it('renders Scheduled type label for trigger_type SCHEDULED', async () => {
            const item = makeItem({ referenceable: true, trigger_type: TriggerType.SCHEDULED });
            renderPicker({ item });
            await waitFor(() => expect(screen.getByText('定时总结')).toBeInTheDocument());
        });

        it('renders Multi-person label when participants > 1 for MANUAL type', async () => {
            const item = makeItem({
                referenceable: true,
                trigger_type: TriggerType.MANUAL,
                participants: [
                    { user_id: 'u1', user_name: 'User1', status: 1 },
                    { user_id: 'u2', user_name: 'User2', status: 1 },
                ],
            });
            renderPicker({ item });
            await waitFor(() => expect(screen.getByText('多人总结')).toBeInTheDocument());
        });

        it('renders Quick label when participants <= 1 for MANUAL type', async () => {
            const item = makeItem({
                referenceable: true,
                trigger_type: TriggerType.MANUAL,
                participants: [{ user_id: 'u1', user_name: 'User1', status: 1 }],
            });
            renderPicker({ item });
            await waitFor(() => expect(screen.getByText('快速总结')).toBeInTheDocument());
        });

        // R4 yj P2-4: renamed — unknown trigger_type falls back to the quick
        // label (summaryHelpers.getSummaryTypeKind default branch), so a badge
        // IS rendered. Assert the badge text to lock that behaviour.
        it('falls back to the quick label for unknown trigger_type', async () => {
            const item = makeItem({ referenceable: true, trigger_type: 99 as any });
            renderPicker({ item });
            // Item should still appear, with the quick fallback badge
            await waitFor(() => expect(screen.getByText('测试总结')).toBeInTheDocument());
            expect(screen.getByText('快速总结')).toBeInTheDocument();
            // The task_no should still render
            expect(screen.getByText('TASK-001')).toBeInTheDocument();
        });

        it('renders Scheduled label when schedule_id is present even if trigger_type is not SCHEDULED', async () => {
            const item = makeItem({
                referenceable: true,
                trigger_type: TriggerType.MANUAL,
                schedule_id: 42,
            });
            renderPicker({ item });
            await waitFor(() => expect(screen.getByText('定时总结')).toBeInTheDocument());
        });

        // R4 yj P2-1: regression guard. `schedule_id: 0` means "no schedule"
        // (the sentinel value the backend uses), so a MANUAL summary with
        // schedule_id=0 must render 快速总结, NOT 定时总结. Without this case
        // reverting summaryHelpers to the round-3 bug
        // (`item.schedule_id != null`) leaves the suite green — verified by
        // reviewer mutation testing.
        it('renders Quick label when schedule_id is 0 (no-schedule sentinel)', async () => {
            const item = makeItem({
                referenceable: true,
                trigger_type: TriggerType.MANUAL,
                schedule_id: 0,
            });
            renderPicker({ item });
            await waitFor(() => expect(screen.getByText('快速总结')).toBeInTheDocument());
            expect(screen.queryByText('定时总结')).not.toBeInTheDocument();
        });
    });

    describe('legacy mode (referenceable field missing)', () => {
        it('first request omits trigger_type; second request sends AGENT after detecting missing referenceable', async () => {
            const agentItem = makeItem({ referenceable: undefined, trigger_type: TriggerType.AGENT });
            // First call returns items without referenceable → triggers legacy flip + re-fetch.
            // Second call (re-fetch) returns the same items with trigger_type=AGENT in the request.
            mockListSummaries
                .mockResolvedValueOnce({ items: [agentItem], total: 1 })
                .mockResolvedValueOnce({ items: [agentItem], total: 1 });
            const { rerender } = render(<SummaryReferencePicker visible={false} onCancel={() => {}} onSelect={() => {}} />);
            rerender(<SummaryReferencePicker visible={true} onCancel={() => {}} onSelect={() => {}} />);

            // First request: legacyMode=false, trigger_type should be undefined
            await waitFor(() => {
                expect(mockListSummaries).toHaveBeenCalledTimes(1);
                const firstCallArg = mockListSummaries.mock.calls[0][0];
                expect(firstCallArg.trigger_type).toBeUndefined();
            });

            // Second request (re-fetch after legacy flip): legacyMode=true, trigger_type should be AGENT
            await waitFor(() => {
                expect(mockListSummaries).toHaveBeenCalledTimes(2);
                const secondCallArg = mockListSummaries.mock.calls[1][0];
                expect(secondCallArg.trigger_type).toBe(TriggerType.AGENT);
            }, { timeout: 2000 });

            // Item should still be visible after re-fetch
            await waitFor(() => expect(screen.getByText('测试总结')).toBeInTheDocument());
        });

        it('does not enter legacy mode when response is empty (no items to infer from)', async () => {
            // Empty response should NOT trigger legacy mode — we can't infer
            // whether the backend supports referenceable from an empty list.
            mockListSummaries.mockResolvedValue({ items: [], total: 0 });
            const { rerender } = render(<SummaryReferencePicker visible={false} onCancel={() => {}} onSelect={() => {}} />);
            rerender(<SummaryReferencePicker visible={true} onCancel={() => {}} onSelect={() => {}} />);

            await waitFor(() => {
                expect(mockListSummaries).toHaveBeenCalledTimes(1);
            });
            // Only one call — no re-fetch triggered because legacy mode is NOT flipped
            // for empty responses.
            expect(mockListSummaries).toHaveBeenCalledTimes(1);
            expect(screen.getByTestId('empty')).toBeInTheDocument();
        });

        it('does not send trigger_type when referenceable field is present', async () => {
            const item = makeItem({ referenceable: true, trigger_type: TriggerType.AGENT });
            mockListSummaries.mockResolvedValue({ items: [item], total: 1 });
            const { rerender } = render(<SummaryReferencePicker visible={false} onCancel={() => {}} onSelect={() => {}} />);
            rerender(<SummaryReferencePicker visible={true} onCancel={() => {}} onSelect={() => {}} />);
            await waitFor(() => {
                const callArg = mockListSummaries.mock.calls[0][0];
                expect(callArg.trigger_type).toBeUndefined();
            });
        });
    });

    describe('pagination (R4 yj P1-1 / ms P1 / jx 🟡: referenceable items beyond page 1)', () => {
        it('pages forward and surfaces a referenceable item sitting on page 2', async () => {
            // Full first page of NON-referenceable items, referenceable one on page 2.
            // This is the exact regression shape reviewers flagged: with a fixed
            // page=1, page_size=50 window the referenceable item would be pushed out.
            const bulkNonRef = Array.from({ length: 100 }, (_, i) => makeItem({
                task_id: 1000 + i,
                task_no: `TASK-${1000 + i}`,
                title: `不可引用总结 ${i}`,
                referenceable: false,
            }));
            const refItem = makeItem({ task_id: 9001, task_no: 'TASK-9001', title: '第二页可引用总结', referenceable: true });

            mockListSummaries.mockImplementation((params: any) => {
                if (params.page === 1) return Promise.resolve({ items: bulkNonRef, total: 101 });
                if (params.page === 2) return Promise.resolve({ items: [refItem], total: 101 });
                return Promise.resolve({ items: [], total: 101 });
            });

            const { rerender } = render(<SummaryReferencePicker visible={false} onCancel={() => {}} onSelect={() => {}} />);
            rerender(<SummaryReferencePicker visible={true} onCancel={() => {}} onSelect={() => {}} />);

            await waitFor(() => expect(screen.getByText('第二页可引用总结')).toBeInTheDocument());
            // Page 1 full (100 == page_size) so it must have requested page 2
            const pages = mockListSummaries.mock.calls.map((c) => c[0].page);
            expect(pages).toContain(2);
            // Non-referenceable bulk must not be rendered
            expect(screen.queryByText('不可引用总结 0')).not.toBeInTheDocument();
        });

        it('stops on a short final page without over-paging', async () => {
            const shortPage = Array.from({ length: 30 }, (_, i) => makeItem({
                task_id: 2000 + i,
                task_no: `TASK-${2000 + i}`,
                title: `短页总结 ${i}`,
                referenceable: false,
            }));
            mockListSummaries.mockImplementation((params: any) => {
                if (params.page === 1) return Promise.resolve({ items: shortPage, total: 30 });
                return Promise.resolve({ items: [], total: 30 });
            });

            const { rerender } = render(<SummaryReferencePicker visible={false} onCancel={() => {}} onSelect={() => {}} />);
            rerender(<SummaryReferencePicker visible={true} onCancel={() => {}} onSelect={() => {}} />);

            await waitFor(() => expect(screen.getByTestId('empty')).toBeInTheDocument());
            // 30 < page_size=100 → short page → stop; must not request page 2
            expect(mockListSummaries).toHaveBeenCalledTimes(1);
            expect(mockListSummaries.mock.calls[0][0].page).toBe(1);
        });

        it('dedupes an item that appears on both pages', async () => {
            // To actually reach page 2, page 1 must be FULL (100 items) and leave
            // fewer than PICKER_TARGET_COUNT (50) referenceable items collected.
            // page 1: 60 non-referenceable + 40 referenceable (one of them,
            // task_id=555, is duplicated on page 2).
            const page1: SummaryListItem[] = [
                ...Array.from({ length: 60 }, (_, i) => makeItem({
                    task_id: 3000 + i,
                    task_no: `TASK-${3000 + i}`,
                    title: `不可引用 ${i}`,
                    referenceable: false,
                })),
                ...Array.from({ length: 39 }, (_, i) => makeItem({
                    task_id: 4000 + i,
                    task_no: `TASK-${4000 + i}`,
                    title: `可引用 ${i}`,
                    referenceable: true,
                })),
                makeItem({ task_id: 555, task_no: 'TASK-555', title: '重复总结', referenceable: true }),
            ];
            const page2 = [makeItem({ task_id: 555, task_no: 'TASK-555', title: '重复总结', referenceable: true })];

            mockListSummaries.mockImplementation((params: any) => {
                if (params.page === 1) return Promise.resolve({ items: page1, total: 101 });
                if (params.page === 2) return Promise.resolve({ items: page2, total: 101 });
                return Promise.resolve({ items: [], total: 101 });
            });

            const { rerender } = render(<SummaryReferencePicker visible={false} onCancel={() => {}} onSelect={() => {}} />);
            rerender(<SummaryReferencePicker visible={true} onCancel={() => {}} onSelect={() => {}} />);

            await waitFor(() => expect(screen.getByText('重复总结')).toBeInTheDocument());
            // page 1 full (100) + only 40 referenceable (< 50 target) → page 2 requested
            const pages = mockListSummaries.mock.calls.map((c) => c[0].page);
            expect(pages).toContain(2);
            // task_id=555 appears in both pages; must render exactly once
            expect(screen.getAllByText('重复总结')).toHaveLength(1);
        });
    });
});
