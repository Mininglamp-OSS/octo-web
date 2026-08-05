import { beforeEach, describe, expect, it, vi } from "vitest"

const hoisted = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock("../APIClient", () => ({
  default: { shared: { get: hoisted.get } },
}))

import SpaceBotService from "../SpaceBotService"

describe("SpaceBotService.listShared (in-flight-only dedup, no stale result cache)", () => {
  beforeEach(() => {
    hoisted.get.mockReset()
  })

  it("dedupes simultaneous calls onto ONE in-flight request", async () => {
    let resolve!: (v: unknown) => void
    hoisted.get.mockReturnValue(new Promise((r) => (resolve = r)))
    const a = SpaceBotService.listShared("s_1")
    const b = SpaceBotService.listShared("s_1")
    expect(a).toBe(b) // same in-flight promise shared
    expect(hoisted.get).toHaveBeenCalledTimes(1)
    resolve([{ uid: "b_1", name: "Bot", creator_uid: "u_ada" }])
    await Promise.all([a, b])
  })

  it("a later call after a prior SUCCESS re-fetches and sees the changed catalog (no stale cache)", async () => {
    // First open: catalog has b_1.
    hoisted.get.mockResolvedValueOnce([{ uid: "b_1", name: "Old", creator_uid: "u_ada" }])
    const first = await SpaceBotService.listShared("s_1")
    expect(first.map((b) => b.uid)).toEqual(["b_1"])
    // Catalog changed between opens (b_1 removed, b_2 added). A later open must see the new catalog.
    hoisted.get.mockResolvedValueOnce([{ uid: "b_2", name: "New", creator_uid: "u_grace" }])
    const second = await SpaceBotService.listShared("s_1")
    expect(second.map((b) => b.uid)).toEqual(["b_2"])
    expect(hoisted.get).toHaveBeenCalledTimes(2) // NOT served from a permanent cache
  })

  it("filters non-array / uid-less entries", async () => {
    hoisted.get.mockResolvedValue([{ uid: "b_1" }, { name: "no-uid" }, null])
    const bots = await SpaceBotService.listShared("s_1")
    expect(bots.map((b) => b.uid)).toEqual(["b_1"])
  })

  it("fails closed: a rejection is not retained, so the next call re-fetches", async () => {
    hoisted.get.mockRejectedValueOnce(new Error("boom"))
    await expect(SpaceBotService.listShared("s_1")).rejects.toThrow("boom")
    hoisted.get.mockResolvedValue([{ uid: "b_1", creator_uid: "u_ada" }])
    const bots = await SpaceBotService.listShared("s_1")
    expect(bots.map((b) => b.uid)).toEqual(["b_1"])
    expect(hoisted.get).toHaveBeenCalledTimes(2)
  })

  it("returns [] for an empty space id without any request", async () => {
    expect(await SpaceBotService.listShared("")).toEqual([])
    expect(hoisted.get).not.toHaveBeenCalled()
  })
})
