import { describe, expect, it, vi } from "vitest";
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
