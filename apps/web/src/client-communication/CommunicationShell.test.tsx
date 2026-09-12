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
    setCurrentImChannelInfoCache: vi.fn(),
    findCurrentImConversation: vi.fn(),
    createCurrentEmptyImConversation: vi.fn(),
    loadConversationMembers: vi.fn(async () => [{ uid: "user-1", name: "User 1" }]),
    requestForward: vi.fn(),
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

vi.mock("../App/electronUnreadCount", () => ({
  getElectronUnreadMessageCount: () => 0,
}));

vi.mock("@octo/contacts", () => ({
  ContactsList: () => {
    const [filter, setFilter] = React.useState("");
    return <input aria-label="contacts" value={filter} onChange={(event) => setFilter(event.target.value)} />;
  },
}));

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
  return {
    ChatPage: () => <div>chat</div>,
    getCurrentImChannelInfo: mocks.getCurrentImChannelInfo,
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
      shared: {
        openChannel: null,
        currentSpaceId: "space-a",
        addListener: vi.fn(() => () => {}),
        notifyListener: vi.fn(),
      },
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
    useI18n: () => ({ t: (key: string) => key }),
  };
});

import { CommunicationShell } from "./CommunicationShell";
import { WKApp, i18n } from "@octo/base";
import { installDesktopPresentationLifecycle } from "./desktopPresentationLifecycle";
import type { DesktopPresentation } from "./desktopPresentation";
import type { OctoBuddyCommunicationBridge } from "./hostBridge";

describe("CommunicationShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.command.listener = undefined;
    mocks.summaryRequest.listener = undefined;
    mocks.getCurrentImChannelInfo.mockReturnValue(undefined);
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
