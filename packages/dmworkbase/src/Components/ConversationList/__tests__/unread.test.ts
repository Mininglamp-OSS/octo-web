import { describe, expect, it } from "vitest"
import { collapsedThreadHasMention, collapsedThreadUnread } from "../unread"

const thread = (
  unread: number,
  mute?: number | null
) => ({
  unread,
  channelInfo: {
    orgData: {
      thread: {
        mute,
      },
    },
  },
})

const mentionThread = (
  isMentionMe: boolean,
  mute?: number | null
) => ({
  isMentionMe,
  channelInfo: {
    orgData: {
      thread: {
        mute,
      },
    },
  },
})

describe("collapsedThreadUnread", () => {
  it("does not fold thread unread into parent rows when disabled", () => {
    expect(collapsedThreadUnread([thread(3), thread(2)], false, false)).toBe(0)
  })

  it("sums unmuted collapsed thread unread when enabled", () => {
    expect(collapsedThreadUnread([thread(3), thread(2, 0)], false, true)).toBe(5)
  })

  it("excludes explicitly muted threads", () => {
    expect(collapsedThreadUnread([thread(3), thread(2, 1)], false, true)).toBe(3)
  })

  it("keeps all Threads muted when their parent is muted", () => {
    expect(collapsedThreadUnread([thread(3), thread(2, 0)], true, true)).toBe(0)
  })
})

describe("collapsedThreadHasMention", () => {
  it("returns false for empty thread list", () => {
    expect(collapsedThreadHasMention([], false, true)).toBe(false)
  })

  it("returns false when includeCollapsed is disabled", () => {
    expect(
      collapsedThreadHasMention([mentionThread(true)], false, false)
    ).toBe(false)
  })

  it("returns true when any unmuted thread has @我", () => {
    expect(
      collapsedThreadHasMention(
        [mentionThread(false), mentionThread(true)],
        false,
        true
      )
    ).toBe(true)
  })

  it("ignores mentions inside muted threads", () => {
    expect(
      collapsedThreadHasMention([mentionThread(true, 1)], false, true)
    ).toBe(false)
  })

  it("ignores mentions when parent group is muted (parent mute cascades)", () => {
    expect(
      collapsedThreadHasMention(
        [mentionThread(true), mentionThread(true, 0)],
        true,
        true
      )
    ).toBe(false)
  })

  it("returns false when no thread carries @我", () => {
    expect(
      collapsedThreadHasMention(
        [mentionThread(false), mentionThread(false)],
        false,
        true
      )
    ).toBe(false)
  })
})
