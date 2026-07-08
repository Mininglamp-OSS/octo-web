import React from 'react';
import { render as rtlRender, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SummaryCreatePage from '../SummaryCreatePage';
import * as api from '../../api/summaryApi';

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
    SplitButtonGroup: ({ children, className }: any) => (
        <div data-testid="split-button-group" className={className}>{children}</div>
    ),
    Dropdown: Object.assign(
        ({ children, render }: any) => (
            <div data-testid="dropdown">
                {children}
                <div data-testid="dropdown-menu">{render}</div>
            </div>
        ),
        {
            Menu: ({ children }: any) => <div data-testid="dropdown-menu-list">{children}</div>,
            Item: ({ children, onClick, active }: any) => (
                <button data-testid="dropdown-item" data-active={active} onClick={onClick}>
                    {children}
                </button>
            ),
        },
    ),
}));

vi.mock('@douyinfe/semi-icons', () => ({
    IconPlus: () => <span data-testid="icon-plus" />,
    IconClock: () => <span data-testid="icon-clock" />,
    IconUserGroup: () => <span data-testid="icon-user-group" />,
    IconChevronDown: () => <span data-testid="icon-chevron-down" />,
}));

vi.mock('../../api/summaryApi', () => ({
    createSummary: vi.fn().mockResolvedValue({ task_id: 1 }),
    createAgentSummary: vi.fn().mockResolvedValue({ task_id: 1 }),
    createSchedule: vi.fn().mockResolvedValue({}),
    getTopicTemplates: vi.fn().mockResolvedValue([]),
    agentChat: vi.fn(),
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('SummaryCreatePage agent multi-turn session_id + single-flight', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('reuses the same (uuid-shaped, non-empty) session_id across two turns', async () => {
        (api.agentChat as any).mockImplementation(
            ({ message, session_id }: { message: string; session_id: string }) =>
                Promise.resolve({ reply: `echo: ${message}`, session_id }),
        );

        const ref = React.createRef<SummaryCreatePage>();
        await act(async () => {
            render(<SummaryCreatePage ref={ref} />);
            await flushPromises();
        });

        // Turn 1
        await act(async () => {
            await (ref.current as any).handleAgentSend('first question');
            await flushPromises();
        });
        // Turn 2
        await act(async () => {
            await (ref.current as any).handleAgentSend('second question');
            await flushPromises();
        });

        const calls = (api.agentChat as any).mock.calls;
        expect(calls.length).toBe(2);
        const sid1 = calls[0][0].session_id;
        const sid2 = calls[1][0].session_id;
        expect(sid1).toBeTruthy();
        expect(sid1).toMatch(UUID_RE);
        expect(sid2).toBe(sid1);
    });

    it('does not fire a second concurrent request while a send is in-flight', async () => {
        const deferred: Array<(v: any) => void> = [];
        (api.agentChat as any).mockImplementation(
            ({ session_id }: { session_id: string }) =>
                new Promise((resolve) => {
                    deferred.push(() => resolve({ reply: 'ok', session_id }));
                }),
        );

        const ref = React.createRef<SummaryCreatePage>();
        await act(async () => {
            render(<SummaryCreatePage ref={ref} />);
            await flushPromises();
        });

        // Fire two sends back-to-back without awaiting; the sync in-flight lock
        // must block the second before it can issue a request.
        (ref.current as any).handleAgentSend('a');
        (ref.current as any).handleAgentSend('b');
        expect((api.agentChat as any).mock.calls.length).toBe(1);

        // Resolve the in-flight request; a subsequent send then works again.
        await act(async () => {
            deferred.forEach((r) => r(undefined));
            await flushPromises();
        });
        await act(async () => {
            (ref.current as any).handleAgentSend('c');
            await flushPromises();
        });
        expect((api.agentChat as any).mock.calls.length).toBe(2);
    });
});
