import { describe, expect, it } from "vitest";
import { getChatUnreadCount, shouldShowChatNavUnreadBadge } from "../chatUnreadBadge";

const personChannelType = 1;

describe("chatUnreadBadge", () => {
  it("shows the chat nav unread badge only outside the chat menu", () => {
    expect(shouldShowChatNavUnreadBadge("contacts", 3)).toBe(true);
    expect(shouldShowChatNavUnreadBadge("loop", 3)).toBe(true);
    expect(shouldShowChatNavUnreadBadge("chat", 3)).toBe(false);
    expect(shouldShowChatNavUnreadBadge(undefined, 3)).toBe(false);
    expect(shouldShowChatNavUnreadBadge("contacts", 0)).toBe(false);
  });

  it("keeps the existing chat unread aggregation rules", () => {
    const conversations = [
      { channel: { channelType: personChannelType }, unread: 9, extra: { spaceUnread: 2 } },
      { channel: { channelType: 2 }, unread: 4 },
      { channel: { channelType: 2 }, unread: 8 },
      { channel: { channelType: 2 }, unread: 16 },
    ];

    const unreadCount = getChatUnreadCount({
      conversations,
      currentSpaceId: "space-1",
      personChannelType,
      getChannelInfo: (channel) => channel === conversations[2].channel ? { mute: true } : undefined,
      shouldSkipChannelForSpace: (channel) => channel === conversations[3].channel,
      shouldSkipPersonConversationForSpace: () => false,
    });

    expect(unreadCount).toBe(6);
  });
});
