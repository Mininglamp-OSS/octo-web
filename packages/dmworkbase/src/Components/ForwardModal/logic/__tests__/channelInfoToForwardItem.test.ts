import { describe, it, expect } from "vitest"
import { channelInfoToForwardItem } from "../channelInfoToForwardItem"

const CT_PERSON = 1
const CT_GROUP = 2
const CT_COMMUNITY_TOPIC = 5

function info(overrides: {
  channelID?: string
  channelType?: number
  orgData?: Record<string, unknown>
  top?: boolean
} = {}) {
  return {
    channel: {
      channelID: overrides.channelID ?? "g1",
      channelType: overrides.channelType ?? CT_GROUP,
    },
    orgData: overrides.orgData ?? { displayName: "Group 1" },
    top: overrides.top ?? false,
  } as any
}

describe("channelInfoToForwardItem", () => {
  it("copies channelID / channelType and prefers displayName", () => {
    const item = channelInfoToForwardItem(info({ orgData: { displayName: "Engineering" } }))
    expect(item.channelID).toBe("g1")
    expect(item.channelType).toBe(CT_GROUP)
    expect(item.displayName).toBe("Engineering")
  })

  it("falls back to channelID when displayName is empty", () => {
    const item = channelInfoToForwardItem(info({ channelID: "g-fallback", orgData: { displayName: "" } }))
    expect(item.displayName).toBe("g-fallback")
  })

  it("marks robot=1 as isAI", () => {
    const item = channelInfoToForwardItem(info({ orgData: { displayName: "Bot", robot: 1 } }))
    expect(item.isAI).toBe(true)
  })

  it("marks is_external_group=1 as isExternal only for groups", () => {
    const groupItem = channelInfoToForwardItem(info({
      channelType: CT_GROUP,
      orgData: { displayName: "External", is_external_group: 1 },
    }))
    expect(groupItem.isExternal).toBe(true)

    const personItem = channelInfoToForwardItem(info({
      channelType: CT_PERSON,
      orgData: { displayName: "Alice", is_external_group: 1 },
    }))
    expect(personItem.isExternal).toBe(false)
  })

  it("marks community-topic channelType as thread", () => {
    const item = channelInfoToForwardItem(info({ channelType: CT_COMMUNITY_TOPIC }))
    expect(item.isThread).toBe(true)
  })

  it("propagates top === true as isPinned", () => {
    expect(channelInfoToForwardItem(info({ top: true })).isPinned).toBe(true)
    expect(channelInfoToForwardItem(info({ top: false })).isPinned).toBe(false)
  })
})
