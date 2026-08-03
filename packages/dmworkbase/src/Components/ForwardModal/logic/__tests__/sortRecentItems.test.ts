import { describe, it, expect } from "vitest"
import { sortRecentItems, type RecentSortMeta } from "../sortRecentItems"
import { forwardItemKey } from "../forwardItemKey"
import type { ForwardItem } from "../../ForwardModal"

const CT_GROUP = 2

function item(id: string, extra: Partial<ForwardItem> = {}): ForwardItem {
  return {
    channelID: id,
    channelType: CT_GROUP,
    displayName: id,
    ...extra,
  }
}

function meta(entries: Array<[ForwardItem, RecentSortMeta]>): Map<string, RecentSortMeta> {
  const m = new Map<string, RecentSortMeta>()
  for (const [it, mt] of entries) m.set(forwardItemKey(it), mt)
  return m
}

describe("sortRecentItems", () => {
  it("returns items in timestamp-desc order when nothing is pinned", () => {
    const a = item("a")
    const b = item("b")
    const c = item("c")
    const sorted = sortRecentItems([a, b, c], meta([
      [a, { timestamp: 100, isPinned: false }],
      [b, { timestamp: 300, isPinned: false }],
      [c, { timestamp: 200, isPinned: false }],
    ]))
    expect(sorted.map((i) => i.channelID)).toEqual(["b", "c", "a"])
  })

  it("places sidebar-pinned items ahead of newer unpinned items", () => {
    const pinned = item("pinned")
    const newer = item("newer")
    const sorted = sortRecentItems([newer, pinned], meta([
      [newer, { timestamp: 2_000_000_000_000, isPinned: false }],
      [pinned, { timestamp: 0, isPinned: true }],
    ]))
    expect(sorted.map((i) => i.channelID)).toEqual(["pinned", "newer"])
  })

  it("treats local channelInfo.top as pinned even when the sidebar meta says otherwise", () => {
    const localPinned = item("localTop", { isPinned: true })
    const newer = item("newer")
    const sorted = sortRecentItems([newer, localPinned], meta([
      [newer, { timestamp: 2_000_000_000_000, isPinned: false }],
      [localPinned, { timestamp: 0, isPinned: false }],
    ]))
    expect(sorted.map((i) => i.channelID)).toEqual(["localTop", "newer"])
  })

  it("falls back to timestamp 0 when meta is missing for an item", () => {
    const withMeta = item("withMeta")
    const noMeta = item("noMeta")
    const sorted = sortRecentItems([noMeta, withMeta], meta([
      [withMeta, { timestamp: 100, isPinned: false }],
    ]))
    expect(sorted.map((i) => i.channelID)).toEqual(["withMeta", "noMeta"])
  })

  it("does not mutate the input array", () => {
    const a = item("a")
    const b = item("b")
    const input = [a, b]
    sortRecentItems(input, meta([
      [a, { timestamp: 100, isPinned: false }],
      [b, { timestamp: 200, isPinned: false }],
    ]))
    expect(input.map((i) => i.channelID)).toEqual(["a", "b"])
  })
})
