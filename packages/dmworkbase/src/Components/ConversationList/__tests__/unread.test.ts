import { describe, expect, it } from "vitest"
import { collapsedThreadUnread } from "../unread"

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
