import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../../../../packages/dmloop/src/api/types";
import {
  readPendingLoopIssueDeepLink,
  savePendingLoopIssueDeepLink,
} from "../../../../packages/dmloop/src/issueDeepLink";
import { useLoopWorkspace } from "../../../../packages/dmloop/src/bridge/useLoopWorkspace";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const hoisted = vi.hoisted(() => {
  const listeners = new Map<string, Set<(payload?: unknown) => void>>();
  let workspaceId = "";
  const routeRight = {
    replaceToRoot: vi.fn(),
  };
  return {
    listWorkspaces: vi.fn(),
    createWorkspace: vi.fn(),
    resolveIssueByIdentifier: vi.fn(),
    setWorkspaceContext: vi.fn((slug: string, id: string) => {
      workspaceId = id;
    }),
    currentWorkspaceId: vi.fn(() => workspaceId),
    resetWorkspaceId: () => {
      workspaceId = "";
    },
    WKApp: {
      currentMenuId: "loop",
      routeRight,
      mittBus: {
        on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(handler);
        }),
        off: vi.fn((event: string, handler: (payload?: unknown) => void) => {
          listeners.get(event)?.delete(handler);
        }),
        emit: vi.fn((event: string, payload?: unknown) => {
          listeners.get(event)?.forEach((handler) => handler(payload));
        }),
      },
    },
    reset: () => {
      listeners.clear();
      workspaceId = "";
      routeRight.replaceToRoot.mockClear();
    },
  };
});

vi.mock("@octo/base", () => ({
  WKApp: hoisted.WKApp,
  getPinyin: (value: string) => value.toLowerCase(),
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("../../../../packages/dmloop/src/api/workspaceApi", () => ({
  listWorkspaces: hoisted.listWorkspaces,
  createWorkspace: hoisted.createWorkspace,
}));

vi.mock("../../../../packages/dmloop/src/api/issueApi", () => ({
  resolveIssueByIdentifier: hoisted.resolveIssueByIdentifier,
}));

vi.mock("../../../../packages/dmloop/src/api/http", () => ({
  currentWorkspaceId: hoisted.currentWorkspaceId,
  setWorkspaceContext: hoisted.setWorkspaceContext,
}));

vi.mock("../../../../packages/dmloop/src/api/agentApi", () => ({
  invalidateRuntimeMap: vi.fn(),
  invalidateAgentStatus: vi.fn(),
}));

vi.mock("../../../../packages/dmloop/src/api/directory", () => ({
  invalidateDirectory: vi.fn(),
}));

const workspaceA: Workspace = {
  id: "ws-a",
  slug: "alpha",
  name: "Alpha",
  created_at: "",
  updated_at: "",
};

const workspaceB: Workspace = {
  id: "ws-b",
  slug: "beta",
  name: "Beta",
  created_at: "",
  updated_at: "",
};

function lastPaneKind() {
  const calls = hoisted.WKApp.routeRight.replaceToRoot.mock.calls;
  const element = calls[calls.length - 1]?.[0] as React.ReactElement | undefined;
  return element?.props?.["data-kind"] as string | undefined;
}

describe("useLoopWorkspace stale-write guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.reset();
    hoisted.resetWorkspaceId();
    hoisted.WKApp.currentMenuId = "loop";
    sessionStorage.clear();
    window.history.replaceState({}, "", "/loop");
  });

  it("drops an in-flight issue deep link when the user switches workspace", async () => {
    const issueResolve = deferred<{ id: string; identifier: string } | null>();
    hoisted.listWorkspaces.mockResolvedValue([workspaceA, workspaceB]);
    hoisted.resolveIssueByIdentifier.mockReturnValue(issueResolve.promise);
    savePendingLoopIssueDeepLink(
      { workspaceSlug: workspaceA.slug, issueIdentifier: "HMH-3" },
      sessionStorage
    );
    const renderIssueDetail = vi.fn((issueId: string) => (
      <div data-kind={`detail:${issueId}`} />
    ));

    const { result } = renderHook(() =>
      useLoopWorkspace({
        t: (key) => key,
        renderTab: (key, workspace) => (
          <div data-kind={`tab:${key}:${workspace?.id ?? "none"}`} />
        ),
        renderIssueDetail,
        renderEmptyGuide: () => <div data-kind="empty" />,
      })
    );

    await waitFor(() => expect(result.current.loaded).toBe(true));
    await waitFor(() => expect(result.current.workspaces).toHaveLength(2));

    act(() => {
      result.current.switchWorkspace(workspaceB);
    });
    expect(lastPaneKind()).toBe("tab:issue:ws-b");

    await act(async () => {
      issueResolve.resolve({ id: "issue-a", identifier: "HMH-3" });
      await issueResolve.promise;
    });

    expect(renderIssueDetail).not.toHaveBeenCalled();
    expect(lastPaneKind()).toBe("tab:issue:ws-b");
    expect(window.location.pathname).toBe("/loop");
  });

  it("drops a stale reloadWorkspaces result after a space switch", async () => {
    const reloadResolve = deferred<Workspace[]>();
    hoisted.listWorkspaces
      .mockResolvedValueOnce([workspaceA])
      .mockReturnValueOnce(reloadResolve.promise)
      .mockResolvedValueOnce([workspaceB]);
    let reloadWorkspaces: (() => Promise<Workspace[]>) | null = null;

    const { result } = renderHook(() =>
      useLoopWorkspace({
        t: (key) => key,
        renderTab: (key, workspace, helpers) => {
          reloadWorkspaces = helpers.reloadWorkspaces;
          return <div data-kind={`tab:${key}:${workspace?.id ?? "none"}`} />;
        },
        renderIssueDetail: (issueId) => <div data-kind={`detail:${issueId}`} />,
        renderEmptyGuide: () => <div data-kind="empty" />,
      })
    );

    await waitFor(() => expect(result.current.currentWorkspace?.id).toBe("ws-a"));
    expect(reloadWorkspaces).not.toBeNull();

    let reloadPromise!: Promise<Workspace[]>;
    act(() => {
      reloadPromise = reloadWorkspaces!();
    });
    act(() => {
      hoisted.WKApp.mittBus.emit("space-changed");
    });

    await waitFor(() => expect(result.current.currentWorkspace?.id).toBe("ws-b"));

    await act(async () => {
      reloadResolve.resolve([workspaceA]);
      await reloadPromise;
    });

    await waitFor(() =>
      expect(result.current.workspaces.map((workspace) => workspace.id)).toEqual(["ws-b"])
    );
  });

  it("keeps a pending issue deep link when the workspace is not in the current space", async () => {
    hoisted.listWorkspaces.mockResolvedValue([workspaceB]);
    savePendingLoopIssueDeepLink(
      { workspaceSlug: workspaceA.slug, issueIdentifier: "HMH-3" },
      sessionStorage
    );

    renderHook(() =>
      useLoopWorkspace({
        t: (key) => key,
        renderTab: (key, workspace) => (
          <div data-kind={`tab:${key}:${workspace?.id ?? "none"}`} />
        ),
        renderIssueDetail: (issueId) => <div data-kind={`detail:${issueId}`} />,
        renderEmptyGuide: () => <div data-kind="empty" />,
      })
    );

    await waitFor(() =>
      expect(readPendingLoopIssueDeepLink(sessionStorage)).toMatchObject({
        workspaceSlug: workspaceA.slug,
        issueIdentifier: "HMH-3",
      })
    );
    expect(hoisted.resolveIssueByIdentifier).not.toHaveBeenCalled();
  });
});
