import { describe, expect, it } from "vitest";
import { countEffectiveUnreadConversations } from "./unreadConversationSelector";

describe("countEffectiveUnreadConversations", () => {
  it("counts conversations, not unread messages", () => {
    expect(
      countEffectiveUnreadConversations([
        { unread: 30 },
        { unread: 2 },
        { unread: 0 },
      ])
    ).toBe(2);
  });

  it("excludes cross-Space, effectively muted, and archived conversations", () => {
    expect(
      countEffectiveUnreadConversations([
        { unread: 1 },
        { unread: 1, crossSpace: true },
        { unread: 1, effectivelyMuted: true },
        { unread: 1, archived: true },
      ])
    ).toBe(1);
  });

  it("treats negative and non-finite unread values as zero", () => {
    expect(
      countEffectiveUnreadConversations([
        { unread: -1 },
        { unread: Number.NaN },
        { unread: Number.POSITIVE_INFINITY },
      ])
    ).toBe(0);
  });
});
