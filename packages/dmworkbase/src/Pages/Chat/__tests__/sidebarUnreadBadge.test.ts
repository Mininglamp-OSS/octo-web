import { describe, expect, it } from "vitest";
import {
  shouldHideFollowUnreadBadge,
  shouldHideRecentUnreadBadge,
  unreadContribution,
} from "../sidebarUnreadBadge";

describe("sidebar unread badge readiness", () => {
  it("hides Recent until the Recent and Follow snapshots are ready", () => {
    expect(
      shouldHideRecentUnreadBadge({
        recentLoading: true,
        followingLoading: false,
      })
    ).toBe(true);
    expect(
      shouldHideRecentUnreadBadge({
        recentLoading: false,
        followingLoading: false,
      })
    ).toBe(false);
  });

  it("keeps both tab badges hidden until the Follow snapshot is ready", () => {
    expect(
      shouldHideRecentUnreadBadge({
        recentLoading: false,
        followingLoading: true,
      })
    ).toBe(true);
  });

  it("also waits for Recent before showing Follow because Follow reuses live unread", () => {
    expect(
      shouldHideFollowUnreadBadge({
        recentLoading: true,
        followingLoading: false,
      })
    ).toBe(true);
    expect(
      shouldHideFollowUnreadBadge({
        recentLoading: false,
        followingLoading: true,
      })
    ).toBe(true);
    expect(
      shouldHideFollowUnreadBadge({
        recentLoading: false,
        followingLoading: false,
      })
    ).toBe(false);
  });

  it("keeps known unread visible when another channel lacks mute authority", () => {
    const knownUnread = unreadContribution({
      unread: 5,
      muteAuthorityReady: true,
      muted: false,
    });
    const unresolvedUnread = unreadContribution({
      unread: 99,
      muteAuthorityReady: false,
      muted: false,
    });

    expect(knownUnread + unresolvedUnread).toBe(5);
  });
});
