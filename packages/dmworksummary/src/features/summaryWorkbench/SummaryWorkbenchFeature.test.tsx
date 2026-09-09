import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adaptSummaryWorkspaceHistory } from "../../bridge/summaryWorkbench/adapter";
import type { SummaryWorkbenchScope } from "../../bridge/summaryWorkbench/protocol";
import SummaryWorkbenchFeature from "./SummaryWorkbenchFeature";
import type { WorkbenchMemberCandidate } from "./scope";

const mocks = vi.hoisted(() => ({
  useSummaryWorkbench: vi.fn(),
  getSummaryDetail: vi.fn(),
  track: vi.fn(),
  markNotificationEligible: vi.fn(),
  routePopToRoot: vi.fn(),
  routePush: vi.fn(),
  busEmit: vi.fn(),
  toastInfo: vi.fn(),
  toastWarning: vi.fn(),
  toastSuccess: vi.fn(),
  modalConfirm: vi.fn(),
  loadParticipantCandidates: vi.fn(),
}));

vi.mock("@octo/base", () => ({
  Dap: { shared: { track: mocks.track } },
  getImChannelInfo: () => ({
    title: "mock-channel-title",
    orgData: {},
  }),
  ChannelTypeCommunityTopic: 5,
  parseThreadChannelId: () => null,
  useI18n: () => ({
    t: (key: string) => {
      return (
        {
          "summary.workbench.intent.personal": "personal-intent",
          "summary.workbench.intent.team": "team-intent",
          "summary.common.confirm": "confirm",
          "summary.common.cancel": "cancel",
        }[key] ?? key
      );
    },
    format: { date: (value: unknown) => String(value) },
  }),
  default: {
    loginInfo: { uid: "test-uid" },
    routeRight: {
      popToRoot: mocks.routePopToRoot,
      push: mocks.routePush,
    },
    mittBus: { emit: mocks.busEmit },
  },
}));

vi.mock("@octo/base/src/App", () => ({
  Dap: { shared: { track: mocks.track } },
  useI18n: () => ({
    t: (key: string) => {
      return (
        {
          "summary.workbench.intent.personal": "personal-intent",
          "summary.workbench.intent.team": "team-intent",
          "summary.common.confirm": "confirm",
          "summary.common.cancel": "cancel",
        }[key] ?? key
      );
    },
    format: { date: (value: unknown) => String(value) },
  }),
  // PR #1637 P2 support: tests that pass a `channel` prop trigger
  // `channelToChatCandidate`, which imports these three helpers from
  // @octo/base. The alias in vitest.config.ts routes @octo/base and
  // @octo/base/src/App to the same shim, so this vi.mock must expose them.
  getImChannelInfo: () => ({
    title: "mock-channel-title",
    orgData: {},
  }),
  ChannelTypeCommunityTopic: 5,
  parseThreadChannelId: () => null,
  default: {
    loginInfo: { uid: "test-uid" },
    routeRight: {
      popToRoot: mocks.routePopToRoot,
      push: mocks.routePush,
    },
    mittBus: { emit: mocks.busEmit },
  },
}));

vi.mock("@douyinfe/semi-ui", () => {
  const Modal = ({ visible, children, onOk }: any) =>
    visible ? (
      <div data-testid="modal">
        {children}
        <button type="button" onClick={onOk}>
          modal-ok
        </button>
      </div>
    ) : null;
  Modal.confirm = mocks.modalConfirm;
  return {
    Input: ({ value, onChange, showClear: _showClear, ...props }: any) => (
      <input
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        {...props}
      />
    ),
    Modal,
    Spin: () => <div data-testid="spin" />,
    Toast: {
      info: mocks.toastInfo,
      warning: mocks.toastWarning,
      success: mocks.toastSuccess,
    },
  };
});

vi.mock("../../bridge/summaryWorkbench/useSummaryWorkbench", () => ({
  default: (...args: unknown[]) => mocks.useSummaryWorkbench(...args),
  sameSummaryWorkbenchScope: (
    left: SummaryWorkbenchScope,
    right: SummaryWorkbenchScope
  ) => JSON.stringify(left) === JSON.stringify(right),
}));

vi.mock("./participantCandidates", () => ({
  loadParticipantCandidates: (...args: unknown[]) =>
    mocks.loadParticipantCandidates(...args),
}));

vi.mock("../../Service/SummaryWorkbenchService", () => ({
  default: {
    loadReferenceSummary: (...args: unknown[]) =>
      mocks.getSummaryDetail(...args),
  },
}));

vi.mock("../../ui/SummaryWorkbench", () => ({
  default: ({ state, actions, contextPanel }: any) => (
    <div
      data-testid="workbench-ui"
      data-can-send={String(state.canSend)}
      data-send-label={state.sendLabelKey}
      data-error-message={state.errorMessage ?? ""}
      data-template-locked={String(state.templateLocked)}
      data-reference-preview-open={String(state.referencePreviewOpen)}
      data-reference-preview-id={state.referencePreviewId ?? ""}
    >
      <span data-testid="reference-label">
        {state.contextItems.find((item: any) => item.kind === "reference")
          ?.label ?? ""}
      </span>
      <input
        aria-label="summary-request"
        value={state.inputValue}
        onChange={(event) => actions.onInputChange(event.target.value)}
      />
      <button type="button" onClick={actions.onSend}>
        send
      </button>
      <button
        type="button"
        onClick={() => actions.onResultAction("confirm_workflow")}
      >
        confirm-workflow
      </button>
      <button
        type="button"
        onClick={() => actions.onResultAction("save_preview")}
      >
        save-preview
      </button>
      <button
        type="button"
        onClick={() => actions.onResultAction("view_summary")}
      >
        view-summary
      </button>
      <button type="button" onClick={() => actions.onOpenContext("reference")}>
        open-reference
      </button>
      <button
        type="button"
        onClick={() => actions.onRemoveContext("chat", "chat-a")}
      >
        remove-chat
      </button>
      <button
        type="button"
        onClick={() => actions.onRemoveContext("template", "weekly")}
      >
        remove-template
      </button>
      <button
        type="button"
        onClick={() => actions.onOpenContext("participant")}
      >
        open-participant
      </button>
      <button type="button" onClick={() => actions.onOpenContext("time_range")}>
        open-time-range
      </button>
      {state.showTemplateTrigger && (
        <button type="button" onClick={() => actions.onOpenContext("template")}>
          open-template
        </button>
      )}
      <button type="button" onClick={actions.onNewSession}>
        new-session
      </button>
      {contextPanel}
    </div>
  ),
}));

vi.mock("../../components/ChatSelectorModal", () => ({
  default: ({ visible, mode, channel }: any) =>
    visible ? (
      <div
        data-testid="chat-selector"
        data-mode={mode ?? "chat"}
        data-channel-id={channel?.channelID ?? ""}
      />
    ) : null,
}));
vi.mock("../../components/TemplateSelectorModal", () => ({
  default: ({ visible, inline, onChange }: any) =>
    visible ? (
      <div data-testid="template-selector" data-inline={String(inline)}>
        <button
          type="button"
          onClick={() =>
            onChange({
              templateId: "weekly",
              label: "Weekly",
              requirement: "Summarize progress and risks",
            })
          }
        >
          choose-template
        </button>
      </div>
    ) : null,
}));
vi.mock("../../components/TimeRangeSelector", () => ({
  default: ({ maxDays }: { maxDays: number }) => (
    <div data-testid="time-range-selector" data-max-days={maxDays} />
  ),
}));
vi.mock("../../components/SummaryReferenceSidePanel", () => ({
  default: ({ taskId, id }: { taskId: number; id?: string }) => (
    <div id={id} data-testid="reference-side-panel">
      {taskId}
    </div>
  ),
}));
vi.mock("../../components/SummaryReferencePicker", () => ({
  default: ({ visible, onSelect }: any) =>
    visible ? (
      <button
        type="button"
        onClick={() => onSelect({ task_id: 42, title: "Prior summary" })}
      >
        choose-reference
      </button>
    ) : null,
}));
vi.mock("../../pages/SummaryDetailPage", () => ({ default: () => null }));
vi.mock("../../utils/groupSummaryNotify", () => ({
  markAgentSummaryNotificationEligible: mocks.markNotificationEligible,
}));

function scope(
  overrides: Partial<SummaryWorkbenchScope> = {}
): SummaryWorkbenchScope {
  return {
    selectedChannels: [],
    participants: [],
    template: null,
    timeRange: null,
    referencedTaskIds: [],
    ...overrides,
  };
}

function controller(overrides: Record<string, unknown> = {}) {
  const base = {
    sessionId: "session-a",
    scope: scope(),
    model: {
      layout: "full",
      scopeVersion: 1,
      contextItems: [],
      messages: [] as Array<Record<string, unknown>>,
      currentPreview: null,
      pendingProposal: null,
      workflow: null,
      composer: { value: "", isSending: false },
    },
    viewState: {
      layout: "full",
      messages: [] as Array<Record<string, unknown>>,
      contextItems: [],
      inputValue: "",
      placeholderKey: "summary.workbench.placeholder.initial",
      isSending: false,
      canSend: false,
    },
    progressEvents: [],
    latestProgress: null,
    isHydrating: false,
    isConfirming: false,
    isSaving: false,
    error: null,
    savedSummary: null,
    setComposerValue: vi.fn(),
    restoreComposerValue: vi.fn(),
    updateScope: vi.fn(),
    send: vi.fn(),
    confirmWorkflow: vi.fn(),
    savePreview: vi.fn(),
    hydrateSession: vi.fn(),
    resetSession: vi.fn(),
    cancelActiveRequest: vi.fn(),
    clearError: vi.fn(),
  };
  const modelOverrides =
    (overrides.model as Record<string, unknown> | undefined) ?? {};
  const currentPreview = modelOverrides.currentPreview
    ? {
        messageId: "preview-message",
        resultType: "agent_preview",
        scopeVersion: 1,
        version: 1,
        snapshotVersion: 1,
        content: "",
        assumptions: [],
        availableActions: ["save_preview"],
        ...(modelOverrides.currentPreview as Record<string, unknown>),
      }
    : modelOverrides.currentPreview;
  const pendingProposal = modelOverrides.pendingProposal
    ? {
        messageId: "proposal-message",
        resultType: "workflow_confirmation",
        scopeVersion: 1,
        proposalVersion: 1,
        proposalToken: "proposal-token",
        participantNames: [],
        requirement: "",
        availableActions: ["confirm_workflow"],
        ...(modelOverrides.pendingProposal as Record<string, unknown>),
      }
    : modelOverrides.pendingProposal;
  const messages =
    (modelOverrides.messages as unknown[] | undefined) ?? base.model.messages;
  return {
    ...base,
    ...overrides,
    model: {
      ...base.model,
      ...modelOverrides,
      messages,
      ...(currentPreview !== undefined ? { currentPreview } : {}),
      ...(pendingProposal !== undefined ? { pendingProposal } : {}),
    },
    viewState: {
      ...base.viewState,
      ...((overrides.viewState as Record<string, unknown> | undefined) ?? {}),
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("SummaryWorkbenchFeature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.loadParticipantCandidates.mockResolvedValue({
      members: [{ uid: "user-a", name: "Alex" }],
      roles: new Map(),
    });
  });

  it("sends the standard personal intent for chat plus template", async () => {
    const send = vi.fn().mockResolvedValue({
      resultType: "workflow_completed",
      workflow: { taskId: 101, taskTitle: "Weekly update" },
    });
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        scope: scope({
          selectedChannels: [
            {
              chatId: "chat-a",
              chatType: "group",
              name: "Product",
            },
          ],
          template: {
            templateId: "weekly",
            label: "Weekly",
            requirement: "Summarize progress",
          },
        }),
        send,
      })
    );

    render(
      <SummaryWorkbenchFeature spaceId="space-a" source="summary_home" />,
      {
        legacyRoot: true,
      }
    );
    expect(screen.getByTestId("workbench-ui").dataset.canSend).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith("personal-intent", "system_intent")
    );
    expect(mocks.markNotificationEligible).toHaveBeenCalledWith(101);
    expect(mocks.busEmit).toHaveBeenCalledWith(
      "summary-list-refresh-requested"
    );
  });

  it("keeps templates expanded inline and fills an empty composer on selection", () => {
    const current = controller();
    mocks.useSummaryWorkbench.mockReturnValue(current);

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });

    expect(screen.getByTestId("template-selector")).toHaveAttribute(
      "data-inline",
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: "choose-template" }));

    expect(current.updateScope).toHaveBeenCalledWith(
      expect.objectContaining({
        template: expect.objectContaining({ templateId: "weekly" }),
      })
    );
    expect(current.setComposerValue).toHaveBeenCalledWith(
      "Summarize progress and risks"
    );
    expect(screen.getByTestId("template-selector")).toBeInTheDocument();
  });

  it("clears the selected template when its generated text is deleted", () => {
    const current = controller({
      scope: scope({
        template: {
          templateId: "weekly",
          label: "Weekly",
          requirement: "Summarize progress and risks",
        },
      }),
      viewState: {
        layout: "full",
        messages: [],
        contextItems: [],
        inputValue: "Summarize progress and risks",
        placeholderKey: "summary.workbench.placeholder.initial",
        isSending: false,
        canSend: true,
      },
    });
    mocks.useSummaryWorkbench.mockReturnValue(current);

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "choose-template" }));
    fireEvent.change(screen.getByRole("textbox", { name: "summary-request" }), {
      target: { value: "" },
    });

    expect(current.setComposerValue).toHaveBeenCalledWith("");
    expect(current.updateScope).toHaveBeenLastCalledWith(
      expect.objectContaining({ template: null })
    );
  });

  it("keeps the selected template when clearing the composer after generation", async () => {
    const current = controller({
      scope: scope({
        selectedChannels: [
          { chatId: "chat-a", chatType: "group", name: "Product" },
        ],
        template: {
          templateId: "weekly",
          label: "Weekly",
          requirement: "Summarize progress and risks",
        },
      }),
      viewState: {
        layout: "full",
        messages: [],
        contextItems: [],
        inputValue: "Summarize progress and risks",
        placeholderKey: "summary.workbench.placeholder.initial",
        isSending: false,
        canSend: true,
      },
      send: vi.fn().mockResolvedValue({
        resultType: "agent_preview",
        preview: { version: 1, content: "# Preview", assumptions: [] },
      }),
    });
    mocks.useSummaryWorkbench.mockReturnValue(current);

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    await waitFor(() => expect(current.send).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByRole("textbox", { name: "summary-request" }), {
      target: { value: "" },
    });

    expect(current.setComposerValue).toHaveBeenCalledWith("");
    expect(current.updateScope).not.toHaveBeenCalled();
  });

  it.each(["agent_preview", "clarification"])("clears the composer and locks templates after an accepted %s turn", async (resultType) => {
    const pendingResponse = deferred<any>();
    const current = controller({
      scope: scope({
        template: {
          templateId: "weekly",
          label: "Weekly",
          requirement: "Summarize progress and risks",
        },
      }),
      viewState: {
        layout: "full",
        messages: [],
        contextItems: [{ id: "weekly", kind: "template", label: "Weekly" }],
        inputValue: "Summarize the launch risks",
        placeholderKey: "summary.workbench.placeholder.initial",
        isSending: false,
        canSend: true,
      },
      send: vi.fn(() => pendingResponse.promise),
    });
    current.setComposerValue = vi.fn((value: string) => {
      current.viewState.inputValue = value;
    });
    current.restoreComposerValue = vi.fn((value: string) => {
      current.viewState.inputValue = value;
    });
    mocks.useSummaryWorkbench.mockReturnValue(current);

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    expect(current.restoreComposerValue).toHaveBeenCalledWith("");
    expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
      "data-can-send",
      "false"
    );
    expect(screen.queryByTestId("template-selector")).not.toBeInTheDocument();

    pendingResponse.resolve({
      resultType,
      ...(resultType === "agent_preview" ? { preview: { content: "Draft" } } : {}),
    });
    await waitFor(() => expect(current.send).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: "open-template" })
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("template-selector")).not.toBeInTheDocument();
    expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
      "data-template-locked",
      "true"
    );

    fireEvent.click(screen.getByRole("button", { name: "remove-template" }));
    expect(current.updateScope).not.toHaveBeenCalled();
  });

  it.each([
    ["agent_preview", "agent_preview"],
    ["clarification", "clarification"],
    ["assistant turn without a result type", undefined],
  ] as const)("keeps templates locked after restoring an accepted %s", async (_caseName, resultType) => {
    localStorage.setItem(
      "summary-workbench-session:v2:test-uid:space-a:global",
      "restored-session"
    );
    const current = controller({ isHydrating: true });
    mocks.useSummaryWorkbench.mockImplementation(() => current);

    const view = render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    expect(screen.getByTestId("template-selector")).toBeInTheDocument();

    current.isHydrating = false;
    current.viewState.messages = [
      {
        id: "message-a",
        role: "assistant",
        content: "Restored response",
        ...(resultType === undefined ? {} : { resultType }),
      },
    ];
    view.rerender(<SummaryWorkbenchFeature spaceId="space-a" />);

    await waitFor(() =>
      expect(screen.queryByTestId("template-selector")).not.toBeInTheDocument()
    );
    expect(
      screen.queryByRole("button", { name: "open-template" })
    ).not.toBeInTheDocument();
  });

  it.each([
    ["a lone user message", { id: "message-a", role: "user", content: "Draft request" }],
    [
      "an error-only assistant response",
      {
        id: "message-a",
        role: "assistant",
        content: "Request failed",
        resultType: "error",
      },
    ],
  ])("keeps templates available after restoring %s", async (_caseName, message) => {
    localStorage.setItem(
      "summary-workbench-session:v2:test-uid:space-a:global",
      "restored-session"
    );
    const current = controller({ isHydrating: true });
    mocks.useSummaryWorkbench.mockImplementation(() => current);

    const view = render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });

    current.isHydrating = false;
    current.viewState.messages = [message];
    view.rerender(<SummaryWorkbenchFeature spaceId="space-a" />);

    await waitFor(() =>
      expect(screen.getByTestId("template-selector")).toBeInTheDocument()
    );
    expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
      "data-template-locked",
      "false"
    );
  });

  it("does not allow reopening templates after the first turn", async () => {
    const current = controller({
      viewState: {
        layout: "full",
        messages: [],
        contextItems: [],
        inputValue: "Initial request",
        placeholderKey: "summary.workbench.placeholder.initial",
        isSending: false,
        canSend: true,
      },
      send: vi.fn().mockResolvedValue({
        resultType: "agent_preview",
        preview: { content: "Draft" },
      }),
    });
    current.updateScope = vi.fn((nextScope: SummaryWorkbenchScope) => {
      current.scope = nextScope;
      return true;
    });
    current.setComposerValue = vi.fn((value: string) => {
      current.viewState.inputValue = value;
    });
    current.restoreComposerValue = vi.fn((value: string) => {
      current.viewState.inputValue = value;
    });
    mocks.useSummaryWorkbench.mockImplementation(() => current);

    const view = render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    await waitFor(() => expect(current.send).toHaveBeenCalledTimes(1));
    view.rerender(<SummaryWorkbenchFeature spaceId="space-a" />);

    expect(
      screen.queryByRole("button", { name: "open-template" })
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("template-selector")).not.toBeInTheDocument();
  });

  it("warns before a scope edit makes an unsaved preview historical", () => {
    let confirmOptions: { onOk?: () => void } | undefined;
    mocks.modalConfirm.mockImplementationOnce((options) => {
      confirmOptions = options;
    });
    const current = controller({
      scope: scope({
        selectedChannels: [
          { chatId: "chat-a", chatType: "group", name: "Product" },
        ],
      }),
      model: {
        messages: [
          {
            id: "preview-message",
            role: "assistant",
            content: "# Draft",
            resultType: "agent_preview",
            scopeVersion: 1,
            availableActions: ["save_preview"],
          },
        ],
        currentPreview: { content: "# Draft" },
      },
      viewState: {
        layout: "full",
        messages: [],
        contextItems: [{ id: "chat-a", kind: "chat", label: "Product" }],
        inputValue: "",
        placeholderKey: "summary.workbench.placeholder.followUp",
        isSending: false,
        canSend: false,
        card: {
          isStale: false,
          actions: ["save_preview"],
        },
      },
    });
    mocks.useSummaryWorkbench.mockReturnValue(current);

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "remove-chat" }));

    expect(mocks.modalConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "summary.workbench.scopeChange.title",
        content: "summary.workbench.scopeChange.content",
      })
    );
    expect(current.updateScope).not.toHaveBeenCalled();

    confirmOptions?.onOk?.();
    expect(current.updateScope).toHaveBeenCalledWith(
      expect.objectContaining({ selectedChannels: [] })
    );
  });

  it("warns before a scope edit invalidates a team proposal", () => {
    const current = controller({
      scope: scope({
        selectedChannels: [
          { chatId: "chat-a", chatType: "group", name: "Product" },
        ],
      }),
      model: {
        messages: [
          {
            id: "proposal-message",
            role: "assistant",
            content: "请确认协作",
            resultType: "workflow_confirmation",
            scopeVersion: 1,
            availableActions: ["confirm_workflow"],
          },
        ],
        pendingProposal: {},
      },
      viewState: {
        layout: "full",
        messages: [],
        contextItems: [{ id: "chat-a", kind: "chat", label: "Product" }],
        inputValue: "",
        placeholderKey: "summary.workbench.placeholder.teamConfirmation",
        isSending: false,
        canSend: false,
        card: {
          kind: "team_confirmation",
          isStale: false,
          actions: ["confirm_workflow", "continue_chat"],
        },
      },
    });
    mocks.useSummaryWorkbench.mockReturnValue(current);

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "remove-chat" }));

    expect(mocks.modalConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "summary.workbench.scopeChange.proposalContent",
      })
    );
    expect(current.updateScope).not.toHaveBeenCalled();
  });

  it("explains when participant pruning invalidates an active artifact", async () => {
    mocks.loadParticipantCandidates.mockResolvedValueOnce({
      members: [],
      roles: new Map(),
    });
    const current = controller({
      scope: scope({
        selectedChannels: [
          { chatId: "chat-a", chatType: "group", name: "Product" },
        ],
        participants: [{ userId: "user-a", userName: "Alex" }],
      }),
      viewState: {
        layout: "full",
        messages: [],
        contextItems: [],
        inputValue: "",
        placeholderKey: "summary.workbench.placeholder.followUp",
        isSending: false,
        canSend: false,
        card: {
          kind: "agent_preview",
          isStale: false,
          actions: ["save_preview", "continue_chat"],
        },
      },
    });
    mocks.useSummaryWorkbench.mockReturnValue(current);

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });

    await waitFor(() =>
      expect(mocks.toastWarning).toHaveBeenCalledWith(
        "summary.workbench.notice.participantsPrunedArtifactInvalidated"
      )
    );
    expect(current.updateScope).toHaveBeenCalledWith(
      expect.objectContaining({ participants: [] })
    );
  });

  it("loads candidates after hydration restores a participant-only scope", async () => {
    const current = controller({
      isHydrating: true,
      viewState: {
        layout: "full",
        messages: [],
        contextItems: [],
        inputValue: "Summarize the participant updates",
        placeholderKey: "summary.workbench.placeholder.initial",
        isSending: false,
        canSend: false,
      },
    });
    mocks.useSummaryWorkbench.mockImplementation(() => current);

    const { rerender } = render(
      <SummaryWorkbenchFeature spaceId="space-a" />,
      { legacyRoot: true }
    );
    expect(mocks.loadParticipantCandidates).not.toHaveBeenCalled();

    current.scope = scope({
      participants: [{ userId: "user-a", userName: "Alex" }],
    });
    current.isHydrating = false;
    rerender(<SummaryWorkbenchFeature spaceId="space-a" />);

    await waitFor(() =>
      expect(mocks.loadParticipantCandidates).toHaveBeenCalledTimes(1)
    );
    await waitFor(() =>
      expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
        "data-can-send",
        "true"
      )
    );
  });

  it("surfaces participant candidate load failures in the main workbench", async () => {
    mocks.loadParticipantCandidates.mockRejectedValueOnce(
      new Error("member sync failed")
    );
    const current = controller({
      scope: scope({
        participants: [{ userId: "user-a", userName: "Alex" }],
      }),
      viewState: {
        layout: "full",
        messages: [],
        contextItems: [],
        inputValue: "Summarize updates",
        placeholderKey: "summary.workbench.placeholder.initial",
        isSending: false,
        canSend: false,
        errorMessage: "",
      },
    });
    mocks.useSummaryWorkbench.mockReturnValue(current);

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });

    await waitFor(() =>
      expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
        "data-error-message",
        "summary.workbench.notice.participantCandidatesLoadFailed"
      )
    );
    expect(screen.getByTestId("workbench-ui")).toHaveAttribute("data-can-send", "false");
  });

  it("explains why participants cannot be used with the selected chats", () => {
    const invalidScope = adaptSummaryWorkspaceHistory({
      contract_version: "2",
      session_id: "session-invalid-participant-scope",
      messages: [],
      state: {
        scope_version: 1,
        summary_context: {
          selected_channels: [
            { chat_id: "direct-a", chat_type: "direct", name: "Alex" },
          ],
          participants: [{ user_id: "user-a", user_name: "Alex" }],
          referenced_task_ids: [],
        },
      },
    }).scope;
    const current = controller({
      scope: invalidScope,
      viewState: {
        layout: "full",
        messages: [],
        contextItems: [],
        inputValue: "Summarize updates",
        placeholderKey: "summary.workbench.placeholder.initial",
        isSending: false,
        canSend: false,
      },
    });
    mocks.useSummaryWorkbench.mockReturnValue(current);

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });

    expect(invalidScope.participants).toEqual([
      { userId: "user-a", userName: "Alex" },
    ]);
    expect(mocks.loadParticipantCandidates).not.toHaveBeenCalled();
    expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
      "data-error-message",
      "summary.workbench.notice.participantsUnsupportedForSelectedChats"
    );
    expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
      "data-can-send",
      "false"
    );
  });

  it("does not reload ready participant candidates when the first participant is selected", async () => {
    const current = controller({
      viewState: {
        layout: "full",
        messages: [],
        contextItems: [],
        inputValue: "Summarize updates",
        placeholderKey: "summary.workbench.placeholder.initial",
        isSending: false,
        canSend: false,
      },
    });
    mocks.useSummaryWorkbench.mockImplementation(() => current);

    const { rerender } = render(
      <SummaryWorkbenchFeature spaceId="space-a" />,
      { legacyRoot: true }
    );
    fireEvent.click(screen.getByRole("button", { name: "open-participant" }));
    await waitFor(() =>
      expect(mocks.loadParticipantCandidates).toHaveBeenCalledTimes(1)
    );

    current.scope = scope({
      participants: [{ userId: "user-a", userName: "Alex" }],
    });
    rerender(<SummaryWorkbenchFeature spaceId="space-a" />);

    await waitFor(() =>
      expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
        "data-can-send",
        "true"
      )
    );
    expect(mocks.loadParticipantCandidates).toHaveBeenCalledTimes(1);
  });

  it("defers participant pruning until an in-flight save settles", async () => {
    const candidateLoad = deferred<{
      members: WorkbenchMemberCandidate[];
      roles: Map<string, number>;
    }>();
    mocks.loadParticipantCandidates.mockReturnValueOnce(candidateLoad.promise);
    let current = controller({
      scope: scope({
        selectedChannels: [
          { chatId: "chat-a", chatType: "group", name: "Product" },
        ],
        participants: [{ userId: "user-a", userName: "Alex" }],
      }),
    });
    mocks.useSummaryWorkbench.mockImplementation(() => current);

    const { rerender } = render(
      <SummaryWorkbenchFeature spaceId="space-a" />,
      { legacyRoot: true }
    );
    await waitFor(() =>
      expect(mocks.loadParticipantCandidates).toHaveBeenCalledTimes(1)
    );

    current = { ...current, isSaving: true };
    rerender(<SummaryWorkbenchFeature spaceId="space-a" />);
    candidateLoad.resolve({ members: [], roles: new Map() });
    await waitFor(() =>
      expect(screen.getByTestId("workbench-ui")).toBeInTheDocument()
    );
    expect(current.updateScope).not.toHaveBeenCalled();

    current = { ...current, isSaving: false };
    rerender(<SummaryWorkbenchFeature spaceId="space-a" />);
    await waitFor(() =>
      expect(current.updateScope).toHaveBeenCalledWith(
        expect.objectContaining({ participants: [] })
      )
    );
  });

  it("keeps the composer and templates when the request is not accepted", async () => {
    const pendingResponse = deferred<undefined>();
    const current = controller({
      viewState: {
        layout: "full",
        messages: [],
        contextItems: [],
        inputValue: "Keep this request",
        placeholderKey: "summary.workbench.placeholder.initial",
        isSending: false,
        canSend: true,
      },
      send: vi.fn(() => pendingResponse.promise),
    });
    current.setComposerValue = vi.fn((value: string) => {
      current.viewState.inputValue = value;
    });
    current.restoreComposerValue = vi.fn((value: string) => {
      current.viewState.inputValue = value;
    });
    mocks.useSummaryWorkbench.mockReturnValue(current);

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    expect(current.restoreComposerValue).toHaveBeenCalledWith("");
    expect(screen.queryByTestId("template-selector")).not.toBeInTheDocument();

    pendingResponse.resolve(undefined);
    await waitFor(() =>
      expect(current.restoreComposerValue).toHaveBeenCalledWith(
        "Keep this request"
      )
    );
    await waitFor(() =>
      expect(screen.getByTestId("template-selector")).toBeInTheDocument()
    );
    expect(
      screen.queryByRole("button", { name: "open-template" })
    ).not.toBeInTheDocument();
  });

  it("restores the template gallery when starting a new session", async () => {
    const current = controller({
      viewState: {
        layout: "full",
        messages: [],
        contextItems: [],
        inputValue: "Create a draft",
        placeholderKey: "summary.workbench.placeholder.initial",
        isSending: false,
        canSend: true,
      },
      send: vi.fn().mockResolvedValue({
        resultType: "agent_preview",
        preview: { content: "Draft" },
      }),
    });
    mocks.useSummaryWorkbench.mockReturnValue(current);

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    await waitFor(() =>
      expect(screen.queryByTestId("template-selector")).not.toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: "new-session" }));
    expect(current.resetSession).toHaveBeenCalledWith({ scope: scope() });
    expect(screen.getByTestId("template-selector")).toBeInTheDocument();
  });

  it("confirms before replacing manually entered text with a template", () => {
    const current = controller({
      viewState: {
        layout: "full",
        messages: [],
        contextItems: [],
        inputValue: "Keep my custom requirement",
        placeholderKey: "summary.workbench.placeholder.initial",
        isSending: false,
        canSend: true,
      },
    });
    mocks.useSummaryWorkbench.mockReturnValue(current);

    render(<SummaryWorkbenchFeature spaceId="space-a" directTeamWorkflow />, {
      legacyRoot: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "choose-template" }));

    expect(current.updateScope).not.toHaveBeenCalled();
    expect(current.setComposerValue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "modal-ok" }));
    expect(current.updateScope).toHaveBeenCalledTimes(1);
    expect(current.setComposerValue).toHaveBeenCalledWith(
      "Summarize progress and risks"
    );
  });

  it("dismisses a pending template replacement when the restored conversation locks templates", async () => {
    const current = controller({
      viewState: {
        layout: "full",
        messages: [],
        contextItems: [],
        inputValue: "Keep my custom requirement",
        placeholderKey: "summary.workbench.placeholder.initial",
        isSending: false,
        canSend: true,
      },
    });
    mocks.useSummaryWorkbench.mockImplementation(() => current);

    const view = render(
      <SummaryWorkbenchFeature spaceId="space-a" directTeamWorkflow />,
      { legacyRoot: true }
    );
    fireEvent.click(screen.getByRole("button", { name: "choose-template" }));
    expect(screen.getByRole("button", { name: "modal-ok" })).toBeInTheDocument();

    current.viewState.messages = [
      { id: "message-a", role: "assistant", content: "Restored response" },
    ];
    view.rerender(
      <SummaryWorkbenchFeature spaceId="space-a" directTeamWorkflow />
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "modal-ok" })
      ).not.toBeInTheDocument()
    );
    expect(current.updateScope).not.toHaveBeenCalled();
    expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
      "data-template-locked",
      "true"
    );
  });

  it("uses the backend-advertised time range limit", () => {
    mocks.useSummaryWorkbench.mockReturnValue(controller());

    render(
      <SummaryWorkbenchFeature spaceId="space-a" maxTimeRangeDays={90} />,
      { legacyRoot: true }
    );
    fireEvent.click(screen.getByRole("button", { name: "open-time-range" }));

    expect(screen.getByTestId("time-range-selector")).toHaveAttribute(
      "data-max-days",
      "90"
    );
    expect(screen.getByTestId("time-range-selector").parentElement).toHaveClass(
      "wk-summary-workbench-feature__time-range-panel"
    );
  });

  it("lets a selected chat generate an Agent preview without a template or typed request", async () => {
    const send = vi.fn().mockResolvedValue({
      resultType: "agent_preview",
      preview: { content: "Draft", assumptions: ["最近 7 天"] },
    });
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        scope: scope({
          selectedChannels: [
            {
              chatId: "chat-a",
              chatType: "group",
              name: "Product",
            },
          ],
        }),
        send,
      })
    );

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });

    expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
      "data-can-send",
      "true"
    );
    expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
      "data-send-label",
      "summary.workbench.composer.generate"
    );
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith("personal-intent", "system_intent")
    );
    expect(mocks.markNotificationEligible).not.toHaveBeenCalled();
  });

  it("sends a template-only fallback as an explicit start intent for recent-chat discovery", async () => {
    const send = vi.fn().mockResolvedValue({
      resultType: "agent_preview",
      preview: { content: "Draft", assumptions: ["最近 1 个聊天"] },
    });
    const current = controller({ send });
    current.updateScope = vi.fn((nextScope: SummaryWorkbenchScope) => {
      current.scope = nextScope;
    });
    current.setComposerValue = vi.fn((value: string) => {
      current.viewState.inputValue = value;
    });
    mocks.useSummaryWorkbench.mockReturnValue(current);

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "choose-template" }));

    expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
      "data-can-send",
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith("personal-intent", "system_intent")
    );
  });

  it.each([
    ["participants plus template", []],
    [
      "chat, participants, and template",
      [{ chatId: "chat-a", chatType: "group" as const, name: "Product" }],
    ],
  ])("starts %s with the direct team intent", async (_label, channels) => {
    const send = vi.fn().mockResolvedValue({
      resultType: "workflow_started",
      workflow: { taskId: 202, taskTitle: "Team update" },
    });
    const current = controller({
      scope: scope({
        selectedChannels: channels,
        participants: [{ userId: "user-a", userName: "Alex" }],
      }),
      send,
    });
    current.updateScope = vi.fn((nextScope: SummaryWorkbenchScope) => {
      current.scope = nextScope;
    });
    current.setComposerValue = vi.fn((value: string) => {
      current.viewState.inputValue = value;
    });
    mocks.useSummaryWorkbench.mockReturnValue(current);

    render(<SummaryWorkbenchFeature spaceId="space-a" directTeamWorkflow />, {
      legacyRoot: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "choose-template" }));
    await waitFor(() =>
      expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
        "data-can-send",
        "true"
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        "team-intent",
        "system_intent",
        "start_team_workflow"
      )
    );
    expect(mocks.markNotificationEligible).toHaveBeenCalledWith(202);
  });

  it("keeps the confirmation route when direct team workflow is not advertised", async () => {
    const send = vi.fn().mockResolvedValue({
      resultType: "workflow_confirmation",
    });
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        scope: scope({
          participants: [{ userId: "user-a", userName: "Alex" }],
          template: {
            templateId: "weekly",
            label: "Weekly",
            requirement: "Summarize progress",
          },
        }),
        send,
      })
    );

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    await waitFor(() =>
      expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
        "data-can-send",
        "true"
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith("team-intent", "system_intent")
    );
  });

  it("uses normal chat for follow-up messages after a direct team launch", async () => {
    const send = vi.fn().mockResolvedValue({
      resultType: "workflow_started",
      workflow: { taskId: 204, taskTitle: "Team update" },
    });
    const current = controller({
      scope: scope({
        participants: [{ userId: "user-a", userName: "Alex" }],
      }),
      viewState: {
        layout: "full",
        messages: [],
        contextItems: [],
        inputValue: "Create the team summary",
        placeholderKey: "summary.workbench.placeholder.initial",
        isSending: false,
        canSend: true,
      },
      send,
    });
    mocks.useSummaryWorkbench.mockReturnValue(current);

    const view = render(
      <SummaryWorkbenchFeature spaceId="space-a" directTeamWorkflow />,
      { legacyRoot: true }
    );
    await waitFor(() =>
      expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
        "data-can-send",
        "true"
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));

    current.viewState.inputValue = "Add delivery risks";
    view.rerender(
      <SummaryWorkbenchFeature spaceId="space-a" directTeamWorkflow />
    );
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send).toHaveBeenNthCalledWith(
      1,
      undefined,
      "user",
      "start_team_workflow"
    );
    expect(send).toHaveBeenNthCalledWith(2, undefined, "user");
  });

  it.each([
    ["participants", []],
    [
      "chat and participants",
      [{ chatId: "chat-a", chatType: "group" as const, name: "Product" }],
    ],
  ])("allows %s with a real user request", async (_label, channels) => {
    const send = vi.fn().mockResolvedValue({
      resultType: "workflow_started",
      workflow: { taskId: 203, taskTitle: "Team update" },
    });
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        scope: scope({
          selectedChannels: channels,
          participants: [{ userId: "user-a", userName: "Alex" }],
        }),
        viewState: {
          layout: "full",
          messages: [],
          contextItems: [],
          inputValue: "Focus on launch risks",
          placeholderKey: "summary.workbench.placeholder.initial",
          isSending: false,
          canSend: true,
        },
        send,
      })
    );

    render(<SummaryWorkbenchFeature spaceId="space-a" directTeamWorkflow />, {
      legacyRoot: true,
    });
    await waitFor(() =>
      expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
        "data-can-send",
        "true"
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        undefined,
        "user",
        "start_team_workflow"
      )
    );
  });

  it("disables chat plus participants until a template or user request is added", () => {
    const send = vi.fn().mockResolvedValue({
      resultType: "workflow_started",
      workflow: { taskId: 202 },
    });
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        scope: scope({
          selectedChannels: [
            {
              chatId: "chat-a",
              chatType: "group",
              name: "Product",
            },
          ],
          participants: [{ userId: "user-a", userName: "Alex" }],
        }),
        send,
      })
    );

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
      "data-can-send",
      "false"
    );
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    expect(send).not.toHaveBeenCalled();
    expect(mocks.markNotificationEligible).not.toHaveBeenCalled();
  });

  it("disables a participant-only scope until a template or user request is added", () => {
    const send = vi.fn();
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        scope: scope({
          participants: [{ userId: "user-a", userName: "Alex" }],
        }),
        send,
      })
    );

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });

    expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
      "data-can-send",
      "false"
    );
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    expect(send).not.toHaveBeenCalled();
  });

  it("lets a direct natural-language request route through the Agent", async () => {
    const send = vi.fn().mockResolvedValue({
      resultType: "agent_preview",
      preview: { content: "Draft" },
    });
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        viewState: {
          layout: "full",
          messages: [],
          contextItems: [],
          inputValue: "Summarize the launch risks",
          placeholderKey: "summary.workbench.placeholder.initial",
          isSending: false,
          canSend: true,
        },
        send,
      })
    );

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(send).toHaveBeenCalledWith(undefined, "user"));
    expect(mocks.markNotificationEligible).not.toHaveBeenCalled();
  });

  it("opens the workspace participant roster without selecting a chat", () => {
    mocks.useSummaryWorkbench.mockReturnValue(controller());

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "open-participant" }));

    expect(screen.getByTestId("chat-selector")).toHaveAttribute(
      "data-mode",
      "members"
    );
    expect(screen.getByTestId("chat-selector")).toHaveAttribute(
      "data-channel-id",
      ""
    );
    expect(mocks.toastInfo).not.toHaveBeenCalled();
  });

  it("still rejects participant selection for a direct or ambiguous chat scope", () => {
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        scope: scope({
          selectedChannels: [
            {
              chatId: "direct-a",
              chatType: "direct",
              name: "Alex",
            },
          ],
        }),
      })
    );

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "open-participant" }));

    expect(mocks.toastInfo).toHaveBeenCalledWith(
      "summary.workbench.notice.selectSingleChatForParticipants"
    );
  });

  it.each(["generation", "hydration", "confirmation", "save"] as const)(
    "defensively rejects scope mutations during %s",
    (busyKind) => {
      const current = controller({
        scope: scope({
          selectedChannels: [
            {
              chatId: "chat-a",
              chatType: "group",
              name: "Product",
            },
          ],
        }),
      });
      if (busyKind === "generation") {
        current.viewState = { ...current.viewState, isSending: true };
      } else if (busyKind === "hydration") {
        current.isHydrating = true;
      } else if (busyKind === "confirmation") {
        current.isConfirming = true;
      } else {
        current.isSaving = true;
      }
      mocks.useSummaryWorkbench.mockReturnValue(current);

      render(<SummaryWorkbenchFeature spaceId="space-a" />, {
        legacyRoot: true,
      });
      fireEvent.click(screen.getByRole("button", { name: "open-reference" }));
      fireEvent.click(screen.getByRole("button", { name: "remove-chat" }));

      expect(
        screen.queryByRole("button", { name: "choose-reference" })
      ).not.toBeInTheDocument();
      expect(current.updateScope).not.toHaveBeenCalled();
    }
  );

  it("confirms a team proposal and saves only the current Agent preview", async () => {
    const confirmWorkflow = vi.fn().mockResolvedValue({
      resultType: "workflow_started",
      workflow: { taskId: 202, taskTitle: "Team update" },
    });
    const savePreview = vi
      .fn()
      .mockResolvedValue({ task_id: 303, title: "Draft" });
    const onOpenTask = vi.fn();
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        model: {
          currentPreview: { content: "# Draft\nBody" },
          pendingProposal: {},
          workflow: null,
        },
        confirmWorkflow,
        savePreview,
      })
    );

    render(
      <SummaryWorkbenchFeature
        spaceId="space-a"
        embedded
        onOpenTask={onOpenTask}
      />,
      { legacyRoot: true }
    );
    fireEvent.click(screen.getByRole("button", { name: "confirm-workflow" }));
    await waitFor(() => expect(confirmWorkflow).toHaveBeenCalledTimes(1));
    expect(mocks.markNotificationEligible).toHaveBeenCalledWith(202);

    fireEvent.click(screen.getByRole("button", { name: "save-preview" }));
    fireEvent.click(screen.getByRole("button", { name: "modal-ok" }));
    await waitFor(() => expect(savePreview).toHaveBeenCalledWith("# Draft"));
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "summary.create.agentSummaryCreated"
    );
    expect(mocks.toastWarning).not.toHaveBeenCalled();
    expect(mocks.markNotificationEligible).toHaveBeenCalledWith(303);
    expect(onOpenTask).toHaveBeenCalledWith(303);
  });

  it.each(["PARTIAL", "FAILED"] as const)(
    "keeps save success for a created task with an internal %s quality verdict (owner-confirmed P1 policy)",
    async (finishStatus) => {
      const savePreview = vi.fn().mockResolvedValue({
        task_id: 304,
        title: "Draft",
        finish_status: finishStatus,
        gaps: [
          { kind: "citation", detail: "引用完整性校验失败" },
          { kind: "coverage", detail: "一个频道未覆盖" },
        ],
      });
      const onOpenTask = vi.fn();
      mocks.useSummaryWorkbench.mockReturnValue(
        controller({
          model: {
            currentPreview: { content: "# Draft\nBody" },
            pendingProposal: null,
            workflow: null,
          },
          savePreview,
        })
      );

      render(
        <SummaryWorkbenchFeature
          spaceId="space-a"
          embedded
          onOpenTask={onOpenTask}
        />,
        { legacyRoot: true }
      );
      fireEvent.click(screen.getByRole("button", { name: "save-preview" }));
      fireEvent.click(screen.getByRole("button", { name: "modal-ok" }));

      await waitFor(() => expect(savePreview).toHaveBeenCalledWith("# Draft"));
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "summary.create.agentSummaryCreated"
      );
      expect(mocks.toastWarning).not.toHaveBeenCalled();
      expect(mocks.track).toHaveBeenCalledWith(
        "smart_summary_quality_gate",
        expect.objectContaining({
          task_id: 304,
          finish_status: finishStatus,
          gap_count: 2,
          first_gap_kind: "citation",
          trigger_mode: "agent",
        })
      );
      expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
      expect(mocks.markNotificationEligible).toHaveBeenCalledWith(304);
      expect(onOpenTask).toHaveBeenCalledWith(304);
    }
  );

  it("keeps save success for a created task when an internal FAILED verdict has no gaps (owner-confirmed P1 policy)", async () => {
    const savePreview = vi.fn().mockResolvedValue({
      task_id: 306,
      title: "Draft",
      finish_status: "FAILED",
      gaps: [],
    });
    const onOpenTask = vi.fn();
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        model: {
          currentPreview: { content: "# Draft\nBody" },
          pendingProposal: null,
          workflow: null,
        },
        savePreview,
      })
    );

    render(
      <SummaryWorkbenchFeature
        spaceId="space-a"
        embedded
        onOpenTask={onOpenTask}
      />,
      { legacyRoot: true }
    );
    fireEvent.click(screen.getByRole("button", { name: "save-preview" }));
    fireEvent.click(screen.getByRole("button", { name: "modal-ok" }));

    await waitFor(() => expect(savePreview).toHaveBeenCalledWith("# Draft"));
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "summary.create.agentSummaryCreated"
    );
    expect(mocks.toastWarning).not.toHaveBeenCalled();
    expect(mocks.track).toHaveBeenCalledWith(
      "smart_summary_quality_gate",
      expect.objectContaining({
        task_id: 306,
        finish_status: "FAILED",
        gap_count: 0,
        trigger_mode: "agent",
      })
    );
    expect(mocks.markNotificationEligible).toHaveBeenCalledWith(306);
    expect(onOpenTask).toHaveBeenCalledWith(306);
  });

  it("tracks an unreported verdict without exposing gap details or changing save success", async () => {
    const savePreview = vi.fn().mockResolvedValue({
      task_id: 308,
      title: "Draft",
      gaps: [{ kind: "citation", detail: "private diagnostic detail" }],
    });
    const onOpenTask = vi.fn();
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        model: {
          currentPreview: { content: "# Draft\nBody" },
          pendingProposal: null,
          workflow: null,
        },
        savePreview,
      })
    );
    render(
      <SummaryWorkbenchFeature spaceId="space-a" embedded onOpenTask={onOpenTask} />,
      { legacyRoot: true }
    );
    fireEvent.click(screen.getByRole("button", { name: "save-preview" }));
    fireEvent.click(screen.getByRole("button", { name: "modal-ok" }));
    await waitFor(() => expect(onOpenTask).toHaveBeenCalledWith(308));
    const events = mocks.track.mock.calls.filter(
      (call: unknown[]) => call[0] === "smart_summary_quality_gate"
    );
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({
      task_id: 308,
      finish_status: "unreported",
      gap_count: 1,
      first_gap_kind: "citation",
    });
    expect(JSON.stringify(events[0][1])).not.toContain("private diagnostic detail");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("summary.create.agentSummaryCreated");
    expect(mocks.toastWarning).not.toHaveBeenCalled();
    expect(mocks.markNotificationEligible).toHaveBeenCalledWith(308);
  });

  it("keeps the ordinary success feedback for a COMPLETE save", async () => {
    const savePreview = vi.fn().mockResolvedValue({
      task_id: 305,
      title: "Draft",
      finish_status: "COMPLETE",
      gaps: [],
    });
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        model: {
          currentPreview: { content: "# Draft\nBody" },
          pendingProposal: null,
          workflow: null,
        },
        savePreview,
      })
    );

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "save-preview" }));
    fireEvent.click(screen.getByRole("button", { name: "modal-ok" }));

    await waitFor(() => expect(savePreview).toHaveBeenCalledWith("# Draft"));
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "summary.create.agentSummaryCreated"
    );
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });

  it("carries channelID, bounds unknown gap kinds, and never uploads gap.detail (PR #1637 P2)", async () => {
    // Two assertions in one test:
    //   1. The workbench save path must include `object_id: channel.channelID`
    //      so the event can be joined at the envelope level, matching the
    //      sibling emission from pages/SummaryCreatePage.tsx.
    //   2. `gap.detail` must never reach the diagnostics payload — the
    //      contract in types/summary.ts says gap detail is not uploaded, and
    //      `PROP_KEY_BLACKLIST` does not include a "detail" alias, so this
    //      needs an explicit negative assertion.
    const savePreview = vi.fn().mockResolvedValue({
      task_id: 307,
      title: "Draft",
      finish_status: "PARTIAL",
      gaps: [
        {
          kind: "customer-email@example.com",
          detail: "secret gap detail — do not upload",
        },
      ],
    });
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        model: {
          currentPreview: { content: "# Draft\nBody" },
          pendingProposal: null,
          workflow: null,
        },
        savePreview,
      })
    );

    render(
      <SummaryWorkbenchFeature
        spaceId="space-a"
        channel={{ channelID: "channel-42", channelType: 1 }}
      />,
      { legacyRoot: true }
    );
    fireEvent.click(screen.getByRole("button", { name: "save-preview" }));
    fireEvent.click(screen.getByRole("button", { name: "modal-ok" }));

    await waitFor(() => expect(savePreview).toHaveBeenCalledWith("# Draft"));
    expect(mocks.track).toHaveBeenCalledWith(
      "smart_summary_quality_gate",
      expect.objectContaining({
        object_id: "channel-42",
        task_id: 307,
        finish_status: "PARTIAL",
        gap_count: 1,
        first_gap_kind: "other",
      })
    );
    // Negative assertion: no field carrying the raw gap detail leaks through.
    const trackCall = mocks.track.mock.calls.find(
      (call: unknown[]) => call[0] === "smart_summary_quality_gate"
    );
    expect(trackCall?.[1]).not.toHaveProperty("first_gap_detail");
    expect(trackCall?.[1]).not.toHaveProperty("gap_detail");
    expect(JSON.stringify(trackCall?.[1])).not.toContain("secret gap detail");
    expect(JSON.stringify(trackCall?.[1])).not.toContain(
      "customer-email@example.com"
    );
  });

  it("handles the same recovered save result only once", async () => {
    const savePreview = vi.fn().mockResolvedValue({
      task_id: 306,
      task_no: "SUM-306",
      status: 3,
      created_at: "2026-08-27T08:00:00Z",
    });
    const onOpenTask = vi.fn();
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        model: {
          currentPreview: { content: "# Draft\nBody" },
          pendingProposal: null,
          workflow: null,
        },
        savePreview,
      })
    );

    render(
      <SummaryWorkbenchFeature
        spaceId="space-a"
        embedded
        onOpenTask={onOpenTask}
      />,
      { legacyRoot: true }
    );
    fireEvent.click(screen.getByRole("button", { name: "save-preview" }));
    const ok = screen.getByRole("button", { name: "modal-ok" });
    fireEvent.click(ok);
    fireEvent.click(ok);

    await waitFor(() => expect(savePreview).toHaveBeenCalledTimes(2));
    expect(mocks.markNotificationEligible).toHaveBeenCalledTimes(1);
    expect(onOpenTask).toHaveBeenCalledTimes(1);
  });

  it("shows an ordinary save failure inside the save dialog", () => {
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        model: {
          messages: [],
          currentPreview: { content: "# Draft\nBody" },
          pendingProposal: null,
          workflow: null,
        },
        error: new Error("保存失败，请重试"),
        viewState: {
          layout: "full",
          messages: [],
          contextItems: [],
          inputValue: "",
          placeholderKey: "summary.workbench.placeholder.initial",
          isSending: false,
          canSend: false,
          errorMessage: "保存失败，请重试",
        },
      })
    );

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "save-preview" }));

    expect(screen.getByText("保存失败，请重试")).toBeInTheDocument();
  });

  it("hides a raw server save failure inside the save dialog", () => {
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        model: {
          messages: [],
          currentPreview: { content: "# Draft\nBody" },
          pendingProposal: null,
          workflow: null,
        },
        error: {
          message: "upstream gateway secret detail",
          httpStatus: 500,
          kind: "server",
        },
      })
    );

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "save-preview" }));

    expect(
      screen.getByText("summary.workbench.errors.serviceUnavailable")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("upstream gateway secret detail")
    ).not.toBeInTheDocument();
  });

  it.each([true, false])("opens a completed Workflow task through the host callback (embedded=%s)", (embedded) => {
    const onOpenTask = vi.fn();
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        model: {
          currentPreview: null,
          pendingProposal: null,
          workflow: { taskId: 404 },
        },
      })
    );

    render(
      <SummaryWorkbenchFeature
        spaceId="space-a"
        embedded={embedded}
        onOpenTask={onOpenTask}
      />,
      { legacyRoot: true }
    );
    fireEvent.click(screen.getByRole("button", { name: "view-summary" }));

    expect(onOpenTask).toHaveBeenCalledWith(404);
    expect(mocks.routePush).not.toHaveBeenCalled();
  });

  it("restores the scoped session and updates references", () => {
    localStorage.setItem(
      "summary-workbench-session:v2:test-uid:space-a:global",
      "restored-session"
    );
    const updateScope = vi.fn();
    mocks.useSummaryWorkbench.mockReturnValue(controller({ updateScope }));

    render(<SummaryWorkbenchFeature spaceId="space-a" />, { legacyRoot: true });

    expect(mocks.useSummaryWorkbench).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: "space-a",
        initialSessionId: "restored-session",
        autoHydrate: true,
      })
    );
    expect(screen.getByTestId("template-selector")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "open-reference" }));
    fireEvent.click(screen.getByRole("button", { name: "choose-reference" }));
    expect(updateScope).toHaveBeenCalledWith(
      expect.objectContaining({ referencedTaskIds: [42] })
    );
  });

  it("persists a generated session only after the hook reports a server-backed id", () => {
    mocks.useSummaryWorkbench.mockReturnValue(controller());
    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });

    const key = "summary-workbench-session:v2:test-uid:space-a:global";
    expect(localStorage.getItem(key)).toBeNull();
    const options = mocks.useSummaryWorkbench.mock.calls.at(-1)?.[0] as {
      onSessionIdChange: (sessionId: string) => void;
    };
    options.onSessionIdChange("server-session");
    expect(localStorage.getItem(key)).toBe("server-session");
    options.onSessionIdChange("");
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("isolates a referenced-task session from the ordinary new-entry session", () => {
    const ordinaryKey = "summary-workbench-session:v2:test-uid:space-a:global";
    const referencedTaskKey = `${ordinaryKey}:reference:42`;
    localStorage.setItem(ordinaryKey, "ordinary-session");
    localStorage.setItem(referencedTaskKey, "stale-reference-session");
    mocks.useSummaryWorkbench.mockReturnValue(controller());

    const referencedRender = render(
      <SummaryWorkbenchFeature
        spaceId="space-a"
        derivedFromTask={{ task_id: 42, title: "Prior summary" } as any}
      />,
      { legacyRoot: true }
    );

    expect(mocks.useSummaryWorkbench).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialSessionId: "",
        autoHydrate: false,
      })
    );
    expect(localStorage.getItem(ordinaryKey)).toBe("ordinary-session");
    expect(localStorage.getItem(referencedTaskKey)).toBeNull();

    referencedRender.unmount();
    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });

    expect(mocks.useSummaryWorkbench).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialSessionId: "ordinary-session",
        autoHydrate: true,
      })
    );
  });

  it("restores hydrated reference metadata and toggles its preview", async () => {
    mocks.getSummaryDetail.mockResolvedValue({
      task_id: 42,
      title: "Restored summary",
    });
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        scope: scope({ referencedTaskIds: [42] }),
        viewState: {
          layout: "full",
          messages: [],
          contextItems: [{ kind: "reference", id: "42", label: "#42" }],
          inputValue: "",
          placeholderKey: "summary.workbench.placeholder.initial",
          isSending: false,
          canSend: false,
        },
      })
    );

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });

    await waitFor(() =>
      expect(screen.getByTestId("reference-label")).toHaveTextContent(
        "Restored summary"
      )
    );
    expect(mocks.getSummaryDetail).toHaveBeenCalledWith(42);

    fireEvent.click(screen.getByRole("button", { name: "open-reference" }));
    expect(
      screen.queryByRole("button", { name: "choose-reference" })
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("reference-side-panel")).toHaveTextContent("42");
    expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
      "data-reference-preview-open",
      "true"
    );

    fireEvent.click(screen.getByRole("button", { name: "open-reference" }));
    expect(
      screen.queryByTestId("reference-side-panel")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("workbench-ui")).toHaveAttribute(
      "data-reference-preview-open",
      "false"
    );
  });

  it("keeps the reference preview toggle usable while generation is running", async () => {
    mocks.getSummaryDetail.mockResolvedValue({
      task_id: 42,
      title: "Restored summary",
    });
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        scope: scope({ referencedTaskIds: [42] }),
        viewState: {
          layout: "full",
          messages: [],
          contextItems: [{ kind: "reference", id: "42", label: "#42" }],
          inputValue: "",
          placeholderKey: "summary.workbench.placeholder.initial",
          isSending: true,
          canSend: false,
        },
      })
    );

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    await waitFor(() => expect(mocks.getSummaryDetail).toHaveBeenCalledWith(42));

    fireEvent.click(screen.getByRole("button", { name: "open-reference" }));

    expect(screen.getByTestId("reference-side-panel")).toHaveTextContent("42");
  });

  it("assigns a unique preview id to each mounted workbench instance", async () => {
    mocks.getSummaryDetail.mockResolvedValue({
      task_id: 42,
      title: "Restored summary",
    });
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        scope: scope({ referencedTaskIds: [42] }),
        viewState: {
          layout: "full",
          messages: [],
          contextItems: [{ kind: "reference", id: "42", label: "#42" }],
          inputValue: "",
          placeholderKey: "summary.workbench.placeholder.initial",
          isSending: false,
          canSend: false,
        },
      })
    );

    render(
      <>
        <SummaryWorkbenchFeature spaceId="space-a" />
        <SummaryWorkbenchFeature spaceId="space-a" />
      </>,
      { legacyRoot: true }
    );
    await waitFor(() => expect(mocks.getSummaryDetail).toHaveBeenCalledTimes(2));

    screen
      .getAllByRole("button", { name: "open-reference" })
      .forEach((button) => fireEvent.click(button));

    const panelIds = screen
      .getAllByTestId("reference-side-panel")
      .map((panel) => panel.id);
    const triggerIds = screen
      .getAllByTestId("workbench-ui")
      .map((workbench) => workbench.getAttribute("data-reference-preview-id"));
    expect(panelIds.every(Boolean)).toBe(true);
    expect(new Set(panelIds).size).toBe(2);
    expect(triggerIds).toEqual(panelIds);
  });

  it("keeps the hydrated reference id selected when detail loading fails", async () => {
    mocks.getSummaryDetail.mockRejectedValue(new Error("not found"));
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        scope: scope({ referencedTaskIds: [73] }),
        viewState: {
          layout: "full",
          messages: [],
          contextItems: [{ kind: "reference", id: "73", label: "#73" }],
          inputValue: "",
          placeholderKey: "summary.workbench.placeholder.initial",
          isSending: false,
          canSend: false,
        },
      })
    );

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });

    await waitFor(() =>
      expect(mocks.getSummaryDetail).toHaveBeenCalledWith(73)
    );
    expect(screen.getByTestId("reference-label")).toHaveTextContent("#73");

    fireEvent.click(screen.getByRole("button", { name: "open-reference" }));
    expect(
      screen.queryByRole("button", { name: "choose-reference" })
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("reference-side-panel")).toHaveTextContent("73");
  });
});
