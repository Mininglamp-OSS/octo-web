import { describe, expect, it } from "vitest";
import type { SummaryWorkbenchContextItem } from "../../ui/SummaryWorkbench/types";
import {
  applySummaryResponse,
  attachSummaryMessageProcess,
  canSaveCurrentPreview,
  createInitialSummaryWorkbenchModel,
  deriveSummaryWorkbenchView,
  isTeamProposalConfirmable,
  markCurrentSummaryPreviewSaved,
  updateSummaryComposer,
  updateSummaryScope,
} from "./model";

const chatContext: SummaryWorkbenchContextItem = {
  id: "chat-product",
  kind: "chat",
  label: "产品研发群",
};

const templateContext: SummaryWorkbenchContextItem = {
  id: "template-weekly",
  kind: "template",
  label: "团队周报",
};

describe("summary workbench model", () => {
  it("attaches generation progress to the matching assistant turn", () => {
    const responded = applySummaryResponse(
      createInitialSummaryWorkbenchModel(),
      {
        messageId: "assistant-1",
        reply: "已生成总结。",
        resultType: "explanation",
      }
    );
    const withProcess = attachSummaryMessageProcess(responded, "assistant-1", {
      status: "completed",
      steps: [{ phase: "retrieve", count: 8 }],
    });

    expect(
      deriveSummaryWorkbenchView(withProcess).messages[0]?.process
    ).toEqual({
      status: "completed",
      steps: [{ phase: "retrieve", count: 8 }],
    });
  });

  it("creates the explicit domain state and derives composer presentation", () => {
    const initial = createInitialSummaryWorkbenchModel({ layout: "panel" });

    expect(initial).toMatchObject({
      layout: "panel",
      scopeVersion: 1,
      contextItems: [],
      messages: [],
      currentPreview: null,
      pendingProposal: null,
      workflow: null,
      composer: { value: "", isSending: false },
    });

    const changed = updateSummaryComposer(initial, {
      value: "帮我总结本周风险",
      isSending: true,
    });
    const view = deriveSummaryWorkbenchView(changed);

    expect(view.inputValue).toBe("帮我总结本周风险");
    expect(view.isSending).toBe(true);
    expect(view.canSend).toBe(false);
    expect(view.placeholderKey).toBe("summary.workbench.placeholder.sending");
  });

  it("uses resultType and availableActions instead of routing from selected context", () => {
    const configured = updateSummaryScope(
      createInitialSummaryWorkbenchModel(),
      {
        contextItems: [chatContext, templateContext],
      }
    );

    const clarified = applySummaryResponse(configured, {
      messageId: "message-1",
      reply: "还希望重点关注哪些风险？",
      resultType: "clarification",
      availableActions: ["continue_chat"],
    });

    expect(clarified.workflow).toBeNull();
    expect(clarified.currentPreview).toBeNull();
    expect(deriveSummaryWorkbenchView(clarified).card).toBeUndefined();
  });

  it("keeps the current preview when clarification or explanation is appended", () => {
    const preview = applySummaryResponse(createInitialSummaryWorkbenchModel(), {
      messageId: "preview-1",
      reply: "已生成第一版。",
      resultType: "agent_preview",
      availableActions: ["save_preview", "continue_chat"],
      preview: {
        version: 1,
        snapshotVersion: 1,
        content: "# 风险总结",
        assumptions: ["最近 7 天"],
      },
    });

    const explained = applySummaryResponse(preview, {
      messageId: "explanation-1",
      reply: "风险排序来自消息中的阻塞频次。",
      resultType: "explanation",
      availableActions: ["continue_chat"],
    });
    const clarified = applySummaryResponse(explained, {
      messageId: "clarification-1",
      reply: "要改成面向管理层的版本吗？",
      resultType: "clarification",
      availableActions: ["continue_chat"],
    });

    expect(clarified.currentPreview).toEqual(preview.currentPreview);
    expect(deriveSummaryWorkbenchView(clarified).card).toMatchObject({
      kind: "agent_preview",
      version: 1,
      content: "# 风险总结",
    });
    expect(canSaveCurrentPreview(clarified)).toBe(true);
  });

  it("lets server-authoritative state replace local scope and artifacts", () => {
    const preview = applySummaryResponse(createInitialSummaryWorkbenchModel(), {
      messageId: "preview-1",
      reply: "已生成第一版。",
      resultType: "agent_preview",
      availableActions: ["save_preview"],
      preview: {
        version: 1,
        snapshotVersion: 1,
        content: "old draft",
      },
    });
    const synchronized = applySummaryResponse(preview, {
      messageId: "explanation-1",
      sessionId: "session-server",
      reply: "服务端已经采用默认时间范围。",
      resultType: "explanation",
      availableActions: ["continue_chat"],
      authoritativeState: {
        scopeVersion: 4,
        scope: {
          selectedChannels: [],
          participants: [],
          template: null,
          timeRange: null,
          referencedTaskIds: [],
        },
        contextItems: [templateContext],
        currentPreview: null,
        pendingProposal: null,
        workflow: null,
      },
    });

    expect(synchronized.scopeVersion).toBe(4);
    expect(synchronized.contextItems).toEqual([templateContext]);
    expect(synchronized.currentPreview).toBeNull();
    expect(deriveSummaryWorkbenchView(synchronized).card).toBeUndefined();
  });

  it("allows saving only a current preview or revision with save_preview", () => {
    const withoutAction = applySummaryResponse(
      createInitialSummaryWorkbenchModel(),
      {
        messageId: "preview-1",
        reply: "已生成第一版。",
        resultType: "agent_preview",
        availableActions: ["continue_chat"],
        preview: { version: 1, snapshotVersion: 1, content: "draft" },
      }
    );
    expect(canSaveCurrentPreview(withoutAction)).toBe(false);

    const revision = applySummaryResponse(withoutAction, {
      messageId: "preview-2",
      reply: "已按反馈修改。",
      resultType: "agent_revision",
      availableActions: ["save_preview", "confirm_workflow"],
      preview: {
        version: 2,
        snapshotVersion: 1,
        content: "revised draft",
      },
    });
    expect(canSaveCurrentPreview(revision)).toBe(true);
    expect(deriveSummaryWorkbenchView(revision).card).toMatchObject({
      actions: ["save_preview"],
    });
    const revisionView = deriveSummaryWorkbenchView(revision);
    expect(revisionView.messages[0]?.card).toMatchObject({
      kind: "agent_preview",
      isHistorical: true,
      actions: [],
    });
    expect(revisionView.messages[1]?.card).toMatchObject({
      kind: "agent_revision",
      isHistorical: false,
      actions: ["save_preview"],
    });

    const completed = applySummaryResponse(revision, {
      messageId: "workflow-1",
      reply: "正式总结已自动保存。",
      resultType: "workflow_completed",
      // A malformed/forward-compatible server action must not expose save
      // on a formal workflow result.
      availableActions: [
        "save_preview",
        "confirm_workflow",
        "continue_chat",
        "view_summary",
      ],
      workflow: { taskId: 42, taskTitle: "产品研发群周报" },
    });
    expect(canSaveCurrentPreview(completed)).toBe(false);
    expect(deriveSummaryWorkbenchView(completed).card).toMatchObject({
      kind: "workflow_completed",
      actions: ["view_summary"],
    });

    const saved = markCurrentSummaryPreviewSaved(revision);
    expect(canSaveCurrentPreview(saved)).toBe(false);
    expect(deriveSummaryWorkbenchView(saved).card).toMatchObject({
      kind: "agent_revision",
      actions: [],
    });
  });

  it("makes a preview stale after the scope changes", () => {
    const scoped = updateSummaryScope(createInitialSummaryWorkbenchModel(), {
      contextItems: [chatContext],
    });
    const preview = applySummaryResponse(scoped, {
      messageId: "preview-1",
      reply: "已生成第一版。",
      resultType: "agent_preview",
      availableActions: ["save_preview", "continue_chat"],
      preview: { version: 1, snapshotVersion: 1, content: "draft" },
    });
    const changed = updateSummaryScope(preview, {
      contextItems: [chatContext, templateContext],
    });

    expect(changed.scopeVersion).toBe(preview.scopeVersion + 1);
    expect(changed.currentPreview).toEqual(preview.currentPreview);
    expect(canSaveCurrentPreview(changed)).toBe(false);
    expect(deriveSummaryWorkbenchView(changed)).toMatchObject({
      placeholderKey: "summary.workbench.placeholder.scopeChanged",
      card: {
        kind: "agent_preview",
        isStale: true,
        actions: ["continue_chat"],
      },
    });
  });

  it("makes a team proposal stale after the scope changes", () => {
    const scoped = updateSummaryScope(createInitialSummaryWorkbenchModel(), {
      contextItems: [
        chatContext,
        { id: "member-1", kind: "participant", label: "张三" },
      ],
    });
    const proposed = applySummaryResponse(scoped, {
      messageId: "proposal-1",
      reply: "请确认协作要求。",
      resultType: "workflow_confirmation",
      availableActions: ["confirm_workflow", "save_preview", "continue_chat"],
      confirmation: {
        proposalVersion: 3,
        proposalToken: "proposal-token-3",
        participantNames: ["张三"],
        requirement: "提交本周进展和风险",
        timeRangeLabel: "最近 7 天",
      },
    });

    expect(isTeamProposalConfirmable(proposed)).toBe(true);

    const changed = updateSummaryScope(proposed, {
      contextItems: [
        chatContext,
        { id: "member-2", kind: "participant", label: "李四" },
      ],
    });

    expect(isTeamProposalConfirmable(changed)).toBe(false);
    expect(deriveSummaryWorkbenchView(changed).card).toMatchObject({
      kind: "team_confirmation",
      isStale: true,
      actions: ["continue_chat"],
    });
  });

  it("clears a pending proposal when the confirmed workflow starts", () => {
    const proposed = applySummaryResponse(
      createInitialSummaryWorkbenchModel(),
      {
        messageId: "proposal-1",
        reply: "请确认协作要求。",
        resultType: "workflow_confirmation",
        availableActions: ["confirm_workflow"],
        confirmation: {
          proposalVersion: 1,
          proposalToken: "proposal-token-1",
          participantNames: ["张三", "李四"],
          requirement: "分别提交进展与阻塞",
        },
      }
    );
    const started = applySummaryResponse(proposed, {
      messageId: "workflow-1",
      reply: "协作总结已发起。",
      resultType: "workflow_started",
      availableActions: ["view_progress"],
      workflow: {
        taskId: 99,
        taskTitle: "研发协作总结",
        participantCount: 2,
      },
    });

    expect(started.pendingProposal).toBeNull();
    expect(started.workflow).toMatchObject({
      taskId: 99,
      resultType: "workflow_started",
    });
    expect(deriveSummaryWorkbenchView(started).card).toMatchObject({
      kind: "workflow_started",
      participantCount: 2,
      actions: ["view_progress"],
    });
  });

  it("keeps a created workflow current when later scope changes prepare another request", () => {
    const completed = applySummaryResponse(
      createInitialSummaryWorkbenchModel(),
      {
        messageId: "workflow-1",
        reply: "正式总结已自动保存。",
        resultType: "workflow_completed",
        availableActions: ["view_summary"],
        workflow: { taskId: 42, taskTitle: "产品研发群周报" },
      }
    );
    const changed = updateSummaryScope(completed, {
      contextItems: [chatContext],
    });

    expect(deriveSummaryWorkbenchView(changed).card).toMatchObject({
      kind: "workflow_completed",
      isStale: false,
      actions: ["view_summary"],
    });
  });
});
