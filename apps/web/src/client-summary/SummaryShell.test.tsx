// @vitest-environment jsdom

import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  command: {
    listener: undefined as ((command: any) => void) | undefined,
  },
  workspaceProps: undefined as any,
  setRuntimeVisible: vi.fn(),
  bridge: {
    reportRoute: vi.fn(),
    reportBadge: vi.fn(),
    openConversation: vi.fn(async () => {}),
    loadConversationMembers: vi.fn(async () => []),
    notifySummaryCompleted: vi.fn(async () => {}),
    requestForward: vi.fn(async () => null),
    onCommand: vi.fn((listener: (command: any) => void) => {
      mocks.command.listener = listener;
      return () => {
        if (mocks.command.listener === listener) {
          mocks.command.listener = undefined;
        }
      };
    }),
  },
}));

vi.mock("@dmwork/summary", () => ({
  setSummaryAttentionRuntimeVisible: mocks.setRuntimeVisible,
  SummaryWorkspace: (props: any) => {
    mocks.workspaceProps = props;
    return <div data-testid="summary-workspace" />;
  },
}));

vi.mock("@octo/base", () => ({
  ThemeMode: { light: "light", dark: "dark" },
  WKApp: {
    config: {},
    loginInfo: {
      uid: "user-a",
      name: "User A",
      selfDisplayName: vi.fn(() => "User A"),
      logout: vi.fn(),
    },
    shared: {
      currentSpaceId: "space-a",
      notifyListener: vi.fn(),
    },
  },
  i18n: { setLocale: vi.fn() },
}));

import { WKApp, i18n } from "@octo/base";
import { SummaryShell } from "./SummaryShell";

describe("SummaryShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.command.listener = undefined;
    mocks.workspaceProps = undefined;
    document.documentElement.removeAttribute("data-space-id");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-host-visibility");
  });

  it("reports ready once during the React StrictMode effect cycle", async () => {
    const onReady = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    render(
      <React.StrictMode>
        <SummaryShell
          bridge={mocks.bridge as any}
          initialRoute={{ view: "list" }}
          initialSpaceId="space-a"
          onReady={onReady}
        />
      </React.StrictMode>
    );

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(onReady).toHaveBeenCalledWith({
      route: { view: "list" },
      spaceId: "space-a",
    });
  });

  it("accepts host navigation without echoing it and reports UI navigation", async () => {
    render(
      <SummaryShell
        bridge={mocks.bridge as any}
        initialRoute={{ view: "list" }}
        initialSpaceId="space-a"
        onReady={vi.fn(async () => {})}
      />
    );

    act(() => {
      mocks.command.listener?.({
        type: "navigate",
        route: { view: "detail", taskId: 42 },
      });
    });
    expect(mocks.workspaceProps.route).toEqual({ view: "detail", taskId: 42 });
    expect(mocks.bridge.reportRoute).not.toHaveBeenCalled();

    act(() => {
      mocks.workspaceProps.onRouteChange({ view: "schedules" });
    });
    await waitFor(() =>
      expect(mocks.bridge.reportRoute).toHaveBeenCalledWith({
        view: "schedules",
      })
    );
  });

  it("synchronizes space and appearance commands and invalidates data", () => {
    render(
      <SummaryShell
        bridge={mocks.bridge as any}
        initialRoute={{ view: "list" }}
        initialSpaceId="space-a"
        onReady={vi.fn(async () => {})}
      />
    );
    const invalidate = vi.fn();
    mocks.workspaceProps.messaging.subscribeInvalidation(invalidate);

    act(() => {
      mocks.command.listener?.({
        type: "spaceChanged",
        space: { id: "space-b", name: "Space B" },
      });
      mocks.command.listener?.({
        type: "appearanceChanged",
        theme: "dark",
        locale: "en-US",
      });
      mocks.command.listener?.({ type: "invalidate" });
      mocks.command.listener?.({ type: "suspend" });
    });

    expect(WKApp.shared.currentSpaceId).toBe("space-b");
    expect(document.documentElement.dataset.spaceId).toBe("space-b");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.lang).toBe("en-US");
    expect(document.documentElement.dataset.hostVisibility).toBe("hidden");
    expect(mocks.setRuntimeVisible).not.toHaveBeenCalled();
    expect(i18n.setLocale).toHaveBeenCalledWith("en-US", { persist: false });
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("keeps badge polling active while detached and pauses it with the host window", () => {
    render(
      <SummaryShell
        bridge={mocks.bridge as any}
        initialRoute={{ view: "list" }}
        initialSpaceId="space-a"
        onReady={vi.fn(async () => {})}
      />
    );

    act(() => mocks.command.listener?.({ type: "suspend" }));
    expect(mocks.setRuntimeVisible).not.toHaveBeenCalled();

    act(() => mocks.command.listener?.({ type: "hostVisibilityChanged", visible: false }));
    expect(mocks.setRuntimeVisible).toHaveBeenLastCalledWith(false);

    act(() => mocks.command.listener?.({ type: "hostVisibilityChanged", visible: true }));
    expect(mocks.setRuntimeVisible).toHaveBeenLastCalledWith(true);
  });

  it("isolates route and badge reporting failures", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const routeError = new Error("route IPC failure");
    const badgeError = new Error("badge IPC failure");
    mocks.bridge.reportRoute.mockImplementationOnce(() => {
      throw routeError;
    });
    mocks.bridge.reportBadge.mockImplementationOnce(() => {
      throw badgeError;
    });

    render(
      <SummaryShell
        bridge={mocks.bridge as any}
        initialRoute={{ view: "list" }}
        initialSpaceId="space-a"
        onReady={vi.fn(async () => {})}
      />
    );

    expect(() =>
      act(() => mocks.workspaceProps.onRouteChange({ view: "schedules" }))
    ).not.toThrow();
    expect(() => mocks.workspaceProps.onBadgeChange(3)).not.toThrow();

    await waitFor(() =>
      expect(consoleSpy).toHaveBeenCalledWith(
        "[client-summary] failed to report route",
        routeError
      )
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      "[client-summary] failed to report badge",
      badgeError
    );
    consoleSpy.mockRestore();
  });
});
