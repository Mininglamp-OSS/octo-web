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
  invalidationListener: undefined as (() => void) | undefined,
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
  subscribeInvalidation: vi.fn((listener) => {
    state.invalidationListener = listener;
    return () => { if (state.invalidationListener === listener) state.invalidationListener = undefined; };
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("useAppBots host behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.currentSpace = { id: "space-a", name: "Alpha" };
    state.spaceChangedListener = undefined;
    state.invalidationListener = undefined;
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
    expect(state.invalidationListener).toBeUndefined();
  });

  it("silently refreshes the list without resetting search or invoking Space selection reset", async () => {
    const onSpaceChanged = vi.fn();
    const bot = { id: "1", uid: "bot-1", display_name: "Search old", scope: "space" as const };
    vi.mocked(AppBotService.getAvailableBots).mockResolvedValue([bot]);
    await act(async () => {
      ReactDOM.render(<Harness onSpaceChanged={onSpaceChanged} />, container);
      await flushEffects();
    });
    act(() => latest?.setKeyword("Search"));
    let finish!: (bots: typeof bot[]) => void;
    vi.mocked(AppBotService.getAvailableBots).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    act(() => state.invalidationListener?.());
    expect(latest?.state).toBe("ready");
    expect(latest?.filteredBots[0].displayName).toBe("Search old");
    await act(async () => { finish([bot, { ...bot, id: "2", uid: "bot-2", display_name: "Search new" }]); });
    expect(latest?.filteredBots).toHaveLength(2);
    expect(latest?.keyword).toBe("Search");
    expect(onSpaceChanged).not.toHaveBeenCalled();
  });

  it("keeps a foreground bot load alive when a silent invalidation fails", async () => {
    const bot = { id: "1", uid: "bot-1", display_name: "Initial", scope: "space" as const };
    const initial = deferred<typeof bot[]>();
    vi.mocked(AppBotService.getAvailableBots)
      .mockReturnValueOnce(initial.promise)
      .mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      ReactDOM.render(<Harness onSpaceChanged={vi.fn()} />, container);
      await Promise.resolve();
    });
    expect(latest?.state).toBe("loading");
    await act(async () => {
      state.invalidationListener?.();
      await flushEffects();
    });
    expect(latest?.state).toBe("loading");
    await act(async () => {
      initial.resolve([bot]);
      await flushEffects();
    });
    expect(latest?.state).toBe("ready");
    expect(latest?.filteredBots[0].displayName).toBe("Initial");
  });

  it("keeps a successful silent snapshot after the older foreground bot load resolves", async () => {
    const bot = { id: "1", uid: "bot-1", display_name: "Initial", scope: "space" as const };
    const initial = deferred<typeof bot[]>();
    vi.mocked(AppBotService.getAvailableBots)
      .mockReturnValueOnce(initial.promise)
      .mockResolvedValueOnce([{ ...bot, display_name: "Latest" }]);
    await act(async () => {
      ReactDOM.render(<Harness onSpaceChanged={vi.fn()} />, container);
      await flushEffects();
    });
    expect(latest?.state).toBe("loading");
    await act(async () => {
      state.invalidationListener?.();
      await flushEffects();
    });
    expect(latest?.state).toBe("ready");
    expect(latest?.filteredBots[0].displayName).toBe("Latest");
    await act(async () => {
      initial.resolve([bot]);
      await flushEffects();
    });
    expect(latest?.state).toBe("ready");
    expect(latest?.filteredBots[0].displayName).toBe("Latest");
  });

  it("discards stale refreshes after later invalidation and Space changes", async () => {
    const bot = { id: "1", uid: "bot-1", display_name: "Old", scope: "space" as const };
    await act(async () => {
      ReactDOM.render(<Harness onSpaceChanged={vi.fn()} />, container);
      await flushEffects();
    });
    let finish!: (bots: typeof bot[]) => void;
    vi.mocked(AppBotService.getAvailableBots).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    act(() => state.invalidationListener?.());
    vi.mocked(AppBotService.getAvailableBots).mockResolvedValue([{ ...bot, display_name: "Latest" }]);
    await act(async () => { state.invalidationListener?.(); });
    await act(async () => { finish([bot]); });
    expect(latest?.filteredBots[0].displayName).toBe("Latest");
    vi.mocked(AppBotService.getAvailableBots).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    act(() => state.invalidationListener?.());
    state.currentSpace = { id: "space-b", name: "Beta" };
    vi.mocked(AppBotService.getAvailableBots).mockResolvedValue([]);
    await act(async () => { state.spaceChangedListener?.(); });
    await act(async () => { finish([bot]); });
    expect(latest?.filteredBots).toEqual([]);
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
