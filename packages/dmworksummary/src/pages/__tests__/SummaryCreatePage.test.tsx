import React from 'react';
import { render as rtlRender, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SummaryCreatePage from '../SummaryCreatePage';

vi.mock('@douyinfe/semi-ui', () => ({
    Button: ({ children, onClick, disabled, loading, theme, icon, ...rest }: any) => (
        <button onClick={onClick} disabled={disabled} data-loading={loading} data-theme={theme} {...rest}>
            {icon}{children}
        </button>
    ),
    Toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
    Typography: { Text: ({ children }: any) => <span>{children}</span> },
    Tag: ({ children }: any) => <span data-testid="tag">{children}</span>,
    Avatar: ({ children }: any) => <span data-testid="avatar">{children}</span>,
}));

vi.mock('@douyinfe/semi-icons', () => ({
    IconPlus: () => <span data-testid="icon-plus" />,
    IconClock: () => <span data-testid="icon-clock" />,
}));

vi.mock('../../api/summaryApi', () => ({
    createSummary: vi.fn().mockResolvedValue({ task_id: 1 }),
    createSchedule: vi.fn().mockResolvedValue({}),
    getTopicTemplates: vi.fn().mockResolvedValue([]),
}));

vi.mock('../SummaryDetailPage', () => ({ default: () => null }));
vi.mock('../../components/ChatSelectorModal', () => ({ default: () => null }));
vi.mock('../../components/MemberSelectorModal', () => ({ default: () => null }));
vi.mock('../../components/ScheduleConfigModal', () => ({ default: () => null }));

function render(ui: React.ReactElement, options?: any) {
    return rtlRender(ui, { legacyRoot: true, ...options });
}

function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SummaryCreatePage templates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the four fallback template cards when topic is empty', async () => {
        await act(async () => {
            render(<SummaryCreatePage />);
            await flushPromises();
        });

        expect(screen.getByText('试试总结')).toBeInTheDocument();
        expect(screen.getByText('汇总项目进展')).toBeInTheDocument();
        expect(screen.getByText('跟踪任务进度')).toBeInTheDocument();
        expect(screen.getByText('总结团队周报')).toBeInTheDocument();
        expect(screen.getByText('总结聊天内容')).toBeInTheDocument();
    });

    it('hides templates once the topic has content', async () => {
        await act(async () => {
            render(<SummaryCreatePage />);
            await flushPromises();
        });

        const textarea = document.querySelector('.summary-workbench-textarea') as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(textarea, { target: { value: '总结本周进展' } });
        });

        expect(screen.queryByText('试试总结')).not.toBeInTheDocument();
        expect(screen.queryByText('汇总项目进展')).not.toBeInTheDocument();
    });

    it('fills the topic from a fixed template on click', async () => {
        await act(async () => {
            render(<SummaryCreatePage />);
            await flushPromises();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('总结团队周报'));
        });

        const textarea = document.querySelector('.summary-workbench-textarea') as HTMLTextAreaElement;
        expect(textarea.value).toBe('总结每周的工作周报');
        // templates hidden after selection
        expect(screen.queryByText('试试总结')).not.toBeInTheDocument();
    });

    it('fills the topic frame from a parameterized template', async () => {
        await act(async () => {
            render(<SummaryCreatePage />);
            await flushPromises();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('汇总项目进展'));
        });

        const textarea = document.querySelector('.summary-workbench-textarea') as HTMLTextAreaElement;
        // The auto-focus clears the selected placeholder, leaving the pattern frame.
        expect(textarea.value).toContain('的项目进展');
        expect(textarea.value.startsWith('总结')).toBe(true);
    });
});
