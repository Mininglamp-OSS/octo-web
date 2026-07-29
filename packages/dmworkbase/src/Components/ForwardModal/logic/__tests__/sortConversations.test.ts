import { describe, it, expect } from "vitest"
import { sortConversations } from "../sortConversations"

function wrap(id: string, timestamp: number, top?: boolean) {
  return {
    id,
    timestamp,
    channelInfo: top === undefined ? undefined : { top },
  }
}

describe("sortConversations", () => {
  it("sorts by timestamp descending when nothing is pinned", () => {
    const a = wrap("a", 100)
    const b = wrap("b", 300)
    const c = wrap("c", 200)
    const sorted = sortConversations([a, b, c])
    expect(sorted.map((w) => w.id)).toEqual(["b", "c", "a"])
  })

  it("places pinned wraps ahead of newer unpinned wraps", () => {
    const newer = wrap("newer", 2_000, false)
    const pinned = wrap("pinned", 1, true)
    const sorted = sortConversations([newer, pinned])
    expect(sorted.map((w) => w.id)).toEqual(["pinned", "newer"])
  })

  it("keeps timestamp-desc order among multiple pinned wraps", () => {
    const p1 = wrap("p1", 100, true)
    const p2 = wrap("p2", 300, true)
    const sorted = sortConversations([p1, p2])
    expect(sorted.map((w) => w.id)).toEqual(["p2", "p1"])
  })

  it("does not mutate the input array", () => {
    const list = [wrap("a", 100), wrap("b", 200)]
    sortConversations(list)
    expect(list.map((w) => w.id)).toEqual(["a", "b"])
  })

  it("keeps a pinned wrap with timestamp=0 ahead of a far-future unpinned wrap", () => {
    // 行为断言（避免自我重复常量）：真实毫秒时间戳里最极端的一档
    // （2050 年初 ≈ 2.5e12），只要仍能被置顶加成压制，就锁定了「置顶恒赢」的语义。
    const pinnedAtZero = wrap("pinned-0", 0, true)
    const unpinnedFarFuture = wrap("future-unpinned", Date.UTC(2050, 0, 1), false)
    const sorted = sortConversations([unpinnedFarFuture, pinnedAtZero])
    expect(sorted.map((w) => w.id)).toEqual(["pinned-0", "future-unpinned"])
  })

  it("treats undefined channelInfo as not pinned", () => {
    const noInfo = wrap("noInfo", 500)
    const pinned = wrap("pinned", 100, true)
    const sorted = sortConversations([noInfo, pinned])
    expect(sorted.map((w) => w.id)).toEqual(["pinned", "noInfo"])
  })
})
