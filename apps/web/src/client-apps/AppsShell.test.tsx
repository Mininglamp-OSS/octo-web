// @vitest-environment jsdom

import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  command: {
    listener: undefined as ((command: any) => void) | undefined,
  },
  workspaceProps: undefined as any,
  workspaceMounts: 0,
  bridge: {
    openConversation: vi.fn(async () => {}),
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

vi.mock("@dmwork/appbot", () => ({
  AppsWorkspace: (props: any) => {
    React.useEffect(() => {
      mocks.workspaceMounts += 1;
    }, []);
    mocks.workspaceProps = props;
    return <div data-testid="apps-workspace" />;
  },
}));

vi.mock("@octo/base", () => ({
  Dap: { shared: { track: vi.fn() } },
  SpaceService: {
    shared: {
      getMySpaces: vi.fn(async () => [
        { space_id: "space-b", name: "Space B" },
      ]),
    },
  },
  ThemeMode: { light: "light", dark: "dark" },
  WKApp: {
    config: {},
    loginInfo: { logout: vi.fn() },
    remoteConfig: { octoAssistantUids: ["assistant-a"] },
    shared: {
      currentSpaceId: "space-a",
      notifyListener: vi.fn(),
    },
  },
  i18n: { setLocale: vi.fn() },
}));

import { WKApp, i18n } from "@octo/base";
import { AppsShell } from "./AppsShell";

describe("AppsShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.command.listener = undefined;
    mocks.workspaceProps = undefined;
    mocks.workspaceMounts = 0;
    document.documentElement.removeAttribute("data-space-id");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-host-visibility");
  });

  it("reports ready once during the React StrictMode effect cycle", async () => {
    const onReady = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    render(
      <React.StrictMode>
        <AppsShell
          bridge={mocks.bridge as any}
          initialSpace={{ id: "space-a", name: "Space A" }}
          onReady={onReady}
        />
      </React.StrictMode>
    );

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(onReady).toHaveBeenCalledWith({ spaceId: "space-a" });
  });

  it("synchronizes space and appearance commands with the workspace host", () => {
    render(
      <AppsShell
        bridge={mocks.bridge as any}
        initialSpace={{ id: "space-a", name: "Space A" }}
        onReady={vi.fn(async () => {})}
      />
    );
    const onSpaceChanged = vi.fn();
    mocks.workspaceProps.host.subscribeSpaceChanged(onSpaceChanged);

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
      mocks.command.listener?.({ type: "suspend" });
    });

    expect(mocks.workspaceProps.host.getCurrentSpace()).toEqual({
      id: "space-b",
      name: "Space B",
    });
    expect(WKApp.shared.currentSpaceId).toBe("space-b");
    expect(document.documentElement.dataset.spaceId).toBe("space-b");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.lang).toBe("en-US");
    expect(document.documentElement.dataset.hostVisibility).toBe("hidden");
    expect(i18n.setLocale).toHaveBeenCalledWith("en-US", { persist: false });
    expect(onSpaceChanged).toHaveBeenCalledTimes(1);
  });

  it("delegates conversations and reloads the workspace on host command", async () => {
    render(
      <AppsShell
        bridge={mocks.bridge as any}
        initialSpace={{ id: "space-a", name: "Space A" }}
        onReady={vi.fn(async () => {})}
      />
    );
    await waitFor(() => expect(mocks.workspaceMounts).toBe(1));

    const target = { channelId: "bot-a", channelType: 1 };
    await mocks.workspaceProps.host.openConversation(target);
    expect(mocks.bridge.openConversation).toHaveBeenCalledWith(target);

    act(() => mocks.command.listener?.({ type: "reload" }));
    await waitFor(() => expect(mocks.workspaceMounts).toBe(2));
  });

  it("sets hostVisibility explicitly for suspend and resume", () => {
    render(
      <AppsShell
        bridge={mocks.bridge as any}
        initialSpace={{ id: "space-a", name: "Space A" }}
        onReady={vi.fn(async () => {})}
      />
    );

    act(() => mocks.command.listener?.({ type: "suspend" }));
    expect(document.documentElement.dataset.hostVisibility).toBe("hidden");

    act(() => mocks.command.listener?.({ type: "resume" }));
    expect(document.documentElement.dataset.hostVisibility).toBe("visible");
  });

  it("ignores unknown commands without changing visibility", () => {
    render(
      <AppsShell
        bridge={mocks.bridge as any}
        initialSpace={{ id: "space-a", name: "Space A" }}
        onReady={vi.fn(async () => {})}
      />
    );

    document.documentElement.dataset.hostVisibility = "visible";
    act(() => mocks.command.listener?.({ type: "unknownCommand" as any }));
    expect(document.documentElement.dataset.hostVisibility).toBe("visible");

    act(() => mocks.command.listener?.({ type: "someRandomEvent" as any }));
    expect(document.documentElement.dataset.hostVisibility).toBe("visible");
  });
});
