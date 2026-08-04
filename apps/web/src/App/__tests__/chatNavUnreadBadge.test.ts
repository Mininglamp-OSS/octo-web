import { describe, expect, it } from "vitest";
import { getLiveChatNavUnreadCount } from "../chatNavUnreadBadge";

describe("getLiveChatNavUnreadCount", () => {
  it("computes the nav badge from live conversations without a Chat-mounted snapshot", () => {
    const liveConversations = [
      { id: "visible-dm", channel: { id: "visible-dm" }, unread: 3, muted: false },
      { id: "muted-group", channel: { id: "muted-group" }, unread: 5, muted: true },
      { id: "other-space", channel: { id: "other-space" }, unread: 7, muted: false },
      { id: "hidden-person", channel: { id: "hidden-person" }, unread: 11, muted: false },
    ];

    const unreadCount = getLiveChatNavUnreadCount({
      conversations: liveConversations,
      shouldSkipChannelForSpace: (channel) => channel.id === "other-space",
      shouldSkipPersonConversationForSpace: (conversation) => conversation.id === "hidden-person",
      toRecentConversation: (conversation) => ({
        unread: conversation.unread,
        muted: conversation.muted,
      }),
      isMutedForRecentConversation: (conversation) => conversation.muted,
      getRecentConversationUnreadCount: (conversations, isMuted) => conversations.reduce(
        (sum, conversation) => sum + (isMuted(conversation) ? 0 : conversation.unread),
        0,
      ),
    });

    expect(unreadCount).toBe(3);
  });
});
