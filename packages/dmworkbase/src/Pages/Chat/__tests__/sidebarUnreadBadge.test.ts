import { describe, expect, it } from "vitest";
import {
  shouldHideFollowUnreadBadge,
  shouldHideRecentUnreadBadge,
} from "../sidebarUnreadBadge";

describe("sidebar unread badge readiness", () => {
  it("hides Recent until its conversation and mute authority are ready", () => {
    expect(
      shouldHideRecentUnreadBadge({
        recentLoading: true,
        followingLoading: false,
        missingMuteAuthority: false,
      })
    ).toBe(true);
    expect(
      shouldHideRecentUnreadBadge({
        recentLoading: false,
        followingLoading: false,
        missingMuteAuthority: true,
      })
    ).toBe(true);
    expect(
      shouldHideRecentUnreadBadge({
        recentLoading: false,
        followingLoading: false,
        missingMuteAuthority: false,
      })
    ).toBe(false);
  });

  it("keeps both tab badges hidden until the Follow snapshot is ready", () => {
    expect(
      shouldHideRecentUnreadBadge({
        recentLoading: false,
        followingLoading: true,
        missingMuteAuthority: false,
      })
    ).toBe(true);
  });

  it("also waits for Recent before showing Follow because Follow reuses live unread", () => {
    expect(
      shouldHideFollowUnreadBadge({
        recentLoading: true,
        followingLoading: false,
        missingMuteAuthority: false,
      })
    ).toBe(true);
    expect(
      shouldHideFollowUnreadBadge({
        recentLoading: false,
        followingLoading: true,
        missingMuteAuthority: false,
      })
    ).toBe(true);
    expect(
      shouldHideFollowUnreadBadge({
        recentLoading: false,
        followingLoading: false,
        missingMuteAuthority: true,
      })
    ).toBe(true);
    expect(
      shouldHideFollowUnreadBadge({
        recentLoading: false,
        followingLoading: false,
        missingMuteAuthority: false,
      })
    ).toBe(false);
  });
});
