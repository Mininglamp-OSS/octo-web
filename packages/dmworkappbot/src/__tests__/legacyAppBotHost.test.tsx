import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as string[],
  currentSpaceId: "space-a",
  listeners: new Set<() => void>(),
  findConversation: vi.fn(),
  createEmptyConversation: vi.fn(() => state.calls.push("create")),
  setChannelInfo: vi.fn(() => state.calls.push("cache")),
  replaceToRoot: vi.fn(() => state.calls.push("route")),
  popToRoot: vi.fn(),
  track: vi.fn(),
  getMySpaces: vi.fn(),
}));

vi.mock("@octo/base", () => ({
  Conversation: ({ channel }: { channel: { channelID: string } }) =>
    React.createElement("div", { "data-channel": channel.channelID }),
  createCurrentEmptyImConversation: state.createEmptyConversation,
  findCurrentImConversation: state.findConversation,
  setCurrentImChannelInfoCache: state.setChannelInfo,
  SpaceService: { shared: { getMySpaces: state.getMySpaces } },
  WKApp: {
    shared: {
      get currentSpaceId() {
        return state.currentSpaceId;
      },
    },
    mittBus: {
      on: (_event: string, listener: () => void) =>
        state.listeners.add(listener),
      off: (_event: string, listener: () => void) =>
        state.listeners.delete(listener),
    },
    routeRight: {
      replaceToRoot: state.replaceToRoot,
      popToRoot: state.popToRoot,
    },
    remoteConfig: { octoAssistantUids: ["assistant_1"] },
  },
  Dap: { shared: { track: state.track } },
}));

vi.mock("wukongimjssdk", () => {
  class Channel {
    channelID: string;
    channelType: number;

    constructor(channelID: string, channelType: number) {
      this.channelID = channelID;
      this.channelType = channelType;
    }

    getChannelKey() {
      return `${this.channelID}-${this.channelType}`;
    }
  }

  class ChannelInfo {
    channel: unknown;
    title = "";
    logo = "";
    orgData: Record<string, unknown> = {};
  }

  return { Channel, ChannelInfo };
});

vi.mock("../features/AppBotAvatar", () => ({
  default: ({ uid }: { uid: string }) => React.createElement("span", null, uid),
}));

vi.mock("../ui/AppBotChatHeader", () => ({
  default: ({ displayName }: { displayName: string }) =>
    React.createElement("header", null, displayName),
}));

import { legacyAppBotHost } from "../host/legacyAppBotHost";

const target = {
  channelId: "robot_1",
  channelType: 1,
  displayName: "Docs Bot",
  avatar: "users/robot_1/avatar",
  metadata: {
    displayName: "Docs Bot",
    robot: 1 as const,
    name: "Docs Bot",
  },
};

describe("legacyAppBotHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.calls.length = 0;
    state.listeners.clear();
    state.currentSpaceId = "space-a";
    state.findConversation.mockReturnValue(undefined);
    state.getMySpaces.mockResolvedValue([
      { space_id: "space-a", name: "Alpha" },
    ]);
  });

  it("adapts current Web Space and event subscriptions", async () => {
    expect(legacyAppBotHost.getCurrentSpace()).toEqual({
      id: "space-a",
      name: "",
    });
    await expect(legacyAppBotHost.resolveSpaceName("space-a")).resolves.toBe(
      "Alpha"
    );

    const listener = vi.fn();
    const unsubscribe = legacyAppBotHost.subscribeSpaceChanged(listener);
    expect(state.listeners.has(listener)).toBe(true);
    unsubscribe();
    expect(state.listeners.has(listener)).toBe(false);
  });

  it("preserves cache, empty conversation, and route rendering order", async () => {
    await legacyAppBotHost.openConversation(target);

    expect(state.calls).toEqual(["cache", "create", "route"]);
    const info = state.setChannelInfo.mock.calls[0][0];
    expect(info.title).toBe("Docs Bot");
    expect(info.logo).toBe("users/robot_1/avatar");
    expect(info.orgData).toEqual(target.metadata);

    const element = state.replaceToRoot.mock.calls[0][0] as React.ReactElement;
    expect(element.props.className).toBe("appbot-chat-wrap");
  });

  it("does not create a duplicate empty conversation", async () => {
    state.findConversation.mockReturnValue({ existing: true });

    await legacyAppBotHost.openConversation(target);

    expect(state.createEmptyConversation).not.toHaveBeenCalled();
    expect(state.replaceToRoot).toHaveBeenCalledTimes(1);
  });

  it("keeps Web clear, assistant classification, and analytics adapters", () => {
    legacyAppBotHost.clearConversation();
    legacyAppBotHost.track("apps_searched", {});

    expect(state.popToRoot).toHaveBeenCalledTimes(1);
    expect(legacyAppBotHost.isOctoAssistant("assistant_1")).toBe(true);
    expect(legacyAppBotHost.isOctoAssistant("robot_1")).toBe(false);
    expect(state.track).toHaveBeenCalledWith("apps_searched", {});
  });
});
