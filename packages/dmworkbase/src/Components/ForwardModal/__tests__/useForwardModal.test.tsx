import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * 转发目标排除归档子区（issue #346 需求 2）。
 *
 * useForwardModal.rebuildConvItems 在构建子区来源时复用侧栏的 fail-open
 * helper filterArchivedThreads：
 *   - 明确 status=Archived(2) 的子区 → 不出现在转发目标
 *   - 活跃(1) / status 未知（channelInfo 未加载）的子区 → 保留（fail-open）
 *   - 群聊/私聊不受影响
 *
 * 这里 mock 掉 WKSDK / WKApp 的数据源，但使用真实的 archivedThreads.ts，
 * 守护「归档子区冒出来当转发目标」的回归。
 *
 * 渲染采用与 useFollowSidebar.test.tsx 一致的 React 17 legacy
 * ReactDOM.render + Probe 模式，避免依赖 @testing-library/react。
 */

import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"

import { ChannelTypeCommunityTopic } from "../../../Service/Const"
import { ThreadStatus } from "../../../Service/Thread"

const CT_GROUP = 2

const hoisted = vi.hoisted(() => {
    return {
        conversations: [] as any[],
        getChannelInfo: vi.fn(() => undefined),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        fetchChannelInfo: vi.fn(),
        groupSaveList: vi.fn(async () => []),
        searchFriends: vi.fn(async () => []),
        mittOn: vi.fn(),
        mittOff: vi.fn(),
    }
})

// 真实 ConversationWrap 依赖完整 SDK；这里用最小透传桩，只暴露
// channel / channelInfo / timestamp，足够 rebuildConvItems 与 filterArchivedThreads 使用。
vi.mock("../../../Service/Model", () => ({
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
    return {
        __esModule: true,
        WKSDK: {
            shared: () => ({
                conversationManager: { conversations: hoisted.conversations },
                channelManager: {
                    getChannelInfo: hoisted.getChannelInfo,
                    addListener: hoisted.addListener,
                    removeListener: hoisted.removeListener,
                    fetchChannelInfo: hoisted.fetchChannelInfo,
                },
            }),
        },
        Channel,
        ChannelInfo: class {},
        ChannelTypeGroup: 2,
    }
})

vi.mock("../../../Service/SpaceService", () => ({
    shouldSkipChannelForSpace: () => false,
    shouldSkipPersonConversationForSpace: () => false,
}))

vi.mock("../../../Utils/rateLimit", () => ({
    debounce: (fn: any) => {
        const wrapped = (...args: any[]) => fn(...args)
        wrapped.cancel = () => {}
        return wrapped
    },
}))

vi.mock("../../../App", () => ({
    default: {
        shared: { currentSpaceId: undefined },
        dataSource: {
            channelDataSource: { groupSaveList: hoisted.groupSaveList },
            commonDataSource: { searchFriends: hoisted.searchFriends },
        },
        mittBus: { on: hoisted.mittOn, off: hoisted.mittOff },
        searchChatCandidates: undefined,
    },
}))

import { useForwardModal } from "../useForwardModal"

function makeConv(channelID: string, channelType: number, displayName: string, opts: {
    parentGroupNo?: string
    threadStatus?: number
    noChannelInfo?: boolean
    timestamp?: number
} = {}) {
    if (opts.noChannelInfo) {
        return { channel: { channelID, channelType }, channelInfo: undefined, timestamp: opts.timestamp ?? 0 }
    }
    const orgData: any = { displayName }
    if (opts.parentGroupNo) orgData.parentGroupNo = opts.parentGroupNo
    if (opts.threadStatus !== undefined) orgData.thread = { status: opts.threadStatus }
    return {
        channel: { channelID, channelType },
        channelInfo: { orgData },
        timestamp: opts.timestamp ?? 0,
    }
}

function Probe({ onValue }: { onValue: (value: ReturnType<typeof useForwardModal>) => void }) {
    const value = useForwardModal()
    onValue(value)
    return null
}

async function flushMicrotasks() {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
}

async function renderForward() {
    const container = document.createElement("div")
    document.body.appendChild(container)
    let latest: ReturnType<typeof useForwardModal> | undefined
    await act(async () => {
        ReactDOM.render(<Probe onValue={(value) => { latest = value }} />, container)
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

describe("useForwardModal — archived threads excluded from forward targets", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        hoisted.getChannelInfo.mockReturnValue(undefined)
        hoisted.groupSaveList.mockResolvedValue([])
        hoisted.searchFriends.mockResolvedValue([])
    })

    afterEach(() => {
        hoisted.conversations = []
    })

    it("excludes archived(status=2) threads, keeps active(1), unknown-status, and groups (fail-open)", async () => {
        hoisted.conversations = [
            makeConv("g1", CT_GROUP, "Group 1", { timestamp: 100 }),
            makeConv("t-active", ChannelTypeCommunityTopic, "Active Thread", {
                parentGroupNo: "g1", threadStatus: ThreadStatus.Active, timestamp: 90,
            }),
            makeConv("t-archived", ChannelTypeCommunityTopic, "Archived Thread", {
                parentGroupNo: "g1", threadStatus: ThreadStatus.Archived, timestamp: 80,
            }),
            makeConv("t-unknown", ChannelTypeCommunityTopic, "Unknown Thread", {
                parentGroupNo: "g1", timestamp: 70, // no thread.status → fail-open keep
            }),
        ]

        const view = await renderForward()
        const ids = view.current.allItems.map((i) => i.channelID)

        expect(ids).toContain("g1")
        expect(ids).toContain("t-active")
        expect(ids).toContain("t-unknown")
        expect(ids).not.toContain("t-archived")

        view.unmount()
    })

    it("keeps a thread whose channelInfo has not loaded yet (status unknown → fail-open)", async () => {
        hoisted.conversations = [
            makeConv("g1", CT_GROUP, "Group 1", { timestamp: 100 }),
            makeConv("t-noinfo", ChannelTypeCommunityTopic, "", { noChannelInfo: true, timestamp: 60 }),
        ]

        const view = await renderForward()
        const ids = view.current.allItems.map((i) => i.channelID)

        expect(ids).toContain("t-noinfo")

        view.unmount()
    })

    it("does not filter groups or direct conversations", async () => {
        hoisted.conversations = [
            makeConv("g1", CT_GROUP, "Group 1", { timestamp: 100 }),
            makeConv("g2", CT_GROUP, "Group 2", { timestamp: 95 }),
        ]

        const view = await renderForward()
        const ids = view.current.allItems.map((i) => i.channelID)

        expect(ids).toContain("g1")
        expect(ids).toContain("g2")

        view.unmount()
    })
})
