import React from "react";
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SummaryWorkbench from "./index";
import type {
  SummaryWorkbenchActions,
  SummaryWorkbenchCardView,
  SummaryWorkbenchViewState,
} from "./types";

vi.mock("@octo/base", async () => {
  const ReactRuntime = await import("react");
  const labels: Record<string, string> = {
    "summary.workbench.title": "Summary assistant",
    "summary.workbench.subtitle": "Describe the result you need.",
    "summary.workbench.empty": "Start a conversation.",
    "summary.workbench.context.chat": "Select chats",
    "summary.workbench.context.participant": "Select participants",
    "summary.workbench.context.template": "Template",
    "summary.workbench.context.timeRange": "Time range",
    "summary.workbench.context.reference": "Reference summary",
    "summary.workbench.composer.send": "Send",
    "summary.workbench.message.assistant": "Summary assistant",
    "summary.workbench.message.user": "You",
    "summary.workbench.message.userAvatar": "Me",
    "summary.workbench.message.conversation": "Summary conversation",
    "summary.workbench.actions.newSession": "New session",
    "summary.workbench.loadingHistory": "Restoring session",
    "summary.common.agentChat.viewGenerationProcess": "Generation progress",
    "summary.common.agentChat.progress.understand": "Understanding request",
    "summary.common.agentChat.progress.retrieve": "Reading chats",
    "summary.status.completed": "Completed",
    "summary.status.failed": "Failed",
    "summary.common.agentPanel.processedCount": "Processed 8 items",
    "summary.workbench.card.teamConfirmationTitle": "Confirm collaboration",
    "summary.workbench.card.teamConfirmationBadge": "Team workflow",
    "summary.workbench.card.workflowStartedTitle": "Summary is running",
    "summary.workbench.card.workflowStartedBadge": "Workflow started",
    "summary.workbench.card.workflowCompletedTitle": "Summary generated",
    "summary.workbench.card.workflowCompletedBadge": "Saved",
    "summary.workbench.card.previewTitle": "Preview draft",
    "summary.workbench.card.previewBadge": "Preview",
    "summary.workbench.card.revisionBadge": "Revision",
    "summary.workbench.card.historicalBadge": "Previous version",
    "summary.workbench.card.currentBadge": "Current version",
    "summary.workbench.card.staleBadge": "Outdated",
    "summary.workbench.card.participants": "Participants",
    "summary.workbench.card.template": "Template",
    "summary.workbench.card.timeRange": "Time range",
    "summary.workbench.card.requirement": "Requirement",
    "summary.workbench.card.taskId": "Task ID",
    "summary.workbench.card.assumptions": "Assumptions",
    "summary.workbench.actions.confirmWorkflow": "Confirm workflow",
    "summary.workbench.actions.savePreview": "Save preview",
    "summary.workbench.actions.viewSummary": "View summary",
    "summary.workbench.actions.viewProgress": "View progress",
    "summary.workbench.actions.continueChat": "Continue chat",
    "summary.workbench.placeholder.initial": "Describe a summary",
  };

  return {
    useI18n: () => ({
      t: (key: string, options?: { values?: Record<string, unknown> }) => {
        if (key === "summary.workbench.context.remove") {
          return `Remove ${String(options?.values?.label ?? "")}`;
        }
        if (key === "summary.common.agentPanel.processedCount") {
          return `Processed ${String(options?.values?.count ?? "")} items`;
        }
        return labels[key] ?? key;
      },
    }),
    WKButton: ({
      children,
      loading,
      icon,
      iconOnly: _iconOnly,
      size: _size,
      variant,
      className,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      loading?: boolean;
      icon?: React.ReactNode;
      iconOnly?: boolean;
      size?: string;
      variant?: string;
    }) => (
      <button
        {...props}
        className={[className, variant ? `wk-btn--${variant}` : ""]
          .filter(Boolean)
          .join(" ")}
        disabled={props.disabled || loading}
      >
        {icon}
        {children}
      </button>
    ),
  };
});

afterEach(cleanup);

function createActions(): SummaryWorkbenchActions {
  return {
    onInputChange: vi.fn(),
    onSend: vi.fn(),
    onOpenContext: vi.fn(),
    onRemoveContext: vi.fn(),
    onResultAction: vi.fn(),
  };
}

function createState(
  card?: SummaryWorkbenchCardView
): SummaryWorkbenchViewState {
  return {
    layout: "full",
    messages: [
      {
        id: "m1",
        role: "assistant",
        content: "What should I summarize?",
      },
      { id: "m2", role: "user", content: "Create a weekly update." },
    ],
    contextItems: [
      { id: "chat-1", kind: "chat", label: "Product chat" },
      { id: "person-1", kind: "participant", label: "Alex" },
    ],
    card,
    inputValue: "Focus on risks",
    placeholderKey: "summary.workbench.placeholder.initial",
    isSending: false,
    canSend: true,
  };
}

function renderWorkbench(card?: SummaryWorkbenchCardView) {
  const actions = createActions();
  const result = rtlRender(
    <SummaryWorkbench state={createState(card)} actions={actions} />,
    {
      legacyRoot: true,
    }
  );
  return { ...result, actions };
}

describe("SummaryWorkbench", () => {
  it("renders three scope controls below the textarea and reference in the header", () => {
    const actions = createActions();
    actions.onNewSession = vi.fn();
    const state = createState();
    state.contextItems.push({
      id: "summary-1",
      kind: "reference",
      label: "Last weekly summary",
    });
    const { container } = rtlRender(
      <SummaryWorkbench state={state} actions={actions} />,
      { legacyRoot: true }
    );

    const input = screen.getByRole("textbox");
    const composer = container.querySelector<HTMLElement>(
      ".wk-summary-workbench__composer"
    );
    const composerContexts = container.querySelector<HTMLElement>(
      ".wk-summary-workbench__contexts"
    );
    const headerActions = container.querySelector<HTMLElement>(
      ".wk-summary-workbench__header-actions"
    );
    const contexts = [
      ["Select chats", "chat"],
      ["Select participants", "participant"],
      ["Time range", "time_range"],
    ] as const;

    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(composer).toContainElement(input);
    expect(composer).toContainElement(screen.getByText("Product chat"));
    expect(composer).toContainElement(screen.getByText("Alex"));
    if (!composerContexts)
      throw new Error("Composer contexts were not rendered");
    expect(within(composerContexts).getAllByRole("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.getByText("What should I summarize?")).toBeInTheDocument();

    contexts.forEach(([name]) => {
      const trigger = screen.getByRole("button", { name });
      expect(composer).toContainElement(trigger);
      expect(
        input.compareDocumentPosition(trigger) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).not.toBe(0);
      fireEvent.click(trigger);
    });

    const referenceTrigger = screen.getByRole("button", {
      name: "Reference summary",
    });
    expect(headerActions).toContainElement(referenceTrigger);
    expect(headerActions).toContainElement(
      screen.getByText("Last weekly summary")
    );
    expect(referenceTrigger).toHaveClass("wk-btn--ghost");
    expect(screen.getByRole("button", { name: "New session" })).toHaveClass(
      "wk-btn--primary"
    );
    expect(composer).not.toContainElement(referenceTrigger);
    expect(composer).not.toContainElement(
      screen.getByText("Last weekly summary")
    );
    fireEvent.click(referenceTrigger);

    contexts.forEach(([, kind], index) => {
      expect(actions.onOpenContext).toHaveBeenNthCalledWith(index + 1, kind);
    });
    expect(actions.onOpenContext).toHaveBeenNthCalledWith(4, "reference");
  });

  it("renders an expanded context panel above the composer", () => {
    const actions = createActions();
    const { container } = rtlRender(
      <SummaryWorkbench
        state={createState()}
        actions={actions}
        contextPanel={<section data-testid="expanded-template-gallery" />}
      />,
      { legacyRoot: true }
    );

    const panel = screen.getByTestId("expanded-template-gallery");
    const composer = container.querySelector<HTMLElement>(
      ".wk-summary-workbench__composer"
    );
    if (!composer) throw new Error("Composer was not rendered");

    expect(
      panel.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0);
    expect(
      screen.queryByRole("button", { name: "Template" })
    ).not.toBeInTheDocument();
  });

  it("shows a compact template trigger after the gallery is collapsed", () => {
    const actions = createActions();
    const state = createState();
    state.showTemplateTrigger = true;

    rtlRender(<SummaryWorkbench state={state} actions={actions} />, {
      legacyRoot: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Template" }));
    expect(actions.onOpenContext).toHaveBeenCalledWith("template");
  });

  it("does not reserve an empty conversation area above the template gallery", () => {
    const state = createState();
    state.messages = [];
    const { container } = rtlRender(
      <SummaryWorkbench
        state={state}
        actions={createActions()}
        contextPanel={<section data-testid="expanded-template-gallery" />}
      />,
      { legacyRoot: true }
    );

    expect(
      container.querySelector(".wk-summary-workbench__conversation")
    ).not.toBeInTheDocument();
  });

  it("focuses the composer after an external selection fills it", () => {
    const actions = createActions();
    const state = createState();
    state.composerFocusKey = 0;
    const { rerender } = rtlRender(
      <SummaryWorkbench state={state} actions={actions} />,
      { legacyRoot: true }
    );

    rerender(
      <SummaryWorkbench
        state={{ ...state, composerFocusKey: 1 }}
        actions={actions}
      />
    );

    expect(screen.getByRole("textbox")).toHaveFocus();
  });

  it("forwards input, send, enter and context removal events", () => {
    const { actions } = renderWorkbench();
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "Updated request" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Product chat" })
    );

    expect(actions.onInputChange).toHaveBeenCalledWith("Updated request");
    expect(actions.onSend).toHaveBeenCalledTimes(2);
    expect(actions.onRemoveContext).toHaveBeenCalledWith("chat", "chat-1");
  });

  it("renders session recovery and progress without exposing extra result actions", () => {
    const actions = createActions();
    actions.onNewSession = vi.fn();
    const state = createState();
    state.messages[0] = {
      ...state.messages[0],
      process: {
        status: "completed",
        steps: [{ phase: "retrieve", count: 8 }],
      },
    };

    const { rerender } = rtlRender(
      <SummaryWorkbench state={state} actions={actions} />,
      { legacyRoot: true }
    );

    expect(screen.getByTestId("summary-workbench-progress")).toHaveTextContent(
      "Reading chats"
    );
    const firstMessage = screen.getAllByTestId("summary-workbench-message")[0];
    const process = within(firstMessage).getByTestId(
      "summary-workbench-progress"
    );
    expect(process).toBeInTheDocument();
    expect(process).not.toHaveAttribute("open");
    expect(
      process.compareDocumentPosition(
        within(firstMessage).getByText("What should I summarize?")
      ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(actions.onNewSession).toHaveBeenCalledTimes(1);

    rerender(
      <SummaryWorkbench
        state={{ ...state, isHydrating: true }}
        actions={actions}
      />
    );
    expect(screen.getByText("Restoring session")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("labels a failed generation process as failed", () => {
    const state = createState();
    state.messages[0] = {
      ...state.messages[0],
      process: {
        status: "failed",
        steps: [{ phase: "retrieve" }],
      },
    };

    rtlRender(<SummaryWorkbench state={state} actions={createActions()} />, {
      legacyRoot: true,
    });

    const process = screen.getByTestId("summary-workbench-progress");
    expect(process).toHaveTextContent("Failed");
    expect(process).toHaveAttribute("data-card-state", "failed");
  });

  it("keeps preview revisions in chronological chatbot order", () => {
    const state = createState({
      kind: "agent_revision",
      isStale: false,
      version: 2,
      content: "Summary V2",
      assumptions: [],
      actions: ["save_preview"],
    });
    state.messages = [
      {
        id: "preview-1",
        role: "assistant",
        content: "First draft",
        resultType: "agent_preview",
        card: {
          kind: "agent_preview",
          isStale: false,
          isHistorical: true,
          version: 1,
          content: "Summary V1",
          assumptions: [],
          actions: [],
        },
      },
      {
        id: "feedback-1",
        role: "user",
        content: "Add delivery risks",
      },
      {
        id: "preview-2",
        role: "assistant",
        content: "Updated draft",
        resultType: "agent_revision",
        card: {
          kind: "agent_revision",
          isStale: false,
          version: 2,
          content: "Summary V2",
          assumptions: [],
          actions: ["save_preview"],
        },
      },
    ];

    rtlRender(<SummaryWorkbench state={state} actions={createActions()} />, {
      legacyRoot: true,
    });

    const cards = screen.getAllByTestId("summary-workbench-result-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Summary V1");
    expect(cards[0]).toHaveTextContent("Previous version");
    expect(cards[1]).toHaveTextContent("Summary V2");
    expect(cards[1]).toHaveTextContent("Current version");
    expect(
      screen.getByText("Add delivery risks").compareDocumentPosition(cards[1]) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0);
    expect(
      screen.getAllByRole("button", { name: "Save preview" })
    ).toHaveLength(1);
  });

  it("shows immediate understanding progress before the first SSE event", () => {
    const state = createState();
    state.isSending = true;
    state.progressSteps = [];

    rtlRender(<SummaryWorkbench state={state} actions={createActions()} />, {
      legacyRoot: true,
    });

    expect(screen.getByTestId("summary-workbench-progress")).toHaveTextContent(
      "Understanding request"
    );
    expect(
      screen.getAllByTestId("summary-workbench-message").at(-1)
    ).toHaveClass("wk-summary-workbench-message--pending");
  });

  it("locks scope controls while busy and renders a zero progress count", () => {
    const actions = createActions();
    const state = createState();
    state.isSending = true;
    state.progressSteps = [{ phase: "retrieve", count: 0 }];

    rtlRender(<SummaryWorkbench state={state} actions={actions} />, {
      legacyRoot: true,
    });

    expect(
      document.querySelector(".wk-summary-workbench__composer")
    ).toHaveClass("wk-summary-workbench__composer--disabled");

    for (const name of [
      "Select chats",
      "Select participants",
      "Time range",
      "Reference summary",
      "Remove Product chat",
      "Remove Alex",
    ]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    fireEvent.click(screen.getByRole("button", { name: "Select chats" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Product chat" })
    );
    expect(actions.onOpenContext).not.toHaveBeenCalled();
    expect(actions.onRemoveContext).not.toHaveBeenCalled();
    expect(screen.getByTestId("summary-workbench-progress")).toHaveTextContent(
      "Processed 0 items"
    );
  });

  it("renders team confirmation details and only the supplied actions", () => {
    const card: SummaryWorkbenchCardView = {
      kind: "team_confirmation",
      isStale: false,
      participantNames: ["Alex", "Sam"],
      requirement: "Report progress and risks",
      templateLabel: "Weekly report",
      timeRangeLabel: "Last 7 days",
      actions: ["confirm_workflow", "save_preview", "continue_chat"],
    };
    const { actions } = renderWorkbench(card);
    const resultCard = screen.getByTestId("summary-workbench-result-card");

    expect(within(resultCard).getByText("Alex, Sam")).toBeInTheDocument();
    expect(within(resultCard).getByText("Weekly report")).toBeInTheDocument();
    expect(
      within(resultCard).queryByRole("button", { name: "Save preview" })
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(resultCard).getByRole("button", { name: "Confirm workflow" })
    );
    expect(actions.onResultAction).toHaveBeenCalledWith("confirm_workflow");
  });

  it("prevents a stale team proposal from being confirmed", () => {
    const { actions } = renderWorkbench({
      kind: "team_confirmation",
      isStale: true,
      participantNames: ["Alex", "Sam"],
      requirement: "Report progress and risks",
      actions: ["confirm_workflow", "continue_chat"],
    });

    expect(screen.getByText("Outdated")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm workflow" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue chat" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue chat" }));
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect(actions.onResultAction).toHaveBeenCalledWith("continue_chat");
  });

  it("renders workflow progress and enforces view-only completed cards", () => {
    const { rerender, actions } = renderWorkbench({
      kind: "workflow_started",
      isStale: false,
      taskId: 41,
      taskTitle: "Weekly update",
      actions: ["view_progress"],
    });

    fireEvent.click(screen.getByRole("button", { name: "View progress" }));
    expect(actions.onResultAction).toHaveBeenCalledWith("view_progress");

    rerender(
      <SummaryWorkbench
        state={createState({
          kind: "workflow_completed",
          isStale: false,
          taskId: 42,
          taskTitle: "Completed update",
          actions: ["save_preview", "continue_chat", "view_summary"],
        })}
        actions={actions}
      />
    );

    const resultCard = screen.getByTestId("summary-workbench-result-card");
    expect(within(resultCard).getAllByRole("button")).toHaveLength(1);
    expect(
      within(resultCard).getByRole("button", { name: "View summary" })
    ).toBeInTheDocument();
  });

  it("shows preview actions while preventing stale previews from being saved", () => {
    const { rerender, actions } = renderWorkbench({
      kind: "agent_revision",
      isStale: false,
      version: 2,
      content: "# Updated summary",
      assumptions: ["Last 7 days"],
      actions: ["save_preview", "confirm_workflow", "continue_chat"],
    });

    expect(screen.getByText("Revision")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save preview" }));
    expect(actions.onResultAction).toHaveBeenCalledWith("save_preview");
    expect(
      screen.queryByRole("button", { name: "Confirm workflow" })
    ).not.toBeInTheDocument();

    rerender(
      <SummaryWorkbench
        state={createState({
          kind: "agent_preview",
          isStale: true,
          version: 1,
          content: "# Old summary",
          assumptions: [],
          actions: ["save_preview", "continue_chat"],
        })}
        actions={actions}
      />
    );

    expect(screen.getByText("Outdated")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save preview" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue chat" })
    ).toBeInTheDocument();
  });
});
