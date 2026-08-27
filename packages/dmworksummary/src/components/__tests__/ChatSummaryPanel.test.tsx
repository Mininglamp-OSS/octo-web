import React from 'react';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ChatSummaryPanel from '../ChatSummaryPanel';

const mockEmit = vi.fn();

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return {
        ...actual,
        WKApp: {
            mittBus: { emit: (...args: any[]) => mockEmit(...args) },
        },
    };
});

vi.mock('lucide-react', () => ({
    X: () => <svg data-testid="close-icon" />,
    ChevronLeft: () => <svg data-testid="back-icon" />,
}));

// SummaryListPage mock: exposes create/detail callbacks
let createNewCb: ((mode?: 'normal' | 'agent' | 'unified') => void) | null = null;
let viewDetailCb: ((taskId: number) => void) | null = null;
vi.mock('../../pages/SummaryListPage', () => ({
    default: (props: any) => {
        createNewCb = props.onCreateNew;
        viewDetailCb = props.onViewDetail;
        return (
            <div data-testid="summary-list" data-channel-id={props.channelId}>
                <button onClick={() => props.onViewDetail(42)}>open-detail</button>
                <button onClick={() => props.onCreateNew()}>create-new</button>
                {props.onClose && (
                    <button data-testid="list-close" onClick={props.onClose}>
                        close
                    </button>
                )}
            </div>
        );
    },
}));

// Production create entry mock: the real component owns the capability gate and
// only forwards legacyInitialMode when it falls back to SummaryCreatePage.
vi.mock('../../features/summaryWorkbench/SummaryWorkbenchCreateEntry', () => ({
    default: (props: any) => (
        <div
            data-testid="summary-create-entry"
            data-channel={props.channel?.channelID}
            data-legacy-initial-mode={props.legacyInitialMode ?? ''}
            data-has-create-mode={String(
                Object.prototype.hasOwnProperty.call(props, 'createMode'),
            )}
            data-embedded={String(props.embedded)}
            data-source={props.source}
        >
            <button onClick={() => props.onSubmit?.(99)}>submit-create</button>
            <button onClick={() => props.onOpenTask?.(77)}>open-created-task</button>
            <button onClick={() => props.onClose?.()}>cancel-create</button>
        </div>
    ),
}));

// SummaryDetailPage mock
vi.mock('../../pages/SummaryDetailPage', () => ({
    default: (props: any) => (
        <div data-testid="summary-detail" data-task-id={String(props.taskId)} />
    ),
}));

function render(ui: React.ReactElement, options?: any) {
    return rtlRender(ui, { legacyRoot: true, ...options });
}

describe('ChatSummaryPanel', () => {
    const channel = { channelID: 'ch1', channelType: 2 };
    const onClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        createNewCb = null;
        viewDetailCb = null;
    });

    it('renders the list view by default', () => {
        render(<ChatSummaryPanel visible channel={channel} onClose={onClose} />);
        expect(screen.getByTestId('summary-list')).toBeInTheDocument();
        expect(screen.queryByTestId('summary-detail')).not.toBeInTheDocument();
        expect(screen.queryByTestId('summary-create-entry')).not.toBeInTheDocument();
    });

    it('passes channelId to SummaryListPage for channel-scoped list', () => {
        render(<ChatSummaryPanel visible channel={channel} onClose={onClose} />);
        expect(screen.getByTestId('summary-list').dataset.channelId).toBe('ch1');
    });

    it('switches to detail view in-panel without closing', () => {
        render(<ChatSummaryPanel visible channel={channel} onClose={onClose} />);
        fireEvent.click(screen.getByText('open-detail'));

        const detail = screen.getByTestId('summary-detail');
        expect(detail).toBeInTheDocument();
        expect(detail.dataset.taskId).toBe('42');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('switches to create view in-panel without emitting open-summary-modal', () => {
        render(<ChatSummaryPanel visible channel={channel} onClose={onClose} />);
        fireEvent.click(screen.getByText('create-new'));

        expect(screen.getByTestId('summary-create-entry')).toBeInTheDocument();
        // List stays mounted but hidden (display:none) to preserve scroll
        expect(screen.queryByTestId('summary-list')).not.toBeVisible();
        // Must NOT emit wk:open-summary-modal — create is now in-panel
        expect(mockEmit).not.toHaveBeenCalledWith('wk:open-summary-modal', expect.anything());
    });

    it('passes createMode only as the Legacy fallback mode', () => {
        render(<ChatSummaryPanel visible channel={channel} onClose={onClose} />);
        // Capability 开启时统一 Workbench 忽略这个值；只有 fail-closed 的 Legacy 页面读取它。
        createNewCb?.('agent');
        expect(screen.getByTestId('summary-create-entry').dataset.legacyInitialMode).toBe('agent');
        expect(screen.getByTestId('summary-create-entry').dataset.hasCreateMode).toBe('false');

        createNewCb?.();
        expect(screen.getByTestId('summary-create-entry').dataset.legacyInitialMode).toBe('normal');

        createNewCb?.('unified');
        expect(screen.getByTestId('summary-create-entry').dataset.legacyInitialMode).toBe('normal');
    });

    it('returns from create to list via back button', () => {
        render(<ChatSummaryPanel visible channel={channel} onClose={onClose} />);
        fireEvent.click(screen.getByText('create-new'));
        expect(screen.getByTestId('summary-create-entry')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('back-icon').closest('button')!);
        expect(screen.queryByTestId('summary-create-entry')).not.toBeInTheDocument();
        expect(screen.getByTestId('summary-list')).toBeInTheDocument();
    });

    it('returns from detail to list via back button', () => {
        render(<ChatSummaryPanel visible channel={channel} onClose={onClose} />);
        fireEvent.click(screen.getByText('open-detail'));
        expect(screen.getByTestId('summary-detail')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('back-icon').closest('button')!);
        expect(screen.queryByTestId('summary-detail')).not.toBeInTheDocument();
        expect(screen.getByTestId('summary-list')).toBeInTheDocument();
    });

    it('resets to initial view when channel changes', () => {
        const { rerender } = render(
            <ChatSummaryPanel visible channel={channel} onClose={onClose} />,
        );
        fireEvent.click(screen.getByText('open-detail'));
        expect(screen.getByTestId('summary-detail')).toBeInTheDocument();

        rerender(
            <ChatSummaryPanel
                visible
                channel={{ channelID: 'ch2', channelType: 2 }}
                onClose={onClose}
            />,
        );

        expect(screen.queryByTestId('summary-detail')).not.toBeInTheDocument();
        expect(screen.getByTestId('summary-list')).toBeInTheDocument();
    });

    it('starts in create view when summaryPanelView is "new"', () => {
        render(
            <ChatSummaryPanel
                visible
                channel={channel}
                onClose={onClose}
                summaryPanelView="new"
            />,
        );
        expect(screen.getByTestId('summary-create-entry')).toBeInTheDocument();
        // List stays mounted but hidden (display:none) to preserve scroll
        expect(screen.queryByTestId('summary-list')).not.toBeVisible();
    });

    it('emits summary-list-refresh-requested after create submit', () => {
        vi.useFakeTimers();
        render(<ChatSummaryPanel visible channel={channel} onClose={onClose} />);
        fireEvent.click(screen.getByText('create-new'));
        fireEvent.click(screen.getByText('submit-create'));

        // Fast-forward the 800ms setTimeout
        vi.advanceTimersByTime(800);
        expect(mockEmit).toHaveBeenCalledWith('summary-list-refresh-requested');
        vi.useRealTimers();
    });

    it('opens a workbench result in the in-panel detail view', () => {
        render(<ChatSummaryPanel visible channel={channel} onClose={onClose} />);
        fireEvent.click(screen.getByText('create-new'));
        fireEvent.click(screen.getByText('open-created-task'));

        expect(screen.getByTestId('summary-detail')).toHaveAttribute(
            'data-task-id',
            '77',
        );
        expect(screen.queryByTestId('summary-create-entry')).not.toBeInTheDocument();
    });

    describe('resizable splitter', () => {
        beforeEach(() => {
            localStorage.clear();
            Object.defineProperty(window, 'innerWidth', {
                value: 1600,
                configurable: true,
                writable: true,
            });
        });

        it('renders a drag splitter on the left edge', () => {
            const { container } = render(
                <ChatSummaryPanel visible channel={channel} onClose={onClose} />,
            );
            expect(
                container.querySelector('.wk-thread-panel-splitter'),
            ).toBeInTheDocument();
        });

        it('persists the new width to its own storage key after a drag', () => {
            const { container } = render(
                <ChatSummaryPanel visible channel={channel} onClose={onClose} />,
            );
            const splitter = container.querySelector(
                '.wk-thread-panel-splitter',
            ) as HTMLElement;

            fireEvent.mouseDown(splitter, { clientX: 1000 });
            fireEvent.mouseMove(document, { clientX: 960 });
            fireEvent.mouseUp(document);

            expect(localStorage.getItem('wk-summary-panel-width')).toBe('400');
            expect(localStorage.getItem('wk-thread-panel-width')).toBeNull();
        });

        it('shows the drag overlay while dragging and removes it after', () => {
            const { container } = render(
                <ChatSummaryPanel visible channel={channel} onClose={onClose} />,
            );
            const splitter = container.querySelector(
                '.wk-thread-panel-splitter',
            ) as HTMLElement;

            fireEvent.mouseDown(splitter, { clientX: 1000 });
            fireEvent.mouseMove(document, { clientX: 960 });
            expect(
                container.querySelector('.wk-thread-panel-drag-overlay'),
            ).toBeInTheDocument();

            fireEvent.mouseUp(document);
            expect(
                container.querySelector('.wk-thread-panel-drag-overlay'),
            ).not.toBeInTheDocument();
        });

        it('resets to the default width on double-click', () => {
            const { container } = render(
                <ChatSummaryPanel visible channel={channel} onClose={onClose} />,
            );
            const splitter = container.querySelector(
                '.wk-thread-panel-splitter',
            ) as HTMLElement;

            fireEvent.mouseDown(splitter, { clientX: 1000 });
            fireEvent.mouseMove(document, { clientX: 960 });
            fireEvent.mouseUp(document);
            expect(localStorage.getItem('wk-summary-panel-width')).toBe('400');

            fireEvent.doubleClick(splitter);
            expect(localStorage.getItem('wk-summary-panel-width')).toBe('360');
        });
    });
});
