import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAppBotConversationTarget,
  openAppBotConversation,
} from "../features/appBotConversation";
import type { AppBotHostCapabilities } from "../host/types";

const bot = {
  id: "bot-1",
  uid: "robot_1",
  displayName: "Docs Bot",
  description: "Search docs",
  scope: "platform" as const,
};

function createHost(
  overrides: Partial<AppBotHostCapabilities> = {}
): AppBotHostCapabilities {
  return {
    getCurrentSpace: () => ({ id: "space-a", name: "Alpha" }),
    resolveSpaceName: async () => "Alpha",
    subscribeSpaceChanged: () => () => {},
    openConversation: vi.fn(async () => {}),
    clearConversation: vi.fn(),
    isOctoAssistant: () => false,
    track: vi.fn(),
    ...overrides,
  };
}

describe("openAppBotConversation", () => {
  it("applies the bot before asking the host to open a serializable target", async () => {
    const calls: string[] = [];
    const host = createHost({
      openConversation: vi.fn(async (target) => {
        calls.push("open");
        expect(target).toEqual({
          channelId: "robot_1",
          channelType: 1,
          displayName: "Docs Bot",
          avatar: "users/robot_1/avatar",
          metadata: {
            displayName: "Docs Bot",
            robot: 1,
            name: "Docs Bot",
          },
        });
      }),
    });

    await openAppBotConversation(bot, host, {
      applyBot: async (uid) => {
        calls.push(`apply:${uid}`);
      },
    });

    expect(calls).toEqual(["apply:robot_1", "open"]);
  });

  it("tracks octo_assistant_opened through the host", async () => {
    const host = createHost({ isOctoAssistant: () => true });

    await openAppBotConversation(bot, host, { applyBot: async () => {} });

    expect(host.track).toHaveBeenCalledWith("octo_assistant_opened", {
      source: "app_bot_list",
    });
    expect(host.track).not.toHaveBeenCalledWith(
      "app_opened",
      expect.anything()
    );
  });

  it("tracks app_opened through the host for regular bots", async () => {
    const host = createHost();

    await openAppBotConversation(bot, host, { applyBot: async () => {} });

    expect(host.track).toHaveBeenCalledWith("app_opened", {
      app_name: "Docs Bot",
      app_category: "platform",
    });
  });

  it("does not track or open a conversation when apply fails", async () => {
    const host = createHost();

    await expect(
      openAppBotConversation(bot, host, {
        applyBot: async () => {
          throw new Error("apply failed");
        },
      })
    ).rejects.toThrow("apply failed");

    expect(host.track).not.toHaveBeenCalled();
    expect(host.openConversation).not.toHaveBeenCalled();
  });

  describe("openAppBotConversation's isCurrent guard", () => {
    it("bails before onApplied when isCurrent returns false", async () => {
      const host = createHost();
      const onApplied = vi.fn();

      await openAppBotConversation(
        bot,
        host,
        { applyBot: async () => {} },
        { onApplied, isCurrent: () => false }
      );

      expect(onApplied).not.toHaveBeenCalled();
      expect(host.track).not.toHaveBeenCalled();
      expect(host.openConversation).not.toHaveBeenCalled();
    });

    it("bails after onApplied when isCurrent returns false mid-flow", async () => {
      const host = createHost();
      let phase = 0;
      const onApplied = vi.fn();

      await openAppBotConversation(
        bot,
        host,
        { applyBot: async () => {} },
        {
          onApplied,
          isCurrent: () => {
            phase += 1;
            return phase < 2; // true pre-apply, false after onApplied
          },
        }
      );

      expect(onApplied).toHaveBeenCalledTimes(1);
      expect(host.track).not.toHaveBeenCalled();
      expect(host.openConversation).not.toHaveBeenCalled();
    });

    it("bails before openConversation when isCurrent turns false after track", async () => {
      const host = createHost();
      let calledIsCurrent = 0;

      await openAppBotConversation(
        bot,
        host,
        { applyBot: async () => {} },
        {
          isCurrent: () => {
            calledIsCurrent += 1;
            return calledIsCurrent < 3; // true, true (track), false before open
          },
        }
      );

      expect(host.track).toHaveBeenCalledTimes(1);
      expect(host.openConversation).not.toHaveBeenCalled();
    });

    it("still proceeds normally when isCurrent always returns true", async () => {
      const host = createHost();

      await openAppBotConversation(
        bot,
        host,
        { applyBot: async () => {} },
        { isCurrent: () => true }
      );

      expect(host.track).toHaveBeenCalledTimes(1);
      expect(host.openConversation).toHaveBeenCalledTimes(1);
    });
  });

  describe("openAppBotConversation intrinsic Space validity", () => {
    let currentSpaceId: string;
    let listeners: Array<() => void>;

    function spaceHost(): AppBotHostCapabilities {
      return {
        getCurrentSpace: () => ({ id: currentSpaceId, name: "" }),
        resolveSpaceName: async () => "",
        subscribeSpaceChanged: (listener) => {
          listeners.push(listener);
          return () => {
            listeners = listeners.filter((l) => l !== listener);
          };
        },
        openConversation: vi.fn(async () => {}),
        clearConversation: vi.fn(),
        isOctoAssistant: () => false,
        track: vi.fn(),
      };
    }

    function switchSpace(id: string) {
      currentSpaceId = id;
      listeners.forEach((l) => l());
    }

    let resolveApply: ((v: unknown) => void) | undefined;

    function controllableApplyHost(): AppBotHostCapabilities {
      return {
        ...spaceHost(),
        openConversation: vi.fn(async () => {}),
        track: vi.fn(),
      };
    }

    beforeEach(() => {
      currentSpaceId = "space-a";
      listeners = [];
      resolveApply = undefined;
      vi.clearAllMocks();
    });

    it("proceeds normally when no Space switch occurs", async () => {
      const host = controllableApplyHost();

      await openAppBotConversation(bot, host, { applyBot: async () => {} });

      expect(host.track).toHaveBeenCalledTimes(1);
      expect(host.openConversation).toHaveBeenCalledTimes(1);
    });

    it("bails mid-apply when Space switches (A->B) from intrinsic listener", async () => {
      const host = controllableApplyHost();
      let resolveA: ((v: unknown) => void) | undefined;

      const p = openAppBotConversation(
        bot,
        host,
        {
          applyBot: () =>
            new Promise<unknown>((resolve) => {
              resolveA = resolve;
            }),
        },
        { onApplied: vi.fn() }
      );

      switchSpace("space-b");

      resolveA!(undefined);
      await p;

      expect(host.track).not.toHaveBeenCalled();
      expect(host.openConversation).not.toHaveBeenCalled();
    });

    it("bails mid-apply when Space switches A->B->A from intrinsic listener", async () => {
      const host = controllableApplyHost();
      let resolveA: ((v: unknown) => void) | undefined;

      const p = openAppBotConversation(
        bot,
        host,
        {
          applyBot: () =>
            new Promise<unknown>((resolve) => {
              resolveA = resolve;
            }),
        },
        { onApplied: vi.fn() }
      );

      switchSpace("space-b");
      switchSpace("space-a");

      resolveA!(undefined);
      await p;

      expect(host.track).not.toHaveBeenCalled();
      expect(host.openConversation).not.toHaveBeenCalled();
    });

    it("unsubscribes from Space changes before returning", async () => {
      const host = controllableApplyHost();

      const p = openAppBotConversation(bot, host, { applyBot: async () => {} });

      await p;

      expect(listeners.length).toBe(0);
    });
  });

  it("constructs the target without WKApp or SDK objects", () => {
    expect(createAppBotConversationTarget(bot)).toEqual({
      channelId: "robot_1",
      channelType: 1,
      displayName: "Docs Bot",
      avatar: "users/robot_1/avatar",
      metadata: {
        displayName: "Docs Bot",
        robot: 1,
        name: "Docs Bot",
      },
    });
  });
});
