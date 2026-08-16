// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"

vi.mock("wukongimjssdk", () => {
  class Channel {
    channelID: string
    channelType: number
    constructor(channelID: string, channelType: number) {
      this.channelID = channelID
      this.channelType = channelType
    }
  }
  return { Channel, ChannelTypeGroup: 2, ChannelTypePerson: 1 }
})

import { Channel } from "wukongimjssdk"
import {
  useForwardSelection,
  type UseForwardSelectionResult,
} from "../useForwardSelection"

function Probe({
  channelMapRef,
  onValue,
}: {
  channelMapRef: React.MutableRefObject<Map<string, Channel>>
  onValue: (value: UseForwardSelectionResult) => void
}) {
  const value = useForwardSelection(channelMapRef)
  onValue(value)
  return null
}

function item(channelID: string, channelType = 2) {
  return {
    channelID,
    channelType,
    displayName: channelID,
  } as any
}

describe("useForwardSelection", () => {
  let container: HTMLDivElement
  let channelMapRef: React.MutableRefObject<Map<string, Channel>>
  let latest: UseForwardSelectionResult

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    channelMapRef = {
      current: new Map<string, Channel>([
        ["g1", new Channel("g1", 2)],
        ["g2", new Channel("g2", 2)],
      ]),
    }
  })

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()
  })

  function render() {
    act(() => {
      ReactDOM.render(
        <Probe channelMapRef={channelMapRef} onValue={(v) => (latest = v)} />,
        container,
      )
    })
  }

  it("adds an item to selectedIDs, then removes it on a second toggle (idempotent toggle)", () => {
    render()
    expect(latest.selectedIDs).toEqual([])

    act(() => latest.toggleSelect(item("g1")))
    expect(latest.selectedIDs).toEqual(["g1"])

    act(() => latest.toggleSelect(item("g1")))
    expect(latest.selectedIDs).toEqual([])
  })

  it("derives selectedChannels via channelMapRef and drops entries missing from the map", () => {
    render()
    act(() => latest.toggleSelect(item("g1")))
    act(() => latest.toggleSelect(item("g-missing")))

    expect(latest.selectedIDs).toEqual(["g1", "g-missing"])
    // 兜底：channelMap 里没有的 id 走 filter(Boolean) 剔除，避免上层 confirm 拿到 undefined。
    expect(latest.selectedChannels.map((ch) => ch.channelID)).toEqual(["g1"])
  })

  it("readSelectedChannels reads the latest snapshot without re-invoking the hook", () => {
    render()
    // 捕获最开始那一次的 read 函数引用（模拟稳定的 confirm() 闭包）。
    const readAtStart = latest.readSelectedChannels
    expect(readAtStart()).toEqual([])

    act(() => latest.toggleSelect(item("g1")))
    act(() => latest.toggleSelect(item("g2")))

    // 关键：同一个 readSelectedChannels 引用能读到最新 selectedIDs（走 ref 快照）。
    expect(readAtStart().map((ch) => ch.channelID)).toEqual(["g1", "g2"])
  })

  it("reset clears selectedIDs and readSelectedChannels returns empty afterwards", () => {
    render()
    act(() => latest.toggleSelect(item("g1")))
    act(() => latest.reset())

    expect(latest.selectedIDs).toEqual([])
    expect(latest.readSelectedChannels()).toEqual([])
  })
})
