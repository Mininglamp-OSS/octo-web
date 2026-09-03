import React, { useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bridge: {
    reportNavigation: vi.fn(async () => {}),
    reportUnread: vi.fn(),
    onCommand: vi.fn(() => () => {}),
  },
  conversationManager: {
    addConversationListener: vi.fn(),
    removeConversationListener: vi.fn(),
  },
}));

vi.mock("./hostBridge", () => ({
  requireHostBridge: () => mocks.bridge,
}));

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
import { WKApp } from "@octo/base";

describe("CommunicationShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports ready once during the React StrictMode effect cycle", async () => {
    const onReady = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    render(
      <React.StrictMode>
        <CommunicationShell
          initialPage="chat"
          initialPresentation="workspace"
          onReady={onReady}
        />
      </React.StrictMode>,
    );

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(onReady).toHaveBeenCalledTimes(1);
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
        initialPage="chat"
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
        initialPage="chat"
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
});
