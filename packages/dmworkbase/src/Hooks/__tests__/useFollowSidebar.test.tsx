import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const hoisted = vi.hoisted(() => {
    const state = {
        listener: undefined as undefined | ((conversation: any, action: any) => void),
        threadCreatedListener: undefined as undefined | ((event: any) => void),
        threadDeletedListener: undefined as undefined | ((event: any) => void),
        sidebarReloadListener: undefined as undefined | ((event: any) => void),
    }
    const sync = vi.fn()
    const addConversationListener = vi.fn((listener: (conversation: any, action: any) => void) => {
        state.listener = listener
    })
    const removeConversationListener = vi.fn((listener: (conversation: any, action: any) => void) => {
        if (state.listener === listener) {
            state.listener = undefined
        }
    })
    const ConversationAction = {
        add: 1,
        update: 2,
        remove: 3,
    }
    return {
        state,
        sync,
        addConversationListener,
        removeConversationListener,
        ConversationAction,
        fakeWKApp: {
            shared: {
                currentSpaceId: "space-1",
                deviceId: "device-1",
            },
            mittBus: {
                on: vi.fn((event: string, listener: (event: any) => void) => {
                    if (event === "wk:thread-created") {
                        state.threadCreatedListener = listener
                    } else if (event === "wk:thread-deleted") {
                        state.threadDeletedListener = listener
                    } else if (event === "sidebar-reload") {
                        state.sidebarReloadListener = listener
                    }
                }),
                off: vi.fn((event: string, listener: (event: any) => void) => {
                    if (event === "wk:thread-created" && state.threadCreatedListener === listener) {
                        state.threadCreatedListener = undefined
                    } else if (event === "wk:thread-deleted" && state.threadDeletedListener === listener) {
                        state.threadDeletedListener = undefined
                    } else if (event === "sidebar-reload" && state.sidebarReloadListener === listener) {
                        state.sidebarReloadListener = undefined
                    }
                }),
            },
        },
    }
})

vi.mock("wukongimjssdk", () => ({
    default: {
        shared: () => ({
            conversationManager: {
                addConversationListener: hoisted.addConversationListener,
                removeConversationListener: hoisted.removeConversationListener,
            },
        }),
    },
    ConversationAction: hoisted.ConversationAction,
    __esModule: true,
}))

vi.mock("../../App", () => ({ default: hoisted.fakeWKApp }))
vi.mock("../../i18n", () => ({ t: (key: string) => key }))
vi.mock("../../Service/SidebarService", () => ({
    default: {
        sync: hoisted.sync,
    },
}))

import { ConversationAction } from "wukongimjssdk"
import { useFollowSidebar } from "../useFollowSidebar"

const groupItem = {
    target_type: 2,
    target_id: "group-a",
    channel_type: 2,
    channel_id: "group-a",
    timestamp: 10,
    unread: 0,
    is_pinned: false,
    is_followed: true,
    category_id: "cat-a",
    follow_sort: 1,
}

const threadItem = {
    target_type: 5,
    target_id: "group-a____thread-1",
    channel_type: 5,
    channel_id: "group-a____thread-1",
    timestamp: 11,
    unread: 1,
    is_pinned: false,
    is_followed: true,
    category_id: "cat-a",
    follow_sort: 2,
    parent_channel_id: "group-a",
}

function Probe({ onValue }: { onValue: (value: ReturnType<typeof useFollowSidebar>) => void }) {
    const value = useFollowSidebar()
    onValue(value)
    return null
}

async function flushMicrotasks() {
    await Promise.resolve()
    await Promise.resolve()
}

describe("useFollowSidebar", () => {
    let container: HTMLDivElement

    beforeEach(() => {
        vi.useFakeTimers()
        hoisted.state.listener = undefined
        hoisted.state.threadCreatedListener = undefined
        hoisted.state.threadDeletedListener = undefined
        hoisted.state.sidebarReloadListener = undefined
        hoisted.sync.mockReset()
        hoisted.addConversationListener.mockClear()
        hoisted.removeConversationListener.mockClear()
        hoisted.fakeWKApp.mittBus.on.mockClear()
        hoisted.fakeWKApp.mittBus.off.mockClear()
        container = document.createElement("div")
        document.body.appendChild(container)
    })

    afterEach(() => {
        act(() => {
            ReactDOM.unmountComponentAtNode(container)
        })
        container.remove()
        vi.useRealTimers()
    })

    it("refreshes the followed sidebar when a new thread conversation arrives under a followed group", async () => {
        let latest: ReturnType<typeof useFollowSidebar> | undefined
        hoisted.sync
            .mockResolvedValueOnce({ items: [groupItem], follow_version: 1, version: 1 })
            .mockResolvedValueOnce({ items: [groupItem, threadItem], follow_version: 2, version: 2 })

        await act(async () => {
            ReactDOM.render(<Probe onValue={(value) => { latest = value }} />, container)
            await flushMicrotasks()
        })

        expect(hoisted.sync).toHaveBeenCalledTimes(1)
        expect(latest?.followedGroupNos.has("group-a")).toBe(true)
        expect(latest?.followedKeys.has("5::group-a____thread-1")).toBe(false)
        expect(hoisted.addConversationListener).toHaveBeenCalledTimes(1)

        act(() => {
            hoisted.state.listener?.({
                channel: {
                    channelID: "group-a____thread-1",
                    channelType: 5,
                },
            }, ConversationAction.add)
        })

        expect(hoisted.sync).toHaveBeenCalledTimes(1)

        await act(async () => {
            vi.advanceTimersByTime(300)
            await flushMicrotasks()
        })

        expect(hoisted.sync).toHaveBeenCalledTimes(2)
        expect(latest?.followedKeys.has("5::group-a____thread-1")).toBe(true)
        expect(latest?.itemsByCategory.get("cat-a")?.map((it) => it.target_id))
            .toEqual(["group-a", "group-a____thread-1"])
    })

    it("refreshes the followed sidebar when a thread is created under a followed group", async () => {
        let latest: ReturnType<typeof useFollowSidebar> | undefined
        hoisted.sync
            .mockResolvedValueOnce({ items: [groupItem], follow_version: 1, version: 1 })
            .mockResolvedValueOnce({ items: [groupItem, threadItem], follow_version: 2, version: 2 })

        await act(async () => {
            ReactDOM.render(<Probe onValue={(value) => { latest = value }} />, container)
            await flushMicrotasks()
        })

        expect(hoisted.fakeWKApp.mittBus.on).toHaveBeenCalledWith(
            "wk:thread-created",
            expect.any(Function)
        )
        expect(latest?.followedGroupNos.has("group-a")).toBe(true)

        act(() => {
            hoisted.state.threadCreatedListener?.({
                groupNo: "group-a",
                threadChannelId: "group-a____thread-1",
                shortId: "thread-1",
            })
        })

        expect(hoisted.sync).toHaveBeenCalledTimes(1)

        await act(async () => {
            vi.advanceTimersByTime(300)
            await flushMicrotasks()
        })

        expect(hoisted.sync).toHaveBeenCalledTimes(2)
        expect(latest?.followedKeys.has("5::group-a____thread-1")).toBe(true)
    })

    it("refreshes the followed sidebar snapshot silently on sidebar-reload (unread badge sync, #203)", async () => {
        let latest: ReturnType<typeof useFollowSidebar> | undefined
        const groupItemUnread = { ...groupItem, unread: 1 }
        const groupItemRead = { ...groupItem, unread: 0 }
        hoisted.sync
            .mockResolvedValueOnce({ items: [groupItemUnread], follow_version: 1, version: 1 })
            .mockResolvedValueOnce({ items: [groupItemRead], follow_version: 2, version: 2 })

        await act(async () => {
            ReactDOM.render(<Probe onValue={(value) => { latest = value }} />, container)
            await flushMicrotasks()
        })

        // 初次加载后拿到的是带未读的快照
        expect(hoisted.sync).toHaveBeenCalledTimes(1)
        expect(latest?.items.find((it) => it.target_id === "group-a")?.unread).toBe(1)
        expect(hoisted.fakeWKApp.mittBus.on).toHaveBeenCalledWith(
            "sidebar-reload",
            expect.any(Function)
        )

        // 触发 sidebar-reload：应静默重新 /sidebar/sync，且不进入 loading 态（不闪烁）
        await act(async () => {
            hoisted.state.sidebarReloadListener?.(undefined)
            await flushMicrotasks()
        })

        expect(hoisted.sync).toHaveBeenCalledTimes(2)
        // reload 全程 isLoading 保持 false（silent 模式），避免关注 tab 列表 remount
        expect(latest?.isLoading).toBe(false)
        // 拿到最新已读快照，关注 tab 角标可归零
        expect(latest?.items.find((it) => it.target_id === "group-a")?.unread).toBe(0)
    })

    it("refreshes the followed sidebar when a thread is deleted", async () => {
        let latest: ReturnType<typeof useFollowSidebar> | undefined
        hoisted.sync
            .mockResolvedValueOnce({ items: [groupItem, threadItem], follow_version: 1, version: 1 })
            .mockResolvedValueOnce({ items: [groupItem], follow_version: 2, version: 2 })

        await act(async () => {
            ReactDOM.render(<Probe onValue={(value) => { latest = value }} />, container)
            await flushMicrotasks()
        })

        expect(hoisted.fakeWKApp.mittBus.on).toHaveBeenCalledWith(
            "wk:thread-deleted",
            expect.any(Function)
        )
        expect(latest?.followedKeys.has("5::group-a____thread-1")).toBe(true)

        await act(async () => {
            hoisted.state.threadDeletedListener?.({
                groupNo: "group-a",
                threadChannelId: "group-a____thread-1",
                shortId: "thread-1",
            })
            await flushMicrotasks()
        })

        expect(hoisted.sync).toHaveBeenCalledTimes(2)
        expect(latest?.followedKeys.has("5::group-a____thread-1")).toBe(false)
        expect(latest?.itemsByCategory.get("cat-a")?.map((it) => it.target_id))
            .toEqual(["group-a"])
    })
})
