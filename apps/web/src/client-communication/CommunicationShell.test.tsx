import React, { useEffect } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const command = {
    listener: undefined as ((command: any) => void) | undefined,
  };
  const summaryRequest = {
    listener: undefined as ((request: any) => void) | undefined,
  };
  return {
    command,
    summaryRequest,
    getCurrentImChannelInfo: vi.fn(),
    subscribeUnread: vi.fn((listener: (count: number) => void) => {
      listener(0);
      return vi.fn();
    }),
    setCurrentImChannelInfoCache: vi.fn(),
    findCurrentImConversation: vi.fn(),
    createCurrentEmptyImConversation: vi.fn(),
    loadConversationMembers: vi.fn(async () => [{ uid: "user-1", name: "User 1" }]),
    requestForward: vi.fn(),
    confirm: vi.fn((_props: { onOk: () => void; onCancel: () => void }) => ({
      destroy: vi.fn(),
    })),
    bridge: {
      getBootstrap: vi.fn(),
      reportReady: vi.fn(async () => {}),
      reportNavigation: vi.fn(async () => {}),
      reportUnread: vi.fn(),
      reportAuthExpired: vi.fn(),
      reportFatalError: vi.fn(),
      respondSummaryRequest: vi.fn(),
      onSummaryRequest: vi.fn((listener: (request: any) => void) => {
        summaryRequest.listener = listener;
        return () => {
          if (summaryRequest.listener === listener) summaryRequest.listener = undefined;
        };
      }),
      onCommand: vi.fn((listener: (command: any) => void) => {
        command.listener = listener;
        return () => {
          if (command.listener === listener) {
            command.listener = undefined;
          }
        };
      }),
    },
    conversationManager: {
      addConversationListener: vi.fn(),
      removeConversationListener: vi.fn(),
    },
  };
});

vi.mock("@dmwork/summary/messaging", () => ({
  legacySummaryMessagingPort: {
    loadConversationMembers: mocks.loadConversationMembers,
    notifySummaryCompleted: vi.fn(async () => {}),
    requestForward: mocks.requestForward,
  },
}));

vi.mock("@octo/contacts", () => ({
  ContactsList: () => {
    const [filter, setFilter] = React.useState("");
    return <input aria-label="contacts" value={filter} onChange={(event) => setFilter(event.target.value)} />;
  },
}));

vi.mock("@octo/base/src/Components/WKModal", () => ({ wkConfirm: mocks.confirm }));

vi.mock("@dmwork/appbot/conversation", () => ({
  renderAppBotConversation: (target: { displayName: string }, channel: unknown) =>
    <div className="appbot-chat-wrap" data-channel={JSON.stringify(channel)}>{target.displayName}</div>,
}));

vi.mock("wukongimjssdk", () => ({
  Channel: class Channel {
    constructor(
      public channelID: string,
      public channelType: number,
    ) {}
  },
  ChannelInfo: class ChannelInfo {
    channel?: { channelID: string; channelType: number };
    title = "";
    logo = "";
    orgData: Record<string, unknown> = {};
  },
  WKSDK: {
    shared: () => ({ conversationManager: mocks.conversationManager }),
  },
}));

vi.mock("@octo/base", () => {
  const route = {
    setPush: vi.fn(),
    setReplaceToRoot: vi.fn(),
    setPop: vi.fn(),
    setPopToRoot: vi.fn(),
    popToRoot: vi.fn(),
    replaceToRoot: vi.fn(),
  };
  const mittBus = {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  const shared = {
    openChannel: null,
    currentSpaceId: "space-a",
    addListener: vi.fn(() => () => {}),
    notifyListener: vi.fn(),
  };
  return {
    ChatPage: () => <div>chat</div>,
    applyImSpaceContext: (space?: { space_id: string; name: string }) => {
      if (shared.currentSpaceId === (space?.space_id || "")) return false;
      shared.currentSpaceId = space?.space_id || "";
      mittBus.emit("space-changed", space);
      return true;
    },
    getCurrentImChannelInfo: mocks.getCurrentImChannelInfo,
    getCurrentImUnreadObserver: () => ({ subscribe: mocks.subscribeUnread }),
    setCurrentImChannelInfoCache: mocks.setCurrentImChannelInfoCache,
    findCurrentImConversation: mocks.findCurrentImConversation,
    createCurrentEmptyImConversation: mocks.createCurrentEmptyImConversation,
    ThemeMode: { light: "light", dark: "dark" },
    WKApp: {
      routeLeft: { ...route },
      routeRight: { ...route },
      currentMenuId: "chat",
      switchToMenuById: undefined,
      config: {},
      loginInfo: { logout: vi.fn() },
      endpoints: { showConversation: vi.fn() },
      mittBus,
      shared,
    },
    WKBase: ({ children, onContext }: any) => {
      useEffect(() => onContext?.({}), [onContext]);
      return children;
    },
    WKLayout: ({ contentLeft, contentRight, onLeftContext, onRightContext }: any) => {
      useEffect(() => {
        const context = {
          push: vi.fn(),
          replaceToRoot: vi.fn(),
          pop: vi.fn(),
          popToRoot: vi.fn(),
        };
        onLeftContext?.(context);
        onRightContext?.(context);
      }, [onLeftContext, onRightContext]);
      return <>{contentLeft}{contentRight}</>;
    },
    i18n: { setLocale: vi.fn() },
    t: (key: string) => key,
    useI18n: () => ({ t: (key: string) => key }),
  };
});

import { CommunicationShell } from "./CommunicationShell";
import { WKApp, i18n } from "@octo/base";
import { installDesktopPresentationLifecycle } from "./desktopPresentationLifecycle";
import type { DesktopPresentation } from "./desktopPresentation";
import type { OctoBuddyCommunicationBridge } from "./hostBridge";
import { createUnreadCountObserver } from "@octo/base/src/im-runtime/unreadObserver";

describe("CommunicationShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.command.listener = undefined;
    mocks.summaryRequest.listener = undefined;
    mocks.getCurrentImChannelInfo.mockReturnValue(undefined);
    mocks.subscribeUnread.mockImplementation((listener) => {
      listener(0);
      return vi.fn();
    });
    WKApp.shared.openChannel = undefined;
    WKApp.shared.pendingAttachmentGuard = undefined;
  });

  async function openWorkspaceGroup() {
    const shell = render(<CommunicationShell bridge={mocks.bridge}
      initialPage="chat" initialSpaceId="space-a"
      initialPresentation="conversation" onReady={async () => {}} />);
    act(() => mocks.command.listener?.({
      type: "navigate", page: "chat", presentation: "conversation",
      target: { channelId: "group-a", channelType: 2, variant: "workspace-group" },
    }));
    await waitFor(() => expect(WKApp.endpoints.showConversation).toHaveBeenCalledTimes(1));
    WKApp.shared.openChannel = vi.mocked(WKApp.endpoints.showConversation).mock.calls[0][0];
    WKApp.shared.pendingAttachmentGuard = () => false;
    return shell;
  }

  const switchWorkspaceGroup = () => mocks.command.listener?.({
    type: "navigate", page: "chat", presentation: "conversation",
    target: { channelId: "group-b", channelType: 2, variant: "workspace-group" },
  });

  it("restores the original workspace selection when an attachment warning is cancelled", async () => {
    await openWorkspaceGroup();
    act(switchWorkspaceGroup);
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(WKApp.endpoints.showConversation).toHaveBeenCalledTimes(1);
    act(() => mocks.confirm.mock.calls[0][0].onCancel());
    await waitFor(() => expect(mocks.bridge.reportNavigation).toHaveBeenCalledWith({
      page: "chat", source: "workspace-selection-cancelled",
      channel: { id: "group-a", type: 2 },
      cancelledTarget: { id: "group-b", type: 2 },
    }));
    expect(WKApp.endpoints.showConversation).toHaveBeenCalledTimes(1);
    act(switchWorkspaceGroup);
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
    act(() => mocks.confirm.mock.calls[1][0].onOk());
    expect(WKApp.endpoints.showConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({ channelID: "group-b" }), expect.any(Object),
    );
  });

  it("guards subgroup navigation without changing the current workspace conversation on cancel", async () => {
    await openWorkspaceGroup();
    const open = vi.mocked(WKApp.endpoints.showConversation).mock.calls[0][1]!.workspaceEmbedding!.openConversation;
    const channel = { channelID: "group-a____topic", channelType: 5 } as Parameters<typeof open>[0];
    act(() => open(channel));
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    mocks.bridge.reportNavigation.mockClear();
    act(() => mocks.confirm.mock.calls[0][0].onCancel());
    await Promise.resolve();
    expect(mocks.bridge.reportNavigation).not.toHaveBeenCalled();
    act(() => open(channel));
    act(() => mocks.confirm.mock.calls[1][0].onOk());
    await waitFor(() => expect(mocks.bridge.reportNavigation).toHaveBeenCalledWith({
      page: "chat", source: "workspace-conversation",
      channel: { id: "group-a____topic", type: 5 },
    }));
    expect(WKApp.endpoints.showConversation).toHaveBeenCalledTimes(1);
  });

  it.each(["suspend", "spaceChanged", "navigate", "unmount"])(
    "invalidates an attachment confirmation on %s",
    async (action) => {
      const shell = await openWorkspaceGroup();
      act(switchWorkspaceGroup);
      await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
      const dialog = mocks.confirm.mock.calls[0][0];
      act(() => {
        if (action === "unmount") shell.unmount();
        else if (action === "spaceChanged") mocks.command.listener?.({
          type: "spaceChanged", space: { id: "space-b", name: "B" },
        });
        else if (action === "navigate") mocks.command.listener?.({ type: "navigate", page: "contacts" });
        else mocks.command.listener?.({ type: action });
      });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      mocks.bridge.reportNavigation.mockClear();
      act(() => { dialog.onOk(); dialog.onCancel(); });
      await Promise.resolve();
      expect(WKApp.endpoints.showConversation).toHaveBeenCalledTimes(1);
      expect(mocks.bridge.reportNavigation).not.toHaveBeenCalled();
      expect(mocks.confirm.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
    },
  );

  it("returns to full Messages when entry from a regular conversation is cancelled", async () => {
    render(<CommunicationShell bridge={mocks.bridge}
      initialPage="chat" initialSpaceId="space-a"
      initialPresentation="workspace" onReady={async () => {}} />);
    act(() => mocks.command.listener?.({
      type: "navigate", page: "chat", target: { channelId: "regular-group", channelType: 2 },
    }));
    await waitFor(() => expect(WKApp.endpoints.showConversation).toHaveBeenCalledTimes(1));
    WKApp.shared.openChannel = vi.mocked(WKApp.endpoints.showConversation).mock.calls[0][0];
    WKApp.shared.pendingAttachmentGuard = () => false;
    act(switchWorkspaceGroup);
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    act(() => mocks.confirm.mock.calls[0][0].onCancel());
    await waitFor(() => expect(mocks.bridge.reportNavigation).toHaveBeenCalledWith({
      page: "chat", source: "workspace-conversation", channel: { id: "regular-group", type: 2 },
    }));
    expect(WKApp.endpoints.showConversation).toHaveBeenCalledTimes(1);
    act(() => mocks.command.listener?.({
      type: "navigate", page: "chat", presentation: "workspace",
      target: { channelId: "regular-group", channelType: 2 },
    }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(WKApp.endpoints.showConversation).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });

  it("does not apply the workspace attachment guard to ordinary Messages navigation", async () => {
    WKApp.shared.pendingAttachmentGuard = () => false;
    render(<CommunicationShell bridge={mocks.bridge}
      initialPage="chat" initialSpaceId="space-a"
      initialPresentation="workspace" onReady={async () => {}} />);
    act(() => mocks.command.listener?.({
      type: "navigate", page: "chat", target: { channelId: "regular-group", channelType: 2 },
    }));
    await waitFor(() => expect(WKApp.endpoints.showConversation).toHaveBeenCalledTimes(1));
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(vi.mocked(WKApp.endpoints.showConversation).mock.lastCall?.[1]?.preserveCurrentConversation).toBeUndefined();
  });

  it("opts into workspace embedding and sends subgroup clicks to full Messages without opening a panel", async () => {
    render(<CommunicationShell bridge={mocks.bridge as any}
      initialPage="chat" initialSpaceId="space-a"
      initialPresentation="conversation" onReady={async () => {}} />);
    act(() => mocks.command.listener?.({
      type: "navigate", page: "chat", presentation: "conversation",
      target: { channelId: "group-a", channelType: 2, variant: "workspace-group" },
    }));
    await waitFor(() => expect(WKApp.endpoints.showConversation).toHaveBeenCalledTimes(1));
    const [channel, options] = vi.mocked(WKApp.endpoints.showConversation).mock.calls[0];
    expect(channel).toMatchObject({ channelID: "group-a", channelType: 2 });
    expect(options?.workspaceEmbedding).toBeDefined();
    options!.workspaceEmbedding!.openConversation({ channelID: "group-a____topic", channelType: 5 } as any);
    await waitFor(() => expect(mocks.bridge.reportNavigation).toHaveBeenCalledWith({
      page: "chat", source: "workspace-conversation",
      channel: { id: "group-a____topic", type: 5 },
    }));
    expect(WKApp.endpoints.showConversation).toHaveBeenCalledTimes(1);
  });

  it.each([
    { channelId: "person-a", channelType: 1, variant: "workspace-group" },
    { channelId: "group-a", channelType: 2, variant: "app-bot" },
  ])("rejects incompatible legacy conversation target $variant/$channelType", async (target) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<CommunicationShell bridge={mocks.bridge as any}
      initialPage="chat" initialSpaceId="space-a"
      initialPresentation="conversation" onReady={async () => {}} />);

    act(() => mocks.command.listener?.({
      type: "navigate", page: "chat", presentation: "workspace", target,
    }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(WKApp.endpoints.showConversation).not.toHaveBeenCalled();
    expect(mocks.bridge.reportNavigation).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "[client-communication] rejected incompatible conversation target",
      target,
    );
    consoleError.mockRestore();
  });

  it("preserves the same workspace conversation across hide/show and restores default behavior on leaving", async () => {
    render(<CommunicationShell bridge={mocks.bridge as any}
      initialPage="chat" initialSpaceId="space-a"
      initialPresentation="conversation" onReady={async () => {}} />);
    const command = {
      type: "navigate", page: "chat", presentation: "conversation",
      target: { channelId: "group-a", channelType: 2, variant: "workspace-group" },
    };
    act(() => mocks.command.listener?.(command));
    await waitFor(() => expect(WKApp.endpoints.showConversation).toHaveBeenCalledTimes(1));
    WKApp.shared.openChannel = vi.mocked(WKApp.endpoints.showConversation).mock.calls[0][0];
    act(() => {
      mocks.command.listener?.({ type: "suspend" });
      mocks.command.listener?.({ type: "resume" });
      mocks.command.listener?.(command);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(WKApp.endpoints.showConversation).toHaveBeenCalledTimes(1);
    act(() => mocks.command.listener?.({ type: "navigate", page: "chat", presentation: "workspace" }));
    await waitFor(() => expect(WKApp.endpoints.showConversation).toHaveBeenCalledTimes(2));
    expect(vi.mocked(WKApp.endpoints.showConversation).mock.calls[1][1]?.workspaceEmbedding).toBeUndefined();
    expect(vi.mocked(WKApp.endpoints.showConversation).mock.calls[1][1]?.preserveCurrentConversation).toBe(true);
    act(() => mocks.command.listener?.({ type: "navigate", page: "chat", presentation: "workspace" }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(WKApp.endpoints.showConversation).toHaveBeenCalledTimes(2);
    act(() => mocks.command.listener?.(command));
    await waitFor(() => expect(WKApp.endpoints.showConversation).toHaveBeenCalledTimes(3));
    expect(vi.mocked(WKApp.endpoints.showConversation).mock.calls[2][1]?.preserveCurrentConversation).toBe(true);
  });

  it("invalidates old workspace callbacks after another group or Space is selected", async () => {
    render(<CommunicationShell bridge={mocks.bridge as any}
      initialPage="chat" initialSpaceId="space-a"
      initialPresentation="conversation" onReady={async () => {}} />);
    act(() => mocks.command.listener?.({
      type: "navigate", page: "chat", presentation: "conversation",
      target: { channelId: "group-a", channelType: 2, variant: "workspace-group" },
    }));
    await waitFor(() => expect(WKApp.endpoints.showConversation).toHaveBeenCalledTimes(1));
    const open = vi.mocked(WKApp.endpoints.showConversation).mock.calls[0][1]!.workspaceEmbedding!.openConversation;
    act(() => mocks.command.listener?.({
      type: "spaceChanged", space: { id: "space-b", name: "B" },
    }));
    mocks.bridge.reportNavigation.mockClear();
    open({ channelID: "old-topic", channelType: 6 } as any);
    await Promise.resolve();
    expect(mocks.bridge.reportNavigation).not.toHaveBeenCalled();
    expect(WKApp.routeRight.popToRoot).toHaveBeenCalled();
  });

  it("keeps one embedded Contacts header and preserves child state while switching visible pages", async () => {
    const { container } = render(
      <CommunicationShell bridge={mocks.bridge as any}
        initialPage="contacts" initialSpaceId="space-a"
        initialPresentation="workspace" onReady={async () => {}} />,
    );
    const header = container.querySelector(".communication-contacts-header");
    const body = container.querySelector(".communication-contacts-body");
    const contactsPage = body?.closest<HTMLElement>(".communication-page");
    const input = body?.querySelector("input")!;
    expect(header?.textContent).toBe("contacts.page.title");
    expect(container.querySelectorAll(".communication-contacts-header")).toHaveLength(1);
    expect(contactsPage?.style.display).toBe("block");
    fireEvent.change(input, { target: { value: "preserved search" } });
    act(() => mocks.command.listener?.({ type: "navigate", page: "chat" }));
    expect(contactsPage?.style.display).toBe("none");
    act(() => mocks.command.listener?.({ type: "navigate", page: "contacts" }));
    expect(contactsPage?.style.display).toBe("block");
    expect(container.querySelector(".communication-contacts-header")).toBe(header);
    expect(container.querySelector(".communication-contacts-body")).toBe(body);
    expect(body?.querySelector("input")).toBe(input);
    expect(input.value).toBe("preserved search");
  });

  it("reports ready once during the React StrictMode effect cycle", async () => {
    const onReady = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    render(
      <React.StrictMode>
        <CommunicationShell
          bridge={mocks.bridge as any}
          initialPage="chat"
          initialSpaceId="space-a"
          initialPresentation="workspace"
          onReady={onReady}
        />
      </React.StrictMode>,
    );

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("reports the latest page and space when commands arrive before ready runs", async () => {
    const onReady = vi.fn().mockResolvedValue(undefined);

    render(
      <CommunicationShell
        bridge={mocks.bridge as any}
        initialPage="chat"
        initialSpaceId="space-a"
        initialPresentation="workspace"
        onReady={onReady}
      />,
    );

    expect(mocks.command.listener).toBeTypeOf("function");
    mocks.command.listener?.({ type: "navigate", page: "contacts" });
    mocks.command.listener?.({
      type: "spaceChanged",
      space: { id: "space-b", name: "Space B" },
    });

    await waitFor(() => expect(onReady).toHaveBeenCalledWith({
      page: "contacts",
      spaceId: "space-b",
    }));
  });

  it("restores desktop readiness using live Shell navigation and Space on every retry", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const state: DesktopPresentation = {
      version: 1, revision: 1, platform: "win32", canFuse: true,
      headerHeight: 48, fallbackHeight: 48,
      topArea: { x: 0, y: 0, width: 1000, height: 48 }, controls: [],
      focused: true, maximized: false, fullScreen: false,
    };
    const bridge: OctoBuddyCommunicationBridge = {
      ...mocks.bridge,
      getDesktopPresentation: async () => state,
      onDesktopPresentation: () => () => {},
    };
    WKApp.shared.currentSpaceId = "space-a";
    const lifecycle = installDesktopPresentationLifecycle(window, bridge, document.body, () => ({
      page: WKApp.currentMenuId === "contacts" ? "contacts" : "chat",
      spaceId: WKApp.shared.currentSpaceId,
    }));
    await vi.advanceTimersByTimeAsync(50);
    expect(await lifecycle.available).toBe(true);
    const onReady = vi.fn((context: { page: "chat" | "contacts"; spaceId: string }) =>
      lifecycle.reportReady({ ...context, bridgeVersion: 1, rendererVersion: "test" }));
    const shell = render(<CommunicationShell bridge={bridge} initialPage="chat"
      initialSpaceId="space-a" initialPresentation="workspace" onReady={onReady} />);
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(onReady).toHaveBeenCalledTimes(1);
      expect(mocks.bridge.reportReady).toHaveBeenLastCalledWith(expect.objectContaining({
        page: "chat", spaceId: "space-a", desktopPresentationVersion: 1,
      }));
      act(() => {
        WKApp.switchToMenuById?.("contacts");
        mocks.command.listener?.({ type: "spaceChanged", space: { id: "space-b", name: "B" } });
      });
      mocks.bridge.reportReady.mockRejectedValueOnce(new Error("IPC temporarily unavailable"));
      window.dispatchEvent(new Event("pagehide"));
      const restored = new Event("pageshow");
      Object.defineProperty(restored, "persisted", { value: true });
      window.dispatchEvent(restored);
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(mocks.bridge.reportReady).toHaveBeenLastCalledWith(expect.objectContaining({
        page: "contacts", spaceId: "space-b", desktopPresentationVersion: 1,
      }));
      act(() => {
        mocks.command.listener?.({ type: "navigate", page: "chat" });
        mocks.command.listener?.({ type: "spaceChanged", space: { id: "space-c", name: "C" } });
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(mocks.bridge.reportReady).toHaveBeenCalledTimes(3);
      expect(mocks.bridge.reportReady).toHaveBeenLastCalledWith(expect.objectContaining({
        page: "chat", spaceId: "space-c", desktopPresentationVersion: 1,
      }));
      expect(onReady).toHaveBeenCalledTimes(1);
    } finally {
      lifecycle.dispose();
      shell.unmount();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("isolates synchronous and asynchronous navigation reporting failures", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const syncError = new Error("synchronous navigation failure");
    const asyncError = new Error("asynchronous navigation failure");
    mocks.bridge.reportNavigation
      .mockImplementationOnce(() => {
        throw syncError;
      })
      .mockRejectedValueOnce(asyncError);

    render(
      <CommunicationShell
        bridge={mocks.bridge as any}
        initialPage="chat"
        initialSpaceId="space-a"
        initialPresentation="workspace"
        onReady={vi.fn(async () => {})}
      />,
    );

    expect(() => WKApp.switchToMenuById?.("contacts")).not.toThrow();
    await waitFor(() => expect(consoleSpy).toHaveBeenCalledWith(
      "[client-communication] failed to report navigation",
      syncError,
    ));

    expect(() => WKApp.switchToMenuById?.("chat")).not.toThrow();
    await waitFor(() => expect(consoleSpy).toHaveBeenCalledWith(
      "[client-communication] failed to report navigation",
      asyncError,
    ));
    consoleSpy.mockRestore();
  });

  it("isolates unread reporting failures from renderer startup", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("unread IPC failure");
    mocks.bridge.reportUnread.mockImplementationOnce(() => {
      throw error;
    });

    expect(() => render(
      <CommunicationShell
        bridge={mocks.bridge as any}
        initialPage="chat"
        initialSpaceId="space-a"
        initialPresentation="workspace"
        onReady={vi.fn(async () => {})}
      />,
    )).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(
      "[client-communication] failed to report unread count",
      error,
    );
    consoleSpy.mockRestore();
  });

  it("does not install page-owned unread or summary handlers in runtime mode", () => {
    render(
      <React.StrictMode>
        <CommunicationShell
          bridge={mocks.bridge as any}
          initialPage="chat"
          initialSpaceId="space-a"
          initialPresentation="workspace"
          runtimeOwned
          onReady={vi.fn(async () => {})}
        />
      </React.StrictMode>,
    );
    expect(mocks.subscribeUnread).not.toHaveBeenCalled();
    expect(mocks.bridge.reportUnread).not.toHaveBeenCalled();
    expect(mocks.bridge.onSummaryRequest).not.toHaveBeenCalled();
  });

  it("forwards shared snapshots across StrictMode and bridge replacement without leaking subscriptions", () => {
    let count = 7;
    const changes = new Set<() => void>();
    const disposeUpstream = vi.fn();
    const subscribeChanges = vi.fn((listener: () => void) => {
      changes.add(listener);
      return () => { changes.delete(listener); disposeUpstream(); };
    });
    const observer = createUnreadCountObserver({
      readCount: () => count,
      subscribeChanges,
      onError: (error) => { throw error; },
    });
    mocks.subscribeUnread.mockImplementation(observer.subscribe);
    const nextBridge: OctoBuddyCommunicationBridge = { ...mocks.bridge, reportUnread: vi.fn() };
    const onReady = vi.fn(async () => {});
    const content = (bridge: OctoBuddyCommunicationBridge) => (
      <React.StrictMode>
        <CommunicationShell bridge={bridge} initialPage="chat" initialSpaceId="space-a"
          initialPresentation="workspace" onReady={onReady} />
      </React.StrictMode>
    );
    const shell = render(content(mocks.bridge));
    try {
      expect(changes.size).toBe(1);
      expect(mocks.bridge.reportUnread).toHaveBeenLastCalledWith(7);
      count = 3;
      act(() => changes.forEach((changed) => changed()));
      expect(mocks.bridge.reportUnread).toHaveBeenLastCalledWith(3);

      shell.rerender(content(nextBridge));
      expect(changes.size).toBe(1);
      expect(nextBridge.reportUnread).toHaveBeenLastCalledWith(3);
      mocks.bridge.reportUnread.mockClear();
      count = 0;
      act(() => changes.forEach((changed) => changed()));
      expect(nextBridge.reportUnread).toHaveBeenLastCalledWith(0);
      expect(mocks.bridge.reportUnread).not.toHaveBeenCalled();
    } finally {
      shell.unmount();
    }
    expect(changes.size).toBe(0);
    expect(disposeUpstream).toHaveBeenCalledTimes(subscribeChanges.mock.calls.length);
  });

  it("updates the document language when the host appearance changes", async () => {
    render(
      <CommunicationShell
        bridge={mocks.bridge as any}
        initialPage="chat"
        initialSpaceId="space-a"
        initialPresentation="workspace"
        onReady={vi.fn(async () => {})}
      />,
    );

    await waitFor(() => expect(mocks.command.listener).toBeTypeOf("function"));
    mocks.command.listener?.({
      type: "appearanceChanged",
      theme: "dark",
      locale: "en-US",
    });

    expect(document.documentElement.lang).toBe("en-US");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(i18n.setLocale).toHaveBeenCalledWith("en-US", { persist: false });
  });

  it("preserves app metadata when opening a bot conversation", async () => {
    render(
      <CommunicationShell
        bridge={mocks.bridge as any}
        initialPage="chat"
        initialSpaceId="space-a"
        initialPresentation="workspace"
        onReady={vi.fn(async () => {})}
      />,
    );

    await waitFor(() => expect(mocks.command.listener).toBeTypeOf("function"));
    mocks.command.listener?.({
      type: "navigate",
      page: "chat",
      presentation: "conversation",
      target: {
        channelId: "bot-1",
        channelType: 1,
        displayName: "Docs Bot",
        avatar: "users/bot-1/avatar",
        metadata: { displayName: "Docs Bot", robot: 1, name: "Docs Bot" },
      },
    });

    await waitFor(() => expect(WKApp.endpoints.showConversation).toHaveBeenCalled());
    expect(mocks.setCurrentImChannelInfoCache).toHaveBeenCalledWith(expect.objectContaining({
      title: "Docs Bot",
      logo: "users/bot-1/avatar",
      orgData: { displayName: "Docs Bot", robot: 1, name: "Docs Bot" },
    }));
    expect(mocks.createCurrentEmptyImConversation).toHaveBeenCalledWith(expect.objectContaining({
      channelID: "bot-1",
      channelType: 1,
    }));
  });

  it("merges app metadata into an existing bot channel without dropping server fields", async () => {
    const cached = {
      channel: undefined,
      title: "Server Bot",
      logo: "server-avatar",
      orgData: { bot_commands: [{ command: "help" }], online: 1 },
    };
    mocks.getCurrentImChannelInfo.mockReturnValue(cached);

    render(
      <CommunicationShell
        bridge={mocks.bridge as any}
        initialPage="chat"
        initialSpaceId="space-a"
        initialPresentation="workspace"
        onReady={vi.fn(async () => {})}
      />,
    );

    await waitFor(() => expect(mocks.command.listener).toBeTypeOf("function"));
    mocks.command.listener?.({
      type: "navigate",
      page: "chat",
      presentation: "conversation",
      target: {
        channelId: "bot-1",
        channelType: 1,
        displayName: "Docs Bot",
        metadata: { displayName: "Docs Bot", robot: 1, name: "Docs Bot" },
      },
    });

    await waitFor(() => expect(mocks.setCurrentImChannelInfoCache).toHaveBeenCalled());
    expect(cached).toMatchObject({
      title: "Docs Bot",
      logo: "server-avatar",
      orgData: {
        bot_commands: [{ command: "help" }],
        online: 1,
        displayName: "Docs Bot",
        robot: 1,
        name: "Docs Bot",
      },
    });
  });

  it("uses the Web app conversation view only for explicit app targets and restores regular chat", async () => {
    render(
      <CommunicationShell
        bridge={mocks.bridge as any}
        initialPage="chat"
        initialSpaceId="space-a"
        initialPresentation="conversation"
        onReady={vi.fn(async () => {})}
      />,
    );
    act(() => mocks.command.listener?.({
      type: "navigate",
      page: "chat",
      presentation: "conversation",
      target: { channelId: "bot-1", channelType: 1, displayName: "Docs Bot", variant: "app-bot" },
    }));
    await waitFor(() => expect(WKApp.routeRight.replaceToRoot).toHaveBeenCalled());
    const view = vi.mocked(WKApp.routeRight.replaceToRoot).mock.calls[0][0] as React.ReactElement;
    expect(view.props.className).toBe("appbot-chat-wrap");
    expect(view.props.children).toBe("Docs Bot");
    expect(WKApp.endpoints.showConversation).not.toHaveBeenCalled();

    act(() => {
      mocks.command.listener?.({ type: "navigate", page: "chat", presentation: "workspace" });
      mocks.command.listener?.({ type: "navigate", page: "chat", presentation: "workspace" });
    });
    await waitFor(() => expect(WKApp.endpoints.showConversation).toHaveBeenCalledWith(
      expect.objectContaining({ channelID: "bot-1" }),
      expect.any(Object),
    ));
  });

  it("does not reopen an app conversation when switching to contacts", async () => {
    render(
      <CommunicationShell
        bridge={mocks.bridge as any}
        initialPage="chat"
        initialSpaceId="space-a"
        initialPresentation="conversation"
        onReady={vi.fn(async () => {})}
      />,
    );
    act(() => mocks.command.listener?.({
      type: "navigate", page: "chat",
      target: { channelId: "bot-1", channelType: 1, displayName: "Docs Bot", variant: "app-bot" },
    }));
    await waitFor(() => expect(WKApp.routeRight.replaceToRoot).toHaveBeenCalled());
    vi.mocked(WKApp.routeRight.replaceToRoot).mockClear();
    act(() => mocks.command.listener?.({ type: "navigate", page: "contacts", presentation: "workspace" }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(WKApp.routeRight.replaceToRoot).not.toHaveBeenCalled();
    expect(WKApp.endpoints.showConversation).not.toHaveBeenCalled();
  });

  it("serves summary messaging requests through the communication runtime", async () => {
    render(
      <CommunicationShell
        bridge={mocks.bridge as any}
        initialPage="chat"
        initialSpaceId="space-a"
        initialPresentation="workspace"
        onReady={vi.fn(async () => {})}
      />,
    );

    await waitFor(() => expect(mocks.summaryRequest.listener).toBeTypeOf("function"));
    mocks.summaryRequest.listener?.({
      requestId: "request-1",
      spaceId: "space-a",
      operation: "loadConversationMembers",
      payload: { channelId: "group-1", channelType: 2 },
    });

    await waitFor(() => expect(mocks.bridge.respondSummaryRequest).toHaveBeenCalledWith({
      requestId: "request-1",
      ok: true,
      result: [{ uid: "user-1", name: "User 1" }],
    }));
  });

  it("finishes a summary forward request immediately when selection is cancelled", async () => {
    render(
      <CommunicationShell
        bridge={mocks.bridge as any}
        initialPage="chat"
        initialSpaceId="space-a"
        initialPresentation="workspace"
        onReady={vi.fn(async () => {})}
      />,
    );

    await waitFor(() => expect(mocks.summaryRequest.listener).toBeTypeOf("function"));
    mocks.summaryRequest.listener?.({
      requestId: "request-cancel",
      spaceId: "space-a",
      operation: "requestForward",
      payload: { content: "summary", title: "Forward" },
    });

    await waitFor(() => expect(mocks.requestForward).toHaveBeenCalled());
    mocks.requestForward.mock.calls[0][0].onCancel();
    expect(mocks.bridge.respondSummaryRequest).toHaveBeenCalledWith({
      requestId: "request-cancel",
      ok: true,
      result: null,
    });
  });

  it("rejects delayed member results and forward callbacks after A-B-A Space changes", async () => {
    let resolveMembers!: (members: { uid: string; name: string }[]) => void;
    mocks.loadConversationMembers.mockReturnValueOnce(new Promise((resolve) => {
      resolveMembers = resolve;
    }));
    render(
      <CommunicationShell
        bridge={mocks.bridge as any}
        initialPage="chat"
        initialSpaceId="space-a"
        initialPresentation="workspace"
        onReady={vi.fn(async () => {})}
      />,
    );
    await waitFor(() => expect(mocks.summaryRequest.listener).toBeTypeOf("function"));
    mocks.summaryRequest.listener?.({
      requestId: "pending-members",
      spaceId: "space-a",
      operation: "loadConversationMembers",
      payload: { channelId: "group-1", channelType: 2 },
    });
    await waitFor(() => expect(mocks.loadConversationMembers).toHaveBeenCalled());
    mocks.summaryRequest.listener?.({
      requestId: "pending-forward",
      spaceId: "space-a",
      operation: "requestForward",
      payload: { content: "summary", title: "Forward" },
    });
    await waitFor(() => expect(mocks.requestForward).toHaveBeenCalled());
    const forward = mocks.requestForward.mock.calls[0][0];
    expect(forward.isActive()).toBe(true);
    act(() => {
      mocks.command.listener?.({ type: "spaceChanged", space: { id: "space-b", name: "B" } });
      mocks.command.listener?.({ type: "spaceChanged", space: { id: "space-a", name: "A" } });
    });
    expect(forward.isActive()).toBe(false);
    forward.onComplete({});
    resolveMembers([{ uid: "old-member", name: "Old member" }]);
    await waitFor(() => expect(mocks.bridge.respondSummaryRequest).toHaveBeenCalledWith({
      requestId: "pending-members",
      ok: false,
      error: "Summary request context expired",
    }));
    expect(mocks.bridge.respondSummaryRequest).toHaveBeenCalledWith({
      requestId: "pending-forward",
      ok: false,
      error: "Summary request context expired",
    });
  });

  it("rejects requests belonging to another Space before invoking messaging", async () => {
    render(
      <CommunicationShell
        bridge={mocks.bridge as any}
        initialPage="chat"
        initialSpaceId="space-a"
        initialPresentation="workspace"
        onReady={vi.fn(async () => {})}
      />,
    );
    await waitFor(() => expect(mocks.summaryRequest.listener).toBeTypeOf("function"));
    mocks.summaryRequest.listener?.({
      requestId: "wrong-space",
      spaceId: "space-b",
      operation: "loadConversationMembers",
      payload: { channelId: "group-1", channelType: 2 },
    });
    await waitFor(() => expect(mocks.bridge.respondSummaryRequest).toHaveBeenCalledWith({
      requestId: "wrong-space",
      ok: false,
      error: "Summary request context expired",
    }));
    expect(mocks.loadConversationMembers).not.toHaveBeenCalled();
  });
});
