import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SummaryWorkbenchScope } from "../../bridge/summaryWorkbench/protocol";
import SummaryWorkbenchFeature from "./SummaryWorkbenchFeature";

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
  loadParticipantCandidates: vi.fn(),
}));

vi.mock("@octo/base", () => ({
  Dap: { shared: { track: mocks.track } },
  useI18n: () => ({
    t: (key: string, options?: { values?: Record<string, unknown> }) => {
      if (key === "summary.workbench.notice.savedWithQualityGap") {
        return `quality-warning:${String(options?.values?.detail ?? "")}`;
      }
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
    t: (key: string, options?: { values?: Record<string, unknown> }) => {
      if (key === "summary.workbench.notice.savedWithQualityGap") {
        return `quality-warning:${String(options?.values?.detail ?? "")}`;
      }
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

vi.mock("@douyinfe/semi-ui", () => ({
  Input: ({ value, onChange, showClear: _showClear, ...props }: any) => (
    <input
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      {...props}
    />
  ),
  Modal: ({ visible, children, onOk }: any) =>
    visible ? (
      <div data-testid="modal">
        {children}
        <button type="button" onClick={onOk}>
          modal-ok
        </button>
      </div>
    ) : null,
  Spin: () => <div data-testid="spin" />,
  Toast: {
    info: mocks.toastInfo,
    warning: mocks.toastWarning,
    success: mocks.toastSuccess,
  },
}));

vi.mock("../../bridge/summaryWorkbench/useSummaryWorkbench", () => ({
  default: (...args: unknown[]) => mocks.useSummaryWorkbench(...args),
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
  default: ({ taskId }: { taskId: number }) => (
    <div data-testid="reference-side-panel">{taskId}</div>
  ),
}));
vi.mock("../../components/SummaryReferencePicker", () => ({
  default: ({ visible, onSelect, selectedTaskId }: any) =>
    visible ? (
      <button
        type="button"
        data-selected-task-id={selectedTaskId}
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
  return {
    sessionId: "session-a",
    scope: scope(),
    model: {
      currentPreview: null,
      pendingProposal: null,
      workflow: null,
    },
    viewState: {
      layout: "full",
      messages: [],
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
    ...overrides,
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
    fireEvent.change(screen.getByRole("textbox", { name: "summary-request" }), {
      target: { value: "" },
    });

    expect(current.setComposerValue).toHaveBeenCalledWith("");
    expect(current.updateScope).toHaveBeenLastCalledWith(
      expect.objectContaining({ template: null })
    );
  });

  it("clears the composer and collapses templates as soon as the task starts", async () => {
    const pendingResponse = deferred<any>();
    const current = controller({
      viewState: {
        layout: "full",
        messages: [],
        contextItems: [],
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
      resultType: "agent_preview",
      preview: { content: "Draft" },
    });
    await waitFor(() => expect(current.send).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: "open-template" })
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("template-selector")).not.toBeInTheDocument();
  });

  it("collapses templates after restoring a session that already has messages", async () => {
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
      { id: "message-a", role: "assistant", content: "Restored response" },
    ];
    view.rerender(<SummaryWorkbenchFeature spaceId="space-a" />);

    await waitFor(() =>
      expect(screen.queryByTestId("template-selector")).not.toBeInTheDocument()
    );
    expect(
      screen.queryByRole("button", { name: "open-template" })
    ).not.toBeInTheDocument();
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
    "warns about the first quality gap after a %s save without blocking creation",
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
      expect(mocks.toastWarning).toHaveBeenCalledWith(
        "quality-warning:引用完整性校验失败"
      );
      expect(mocks.toastSuccess).not.toHaveBeenCalled();
      expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
      expect(mocks.markNotificationEligible).toHaveBeenCalledWith(304);
      expect(onOpenTask).toHaveBeenCalledWith(304);
    }
  );

  it(
    "warns generically when a FAILED save carries an EMPTY gaps list (P1-5)",
    async () => {
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
      // The generic quality-gate warning key falls through t() to the key
      // itself in this mock — the assertion is that the user does NOT get
      // the success toast and DOES get a warning.
      expect(mocks.toastWarning).toHaveBeenCalled();
      expect(mocks.toastSuccess).not.toHaveBeenCalled();
      expect(mocks.markNotificationEligible).toHaveBeenCalledWith(306);
      expect(onOpenTask).toHaveBeenCalledWith(306);
    }
  );

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
      <SummaryWorkbenchFeature spaceId="space-a" embedded onOpenTask={onOpenTask} />,
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
          currentPreview: { content: "# Draft\nBody" },
          pendingProposal: null,
          workflow: null,
        },
        error: new Error("保存失败，请重试"),
      })
    );

    render(<SummaryWorkbenchFeature spaceId="space-a" />, {
      legacyRoot: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "save-preview" }));

    expect(screen.getByText("保存失败，请重试")).toBeInTheDocument();
  });

  it("opens a completed Workflow task through the embedded detail callback", () => {
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
        embedded
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

    render(
      <SummaryWorkbenchFeature spaceId="space-a" />,
      { legacyRoot: true }
    );

    expect(mocks.useSummaryWorkbench).toHaveBeenCalledWith(
      expect.objectContaining({
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

  it("restores hydrated reference metadata, picker selection, and preview", async () => {
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
      screen.getByRole("button", { name: "choose-reference" })
    ).toHaveAttribute("data-selected-task-id", "42");
    expect(screen.getByTestId("reference-side-panel")).toHaveTextContent("42");
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
      screen.getByRole("button", { name: "choose-reference" })
    ).toHaveAttribute("data-selected-task-id", "73");
    expect(screen.getByTestId("reference-side-panel")).toHaveTextContent("73");
  });
});
