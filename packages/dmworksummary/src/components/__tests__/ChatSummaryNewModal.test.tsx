import React from 'react';
import { render as rtlRender, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ChatSummaryNewModal from '../ChatSummaryNewModal';
import * as summaryApi from '../../api/summaryApi';

import * as summaryHelpers from '../../utils/summaryHelpers';
vi.mock('@douyinfe/semi-ui', () => ({
    Modal: ({ children, visible, footer, onCancel }: any) =>
        visible ? (
            <div data-testid="modal">
                <div data-testid="modal-body">{children}</div>
                <div data-testid="modal-footer">{footer}</div>
            </div>
        ) : null,
    Toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
    Input: ({ value, onChange, ...rest }: any) => <input value={value} onChange={(e) => onChange?.(e.target.value)} {...rest} />,
    Tag: ({ children, closable, onClose }: any) => (
        <span data-testid="tag">
            {children}
            {closable && <button data-testid="tag-close" onClick={onClose}>x</button>}
        </span>
    ),
    Button: ({ children, onClick, disabled, loading, theme, icon, ...rest }: any) => (
        <button onClick={onClick} disabled={disabled} data-loading={loading} data-theme={theme} {...rest}>
            {icon}{children}
        </button>
    ),
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
    IconChevronDown: () => <span data-testid="icon-chevron-down" />,
}));

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return {
        ...actual,
        WKApp: { mittBus: { emit: vi.fn() } },
    };
});

vi.mock('../../utils/channelConvert', () => ({
    channelToChatCandidate: (ch: any) => ({
        chat_id: ch.channelID,
        chat_type: 'group',
        name: 'Test Chat',
        member_count: null,
    }),
}));

vi.mock('../../utils/channelType', () => ({
    getSourceType: () => 1,
}));

vi.mock('../../api/summaryApi', () => ({
    getTopicTemplatesConfig: vi.fn().mockResolvedValue({ templates: [], custom_template_limit: 30 }),
    createSummary: vi.fn().mockResolvedValue({ task_id: 1 }),
    agentChat: vi.fn(),
    getAgentChatHistory: vi.fn().mockResolvedValue({ session_id: '', messages: [] }),
}));

vi.mock('../TemplateCard', () => ({
    default: ({ template, onClick }: any) => (
        <div data-testid={`template-${template.id}`} onClick={() => onClick(template)}>
            {template.label}
        </div>
    ),
}));

vi.mock('../ChatSelectorModal', () => ({
    default: () => null,
}));

vi.mock('../ScheduleConfigModal', () => ({
    default: () => null,
}));

vi.mock('../../constants/templates', () => ({
    TOPIC_TEMPLATES: [
        { id: 'project_progress', label: '汇总项目进展', icon: 'FileText', description: '总结进展', type: 'parameterized', pattern: '总结 {project_name} 的项目进展', placeholders: [{ key: 'project_name', label: '输入项目名称', position: [3, 9] }] },
        { id: 'weekly_report', label: '总结团队周报', icon: 'Calendar', description: '总结工作', type: 'fixed', pattern: '总结每周的工作周报' },
        { id: 'chat_content', label: '总结聊天内容', icon: 'MessageSquare', description: '总结聊天', type: 'fixed', pattern: '总结本群中的关键内容' },
    ],
}));

function render(ui: React.ReactElement, options?: any) {
    return rtlRender(ui, { legacyRoot: true, ...options });
}

function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ChatSummaryNewModal', () => {
    const defaultProps = {
        visible: true,
        channel: { channelID: 'ch1', channelType: 2 },
        onClose: vi.fn(),
        onSubmit: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows updated description text', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        expect(screen.getByText('邀请同事一起总结信息，并根据聊天等内容自动总结')).toBeInTheDocument();
    });

    it('does not contain old description text', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        expect(screen.queryByText('邀请同事一起汇总信息，并根据聊天、文档、会议和邮件等自动总结。')).not.toBeInTheDocument();
    });

    it('shows templates when input is empty', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        expect(screen.getByText('试试总结')).toBeInTheDocument();
        expect(screen.getByTestId('template-weekly_report')).toBeInTheDocument();
        expect(screen.getByTestId('template-chat_content')).toBeInTheDocument();
    });

    it('hides templates when input has content', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const input = screen.getByPlaceholderText('输入聊天内你想总结的主题');
        fireEvent.change(input, { target: { value: '测试主题' } });

        expect(screen.queryByText('试试总结')).not.toBeInTheDocument();
        expect(screen.queryByTestId('template-weekly_report')).not.toBeInTheDocument();
    });

    it('shows templates again when input is cleared', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const input = screen.getByPlaceholderText('输入聊天内你想总结的主题');
        fireEvent.change(input, { target: { value: '测试' } });
        expect(screen.queryByText('试试总结')).not.toBeInTheDocument();

        fireEvent.change(input, { target: { value: '' } });
        expect(screen.getByText('试试总结')).toBeInTheDocument();
        expect(screen.getByTestId('template-weekly_report')).toBeInTheDocument();
    });

    it('renders templates inside the unified input-area container', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const body = screen.getByTestId('modal-body');
        const inputArea = body.querySelector('.chat-summary-modal-input-area');
        expect(inputArea).toBeInTheDocument();

        const input = inputArea!.querySelector('.chat-summary-modal-input');
        expect(input).toBeInTheDocument();

        const templatesLabel = inputArea!.querySelector('.chat-summary-modal-templates-label');
        expect(templatesLabel).toBeInTheDocument();
        expect(templatesLabel!.textContent).toBe('试试总结');

        const templatesContainer = inputArea!.querySelector('.chat-summary-modal-templates');
        expect(templatesContainer).toBeInTheDocument();
    });

    it('renders templates before chat selector in DOM order', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const body = screen.getByTestId('modal-body');
        const html = body.innerHTML;
        const templatesIdx = html.indexOf('template-weekly_report');
        const chatSelectorIdx = html.indexOf('chat-summary-modal-chat-section');
        expect(templatesIdx).toBeGreaterThan(-1);
        expect(chatSelectorIdx).toBeGreaterThan(-1);
        expect(templatesIdx).toBeLessThan(chatSelectorIdx);
    });

    it('input-area keeps its structure when templates are hidden', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const body = screen.getByTestId('modal-body');
        const inputArea = body.querySelector('.chat-summary-modal-input-area');
        expect(inputArea).toBeInTheDocument();

        const input = screen.getByPlaceholderText('输入聊天内你想总结的主题');
        fireEvent.change(input, { target: { value: '测试' } });

        expect(inputArea!.querySelector('.chat-summary-modal-input')).toBeInTheDocument();
        expect(inputArea!.querySelector('.chat-summary-modal-templates')).not.toBeInTheDocument();
    });

    it('parameterized template click fills the unified topic/context frame', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const templateCard = screen.getByTestId('template-project_progress');
        fireEvent.click(templateCard);

        const input = screen.getByPlaceholderText('输入聊天内你想总结的主题') as HTMLTextAreaElement;
        expect(input.value).toBe('总结主题: 汇总项目进展\n内容重点: 总结进展');

        await act(async () => {
            await flushPromises();
        });

        expect(input.value).toBe('总结主题: 汇总项目进展\n内容重点: 总结进展');
    });

    it('fixed template click does not set placeholder range', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const templateCard = screen.getByTestId('template-weekly_report');
        await act(async () => {
            fireEvent.click(templateCard);
            await flushPromises();
        });

        const input = screen.getByPlaceholderText('输入聊天内你想总结的主题') as HTMLTextAreaElement;
        expect(input.value).toBe('总结主题: 总结团队周报\n内容重点: 总结工作');

        await act(async () => {
            fireEvent.focus(input);
            await flushPromises();
        });

        expect(input.value).toBe('总结主题: 总结团队周报\n内容重点: 总结工作');
    });

    it('onChange clears placeholder range so subsequent focus does not remove text', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const templateCard = screen.getByTestId('template-project_progress');
        await act(async () => {
            fireEvent.click(templateCard);
            await flushPromises();
        });

        const input = screen.getByPlaceholderText('输入聊天内你想总结的主题') as HTMLTextAreaElement;
        fireEvent.change(input, { target: { value: '总结 我的项目 的项目进展' } });

        await act(async () => {
            fireEvent.focus(input);
            await flushPromises();
        });

        expect(input.value).toBe('总结 我的项目 的项目进展');
    });

    it('footer only contains the submit button', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const footer = screen.getByTestId('modal-footer');
        expect(footer.textContent).toContain('开始总结');
        expect(footer.textContent).not.toContain('添加成员');
        expect(footer.textContent).not.toContain('定时更新');
        expect(footer.textContent).not.toContain('总结并发到聊天');
    });

    it('submit button is disabled when input is empty', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const footer = screen.getByTestId('modal-footer');
        const submitBtn = footer.querySelector('button');
        expect(submitBtn).toBeDisabled();
    });

    it('does not render when not visible', () => {
        render(<ChatSummaryNewModal {...defaultProps} visible={false} />);
        expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
    });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('ChatSummaryNewModal agent multi-turn session_id + single-flight', () => {
    const defaultProps = {
        visible: true,
        channel: { channelID: 'ch1', channelType: 2 },
        onClose: vi.fn(),
        onSubmit: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('reuses the same (uuid-shaped, non-empty) session_id across two turns', async () => {
        (summaryApi.agentChat as any).mockImplementation(
            ({ message, session_id }: { message: string; session_id: string }) =>
                Promise.resolve({ reply: `echo: ${message}`, session_id }),
        );

        const ref = React.createRef<ChatSummaryNewModal>();
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} ref={ref} />);
            await flushPromises();
        });

        await act(async () => {
            await (ref.current as any).handleAgentSend('first question');
            await flushPromises();
        });
        await act(async () => {
            await (ref.current as any).handleAgentSend('second question');
            await flushPromises();
        });

        const calls = (summaryApi.agentChat as any).mock.calls;
        expect(calls.length).toBe(2);
        const sid1 = calls[0][0].session_id;
        const sid2 = calls[1][0].session_id;
        expect(sid1).toBeTruthy();
        expect(sid1).toMatch(UUID_RE);
        expect(sid2).toBe(sid1);
    });

    it('does not fire a second concurrent request while a send is in-flight', async () => {
        const deferred: Array<() => void> = [];
        (summaryApi.agentChat as any).mockImplementation(
            ({ session_id }: { session_id: string }) =>
                new Promise((resolve) => {
                    deferred.push(() => resolve({ reply: 'ok', session_id }));
                }),
        );

        const ref = React.createRef<ChatSummaryNewModal>();
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} ref={ref} />);
            await flushPromises();
        });

        // Fire two sends back-to-back without awaiting; the sync in-flight lock
        // must block the second before it can issue a request.
        (ref.current as any).handleAgentSend('a');
        (ref.current as any).handleAgentSend('b');
        expect((summaryApi.agentChat as any).mock.calls.length).toBe(1);

        await act(async () => {
            deferred.forEach((r) => r());
            await flushPromises();
        });
        await act(async () => {
            (ref.current as any).handleAgentSend('c');
            await flushPromises();
        });
        expect((summaryApi.agentChat as any).mock.calls.length).toBe(2);
    });
});

describe('ChatSummaryNewModal agent session_id persistence + history rehydrate + new session (channel-isolated)', () => {
    const propsFor = (channelID: string) => ({
        visible: true,
        channel: { channelID, channelType: 2 },
        onClose: vi.fn(),
        onSubmit: vi.fn(),
    });

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        (summaryApi.getAgentChatHistory as any).mockResolvedValue({ session_id: '', messages: [] });
    });

    it('persists session_id under a channel-scoped key on send', async () => {
        (summaryApi.agentChat as any).mockImplementation(
            ({ message, session_id }: { message: string; session_id: string }) =>
                Promise.resolve({ reply: `echo: ${message}`, session_id }),
        );

        const ref = React.createRef<ChatSummaryNewModal>();
        await act(async () => {
            render(<ChatSummaryNewModal {...propsFor('ch1')} ref={ref} />);
            await flushPromises();
        });

        await act(async () => {
            await (ref.current as any).handleAgentSend('hi');
            await flushPromises();
        });

        const stored = localStorage.getItem('agent-chat-session:ch1');
        expect(stored).toBeTruthy();
        expect(stored).toMatch(UUID_RE);
        // A different channel must not see this session (no cross-channel bleed).
        expect(localStorage.getItem('agent-chat-session:ch2')).toBeNull();
    });

    it('restores session_id + history for its own channel when switching into agent mode', async () => {
        localStorage.setItem('agent-chat-session:ch1', 'sid-ch1');
        (summaryApi.getAgentChatHistory as any).mockResolvedValue({
            session_id: 'sid-ch1',
            messages: [{ role: 'user', content: 'ch1 历史' }],
        });

        const ref = React.createRef<ChatSummaryNewModal>();
        await act(async () => {
            render(<ChatSummaryNewModal {...propsFor('ch1')} ref={ref} />);
            await flushPromises();
        });

        await act(async () => {
            (ref.current as any).handleSelectMode('agent');
            await flushPromises();
        });

        expect((summaryApi.getAgentChatHistory as any).mock.calls[0][0]).toBe('sid-ch1');
        expect((ref.current as any).state.sessionId).toBe('sid-ch1');
        expect((ref.current as any).state.messages).toEqual([{ role: 'user', content: 'ch1 历史' }]);
    });

    it('does not restore another channel\'s session', async () => {
        localStorage.setItem('agent-chat-session:ch2', 'sid-ch2');

        const ref = React.createRef<ChatSummaryNewModal>();
        await act(async () => {
            render(<ChatSummaryNewModal {...propsFor('ch1')} ref={ref} />);
            await flushPromises();
        });

        await act(async () => {
            (ref.current as any).handleSelectMode('agent');
            await flushPromises();
        });

        // ch1 has no stored session → no history fetch, blank opener.
        expect((summaryApi.getAgentChatHistory as any).mock.calls.length).toBe(0);
        expect((ref.current as any).state.sessionId).toBe('');
        expect((ref.current as any).state.messages).toEqual([]);
    });

    it('new session clears only this channel\'s stored session and the messages', async () => {
        (summaryApi.agentChat as any).mockImplementation(
            ({ message, session_id }: { message: string; session_id: string }) =>
                Promise.resolve({ reply: `echo: ${message}`, session_id }),
        );
        localStorage.setItem('agent-chat-session:ch2', 'sid-ch2');

        const ref = React.createRef<ChatSummaryNewModal>();
        await act(async () => {
            render(<ChatSummaryNewModal {...propsFor('ch1')} ref={ref} />);
            await flushPromises();
        });

        await act(async () => {
            await (ref.current as any).handleAgentSend('hi');
            await flushPromises();
        });
        expect(localStorage.getItem('agent-chat-session:ch1')).toBeTruthy();

        await act(async () => {
            (ref.current as any).handleNewSession();
            await flushPromises();
        });

        expect(localStorage.getItem('agent-chat-session:ch1')).toBeNull();
        // Other channel untouched.
        expect(localStorage.getItem('agent-chat-session:ch2')).toBe('sid-ch2');
});
});
describe('ChatSummaryNewModal agent SSE session_id sync', () => {
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
        const ref = React.createRef<ChatSummaryNewModal>();
        await act(async () => {
            render(<ChatSummaryNewModal ref={ref} channel={{channelID: 'ch-123', channelType: 2}} visible={true} onClose={vi.fn()} onSubmit={vi.fn()} />);
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
        expect(writeSessionSpy).toHaveBeenCalledWith('ch-123', 'server-session-xyz');
        
        // Verify state was updated to the NEW session_id
        expect(instance.state.sessionId).toBe('server-session-xyz');
        
        // Verify assistant message was added
        const lastMessage = instance.state.messages[instance.state.messages.length - 1];
        expect(lastMessage.role).toBe('assistant');
        expect(lastMessage.content).toBe('Server response');
    });

    it('does not persist when backend returns same session_id', async () => {
        const ref = React.createRef<ChatSummaryNewModal>();
        await act(async () => {
            render(<ChatSummaryNewModal ref={ref} channel={{channelID: 'ch-123', channelType: 2}} visible={true} onClose={vi.fn()} onSubmit={vi.fn()} />);
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
        const ref = React.createRef<ChatSummaryNewModal>();
        await act(async () => {
            render(<ChatSummaryNewModal ref={ref} channel={{channelID: 'ch-123', channelType: 2}} visible={true} onClose={vi.fn()} onSubmit={vi.fn()} />);
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
