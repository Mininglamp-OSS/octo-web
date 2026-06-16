import React from 'react';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ChatSummaryPanel from '../ChatSummaryPanel';

const mockEmit = vi.fn();
const mockOpenSummaryDetail = vi.fn();

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return {
        ...actual,
        WKApp: {
            mittBus: { emit: (...args: any[]) => mockEmit(...args) },
            openSummaryDetail: (...args: any[]) => mockOpenSummaryDetail(...args),
        },
    };
});

vi.mock('lucide-react', () => ({
    X: () => <svg data-testid="close-icon" />,
    ChevronLeft: () => <svg data-testid="back-icon" />,
}));

// 列表组件：暴露一个点击入口触发 onViewDetail，并标记自身是否挂载
let viewDetailCb: ((taskId: number) => void) | null = null;
vi.mock('../ChatSummaryHistory', () => ({
    default: (props: any) => {
        viewDetailCb = props.onViewDetail;
        return (
            <div data-testid="summary-history" data-paused={String(!!props.paused)}>
                <button onClick={() => props.onViewDetail(42)}>open-detail</button>
                <button onClick={() => props.onCreateNew()}>create-new</button>
            </div>
        );
    },
}));

// 详情组件：仅记录收到的 taskId
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
        viewDetailCb = null;
    });

    it('renders the list view by default', () => {
        render(<ChatSummaryPanel visible channel={channel} onClose={onClose} />);
        expect(screen.getByTestId('summary-history')).toBeInTheDocument();
        expect(screen.queryByTestId('summary-detail')).not.toBeInTheDocument();
    });

    it('switches to detail view in-panel without closing or routing away', () => {
        render(<ChatSummaryPanel visible channel={channel} onClose={onClose} />);

        fireEvent.click(screen.getByText('open-detail'));

        const detail = screen.getByTestId('summary-detail');
        expect(detail).toBeInTheDocument();
        expect(detail.dataset.taskId).toBe('42');
        // 关键：不关闭侧边栏、不走整页路由
        expect(onClose).not.toHaveBeenCalled();
        expect(mockOpenSummaryDetail).not.toHaveBeenCalled();
    });

    it('keeps the list mounted (hidden) while detail is open to preserve scroll', () => {
        render(<ChatSummaryPanel visible channel={channel} onClose={onClose} />);
        fireEvent.click(screen.getByText('open-detail'));

        // 列表常驻挂载，仅隐藏
        expect(screen.getByTestId('summary-history')).toBeInTheDocument();
        expect(screen.getByTestId('summary-detail')).toBeInTheDocument();
    });

    it('pauses list polling while detail is open', () => {
        render(<ChatSummaryPanel visible channel={channel} onClose={onClose} />);
        expect(screen.getByTestId('summary-history').dataset.paused).toBe('false');

        fireEvent.click(screen.getByText('open-detail'));
        expect(screen.getByTestId('summary-history').dataset.paused).toBe('true');
    });

    it('returns to the list view via the back button', () => {
        render(<ChatSummaryPanel visible channel={channel} onClose={onClose} />);
        fireEvent.click(screen.getByText('open-detail'));
        expect(screen.getByTestId('summary-detail')).toBeInTheDocument();

        fireEvent.click(screen.getByText('返回'));

        expect(screen.queryByTestId('summary-detail')).not.toBeInTheDocument();
        expect(screen.getByTestId('summary-history').dataset.paused).toBe('false');
    });

    it('resets to the list view when the channel changes', () => {
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
        expect(screen.getByTestId('summary-history')).toBeInTheDocument();
    });

    it('closes the panel via the close button in list view', () => {
        render(<ChatSummaryPanel visible channel={channel} onClose={onClose} />);
        fireEvent.click(screen.getByTestId('close-icon').closest('button')!);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('emits open-summary-modal when creating a new summary', () => {
        render(<ChatSummaryPanel visible channel={channel} onClose={onClose} />);
        fireEvent.click(screen.getByText('create-new'));
        expect(mockEmit).toHaveBeenCalledWith('wk:open-summary-modal', {
            channelId: 'ch1',
            channelType: 2,
        });
    });

    describe('resizable splitter', () => {
        beforeEach(() => {
            localStorage.clear();
            // 宽屏，保证 400px 不被 50% 可用空间约束 clamp 掉
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

            // 起点 360（默认），向左拖 40px → 宽度变 400
            fireEvent.mouseDown(splitter, { clientX: 1000 });
            fireEvent.mouseMove(document, { clientX: 960 });
            fireEvent.mouseUp(document);

            expect(localStorage.getItem('wk-summary-panel-width')).toBe('400');
            // 不污染 thread 面板宽度
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
