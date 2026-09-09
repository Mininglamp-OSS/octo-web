import React, { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSummaryAttentionBadge } from "../utils/summaryAttentionBadge";
import type { SummaryWorkspaceRoute } from "./types";
import type { SummaryMessagingPort } from "../host";

vi.mock("../api/summaryApi", () => ({
  getSummaryShare: vi.fn(async () => ({ source_accessible: false })),
}));
vi.mock("../pages/SummaryListPage", () => ({
  default: ({ onCreateNew, onViewDetail, refreshKey }: any) => (
    <div data-testid="workspace-list">
      <span data-testid="workspace-list-refresh">{refreshKey}</span>
      <button onClick={() => onCreateNew("agent")}>create-agent</button>
      <button onClick={() => onCreateNew("unified")}>create-unified</button>
      <button onClick={() => onViewDetail(17)}>open-detail</button>
    </div>
  ),
}));

vi.mock("../features/summaryWorkbench/SummaryWorkbenchCreateEntry", () => ({
  default: ({ legacyInitialMode, derivedFromTask, onSubmit, onOpenTask }: any) => (
    <div data-testid="workspace-create">
      <span>{legacyInitialMode}</span>
      <span>{derivedFromTask?.task_id ?? "none"}</span>
      <button onClick={() => onSubmit(23)}>submit-create</button>
      <button onClick={() => onOpenTask(24)}>open-workbench-task</button>
    </div>
  ),
}));

vi.mock("../pages/SummaryDetailPage", () => ({
  default: ({
    taskId,
    onAfterMutate,
    onContinueRefine,
    onViewConfirm,
  }: any) => (
    <div data-testid="workspace-detail">
      <span>{taskId}</span>
      <button
        onClick={() =>
          onContinueRefine({
            task_id: taskId,
            task_no: `task-${taskId}`,
            title: "Reference",
            summary_mode: 1,
            status: 3,
            trigger_type: 1,
            time_range_start: "",
            time_range_end: "",
            sources: [],
            total_msg_count: 0,
            origin_channel_id: "",
            origin_channel_type: 0,
            created_at: "",
            completed_at: null,
          })
        }
      >
        continue-refine
      </button>
      <button onClick={() => onViewConfirm(taskId)}>open-confirm</button>
      <button onClick={onAfterMutate}>after-mutate</button>
    </div>
  ),
}));

vi.mock("../pages/SummaryShareDetailPage", () => ({
  default: ({ originChannel, onOpenConversation }: any) => (
    <button onClick={() => onOpenConversation(originChannel)}>
      back-to-chat
    </button>
  ),
}));

vi.mock("../pages/SummaryConfirmPage", () => ({
  default: ({ onBack, onDeclined }: any) => (
    <div>
      <button onClick={onBack}>confirm-back</button>
      <button onClick={onDeclined}>confirm-declined</button>
    </div>
  ),
}));

vi.mock("../pages/ScheduleListPage", () => ({
  default: ({ onBack }: any) => <button onClick={onBack}>schedule-back</button>,
}));

import SummaryWorkspace from "./SummaryWorkspace";

function Harness({
  initialRoute,
  onRouteChange = vi.fn(),
  onOpenConversation = vi.fn(async () => {}),
  onBadgeChange,
  messaging,
}: {
  initialRoute: SummaryWorkspaceRoute;
  onRouteChange?: (route: SummaryWorkspaceRoute) => void;
  onOpenConversation?: (target: {
    channelId: string;
    channelType: number;
  }) => Promise<void>;
  onBadgeChange?: (count: number) => void;
  messaging?: SummaryMessagingPort;
}) {
  const [route, setRoute] = useState(initialRoute);
  return (
    <SummaryWorkspace
      route={route}
      onRouteChange={(next) => {
        onRouteChange(next);
        setRoute(next);
      }}
      onOpenConversation={onOpenConversation}
      onBadgeChange={onBadgeChange}
      messaging={messaging}
    />
  );
}

describe("SummaryWorkspace", () => {
  it("routes unified creation and completed tasks inside the workspace", () => {
    const onRouteChange = vi.fn();
    render(<Harness initialRoute={{ view: "list" }} onRouteChange={onRouteChange} />);
    fireEvent.click(screen.getByText("create-unified"));
    expect(onRouteChange).toHaveBeenLastCalledWith({
      view: "create", mode: "normal", source: "summary_list",
    });
    fireEvent.click(screen.getByText("open-workbench-task"));
    expect(onRouteChange).toHaveBeenLastCalledWith({ view: "detail", taskId: 24 });
  });

  beforeEach(() => {
    setSummaryAttentionBadge(0);
  });

  afterEach(() => {
    setSummaryAttentionBadge(0);
  });

  it("owns list, detail, refine, create, and confirm navigation", () => {
    const onRouteChange = vi.fn();
    render(
      <Harness
        initialRoute={{ view: "detail", taskId: 17 }}
        onRouteChange={onRouteChange}
      />
    );

    expect(screen.getByTestId("workspace-list")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-detail")).toHaveTextContent("17");

    fireEvent.click(screen.getByText("continue-refine"));
    expect(onRouteChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        view: "create",
        mode: "agent",
        source: "detail_optimize",
        derivedFromTask: expect.objectContaining({ task_id: 17 }),
      })
    );
    expect(screen.getByTestId("workspace-create")).toHaveTextContent("agent");
    expect(screen.getByTestId("workspace-create")).toHaveTextContent("17");

    fireEvent.click(screen.getByText("submit-create"));
    expect(onRouteChange).toHaveBeenLastCalledWith({
      view: "detail",
      taskId: 23,
    });
    expect(screen.getByTestId("workspace-list-refresh")).toHaveTextContent("1");

    fireEvent.click(screen.getByText("open-confirm"));
    expect(onRouteChange).toHaveBeenLastCalledWith({
      view: "confirm",
      taskId: 23,
    });

    fireEvent.click(screen.getByText("confirm-back"));
    expect(onRouteChange).toHaveBeenLastCalledWith({
      view: "detail",
      taskId: 23,
    });
  });

  it("delegates return-to-chat to the host", async () => {
    const onOpenConversation = vi.fn(async () => {});
    render(
      <Harness
        initialRoute={{
          view: "share",
          shareId: "share-1",
          originConversation: { channelId: "group-1", channelType: 2 },
        }}
        onOpenConversation={onOpenConversation}
      />
    );

    fireEvent.click(await screen.findByText("back-to-chat"));
    expect(onOpenConversation).toHaveBeenCalledWith({
      channelId: "group-1",
      channelType: 2,
    });
  });

  it("reports the initial badge and later badge changes", () => {
    const onBadgeChange = vi.fn();
    const view = render(
      <Harness initialRoute={{ view: "list" }} onBadgeChange={onBadgeChange} />
    );

    expect(onBadgeChange).toHaveBeenCalledWith(0);
    setSummaryAttentionBadge(4);
    expect(onBadgeChange).toHaveBeenLastCalledWith(4);

    view.unmount();
    setSummaryAttentionBadge(7);
    expect(onBadgeChange).not.toHaveBeenCalledWith(7);
  });

  it("does not let a host badge callback break local badge updates", () => {
    const onBadgeChange = vi.fn(() => {
      throw new Error("host unavailable");
    });
    render(
      <Harness initialRoute={{ view: "list" }} onBadgeChange={onBadgeChange} />
    );

    expect(() => setSummaryAttentionBadge(2)).not.toThrow();
    expect(onBadgeChange).toHaveBeenCalledWith(2);
  });

  it("refreshes the list when the messaging host invalidates summary data", () => {
    let invalidate = () => {};
    const unsubscribe = vi.fn();
    const messaging = {
      getCurrentUser: () => ({ uid: "u1", displayName: "User" }),
      loadConversationMembers: vi.fn(async () => []),
      openConversation: vi.fn(async () => {}),
      notifySummaryCompleted: vi.fn(async () => {}),
      requestForward: vi.fn(),
      subscribeInvalidation: vi.fn((listener: () => void) => {
        invalidate = listener;
        return unsubscribe;
      }),
    } satisfies SummaryMessagingPort;
    const view = render(
      <Harness initialRoute={{ view: "list" }} messaging={messaging} />
    );

    expect(screen.getByTestId("workspace-list-refresh")).toHaveTextContent("0");
    act(() => invalidate());
    expect(screen.getByTestId("workspace-list-refresh")).toHaveTextContent("1");

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
