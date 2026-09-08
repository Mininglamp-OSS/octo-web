// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppBots } from "../bridge/useAppBots";
import { AppBotHostProvider } from "../host/AppBotHostContext";
import type { AppBotHostCapabilities, AppBotSpace } from "../host/types";

vi.mock("../Service/AppBotService", () => ({
  default: {
    getAvailableBots: vi.fn(),
  },
}));

import AppBotService from "../Service/AppBotService";

const state = {
  currentSpace: { id: "space-a", name: "Alpha" } as AppBotSpace,
  spaceChangedListener: undefined as (() => void) | undefined,
};

const host: AppBotHostCapabilities = {
  getCurrentSpace: () => state.currentSpace,
  resolveSpaceName: vi.fn(async (spaceId) =>
    spaceId === "space-b" ? "Beta" : "Alpha"
  ),
  subscribeSpaceChanged: vi.fn((listener) => {
    state.spaceChangedListener = listener;
    return () => {
      if (state.spaceChangedListener === listener) {
        state.spaceChangedListener = undefined;
      }
    };
  }),
  openConversation: vi.fn(async () => {}),
  clearConversation: vi.fn(),
  isOctoAssistant: () => false,
  track: vi.fn(),
};

let container: HTMLDivElement;
let latest: ReturnType<typeof useAppBots> | undefined;

function HookHarness({ onSpaceChanged }: { onSpaceChanged: () => void }) {
  latest = useAppBots({ onSpaceChanged });
  return null;
}

function Harness({ onSpaceChanged }: { onSpaceChanged: () => void }) {
  return (
    <AppBotHostProvider host={host}>
      <HookHarness onSpaceChanged={onSpaceChanged} />
    </AppBotHostProvider>
  );
}

async function flushEffects() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useAppBots host behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.currentSpace = { id: "space-a", name: "Alpha" };
    state.spaceChangedListener = undefined;
    latest = undefined;
    vi.mocked(AppBotService.getAvailableBots).mockResolvedValue([]);
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => ReactDOM.unmountComponentAtNode(container));
    container.remove();
  });

  it("reloads bots from the host and resets selection when Space changes", async () => {
    const onSpaceChanged = vi.fn();

    await act(async () => {
      ReactDOM.render(<Harness onSpaceChanged={onSpaceChanged} />, container);
      await flushEffects();
    });

    expect(AppBotService.getAvailableBots).toHaveBeenCalledWith("space-a");
    expect(latest?.spaceName).toBe("Alpha");
    expect(host.resolveSpaceName).not.toHaveBeenCalled();
    expect(state.spaceChangedListener).toBeTypeOf("function");

    state.currentSpace = { id: "space-b", name: "" };
    await act(async () => {
      state.spaceChangedListener?.();
      await flushEffects();
    });

    expect(onSpaceChanged).toHaveBeenCalledTimes(1);
    expect(AppBotService.getAvailableBots).toHaveBeenLastCalledWith("space-b");
    expect(host.resolveSpaceName).toHaveBeenCalledWith("space-b");
    expect(latest?.spaceName).toBe("Beta");
  });

  it("unsubscribes its host Space listener when the workspace unmounts", async () => {
    await act(async () => {
      ReactDOM.render(<Harness onSpaceChanged={vi.fn()} />, container);
      await flushEffects();
    });

    expect(state.spaceChangedListener).toBeTypeOf("function");

    act(() => ReactDOM.unmountComponentAtNode(container));

    expect(state.spaceChangedListener).toBeUndefined();
  });

  it("ignores a stale Space name response after switching away and back", async () => {
    let resolveFirstName: ((name: string) => void) | undefined;
    vi.mocked(host.resolveSpaceName)
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveFirstName = resolve;
          })
      )
      .mockResolvedValueOnce("Alpha latest");
    state.currentSpace = { id: "space-a", name: "" };

    await act(async () => {
      ReactDOM.render(<Harness onSpaceChanged={vi.fn()} />, container);
      await flushEffects();
    });

    state.currentSpace = { id: "space-b", name: "Beta" };
    await act(async () => {
      state.spaceChangedListener?.();
      await flushEffects();
    });

    state.currentSpace = { id: "space-a", name: "" };
    await act(async () => {
      state.spaceChangedListener?.();
      await flushEffects();
    });
    expect(latest?.spaceName).toBe("Alpha latest");

    await act(async () => {
      resolveFirstName?.("Alpha stale");
      await flushEffects();
    });

    expect(latest?.spaceName).toBe("Alpha latest");
  });
});
