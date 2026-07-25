// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"

const hoisted = vi.hoisted(() => ({
  currentSpaceId: "" as string,
  searchChatCandidates: undefined as
    | undefined
    | ((params: any) => Promise<any>),
}))

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

vi.mock("../../../../App", () => ({
  default: {
    get shared() {
      return {
        get currentSpaceId() {
          return hoisted.currentSpaceId
        },
      }
    },
    get searchChatCandidates() {
      return hoisted.searchChatCandidates
    },
  },
}))

// 保持 candidateToForwardItem 的 getCachedChannelInfo 走注入默认（读运行时缓存桩），
// 但我们直接 mock currentChannelRuntime 的 get 分支 → undefined，避免它触碰 SDK。
vi.mock("../../../../im-runtime/currentChannelRuntime", () => ({
  getCurrentImChannelInfo: () => undefined,
}))

vi.mock("../../../../Service/Thread", () => ({
  parseThreadChannelId: () => null,
}))

import { Channel } from "wukongimjssdk"
import { useForwardSearch } from "../useForwardSearch"

function Probe({
  keyword,
  onCandidate,
  onValue,
}: {
  keyword: string
  onCandidate: (channelID: string, channel: Channel) => void
  onValue: (value: ReturnType<typeof useForwardSearch>) => void
}) {
  const value = useForwardSearch(keyword, onCandidate)
  onValue(value)
  return null
}

async function flushMicrotasks() {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

describe("useForwardSearch", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    hoisted.currentSpaceId = ""
    hoisted.searchChatCandidates = undefined
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()
  })

  it("clears results and skips call when keyword.length < 2", async () => {
    const spy = vi.fn(async () => [{ chat_id: "g", chat_type: "group", name: "G" }])
    hoisted.searchChatCandidates = spy

    let latest: ReturnType<typeof useForwardSearch> | undefined
    await act(async () => {
      ReactDOM.render(
        <Probe
          keyword="a"
          onCandidate={() => {}}
          onValue={(v) => (latest = v)}
        />,
        container,
      )
      await flushMicrotasks()
    })

    expect(spy).not.toHaveBeenCalled()
    expect(latest!.searchGroupItems).toEqual([])
  })

  it("clears results without throwing when searchChatCandidates is unregistered", async () => {
    hoisted.searchChatCandidates = undefined

    let latest: ReturnType<typeof useForwardSearch> | undefined
    await act(async () => {
      ReactDOM.render(
        <Probe
          keyword="engineering"
          onCandidate={() => {}}
          onValue={(v) => (latest = v)}
        />,
        container,
      )
      await flushMicrotasks()
    })

    expect(latest!.searchGroupItems).toEqual([])
  })

  it("drops a stale response when a newer keyword request supersedes it (reqId race guard)", async () => {
    // 两次 keyword 变化：老请求延后 resolve 得比新请求晚，reqId 守卫必须丢弃老结果。
    let resolveOld: (v: any) => void = () => {}
    let resolveNew: (v: any) => void = () => {}
    const oldResult = [{ chat_id: "old", chat_type: "group", name: "Old" }]
    const newResult = [{ chat_id: "new", chat_type: "group", name: "New" }]

    let callCount = 0
    hoisted.searchChatCandidates = vi.fn(async () => {
      callCount += 1
      if (callCount === 1) return new Promise((res) => { resolveOld = res })
      return new Promise((res) => { resolveNew = res })
    }) as any

    let latest: ReturnType<typeof useForwardSearch> | undefined
    await act(async () => {
      ReactDOM.render(
        <Probe
          keyword="old-word"
          onCandidate={() => {}}
          onValue={(v) => (latest = v)}
        />,
        container,
      )
      await flushMicrotasks()
    })

    // 触发第二次请求（更新 keyword）：老请求仍挂起。
    await act(async () => {
      ReactDOM.render(
        <Probe
          keyword="new-word"
          onCandidate={() => {}}
          onValue={(v) => (latest = v)}
        />,
        container,
      )
      await flushMicrotasks()
    })

    // 老请求晚于新请求 resolve：reqId !== requestRef.current → 丢弃。
    await act(async () => {
      resolveNew(newResult)
      await flushMicrotasks()
      resolveOld(oldResult)
      await flushMicrotasks()
    })

    const ids = latest!.searchGroupItems.map((i) => i.channelID)
    expect(ids).toEqual(["new"])
    expect(ids).not.toContain("old")
  })

  it("registers each returned candidate via onCandidateChannel for the channelMap", async () => {
    hoisted.searchChatCandidates = vi.fn(async () => [
      { chat_id: "g1", chat_type: "group", name: "G1" },
      { chat_id: "d1", chat_type: "direct", name: "Alice" },
    ]) as any

    const spy = vi.fn()
    let latest: ReturnType<typeof useForwardSearch> | undefined
    await act(async () => {
      ReactDOM.render(
        <Probe
          keyword="foo"
          onCandidate={spy}
          onValue={(v) => (latest = v)}
        />,
        container,
      )
      await flushMicrotasks()
    })

    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls[0][0]).toBe("g1")
    expect(spy.mock.calls[1][0]).toBe("d1")
    // 命中类型正确传递到 Channel：direct → 1，group → 2。
    expect(spy.mock.calls[0][1].channelType).toBe(2)
    expect(spy.mock.calls[1][1].channelType).toBe(1)
    expect(latest!.searchGroupItems.map((i) => i.channelID)).toEqual(["g1", "d1"])
  })
})
