// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"

const hoisted = vi.hoisted(() => ({
  subscribers: new Map<string, Array<{ uid?: string }>>(),
  syncCurrentImChannelSubscribers: vi.fn(async () => undefined),
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

  return {
    Channel,
    ChannelTypePerson: 1,
  }
})

vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  getCurrentImChannelSubscribers: (channel: { channelID: string }) =>
    hoisted.subscribers.get(channel.channelID) ?? [],
  syncCurrentImChannelSubscribers: hoisted.syncCurrentImChannelSubscribers,
}))

import { Channel } from "wukongimjssdk"
import { useForwardTargetMemberCount } from "../hooks/useForwardTargetMemberCount"

function Probe({
  selectedIDs,
  selectedChannels,
  onValue,
}: {
  selectedIDs: string[]
  selectedChannels: Channel[]
  onValue: (value: number | undefined) => void
}) {
  const value = useForwardTargetMemberCount(selectedIDs, selectedChannels)
  onValue(value)
  return null
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe("useForwardTargetMemberCount", () => {
  beforeEach(() => {
    hoisted.subscribers = new Map()
    hoisted.syncCurrentImChannelSubscribers.mockReset()
    hoisted.syncCurrentImChannelSubscribers.mockResolvedValue(undefined)
  })

  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("recomputes once a selected id gets resolved into a channel", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    let latest: number | undefined

    const person = new Channel("user-1", 1)
    const group = new Channel("group-1", 2)
    hoisted.subscribers.set("group-1", [{ uid: "user-1" }, { uid: "user-2" }])

    await act(async () => {
      ReactDOM.render(
        <Probe
          selectedIDs={["user-1", "group-1"]}
          selectedChannels={[person]}
          onValue={(value) => {
            latest = value
          }}
        />,
        container,
      )
      await flushMicrotasks()
    })

    expect(latest).toBeUndefined()

    await act(async () => {
      ReactDOM.render(
        <Probe
          selectedIDs={["user-1", "group-1"]}
          selectedChannels={[person, group]}
          onValue={(value) => {
            latest = value
          }}
        />,
        container,
      )
      await flushMicrotasks()
    })

    expect(hoisted.syncCurrentImChannelSubscribers).toHaveBeenCalledTimes(1)
    expect(latest).toBe(2)

    act(() => {
      ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()
  })

  it("dedupes a Person UID that also appears in a selected group's subscribers", async () => {
    // 语义：Set<uid> 存放最终授权成员；Person 与其在群里的 uid 相同时只算一次。
    const container = document.createElement("div")
    document.body.appendChild(container)
    let latest: number | undefined

    const person = new Channel("user-1", 1)
    const group = new Channel("group-1", 2)
    // user-1 既是私聊对端，也是群成员 → 应去重为 2（user-1 + user-2），而非 3。
    hoisted.subscribers.set("group-1", [{ uid: "user-1" }, { uid: "user-2" }])

    await act(async () => {
      ReactDOM.render(
        <Probe
          selectedIDs={["user-1", "group-1"]}
          selectedChannels={[person, group]}
          onValue={(v) => (latest = v)}
        />,
        container,
      )
      await flushMicrotasks()
    })

    expect(latest).toBe(2)

    act(() => {
      ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()
  })

  it("falls back to cached subscribers when syncCurrentImChannelSubscribers rejects", async () => {
    // 语义：sync 拉取失败时 try/catch 兜底，仍用 getCurrentImChannelSubscribers 缓存计算。
    const container = document.createElement("div")
    document.body.appendChild(container)
    let latest: number | undefined

    const group = new Channel("group-1", 2)
    hoisted.subscribers.set("group-1", [{ uid: "u1" }, { uid: "u2" }, { uid: "u3" }])
    hoisted.syncCurrentImChannelSubscribers.mockRejectedValue(new Error("net"))

    await act(async () => {
      ReactDOM.render(
        <Probe
          selectedIDs={["group-1"]}
          selectedChannels={[group]}
          onValue={(v) => (latest = v)}
        />,
        container,
      )
      await flushMicrotasks()
    })

    expect(latest).toBe(3)

    act(() => {
      ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()
  })

  it("stale-guard: a slow sync from an outdated selection must not overwrite the new selection's count", async () => {
    // 场景：先选 group-1（订阅数 5，sync 慢），随后切到 group-2（订阅数 2，sync 快）。
    // 语义：group-1 的 sync 晚 resolve 时，cancelled 已置 true，不得把 count 覆写回 5。
    const container = document.createElement("div")
    document.body.appendChild(container)
    let latest: number | undefined

    const groupA = new Channel("group-A", 2)
    const groupB = new Channel("group-B", 2)
    hoisted.subscribers.set("group-A", Array.from({ length: 5 }, (_, i) => ({ uid: `a${i}` })))
    hoisted.subscribers.set("group-B", [{ uid: "b1" }, { uid: "b2" }])

    let resolveA: () => void = () => {}
    const slowA = new Promise<void>((res) => { resolveA = res })
    hoisted.syncCurrentImChannelSubscribers.mockImplementation(async (ch: any) => {
      if (ch.channelID === "group-A") return slowA
      return undefined
    })

    // 第一次渲染：选中 A（sync 挂起）。
    await act(async () => {
      ReactDOM.render(
        <Probe
          selectedIDs={["group-A"]}
          selectedChannels={[groupA]}
          onValue={(v) => (latest = v)}
        />,
        container,
      )
      await flushMicrotasks()
    })

    // 第二次渲染：切到 B。此举应触发 effect cleanup → cancelled=true。
    await act(async () => {
      ReactDOM.render(
        <Probe
          selectedIDs={["group-B"]}
          selectedChannels={[groupB]}
          onValue={(v) => (latest = v)}
        />,
        container,
      )
      await flushMicrotasks()
    })

    expect(latest).toBe(2)

    // 让老 A 的 sync 姗姗来迟 resolve。cancelled 守卫必须让它无声消化。
    await act(async () => {
      resolveA()
      await flushMicrotasks()
      await flushMicrotasks()
    })

    // 关键回归：不得把 count 覆盖成 5。
    expect(latest).toBe(2)

    act(() => {
      ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()
  })

  it("returns undefined for a person-only selection (individual forwards do not show the hint)", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    let latest: number | undefined

    const person = new Channel("user-1", 1)

    await act(async () => {
      ReactDOM.render(
        <Probe
          selectedIDs={["user-1"]}
          selectedChannels={[person]}
          onValue={(v) => (latest = v)}
        />,
        container,
      )
      await flushMicrotasks()
    })

    expect(latest).toBeUndefined()

    act(() => {
      ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()
  })
})
