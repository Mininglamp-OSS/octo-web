import { describe, it, expect } from "vitest"
import { forwardItemKey, forwardItemKind, FORWARD_ITEM_ACCESSORS } from "../forwardItemKey"
import type { ForwardItem } from "../../ForwardModal"

const CT_PERSON = 1
const CT_GROUP = 2
const CT_COMMUNITY_TOPIC = 5

function item(id: string, extra: Partial<ForwardItem> = {}): ForwardItem {
  return {
    channelID: id,
    channelType: CT_GROUP,
    displayName: id,
    ...extra,
  }
}

describe("forwardItemKey", () => {
  it("produces `${type}::${id}` composite keys", () => {
    expect(forwardItemKey(item("g1", { channelType: CT_GROUP }))).toBe("2::g1")
    expect(forwardItemKey(item("d1", { channelType: CT_PERSON }))).toBe("1::d1")
    expect(forwardItemKey(item("t1", { channelType: CT_COMMUNITY_TOPIC }))).toBe("5::t1")
  })

  it("distinguishes ids with the same string but different types", () => {
    const a = item("dup", { channelType: CT_PERSON })
    const b = item("dup", { channelType: CT_GROUP })
    expect(forwardItemKey(a)).not.toBe(forwardItemKey(b))
  })
})

describe("forwardItemKind", () => {
  it("classifies persons as 'direct'", () => {
    expect(forwardItemKind(item("d1", { channelType: CT_PERSON }))).toBe("direct")
  })

  it("classifies community-topic channelType as 'thread'", () => {
    expect(forwardItemKind(item("t1", { channelType: CT_COMMUNITY_TOPIC }))).toBe("thread")
  })

  it("classifies items with explicit isThread flag as 'thread' even when channelType is group", () => {
    expect(forwardItemKind(item("t1", { channelType: CT_GROUP, isThread: true }))).toBe("thread")
  })

  it("classifies everything else as 'group'", () => {
    expect(forwardItemKind(item("g1", { channelType: CT_GROUP }))).toBe("group")
  })
})

describe("FORWARD_ITEM_ACCESSORS", () => {
  it("composes group-typed composite keys from a bare parent id", () => {
    expect(FORWARD_ITEM_ACCESSORS.getGroupKeyFromId("g1")).toBe("2::g1")
  })

  it("exposes id / name / parentId / kind consistently", () => {
    const t = item("t1", { channelType: CT_COMMUNITY_TOPIC, parentChannelID: "g1", displayName: "Standup" })
    expect(FORWARD_ITEM_ACCESSORS.getId(t)).toBe("t1")
    expect(FORWARD_ITEM_ACCESSORS.getName(t)).toBe("Standup")
    expect(FORWARD_ITEM_ACCESSORS.getParentId(t)).toBe("g1")
    expect(FORWARD_ITEM_ACCESSORS.getKind(t)).toBe("thread")
    expect(FORWARD_ITEM_ACCESSORS.getKey(t)).toBe("5::t1")
  })
})
