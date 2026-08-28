import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AgentChatPanel from '../AgentChatPanel';
import type { ChatMessage } from '../../types/summary';
import * as summaryApi from '../../api/summaryApi';
import { I18nContext } from '@octo/base';

// Mock dependencies
vi.mock('../../api/summaryApi', () => ({
    agentChatStream: vi.fn(),
    agentChat: vi.fn(),
}));

vi.mock('@douyinfe/semi-ui', () => ({
    Modal: ({ children, visible }: any) => (visible ? <div data-testid="modal">{children}</div> : null),
    Toast: {
        error: vi.fn(),
        success: vi.fn(),
        warning: vi.fn(),
    },
}));

vi.mock('@octo/ui', () => ({
    Button: ({ children, onClick, disabled, loading, htmlType, ...rest }: any) => (
        <button type={htmlType ?? 'button'} onClick={onClick} disabled={disabled || loading} data-loading={loading} {...rest}>
            {children}
        </button>
    ),
    Input: ({ value, onChange, ...rest }: any) => (
        <input value={value} onChange={(e) => onChange?.(e.target.value)} {...rest} />
    ),
}));

const mockT = (key: string) => key;

describe('AgentChatPanel SSE Mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards structured selected channels on stream and fallback requests', async () => {
        const selectedChannels = [
            { chat_id: 'group-1', chat_type: 'group' as const, name: '项目群', member_count: 3 },
            { chat_id: 'group-1____thread-1', chat_type: 'thread' as const, name: '归档复盘', member_count: 2, is_archived: true },
        ];
        (summaryApi.agentChatStream as any).mockImplementation((params: any, handlers: any) => {
            expect(params.selected_channels).toEqual([
                { chat_id: 'group-1', chat_type: 'group', name: '项目群' },
                { chat_id: 'group-1____thread-1', chat_type: 'thread', name: '归档复盘', is_archived: true },
            ]);
            setImmediate(() => handlers.onError({ code: 0, message: 'transport closed', transient: true }));
            return { close: vi.fn() };
        });
        (summaryApi.agentChat as any).mockResolvedValue({ reply: 'ok', session_id: 'selected-session' });

        render(
            <I18nContext.Provider value={{ t: mockT, locale: 'zh-CN' }}>
                <AgentChatPanel
                    messages={[]}
                    onSend={vi.fn()}
                    sending={false}
                    useStream
                    sessionId="selected-session"
                    profile="summary"
                    selectedChannels={selectedChannels}
                    onUserMessage={vi.fn()}
                    onAssistantMessage={vi.fn()}
                />
            </I18nContext.Provider>,
        );

        fireEvent.change(screen.getByPlaceholderText('summary.create.agentChatPlaceholder'), { target: { value: '总结它们' } });
        fireEvent.click(screen.getByText('summary.create.send'));

        await waitFor(() => expect(summaryApi.agentChat).toHaveBeenCalledWith(expect.objectContaining({
            selected_channels: [
                { chat_id: 'group-1', chat_type: 'group', name: '项目群' },
                { chat_id: 'group-1____thread-1', chat_type: 'thread', name: '归档复盘', is_archived: true },
            ],
        })), { timeout: 2000 });
    });

    it('generates a request_id and reuses it across stream→fallback (WEB-03)', async () => {
        let streamRequestId: string | undefined;
        const onAssistantMessage = vi.fn();
        (summaryApi.agentChatStream as any).mockImplementation((params: any, handlers: any) => {
            streamRequestId = params.request_id;
            setImmediate(() => handlers.onError({ code: 0, message: 'transport closed', transient: true }));
            return { close: vi.fn() };
        });
        (summaryApi.agentChat as any).mockResolvedValue({ reply: 'ok', session_id: 's', run_id: 'run-1' });

        render(
            <I18nContext.Provider value={{ t: mockT, locale: 'zh-CN' }}>
                <AgentChatPanel
                    messages={[]}
                    onSend={vi.fn()}
                    sending={false}
                    useStream
                    sessionId="s"
                    profile="summary"
                    onUserMessage={vi.fn()}
                    onAssistantMessage={onAssistantMessage}
                />
            </I18nContext.Provider>,
        );
        fireEvent.change(screen.getByPlaceholderText('summary.create.agentChatPlaceholder'), { target: { value: '总结' } });
        fireEvent.click(screen.getByText('summary.create.send'));

        await waitFor(() => expect(summaryApi.agentChat).toHaveBeenCalled(), { timeout: 2000 });
        // request_id generated on the stream request…
        expect(typeof streamRequestId).toBe('string');
        expect(streamRequestId).toBeTruthy();
        // …and the SAME id reused on the fallback (idempotent retry, one Run).
        expect(summaryApi.agentChat).toHaveBeenCalledWith(
            expect.objectContaining({ request_id: streamRequestId }),
        );
        expect(onAssistantMessage).toHaveBeenCalledWith('ok', 's', streamRequestId);
    });

    it('gives each logical submit a distinct request_id (WEB-03)', async () => {
        const seen: string[] = [];
        (summaryApi.agentChatStream as any).mockImplementation((params: any, handlers: any) => {
            seen.push(params.request_id);
            setImmediate(() => handlers.onDone?.({ reply: 'ok', session_id: 's' }));
            return { close: vi.fn() };
        });

        render(
            <I18nContext.Provider value={{ t: mockT, locale: 'zh-CN' }}>
                <AgentChatPanel
                    messages={[]}
                    onSend={vi.fn()}
                    sending={false}
                    useStream
                    sessionId="s"
                    profile="summary"
                    onUserMessage={vi.fn()}
                    onAssistantMessage={vi.fn()}
                />
            </I18nContext.Provider>,
        );
        const textarea = screen.getByPlaceholderText('summary.create.agentChatPlaceholder');
        const send = screen.getByText('summary.create.send');

        await act(async () => {
            fireEvent.change(textarea, { target: { value: '第一轮' } });
            fireEvent.click(send);
        });
        await waitFor(() => expect(seen).toHaveLength(1), { timeout: 2000 });

        await act(async () => {
            fireEvent.change(textarea, { target: { value: '第二轮' } });
            fireEvent.click(send);
        });
        await waitFor(() => expect(seen).toHaveLength(2), { timeout: 2000 });

        // Two genuinely distinct submits must NOT collapse into one backend Run.
        expect(seen[0]).toBeTruthy();
        expect(seen[1]).toBeTruthy();
        expect(seen[0]).not.toBe(seen[1]);
    });

    it('binds save to the last SUCCESSFUL turn, not a later failed one (WEB-03)', async () => {
        const onSaveAsSummary = vi.fn().mockResolvedValue(true);
        const seen: string[] = [];
        let call = 0;
        (summaryApi.agentChatStream as any).mockImplementation((params: any, handlers: any) => {
            seen.push(params.request_id);
            call++;
            // 1st submit succeeds; 2nd fails with a NON-transient backend error
            // (no fallback), so it must not overwrite the bound request_id.
            if (call === 1) {
                setImmediate(() => handlers.onDone?.({ reply: 'good answer', session_id: 's' }));
            } else {
                setImmediate(() => handlers.onError?.({ code: 50001, message: 'backend failed' }));
            }
            return { close: vi.fn() };
        });

        const ref = React.createRef<AgentChatPanel>();
        render(
            <I18nContext.Provider value={{ t: mockT, locale: 'zh-CN' }}>
                <AgentChatPanel
                    ref={ref}
                    messages={[{ role: 'assistant', content: 'good answer' } as ChatMessage]}
                    onSend={vi.fn()}
                    sending={false}
                    useStream
                    sessionId="s"
                    profile="summary"
                    onUserMessage={vi.fn()}
                    onAssistantMessage={vi.fn()}
                    onSaveAsSummary={onSaveAsSummary}
                />
            </I18nContext.Provider>,
        );
        const textarea = screen.getByPlaceholderText('summary.create.agentChatPlaceholder');
        const send = screen.getByText('summary.create.send');

        await act(async () => {
            fireEvent.change(textarea, { target: { value: '第一轮' } });
            fireEvent.click(send);
        });
        await waitFor(() => expect(seen).toHaveLength(1), { timeout: 2000 });

        await act(async () => {
            fireEvent.change(textarea, { target: { value: '第二轮' } });
            fireEvent.click(send);
        });
        await waitFor(() => expect(seen).toHaveLength(2), { timeout: 2000 });

        // Drive the real save-confirm path (the Semi Modal mock does not render okText).
        const instance = ref.current as any;
        await act(async () => {
            instance.setState({ showSaveDialog: true, summaryTitle: '标题' });
        });
        await act(async () => {
            await instance.handleSaveConfirm();
        });

        await waitFor(() => expect(onSaveAsSummary).toHaveBeenCalled(), { timeout: 2000 });
        // The failed 2nd turn froze no manifest — save must still point at turn 1.
        expect(onSaveAsSummary).toHaveBeenCalledWith('标题', seen[0]);
    });

    it('keeps old request behavior when no chat is selected', async () => {
        (summaryApi.agentChatStream as any).mockImplementation((params: any) => {
            expect(params.selected_channels).toBeUndefined();
            return { close: vi.fn() };
        });
        render(
            <I18nContext.Provider value={{ t: mockT, locale: 'zh-CN' }}>
                <AgentChatPanel messages={[]} onSend={vi.fn()} sending={false} useStream sessionId="empty-selection" profile="summary" />
            </I18nContext.Provider>,
        );
        fireEvent.change(screen.getByPlaceholderText('summary.create.agentChatPlaceholder'), { target: { value: '你好' } });
        fireEvent.click(screen.getByText('summary.create.send'));
        await waitFor(() => expect(summaryApi.agentChatStream).toHaveBeenCalled(), { timeout: 1000 });
    });

    it('should handle backend error without fallback (P2.4)', async () => {
        const onUserMessage = vi.fn();
        const onAssistantMessage = vi.fn();
        const onSend = vi.fn();

        // Mock agentChatStream to return immediately and call onError
        (summaryApi.agentChatStream as any).mockImplementation((params: any, handlers: any) => {
            // Call onError immediately (simulating backend error)
            setImmediate(() => {
                handlers.onError({ code: 500, message: 'Backend error' });
            });
            return { close: vi.fn() };
        });

        // Mock agentChat (should NOT be called after P2.4)
        (summaryApi.agentChat as any).mockResolvedValue({
            reply: 'Fallback reply',
            session_id: 'test-session',
        });

        render(
            <I18nContext.Provider value={{ t: mockT, locale: 'zh-CN' }}>
                <AgentChatPanel
                    messages={[]}
                    onSend={onSend}
                    sending={false}
                    useStream={true}
                    sessionId="test-session"
                    profile="summary"
                    onUserMessage={onUserMessage}
                    onAssistantMessage={onAssistantMessage}
                />
            </I18nContext.Provider>,
        );

        const textarea = screen.getByPlaceholderText('summary.create.agentChatPlaceholder');
        const sendButton = screen.getByText('summary.create.send');

        // Type and send message
        fireEvent.change(textarea, { target: { value: 'test message' } });
        fireEvent.click(sendButton);

        // Wait for user message callback
        await waitFor(() => expect(onUserMessage).toHaveBeenCalledWith('test message', 'test-session'), { timeout: 2000 });

        // P2.4: Backend error should NOT trigger fallback (prevents duplicate agent turn)
        await new Promise(resolve => setTimeout(resolve, 500));
        expect(summaryApi.agentChat).not.toHaveBeenCalled();
        expect(onAssistantMessage).not.toHaveBeenCalled();
    });

    it('stays busy until a transient stream fallback settles', async () => {
        let resolveFallback: ((value: { reply: string; session_id: string }) => void) | undefined;
        const onNewSession = vi.fn();

        (summaryApi.agentChatStream as any).mockImplementation((_params: any, handlers: any) => {
            setImmediate(() => handlers.onError({ code: 50000, message: 'transport closed', transient: true }));
            return { close: vi.fn() };
        });
        (summaryApi.agentChat as any).mockImplementation(() => new Promise((resolve) => {
            resolveFallback = resolve;
        }));

        render(
            <I18nContext.Provider value={{ t: mockT, locale: 'zh-CN' }}>
                <AgentChatPanel
                    messages={[]}
                    onSend={vi.fn()}
                    sending={false}
                    useStream
                    sessionId="busy-session"
                    profile="summary"
                    onNewSession={onNewSession}
                    onUserMessage={vi.fn()}
                    onAssistantMessage={vi.fn()}
                />
            </I18nContext.Provider>,
        );

        const textarea = screen.getByPlaceholderText('summary.create.agentChatPlaceholder');
        fireEvent.change(textarea, { target: { value: '需要回退' } });
        fireEvent.click(screen.getByText('summary.create.send'));

        await waitFor(() => expect(summaryApi.agentChat).toHaveBeenCalled(), { timeout: 2000 });
        expect(textarea).toBeDisabled();
        expect(screen.getByRole('button', { name: 'summary.create.newSession' })).toBeDisabled();

        await act(async () => {
            resolveFallback?.({ reply: 'fallback reply', session_id: 'busy-session' });
        });

        await waitFor(() => expect(textarea).not.toBeDisabled(), { timeout: 2000 });
        expect(screen.getByRole('button', { name: 'summary.create.newSession' })).not.toBeDisabled();
        expect(onNewSession).not.toHaveBeenCalled();
    });

    it('should handle successful SSE stream completion', async () => {
        let savedHandlers: any = null;
        const onUserMessage = vi.fn();
        const onAssistantMessage = vi.fn();

        // Mock agentChatStream to capture handlers
        (summaryApi.agentChatStream as any).mockImplementation((params: any, handlers: any) => {
            savedHandlers = handlers;
            // Verify request parameters have correct field names
            expect(params).toEqual(
                expect.objectContaining({
                    session_id: 'test-session',
                    message: 'test message',
                    profile: 'summary',
                })
            );
            return { close: vi.fn() };
        });

        let messages: ChatMessage[] = [];
        const TestWrapper = () => {
            const [msgs, setMsgs] = React.useState<ChatMessage[]>(messages);

            return (
                <I18nContext.Provider value={{ t: mockT, locale: 'zh-CN' }}>
                    <AgentChatPanel
                        messages={msgs}
                        onSend={vi.fn()}
                        sending={false}
                        useStream={true}
                        sessionId="test-session"
                        profile="summary"
                        onUserMessage={(text) => {
                            const newMsgs = [...msgs, { role: 'user' as const, content: text }];
                            setMsgs(newMsgs);
                            messages = newMsgs;
                        }}
                        onAssistantMessage={(text) => {
                            onAssistantMessage(text);
                            const newMsgs = [...msgs, { role: 'assistant' as const, content: text }];
                            setMsgs(newMsgs);
                            messages = newMsgs;
                        }}
                    />
                </I18nContext.Provider>
            );
        };

        const { container } = render(<TestWrapper />);

        const textarea = screen.getByPlaceholderText('summary.create.agentChatPlaceholder');
        const sendButton = screen.getByText('summary.create.send');

        // Send message
        fireEvent.change(textarea, { target: { value: 'test message' } });
        fireEvent.click(sendButton);

        // Wait for stream to be set up
        await waitFor(() => expect(savedHandlers).not.toBeNull(), { timeout: 1000 });

        // Simulate progress
        act(() => {
            savedHandlers.onProgress({ phase: 'understand', step: 1, ofSteps: 8, elapsed_ms: 0, count: 5 });
        });

        // Verify process panel is expanded during streaming
        await waitFor(() => {
            const panel = container.querySelector('.agent-chat-process-panel');
            expect(panel).not.toBeNull();
            expect(panel).not.toHaveClass('agent-chat-process-panel--collapsed');
        }, { timeout: 1000 });

        // Trigger onDone with correct field name (reply, not final_answer)
        act(() => {
            savedHandlers.onDone({ reply: 'Success response', session_id: 'test-session' });
        });

        // Verify onAssistantMessage was called with the reply
        await waitFor(() => {
            expect(onAssistantMessage).toHaveBeenCalledWith('Success response');
        }, { timeout: 1000 });
        // Verify panel is collapsed after completion
        await waitFor(() => {
            const panel = container.querySelector('.agent-chat-process-panel');
            expect(panel).not.toBeNull();
            if (panel) {
                expect(panel.classList.contains('agent-chat-process-panel--collapsed')).toBe(true);
            }
        }, { timeout: 2000 });
    });

    it('should pass session_id from onDone event to onAssistantMessage callback', async () => {
        let savedHandlers: any = null;
        let streamRequestId: string | undefined;
        const onAssistantMessage = vi.fn();

        // Mock agentChatStream to capture handlers
        (summaryApi.agentChatStream as any).mockImplementation((params: any, handlers: any) => {
            streamRequestId = params.request_id;
            savedHandlers = handlers;
            return { close: vi.fn() };
        });

        let messages: ChatMessage[] = [{ role: 'user' as const, content: 'test' }];

        render(
            <I18nContext.Provider value={{ t: mockT, locale: 'zh-CN' }}>
                <AgentChatPanel
                    messages={messages}
                    onSend={vi.fn()}
                    sending={false}
                    useStream={true}
                    sessionId="client-session-abc"
                    profile="summary"
                    onUserMessage={vi.fn()}
                    onAssistantMessage={onAssistantMessage}
                />
            </I18nContext.Provider>
        );

        const textarea = screen.getByPlaceholderText('summary.create.agentChatPlaceholder');
        const sendButton = screen.getByText('summary.create.send');

        // Send message
        fireEvent.change(textarea, { target: { value: 'test question' } });
        fireEvent.click(sendButton);

        // Wait for stream to be set up
        await waitFor(() => expect(savedHandlers).not.toBeNull(), { timeout: 1000 });

        // Backend returns different session_id in done event
        act(() => {
            savedHandlers.onDone({
                reply: 'Server response',
                session_id: 'server-session-xyz',
            });
        });

        // Verify panel passes BOTH text and session_id to the callback
        // (Parent component is responsible for persisting and updating state)
        await waitFor(() => {
            expect(onAssistantMessage).toHaveBeenCalledWith('Server response', 'server-session-xyz', streamRequestId);
        }, { timeout: 1000 });
    });

    it('should cleanup stream on unmount', async () => {
        const closeFn = vi.fn();

        // Mock agentChatStream
        (summaryApi.agentChatStream as any).mockImplementation(() => {
            return { close: closeFn };
        });

        const { unmount } = render(
            <I18nContext.Provider value={{ t: mockT, locale: 'zh-CN' }}>
                <AgentChatPanel
                    messages={[]}
                    onSend={vi.fn()}
                    sending={false}
                    useStream={true}
                    sessionId="test-session"
                    profile="summary"
                    onUserMessage={vi.fn()}
                    onAssistantMessage={vi.fn()}
                />
            </I18nContext.Provider>,
        );

        const textarea = screen.getByPlaceholderText('summary.create.agentChatPlaceholder');
        const sendButton = screen.getByText('summary.create.send');

        // Send message to start stream
        fireEvent.change(textarea, { target: { value: 'test message' } });
        fireEvent.click(sendButton);

        // Wait for stream to start
        await waitFor(() => expect(summaryApi.agentChatStream).toHaveBeenCalled(), { timeout: 1000 });

        // Unmount component
        unmount();

        // Verify close was called
        expect(closeFn).toHaveBeenCalled();
    });

    it('should add aria-live to process timeline', async () => {
        let savedHandlers: any = null;
        let messages: ChatMessage[] = [];

        // Mock agentChatStream to capture handlers
        (summaryApi.agentChatStream as any).mockImplementation((params: any, handlers: any) => {
            savedHandlers = handlers;
            return { close: vi.fn() };
        });

        const TestWrapper = () => {
            const [msgs, setMsgs] = React.useState<ChatMessage[]>(messages);

            return (
                <I18nContext.Provider value={{ t: mockT, locale: 'zh-CN' }}>
                    <AgentChatPanel
                        messages={msgs}
                        onSend={vi.fn()}
                        sending={false}
                        useStream={true}
                        sessionId="test-session"
                        profile="summary"
                        onUserMessage={(text) => {
                            const newMsgs = [...msgs, { role: 'user' as const, content: text }];
                            setMsgs(newMsgs);
                            messages = newMsgs;
                        }}
                        onAssistantMessage={vi.fn()}
                    />
                </I18nContext.Provider>
            );
        };

        const { container } = render(<TestWrapper />);

        const textarea = screen.getByPlaceholderText('summary.create.agentChatPlaceholder');
        const sendButton = screen.getByText('summary.create.send');

        // Send message
        fireEvent.change(textarea, { target: { value: 'test message' } });
        fireEvent.click(sendButton);

        // Wait for stream to be set up
        await waitFor(() => expect(savedHandlers).not.toBeNull(), { timeout: 1000 });

        // Trigger progress event to make panel appear
        act(() => {
            savedHandlers.onProgress({ phase: 'understand', step: 1, ofSteps: 8, elapsed_ms: 0 });
        });

        // Wait for timeline to appear and check aria-live
        await waitFor(() => {
            const timeline = container.querySelector('.agent-chat-process-timeline');
            expect(timeline).not.toBeNull();
            expect(timeline).toHaveAttribute('aria-live', 'polite');
        }, { timeout: 2000 });
    });

    it('should allow first send with empty sessionId and pass it to backend', async () => {
        const onUserMessage = vi.fn();
        const onAssistantMessage = vi.fn();
        let streamRequestId: string | undefined;
        
        // Mock agentChatStream to capture params and simulate successful response
        (summaryApi.agentChatStream as any).mockImplementation((params: any, handlers: any) => {
            streamRequestId = params.request_id;
            // P2.1: AgentChatPanel generates UUID when sessionId is empty
            expect(params.session_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
            expect(params.message).toBe('First message');
            expect(params.profile).toBe('summary');
            
            // Simulate backend response with new session_id
            setImmediate(() => {
                handlers.onDone?.({ reply: 'Backend response', session_id: 'new-session-123' });
            });
            
            return { close: vi.fn() };
        });
        
        const { container } = render(
            <I18nContext.Provider value={{ t: mockT, locale: 'zh_CN' }}>
                <AgentChatPanel
                    useStream={true}
                    sessionId=""
                    profile="summary"
                    onUserMessage={onUserMessage}
                    messages={[]}
                    onAssistantMessage={onAssistantMessage}
                    onSend={vi.fn()}
                />
            </I18nContext.Provider>
        );
        
        const input = container.querySelector('input');
        const textarea = screen.getByPlaceholderText('summary.create.agentChatPlaceholder');
        
        const sendButton = screen.getByText('summary.create.send');
        // Type and send first message with empty sessionId
        await act(async () => {
            fireEvent.change(textarea, { target: { value: 'First message' } });
        });
        
        await act(async () => {
            fireEvent.click(sendButton);
        });
        
        // Wait for handlers to be called
        await waitFor(() => {
            expect(summaryApi.agentChatStream).toHaveBeenCalledWith(expect.objectContaining({ session_id: expect.any(String), message: 'First message', profile: 'summary' }), expect.any(Object));
            expect(onUserMessage).toHaveBeenCalledWith('First message', expect.any(String));
            // WEB-03: the generation turn's request_id rides along so the parent can
            // persist it and bind the save call to that run's frozen manifest.
            expect(onAssistantMessage).toHaveBeenCalledWith('Backend response', 'new-session-123', streamRequestId);
        }, { timeout: 1000 });
    });
});
