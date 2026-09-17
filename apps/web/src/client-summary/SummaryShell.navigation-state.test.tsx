import React, { useEffect, useState, type ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SummaryWorkspaceRoute } from "../../../../packages/dmworksummary/src/workspace/types";
import type { OctoBuddySummaryBridge, SummaryHostCommand } from "./hostBridge";

const summaryMockList = vi.hoisted(() => ({
  items: [] as Array<{ id: number; title: string }>,
}));

vi.mock("@octo/base", () => ({
  useI18n: () => ({ t: (key: string) => key }),
  ThemeMode: { light: "light", dark: "dark" },
  WKApp: { loginInfo: {}, shared: {}, mittBus: { emit: vi.fn() } },
  i18n: {},
}));
vi.mock("../../../../packages/dmworksummary/src/host", () => ({
  legacySummaryMessagingPort: {},
  SummaryMessagingProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../../../packages/dmworksummary/src/utils/summaryAttentionBadge", () => ({
  getSummaryAttentionBadge: () => 0,
  subscribeSummaryAttentionBadge: () => () => {},
}));
vi.mock("../../../../packages/dmworksummary/src/pages/SummaryListPage", () => ({
  default: ({ onCreateNew, refreshKey = 0, backgroundRefreshKey = 0 }: {
    onCreateNew(mode: "normal"): void;
    refreshKey?: number;
    backgroundRefreshKey?: number;
  }) => {
    const [loadCount, setLoadCount] = useState(0);
    const [visibleItems, setVisibleItems] = useState<typeof summaryMockList.items>([]);
    const [filter, setFilter] = useState("");
    useEffect(() => {
      setVisibleItems(summaryMockList.items.slice());
      setLoadCount((count) => count + 1);
    }, [refreshKey, backgroundRefreshKey]);
    return (
      <div>
        <input
          aria-label="list-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onDoubleClick={() => onCreateNew("normal")}
        />
        <span data-testid="list-load-count">{loadCount}</span>
        <ul>
          {visibleItems.map((item) => <li key={item.id}>{item.title}</li>)}
        </ul>
      </div>
    );
  },
}));
vi.mock("../../../../packages/dmworksummary/src/features/summaryWorkbench/SummaryWorkbenchCreateEntry", () => ({
  default: () => <input aria-label="draft" />,
}));
vi.mock("../../../../packages/dmworksummary/src/pages/SummaryDetailPage", () => ({
  default: ({ taskId }: { taskId: number | string }) => {
    const [loadedTask] = useState(taskId);
    return <div><span data-testid="loaded-task">{loadedTask}</span><input aria-label="draft" /></div>;
  },
}));
vi.mock("../../../../packages/dmworksummary/src/pages/SummaryConfirmPage", () => ({
  default: ({ taskId }: { taskId: number }) => {
    const [loadedTask] = useState(taskId);
    return <div><span data-testid="loaded-task">{loadedTask}</span><input aria-label="draft" /></div>;
  },
}));
vi.mock("../../../../packages/dmworksummary/src/pages/ScheduleListPage", () => ({
  default: () => null,
}));
vi.mock("../../../../packages/dmworksummary/src/workspace/SummaryShareRoute", () => ({
  default: () => null,
}));
vi.mock("@dmwork/summary", async () => ({
  SummaryWorkspace: (await import("../../../../packages/dmworksummary/src/workspace/SummaryWorkspace")).default,
  resetSummaryAttentionScope: vi.fn(),
  setSummaryAttentionRuntimeVisible: vi.fn(),
}));

import { SummaryShell } from "./SummaryShell";

function setup(initialRoute: SummaryWorkspaceRoute) {
  let listener: ((command: SummaryHostCommand) => void) | undefined;
  const committed: Array<{ navigationId: number; loadedTask: string | null }> = [];
  const bridge = {
    getBootstrap: vi.fn(),
    reportReady: vi.fn(async () => {}),
    reportRoute: vi.fn(),
    reportBadge: vi.fn(),
    reportAuthExpired: vi.fn(),
    reportFatalError: vi.fn(),
    reportNavigationCommitted: vi.fn(async ({ navigationId }: { navigationId: number }) => {
      committed.push({ navigationId, loadedTask: screen.queryByTestId("loaded-task")?.textContent ?? null });
    }),
    openConversation: vi.fn(async () => {}),
    loadConversationMembers: vi.fn(async () => []),
    notifySummaryCompleted: vi.fn(async () => {}),
    requestForward: vi.fn(async () => null),
    onCommand: (next: (command: SummaryHostCommand) => void) => {
      listener = next;
      return () => { listener = undefined; };
    },
  } satisfies OctoBuddySummaryBridge;
  const view = render(<SummaryShell bridge={bridge} initialRoute={initialRoute}
    initialSpaceId="space-a" onReady={async () => {}} />);
  return {
    ...view, bridge, committed,
    send: async (...commands: SummaryHostCommand[]) => {
      await act(async () => { for (const command of commands) listener?.(command); });
    },
  };
}

describe("SummaryShell with the real workspace", () => {
  beforeEach(() => {
    summaryMockList.items.length = 0;
  });

  it("preserves an internally opened creation draft across hide/resume and new acknowledgement IDs", async () => {
    const f = setup({ view: "list" });
    const list = screen.getByLabelText("list-filter");
    fireEvent.change(list, { target: { value: "retained filter" } });
    fireEvent.doubleClick(list);
    await act(async () => {});
    const route: SummaryWorkspaceRoute = { view: "create", mode: "normal", source: "summary_list" };
    expect(f.bridge.reportRoute).toHaveBeenLastCalledWith({ route, spaceId: "space-a" });
    const draft = screen.getByLabelText("draft");
    fireEvent.change(draft, { target: { value: "unsaved creation" } });

    await f.send({ type: "suspend" });
    await f.send({ type: "resume" }, { type: "navigate", route, navigationId: 1 });
    expect(screen.getByTestId("list-load-count")).toHaveTextContent("2");
    await f.send({ type: "navigate", route, navigationId: 2 });
    expect(screen.getByTestId("list-load-count")).toHaveTextContent("2");

    expect(screen.getByLabelText("draft")).toBe(draft);
    expect(draft).toHaveValue("unsaved creation");
    expect(screen.getByLabelText("list-filter")).toBe(list);
    expect(list).toHaveValue("retained filter");
    expect(f.committed.map(({ navigationId }) => navigationId)).toEqual([1, 2]);
  });

  it("refreshes the cached list from the source on resume without remounting the workspace", async () => {
    summaryMockList.items.push({ id: 1, title: "old session summary" });
    const f = setup({ view: "list" });
    const list = screen.getByLabelText("list-filter");
    fireEvent.change(list, { target: { value: "kept filter" } });
    expect(screen.getByTestId("list-load-count")).toHaveTextContent("1");
    expect(screen.getByText("old session summary")).toBeInTheDocument();

    await f.send({ type: "suspend" });
    summaryMockList.items.push({ id: 2, title: "new session summary" });
    expect(screen.queryByText("new session summary")).not.toBeInTheDocument();

    await f.send({ type: "resume" }, { type: "navigate", route: { view: "list" }, navigationId: 10 });

    expect(screen.getByText("new session summary")).toBeInTheDocument();
    expect(screen.getByText("old session summary")).toBeInTheDocument();
    expect(screen.getByTestId("list-load-count")).toHaveTextContent("2");
    expect(screen.getByLabelText("list-filter")).toBe(list);
    expect(list).toHaveValue("kept filter");
    expect(f.committed.map(({ navigationId }) => navigationId)).toEqual([10]);
  });

  it.each(["detail", "confirm"] as const)(
    "preserves same-task %s edits but resets a changed task before acknowledging",
    async (view) => {
      const route: SummaryWorkspaceRoute = { view, taskId: 101 };
      const f = setup(route);
      const list = screen.getByLabelText("list-filter");
      const draft = screen.getByLabelText("draft");
      fireEvent.change(draft, { target: { value: "unsaved edit" } });
      await f.send({ type: "suspend" });
      await f.send({ type: "resume" }, { type: "navigate", route, navigationId: 1 });
      expect(screen.getByLabelText("draft")).toBe(draft);
      expect(draft).toHaveValue("unsaved edit");

      await f.send({ type: "navigate", route: { view, taskId: 202 }, navigationId: 2 });
      expect(screen.getByLabelText("draft")).not.toBe(draft);
      expect(screen.getByLabelText("draft")).toHaveValue("");
      expect(screen.getByLabelText("list-filter")).toBe(list);
      expect(f.committed).toEqual([
        { navigationId: 1, loadedTask: "101" }, { navigationId: 2, loadedTask: "202" },
      ]);
    },
  );

  it("keeps legacy same-target resumes and still clears state across spaces", async () => {
    const route: SummaryWorkspaceRoute = { view: "detail", taskId: 101 };
    const f = setup(route);
    const draft = screen.getByLabelText("draft");
    fireEvent.change(draft, { target: { value: "unsaved edit" } });
    await f.send({ type: "suspend" }, { type: "resume" }, { type: "navigate", route });
    expect(screen.getByLabelText("draft")).toBe(draft);
    expect(draft).toHaveValue("unsaved edit");
    expect(f.committed).toEqual([]);

    await f.send({ type: "spaceChanged", space: { id: "space-b", name: "B" } });
    expect(screen.queryByLabelText("draft")).toBeNull();
    await f.send({ type: "navigate", route, navigationId: 2 });
    expect(screen.getByLabelText("draft")).not.toBe(draft);
    expect(screen.getByLabelText("draft")).toHaveValue("");
  });
});
