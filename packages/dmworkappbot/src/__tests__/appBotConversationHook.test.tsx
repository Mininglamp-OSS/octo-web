// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppBotConversation } from "../features/appBotConversation";
import { AppBotHostProvider } from "../host/AppBotHostContext";
import type { AppBotHostCapabilities, AppBotSpace } from "../host/types";

vi.mock("../Service/AppBotService", () => ({
  default: {
    applyBot: vi.fn(),
  },
}));

import AppBotService from "../Service/AppBotService";

const botA = {
  id: "bot-a",
  uid: "robot_a",
  displayName: "Bot A",
  description: "First",
  scope: "space" as const,
};
const botB = {
  id: "bot-b",
  uid: "robot_b",
  displayName: "Bot B",
  description: "Second",
  scope: "space" as const,
};
const botC = {
  id: "bot-c",
  uid: "robot_c",
  displayName: "Bot C",
  description: "Third",
  scope: "space" as const,
};

interface MutableHost {
  currentSpace: AppBotSpace;
  spaceListeners: Array<() => void>;
}

function makeMutableHost(
  initialSpace: AppBotSpace = { id: "space-a", name: "Alpha" }
): {
  mutable: MutableHost;
  host: AppBotHostCapabilities;
} {
  const mutable: MutableHost = {
    currentSpace: initialSpace,
    spaceListeners: [],
  };
  const host: AppBotHostCapabilities = {
    getCurrentSpace: () => mutable.currentSpace,
    resolveSpaceName: async () => mutable.currentSpace.name,
    subscribeSpaceChanged: (listener) => {
      mutable.spaceListeners.push(listener);
      return () => {
        mutable.spaceListeners = mutable.spaceListeners.filter(
          (l) => l !== listener
        );
      };
    },
    openConversation: vi.fn(async () => {}),
    clearConversation: vi.fn(),
    isOctoAssistant: () => false,
    track: vi.fn(),
  };
  return { mutable, host };
}

let ctx: { host: AppBotHostCapabilities; mutable: MutableHost } | undefined;
let container: HTMLDivElement;
let hookResult: ReturnType<typeof useAppBotConversation> | undefined;

function Harness({
  connectFailedMessage,
  onError,
}: {
  connectFailedMessage: string;
  onError?: (message: string) => void;
}) {
  hookResult = useAppBotConversation({ connectFailedMessage, onError });
  return null;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function switchSpace(id: string) {
  ctx!.mutable.currentSpace = { id, name: id };
  ctx!.mutable.spaceListeners.forEach((l) => l());
}

describe("useAppBotConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctx = makeMutableHost();
    hookResult = undefined;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  function render(onError?: (message: string) => void) {
    act(() => {
      ReactDOM.render(
        <AppBotHostProvider host={ctx!.host}>
          <Harness connectFailedMessage="Connection failed" onError={onError} />
        </AppBotHostProvider>,
        container
      );
    });
  }

  it("selects a bot and sets selectedUid on success", async () => {
    vi.mocked(AppBotService.applyBot).mockResolvedValue(undefined);
    render();

    await act(async () => {
      await hookResult!.selectBot(botA);
    });

    expect(hookResult!.selectedUid).toBe("robot_a");
    expect(ctx!.host.track).toHaveBeenCalledTimes(1);
    expect(ctx!.host.openConversation).toHaveBeenCalledTimes(1);
  });

  it("resetSelection invalidates the lock and allows a newer selection", async () => {
    vi.mocked(AppBotService.applyBot).mockResolvedValue(undefined);
    render();

    await act(async () => {
      await hookResult!.selectBot(botA);
    });
    expect(hookResult!.selectedUid).toBe("robot_a");

    act(() => {
      hookResult!.resetSelection();
    });
    expect(hookResult!.selectedUid).toBeNull();
    expect(ctx!.host.clearConversation).toHaveBeenCalledTimes(1);

    await act(async () => {
      await hookResult!.selectBot(botB);
    });
    expect(hookResult!.selectedUid).toBe("robot_b");
    expect(ctx!.host.track).toHaveBeenCalledTimes(2);
  });

  it("a late resolve from a reset request neither releases the new lock nor opens", async () => {
    let resolveA: ((v: unknown) => void) | undefined;
    let resolveC: ((v: unknown) => void) | undefined;
    vi.mocked(AppBotService.applyBot).mockImplementation((uid: string) =>
      uid === "robot_a"
        ? new Promise<unknown>((resolve) => {
            resolveA = resolve;
          })
        : new Promise<unknown>((resolve) => {
            resolveC = resolve;
          })
    );
    render();

    const selectA = hookResult!.selectBot(botA);

    act(() => {
      hookResult!.resetSelection();
    });

    const selectC = hookResult!.selectBot(botC);

    await act(async () => {
      resolveA?.(undefined);
      await flush();
    });

    expect(hookResult!.selectedUid).toBeNull();
    expect(ctx!.host.openConversation).not.toHaveBeenCalled();

    await act(async () => {
      resolveC?.(undefined);
      await selectA;
      await selectC;
      await flush();
    });

    expect(hookResult!.selectedUid).toBe("robot_c");
    expect(ctx!.host.openConversation).toHaveBeenCalledTimes(1);
    expect(ctx!.host.track).toHaveBeenCalledTimes(1);
  });

  it("old finally does not unlock the lock held by a newer pending request", async () => {
    let resolvers: Array<(v: unknown) => void> = [];
    vi.mocked(AppBotService.applyBot).mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          resolvers.push(resolve);
        })
    );
    render();

    const selectA = hookResult!.selectBot(botA);
    act(() => {
      hookResult!.resetSelection();
    });

    const selectB = hookResult!.selectBot(botB);

    // Resolving the old A request must not clear the lock held by B.
    await act(async () => {
      resolvers[0]?.(undefined);
      await selectA;
      await flush();
    });

    // B is still pending, so a third attempt must be refused.
    await act(async () => {
      await hookResult!.selectBot(botB);
    });

    expect(resolvers.length).toBe(2); // a third apply must not have started
    expect(ctx!.host.openConversation).not.toHaveBeenCalled();

    await act(async () => {
      resolvers[1]?.(undefined);
      await selectB;
      await flush();
    });
    expect(ctx!.host.openConversation).toHaveBeenCalledTimes(1);
  });

  it("invalidates an in-flight selection when Space switches A->B via the host listener", async () => {
    let resolveA: ((v: unknown) => void) | undefined;
    vi.mocked(AppBotService.applyBot).mockImplementationOnce(
      () =>
        new Promise<unknown>((resolve) => {
          resolveA = resolve;
        })
    );
    render();

    const selectA = hookResult!.selectBot(botA);

    act(() => {
      switchSpace("space-b");
    });

    await act(async () => {
      resolveA?.(undefined);
      await selectA;
      await flush();
    });

    expect(hookResult!.selectedUid).toBeNull();
    expect(ctx!.host.track).not.toHaveBeenCalled();
    expect(ctx!.host.openConversation).not.toHaveBeenCalled();
  });

  it("invalidates an in-flight selection for A->B->A via the host listener", async () => {
    let resolveA: ((v: unknown) => void) | undefined;
    vi.mocked(AppBotService.applyBot).mockImplementationOnce(
      () =>
        new Promise<unknown>((resolve) => {
          resolveA = resolve;
        })
    );
    render();

    const selectA = hookResult!.selectBot(botA);

    act(() => {
      switchSpace("space-b");
      switchSpace("space-a");
    });

    await act(async () => {
      resolveA?.(undefined);
      await selectA;
      await flush();
    });

    expect(hookResult!.selectedUid).toBeNull();
    expect(ctx!.host.track).not.toHaveBeenCalled();
    expect(ctx!.host.openConversation).not.toHaveBeenCalled();
  });

  it("suppresses an error toast from a stale request after reset", async () => {
    let rejectA: ((e: Error) => void) | undefined;
    const onError = vi.fn();
    vi.mocked(AppBotService.applyBot).mockImplementationOnce(
      () =>
        new Promise<unknown>((_, reject) => {
          rejectA = reject;
        })
    );
    render(onError);

    const selectA = hookResult!.selectBot(botA);
    act(() => {
      hookResult!.resetSelection();
    });

    await act(async () => {
      rejectA?.(new Error("apply failed"));
      await selectA.catch(() => {});
      await flush();
    });

    expect(onError).not.toHaveBeenCalled();
    expect(ctx!.host.openConversation).not.toHaveBeenCalled();
  });

  it("suppresses an error toast after unmount", async () => {
    let rejectA: ((e: Error) => void) | undefined;
    const onError = vi.fn();
    vi.mocked(AppBotService.applyBot).mockImplementationOnce(
      () =>
        new Promise<unknown>((_, reject) => {
          rejectA = reject;
        })
    );
    render(onError);

    const selectA = hookResult!.selectBot(botA);
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });

    await act(async () => {
      rejectA?.(new Error("apply failed"));
      await selectA.catch(() => {});
      await flush();
    });

    expect(onError).not.toHaveBeenCalled();
  });

  it("suppresses a late successful open after unmount", async () => {
    let resolveA: ((v: unknown) => void) | undefined;
    vi.mocked(AppBotService.applyBot).mockImplementationOnce(
      () =>
        new Promise<unknown>((resolve) => {
          resolveA = resolve;
        })
    );
    render();

    const selectA = hookResult!.selectBot(botA);
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });

    await act(async () => {
      resolveA?.(undefined);
      await selectA;
      await flush();
    });

    expect(ctx!.host.track).not.toHaveBeenCalled();
    expect(ctx!.host.openConversation).not.toHaveBeenCalled();
  });

  it("still reports an error toast for the current request", async () => {
    let rejectA: ((e: Error) => void) | undefined;
    const onError = vi.fn();
    vi.mocked(AppBotService.applyBot).mockImplementationOnce(
      () =>
        new Promise<unknown>((_, reject) => {
          rejectA = reject;
        })
    );
    render(onError);

    await act(async () => {
      const p = hookResult!.selectBot(botA);
      rejectA?.(new Error("apply failed"));
      await p.catch(() => {});
    });

    expect(onError).toHaveBeenCalledWith("Connection failed");
  });
});
