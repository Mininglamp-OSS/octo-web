import { describe, expect, it } from "vitest";
import {
  applySummaryResponse,
  canSaveCurrentPreview,
  createInitialSummaryWorkbenchModel,
  deriveSummaryWorkbenchView,
  isTeamProposalConfirmable,
} from "./model";
import {
  adaptSummaryWorkspaceHistory,
  adaptSummaryWorkspaceTurn,
  decodeSummaryWorkspaceCapabilities,
  decodeSummaryWorkspaceSaveResult,
  decodeSummaryWorkspaceStreamError,
} from "./adapter";
import {
  SummaryWorkspaceApiError,
  serializeSummaryWorkbenchScope,
} from "./protocol";

const summaryContext = {
  selected_channels: [
    {
      chat_id: "chat-1",
      chat_type: "group",
      name: "产品研发群",
      is_archived: false,
    },
  ],
  participants: [],
  template: null,
  time_range: {
    start: "2026-08-18T00:00:00+08:00",
    end: "2026-08-26T23:59:59+08:00",
    label: "最近 7 天",
  },
  referenced_task_ids: [],
};

function emptyState(scopeVersion = 1) {
  return {
    scope_version: scopeVersion,
    summary_context: summaryContext,
    current_preview: null,
    pending_proposal: null,
    workflow: null,
  };
}

describe("summary workspace adapter", () => {
  it("maps a trusted preview and filters unknown actions", () => {
    const response = adaptSummaryWorkspaceTurn({
      contract_version: "2",
      session_id: "session-1",
      message_id: 18,
      result_type: "agent_preview",
      reply: "已生成一版预览。",
      scope_version: 2,
      artifact_version: 3,
      available_actions: ["save_preview", "unknown_action", "continue_chat"],
      state: {
        ...emptyState(2),
        current_preview: {
          message_id: 18,
          result_type: "agent_preview",
          scope_version: 2,
          artifact_version: 3,
          snapshot_version: 1,
          content: "# 风险总结",
          assumptions: ["最近 7 天"],
          available_actions: ["save_preview", "continue_chat"],
        },
      },
    });

    expect(response).toMatchObject({
      messageId: "18",
      reply: "已生成一版预览。",
      sessionId: "session-1",
      resultType: "agent_preview",
      scopeVersion: 2,
      availableActions: ["save_preview", "continue_chat"],
      preview: {
        version: 3,
        snapshotVersion: 1,
        content: "# 风险总结",
        assumptions: ["最近 7 天"],
      },
      authoritativeState: {
        scopeVersion: 2,
        scope: {
          selectedChannels: [
            {
              chatId: "chat-1",
              chatType: "group",
              name: "产品研发群",
              isArchived: false,
            },
          ],
          timeRange: {
            start: "2026-08-18T00:00:00+08:00",
            end: "2026-08-26T23:59:59+08:00",
            label: "最近 7 天",
          },
        },
        currentPreview: {
          messageId: "18",
          availableActions: ["save_preview", "continue_chat"],
        },
      },
    });
  });

  it("rejects preview snapshot versions other than the v1 literal", () => {
    expect(() =>
      adaptSummaryWorkspaceTurn({
        contract_version: "2",
        session_id: "session-1",
        message_id: 18,
        result_type: "agent_preview",
        reply: "已生成一版预览。",
        scope_version: 2,
        artifact_version: 3,
        available_actions: ["save_preview"],
        state: {
          ...emptyState(2),
          current_preview: {
            message_id: 18,
            result_type: "agent_preview",
            scope_version: 2,
            artifact_version: 3,
            snapshot_version: 2,
            content: "# 风险总结",
            assumptions: [],
            available_actions: ["save_preview"],
          },
        },
      })
    ).toThrow("turn.state.current_preview.snapshot_version must be 1");
  });

  it("preserves server-authoritative context and state for conversational turns", () => {
    const response = adaptSummaryWorkspaceTurn({
      contract_version: "2",
      session_id: "session-server",
      message_id: 19,
      result_type: "clarification",
      reply: "我先按最近 7 天处理，可以吗？",
      scope_version: 3,
      run_id: "run-19",
      available_actions: ["continue_chat"],
      state: {
        ...emptyState(3),
        summary_context: {
          ...summaryContext,
          referenced_task_ids: [88],
        },
      },
    });

    expect(response).toMatchObject({
      sessionId: "session-server",
      runId: "run-19",
      authoritativeState: {
        scopeVersion: 3,
        scope: { referencedTaskIds: [88] },
        contextItems: [
          expect.objectContaining({ kind: "chat", id: "chat-1" }),
          expect.objectContaining({ kind: "time_range" }),
          { id: "88", kind: "reference", label: "#88" },
        ],
        currentPreview: null,
        pendingProposal: null,
        workflow: null,
      },
    });
  });

  it("normalizes multi-id referenced_task_ids at the decode boundary so wire and UI cannot disagree (PR #1637 P1)", () => {
    // Legacy or malformed server state may carry more than one referenced task
    // id. The product supports one referenced summary, so `toWorkbenchScope`
    // must cap the array at decode time — otherwise the UI renders one chip
    // while `serializeSummaryWorkbenchScope` still ships the full array on the
    // wire, and the summary is generated from a task the user cannot see.
    const response = adaptSummaryWorkspaceTurn({
      contract_version: "2",
      session_id: "session-multi-ref",
      message_id: 21,
      result_type: "clarification",
      reply: "多引用会话恢复",
      scope_version: 4,
      run_id: "run-21",
      available_actions: ["continue_chat"],
      state: {
        ...emptyState(4),
        summary_context: {
          ...summaryContext,
          referenced_task_ids: [7, 8, 9],
        },
      },
    });

    // Scope submitted on the wire is capped to the primary reference, and the
    // lossy normalization advances the version so the backend accepts the new
    // scope hash instead of treating it as a same-version conflict.
    expect(response.scopeVersion).toBe(4);
    expect(response.authoritativeState?.scopeVersion).toBe(5);
    expect(response.authoritativeState?.scope.referencedTaskIds).toEqual([7]);
    expect(
      serializeSummaryWorkbenchScope(response.authoritativeState!.scope)
        .referenced_task_ids
    ).toEqual([7]);
    // And the derived UI context items only carry that one reference — so
    // the chip the user sees matches the id the backend receives.
    const referenceItems = response.authoritativeState?.contextItems.filter(
      (item) => item.kind === "reference"
    );
    expect(referenceItems).toEqual([
      { id: "7", kind: "reference", label: "#7" },
    ]);
  });

  it("marks an existing preview stale when multi-reference history is normalized", () => {
    const hydration = adaptSummaryWorkspaceHistory({
      contract_version: "2",
      session_id: "session-history-multi-ref",
      messages: [
        {
          id: 18,
          role: "assistant",
          content: "已生成一版预览。",
          result_type: "agent_preview",
          scope_version: 4,
          artifact_version: 3,
          available_actions: ["save_preview", "continue_chat"],
        },
      ],
      state: {
        ...emptyState(4),
        summary_context: {
          ...summaryContext,
          referenced_task_ids: [7, 8, 9],
        },
        current_preview: {
          message_id: 18,
          result_type: "agent_preview",
          scope_version: 4,
          artifact_version: 3,
          snapshot_version: 1,
          content: "# 风险总结",
          assumptions: [],
          available_actions: ["save_preview", "continue_chat"],
        },
      },
    });
    const model = createInitialSummaryWorkbenchModel(hydration.modelOptions);

    expect(hydration.modelOptions.scopeVersion).toBe(5);
    expect(hydration.scope.referencedTaskIds).toEqual([7]);
    expect(
      serializeSummaryWorkbenchScope(hydration.scope).referenced_task_ids
    ).toEqual([7]);
    expect(canSaveCurrentPreview(model)).toBe(false);
    const card = deriveSummaryWorkbenchView(model).card;
    expect(card).toMatchObject({ isStale: true });
    expect(card?.actions).not.toContain("save_preview");
  });

  it.each([{ referencedTaskIds: [] }, { referencedTaskIds: [7] }])("preserves a current preview when reference normalization is lossless ($referencedTaskIds)", ({ referencedTaskIds }) => {
    const hydration = adaptSummaryWorkspaceHistory({
      contract_version: "2",
      session_id: "session-current",
      messages: [{ id: 18, role: "assistant", content: "Current", result_type: "agent_preview", scope_version: 4, artifact_version: 3, available_actions: ["save_preview", "continue_chat"] }],
      state: {
        ...emptyState(4),
        summary_context: { ...summaryContext, referenced_task_ids: referencedTaskIds },
        current_preview: {
          message_id: 18, result_type: "agent_preview", scope_version: 4,
          artifact_version: 3, snapshot_version: 1, content: "# Current",
          assumptions: [], available_actions: ["save_preview", "continue_chat"],
        },
      },
    });
    const model = createInitialSummaryWorkbenchModel(hydration.modelOptions);
    expect(model.scopeVersion).toBe(4);
    expect(model.currentPreview?.scopeVersion).toBe(4);
    expect(canSaveCurrentPreview(model)).toBe(true);
    expect(serializeSummaryWorkbenchScope(hydration.scope).referenced_task_ids).toEqual(referencedTaskIds);
  });

  it("rejects a normalized legacy proposal and accepts a fresh preview without repeated version bumps", () => {
    const hydration = adaptSummaryWorkspaceHistory({
      contract_version: "2",
      session_id: "session-recovery",
      messages: [{ id: 30, role: "assistant", content: "Confirm", result_type: "workflow_confirmation", scope_version: 4, available_actions: ["confirm_workflow"] }],
      state: {
        ...emptyState(4),
        summary_context: { ...summaryContext, referenced_task_ids: [7, 8] },
        pending_proposal: {
          message_id: 30, scope_version: 4, proposal_version: 2,
          proposal_token: "legacy-proposal", participants: [{ user_id: "u1" }],
          requirement: "Summarize progress", available_actions: ["confirm_workflow"],
        },
      },
    });
    const stale = createInitialSummaryWorkbenchModel(hydration.modelOptions);
    expect(stale.scopeVersion).toBe(5);
    expect(stale.pendingProposal?.scopeVersion).toBe(4);
    expect(isTeamProposalConfirmable(stale)).toBe(false);
    expect(deriveSummaryWorkbenchView(stale).card?.actions).not.toContain("confirm_workflow");
    const submittedContext = serializeSummaryWorkbenchScope(hydration.scope);
    expect(submittedContext.referenced_task_ids).toEqual([7]);

    // The server accepts the advanced scope and returns a new artifact for it.
    const state = {
      ...emptyState(stale.scopeVersion),
      summary_context: submittedContext,
      current_preview: {
        message_id: 31, result_type: "agent_preview", scope_version: stale.scopeVersion,
        artifact_version: 4, snapshot_version: 1, content: "# Regenerated from reference 7",
        assumptions: [], available_actions: ["save_preview", "continue_chat"],
      },
    };
    const response = adaptSummaryWorkspaceTurn({
      contract_version: "2", session_id: hydration.sessionId, message_id: 31,
      result_type: "agent_preview", reply: "Regenerated", scope_version: stale.scopeVersion,
      artifact_version: 4, available_actions: ["save_preview", "continue_chat"], state,
    });
    const recovered = applySummaryResponse(stale, response);
    expect(recovered.scopeVersion).toBe(5);
    expect(recovered.currentPreview?.scopeVersion).toBe(5);
    expect(recovered.pendingProposal).toBeNull();
    expect(canSaveCurrentPreview(recovered)).toBe(true);
    const reloaded = adaptSummaryWorkspaceHistory({
      contract_version: "2", session_id: hydration.sessionId,
      messages: [{ id: 31, role: "assistant", content: "Regenerated", result_type: "agent_preview", scope_version: 5, artifact_version: 4, available_actions: ["save_preview", "continue_chat"] }], state,
    });
    expect(reloaded.modelOptions.scopeVersion).toBe(5);
    expect(canSaveCurrentPreview(createInitialSummaryWorkbenchModel(reloaded.modelOptions))).toBe(true);
  });

  it("fails closed when result_type or artifact state is invalid", () => {
    expect(() =>
      adaptSummaryWorkspaceTurn({
        contract_version: "2",
        session_id: "session-1",
        message_id: 18,
        result_type: "future_result",
        reply: "future",
        scope_version: 1,
        available_actions: [],
        state: emptyState(),
      })
    ).toThrow(SummaryWorkspaceApiError);

    expect(() =>
      adaptSummaryWorkspaceTurn({
        contract_version: "2",
        session_id: "session-1",
        message_id: 18,
        result_type: "agent_preview",
        reply: "missing preview",
        scope_version: 1,
        available_actions: ["save_preview"],
        state: emptyState(),
      })
    ).toThrow("Preview state does not match the turn");
  });

  it("requires completed workflows to be server-confirmed as saved", () => {
    expect(() =>
      adaptSummaryWorkspaceTurn({
        contract_version: "2",
        session_id: "session-1",
        message_id: 20,
        result_type: "workflow_completed",
        reply: "完成",
        scope_version: 1,
        available_actions: ["view_summary"],
        state: {
          ...emptyState(),
          workflow: {
            message_id: 20,
            result_type: "workflow_completed",
            scope_version: 1,
            task_id: 42,
            task_title: "项目周报",
            status: 3,
            scope: "personal",
            saved: false,
            available_actions: ["view_summary"],
          },
        },
      })
    ).toThrow("A completed Workflow must be saved");
  });

  it("hydrates History with the latest preview as the only saveable artifact", () => {
    const hydration = adaptSummaryWorkspaceHistory({
      contract_version: "2",
      session_id: "session-1",
      messages: [
        {
          id: 17,
          role: "user",
          content: "帮我总结风险",
          scope_version: 2,
        },
        {
          id: 18,
          role: "assistant",
          content: "已生成一版预览。",
          result_type: "agent_preview",
          scope_version: 2,
          artifact_version: 3,
          available_actions: ["save_preview", "continue_chat"],
        },
      ],
      state: {
        ...emptyState(2),
        current_preview: {
          message_id: 18,
          result_type: "agent_preview",
          scope_version: 2,
          artifact_version: 3,
          snapshot_version: 1,
          content: "# 风险总结",
          assumptions: [],
          available_actions: ["save_preview", "continue_chat"],
        },
      },
    });
    const model = createInitialSummaryWorkbenchModel(hydration.modelOptions);

    expect(hydration.sessionId).toBe("session-1");
    expect(hydration.scope.selectedChannels[0]?.chatId).toBe("chat-1");
    expect(model.currentPreview).toMatchObject({
      messageId: "18",
      version: 3,
      snapshotVersion: 1,
    });
    expect(canSaveCurrentPreview(model)).toBe(true);
  });

  it("hydrates a proposal token used by deterministic confirmation", () => {
    const hydration = adaptSummaryWorkspaceHistory({
      contract_version: "2",
      session_id: "session-team",
      messages: [
        {
          id: 30,
          role: "assistant",
          content: "请确认协作要求。",
          result_type: "workflow_confirmation",
          scope_version: 4,
          available_actions: ["confirm_workflow"],
        },
      ],
      state: {
        ...emptyState(4),
        pending_proposal: {
          message_id: 30,
          scope_version: 4,
          proposal_version: 2,
          proposal_token: "proposal-token",
          participants: [{ user_id: "u1", user_name: "张三" }],
          requirement: "提交进展与风险",
          available_actions: ["confirm_workflow"],
        },
      },
    });
    const model = createInitialSummaryWorkbenchModel(hydration.modelOptions);

    expect(model.pendingProposal?.proposalToken).toBe("proposal-token");
    expect(isTeamProposalConfirmable(model)).toBe(true);
  });

  it("hydrates every historical preview as an inline read-only card", () => {
    const preview = (
      messageId: number,
      resultType: "agent_preview" | "agent_revision",
      version: number,
      content: string,
      actions: string[]
    ) => ({
      message_id: messageId,
      result_type: resultType,
      scope_version: 2,
      artifact_version: version,
      snapshot_version: 1,
      content,
      assumptions: [],
      available_actions: actions,
    });
    const currentPreview = preview(
      20,
      "agent_revision",
      2,
      "# 总结 V2",
      ["save_preview", "continue_chat"]
    );
    const hydration = adaptSummaryWorkspaceHistory({
      contract_version: "2",
      session_id: "session-history",
      messages: [
        {
          id: 10,
          role: "assistant",
          content: "第一版",
          result_type: "agent_preview",
          scope_version: 2,
          artifact_version: 1,
          available_actions: [],
          preview: preview(10, "agent_preview", 1, "# 总结 V1", []),
        },
        {
          id: 15,
          role: "user",
          content: "补充风险",
          scope_version: 2,
        },
        {
          id: 20,
          role: "assistant",
          content: "第二版",
          result_type: "agent_revision",
          scope_version: 2,
          artifact_version: 2,
          available_actions: ["save_preview", "continue_chat"],
          preview: currentPreview,
        },
      ],
      state: { ...emptyState(2), current_preview: currentPreview },
    });

    expect(hydration.modelOptions.messages[0]).toMatchObject({
      id: "10",
      card: { kind: "agent_preview", content: "# 总结 V1", actions: [] },
    });
    expect(hydration.modelOptions.messages[1]).not.toHaveProperty("card");
    expect(hydration.modelOptions.messages[2]).toMatchObject({
      id: "20",
      card: {
        kind: "agent_revision",
        content: "# 总结 V2",
        actions: ["save_preview", "continue_chat"],
      },
    });
  });

  it("preserves participants from a server scope that needs user correction", () => {
    const hydration = adaptSummaryWorkspaceHistory({
      contract_version: "2",
      session_id: "session-invalid-participant-scope",
      messages: [],
      state: {
        ...emptyState(2),
        summary_context: {
          ...summaryContext,
          selected_channels: [
            {
              chat_id: "direct-1",
              chat_type: "direct",
              name: "张三",
            },
          ],
          participants: [{ user_id: "u1", user_name: "张三" }],
        },
      },
    });

    expect(hydration.scope).toMatchObject({
      selectedChannels: [{ chatId: "direct-1", chatType: "direct" }],
      participants: [{ userId: "u1", userName: "张三" }],
    });
  });

  it("rejects History when artifact state points at a user or mismatched message", () => {
    const currentPreview = {
      message_id: 18,
      result_type: "agent_preview",
      scope_version: 2,
      artifact_version: 3,
      snapshot_version: 1,
      content: "# 风险总结",
      assumptions: [],
      available_actions: ["save_preview"],
    };
    const history = {
      contract_version: "2",
      session_id: "session-1",
      messages: [
        {
          id: 18,
          role: "user",
          content: "伪造的预览",
          result_type: "agent_preview",
          scope_version: 2,
          artifact_version: 3,
        },
      ],
      state: { ...emptyState(2), current_preview: currentPreview },
    };

    expect(() => adaptSummaryWorkspaceHistory(history)).toThrow(
      "History artifact metadata does not match its message"
    );
    history.messages[0].role = "assistant";
    history.messages[0].artifact_version = 2;
    expect(() => adaptSummaryWorkspaceHistory(history)).toThrow(
      "History artifact metadata does not match its message"
    );
  });

  it("accepts a matching preview when the History message omits optional artifact_version", () => {
    const currentPreview = {
      message_id: 18,
      result_type: "agent_preview",
      scope_version: 2,
      artifact_version: 3,
      snapshot_version: 1,
      content: "# 风险总结",
      assumptions: [],
      available_actions: ["save_preview"],
    };

    expect(
      adaptSummaryWorkspaceHistory({
        contract_version: "2",
        session_id: "session-1",
        messages: [
          {
            id: 18,
            role: "assistant",
            content: "已生成总结",
            result_type: "agent_preview",
            scope_version: 2,
            preview: currentPreview,
          },
        ],
        state: { ...emptyState(2), current_preview: currentPreview },
      }).modelOptions.currentPreview
    ).toMatchObject({ version: 3, content: "# 风险总结" });
  });

  it("serializes rich scope without deriving request data from display chips", () => {
    expect(
      serializeSummaryWorkbenchScope({
        selectedChannels: [
          {
            chatId: "chat-1",
            chatType: "thread",
            name: "发布讨论",
            isArchived: true,
          },
        ],
        participants: [{ userId: "u1", userName: "张三" }],
        template: {
          templateId: "weekly",
          label: "项目周报",
          requirement: "输出风险和下一步",
          version: 2,
        },
        timeRange: {
          start: "2026-08-18T00:00:00+08:00",
          end: "2026-08-26T23:59:59+08:00",
          label: "最近 7 天",
        },
        referencedTaskIds: [8],
      })
    ).toMatchObject({
      selected_channels: [
        {
          chat_id: "chat-1",
          chat_type: "thread",
          is_archived: true,
        },
      ],
      participants: [{ user_id: "u1", user_name: "张三" }],
      template: { template_id: "weekly", version: 2 },
      referenced_task_ids: [8],
    });
  });

  it("decodes the rollout capability contract", () => {
    expect(
      decodeSummaryWorkspaceCapabilities({
        enabled: true,
        contract_version: "2",
        max_time_range_days: 90,
        direct_team_workflow: true,
      })
    ).toEqual({
      enabled: true,
      contract_version: "2",
      max_time_range_days: 90,
      direct_team_workflow: true,
    });
    expect(
      decodeSummaryWorkspaceCapabilities({
        enabled: true,
        contract_version: "2",
      })
    ).toEqual({
      enabled: true,
      contract_version: "2",
      max_time_range_days: 31,
      direct_team_workflow: false,
    });
  });

  it("rejects unsupported contract versions", () => {
    expect(() =>
      decodeSummaryWorkspaceCapabilities({
        enabled: true,
        contract_version: "3",
      })
    ).toThrow("capabilities.contract_version must be 2");

    expect(() =>
      adaptSummaryWorkspaceTurn({
        contract_version: "3",
        session_id: "session-1",
        message_id: 10,
        result_type: "clarification",
        reply: "需要更多信息",
        scope_version: 1,
        available_actions: ["continue_chat"],
        state: emptyState(),
      })
    ).toThrow("turn.contract_version must be 2");

    expect(() =>
      adaptSummaryWorkspaceHistory({
        contract_version: "3",
        session_id: "session-1",
        messages: [],
        state: emptyState(),
      })
    ).toThrow("history.contract_version must be 2");
  });

  it("decodes the existing agent-save task response", () => {
    expect(
      decodeSummaryWorkspaceSaveResult({
        task_id: 89,
        task_no: "SUM-89",
        status: 3,
        created_at: "2026-08-26T10:00:00Z",
        finish_status: "PARTIAL",
        gaps: [{ kind: "coverage", detail: "一个频道未覆盖" }],
      })
    ).toEqual({
      task_id: 89,
      task_no: "SUM-89",
      status: 3,
      created_at: "2026-08-26T10:00:00Z",
      finish_status: "PARTIAL",
      gaps: [{ kind: "coverage", detail: "一个频道未覆盖" }],
    });
  });

  it("keeps a FAILED finish verdict as successful-save metadata", () => {
    expect(
      decodeSummaryWorkspaceSaveResult({
        task_id: 90,
        task_no: "SUM-90",
        status: 3,
        created_at: "2026-08-26T10:01:00Z",
        finish_status: "FAILED",
        gaps: [{ kind: "citation", detail: "引用完整性校验失败" }],
      })
    ).toEqual({
      task_id: 90,
      task_no: "SUM-90",
      status: 3,
      created_at: "2026-08-26T10:01:00Z",
      finish_status: "FAILED",
      gaps: [{ kind: "citation", detail: "引用完整性校验失败" }],
    });
  });

  it("accepts internal quality gaps when the backend omits unused detail", () => {
    expect(
      decodeSummaryWorkspaceSaveResult({
        task_id: 91,
        task_no: "SUM-91",
        status: 3,
        created_at: "2026-08-26T10:02:00Z",
        finish_status: "PARTIAL",
        gaps: [{ kind: "coverage" }],
      })
    ).toEqual({
      task_id: 91,
      task_no: "SUM-91",
      status: 3,
      created_at: "2026-08-26T10:02:00Z",
      finish_status: "PARTIAL",
      gaps: [{ kind: "coverage" }],
    });
  });

  it("treats stream code 40902 as retryable even when transient is omitted", () => {
    expect(
      decodeSummaryWorkspaceStreamError({
        code: 40902,
        message: "request still in progress",
      })
    ).toMatchObject({
      kind: "transport",
      code: 40902,
      retryable: true,
    });
  });
});
