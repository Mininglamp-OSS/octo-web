// @vitest-environment jsdom
/**
 * useForwardCandidates 直接单测：聚焦上层 useForwardModal.test.tsx 未覆盖的两条路径 ——
 *   1. loadGen 竞态守卫：老 load() 的 groupSaveList / searchFriends 晚 resolve 不得覆盖新 load() 的结果。
 *   2. requestChannelInfoIfNeeded 去重：同一 channelID 只 fetchChannelInfo 一次；已缓存时不打接口。
 *
 * 其余行为（Space 切换清 extraGroups、orphan thread 归位、conversation-list-refreshed 重载、
 * hasThreads O(N·M) 修复的功能等价）已在 useForwardModal.test.tsx 中通过组合层覆盖。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"

const CT_GROUP = 2
const CT_PERSON = 1
const CT_COMMUNITY_TOPIC = 5

const hoisted = vi.hoisted(() => ({
  conversations: [] as any[],
  getChannelInfo: vi.fn(() => undefined),
  fetchChannelInfo: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  groupSaveList: vi.fn(async () => [] as any[]),
  searchFriends: vi.fn(async () => [] as any[]),
  mittOn: vi.fn(),
  mittOff: vi.fn(),
  currentSpaceId: "" as string,
  channelSpaceMap: new Map<string, string>(),
  shouldSkip: vi.fn((_channel: any) => false),
  channelListeners: [] as Array<(info: any) => void>,
}))

vi.mock("../../../../Service/Model", () => ({
  ConversationWrap: class {
    conversation: any
    constructor(conversation: any) {
      this.conversation = conversation
    }
    get channel() {
      return this.conversation.channel
    }
    get channelInfo() {
      return this.conversation.channelInfo
    }
    get timestamp() {
      return this.conversation.timestamp ?? 0
    }
  },
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
  const sdk = {
    conversationManager: {
      get conversations() {
        return hoisted.conversations
      },
    },
    channelManager: {
      getChannelInfo: hoisted.getChannelInfo,
      addListener: (fn: any) => {
        hoisted.addListener(fn)
        hoisted.channelListeners.push(fn)
      },
      removeListener: hoisted.removeListener,
      fetchChannelInfo: hoisted.fetchChannelInfo,
    },
  }
  return {
    __esModule: true,
    default: { shared: () => sdk },
    WKSDK: { shared: () => sdk },
    Channel,
    ChannelInfo: class {},
    ChannelTypeGroup: 2,
    ChannelTypePerson: 1,
  }
})

vi.mock("../../../../Service/SpaceService", () => ({
  shouldSkipChannelForSpace: (channel: any) => hoisted.shouldSkip(channel),
  shouldSkipPersonConversationForSpace: () => false,
}))

vi.mock("../../../../Utils/rateLimit", () => ({
  debounce: (fn: any) => {
    const wrapped = (...args: any[]) => fn(...args)
    wrapped.cancel = () => {}
    return wrapped
  },
}))

vi.mock("../../../../App", () => ({
  default: {
    get shared() {
      return {
        get currentSpaceId() {
          return hoisted.currentSpaceId
        },
        channelSpaceMap: hoisted.channelSpaceMap,
      }
    },
    dataSource: {
      channelDataSource: { groupSaveList: hoisted.groupSaveList },
      commonDataSource: { searchFriends: hoisted.searchFriends },
    },
    mittBus: { on: hoisted.mittOn, off: hoisted.mittOff },
  },
}))

import { useForwardCandidates } from "../useForwardCandidates"

function Probe({
  onValue,
}: {
  onValue: (value: ReturnType<typeof useForwardCandidates>) => void
}) {
  const value = useForwardCandidates()
  onValue(value)
  return null
}

async function flushMicrotasks() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function resetHoisted() {
  vi.clearAllMocks()
  hoisted.conversations = []
  hoisted.getChannelInfo.mockReturnValue(undefined)
  hoisted.groupSaveList.mockResolvedValue([])
  hoisted.searchFriends.mockResolvedValue([])
  hoisted.shouldSkip.mockImplementation(() => false)
  hoisted.currentSpaceId = ""
  hoisted.channelSpaceMap = new Map()
  hoisted.channelListeners = []
}

async function renderCandidates() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  let latest: ReturnType<typeof useForwardCandidates> | undefined
  await act(async () => {
    ReactDOM.render(<Probe onValue={(v) => (latest = v)} />, container)
    await flushMicrotasks()
  })
  return {
    get current() {
      return latest!
    },
    unmount() {
      act(() => {
        ReactDOM.unmountComponentAtNode(container)
      })
      container.remove()
    },
  }
}

describe("useForwardCandidates — loadGen concurrency guard", () => {
  beforeEach(() => {
    resetHoisted()
  })

  it("drops results from a stale load() when a new load() supersedes it (extraGroups + friends)", async () => {
    // 第一次 load()：groupSaveList 挂起，load 卡在这里不会走到 searchFriends。
    // 这里只需要一个能"永不 resolve"的 groupSaveList 就能让老 load 的 gen 一直 pending。
    let resolveOldGroups: (v: any) => void = () => {}
    hoisted.groupSaveList.mockReturnValueOnce(
      new Promise((res) => { resolveOldGroups = res }) as any,
    )

    const view = await renderCandidates()

    // 第二次 load()：另一个 refresh 触发。用非挂起数据快速完成。
    hoisted.groupSaveList.mockResolvedValueOnce([
      {
        channel: { channelID: "g-new", channelType: CT_GROUP },
        orgData: { displayName: "New Group" },
      },
    ] as any)
    hoisted.searchFriends.mockResolvedValueOnce([
      { channel: { channelID: "d-new", channelType: CT_PERSON }, orgData: { displayName: "Bob" } },
    ] as any)

    // 用 mittBus 记录的 refresh handler 触发第二次 load()。
    const refreshHandler = hoisted.mittOn.mock.calls.find(
      (c) => c[0] === "conversation-list-refreshed",
    )?.[1] as undefined | (() => void)
    expect(refreshHandler).toBeDefined()

    await act(async () => {
      refreshHandler!()
      await flushMicrotasks()
    })

    // 新 load() 的结果生效。
    expect(view.current.conversationItems.map((i) => i.channelID)).toContain("g-new")
    expect(view.current.friendItems.map((i) => i.channelID)).toContain("d-new")

    // 老 load() 姗姗来迟：loadGen 守卫必须让它无声消化，不得把 g-old 拼进 state。
    await act(async () => {
      resolveOldGroups([
        {
          channel: { channelID: "g-old", channelType: CT_GROUP },
          orgData: { displayName: "Old Group" },
        },
      ])
      await flushMicrotasks()
    })

    const convIds = view.current.conversationItems.map((i) => i.channelID)
    expect(convIds).not.toContain("g-old")
    // 新数据仍在。
    expect(convIds).toContain("g-new")
    expect(view.current.friendItems.map((i) => i.channelID)).toContain("d-new")

    view.unmount()
  })
})

describe("useForwardCandidates — requestChannelInfoIfNeeded dedupe", () => {
  beforeEach(() => {
    resetHoisted()
  })

  it("calls fetchChannelInfo exactly once for the same channelID even when the visibility trigger fires repeatedly", async () => {
    // getChannelInfo 恒返回 undefined → 每次都会走 fetch 分支（除非被 fetchedRef 去重拦住）。
    hoisted.conversations = [
      {
        channel: { channelID: "g1", channelType: CT_GROUP },
        channelInfo: { orgData: { displayName: "G1" }, top: false },
        timestamp: 100,
      },
    ]

    const view = await renderCandidates()

    const item = view.current.conversationItems.find((i) => i.channelID === "g1")!
    expect(item).toBeTruthy()

    act(() => {
      view.current.requestChannelInfoIfNeeded(item)
      view.current.requestChannelInfoIfNeeded(item)
      view.current.requestChannelInfoIfNeeded(item)
    })
    await act(async () => {
      await flushMicrotasks()
    })

    expect(hoisted.fetchChannelInfo).toHaveBeenCalledTimes(1)

    view.unmount()
  })

  it("does NOT call fetchChannelInfo when the local channelInfo cache already exists", async () => {
    // getChannelInfo 返回一个已缓存 info → 短路，不发起请求。
    hoisted.getChannelInfo.mockReturnValue({ orgData: { displayName: "cached" } } as any)
    hoisted.conversations = [
      {
        channel: { channelID: "g-cached", channelType: CT_GROUP },
        channelInfo: { orgData: { displayName: "G Cached" }, top: false },
        timestamp: 100,
      },
    ]

    const view = await renderCandidates()

    const item = view.current.conversationItems.find((i) => i.channelID === "g-cached")!
    act(() => {
      view.current.requestChannelInfoIfNeeded(item)
    })
    await act(async () => {
      await flushMicrotasks()
    })

    expect(hoisted.fetchChannelInfo).not.toHaveBeenCalled()

    view.unmount()
  })

  it("ignores requests missing a channelID (defensive guard)", async () => {
    const view = await renderCandidates()

    act(() => {
      view.current.requestChannelInfoIfNeeded({} as any)
      view.current.requestChannelInfoIfNeeded({ channelID: "" } as any)
    })
    await act(async () => {
      await flushMicrotasks()
    })

    expect(hoisted.fetchChannelInfo).not.toHaveBeenCalled()

    view.unmount()
  })
})

describe("useForwardCandidates — hasThreads O(1) via pre-aggregated parentGroupNo set", () => {
  beforeEach(() => {
    resetHoisted()
  })

  it("marks a group with a matching thread child as hasThreads=true (aggregated set hit)", async () => {
    // 父群 + 子区（parentGroupNo 指向父群），两条都是本地会话。
    hoisted.conversations = [
      {
        channel: { channelID: "g-parent", channelType: CT_GROUP },
        channelInfo: { orgData: { displayName: "Parent" }, top: false },
        timestamp: 100,
      },
      {
        channel: { channelID: "t-child", channelType: CT_COMMUNITY_TOPIC },
        channelInfo: {
          orgData: { displayName: "Child", parentGroupNo: "g-parent" },
          top: false,
        },
        timestamp: 90,
      },
    ]
    // getCurrentImChannelInfo 需要返回子区的 orgData 以便 parentGroupNo 被收集。
    hoisted.getChannelInfo.mockImplementation((ch: any) => {
      if (ch.channelID === "t-child") {
        return { orgData: { parentGroupNo: "g-parent" } }
      }
      return undefined
    })

    const view = await renderCandidates()
    const parent = view.current.conversationItems.find((i) => i.channelID === "g-parent")
    expect(parent?.hasThreads).toBe(true)

    view.unmount()
  })

  it("marks a group without any thread children as hasThreads=false", async () => {
    hoisted.conversations = [
      {
        channel: { channelID: "g-lonely", channelType: CT_GROUP },
        channelInfo: { orgData: { displayName: "Lonely" }, top: false },
        timestamp: 100,
      },
    ]

    const view = await renderCandidates()
    const lonely = view.current.conversationItems.find((i) => i.channelID === "g-lonely")
    expect(lonely?.hasThreads).toBe(false)

    view.unmount()
  })
})
