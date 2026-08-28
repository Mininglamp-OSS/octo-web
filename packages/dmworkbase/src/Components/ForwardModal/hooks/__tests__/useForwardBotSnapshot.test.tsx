// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"

const hoisted = vi.hoisted(() => ({
  channelInfos: new Map<
    string,
    {
      channel: { channelID: string; channelType: number }
      title?: string
      orgData?: { robot?: unknown }
    }
  >(),
  fetchCurrentImChannelInfo: vi.fn(),
  pendingChannelInfoFetches: new Map<string, Promise<void>>(),
  subscribers: new Map<
    string,
    Array<{
      uid?: string
      remark?: string
      name?: string
      orgData?: {
        real_name?: string
        realname_verified?: boolean
        robot?: unknown
      }
    }>
  >(),
  syncCurrentImChannelSubscribers: vi.fn(async () => undefined),
  listBots: vi.fn(
    async (_spaceId: string) => [] as Array<{ uid?: string; name?: string; creator_uid?: string }>
  ),
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
  getPendingCurrentImChannelInfoFetch: (channel: { channelID: string }) =>
    hoisted.pendingChannelInfoFetches.get(channel.channelID),
  getCurrentImChannelSubscribers: (channel: { channelID: string }) =>
    hoisted.subscribers.get(channel.channelID) ?? [],
  syncCurrentImChannelSubscribers: hoisted.syncCurrentImChannelSubscribers,
}))

vi.mock("../../../../Service/SpaceBotService", () => ({
  default: { list: hoisted.listBots, listShared: hoisted.listBots },
}))

import { Channel } from "wukongimjssdk"
import { useForwardBotSnapshot, selectedBotUids } from "../useForwardBotSnapshot"
import type { ForwardBotSnapshot, ForwardGrantTargetPrincipals } from "../../grant"

function Probe({
  selectedIDs,
  selectedChannels,
  spaceId,
  enabled,
  resolveName = (uid) => `name:${uid}`,
  onValue,
  onGetter,
  onHumanGetter,
  onTargetGetter,
}: {
  selectedIDs: string[]
  selectedChannels: Channel[]
  spaceId?: string
  enabled: boolean
  resolveName?: (uid: string) => string
  onValue: (value: ForwardBotSnapshot | undefined) => void
  onGetter?: (read: () => string[]) => void
  onHumanGetter?: (read: () => string[]) => void
  onTargetGetter?: (read: () => ForwardGrantTargetPrincipals[]) => void
}) {
  const { snapshot, readLatestSelectedBotUids, readLatestHumanUids, readLatestPrincipalsByTarget } =
    useForwardBotSnapshot(selectedIDs, selectedChannels, spaceId, enabled, resolveName)
  onValue(snapshot)
  onGetter?.(readLatestSelectedBotUids)
  onHumanGetter?.(readLatestHumanUids)
  onTargetGetter?.(readLatestPrincipalsByTarget)
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
  let readLatestTargets: () => ForwardGrantTargetPrincipals[]

  beforeEach(() => {
    hoisted.channelInfos = new Map()
    hoisted.pendingChannelInfoFetches = new Map()
    hoisted.fetchCurrentImChannelInfo.mockReset().mockImplementation(
      async (channel) =>
        hoisted.channelInfos.get(channel.channelID) ?? {
          channel,
          title: `name:${channel.channelID}`,
          orgData: { robot: 0 },
        }
    )
    hoisted.subscribers = new Map()
    hoisted.syncCurrentImChannelSubscribers.mockReset().mockResolvedValue(undefined)
    hoisted.listBots.mockReset().mockResolvedValue([])
    container = document.createElement("div")
    document.body.appendChild(container)
    readLatest = () => []
    readLatestHumans = () => []
    readLatestTargets = () => []
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
          onTargetGetter={(r) => (readLatestTargets = r)}
        />,
        container
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
          onTargetGetter={(r) => (readLatestTargets = r)}
        />,
        container
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
    let release: (
      v: Array<{ uid?: string; name?: string; creator_uid?: string }>
    ) => void = () => {}
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
    hoisted.listBots.mockResolvedValue([
      { uid: "b_x", name: "Other", creator_uid: "u_someone_else" },
    ])
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
    expect(latest?.groups[0]).toMatchObject({
      uid: "u_ada",
      name: "name:u_ada",
    })
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

    act(() => {
      latest?.toggleBot("b_direct")
    })
    expect(readLatest()).toEqual([])
  })

  it("normalizes a Space-prefixed direct human uid for grants and creator Bot lookup", async () => {
    const prefixedUid = `s${"a".repeat(32)}_u_ada`
    hoisted.listBots.mockResolvedValue([{ uid: "b_1", name: "Ada Bot", creator_uid: "u_ada" }])

    await render({
      selectedIDs: [prefixedUid],
      selectedChannels: [new Channel(prefixedUid, 1)],
      spaceId: "s_1",
      enabled: true,
    })

    expect(readLatestHumans()).toEqual(["u_ada"])
    expect(readLatest()).toEqual(["b_1"])
    expect(readLatestTargets()).toEqual([
      { channelID: prefixedUid, channelType: 1, uids: ["u_ada", "b_1"] },
    ])
  })

  it("refreshes a prefixed direct creator label from the raw channel id", async () => {
    const prefixedUid = `s${"c".repeat(32)}_u_ada`
    hoisted.listBots.mockResolvedValue([
      { uid: "b_1", name: "Ada Bot", creator_uid: "u_ada" },
    ])
    await render({
      selectedIDs: [prefixedUid],
      selectedChannels: [new Channel(prefixedUid, 1)],
      spaceId: "s_1",
      enabled: true,
      resolveName: () => "",
    })
    expect(latest?.groups[0].name).toBe(`name:${prefixedUid}`)

    renderSync({
      selectedIDs: [prefixedUid],
      selectedChannels: [new Channel(prefixedUid, 1)],
      spaceId: "s_1",
      enabled: true,
      resolveName: (uid) => (uid === prefixedUid ? "Ada" : ""),
    })

    expect(latest?.groups[0].name).toBe("Ada")
  })

  it("matches a Space-prefixed direct Bot channel against the bare roster uid", async () => {
    const prefixedUid = `s${"b".repeat(32)}_b_direct`
    hoisted.listBots.mockResolvedValue([
      { uid: "b_direct", name: "Direct Bot", creator_uid: "u_owner" },
    ])

    await render({
      selectedIDs: [prefixedUid],
      selectedChannels: [new Channel(prefixedUid, 1)],
      spaceId: "s_1",
      enabled: true,
    })

    expect(readLatestHumans()).toEqual([])
    expect(readLatest()).toEqual(["b_direct"])
    expect(readLatestTargets()).toEqual([
      { channelID: prefixedUid, channelType: 1, uids: ["b_direct"] },
    ])
  })

  it("fetches unresolved direct identities concurrently", async () => {
    for (const uid of ["u_1", "u_2"]) {
      hoisted.channelInfos.set(uid, {
        channel: { channelID: uid, channelType: 1 },
        title: uid,
        orgData: {},
      })
    }
    const releases = new Map<string, (value: unknown) => void>()
    hoisted.fetchCurrentImChannelInfo.mockImplementation(
      (channel) =>
        new Promise((resolve) => {
          releases.set(channel.channelID, resolve)
        })
    )

    renderSync({
      selectedIDs: ["u_1", "u_2"],
      selectedChannels: [new Channel("u_1", 1), new Channel("u_2", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    await act(async () => {
      await flush()
    })

    expect(hoisted.fetchCurrentImChannelInfo).toHaveBeenCalledTimes(2)

    await act(async () => {
      for (const uid of ["u_1", "u_2"]) {
        releases.get(uid)?.({
          channel: { channelID: uid, channelType: 1 },
          title: uid,
          orgData: { robot: 0 },
        })
      }
      await flush()
    })

    expect(latest?.ready).toBe(true)
    expect(readLatestHumans()).toEqual(["u_1", "u_2"])
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
    act(() => {
      latest?.toggleBot("b_2")
    })
    expect(latest?.botCount).toBe(1)
    expect(selectedBotUids(latest)).toEqual(["b_1"])
    // Re-selecting flips it back on.
    act(() => {
      latest?.toggleBot("b_2")
    })
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
      resolveName: (uid) => (uid === "g_1" ? "测试群" : ""),
    })

    expect(latest?.peopleCount).toBe(1)
    expect(latest?.botCount).toBe(8)
    expect(latest?.groups).toHaveLength(1)
    expect(latest?.groups[0]).toMatchObject({
      uid: "group:g_1",
      name: "测试群",
    })
    expect(selectedBotUids(latest)).toEqual(
      Array.from({ length: 8 }, (_, index) => `b_group_${index}`)
    )
    expect(readLatestHumans()).toEqual(["u_owner"])
    expect(readLatestTargets()).toEqual([
      {
        channelID: "g_1",
        channelType: 2,
        uids: ["u_owner", ...Array.from({ length: 8 }, (_, index) => `b_group_${index}`)],
      },
    ])

    act(() => {
      latest?.toggleBot("b_group_3")
    })
    expect(readLatest()).not.toContain("b_group_3")
    expect(readLatestHumans()).toEqual(["u_owner"])
    expect(readLatestTargets()[0].uids).not.toContain("b_group_3")
  })

  it("applies Bot precedence across selected groups and removes a cancelled Bot from every target", async () => {
    hoisted.subscribers.set("g_1", [{ uid: "shared", name: "Stale human", orgData: { robot: 0 } }])
    hoisted.subscribers.set("g_2", [
      { uid: "shared", name: "Authoritative Bot", orgData: { robot: 1 } },
    ])

    await render({
      selectedIDs: ["g_1", "g_2"],
      selectedChannels: [new Channel("g_1", 2), new Channel("g_2", 2)],
      spaceId: "s_1",
      enabled: true,
    })

    expect(latest?.peopleCount).toBe(0)
    expect(readLatestHumans()).toEqual([])
    expect(readLatest()).toEqual(["shared"])
    expect(readLatestTargets()).toEqual([
      { channelID: "g_1", channelType: 2, uids: ["shared"] },
      { channelID: "g_2", channelType: 2, uids: ["shared"] },
    ])

    act(() => {
      latest?.toggleBot("shared")
    })

    expect(readLatestHumans()).toEqual([])
    expect(readLatest()).toEqual([])
    expect(readLatestTargets()).toEqual([
      { channelID: "g_1", channelType: 2, uids: [] },
      { channelID: "g_2", channelType: 2, uids: [] },
    ])
  })

  it("uses the Space roster as a fallback Bot signal and fails closed for unknown members", async () => {
    hoisted.subscribers.set("g_1", [
      { uid: "b_roster", name: "Roster Bot" },
      { uid: "u_unknown", name: "Unknown" },
    ])
    hoisted.listBots.mockResolvedValue([
      { uid: "b_roster", name: "Roster Bot", creator_uid: "u_someone" },
    ])
    hoisted.channelInfos.set("u_unknown", {
      channel: { channelID: "u_unknown", channelType: 1 },
      title: "Unknown",
      orgData: {},
    })

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

  it("resolves an unknown group subscriber through person-channel identity metadata", async () => {
    hoisted.subscribers.set("g_1", [{ uid: "u_resolved", name: "Resolved person" }])
    hoisted.channelInfos.set("u_resolved", {
      channel: { channelID: "u_resolved", channelType: 1 },
      title: "Resolved person",
      orgData: { robot: 0 },
    })

    await render({
      selectedIDs: ["g_1"],
      selectedChannels: [new Channel("g_1", 2)],
      spaceId: "s_1",
      enabled: true,
    })

    expect(latest?.ready).toBe(true)
    expect(readLatestHumans()).toEqual(["u_resolved"])
    expect(readLatestTargets()).toEqual([
      { channelID: "g_1", channelType: 2, uids: ["u_resolved"] },
    ])
  })

  it("waits for an in-flight identity fetch before retrying an unknown group member", async () => {
    hoisted.subscribers.set("g_1", [{ uid: "u_pending", name: "Pending person" }])
    hoisted.channelInfos.set("u_pending", {
      channel: { channelID: "u_pending", channelType: 1 },
      title: "Pending person",
      orgData: {},
    })
    let releasePending: () => void = () => {}
    hoisted.pendingChannelInfoFetches.set(
      "u_pending",
      new Promise<void>((resolve) => {
        releasePending = () => {
          hoisted.channelInfos.set("u_pending", {
            channel: { channelID: "u_pending", channelType: 1 },
            title: "Pending person",
            orgData: { robot: 0 },
          })
          resolve()
        }
      })
    )

    renderSync({
      selectedIDs: ["g_1"],
      selectedChannels: [new Channel("g_1", 2)],
      spaceId: "s_1",
      enabled: true,
    })
    expect(latest?.ready).toBe(false)

    await act(async () => {
      releasePending()
      await flush()
    })

    expect(latest?.ready).toBe(true)
    expect(readLatestHumans()).toEqual(["u_pending"])
    expect(hoisted.fetchCurrentImChannelInfo).not.toHaveBeenCalled()
  })

  it("uses a selected group's Bot signal when the same direct target identity is unknown", async () => {
    hoisted.channelInfos.set("shared", {
      channel: { channelID: "shared", channelType: 1 },
      title: "Shared Bot",
      orgData: {},
    })
    hoisted.subscribers.set("g_1", [
      { uid: "shared", name: "Shared Bot", orgData: { robot: 1 } },
    ])

    await render({
      selectedIDs: ["shared", "g_1"],
      selectedChannels: [new Channel("shared", 1), new Channel("g_1", 2)],
      spaceId: "s_1",
      enabled: true,
    })

    expect(latest?.ready).toBe(true)
    expect(readLatestHumans()).toEqual([])
    expect(readLatestTargets()).toEqual([
      { channelID: "shared", channelType: 1, uids: ["shared"] },
      { channelID: "g_1", channelType: 2, uids: ["shared"] },
    ])
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
    let release: (
      v: Array<{ uid?: string; name?: string; creator_uid?: string }>
    ) => void = () => {}
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
    let releaseSlow: (
      v: Array<{ uid?: string; name?: string; creator_uid?: string }>
    ) => void = () => {}
    hoisted.listBots.mockReturnValueOnce(new Promise((r) => (releaseSlow = r)))
    renderSync({
      selectedIDs: ["u_ada"],
      selectedChannels: [new Channel("u_ada", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    hoisted.listBots.mockResolvedValueOnce([
      { uid: "b_grace", name: "Grace Bot", creator_uid: "u_grace" },
    ])
    await act(async () => {
      ReactDOM.render(
        <Probe
          selectedIDs={["u_grace"]}
          selectedChannels={[new Channel("u_grace", 1)]}
          spaceId="s_1"
          enabled={true}
          onValue={(v) => (latest = v)}
        />,
        container
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
    let release: (
      v: Array<{ uid?: string; name?: string; creator_uid?: string }>
    ) => void = () => {}
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

    let release: (
      v: Array<{ uid?: string; name?: string; creator_uid?: string }>
    ) => void = () => {}
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
    act(() => {
      latest?.toggleBot("b_2")
    })
    // A confirm right after cancelling reads the reduced set (no passive-effect flush required).
    expect(readLatest()).toEqual(["b_1"])
    act(() => {
      latest?.toggleBot("b_2")
    })
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
    act(() => {
      latest?.toggleBot("b_2")
    })
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
    act(() => {
      latest?.toggleBot("b_shared")
    })

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
    let releaseSlow: (
      v: Array<{ uid?: string; name?: string; creator_uid?: string }>
    ) => void = () => {}
    hoisted.listBots.mockReturnValueOnce(new Promise((r) => (releaseSlow = r)))
    renderSync({
      selectedIDs: ["u_ada"],
      selectedChannels: [new Channel("u_ada", 1)],
      spaceId: "s_1",
      enabled: true,
    })
    hoisted.listBots.mockResolvedValueOnce([
      { uid: "b_grace", name: "Grace Bot", creator_uid: "u_grace" },
    ])
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
