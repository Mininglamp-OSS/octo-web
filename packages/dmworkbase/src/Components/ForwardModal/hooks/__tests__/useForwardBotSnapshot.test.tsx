// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"

const hoisted = vi.hoisted(() => ({
  channelInfos: new Map<string, {
    channel: { channelID: string; channelType: number }
    title?: string
    orgData?: { robot?: unknown }
  }>(),
  fetchCurrentImChannelInfo: vi.fn(),
  subscribers: new Map<string, Array<{
    uid?: string
    remark?: string
    name?: string
    orgData?: { real_name?: string; realname_verified?: boolean; robot?: unknown }
  }>>(),
  syncCurrentImChannelSubscribers: vi.fn(async () => undefined),
  listBots: vi.fn(async (_spaceId: string) => [] as Array<{ uid?: string; name?: string; creator_uid?: string }>),
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
  return { Channel, ChannelTypePerson: 1 }
})

vi.mock("../../../../im-runtime/currentChannelRuntime", () => ({
  getCurrentImChannelInfo: (channel: { channelID: string; channelType: number }) =>
    hoisted.channelInfos.get(channel.channelID) ?? {
      channel,
      title: `name:${channel.channelID}`,
      orgData: { robot: 0 },
    },
  fetchCurrentImChannelInfo: hoisted.fetchCurrentImChannelInfo,
  getCurrentImChannelSubscribers: (channel: { channelID: string }) =>
    hoisted.subscribers.get(channel.channelID) ?? [],
  syncCurrentImChannelSubscribers: hoisted.syncCurrentImChannelSubscribers,
}))

vi.mock("../../../../Service/SpaceBotService", () => ({
  default: { list: hoisted.listBots, listShared: hoisted.listBots },
}))

import { Channel } from "wukongimjssdk"
import { useForwardBotSnapshot, selectedBotUids } from "../useForwardBotSnapshot"
import type { ForwardBotSnapshot } from "../../grant"

function Probe({
  selectedIDs,
  selectedChannels,
  spaceId,
  enabled,
  resolveName = (uid) => `name:${uid}`,
  onValue,
  onGetter,
  onHumanGetter,
}: {
  selectedIDs: string[]
  selectedChannels: Channel[]
  spaceId?: string
  enabled: boolean
  resolveName?: (uid: string) => string
  onValue: (value: ForwardBotSnapshot | undefined) => void
  onGetter?: (read: () => string[]) => void
  onHumanGetter?: (read: () => string[]) => void
}) {
  const { snapshot, readLatestSelectedBotUids, readLatestHumanUids } = useForwardBotSnapshot(
    selectedIDs,
    selectedChannels,
    spaceId,
    enabled,
    resolveName,
  )
  onValue(snapshot)
  onGetter?.(readLatestSelectedBotUids)
  onHumanGetter?.(readLatestHumanUids)
  return null
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe("useForwardBotSnapshot", () => {
  let container: HTMLDivElement
  let latest: ForwardBotSnapshot | undefined
  let readLatest: () => string[]
  let readLatestHumans: () => string[]

  beforeEach(() => {
    hoisted.channelInfos = new Map()
    hoisted.fetchCurrentImChannelInfo.mockReset().mockImplementation(async (channel) =>
      hoisted.channelInfos.get(channel.channelID) ?? {
        channel,
        title: `name:${channel.channelID}`,
        orgData: { robot: 0 },
      },
    )
    hoisted.subscribers = new Map()
    hoisted.syncCurrentImChannelSubscribers.mockReset().mockResolvedValue(undefined)
    hoisted.listBots.mockReset().mockResolvedValue([])
    container = document.createElement("div")
    document.body.appendChild(container)
    readLatest = () => []
    readLatestHumans = () => []
  })

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()
  })

  function renderSync(props: {
    selectedIDs: string[]
    selectedChannels: Channel[]
    spaceId?: string
    enabled: boolean
    resolveName?: (uid: string) => string
  }) {
    act(() => {
      ReactDOM.render(
        <Probe
          {...props}
          onValue={(v) => (latest = v)}
          onGetter={(r) => (readLatest = r)}
          onHumanGetter={(r) => (readLatestHumans = r)}
        />,
        container,
      )
    })
  }
  async function render(props: {
    selectedIDs: string[]
    selectedChannels: Channel[]
    spaceId?: string
    enabled: boolean
    resolveName?: (uid: string) => string
  }) {
    await act(async () => {
      ReactDOM.render(
        <Probe
          {...props}
          onValue={(v) => (latest = v)}
          onGetter={(r) => (readLatest = r)}
          onHumanGetter={(r) => (readLatestHumans = r)}
        />,
        container,
      )
      await flush()
    })
  }

  it("returns undefined when disabled (grant switch off), never touching the Bot service", async () => {
    hoisted.listBots.mockResolvedValue([{ uid: "b_1", name: "Bot", creator_uid: "u_ada" }])
    await render({
      selectedIDs: ["u_ada"],
      selectedChannels: [new Channel("u_ada", 1)],
      spaceId: "s_1",
      enabled: false,
    })
    expect(latest).toBeUndefined()
    expect(hoisted.listBots).not.toHaveBeenCalled()
  })

  it("reports a loading (not-ready) snapshot before the resolve completes, carrying zero Bots", async () => {
    let release: (v: Array<{ uid?: string; name?: string; creator_uid?: string }>) => void = () => {}
    hoisted.listBots.mockReturnValue(new Promise((r) => (release = r)))
    renderSync({
      selectedIDs: ["u_ada"],
      selectedChannels: [new Channel("u_ada", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    // Synchronously after enabling: loading, ready=false, no Bots can be confirmed.
    expect(latest?.ready).toBe(false)
    expect(selectedBotUids(latest)).toEqual([])
    await act(async () => {
      release([{ uid: "b_1", name: "Writer Bot", creator_uid: "u_ada" }])
      await flush()
    })
    expect(latest?.ready).toBe(true)
    expect(selectedBotUids(latest)).toEqual(["b_1"])
  })

  it("returns a ready empty snapshot when there is no Bot for any selected person (zero-Bot)", async () => {
    hoisted.listBots.mockResolvedValue([{ uid: "b_x", name: "Other", creator_uid: "u_someone_else" }])
    await render({
      selectedIDs: ["u_ada"],
      selectedChannels: [new Channel("u_ada", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    expect(latest?.ready).toBe(true)
    expect(latest?.groups).toEqual([])
    expect(selectedBotUids(latest)).toEqual([])
  })

  it("groups a person's Bots, defaults them all selected, and reports N people / M Bots", async () => {
    hoisted.listBots.mockResolvedValue([
      { uid: "b_1", name: "Writer Bot", creator_uid: "u_ada" },
      { uid: "b_2", name: "Review Bot", creator_uid: "u_ada" },
    ])
    await render({
      selectedIDs: ["u_ada"],
      selectedChannels: [new Channel("u_ada", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    expect(latest?.ready).toBe(true)
    expect(latest?.peopleCount).toBe(1)
    expect(latest?.botCount).toBe(2)
    expect(latest?.groups).toHaveLength(1)
    expect(latest?.groups[0]).toMatchObject({ uid: "u_ada", name: "name:u_ada" })
    expect(latest?.groups[0].bots.map((b) => [b.uid, b.selected])).toEqual([
      ["b_1", true],
      ["b_2", true],
    ])
    expect(selectedBotUids(latest)).toEqual(["b_1", "b_2"])
  })

  it("classifies a directly selected Bot as a cancellable Bot, never as a human", async () => {
    hoisted.listBots.mockResolvedValue([
      { uid: "b_direct", name: "Direct Bot", creator_uid: "u_owner" },
    ])
    await render({
      selectedIDs: ["b_direct"],
      selectedChannels: [new Channel("b_direct", 1)],
      spaceId: "s_1",
      enabled: true,
    })

    expect(latest?.peopleCount).toBe(0)
    expect(latest?.groups[0]).toMatchObject({
      uid: "direct:b_direct",
      bots: [{ uid: "b_direct", selected: true }],
    })
    expect(readLatestHumans()).toEqual([])
    expect(readLatest()).toEqual(["b_direct"])

    act(() => { latest?.toggleBot("b_direct") })
    expect(readLatest()).toEqual([])
  })

  it("cancels a single Bot while keeping the rest, updating the M count and selected uids", async () => {
    hoisted.listBots.mockResolvedValue([
      { uid: "b_1", name: "Writer Bot", creator_uid: "u_ada" },
      { uid: "b_2", name: "Review Bot", creator_uid: "u_ada" },
    ])
    await render({
      selectedIDs: ["u_ada"],
      selectedChannels: [new Channel("u_ada", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    act(() => { latest?.toggleBot("b_2") })
    expect(latest?.botCount).toBe(1)
    expect(selectedBotUids(latest)).toEqual(["b_1"])
    // Re-selecting flips it back on.
    act(() => { latest?.toggleBot("b_2") })
    expect(selectedBotUids(latest)).toEqual(["b_1", "b_2"])
  })

  it("counts only humans and offers only Bots that are actually in a selected group", async () => {
    hoisted.subscribers.set("g_1", [
      { uid: "u_owner", name: "Owner", orgData: { robot: 0 } },
      ...Array.from({ length: 8 }, (_, index) => ({
        uid: `b_group_${index}`,
        name: `Group Bot ${index}`,
        orgData: { robot: 1 },
      })),
    ])
    hoisted.listBots.mockResolvedValue([
      ...Array.from({ length: 8 }, (_, index) => ({
        uid: `b_group_${index}`,
        name: `Group Bot ${index}`,
        creator_uid: "u_owner",
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        uid: `b_elsewhere_${index}`,
        name: `Other Bot ${index}`,
        creator_uid: "u_owner",
      })),
    ])

    await render({
      selectedIDs: ["g_1"],
      selectedChannels: [new Channel("g_1", 2)],
      spaceId: "s_1",
      enabled: true,
      resolveName: (uid) => uid === "g_1" ? "测试群" : "",
    })

    expect(latest?.peopleCount).toBe(1)
    expect(latest?.botCount).toBe(8)
    expect(latest?.groups).toHaveLength(1)
    expect(latest?.groups[0]).toMatchObject({ uid: "group:g_1", name: "测试群" })
    expect(selectedBotUids(latest)).toEqual(
      Array.from({ length: 8 }, (_, index) => `b_group_${index}`),
    )
    expect(readLatestHumans()).toEqual(["u_owner"])

    act(() => { latest?.toggleBot("b_group_3") })
    expect(readLatest()).not.toContain("b_group_3")
    expect(readLatestHumans()).toEqual(["u_owner"])
  })

  it("uses the Space roster as a fallback Bot signal and fails closed for unknown members", async () => {
    hoisted.subscribers.set("g_1", [
      { uid: "b_roster", name: "Roster Bot" },
      { uid: "u_unknown", name: "Unknown" },
    ])
    hoisted.listBots.mockResolvedValue([
      { uid: "b_roster", name: "Roster Bot", creator_uid: "u_someone" },
    ])

    await render({
      selectedIDs: ["g_1"],
      selectedChannels: [new Channel("g_1", 2)],
      spaceId: "s_1",
      enabled: true,
    })

    expect(latest?.ready).toBe(false)
    expect(latest?.error).toBe(true)
    expect(readLatest()).toEqual([])
    expect(readLatestHumans()).toEqual([])
  })

  it("expands group members and de-duplicates people across group + person targets", async () => {
    hoisted.subscribers.set("g_1", [
      { uid: "u_ada", orgData: { robot: 0 } },
      { uid: "u_grace", orgData: { robot: 0 } },
      { uid: "u_ada", orgData: { robot: 0 } },
    ])
    hoisted.listBots.mockResolvedValue([
      { uid: "b_1", name: "Ada Bot", creator_uid: "u_ada" },
      { uid: "b_2", name: "Grace Bot", creator_uid: "u_grace" },
    ])
    await render({
      selectedIDs: ["g_1", "u_ada"],
      selectedChannels: [new Channel("g_1", 2), new Channel("u_ada", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    // u_ada appears in both the group and as a person target — counted once.
    expect(latest?.peopleCount).toBe(2)
    // Only u_ada was selected directly, so u_grace's Space-wide Bot is not pulled in transitively.
    expect(latest?.botCount).toBe(1)
    expect(latest?.groups.map((g) => g.uid)).toEqual(["u_ada"])
    expect(readLatestHumans().sort()).toEqual(["u_ada", "u_grace"])
  })

  it("fails closed with a recoverable retry when the Bot lookup throws", async () => {
    hoisted.listBots.mockRejectedValue(new Error("boom"))
    await render({
      selectedIDs: ["u_ada"],
      selectedChannels: [new Channel("u_ada", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    expect(latest?.ready).toBe(false)
    expect(latest?.error).toBe(true)
    expect(latest?.groups).toEqual([])
    expect(selectedBotUids(latest)).toEqual([])
    hoisted.listBots.mockResolvedValue([{ uid: "b_1", name: "Bot", creator_uid: "u_ada" }])
    await act(async () => {
      latest?.retry?.()
      await flush()
    })
    expect(latest?.ready).toBe(true)
    expect(selectedBotUids(latest)).toEqual(["b_1"])
  })

  it("fails closed when group roster sync fails", async () => {
    hoisted.syncCurrentImChannelSubscribers.mockRejectedValue(new Error("boom"))
    await render({
      selectedIDs: ["g_1"],
      selectedChannels: [new Channel("g_1", 2)],
      spaceId: "s_1",
      enabled: true,
    })
    expect(latest?.ready).toBe(false)
    expect(latest?.error).toBe(true)
    expect(hoisted.listBots).not.toHaveBeenCalled()
  })

  it("fails closed with retry when the document Space id is missing", async () => {
    hoisted.listBots.mockResolvedValue([{ uid: "b_1", name: "Bot", creator_uid: "u_ada" }])
    await render({
      selectedIDs: ["u_ada"],
      selectedChannels: [new Channel("u_ada", 1)],
      spaceId: undefined,
      enabled: true,
    })
    expect(latest?.ready).toBe(false)
    expect(latest?.error).toBe(true)
    expect(latest?.retry).toEqual(expect.any(Function))
    expect(readLatest()).toEqual([])
    expect(hoisted.listBots).not.toHaveBeenCalled()
  })

  it("invalidates the old resolve on a target switch: goes back to loading and carries no stale Bot", async () => {
    hoisted.listBots.mockResolvedValue([{ uid: "b_ada", name: "Ada Bot", creator_uid: "u_ada" }])
    await render({
      selectedIDs: ["u_ada"],
      selectedChannels: [new Channel("u_ada", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    expect(selectedBotUids(latest)).toEqual(["b_ada"])

    // Switch to a new target whose Bot fetch is still pending — old Bot must NOT persist.
    let release: (v: Array<{ uid?: string; name?: string; creator_uid?: string }>) => void = () => {}
    hoisted.listBots.mockReturnValueOnce(new Promise((r) => (release = r)))
    renderSync({
      selectedIDs: ["u_grace"],
      selectedChannels: [new Channel("u_grace", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    expect(latest?.ready).toBe(false)
    expect(selectedBotUids(latest)).toEqual([])
    await act(async () => {
      release([{ uid: "b_grace", name: "Grace Bot", creator_uid: "u_grace" }])
      await flush()
    })
    expect(selectedBotUids(latest)).toEqual(["b_grace"])
  })

  it("discards a stale in-flight response for a superseded target (latest wins)", async () => {
    // First target's fetch is slow; the second target resolves fast. The stale first response must
    // not overwrite the fresher second one.
    let releaseSlow: (v: Array<{ uid?: string; name?: string; creator_uid?: string }>) => void = () => {}
    hoisted.listBots.mockReturnValueOnce(new Promise((r) => (releaseSlow = r)))
    renderSync({
      selectedIDs: ["u_ada"],
      selectedChannels: [new Channel("u_ada", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    hoisted.listBots.mockResolvedValueOnce([{ uid: "b_grace", name: "Grace Bot", creator_uid: "u_grace" }])
    await act(async () => {
      ReactDOM.render(
        <Probe
          selectedIDs={["u_grace"]}
          selectedChannels={[new Channel("u_grace", 1)]}
          spaceId="s_1"
          enabled={true}
          onValue={(v) => (latest = v)}
        />,
        container,
      )
      await flush()
    })
    expect(selectedBotUids(latest)).toEqual(["b_grace"])
    // Now the stale first fetch resolves — it must be ignored.
    await act(async () => {
      releaseSlow([{ uid: "b_ada", name: "Ada Bot", creator_uid: "u_ada" }])
      await flush()
    })
    expect(selectedBotUids(latest)).toEqual(["b_grace"])
  })

  // ---- readLatestSelectedBotUids() confirm-path getter (no render-phase ref write) ----

  it("getter returns [] while gated off (no render / effect needed)", () => {
    renderSync({
      selectedIDs: ["u_ada"],
      selectedChannels: [new Channel("u_ada", 1)],
      spaceId: "s_1",
      enabled: false,
    })
    expect(readLatest()).toEqual([])
  })

  it("getter reads the freshest set for an instant confirm in the same tick as the resolve", async () => {
    let release: (v: Array<{ uid?: string; name?: string; creator_uid?: string }>) => void = () => {}
    hoisted.listBots.mockReturnValue(new Promise((r) => (release = r)))
    renderSync({
      selectedIDs: ["u_ada"],
      selectedChannels: [new Channel("u_ada", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    // Loading: a confirm here must carry zero Bots.
    expect(readLatest()).toEqual([])
    await act(async () => {
      release([{ uid: "b_1", name: "Writer Bot", creator_uid: "u_ada" }])
      await flush()
    })
    // Right after the resolve commits, the getter already sees the new Bot (ref updated in commit).
    expect(readLatest()).toEqual(["b_1"])
  })

  it("getter drops stale Bots synchronously on a target switch, before the new resolve lands", async () => {
    hoisted.listBots.mockResolvedValue([{ uid: "b_ada", name: "Ada Bot", creator_uid: "u_ada" }])
    await render({
      selectedIDs: ["u_ada"],
      selectedChannels: [new Channel("u_ada", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    expect(readLatest()).toEqual(["b_ada"])

    let release: (v: Array<{ uid?: string; name?: string; creator_uid?: string }>) => void = () => {}
    hoisted.listBots.mockReturnValueOnce(new Promise((r) => (release = r)))
    renderSync({
      selectedIDs: ["u_grace"],
      selectedChannels: [new Channel("u_grace", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    // Target switched, new fetch pending → getter returns [] immediately (no stale Bot leaks).
    expect(readLatest()).toEqual([])
    await act(async () => {
      release([{ uid: "b_grace", name: "Grace Bot", creator_uid: "u_grace" }])
      await flush()
    })
    expect(readLatest()).toEqual(["b_grace"])
  })

  it("getter reflects a cancellation done via the snapshot's toggle", async () => {
    hoisted.listBots.mockResolvedValue([
      { uid: "b_1", name: "Writer Bot", creator_uid: "u_ada" },
      { uid: "b_2", name: "Review Bot", creator_uid: "u_ada" },
    ])
    await render({
      selectedIDs: ["u_ada"],
      selectedChannels: [new Channel("u_ada", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    expect(readLatest()).toEqual(["b_1", "b_2"])
    act(() => { latest?.toggleBot("b_2") })
    // A confirm right after cancelling reads the reduced set (no passive-effect flush required).
    expect(readLatest()).toEqual(["b_1"])
    act(() => { latest?.toggleBot("b_2") })
    expect(readLatest()).toEqual(["b_1", "b_2"])
  })

  it("preserves cancellation across grant toggle re-resolve and prunes vanished Bots", async () => {
    hoisted.listBots.mockResolvedValue([
      { uid: "b_1", name: "Writer Bot", creator_uid: "u_ada" },
      { uid: "b_2", name: "Review Bot", creator_uid: "u_ada" },
    ])
    const base = {
      selectedIDs: ["u_ada"],
      selectedChannels: [new Channel("u_ada", 1)],
      spaceId: "s_1",
    }
    await render({ ...base, enabled: true })
    act(() => { latest?.toggleBot("b_2") })
    expect(readLatest()).toEqual(["b_1"])

    renderSync({ ...base, enabled: false })
    hoisted.listBots.mockResolvedValue([
      { uid: "b_1", name: "Writer Bot", creator_uid: "u_ada" },
      { uid: "b_3", name: "New Bot", creator_uid: "u_ada" },
    ])
    await render({ ...base, enabled: true })
    // b_2 vanished and is pruned; its cancellation does not affect the new b_3.
    expect(readLatest()).toEqual(["b_1", "b_3"])
  })

  it("preserves cancellation across a target re-resolve when the Bot still exists", async () => {
    hoisted.listBots.mockResolvedValue([
      { uid: "b_shared", name: "Shared Bot", creator_uid: "u_ada" },
    ])
    await render({
      selectedIDs: ["u_ada"],
      selectedChannels: [new Channel("u_ada", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    act(() => { latest?.toggleBot("b_shared") })

    hoisted.listBots.mockResolvedValue([
      { uid: "b_shared", name: "Shared Bot", creator_uid: "u_grace" },
      { uid: "b_new", name: "New Bot", creator_uid: "u_grace" },
    ])
    await render({
      selectedIDs: ["u_grace"],
      selectedChannels: [new Channel("u_grace", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    expect(readLatest()).toEqual(["b_new"])
  })

  it("getter discards a stale in-flight response for a superseded target (latest wins)", async () => {
    let releaseSlow: (v: Array<{ uid?: string; name?: string; creator_uid?: string }>) => void = () => {}
    hoisted.listBots.mockReturnValueOnce(new Promise((r) => (releaseSlow = r)))
    renderSync({
      selectedIDs: ["u_ada"],
      selectedChannels: [new Channel("u_ada", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    hoisted.listBots.mockResolvedValueOnce([{ uid: "b_grace", name: "Grace Bot", creator_uid: "u_grace" }])
    await render({
      selectedIDs: ["u_grace"],
      selectedChannels: [new Channel("u_grace", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    expect(readLatest()).toEqual(["b_grace"])
    await act(async () => {
      releaseSlow([{ uid: "b_ada", name: "Ada Bot", creator_uid: "u_ada" }])
      await flush()
    })
    // The late first fetch is ignored; the getter still reflects the newest target only.
    expect(readLatest()).toEqual(["b_grace"])
  })
})
