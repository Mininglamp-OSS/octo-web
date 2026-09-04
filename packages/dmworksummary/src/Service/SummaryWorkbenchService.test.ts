import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SummaryWorkbenchService,
  type SummaryWorkbenchTransport,
} from "./SummaryWorkbenchService";
import {
  SummaryWorkspaceApiError,
  type SummaryWorkbenchScope,
  type SummaryWorkspaceStreamHandlers,
} from "../bridge/summaryWorkbench/protocol";

const scope: SummaryWorkbenchScope = {
  selectedChannels: [
    { chatId: "chat-1", chatType: "group", name: "产品研发群" },
  ],
  participants: [],
  template: null,
  timeRange: null,
  referencedTaskIds: [],
};

function state(scopeVersion = 1) {
  return {
    scope_version: scopeVersion,
    summary_context: {
      selected_channels: [
        { chat_id: "chat-1", chat_type: "group", name: "产品研发群" },
      ],
      participants: [],
      template: null,
      time_range: null,
      referenced_task_ids: [],
    },
    current_preview: null,
    pending_proposal: null,
    workflow: null,
  };
}

function clarificationTurn() {
  return {
    contract_version: "1",
    session_id: "session-1",
    message_id: 10,
    result_type: "clarification",
    reply: "希望重点关注什么？",
    scope_version: 1,
    available_actions: ["continue_chat"],
    state: state(),
  };
}

describe("SummaryWorkbenchService", () => {
  const getCapabilities = vi.fn<SummaryWorkbenchTransport["getCapabilities"]>();
  const getSummaryDetail =
    vi.fn<SummaryWorkbenchTransport["getSummaryDetail"]>();
  const postTurn = vi.fn<SummaryWorkbenchTransport["postTurn"]>();
  const streamTurn = vi.fn<SummaryWorkbenchTransport["streamTurn"]>();
  const getHistory = vi.fn<SummaryWorkbenchTransport["getHistory"]>();
  const confirmProposal = vi.fn<SummaryWorkbenchTransport["confirmProposal"]>();
  const savePreview = vi.fn<SummaryWorkbenchTransport["savePreview"]>();
  const transport: SummaryWorkbenchTransport = {
    getCapabilities,
    getSummaryDetail,
    postTurn,
    streamTurn,
    getHistory,
    confirmProposal,
    savePreview,
  };
  const service = new SummaryWorkbenchService(transport);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds the summary_workspace chat request and adapts its result", async () => {
    postTurn.mockResolvedValue(clarificationTurn());

    await expect(
      service.sendMessage({
        sessionId: "session-1",
        message: "帮我总结风险",
        inputOrigin: "user",
        requestId: "request-1",
        scopeVersion: 1,
        scope,
      })
    ).resolves.toMatchObject({
      messageId: "10",
      resultType: "clarification",
      availableActions: ["continue_chat"],
    });

    expect(postTurn).toHaveBeenCalledWith(
      {
        session_id: "session-1",
        profile: "summary_workspace",
        action: "chat",
        message: "帮我总结风险",
        input_origin: "user",
        request_id: "request-1",
        scope_version: 1,
        summary_context: {
          selected_channels: [
            {
              chat_id: "chat-1",
              chat_type: "group",
              name: "产品研发群",
            },
          ],
          participants: [],
          template: null,
          time_range: null,
          referenced_task_ids: [],
        },
      },
      {}
    );
  });

  it("decodes SSE done with the same adapter as JSON", () => {
    streamTurn.mockReturnValue({ close: vi.fn() });
    const onDone = vi.fn();
    const onError = vi.fn();

    service.streamMessage(
      {
        sessionId: "session-1",
        message: "帮我总结风险",
        requestId: "request-1",
        scopeVersion: 1,
        scope,
      },
      { onDone, onError }
    );
    const handlers: SummaryWorkspaceStreamHandlers | undefined =
      streamTurn.mock.calls[streamTurn.mock.calls.length - 1]?.[1];
    handlers?.onDone?.(clarificationTurn());

    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({
        resultType: "clarification",
        messageId: "10",
      })
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("turns an invalid SSE done payload into a non-retryable protocol error", () => {
    const invalidStream = vi.fn<SummaryWorkbenchTransport["streamTurn"]>();
    invalidStream.mockReturnValue({ close: vi.fn() });
    const invalidStreamService = new SummaryWorkbenchService({
      ...transport,
      streamTurn: invalidStream,
    });
    const onError = vi.fn();

    invalidStreamService.streamMessage(
      {
        sessionId: "session-1",
        message: "帮我总结风险",
        requestId: "request-1",
        scopeVersion: 1,
        scope,
      },
      { onError }
    );
    const handlers: SummaryWorkspaceStreamHandlers | undefined =
      invalidStream.mock.calls[invalidStream.mock.calls.length - 1]?.[1];
    expect(invalidStream).toHaveBeenCalledTimes(1);
    expect(handlers?.onDone).toBeTypeOf("function");
    handlers?.onDone?.({ reply: "legacy response" });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "protocol", retryable: false })
    );
  });

  it("turns an invalid SSE error payload into a protocol error", () => {
    streamTurn.mockReturnValue({ close: vi.fn() });
    const onError = vi.fn();

    service.streamMessage(
      {
        sessionId: "session-1",
        message: "帮我总结风险",
        requestId: "request-1",
        scopeVersion: 1,
        scope,
      },
      { onError }
    );
    const handlers: SummaryWorkspaceStreamHandlers | undefined =
      streamTurn.mock.calls[streamTurn.mock.calls.length - 1]?.[1];
    handlers?.onError?.({ code: 50001 });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "protocol", retryable: false })
    );
  });

  it("confirms a server proposal through the deterministic endpoint", async () => {
    confirmProposal.mockResolvedValue({
      contract_version: "1",
      session_id: "session-1",
      message_id: 22,
      result_type: "workflow_started",
      reply: "协作总结已发起。",
      scope_version: 1,
      available_actions: ["view_progress"],
      state: {
        ...state(),
        workflow: {
          message_id: 22,
          result_type: "workflow_started",
          scope_version: 1,
          task_id: 88,
          task_title: "多人总结",
          status: 2,
          scope: "team",
          saved: false,
          participant_count: 2,
          available_actions: ["view_progress"],
        },
      },
    });

    await expect(
      service.confirmWorkflow({
        sessionId: "session-1",
        proposalVersion: 3,
        proposalToken: "proposal-token",
        scopeVersion: 1,
        scope,
        idempotencyKey: "confirm-key",
      })
    ).resolves.toMatchObject({
      resultType: "workflow_started",
      workflow: { taskId: 88, scope: "team" },
    });

    expect(confirmProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: "session-1",
        proposal_version: 3,
        proposal_token: "proposal-token",
      }),
      { idempotencyKey: "confirm-key" }
    );
  });

  it("saves only a trusted preview reference with an idempotency key", async () => {
    savePreview.mockResolvedValue({
      task_id: 89,
      task_no: "SUM-89",
      status: 3,
      created_at: "2026-08-26T10:00:00Z",
      finish_status: "PARTIAL",
      gaps: [{ kind: "coverage", detail: "一个频道未覆盖" }],
    });

    await expect(
      service.savePreview({
        sessionId: "session-1",
        messageId: "18",
        snapshotVersion: 1,
        scopeVersion: 1,
        artifactVersion: 3,
        idempotencyKey: "save-key",
        title: "风险总结",
        generationRequestId: "request-1",
      })
    ).resolves.toEqual({
      task_id: 89,
      task_no: "SUM-89",
      status: 3,
      created_at: "2026-08-26T10:00:00Z",
      finish_status: "PARTIAL",
      gaps: [{ kind: "coverage", detail: "一个频道未覆盖" }],
    });

    expect(savePreview).toHaveBeenCalledWith(
      {
        session_id: "session-1",
        agent_message_id: 18,
        snapshot_version: 1,
        scope_version: 1,
        expected_artifact_version: 3,
        title: "风险总结",
        request_id: "request-1",
      },
      { idempotencyKey: "save-key" }
    );
  });

  it("recovers an idempotent save by opening the existing summary", async () => {
    savePreview.mockRejectedValueOnce(
      new SummaryWorkspaceApiError({
        message: "already saved",
        kind: "business",
        code: 40009,
        recoveryAction: "open_existing_summary",
        taskId: 89,
      })
    );
    getSummaryDetail.mockResolvedValueOnce({
      task_id: 89,
      task_no: "SUM-89",
      status: 3,
      created_at: "2026-08-26T10:00:00Z",
    } as never);

    await expect(
      service.savePreview({
        sessionId: "session-1",
        messageId: "18",
        snapshotVersion: 1,
        scopeVersion: 1,
        artifactVersion: 3,
        idempotencyKey: "save-key",
      })
    ).resolves.toMatchObject({ task_id: 89, task_no: "SUM-89" });
    expect(getSummaryDetail).toHaveBeenCalledWith(89);
  });

  it("rejects an invalid preview message id before issuing a request", async () => {
    await expect(
      service.savePreview({
        sessionId: "session-1",
        messageId: "not-a-number",
        snapshotVersion: 1,
        scopeVersion: 1,
        artifactVersion: 1,
        idempotencyKey: "save-key",
      })
    ).rejects.toBeInstanceOf(SummaryWorkspaceApiError);
    expect(savePreview).not.toHaveBeenCalled();
  });

  it("rejects an unsupported preview snapshot version before issuing a request", async () => {
    await expect(
      service.savePreview({
        sessionId: "session-1",
        messageId: "18",
        snapshotVersion: 2,
        scopeVersion: 1,
        artifactVersion: 1,
        idempotencyKey: "save-key",
      })
    ).rejects.toMatchObject({
      kind: "protocol",
      retryable: false,
    });
    expect(savePreview).not.toHaveBeenCalled();
  });

  it("loads capabilities through the strict decoder", async () => {
    getCapabilities.mockResolvedValue({
      enabled: true,
      contract_version: "1",
      max_time_range_days: 90,
    });
    await expect(
      service.getCapabilities({ spaceId: "space-a" })
    ).resolves.toEqual({
      enabled: true,
      contract_version: "1",
      max_time_range_days: 90,
    });
    expect(getCapabilities).toHaveBeenCalledWith({ spaceId: "space-a" });
  });

  it("treats History data:null as an empty server session", async () => {
    getHistory.mockResolvedValueOnce(null);

    await expect(service.loadSession("session-empty")).resolves.toMatchObject({
      sessionId: "session-empty",
      contractVersion: "1",
      empty: true,
      scope: {
        selectedChannels: [],
        participants: [],
        referencedTaskIds: [],
      },
      modelOptions: { messages: [], workflow: null },
    });
  });

  it("treats the backend's full empty History envelope as an empty session", async () => {
    getHistory.mockResolvedValueOnce({
      contract_version: "1",
      session_id: "expired-session",
      messages: [],
      state: {
        scope_version: 1,
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
    });

    await expect(service.loadSession("expired-session")).resolves.toMatchObject(
      {
        sessionId: "expired-session",
        empty: true,
        modelOptions: { messages: [], workflow: null },
      }
    );
  });

  it("loads only the reference metadata needed by the workbench", async () => {
    getSummaryDetail.mockResolvedValue({
      task_id: 42,
      title: "Previous summary",
    } as never);

    await expect(service.loadReferenceSummary(42)).resolves.toEqual({
      task_id: 42,
      title: "Previous summary",
    });
    expect(getSummaryDetail).toHaveBeenCalledWith(42);
  });
});
