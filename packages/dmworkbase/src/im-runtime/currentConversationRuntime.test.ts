import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  findCurrentImConversation,
  getCurrentImConversationsDirectly,
  notifyCurrentImConversationListeners,
  removeCurrentImConversation,
  syncCurrentImConversationExtra,
} from "./currentConversationRuntime";

const hoisted = vi.hoisted(() => {
  const sdk = {
    conversationManager: {
      conversations: [] as unknown[],
      findConversation: vi.fn(),
      notifyConversationListeners: vi.fn(),
      removeConversation: vi.fn(),
      syncExtra: vi.fn(),
    },
  };
  return {
    sdk,
    shared: vi.fn(() => sdk),
  };
});

vi.mock("wukongimjssdk", () => ({
  default: {
    shared: hoisted.shared,
  },
}));

describe("currentConversationRuntime", () => {
  beforeEach(() => {
    hoisted.shared.mockClear();
    hoisted.sdk.conversationManager.conversations = [];
    hoisted.sdk.conversationManager.findConversation.mockReset();
    hoisted.sdk.conversationManager.notifyConversationListeners.mockReset();
    hoisted.sdk.conversationManager.removeConversation.mockReset();
    hoisted.sdk.conversationManager.syncExtra.mockReset();
  });

  it("finds a conversation from the current SDK runtime", () => {
    const channel = { channelID: "g1", channelType: 2 };
    const conversation = { channel };
    hoisted.sdk.conversationManager.findConversation.mockReturnValueOnce(
      conversation
    );

    expect(findCurrentImConversation(channel)).toBe(conversation);
    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(
      hoisted.sdk.conversationManager.findConversation
    ).toHaveBeenCalledWith(channel);
  });

  it("removes a conversation from the current SDK runtime", () => {
    const channel = { channelID: "g1", channelType: 2 };

    removeCurrentImConversation(channel);

    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(
      hoisted.sdk.conversationManager.removeConversation
    ).toHaveBeenCalledWith(channel);
  });

  it("notifies conversation listeners from the current SDK runtime", () => {
    const conversation = { unread: 0 };
    const action = "update";

    notifyCurrentImConversationListeners(conversation, action);

    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(
      hoisted.sdk.conversationManager.notifyConversationListeners
    ).toHaveBeenCalledWith(conversation, action);
  });

  it("syncs conversation extra from the current SDK runtime", () => {
    syncCurrentImConversationExtra();

    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(hoisted.sdk.conversationManager.syncExtra).toHaveBeenCalled();
  });

  it("reads conversations directly from the current SDK conversationManager field", () => {
    const conversations = [
      { channel: { channelID: "g1", channelType: 2 } },
      { channel: { channelID: "g2", channelType: 5 } },
    ];
    hoisted.sdk.conversationManager.conversations = conversations;

    expect(getCurrentImConversationsDirectly()).toBe(conversations);
    expect(hoisted.shared).toHaveBeenCalledTimes(1);
  });

  it("returns an empty array when the SDK has no conversations", () => {
    hoisted.sdk.conversationManager.conversations =
      undefined as unknown as unknown[];

    expect(getCurrentImConversationsDirectly()).toEqual([]);
  });
});
