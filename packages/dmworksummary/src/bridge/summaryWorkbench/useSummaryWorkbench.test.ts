// @vitest-environment jsdom

import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SummaryWorkbenchStreamCallbacks } from "../../Service/SummaryWorkbenchService";
import type { CreateAgentSummaryResult } from "../../types/summary";
import { contextItemsFromScope } from "./adapter";
import { canSaveCurrentPreview, type SummaryWorkbenchResponse } from "./model";
import {
  SummaryWorkspaceApiError,
  type SummaryWorkbenchScope,
} from "./protocol";
import useSummaryWorkbench, {
  type SummaryWorkbenchControllerService,
} from "./useSummaryWorkbench";

const initialScope: SummaryWorkbenchScope = {
  selectedChannels: [
    { chatId: "chat-1", chatType: "group", name: "产品研发群" },
  ],
  participants: [],
  template: null,
  timeRange: null,
  referencedTaskIds: [7],
};

const serverScope: SummaryWorkbenchScope = {
  ...initialScope,
  selectedChannels: initialScope.selectedChannels.map((channel) => ({
    ...channel,
  })),
  referencedTaskIds: [...initialScope.referencedTaskIds],
  timeRange: {
    start: "2026-08-20T00:00:00+08:00",
    end: "2026-08-27T23:59:59+08:00",
    label: "最近 7 天",
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function conversationalResponse(
  overrides: Partial<SummaryWorkbenchResponse> = {}
): SummaryWorkbenchResponse {
  return {
    messageId: "10",
    sessionId: "session-1",
    reply: "我先按最近 7 天总结。",
    resultType: "explanation",
    scopeVersion: 2,
    availableActions: ["continue_chat"],
    authoritativeState: {
      scopeVersion: 2,
      scope: serverScope,
      contextItems: contextItemsFromScope(serverScope),
      currentPreview: null,
      pendingProposal: null,
      workflow: null,
    },
    ...overrides,
  } as SummaryWorkbenchResponse;
}

function previewResponse(
  messageId = "18",
  scope: SummaryWorkbenchScope = initialScope,
  scopeVersion = 1
): SummaryWorkbenchResponse {
  const preview = {
    messageId,
    resultType: "agent_preview" as const,
    scopeVersion,
    version: 3,
    snapshotVersion: 1,
    content: "# 风险总结",
    assumptions: [],
    availableActions: ["save_preview", "continue_chat"] as const,
  };
  return {
    messageId,
    sessionId: "session-1",
    reply: "已生成一版预览。",
    resultType: "agent_preview",
    scopeVersion,
    availableActions: ["save_preview", "continue_chat"],
    preview: {
      version: preview.version,
      snapshotVersion: preview.snapshotVersion,
      content: preview.content,
      assumptions: preview.assumptions,
    },
    authoritativeState: {
      scopeVersion,
      scope,
      contextItems: contextItemsFromScope(scope),
      currentPreview: {
        ...preview,
        availableActions: [...preview.availableActions],
      },
      pendingProposal: null,
      workflow: null,
    },
  };
}

function proposalHydration(scope = initialScope) {
  return {
    sessionId: "session-1",
    contractVersion: "1",
    scope,
    modelOptions: {
      scopeVersion: 1,
      contextItems: contextItemsFromScope(scope),
      messages: [
        {
          id: "30",
          role: "assistant" as const,
          content: "请确认邀请。",
          resultType: "workflow_confirmation" as const,
          scopeVersion: 1,
          availableActions: ["confirm_workflow" as const],
        },
      ],
      pendingProposal: {
        messageId: "30",
        resultType: "workflow_confirmation" as const,
        scopeVersion: 1,
        proposalVersion: 2,
        proposalToken: "proposal-token",
        participantNames: ["张三"],
        requirement: "提交风险",
        availableActions: ["confirm_workflow" as const],
      },
    },
  };
}

function previewHydration(scope = initialScope) {
  const response = previewResponse("18", scope);
  if (!response.authoritativeState?.currentPreview) {
    throw new Error("preview fixture is invalid");
  }
  return {
    sessionId: "session-1",
    contractVersion: "1",
    scope,
    modelOptions: {
      scopeVersion: 1,
      contextItems: contextItemsFromScope(scope),
      messages: [
        {
          id: "18",
          role: "assistant" as const,
          content: "已生成一版预览。",
          resultType: "agent_preview" as const,
          scopeVersion: 1,
          availableActions: ["save_preview" as const, "continue_chat" as const],
        },
      ],
      currentPreview: response.authoritativeState.currentPreview,
    },
  };
}

function workflowResponse(
  resultType: "workflow_started" | "workflow_completed",
  taskId = 91
): SummaryWorkbenchResponse {
  const availableActions =
    resultType === "workflow_started"
      ? (["view_progress", "continue_chat"] as const)
      : (["view_summary"] as const);
  const workflow = {
    messageId: "31",
    resultType,
    scopeVersion: 1,
    taskId,
    taskTitle: "多人总结",
    participantCount: 1,
    status: resultType === "workflow_started" ? 2 : 3,
    scope: "team" as const,
    saved: resultType === "workflow_completed",
    availableActions: [...availableActions],
  };
  return {
    messageId: "31",
    sessionId: "session-1",
    reply:
      resultType === "workflow_started"
        ? "协作总结已发起。"
        : "协作总结已完成。",
    resultType,
    scopeVersion: 1,
    availableActions: [...availableActions],
    workflow: {
      taskId,
      taskTitle: workflow.taskTitle,
      participantCount: workflow.participantCount,
      status: workflow.status,
      scope: workflow.scope,
      saved: workflow.saved,
    },
    authoritativeState: {
      scopeVersion: 1,
      scope: initialScope,
      contextItems: contextItemsFromScope(initialScope),
      currentPreview: null,
      pendingProposal: null,
      workflow,
    },
  };
}

function workflowHydration(
  resultType: "workflow_started" | "workflow_completed",
  taskId = 91
) {
  const response = workflowResponse(resultType, taskId);
  if (!response.authoritativeState?.workflow) {
    throw new Error("workflow fixture is invalid");
  }
  return {
    sessionId: "session-1",
    contractVersion: "1",
    scope: initialScope,
    modelOptions: {
      scopeVersion: 1,
      contextItems: contextItemsFromScope(initialScope),
      messages: [
        {
          id: "31",
          role: "assistant" as const,
          content: response.reply,
          resultType,
          scopeVersion: 1,
          availableActions: [...response.availableActions!],
        },
      ],
      workflow: response.authoritativeState.workflow,
    },
  };
}

function workflowErrorHydration() {
  return {
    sessionId: "session-1",
    contractVersion: "1",
    scope: initialScope,
    modelOptions: {
      scopeVersion: 1,
      contextItems: contextItemsFromScope(initialScope),
      messages: [
        {
          id: "31",
          role: "assistant" as const,
          content: "协作总结已发起。",
          resultType: "workflow_started" as const,
          scopeVersion: 1,
          availableActions: ["view_progress" as const],
        },
        {
          id: "32",
          role: "assistant" as const,
          content: "总结任务失败，请调整后重试。",
          resultType: "error" as const,
          scopeVersion: 1,
          availableActions: ["continue_chat" as const],
        },
      ],
      workflow: null,
    },
  };
}

describe("useSummaryWorkbench", () => {
  const sendMessage = vi.fn<SummaryWorkbenchControllerService["sendMessage"]>();
  const streamMessage =
    vi.fn<SummaryWorkbenchControllerService["streamMessage"]>();
  const loadSession = vi.fn<SummaryWorkbenchControllerService["loadSession"]>();
  const confirmWorkflow =
    vi.fn<SummaryWorkbenchControllerService["confirmWorkflow"]>();
  const savePreview = vi.fn<SummaryWorkbenchControllerService["savePreview"]>();
  const closeStream = vi.fn();
  let streamCallbacks: Parameters<
    SummaryWorkbenchControllerService["streamMessage"]
  >[1];

  const service: SummaryWorkbenchControllerService = {
    sendMessage,
    streamMessage,
    loadSession,
    confirmWorkflow,
    savePreview,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    streamMessage.mockImplementation((_input, callbacks) => {
      streamCallbacks = callbacks;
      return { close: closeStream };
    });
  });

  it("sends the complete scope once and adopts server-authoritative state", async () => {
    const { result, unmount } = renderHook(() =>
      useSummaryWorkbench({
        initialSessionId: "session-1",
        initialScope,
        autoHydrate: false,
        service,
        createRequestId: () => "request-1",
      })
    );

    act(() => result.current.setComposerValue("总结关键风险"));
    let first!: Promise<SummaryWorkbenchResponse | undefined>;
    let second!: Promise<SummaryWorkbenchResponse | undefined>;
    act(() => {
      first = result.current.send();
      second = result.current.send();
    });

    expect(first).toBe(second);
    expect(streamMessage).toHaveBeenCalledTimes(1);
    expect(streamMessage).toHaveBeenCalledWith(
      {
        sessionId: "session-1",
        message: "总结关键风险",
        inputOrigin: "user",
        requestId: "request-1",
        scopeVersion: 1,
        scope: initialScope,
      },
      expect.any(Object)
    );
    expect(result.current.model.messages).toEqual([
      expect.objectContaining({
        id: "local-user:request-1",
        role: "user",
        content: "总结关键风险",
      }),
    ]);
    expect(result.current.model.composer.isSending).toBe(true);

    act(() => {
      streamCallbacks.onProgress?.({
        phase: "retrieve",
        step: 2,
        ofSteps: 4,
        elapsed_ms: 120,
        count: 30,
      });
      streamCallbacks.onDone?.(conversationalResponse());
    });
    await expect(first).resolves.toMatchObject({
      resultType: "explanation",
    });

    expect(result.current.scope).toEqual(serverScope);
    expect(result.current.model.scopeVersion).toBe(2);
    expect(result.current.model.contextItems).toContainEqual({
      id: "7",
      kind: "reference",
      label: "#7",
    });
    expect(result.current.model.messages).toHaveLength(2);
    expect(result.current.latestProgress).toMatchObject({
      phase: "retrieve",
      count: 30,
    });
    expect(closeStream).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("falls back to JSON with the same request id after a transient stream error", async () => {
    sendMessage.mockResolvedValue(conversationalResponse());
    const { result, unmount } = renderHook(() =>
      useSummaryWorkbench({
        initialSessionId: "session-1",
        initialScope,
        autoHydrate: false,
        service,
        createRequestId: () => "request-fallback",
      })
    );

    let request!: Promise<SummaryWorkbenchResponse | undefined>;
    act(() => {
      request = result.current.send("按模板直接生成");
      streamCallbacks.onError?.(
        new SummaryWorkspaceApiError({
          message: "stream disconnected",
          kind: "transport",
          retryable: true,
        })
      );
      // Once fallback starts, late frames from the abandoned stream cannot
      // win the race against the request with the same request_id.
      streamCallbacks.onDone?.(previewResponse("99"));
    });
    await expect(request).resolves.toMatchObject({
      resultType: "explanation",
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(streamMessage.mock.calls[0]?.[0].requestId).toBe("request-fallback");
    expect(sendMessage.mock.calls[0]?.[0].requestId).toBe("request-fallback");
    expect(result.current.model.currentPreview).toBeNull();
    expect(
      result.current.model.messages.filter((message) => message.role === "user")
    ).toHaveLength(1);
    unmount();
  });

  it("reuses the request id for an unchanged manual retry and clears it after success", async () => {
    const successfulReply = (messageId: string): SummaryWorkbenchResponse => ({
      messageId,
      sessionId: "session-1",
      reply: "已完成。",
      resultType: "explanation",
      scopeVersion: 1,
      availableActions: ["continue_chat"],
    });
    sendMessage
      .mockRejectedValueOnce(
        new SummaryWorkspaceApiError({
          message: "gateway timeout",
          kind: "transport",
          retryable: true,
        })
      )
      .mockResolvedValueOnce(successfulReply("10"))
      .mockResolvedValueOnce(successfulReply("11"));
    const requestIds = ["request-first", "request-after-success"];
    const createRequestId = vi.fn(
      () => requestIds.shift() ?? "request-unexpected"
    );
    const { result, unmount } = renderHook(() =>
      useSummaryWorkbench({
        initialSessionId: "session-1",
        initialScope,
        autoHydrate: false,
        preferStreaming: false,
        service,
        createRequestId,
      })
    );

    act(() => result.current.setComposerValue("总结关键风险"));
    await act(async () => {
      await result.current.send();
    });
    expect(result.current.model.composer.value).toBe("总结关键风险");

    await act(async () => {
      await result.current.send();
    });
    expect(
      sendMessage.mock.calls.slice(0, 2).map(([input]) => input.requestId)
    ).toEqual(["request-first", "request-first"]);
    expect(
      result.current.model.messages.filter(
        (message) => message.id === "local-user:request-first"
      )
    ).toHaveLength(1);

    await act(async () => {
      await result.current.send("总结关键风险");
    });
    expect(sendMessage.mock.calls[2]?.[0].requestId).toBe(
      "request-after-success"
    );
    expect(createRequestId).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("keeps the request id while a template submission temporarily clears and restores the composer", async () => {
    sendMessage
      .mockRejectedValueOnce(
        new SummaryWorkspaceApiError({
          message: "gateway timeout",
          kind: "transport",
          retryable: true,
        })
      )
      .mockResolvedValueOnce(conversationalResponse());
    const createRequestId = vi.fn(() => "request-template");
    const { result, unmount } = renderHook(() =>
      useSummaryWorkbench({
        initialSessionId: "session-1",
        initialScope,
        autoHydrate: false,
        preferStreaming: false,
        service,
        createRequestId,
      })
    );

    await act(async () => {
      const first = result.current.send("personal-intent", "system_intent");
      result.current.restoreComposerValue("");
      await first;
      result.current.restoreComposerValue("template requirement");
      await result.current.send("personal-intent", "system_intent");
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls.map(([input]) => input.requestId)).toEqual([
      "request-template",
      "request-template",
    ]);
    expect(createRequestId).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("does not retain the request id after a business or 4xx failure", async () => {
    sendMessage.mockRejectedValue(
      new SummaryWorkspaceApiError({
        message: "需求不合法",
        kind: "business",
        httpStatus: 400,
        retryable: false,
      })
    );
    const requestIds = ["request-business-1", "request-business-2"];
    const createRequestId = vi.fn(
      () => requestIds.shift() ?? "request-unexpected"
    );
    const { result, unmount } = renderHook(() =>
      useSummaryWorkbench({
        initialSessionId: "session-1",
        initialScope,
        autoHydrate: false,
        preferStreaming: false,
        service,
        createRequestId,
      })
    );

    act(() => result.current.setComposerValue("总结关键风险"));
    await act(async () => {
      await result.current.send();
    });
    await act(async () => {
      await result.current.send();
    });

    expect(sendMessage.mock.calls.map(([input]) => input.requestId)).toEqual([
      "request-business-1",
      "request-business-2",
    ]);
    expect(createRequestId).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("uses a new request id when the same text changes input origin", async () => {
    sendMessage.mockRejectedValue(
      new SummaryWorkspaceApiError({
        message: "gateway timeout",
        kind: "transport",
        retryable: true,
      })
    );
    const requestIds = ["request-template", "request-user"];
    const createRequestId = vi.fn(
      () => requestIds.shift() ?? "request-unexpected"
    );
    const { result, unmount } = renderHook(() =>
      useSummaryWorkbench({
        initialSessionId: "session-1",
        initialScope,
        autoHydrate: false,
        preferStreaming: false,
        service,
        createRequestId,
      })
    );

    await act(async () => {
      await result.current.send("总结关键风险", "template");
      await result.current.send("总结关键风险", "user");
    });

    expect(
      sendMessage.mock.calls.map(([input]) => ({
        requestId: input.requestId,
        inputOrigin: input.inputOrigin,
      }))
    ).toEqual([
      { requestId: "request-template", inputOrigin: "template" },
      { requestId: "request-user", inputOrigin: "user" },
    ]);
    unmount();
  });

  it("clears a failed-turn request id after input, scope, or session changes", async () => {
    sendMessage.mockRejectedValue(
      new SummaryWorkspaceApiError({
        message: "gateway timeout",
        kind: "transport",
        retryable: true,
      })
    );
    const requestIds = ["request-1", "request-2", "request-3", "request-4"];
    const createRequestId = vi.fn(
      () => requestIds.shift() ?? "request-unexpected"
    );
    const { result, unmount } = renderHook(() =>
      useSummaryWorkbench({
        initialSessionId: "session-1",
        initialScope,
        autoHydrate: false,
        preferStreaming: false,
        service,
        createRequestId,
      })
    );

    act(() => result.current.setComposerValue("总结关键风险"));
    await act(async () => {
      await result.current.send();
    });

    act(() => {
      result.current.setComposerValue("总结关键风险（修改）");
      result.current.setComposerValue("总结关键风险");
    });
    await act(async () => {
      await result.current.send();
    });

    act(() => {
      result.current.updateScope((current) => ({
        ...current,
        participants: [{ userId: "u1", userName: "张三" }],
      }));
      result.current.updateScope(initialScope);
    });
    await act(async () => {
      await result.current.send();
    });

    act(() => {
      result.current.resetSession({
        sessionId: "session-2",
        scope: initialScope,
      });
    });
    await act(async () => {
      await result.current.send("总结关键风险");
    });

    expect(sendMessage.mock.calls.map(([input]) => input.requestId)).toEqual([
      "request-1",
      "request-2",
      "request-3",
      "request-4",
    ]);
    expect(createRequestId).toHaveBeenCalledTimes(4);
    unmount();
  });

  it("does not replay a business stream error through JSON", async () => {
    const { result, unmount } = renderHook(() =>
      useSummaryWorkbench({
        initialSessionId: "session-1",
        initialScope,
        autoHydrate: false,
        service,
        createRequestId: () => "request-business-error",
      })
    );
    act(() => result.current.setComposerValue("总结风险"));

    let request!: Promise<SummaryWorkbenchResponse | undefined>;
    act(() => {
      request = result.current.send();
      streamCallbacks.onError?.(
        new SummaryWorkspaceApiError({
          message: "需求不合法",
          kind: "business",
          retryable: false,
        })
      );
    });
    await expect(request).resolves.toBeUndefined();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(result.current.error).toMatchObject({ kind: "business" });
    expect(result.current.model.composer).toMatchObject({
      value: "总结风险",
      isSending: false,
      errorMessage: "需求不合法",
    });
    unmount();
  });

  it("hydrates messages, scope, and the current artifact from History", async () => {
    loadSession.mockResolvedValue(previewHydration(serverScope));
    const onSessionIdChange = vi.fn();
    const { result, unmount } = renderHook(() =>
      useSummaryWorkbench({
        initialSessionId: "persisted-session",
        initialScope,
        service,
        onSessionIdChange,
      })
    );

    await waitFor(() => expect(result.current.isHydrating).toBe(false));
    await waitFor(() => expect(result.current.model.messages).toHaveLength(1));

    expect(loadSession).toHaveBeenCalledWith(
      "persisted-session",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(result.current.sessionId).toBe("session-1");
    expect(result.current.scope).toEqual(serverScope);
    expect(canSaveCurrentPreview(result.current.model)).toBe(true);
    expect(onSessionIdChange).toHaveBeenCalledWith("session-1");
    unmount();
  });

  it("restarts automatic History hydration after the StrictMode effect cleanup", async () => {
    const firstHydration = deferred<ReturnType<typeof previewHydration>>();
    let firstSignal: AbortSignal | undefined;
    loadSession
      .mockImplementationOnce((_sessionId, options) => {
        firstSignal = options?.signal;
        firstSignal?.addEventListener(
          "abort",
          () =>
            firstHydration.reject(
              new DOMException("StrictMode cleanup", "AbortError")
            ),
          { once: true }
        );
        return firstHydration.promise;
      })
      .mockResolvedValueOnce(previewHydration(serverScope));

    const { result, unmount } = renderHook(
      () =>
        useSummaryWorkbench({
          initialSessionId: "persisted-session",
          initialScope,
          service,
        }),
      { wrapper: React.StrictMode }
    );

    await waitFor(() => expect(loadSession).toHaveBeenCalledTimes(2));
    expect(firstSignal?.aborted).toBe(true);
    await waitFor(() => expect(result.current.isHydrating).toBe(false));
    expect(result.current.sessionId).toBe("session-1");
    expect(result.current.scope).toEqual(serverScope);
    expect(canSaveCurrentPreview(result.current.model)).toBe(true);
    unmount();
  });

  it("cancels an in-flight turn and makes the previous preview stale on scope change", async () => {
    loadSession.mockResolvedValue(previewHydration());
    const { result, unmount } = renderHook(() =>
      useSummaryWorkbench({
        initialSessionId: "session-1",
        initialScope,
        autoHydrate: false,
        service,
        createRequestId: () => "request-cancelled",
      })
    );
    await act(async () => {
      await result.current.hydrateSession();
    });

    let request!: Promise<SummaryWorkbenchResponse | undefined>;
    act(() => {
      result.current.setComposerValue("重新组织一下");
      request = result.current.send();
    });
    act(() => {
      result.current.updateScope((scope) => ({
        ...scope,
        participants: [{ userId: "u1", userName: "张三" }],
      }));
    });

    await expect(request).resolves.toBeUndefined();
    expect(closeStream).toHaveBeenCalled();
    expect(result.current.model.scopeVersion).toBe(2);
    expect(canSaveCurrentPreview(result.current.model)).toBe(false);
    expect(result.current.viewState.card).toMatchObject({
      kind: "agent_preview",
      isStale: true,
      actions: ["continue_chat"],
    });

    act(() => streamCallbacks.onDone?.(conversationalResponse()));
    expect(result.current.model.messages).toHaveLength(2);
    unmount();
  });

  it("does not invalidate artifacts when unordered scope collections are only reordered", async () => {
    const orderedScope: SummaryWorkbenchScope = {
      ...initialScope,
      selectedChannels: [
        { chatId: "chat-1", chatType: "group", name: "产品研发群" },
        { chatId: "chat-2", chatType: "group", name: "项目讨论群" },
      ],
      participants: [
        { userId: "u1", userName: "张三" },
        { userId: "u2", userName: "李四" },
      ],
      referencedTaskIds: [7, 8],
    };
    const { result, unmount } = renderHook(() =>
      useSummaryWorkbench({
        initialSessionId: "session-1",
        initialScope: orderedScope,
        autoHydrate: false,
        service,
      })
    );

    let changed = true;
    act(() => {
      changed = result.current.updateScope({
        ...orderedScope,
        selectedChannels: [...orderedScope.selectedChannels].reverse(),
        participants: [...orderedScope.participants].reverse(),
        referencedTaskIds: [...orderedScope.referencedTaskIds].reverse(),
      });
    });

    expect(changed).toBe(false);
    expect(result.current.model.scopeVersion).toBe(1);
    unmount();
  });

  it("confirms a proposal once with a stable idempotency key and full scope", async () => {
    loadSession.mockResolvedValue(proposalHydration(serverScope));
    let resolveConfirmation!: (value: SummaryWorkbenchResponse) => void;
    confirmWorkflow.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveConfirmation = resolve;
        })
    );
    const completedScope = {
      ...serverScope,
      participants: [{ userId: "u1", userName: "张三" }],
    };
    const workflowResponse: SummaryWorkbenchResponse = {
      messageId: "31",
      sessionId: "session-1",
      reply: "协作总结已发起。",
      resultType: "workflow_started",
      scopeVersion: 1,
      availableActions: ["view_progress"],
      workflow: {
        taskId: 91,
        taskTitle: "多人总结",
        participantCount: 1,
        status: 2,
        scope: "team",
        saved: false,
      },
      authoritativeState: {
        scopeVersion: 1,
        scope: completedScope,
        contextItems: contextItemsFromScope(completedScope),
        currentPreview: null,
        pendingProposal: null,
        workflow: {
          messageId: "31",
          resultType: "workflow_started",
          scopeVersion: 1,
          taskId: 91,
          taskTitle: "多人总结",
          participantCount: 1,
          status: 2,
          scope: "team",
          saved: false,
          availableActions: ["view_progress"],
        },
      },
    };
    const createIdempotencyKey = vi.fn(() => "confirm-key");
    const { result, unmount } = renderHook(() =>
      useSummaryWorkbench({
        initialSessionId: "session-1",
        initialScope,
        autoHydrate: false,
        service,
        createIdempotencyKey,
      })
    );
    await act(async () => {
      await result.current.hydrateSession();
    });

    let first!: Promise<SummaryWorkbenchResponse | undefined>;
    let second!: Promise<SummaryWorkbenchResponse | undefined>;
    act(() => {
      first = result.current.confirmWorkflow();
      second = result.current.confirmWorkflow();
    });
    expect(first).toBe(second);
    expect(confirmWorkflow).toHaveBeenCalledTimes(1);
    expect(confirmWorkflow.mock.calls[0]?.[0]).toMatchObject({
      sessionId: "session-1",
      proposalVersion: 2,
      proposalToken: "proposal-token",
      scope: serverScope,
      idempotencyKey: "confirm-key",
    });

    await act(async () => {
      resolveConfirmation(workflowResponse);
      await first;
    });
    expect(result.current.model.pendingProposal).toBeNull();
    expect(result.current.model.workflow?.taskId).toBe(91);
    expect(createIdempotencyKey).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("polls authoritative History until a started workflow is completed", async () => {
    vi.useFakeTimers();
    try {
      loadSession
        .mockResolvedValueOnce(workflowHydration("workflow_started"))
        .mockResolvedValueOnce(workflowHydration("workflow_completed"));
      const { result, unmount } = renderHook(() =>
        useSummaryWorkbench({
          initialSessionId: "session-1",
          initialScope,
          autoHydrate: false,
          service,
          createRequestId: () => "request-workflow",
          workflowPollIntervalMs: 10,
        })
      );

      let request!: Promise<SummaryWorkbenchResponse | undefined>;
      act(() => {
        request = result.current.send("发起多人总结");
        streamCallbacks.onDone?.(workflowResponse("workflow_started"));
      });
      await act(async () => {
        await request;
      });
      expect(result.current.model.workflow?.resultType).toBe(
        "workflow_started"
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(loadSession).toHaveBeenCalledTimes(1);
      expect(result.current.model.workflow?.resultType).toBe(
        "workflow_started"
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(loadSession).toHaveBeenCalledTimes(2);
      expect(result.current.model.workflow).toMatchObject({
        taskId: 91,
        resultType: "workflow_completed",
        saved: true,
        availableActions: ["view_summary"],
      });

      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps polling the same workflow after scope edits without replacing the new scope", async () => {
    vi.useFakeTimers();
    try {
      loadSession.mockResolvedValueOnce(
        workflowHydration("workflow_completed")
      );
      const { result, unmount } = renderHook(() =>
        useSummaryWorkbench({
          initialSessionId: "session-1",
          initialScope,
          autoHydrate: false,
          service,
          createRequestId: () => "request-workflow",
          workflowPollIntervalMs: 10,
        })
      );

      await act(async () => {
        const request = result.current.send("发起多人总结");
        streamCallbacks.onDone?.(workflowResponse("workflow_started"));
        await request;
      });
      const editedScope = {
        ...result.current.scope,
        timeRange: {
          start: "2026-08-01T00:00:00Z",
          end: "2026-08-31T23:59:59Z",
          label: "八月",
        },
      };
      act(() => {
        result.current.updateScope(editedScope);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });

      expect(loadSession).toHaveBeenCalledTimes(1);
      expect(result.current.scope).toEqual(editedScope);
      expect(result.current.model.workflow).toMatchObject({
        taskId: 91,
        resultType: "workflow_completed",
      });
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies a terminal workflow error from History and stops polling", async () => {
    vi.useFakeTimers();
    try {
      loadSession.mockResolvedValue(workflowErrorHydration());
      const { result, unmount } = renderHook(() =>
        useSummaryWorkbench({
          initialSessionId: "session-1",
          initialScope,
          autoHydrate: false,
          service,
          createRequestId: () => "request-workflow",
          workflowPollIntervalMs: 10,
        })
      );

      let request!: Promise<SummaryWorkbenchResponse | undefined>;
      act(() => {
        request = result.current.send("发起多人总结");
        streamCallbacks.onDone?.(workflowResponse("workflow_started"));
      });
      await act(async () => {
        await request;
        await vi.advanceTimersByTimeAsync(10);
      });

      expect(loadSession).toHaveBeenCalledTimes(1);
      expect(result.current.model.workflow).toBeNull();
      expect(
        result.current.model.messages[result.current.model.messages.length - 1]
      ).toMatchObject({
        id: "32",
        resultType: "error",
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(loadSession).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling and preserves scope when the workflow session has expired", async () => {
    vi.useFakeTimers();
    try {
      loadSession.mockResolvedValueOnce({
        sessionId: "session-1",
        contractVersion: "1",
        scope: {
          selectedChannels: [],
          participants: [],
          template: null,
          timeRange: null,
          referencedTaskIds: [],
        },
        modelOptions: {
          scopeVersion: 1,
          contextItems: [],
          messages: [],
          currentPreview: null,
          pendingProposal: null,
          workflow: null,
        },
        empty: true,
      });
      const onSessionIdChange = vi.fn();
      const { result, unmount } = renderHook(() =>
        useSummaryWorkbench({
          initialSessionId: "session-1",
          initialScope,
          autoHydrate: false,
          service,
          createSessionId: () => "fresh-after-expiry",
          createRequestId: () => "request-workflow",
          onSessionIdChange,
          workflowPollIntervalMs: 10,
        })
      );

      let request!: Promise<SummaryWorkbenchResponse | undefined>;
      act(() => {
        request = result.current.send("发起多人总结");
        streamCallbacks.onDone?.(workflowResponse("workflow_started"));
      });
      await act(async () => {
        await request;
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });

      expect(loadSession).toHaveBeenCalledTimes(1);
      expect(result.current.sessionId).toBe("fresh-after-expiry");
      expect(result.current.scope).toEqual(initialScope);
      expect(result.current.model.workflow).toBeNull();
      expect(result.current.error?.message).toContain("会话已过期");
      expect(onSessionIdChange).toHaveBeenCalledWith("");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(loadSession).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues the same session after a completed workflow without duplicating or dropping its card", async () => {
    const requestIds = ["request-workflow", "request-follow-up"];
    const { result, unmount } = renderHook(() =>
      useSummaryWorkbench({
        initialSessionId: "session-1",
        initialScope,
        autoHydrate: false,
        service,
        createRequestId: () => requestIds.shift() ?? "request-unexpected",
      })
    );

    let workflowRequest!: Promise<SummaryWorkbenchResponse | undefined>;
    act(() => {
      workflowRequest = result.current.send("直接生成总结");
      streamCallbacks.onDone?.(workflowResponse("workflow_completed"));
    });
    await act(async () => {
      await workflowRequest;
    });

    expect(result.current.viewState.card).toMatchObject({
      kind: "workflow_completed",
      taskId: 91,
    });

    act(() => result.current.setComposerValue("再补充风险和后续动作"));
    let followUpRequest!: Promise<SummaryWorkbenchResponse | undefined>;
    act(() => {
      followUpRequest = result.current.send();
    });

    expect(streamMessage).toHaveBeenCalledTimes(2);
    expect(streamMessage.mock.calls[1]?.[0]).toMatchObject({
      sessionId: "session-1",
      requestId: "request-follow-up",
      message: "再补充风险和后续动作",
    });
    expect(result.current.viewState.card).toMatchObject({
      kind: "workflow_completed",
      taskId: 91,
    });

    const completed = workflowResponse("workflow_completed");
    act(() => {
      streamCallbacks.onDone?.({
        messageId: "32",
        sessionId: "session-1",
        reply: "可以继续补充，原总结仍已保存。",
        resultType: "explanation",
        scopeVersion: 1,
        availableActions: ["continue_chat"],
        authoritativeState: completed.authoritativeState,
      });
    });
    await act(async () => {
      await followUpRequest;
    });

    expect(result.current.sessionId).toBe("session-1");
    expect(result.current.viewState.card).toMatchObject({
      kind: "workflow_completed",
      taskId: 91,
    });
    expect(
      result.current.model.messages.filter((message) => message.id === "31")
    ).toHaveLength(1);
    expect(
      result.current.model.messages.filter((message) =>
        message.id.startsWith("local-user:")
      )
    ).toHaveLength(2);
    unmount();
  });

  it("does not let an older workflow poll overwrite a newer Agent turn", async () => {
    vi.useFakeTimers();
    try {
      const stalePoll = deferred<ReturnType<typeof workflowHydration>>();
      loadSession.mockImplementationOnce(() => stalePoll.promise);
      const requestIds = ["request-workflow", "request-follow-up"];
      const callbacks: SummaryWorkbenchStreamCallbacks[] = [];
      streamMessage.mockImplementation((_input, nextCallbacks) => {
        callbacks.push(nextCallbacks);
        return { close: closeStream };
      });
      const { result, unmount } = renderHook(() =>
        useSummaryWorkbench({
          initialSessionId: "session-1",
          initialScope,
          autoHydrate: false,
          service,
          createRequestId: () => requestIds.shift() ?? "request-extra",
          workflowPollIntervalMs: 10,
        })
      );

      let workflowRequest!: Promise<SummaryWorkbenchResponse | undefined>;
      act(() => {
        workflowRequest = result.current.send("发起多人总结");
        callbacks[0].onDone?.(workflowResponse("workflow_started"));
      });
      await act(async () => {
        await workflowRequest;
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(loadSession).toHaveBeenCalledTimes(1);

      act(() => result.current.setComposerValue("先解释一下执行范围"));
      let followUpRequest!: Promise<SummaryWorkbenchResponse | undefined>;
      act(() => {
        followUpRequest = result.current.send();
        callbacks[1].onDone?.({
          messageId: "32",
          sessionId: "session-1",
          reply: "会基于当前会话范围执行。",
          resultType: "explanation",
          scopeVersion: 1,
          availableActions: ["continue_chat"],
        });
      });
      await act(async () => {
        await followUpRequest;
      });

      await act(async () => {
        stalePoll.resolve(workflowHydration("workflow_completed"));
        await Promise.resolve();
      });

      expect(result.current.model.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "local-user:request-follow-up",
            content: "先解释一下执行范围",
          }),
          expect.objectContaining({ id: "32", resultType: "explanation" }),
        ])
      );
      expect(result.current.model.workflow?.resultType).toBe(
        "workflow_started"
      );
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves only a current preview once and disables saving after success", async () => {
    loadSession.mockResolvedValue(previewHydration());
    let resolveSave!: (value: CreateAgentSummaryResult) => void;
    savePreview.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        })
    );
    const createIdempotencyKey = vi.fn(() => "save-key");
    const { result, unmount } = renderHook(() =>
      useSummaryWorkbench({
        initialSessionId: "session-1",
        initialScope,
        autoHydrate: false,
        service,
        createIdempotencyKey,
      })
    );
    await act(async () => {
      await result.current.hydrateSession();
    });

    let first!: Promise<CreateAgentSummaryResult | undefined>;
    let second!: Promise<CreateAgentSummaryResult | undefined>;
    act(() => {
      first = result.current.savePreview("风险总结");
      second = result.current.savePreview("风险总结");
    });
    expect(first).toBe(second);
    expect(savePreview).toHaveBeenCalledTimes(1);
    expect(savePreview.mock.calls[0]?.[0]).toMatchObject({
      messageId: "18",
      snapshotVersion: 1,
      artifactVersion: 3,
      scopeVersion: 1,
      title: "风险总结",
      idempotencyKey: "save-key",
    });

    await act(async () => {
      resolveSave({
        task_id: 92,
        task_no: "SUM-92",
        status: 3,
        created_at: "2026-08-27T08:00:00Z",
        finish_status: "FAILED",
        gaps: [{ kind: "citation", detail: "引用完整性校验失败" }],
      });
      await first;
    });
    expect(result.current.savedSummary).toMatchObject({
      task_id: 92,
      finish_status: "FAILED",
      gaps: [{ kind: "citation", detail: "引用完整性校验失败" }],
    });
    expect(canSaveCurrentPreview(result.current.model)).toBe(false);
    await expect(
      result.current.savePreview("风险总结")
    ).resolves.toBeUndefined();
    expect(savePreview).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("reuses the same save idempotency key after a recoverable retry", async () => {
    loadSession.mockResolvedValue(previewHydration());
    savePreview
      .mockRejectedValueOnce(
        new SummaryWorkspaceApiError({
          message: "gateway timeout",
          kind: "transport",
          retryable: true,
        })
      )
      .mockResolvedValueOnce({
        task_id: 93,
        task_no: "SUM-93",
        status: 3,
        created_at: "2026-08-27T08:01:00Z",
      });
    const createIdempotencyKey = vi.fn(() => "stable-save-key");
    const { result, unmount } = renderHook(() =>
      useSummaryWorkbench({
        initialSessionId: "session-1",
        initialScope,
        autoHydrate: false,
        service,
        createIdempotencyKey,
      })
    );
    await act(async () => {
      await result.current.hydrateSession();
    });

    await act(async () => {
      await result.current.savePreview("风险总结");
    });
    await act(async () => {
      await result.current.savePreview("风险总结");
    });

    expect(savePreview).toHaveBeenCalledTimes(2);
    expect(
      savePreview.mock.calls.map(([input]) => input.idempotencyKey)
    ).toEqual(["stable-save-key", "stable-save-key"]);
    expect(createIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(result.current.savedSummary?.task_id).toBe(93);
    unmount();
  });

  it("resets the session, preserves initial scope, and ignores late stream data", async () => {
    const onSessionIdChange = vi.fn();
    const { result, unmount } = renderHook(() =>
      useSummaryWorkbench({
        initialSessionId: "session-1",
        initialScope,
        autoHydrate: false,
        service,
        createSessionId: () => "session-2",
        createRequestId: () => "request-late",
        onSessionIdChange,
      })
    );

    let request!: Promise<SummaryWorkbenchResponse | undefined>;
    act(() => {
      request = result.current.send("先生成一版");
      result.current.resetSession();
    });
    await expect(request).resolves.toBeUndefined();
    expect(result.current.sessionId).toBe("session-2");
    expect(result.current.scope).toEqual(initialScope);
    expect(result.current.model.messages).toEqual([]);
    expect(onSessionIdChange).not.toHaveBeenCalled();

    act(() => streamCallbacks.onDone?.(previewResponse()));
    expect(result.current.model.messages).toEqual([]);
    unmount();
  });

  it("does not persist an empty History session before the first server turn", async () => {
    loadSession.mockResolvedValueOnce({
      sessionId: "client-only-session",
      contractVersion: "1",
      scope: initialScope,
      modelOptions: { messages: [] },
      empty: true,
    });
    const onSessionIdChange = vi.fn();
    const { result, unmount } = renderHook(() =>
      useSummaryWorkbench({
        initialSessionId: "client-only-session",
        initialScope,
        autoHydrate: false,
        service,
        createSessionId: () => "fresh-client-session",
        onSessionIdChange,
      })
    );

    await act(async () => {
      await result.current.hydrateSession();
    });

    expect(result.current.sessionId).toBe("fresh-client-session");
    expect(result.current.scope).toEqual(initialScope);
    expect(result.current.model.messages).toEqual([]);
    expect(onSessionIdChange).toHaveBeenCalledWith("");
    unmount();
  });
});
