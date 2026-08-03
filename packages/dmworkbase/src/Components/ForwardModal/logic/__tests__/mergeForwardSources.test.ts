import { describe, it, expect } from "vitest"
import { mergeForwardSources } from "../mergeForwardSources"
import type { ForwardItem } from "../../ForwardModal"

const CT_GROUP = 2
const CT_PERSON = 1

function item(id: string, extra: Partial<ForwardItem> = {}): ForwardItem {
  return {
    channelID: id,
    channelType: CT_GROUP,
    displayName: id,
    ...extra,
  }
}

describe("mergeForwardSources", () => {
  it("returns conversation items unchanged when the other sources are empty", () => {
    const conv = [item("g1"), item("g2")]
    const merged = mergeForwardSources(conv, [], [])
    expect(merged.map((i) => i.channelID)).toEqual(["g1", "g2"])
  })

  it("appends friends that are not present in conversations", () => {
    const conv = [item("g1")]
    const friends = [
      item("d1", { channelType: CT_PERSON }),
      item("d2", { channelType: CT_PERSON }),
    ]
    const merged = mergeForwardSources(conv, friends, [])
    expect(merged.map((i) => i.channelID)).toEqual(["g1", "d1", "d2"])
  })

  it("skips a friend whose channelID collides with a conversation entry (keeps the conversation)", () => {
    const conv = [item("dup", { displayName: "Conv Version" })]
    const friends = [item("dup", { channelType: CT_PERSON, displayName: "Friend Version" })]
    const merged = mergeForwardSources(conv, friends, [])
    expect(merged).toHaveLength(1)
    expect(merged[0].displayName).toBe("Conv Version")
  })

  it("appends search groups that neither conversations nor friends already cover", () => {
    const conv = [item("g1")]
    const friends = [item("d1", { channelType: CT_PERSON })]
    const search = [item("g-search"), item("d1", { channelType: CT_PERSON, displayName: "search-collision" })]
    const merged = mergeForwardSources(conv, friends, search)
    // d1 collision from search is dropped; g-search stays
    expect(merged.map((i) => i.channelID)).toEqual(["g1", "d1", "g-search"])
  })

  it("does not mutate its inputs", () => {
    const conv = [item("g1")]
    const friends = [item("d1", { channelType: CT_PERSON })]
    const search = [item("g2")]
    mergeForwardSources(conv, friends, search)
    expect(conv).toHaveLength(1)
    expect(friends).toHaveLength(1)
    expect(search).toHaveLength(1)
  })
})
