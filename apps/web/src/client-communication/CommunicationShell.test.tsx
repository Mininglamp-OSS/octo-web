import React, { useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const command = {
    listener: undefined as ((command: any) => void) | undefined,
  };
  return {
    command,
    bridge: {
      getBootstrap: vi.fn(),
      reportReady: vi.fn(async () => {}),
      reportNavigation: vi.fn(async () => {}),
      reportUnread: vi.fn(),
      reportAuthExpired: vi.fn(),
      reportFatalError: vi.fn(),
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

vi.mock("../App/electronUnreadCount", () => ({
  getElectronUnreadMessageCount: () => 0,
}));

vi.mock("@octo/contacts", () => ({
  ContactsList: () => <div>contacts</div>,
}));

vi.mock("wukongimjssdk", () => ({
  Channel: class Channel {
    constructor(
      public channelID: string,
      public channelType: number,
    ) {}
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
  };
  const mittBus = {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  return {
    ChatPage: () => <div>chat</div>,
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
  };
});

import { CommunicationShell } from "./CommunicationShell";
import { WKApp, i18n } from "@octo/base";

describe("CommunicationShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.command.listener = undefined;
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
});
