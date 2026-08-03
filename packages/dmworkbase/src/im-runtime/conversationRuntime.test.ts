import { describe, expect, it, vi } from "vitest";

import {
  findImConversation,
  notifyImConversationListeners,
  removeImConversation,
  syncImConversationExtra,
  type ImConversationRuntimeSdk,
} from "./conversationRuntime";

function createSdk() {
  return {
    conversationManager: {
      findConversation: vi.fn(),
      notifyConversationListeners: vi.fn(),
      removeConversation: vi.fn(),
      syncExtra: vi.fn(),
    },
  } satisfies ImConversationRuntimeSdk;
}

describe("conversationRuntime", () => {
  it("finds a conversation through the SDK conversation manager", () => {
    const sdk = createSdk();
    const channel = { channelID: "g1", channelType: 2 };
    const conversation = { channel };
    sdk.conversationManager.findConversation.mockReturnValue(conversation);

    expect(findImConversation(sdk, channel)).toBe(conversation);
    expect(sdk.conversationManager.findConversation).toHaveBeenCalledWith(
      channel
    );
  });

  it("removes a conversation through the SDK conversation manager", () => {
    const sdk = createSdk();
    const channel = { channelID: "g1", channelType: 2 };

    removeImConversation(sdk, channel);

    expect(sdk.conversationManager.removeConversation).toHaveBeenCalledWith(
      channel
    );
  });

  it("notifies conversation listeners through the SDK conversation manager", () => {
    const sdk = createSdk();
    const conversation = { unread: 0 };
    const action = "update";

    notifyImConversationListeners(sdk, conversation, action);

    expect(
      sdk.conversationManager.notifyConversationListeners
    ).toHaveBeenCalledWith(conversation, action);
  });

  it("syncs conversation extra through the SDK conversation manager", () => {
    const sdk = createSdk();

    syncImConversationExtra(sdk);

    expect(sdk.conversationManager.syncExtra).toHaveBeenCalled();
  });
});
