// @vitest-environment jsdom
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { Channel, ChannelTypeGroup, MessageStatus } from "wukongimjssdk"
import MessageHead, { getTitleColor, hascode } from "../head"
import { BubblePosition } from "../../../Service/Model"
import { getImChannelInfo } from "../../../im-runtime/channelRuntime"

vi.mock("react-virtuoso", () => ({ Virtuoso: () => null, TableVirtuoso: () => null }))

vi.mock("../../../im-runtime/channelRuntime", () => ({
  getImChannelInfo: vi.fn(() => ({ title: "Sender", orgData: { displayName: "Sender" } })),
}))

function message(overrides: any = {}) {
  return {
    channel: new Channel("group", ChannelTypeGroup),
    fromUID: "sender",
    send: false,
    status: MessageStatus.Normal,
    bubblePosition: BubblePosition.single,
    ...overrides,
  } as any
}

describe("MessageHead", () => {
  it("hashes names and chooses stable title colors", () => {
    expect(hascode("")).toBe(0)
    expect(hascode("Alice")).not.toBe(0)
    expect(getTitleColor("Alice")).toMatch(/^#/)
    expect(getTitleColor()).toMatch(/^#/)
  })

  it("only shows a title for incoming first or single messages", () => {
    const incoming = new (MessageHead as any)({ message: message() })
    expect(incoming.needTitle()).toBe(true)
    expect(renderToStaticMarkup(<MessageHead message={message()} />)).toContain("textTitle")

    const middle = message({ bubblePosition: BubblePosition.middle })
    expect(new (MessageHead as any)({ message: middle }).needTitle()).toBe(false)
    expect(renderToStaticMarkup(<MessageHead message={middle} />)).not.toContain("textTitle")
    expect(new (MessageHead as any)({ message: message({ send: true }) }).needTitle()).toBe(false)
  })

  it("renders webhook sender names and badges", () => {
    const value = message({ fromUID: "iwh_sender", contentObj: { from: { name: "Webhook" } } })
    const html = renderToStaticMarkup(<MessageHead message={value} />)
    expect(html).toContain("textTitle")
  })

  it("renders bot and external-space metadata", () => {
    vi.mocked(getImChannelInfo).mockReturnValue({
      title: "Bot",
      orgData: { displayName: "Bot", robot: 1, is_external: 1, source_space_name: "Home" },
    } as any)
    const html = renderToStaticMarkup(<MessageHead message={message()} />)
    expect(html).toContain("Bot")
    expect(html).toContain("Home")
  })
})
