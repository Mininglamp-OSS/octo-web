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
    Button: ({ children, onClick, disabled, ...rest }: any) => (
        <button onClick={onClick} disabled={disabled} {...rest}>
            {children}
        </button>
    ),
    Modal: ({ children, visible }: any) => (visible ? <div data-testid="modal">{children}</div> : null),
    Input: ({ value, onChange, ...rest }: any) => (
        <input value={value} onChange={(e) => onChange?.(e.target.value)} {...rest} />
    ),
    Toast: {
        error: vi.fn(),
        success: vi.fn(),
        warning: vi.fn(),
    },
}));

const mockT = (key: string) => key;

describe('AgentChatPanel SSE Mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
        const onAssistantMessage = vi.fn();

        // Mock agentChatStream to capture handlers
        (summaryApi.agentChatStream as any).mockImplementation((params: any, handlers: any) => {
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
            expect(onAssistantMessage).toHaveBeenCalledWith('Server response', 'server-session-xyz');
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
        
        // Mock agentChatStream to capture params and simulate successful response
        (summaryApi.agentChatStream as any).mockImplementation((params: any, handlers: any) => {
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
            expect(onAssistantMessage).toHaveBeenCalledWith('Backend response', 'new-session-123');
        }, { timeout: 1000 });
    });
});
