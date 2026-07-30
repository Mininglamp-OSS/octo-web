import { describe, expect, it } from "vitest";
import {
  getRecentConversationUnreadCount,
  shouldShowChatNavUnreadBadge,
} from "../recentUnread";

describe("chatUnreadBadge", () => {
  it("shows the chat nav unread badge only outside the chat menu", () => {
    expect(shouldShowChatNavUnreadBadge("contacts", 3)).toBe(true);
    expect(shouldShowChatNavUnreadBadge("loop", 3)).toBe(true);
    expect(shouldShowChatNavUnreadBadge("chat", 3)).toBe(false);
    expect(shouldShowChatNavUnreadBadge(undefined, 3)).toBe(false);
    expect(shouldShowChatNavUnreadBadge("contacts", 0)).toBe(false);
  });

  it("uses the same aggregation shape as the recent conversation list badge", () => {
    const conversations = [
      { id: "visible-dm", unread: 3, muted: false },
      { id: "muted-group", unread: 5, muted: true },
      { id: "visible-thread", unread: 7, muted: false },
      { id: "zero", unread: 0, muted: false },
    ];

    const unreadCount = getRecentConversationUnreadCount(
      conversations,
      (conversation) => conversation.muted,
    );

    expect(unreadCount).toBe(10);
  });

  it("skips parent-muted threads with the same muted predicate as the recent list", () => {
    const conversations = [
      { id: "visible-dm", unread: 3, muted: false, parentMuted: false },
      { id: "parent-muted-thread", unread: 7, muted: false, parentMuted: true },
    ];

    const unreadCount = getRecentConversationUnreadCount(
      conversations,
      (conversation) => conversation.muted || conversation.parentMuted,
    );

    expect(unreadCount).toBe(3);
  });
});
