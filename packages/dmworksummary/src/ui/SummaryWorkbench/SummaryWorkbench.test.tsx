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
    "summary.workbench.context.chat": "Chats",
    "summary.workbench.context.participant": "Participants",
    "summary.workbench.context.template": "Template",
    "summary.workbench.context.timeRange": "Time range",
    "summary.workbench.composer.send": "Send",
    "summary.workbench.card.teamConfirmationTitle": "Confirm collaboration",
    "summary.workbench.card.teamConfirmationBadge": "Team workflow",
    "summary.workbench.card.workflowStartedTitle": "Summary is running",
    "summary.workbench.card.workflowStartedBadge": "Workflow started",
    "summary.workbench.card.workflowCompletedTitle": "Summary generated",
    "summary.workbench.card.workflowCompletedBadge": "Saved",
    "summary.workbench.card.previewTitle": "Preview draft",
    "summary.workbench.card.previewBadge": "Preview",
    "summary.workbench.card.revisionBadge": "Revision",
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
        return labels[key] ?? key;
      },
    }),
    WKButton: ({
      children,
      loading,
      icon,
      iconOnly: _iconOnly,
      size: _size,
      variant: _variant,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      loading?: boolean;
      icon?: React.ReactNode;
      iconOnly?: boolean;
      size?: string;
      variant?: string;
    }) => (
      <button {...props} disabled={props.disabled || loading}>
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
      { id: "m1", role: "assistant", content: "What should I summarize?" },
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
  it("renders one controlled composer and all four context controls", () => {
    const { actions } = renderWorkbench();

    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.getByText("What should I summarize?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Chats" }));
    fireEvent.click(screen.getByRole("button", { name: "Participants" }));
    fireEvent.click(screen.getByRole("button", { name: "Template" }));
    fireEvent.click(screen.getByRole("button", { name: "Time range" }));

    expect(actions.onOpenContext).toHaveBeenNthCalledWith(1, "chat");
    expect(actions.onOpenContext).toHaveBeenNthCalledWith(2, "participant");
    expect(actions.onOpenContext).toHaveBeenNthCalledWith(3, "template");
    expect(actions.onOpenContext).toHaveBeenNthCalledWith(4, "time_range");
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
    renderWorkbench({
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
