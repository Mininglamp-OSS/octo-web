import React from 'react';
import { render as rtlRender, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SummaryCreatePage from '../SummaryCreatePage';
import * as api from '../../api/summaryApi';

import * as summaryHelpers from '../../utils/summaryHelpers';
vi.mock('@douyinfe/semi-ui', () => ({
    Button: ({ children, onClick, disabled, loading, theme, icon, ...rest }: any) => (
        <button onClick={onClick} disabled={disabled} data-loading={loading} data-theme={theme} {...rest}>
            {icon}{children}
        </button>
    ),
    Toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
    Input: ({ value, onChange, ...rest }: any) => <input value={value} onChange={(e) => onChange?.(e.target.value)} {...rest} />,
    Modal: ({ children, visible, onOk, onCancel }: any) => visible ? <div data-testid="modal">{children}</div> : null,
    Typography: { Text: ({ children }: any) => <span>{children}</span> },
    Tag: ({ children }: any) => <span data-testid="tag">{children}</span>,
    Avatar: ({ children }: any) => <span data-testid="avatar">{children}</span>,
    Modal: ({ children, visible }: any) => visible ? <div data-testid="modal">{children}</div> : null,
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
    Empty: ({ description }: any) => <div data-testid="empty">{description}</div>,
    List: Object.assign(
        ({ children, dataSource, renderItem }: any) => <div data-testid="list">{dataSource?.map(renderItem)}</div>,
        { Item: ({ children, onClick }: any) => <div data-testid="list-item" onClick={onClick}>{children}</div> }
    ),
    Spin: ({ children, spinning }: any) => spinning ? <div data-testid="spin">Loading...</div> : children,
}));

vi.mock('@douyinfe/semi-icons', () => ({
    IconPlus: () => <span data-testid="icon-plus" />,
    IconClock: () => <span data-testid="icon-clock" />,
    IconUserGroup: () => <span data-testid="icon-user-group" />,
    IconChevronDown: () => <span data-testid="icon-chevron-down" />,
    IconLink: () => <span data-testid="icon-link" />,
}));

vi.mock('../../api/summaryApi', () => ({
    createSummary: vi.fn().mockResolvedValue({ task_id: 1 }),
    createAgentSummary: vi.fn().mockResolvedValue({ task_id: 1 }),
    createSchedule: vi.fn().mockResolvedValue({}),
    getTopicTemplatesConfig: vi.fn().mockResolvedValue({ templates: [], custom_template_limit: 30 }),
    updateMyTopicTemplate: vi.fn().mockResolvedValue({}),
    resetMyTopicTemplate: vi.fn().mockResolvedValue({}),
    createCustomTopicTemplate: vi.fn().mockResolvedValue({}),
    updateCustomTopicTemplate: vi.fn().mockResolvedValue({}),
    deleteCustomTopicTemplate: vi.fn().mockResolvedValue(undefined),
    getTopicTemplates: vi.fn().mockResolvedValue([]),
    agentChat: vi.fn(),
    getAgentChatHistory: vi.fn().mockResolvedValue({ session_id: '', messages: [] }),
}));

vi.mock('../SummaryDetailPage', () => ({ default: () => null }));
vi.mock('../../components/ChatSelectorModal', () => ({ default: () => null }));
vi.mock('../../components/MemberSelectorModal', () => ({ default: () => null }));
vi.mock('../../components/ScheduleConfigModal', () => ({ default: () => null }));

import { getTopicTemplatesConfig } from '../../api/summaryApi';

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
        expect(screen.getByText('更多模板')).toBeInTheDocument();
        expect(screen.queryByText('生成个人工作周报')).not.toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByText('更多模板'));
        });

        expect(screen.getByText('生成个人工作周报')).toBeInTheDocument();
        expect(screen.getByText('OKR 进展对齐')).toBeInTheDocument();
        expect(screen.getByText('提取待办事项')).toBeInTheDocument();
        expect(screen.getByText('归类用户反馈')).toBeInTheDocument();
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
        expect(textarea.value).toBe('总结主题: 总结团队周报\n内容重点: 总结团队成员每周工作，按成员、重点进展、成果产出、风险问题、下周计划整理');
        // templates hidden after selection
        expect(screen.queryByText('试试总结')).not.toBeInTheDocument();
    });

    it('fills the topic frame from a project progress template', async () => {
        await act(async () => {
            render(<SummaryCreatePage />);
            await flushPromises();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('汇总项目进展'));
        });

        const textarea = document.querySelector('.summary-workbench-textarea') as HTMLTextAreaElement;
        expect(textarea.value).toBe('总结主题: 汇总项目进展\n内容重点: 总结项目当前进展，按已完成、进行中、风险阻塞、下一步计划整理');
    });

    it('renders custom templates below builtin templates and fills topic on click', async () => {
        vi.mocked(getTopicTemplatesConfig).mockResolvedValueOnce({ custom_template_limit: 30, templates: [
            { id: 'weekly_report', label: '总结团队周报', icon: 'Calendar', description: '总结工作', type: 'fixed', pattern: '总结每周的工作周报' },
            { id: 'custom_risk', label: '风险复盘', icon: 'FileText', description: '按风险点整理', type: 'fixed', pattern: '按风险、影响、负责人分点总结', is_custom: true },
        ] });

        await act(async () => {
            render(<SummaryCreatePage />);
            await flushPromises();
        });

        expect(screen.getByText('我的模板 1/30')).toBeInTheDocument();
        expect(screen.getByText('风险复盘')).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByText('风险复盘'));
        });

        const textarea = document.querySelector('.summary-workbench-textarea') as HTMLTextAreaElement;
        expect(textarea.value).toBe('总结主题: 风险复盘\n内容重点: 按风险点整理');
    });

    it('disables custom template creation when the configured limit is reached', async () => {
        vi.mocked(getTopicTemplatesConfig).mockResolvedValueOnce({ custom_template_limit: 1, templates: [
            { id: 'weekly_report', label: '总结团队周报', icon: 'Calendar', description: '总结工作', type: 'fixed', pattern: '总结每周的工作周报' },
            { id: 'custom_risk', label: '风险复盘', icon: 'FileText', description: '按风险点整理', type: 'fixed', pattern: '按风险点整理', is_custom: true },
        ] });

        await act(async () => {
            render(<SummaryCreatePage />);
            await flushPromises();
        });

        expect(screen.getByText('我的模板 1/1')).toBeInTheDocument();
        expect(screen.getByText('已达到模板数量上限，删除旧模板后可继续新建')).toBeInTheDocument();
        expect(screen.getByText('新建模板').closest('button')).toBeDisabled();
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

// 完整创建页无频道上下文，session_id 落到统一兜底 key。
const WORKBENCH_KEY = 'agent-chat-session:__workbench__';

describe('SummaryCreatePage agent session_id persistence + history rehydrate + new session', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        (api.getAgentChatHistory as any).mockResolvedValue({ session_id: '', messages: [] });
    });

    it('persists the session_id to localStorage on the first send', async () => {
        (api.agentChat as any).mockImplementation(
            ({ message, session_id }: { message: string; session_id: string }) =>
                Promise.resolve({ reply: `echo: ${message}`, session_id }),
        );

        const ref = React.createRef<SummaryCreatePage>();
        await act(async () => {
            render(<SummaryCreatePage ref={ref} />);
            await flushPromises();
        });

        expect(localStorage.getItem(WORKBENCH_KEY)).toBeNull();

        await act(async () => {
            await (ref.current as any).handleAgentSend('hi');
            await flushPromises();
        });

        const stored = localStorage.getItem(WORKBENCH_KEY);
        expect(stored).toBeTruthy();
        expect(stored).toMatch(UUID_RE);
        // Persisted session_id matches the one sent to the backend.
        expect((api.agentChat as any).mock.calls[0][0].session_id).toBe(stored);
    });

    it('restores session_id + history when switching into agent mode', async () => {
        localStorage.setItem(WORKBENCH_KEY, 'restored-sid');
        (api.getAgentChatHistory as any).mockResolvedValue({
            session_id: 'restored-sid',
            messages: [
                { role: 'user', content: '之前问的问题' },
                { role: 'assistant', content: '之前的回答' },
            ],
        });

        const ref = React.createRef<SummaryCreatePage>();
        await act(async () => {
            render(<SummaryCreatePage ref={ref} />);
            await flushPromises();
        });

        await act(async () => {
            (ref.current as any).handleSelectMode('agent');
            await flushPromises();
        });

        expect((api.getAgentChatHistory as any).mock.calls[0][0]).toBe('restored-sid');
        expect((ref.current as any).state.sessionId).toBe('restored-sid');
        expect((ref.current as any).state.messages).toEqual([
            { role: 'user', content: '之前问的问题' },
            { role: 'assistant', content: '之前的回答' },
        ]);
    });

    it('silently degrades to a blank opener when history load fails', async () => {
        localStorage.setItem(WORKBENCH_KEY, 'restored-sid');
        (api.getAgentChatHistory as any).mockRejectedValue(new Error('backend down'));

        const ref = React.createRef<SummaryCreatePage>();
        await act(async () => {
            render(<SummaryCreatePage ref={ref} />);
            await flushPromises();
        });

        await act(async () => {
            (ref.current as any).handleSelectMode('agent');
            await flushPromises();
        });

        // session_id still restored (next send continues that session), messages blank.
        expect((ref.current as any).state.sessionId).toBe('restored-sid');
        expect((ref.current as any).state.messages).toEqual([]);
    });

    it('new session clears localStorage, messages and session_id', async () => {
        (api.agentChat as any).mockImplementation(
            ({ message, session_id }: { message: string; session_id: string }) =>
                Promise.resolve({ reply: `echo: ${message}`, session_id }),
        );

        const ref = React.createRef<SummaryCreatePage>();
        await act(async () => {
            render(<SummaryCreatePage ref={ref} />);
            await flushPromises();
        });

        await act(async () => {
            await (ref.current as any).handleAgentSend('hi');
            await flushPromises();
        });
        expect(localStorage.getItem(WORKBENCH_KEY)).toBeTruthy();
        expect((ref.current as any).state.messages.length).toBe(2);

        await act(async () => {
            (ref.current as any).handleNewSession();
            await flushPromises();
        });

        expect(localStorage.getItem(WORKBENCH_KEY)).toBeNull();
        expect((ref.current as any).state.messages).toEqual([]);
        expect((ref.current as any).state.sessionId).toBe('');

        // Next send generates a brand-new session_id (different from the old one).
        await act(async () => {
            await (ref.current as any).handleAgentSend('again');
            await flushPromises();
        });
        const newSid = localStorage.getItem(WORKBENCH_KEY);
        expect(newSid).toBeTruthy();
        expect(newSid).toMatch(UUID_RE);
    });
});



describe('SummaryCreatePage agent SSE session_id sync', () => {
    let writeSessionSpy: any;

    beforeEach(() => {
        vi.clearAllMocks();
        // Spy on the actual writeAgentChatSession from summaryHelpers
        writeSessionSpy = vi.spyOn(summaryHelpers, 'writeAgentChatSession').mockImplementation(() => {});
    });

    afterEach(() => {
        writeSessionSpy?.mockRestore();
    });

    it('updates sessionId and persists when backend returns different session_id', async () => {
        const ref = React.createRef<SummaryCreatePage>();
        await act(async () => {
            render(<SummaryCreatePage ref={ref} />);
            await flushPromises();
        });

        const instance = ref.current as any;
        
        // Set initial state with client session
        await act(async () => {
            instance.setState({ sessionId: 'client-session-abc', mode: 'agent' });
        });

        // Simulate SSE onDone calling handleAgentAssistantMessage with different session_id
        await act(async () => {
            instance.handleAgentAssistantMessage('Server response', 'server-session-xyz');
            await flushPromises();
        });

        // Verify writeAgentChatSession was called with the NEW session_id
        expect(writeSessionSpy).toHaveBeenCalledWith(undefined, 'server-session-xyz');
        
        // Verify state was updated to the NEW session_id
        expect(instance.state.sessionId).toBe('server-session-xyz');
        
        // Verify assistant message was added
        const lastMessage = instance.state.messages[instance.state.messages.length - 1];
        expect(lastMessage.role).toBe('assistant');
        expect(lastMessage.content).toBe('Server response');
    });

    it('does not persist when backend returns same session_id', async () => {
        const ref = React.createRef<SummaryCreatePage>();
        await act(async () => {
            render(<SummaryCreatePage ref={ref} />);
            await flushPromises();
        });

        const instance = ref.current as any;
        
        // Set initial state with session
        await act(async () => {
            instance.setState({ sessionId: 'same-session-id', mode: 'agent' });
        });

        writeSessionSpy.mockClear();

        // Simulate SSE onDone calling handleAgentAssistantMessage with SAME session_id
        await act(async () => {
            instance.handleAgentAssistantMessage('Server response', 'same-session-id');
            await flushPromises();
        });

        // Verify writeAgentChatSession was NOT called (no need to persist same value)
        expect(writeSessionSpy).not.toHaveBeenCalled();
        
        // Verify state sessionId remained unchanged
        expect(instance.state.sessionId).toBe('same-session-id');
        
        // Verify assistant message was still added
        const lastMessage = instance.state.messages[instance.state.messages.length - 1];
        expect(lastMessage.role).toBe('assistant');
        expect(lastMessage.content).toBe('Server response');
    });

    it('does not persist when backend returns undefined session_id', async () => {
        const ref = React.createRef<SummaryCreatePage>();
        await act(async () => {
            render(<SummaryCreatePage ref={ref} />);
            await flushPromises();
        });

        const instance = ref.current as any;
        
        // Set initial state with session
        await act(async () => {
            instance.setState({ sessionId: 'current-session-id', mode: 'agent' });
        });

        writeSessionSpy.mockClear();

        // Simulate SSE onDone calling handleAgentAssistantMessage without session_id
        await act(async () => {
            instance.handleAgentAssistantMessage('Server response', undefined);
            await flushPromises();
        });

        // Verify writeAgentChatSession was NOT called
        expect(writeSessionSpy).not.toHaveBeenCalled();
        
        // Verify state sessionId remained unchanged
        expect(instance.state.sessionId).toBe('current-session-id');
        
        // Verify assistant message was still added
        const lastMessage = instance.state.messages[instance.state.messages.length - 1];
        expect(lastMessage.role).toBe('assistant');
        expect(lastMessage.content).toBe('Server response');
    });
});

describe('SummaryCreatePage handleSubmit error handling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows friendly toast for 40001 (referenced summary lost after refresh)', async () => {
        const { Toast } = await import('@douyinfe/semi-ui');

        // Mock createAgentSummary to reject with axios-style 40001 error.
        // This is the exact shape the backend returns when
        //   session_id has no fetch_channel tool trace AND
        //   referenced_task_ids is empty AND
        //   origin_channel_id was not supplied by the front-end.
        // See internal/api/handler/agent_summary.go: "origin_channel_id 未传且无法从 session 反查".
        const err = {
            response: { data: { code: 40001, message: 'origin_channel_id 未传且无法从 session 反查' } },
        };
        (api.createAgentSummary as any).mockRejectedValueOnce(err);

        const ref = React.createRef<any>();
        await act(async () => {
            render(<SummaryCreatePage ref={ref} />);
            await flushPromises();
        });

        const instance = ref.current as any;

        // Simulate a completed agent chat session ready to save.
        await act(async () => {
            instance.setState({
                sessionId: 'session-abc',
                mode: 'agent',
                messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'summary' }],
            });
        });

        (Toast.error as any).mockClear();

        // Trigger the save flow directly on the instance.
        let result: boolean | undefined;
        await act(async () => {
            result = await instance.handleSaveAsSummary('a title');
            await flushPromises();
        });

        // Whichever method the component exposes, the 40001 branch should
        // surface the friendly, actionable copy — NOT the raw backend message.
        expect(Toast.error).toHaveBeenCalled();
        const shown = (Toast.error as any).mock.calls[0]?.[0] ?? '';
        expect(shown).toBe('保存失败：请重新选择引用总结，或点「新会话」重来');
        expect(result).toBe(false);
    });
});

describe('SummaryCreatePage derivedFromTask cross-session isolation (#907 P1 Jerry-Xin)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('clears leftover workbench session_id + messages when mounted with derivedFromTask', async () => {
        // Pre-seed leftover state from a previous chat about a DIFFERENT summary:
        //   - session_id survived from earlier workbench chat
        //   - referencedTask points to the old summary (task_id=99)
        // This mirrors the exact bug scenario Jerry-Xin flagged:
        //   user chats about A, closes without saving, opens "continue refine"
        //   from summary B's detail page → new mount receives derivedFromTask=B
        //   → old session_id (about A) must be discarded, else refresh-before-send
        //   restores A's history alongside B's reference and save corrupts derivation.
        localStorage.setItem('agent-chat-session:__workbench__', 'old-session-about-A');
        localStorage.setItem(
            'agent-chat-referenced:__workbench__',
            JSON.stringify({ task_id: 99, title: 'Old Summary A' }),
        );

        const derivedFromTaskB = {
            task_id: 42,
            task_no: 'ST-B',
            title: 'New Summary B',
            summary_mode: 1 as const,
            status: 3 as const,
            trigger_type: 3,
        };

        const ref = React.createRef<any>();
        await act(async () => {
            render(<SummaryCreatePage ref={ref} derivedFromTask={derivedFromTaskB as any} />);
            await flushPromises();
        });

        const instance = ref.current as any;

        // 1. Old session_id storage key MUST be gone — no restore of the stale A chat.
        expect(localStorage.getItem('agent-chat-session:__workbench__')).toBeNull();

        // 2. Referenced storage key MUST point to B (the new derivation target), not A.
        const storedRef = JSON.parse(localStorage.getItem('agent-chat-referenced:__workbench__') || 'null');
        expect(storedRef).toEqual({ task_id: 42, title: 'New Summary B' });

        // 3. React state must reflect a fresh session for B, not resumed A.
        expect(instance.state.sessionId).toBe('');
        expect(instance.state.messages).toEqual([]);
        expect(instance.state.referencedTask?.task_id).toBe(42);
        expect(instance.state.mode).toBe('agent');
    });

    it('when derivedFromTask is absent, does NOT touch existing workbench session (bare workbench entry unchanged)', async () => {
        // Reverse guard: bare full-page workbench entry (no derivedFromTask prop)
        // must NOT clear the user's in-progress session. This test protects the
        // #158/#161 resume-after-refresh scenario from being broken by the
        // #907 P1 fix — the two behaviours are orthogonal.
        localStorage.setItem('agent-chat-session:__workbench__', 'in-progress-session');
        localStorage.setItem(
            'agent-chat-referenced:__workbench__',
            JSON.stringify({ task_id: 7, title: 'Reference C' }),
        );

        await act(async () => {
            render(<SummaryCreatePage />);
            await flushPromises();
        });

        // Both storage keys survive the mount — enterAgentMode will restore them
        // when the user actually switches into agent mode.
        expect(localStorage.getItem('agent-chat-session:__workbench__')).toBe('in-progress-session');
        expect(
            JSON.parse(localStorage.getItem('agent-chat-referenced:__workbench__') || 'null'),
        ).toEqual({ task_id: 7, title: 'Reference C' });
    });
});
