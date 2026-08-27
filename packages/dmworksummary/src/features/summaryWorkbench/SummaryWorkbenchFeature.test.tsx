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

vi.mock("../../Service/SummaryWorkbenchService", () => ({
  default: {
    loadReferenceSummary: (...args: unknown[]) =>
      mocks.getSummaryDetail(...args),
  },
}));

vi.mock("../../ui/SummaryWorkbench", () => ({
  default: ({ state, actions }: any) => (
    <div
      data-testid="workbench-ui"
      data-can-send={String(state.canSend)}
      data-send-label={state.sendLabelKey}
    >
      <span data-testid="reference-label">
        {state.contextItems.find((item: any) => item.kind === "reference")
          ?.label ?? ""}
      </span>
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
      <button type="button" onClick={actions.onOpenScheduledSummary}>
        open-schedule
      </button>
    </div>
  ),
}));

vi.mock("../../components/ChatSelectorModal", () => ({
  default: () => null,
}));
vi.mock("../../components/TemplateSelectorModal", () => ({
  default: () => null,
}));
vi.mock("../../components/TimeRangeSelector", () => ({
  default: () => null,
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

describe("SummaryWorkbenchFeature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
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

    await waitFor(() => expect(send).toHaveBeenCalledWith("personal-intent"));
    expect(mocks.markNotificationEligible).toHaveBeenCalledWith(101);
    expect(mocks.busEmit).toHaveBeenCalledWith(
      "summary-list-refresh-requested"
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

    await waitFor(() => expect(send).toHaveBeenCalledWith("personal-intent"));
    expect(mocks.markNotificationEligible).not.toHaveBeenCalled();
  });

  it("sends the standard team intent and waits for confirmation", async () => {
    const send = vi.fn().mockResolvedValue({
      resultType: "workflow_confirmation",
      confirmation: {},
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
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(send).toHaveBeenCalledWith("team-intent"));
    expect(mocks.markNotificationEligible).not.toHaveBeenCalled();
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

    await waitFor(() => expect(send).toHaveBeenCalledWith(undefined));
    expect(mocks.markNotificationEligible).not.toHaveBeenCalled();
  });

  it("requires exactly one group chat before opening participant selection", () => {
    mocks.useSummaryWorkbench.mockReturnValue(
      controller({
        scope: scope({
          selectedChannels: [
            { chatId: "direct-a", chatType: "direct", name: "Alex" },
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
            { chatId: "chat-a", chatType: "group", name: "Product" },
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

  it("restores the scoped session, updates references, and exposes Legacy schedules", () => {
    localStorage.setItem(
      "summary-workbench-session:v1:space-a:global",
      "restored-session"
    );
    const updateScope = vi.fn();
    mocks.useSummaryWorkbench.mockReturnValue(controller({ updateScope }));
    const onOpenScheduledSummary = vi.fn();

    render(
      <SummaryWorkbenchFeature
        spaceId="space-a"
        onOpenScheduledSummary={onOpenScheduledSummary}
      />,
      { legacyRoot: true }
    );

    expect(mocks.useSummaryWorkbench).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSessionId: "restored-session",
        autoHydrate: true,
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "open-reference" }));
    fireEvent.click(screen.getByRole("button", { name: "choose-reference" }));
    expect(updateScope).toHaveBeenCalledWith(
      expect.objectContaining({ referencedTaskIds: [42] })
    );

    fireEvent.click(screen.getByRole("button", { name: "open-schedule" }));
    expect(onOpenScheduledSummary).toHaveBeenCalledTimes(1);
  });

  it("isolates a referenced-task session from the ordinary new-entry session", () => {
    const ordinaryKey = "summary-workbench-session:v1:space-a:global";
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
      expect.objectContaining({ initialSessionId: "", autoHydrate: false })
    );
    expect(localStorage.getItem(ordinaryKey)).toBe("ordinary-session");
    expect(localStorage.getItem(referencedTaskKey)).toBe("session-a");

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
