// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render } from "@testing-library/react"
const state = vi.hoisted(() => ({ info: undefined as any, on: vi.fn(), off: vi.fn(), avatar: vi.fn(() => "avatar.png") }))
vi.mock("../../../App", () => ({ default: { mittBus: { on: state.on, off: state.off }, shared: { avatarChannel: state.avatar } } }))
vi.mock("../../../im-runtime/currentChannelRuntime", () => ({ getCurrentImChannelInfo: () => state.info }))
import WKAvatar, { isBot } from "../index"

describe("WKAvatar states", () => {
  it("covers bot/group classes, lazy visibility, updates, and error fallback", () => {
    const group: any = { channelID: "g", channelType: 2 }
    const person: any = { channelID: "u", channelType: 1 }
    state.info = { orgData: { robot: 1 } }
    expect(isBot("u")).toBe(true)
    const { container, rerender, unmount } = render(<WKAvatar channel={group} lazy random="v1" />)
    expect(container.querySelector(".wk-avatar")).toHaveClass("wk-avatar-group")
    const img = container.querySelector("img")!
    fireEvent.error(img)
    fireEvent.load(img)
    rerender(<WKAvatar channel={person} src=" user.png " />)
    expect(container.querySelector(".wk-avatar")).toHaveClass("wk-avatar-ai")
    fireEvent(img, new Event("error"))
    window.dispatchEvent(new CustomEvent("channel-avatar-changed", { detail: { channelID: "u", channelType: 1 } }))
    unmount()
    expect(state.on).toHaveBeenCalled()
    expect(state.off).toHaveBeenCalled()
  })
})
