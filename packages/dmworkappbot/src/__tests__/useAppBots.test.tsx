// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  currentSpaceId: "space-a",
  handlers: new Map<string, () => void>(),
  getMySpaces: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@octo/base", () => ({
  Dap: { shared: { track: state.track } },
  SpaceService: { shared: { getMySpaces: state.getMySpaces } },
  WKApp: {
    shared: {
      get currentSpaceId() {
        return state.currentSpaceId;
      },
    },
    mittBus: {
      on: (event: string, handler: () => void) =>
        state.handlers.set(event, handler),
      off: (event: string, handler: () => void) => {
        if (state.handlers.get(event) === handler) state.handlers.delete(event);
      },
    },
  },
}));

vi.mock("../Service/AppBotService", () => ({
  default: {
    getAvailableBots: vi.fn(),
  },
}));

import AppBotService from "../Service/AppBotService";
import { useAppBots } from "../bridge/useAppBots";

let container: HTMLDivElement;
let latest: ReturnType<typeof useAppBots> | undefined;

function Harness({ onSpaceChanged }: { onSpaceChanged: () => void }) {
  latest = useAppBots({ onSpaceChanged });
  return null;
}

async function flushEffects() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useAppBots Web behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.handlers.clear();
    state.currentSpaceId = "space-a";
    latest = undefined;
    vi.mocked(AppBotService.getAvailableBots).mockResolvedValue([]);
    state.getMySpaces.mockResolvedValue([
      { space_id: "space-a", name: "Alpha" },
      { space_id: "space-b", name: "Beta" },
    ]);
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => ReactDOM.unmountComponentAtNode(container));
    container.remove();
  });

  it("reloads bots and resets the current selection when Space changes", async () => {
    const onSpaceChanged = vi.fn();

    await act(async () => {
      ReactDOM.render(<Harness onSpaceChanged={onSpaceChanged} />, container);
      await flushEffects();
    });

    expect(AppBotService.getAvailableBots).toHaveBeenCalledWith("space-a");
    expect(latest?.spaceName).toBe("Alpha");
    expect(state.handlers.has("space-changed")).toBe(true);

    state.currentSpaceId = "space-b";
    await act(async () => {
      state.handlers.get("space-changed")?.();
      await flushEffects();
    });

    expect(onSpaceChanged).toHaveBeenCalledTimes(1);
    expect(AppBotService.getAvailableBots).toHaveBeenLastCalledWith("space-b");
    expect(latest?.spaceName).toBe("Beta");
  });

  it("unsubscribes its Space listener when the page unmounts", async () => {
    await act(async () => {
      ReactDOM.render(<Harness onSpaceChanged={vi.fn()} />, container);
      await flushEffects();
    });

    expect(state.handlers.has("space-changed")).toBe(true);

    act(() => ReactDOM.unmountComponentAtNode(container));

    expect(state.handlers.has("space-changed")).toBe(false);
  });
});
