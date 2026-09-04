import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { agentChatStream, streamSummaryWorkspaceTurn } from '../summaryApi';

// Mock WKApp
global.WKApp = {
    loginInfo: { token: 'test-token' },
    shared: { currentSpaceId: 'test-space' },
} as any;

describe('agentChatStream', () => {
    let fetchMock: any;

    beforeEach(() => {
        fetchMock = vi.fn();
        global.fetch = fetchMock;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should parse SSE frames split across multiple chunks', async () => {
        const onProgress = vi.fn();
        const onDone = vi.fn();
        const onError = vi.fn();

        // Simulate a frame split across two read() calls:
        // First chunk: "event: progress\n"
        // Second chunk: "data: {\"phase\":\"explore\",\"step\":1,\"detail\":\"test\"}\n\n"
        const mockReader = {
            read: vi
                .fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: new TextEncoder().encode('event: progress\n'),
                })
                .mockResolvedValueOnce({
                    done: false,
                    value: new TextEncoder().encode('data: {"phase":"understand","step":1,"count":5}\n\n'),
                })
                .mockResolvedValueOnce({
                    done: true,
                    value: undefined,
                }),
            cancel: vi.fn(),
            releaseLock: vi.fn(),
        };

        fetchMock.mockResolvedValueOnce({
            ok: true,
            body: {
                getReader: () => mockReader,
            },
        });

        const { close } = agentChatStream(
            {
                session_id: 'test-session',
                message: 'test question',
                profile: 'summary',
            },
            {
                onProgress,
                onDone,
                onError,
            },
        );

        // Wait for async processing
        await new Promise((resolve) => setTimeout(resolve, 100));
        // Verify fetch was called with correct body structure
        expect(fetchMock).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                body: JSON.stringify({
                    session_id: 'test-session',
                    message: 'test question',
                    profile: 'summary',
                }),
            }),
        );

        // The event should be parsed and dispatched
        expect(onProgress).toHaveBeenCalledTimes(1);
        expect(onProgress).toHaveBeenCalledWith({
            phase: 'understand',
            step: 1,
            count: 5,
        });

        close();
    });

    it('should parse multiple SSE events in sequence', async () => {
        const onProgress = vi.fn();
        const onDone = vi.fn();
        const onError = vi.fn();

        const sseData = `event: progress
data: {"phase":"understand","step":1,"count":3}

event: progress
data: {"phase":"retrieve","step":2,"count":8}

event: done
data: {"reply":"test result"}

`;

        const mockReader = {
            read: vi
                .fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: new TextEncoder().encode(sseData),
                })
                .mockResolvedValueOnce({
                    done: true,
                    value: undefined,
                }),
            cancel: vi.fn(),
            releaseLock: vi.fn(),
        };

        fetchMock.mockResolvedValueOnce({
            ok: true,
            body: {
                getReader: () => mockReader,
            },
        });

        const { close } = agentChatStream(
            {
                session_id: 'test-session',
                message: 'test question',
                profile: 'summary',
            },
            {
                onProgress,
                onDone,
                onError,
            },
        );

        // Wait for async processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(onProgress).toHaveBeenCalledTimes(2);
        expect(onProgress).toHaveBeenNthCalledWith(1, {
            phase: 'understand',
            step: 1,
            count: 3,
        });
        expect(onProgress).toHaveBeenNthCalledWith(2, {
            phase: 'retrieve',
            step: 2,
            count: 8,
        });

        expect(onDone).toHaveBeenCalledTimes(1);
        expect(onDone).toHaveBeenCalledWith({
            reply: 'test result',
        });

        close();
    });

    it('surfaces run_id in the done event (SS-11 v2 contract)', async () => {
        const onDone = vi.fn();
        const sseData = `event: done
data: {"reply":"r","session_id":"s1","run_id":"run-abc"}

`;
        const mockReader = {
            read: vi
                .fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: new TextEncoder().encode(sseData),
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            cancel: vi.fn(),
            releaseLock: vi.fn(),
        };
        fetchMock.mockResolvedValueOnce({
            ok: true,
            body: { getReader: () => mockReader },
        });

        const { close } = agentChatStream({ session_id: 's1', message: 'q', profile: 'summary' }, { onDone });
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(onDone).toHaveBeenCalledWith({
            reply: 'r',
            session_id: 's1',
            run_id: 'run-abc',
        });
        close();
    });

    it('preserves the structured summary workspace done payload', async () => {
        const onDone = vi.fn();
        const payload = {
            contract_version: '1',
            reply: '需要确认协作要求。',
            session_id: 'session-1',
            message_id: 22,
            result_type: 'workflow_confirmation',
            scope_version: 2,
            available_actions: ['confirm_workflow'],
            state: {
                scope_version: 2,
                summary_context: {
                    selected_channels: [],
                    participants: [],
                    template: null,
                    time_range: null,
                    referenced_task_ids: [],
                },
                current_preview: null,
                pending_proposal: null,
                workflow: null,
            },
        };
        const sseData = `event: done\ndata: ${JSON.stringify(payload)}\n\n`;
        const mockReader = {
            read: vi
                .fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: new TextEncoder().encode(sseData),
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            cancel: vi.fn(),
            releaseLock: vi.fn(),
        };
        fetchMock.mockResolvedValueOnce({
            ok: true,
            body: { getReader: () => mockReader },
        });

        const { close } = streamSummaryWorkspaceTurn(
            {
                session_id: 'session-1',
                profile: 'summary_workspace',
                action: 'chat',
                message: '开始总结',
                input_origin: 'user',
                request_id: 'request-1',
                scope_version: 2,
                summary_context: {
                    selected_channels: [],
                    participants: [],
                    template: null,
                    time_range: null,
                    referenced_task_ids: [],
                },
            },
            { onDone },
        );
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(onDone).toHaveBeenCalledWith(payload);
        close();
    });

    it('sends request_id and run_id in the request body when provided (SS-11)', async () => {
        const mockReader = {
            read: vi.fn().mockResolvedValueOnce({ done: true, value: undefined }),
            cancel: vi.fn(),
            releaseLock: vi.fn(),
        };
        fetchMock.mockResolvedValueOnce({
            ok: true,
            body: { getReader: () => mockReader },
        });

        const { close } = agentChatStream(
            {
                session_id: 's1',
                message: 'q',
                profile: 'summary',
                request_id: 'req-1',
                run_id: 'run-1',
            },
            { onDone: vi.fn(), onError: vi.fn() },
        );
        await new Promise((resolve) => setTimeout(resolve, 50));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.request_id).toBe('req-1');
        expect(body.run_id).toBe('run-1');
        close();
    });

    it('does not synthesize a transient close error after a backend error event', async () => {
        const onError = vi.fn();
        const sseData = `event: error
data: {"code":50001,"message":"backend failed"}

`;
        const mockReader = {
            read: vi
                .fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: new TextEncoder().encode(sseData),
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            cancel: vi.fn(),
            releaseLock: vi.fn(),
        };
        fetchMock.mockResolvedValueOnce({
            ok: true,
            body: { getReader: () => mockReader },
        });

        const { close } = agentChatStream(
            {
                session_id: 's1',
                message: 'q',
                profile: 'summary',
                request_id: 'req-1',
            },
            { onError },
        );
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith({
            code: 50001,
            message: 'backend failed',
        });
        close();
    });

    it('synthesizes a transient close error when an error frame is malformed', async () => {
        const onDone = vi.fn();
        const onError = vi.fn();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const sseData = `event: error
data: {"code":50001

`;
        const mockReader = {
            read: vi
                .fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: new TextEncoder().encode(sseData),
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            cancel: vi.fn(),
            releaseLock: vi.fn(),
        };
        fetchMock.mockResolvedValueOnce({
            ok: true,
            body: { getReader: () => mockReader },
        });

        const { close } = agentChatStream(
            {
                session_id: 's1',
                message: 'q',
                profile: 'summary',
                request_id: 'req-1',
            },
            { onDone, onError },
        );
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(onDone).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith({
            code: 50000,
            message: 'stream closed without done',
            transient: true,
        });
        expect(warn).toHaveBeenCalled();
        close();
    });

    it('synthesizes a transient close error when the final done frame is truncated', async () => {
        const onDone = vi.fn();
        const onError = vi.fn();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const mockReader = {
            read: vi
                .fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: new TextEncoder().encode('event: done\ndata: {"reply":"partial'),
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            cancel: vi.fn(),
            releaseLock: vi.fn(),
        };
        fetchMock.mockResolvedValueOnce({
            ok: true,
            body: { getReader: () => mockReader },
        });

        const { close } = agentChatStream({ session_id: 's1', message: 'q', profile: 'summary' }, { onDone, onError });
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(onDone).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ transient: true }));
        close();
    });

    it('preserves a pre-stream HTTP 400 business envelope', async () => {
        const onError = vi.fn();
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 400,
            text: vi.fn().mockResolvedValue(JSON.stringify({ code: 40000, message: 'invalid summary context' })),
        });

        const { close } = streamSummaryWorkspaceTurn(
            {
                session_id: 'session-1',
                profile: 'summary_workspace',
                action: 'chat',
                message: '开始总结',
                input_origin: 'user',
                request_id: 'request-1',
                scope_version: 1,
                summary_context: {
                    selected_channels: [],
                    participants: [],
                    template: null,
                    time_range: null,
                    referenced_task_ids: [],
                },
            },
            { onError },
        );
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(onError).toHaveBeenCalledWith({
            code: 40000,
            message: 'invalid summary context',
            transient: false,
        });
        close();
    });

    it('marks string 40902 as transient so an in-flight request can be retried', async () => {
        const onError = vi.fn();
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 409,
            text: vi.fn().mockResolvedValue(
                JSON.stringify({
                    code: '40902',
                    message: 'request still in progress',
                }),
            ),
        });

        const { close } = agentChatStream(
            { session_id: 's1', message: 'q', profile: 'summary' },
            { onError },
        );
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(onError).toHaveBeenCalledWith({
            code: '40902',
            message: 'request still in progress',
            transient: true,
        });
        close();
    });

    it.each([404, 405])('marks HTTP %s stream unavailability as transient for JSON fallback', async (status) => {
        const onError = vi.fn();
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status,
            text: vi.fn().mockResolvedValue(JSON.stringify({ code: status, message: 'stream unavailable' })),
        });

        const { close } = streamSummaryWorkspaceTurn(
            {
                session_id: 'session-1',
                profile: 'summary_workspace',
                action: 'chat',
                message: '开始总结',
                input_origin: 'user',
                request_id: 'request-1',
                scope_version: 1,
                summary_context: {
                    selected_channels: [],
                    participants: [],
                    template: null,
                    time_range: null,
                    referenced_task_ids: [],
                },
            },
            { onError },
        );
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(onError).toHaveBeenCalledWith({
            code: status,
            message: 'stream unavailable',
            transient: true,
        });
        close();
    });

    it('should call onError when fetch fails', async () => {
        const onProgress = vi.fn();
        const onDone = vi.fn();
        const onError = vi.fn();

        fetchMock.mockRejectedValueOnce(new Error('Network error'));

        const { close } = agentChatStream(
            {
                session_id: 'test-session',
                message: 'test question',
                profile: 'summary',
            },
            {
                onProgress,
                onDone,
                onError,
            },
        );

        // Wait for async processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith({
            code: 50000,
            message: 'Network error',
            transient: true,
        });

        expect(onProgress).not.toHaveBeenCalled();
        expect(onDone).not.toHaveBeenCalled();

        close();
    });

    it('should cleanup reader when close() is called', async () => {
        const mockReader = {
            read: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolves
            cancel: vi.fn(),
            releaseLock: vi.fn(),
        };

        fetchMock.mockResolvedValueOnce({
            ok: true,
            body: {
                getReader: () => mockReader,
            },
        });

        const { close } = agentChatStream(
            {
                session_id: 'test-session',
                message: 'test question',
                profile: 'summary',
            },
            {
                onProgress: vi.fn(),
                onDone: vi.fn(),
                onError: vi.fn(),
            },
        );

        // Wait a bit for fetch to resolve and reader to be assigned
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Call close
        close();

        // Verify cancel was called
        expect(mockReader.cancel).toHaveBeenCalled();
    });

    it('aborts the HTTP request when close() is called before response headers arrive', async () => {
        const onProgress = vi.fn();
        const onDone = vi.fn();
        const onError = vi.fn();
        let requestSignal: AbortSignal | undefined;

        fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
            requestSignal = init.signal as AbortSignal;
            return new Promise((_resolve, reject) => {
                requestSignal?.addEventListener('abort', () => {
                    reject(new DOMException('The operation was aborted', 'AbortError'));
                });
            });
        });

        const { close } = streamSummaryWorkspaceTurn(
            {
                session_id: 'session-before-headers',
                profile: 'summary_workspace',
                action: 'chat',
                message: '开始总结',
                input_origin: 'user',
                request_id: 'request-before-headers',
                scope_version: 1,
                summary_context: {
                    selected_channels: [],
                    participants: [],
                    template: null,
                    time_range: null,
                    referenced_task_ids: [],
                },
            },
            { onProgress, onDone, onError },
        );

        await Promise.resolve();
        expect(requestSignal?.aborted).toBe(false);

        close();
        await Promise.resolve();

        expect(requestSignal?.aborted).toBe(true);
        expect(onProgress).not.toHaveBeenCalled();
        expect(onDone).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
    });
});
