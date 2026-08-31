import { beforeEach, describe, expect, it, vi } from "vitest"

const hoisted = vi.hoisted(() => ({
    emit: vi.fn(),
    pinnedList: vi.fn(() => Promise.resolve([])),
    sync: vi.fn(() => Promise.resolve([])),
    clearMessages: vi.fn(() => Promise.resolve()),
}))

vi.mock("wukongimjssdk", () => ({
    default: {
        shared: () => ({
            conversationManager: {
                conversations: [],
                addConversationListener: () => {},
                removeConversationListener: () => {},
                sync: hoisted.sync,
                notifyConversationListeners: vi.fn(),
            },
            connectManager: {
                status: 0,
                addConnectStatusListener: () => {},
                removeConnectStatusListener: () => {},
            },
            channelManager: {
                getChannelInfo: () => undefined,
                fetchChannelInfo: () => {},
                addListener: () => {},
                removeListener: () => {},
            },
        }),
    },
    Channel: class {
        channelID: string
        channelType: number

        constructor(channelID: string, channelType: number) {
            this.channelID = channelID
            this.channelType = channelType
        }

        isEqual(other: any) {
            return this.channelID === other.channelID && this.channelType === other.channelType
        }

        getChannelKey() {
            return `${this.channelID}-${this.channelType}`
        }
    },
    ChannelTypeGroup: 2,
    ChannelTypePerson: 1,
    Conversation: class {},
    ConversationAction: {},
    ConnectStatus: { Connected: 1, Disconnect: 0 },
    Message: class {},
    MessageContent: class {},
    MessageContentType: { text: 1 },
}))

vi.mock("react-scroll", () => ({
    animateScroll: { scrollTo: () => {} },
    scroller: {},
}))

vi.mock("../../../App", () => ({
    default: {
        loginInfo: { uid: "me" },
        shared: {
            currentSpaceId: "",
            channelSpaceMap: new Map(),
            channelMySourceSpaceMap: new Map(),
            openChannel: undefined,
            addMessageDeleteListener: () => {},
            removeMessageDeleteListener: () => {},
            notifyListener: () => {},
        },
        config: { appName: "Octo" },
        mittBus: { emit: hoisted.emit, on: () => {}, off: () => {} },
        menus: { refresh: () => {} },
        routeRight: { popToRoot: () => {} },
        endpointManager: { invoke: () => {} },
        conversationProvider: { clearConversationMessages: hoisted.clearMessages },
        apiClient: { get: () => Promise.resolve({}) },
        endpoints: { showConversation: () => {} },
    },
}))

vi.mock("../../../Service/Model", () => ({
    ConversationWrap: class {
        conversation: any

        constructor(conversation: any) {
            this.conversation = conversation
        }

        get channel() {
            return this.conversation.channel
        }

        get timestamp() {
            return this.conversation.timestamp
        }

        get extra() {
            if (!this.conversation.extra) this.conversation.extra = {}
            return this.conversation.extra
        }
    },
}))

vi.mock("../../../Service/ProhibitwordsService", () => ({
    ProhibitwordsService: { shared: { filter: (text: string) => text } },
}))

vi.mock("../../../Service/PinnedService", () => ({
    default: { list: hoisted.pinnedList },
}))

vi.mock("../../../Service/SpaceService", () => ({
    SpaceService: { shared: { getMembers: () => Promise.resolve([]) } },
    shouldSkipChannelForSpace: () => false,
    shouldSkipPersonConversationForSpace: () => false,
    hasSpacePrefix: () => false,
}))

vi.mock("../../../Service/Thread", () => ({
    parseThreadChannelId: () => undefined,
}))

vi.mock("../../../EndpointCommon", () => ({
    ShowConversationOptions: class {},
}))

vi.mock("../../../Utils/security", () => ({
    isSafeUrl: () => true,
}))

vi.mock("../../../Utils/download", () => ({
    downloadFile: () => Promise.resolve(),
}))

import { applyPinnedThreadSnapshot, ChatVM } from "../vm"
import { ConversationWrap } from "../../../Service/Model"
import WKApp from "../../../App"
import { Channel } from "wukongimjssdk"

beforeEach(() => {
    vi.clearAllMocks()
    hoisted.sync.mockResolvedValue([])
    hoisted.pinnedList.mockResolvedValue([])
    ;(WKApp.shared as any).currentSpaceId = ""
})

function makeConversation(id: string, timestamp: number, top = 0): ConversationWrap {
    return new ConversationWrap({
        channel: {
            channelID: id,
            channelType: 1,
            isEqual: (other: any) => other?.channelID === id && other?.channelType === 1,
            getChannelKey: () => `${id}-1`,
        },
        timestamp,
        extra: { top },
    } as any)
}

function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise
    })
    return { promise, resolve }
}

describe("ChatVM.sortConversations", () => {
    it("applies pinned state only to community topic conversations", () => {
        const group = { channel: { channelID: "g", channelType: 2 }, extra: undefined } as any
        const pinned = { channel: { channelID: "thread-1", channelType: 5 }, extra: {} } as any
        applyPinnedThreadSnapshot([group, pinned], [{ channel_id: "thread-1", channel_type: 5 } as any])
        expect(group.extra).toBeUndefined()
        expect(pinned.extra.top).toBe(1)

        const other = { channel: { channelID: "thread-2", channelType: 5 }, extra: {} } as any
        applyPinnedThreadSnapshot([other], [{ channel_id: "thread-1", channel_type: 5 } as any])
        expect(other.extra.top).toBe(0)
        applyPinnedThreadSnapshot([other], undefined)
        expect(other.extra.top).toBe(0)
    })
    it("replaces vm.conversations with a newly sorted array so memoized recent lists recalculate", () => {
        const vm = new ChatVM()
        const oldArray = [
            makeConversation("old", 100),
            makeConversation("new", 300),
            makeConversation("middle", 200),
        ]
        vm.conversations = oldArray

        const sorted = vm.sortConversations()

        expect(sorted.map((c) => c.channel.channelID)).toEqual(["new", "middle", "old"])
        expect(vm.conversations).toBe(sorted)
        expect(vm.conversations).not.toBe(oldArray)
    })

    it("keeps pinned conversations ahead of newer unpinned conversations", () => {
        const vm = new ChatVM()
        vm.conversations = [
            makeConversation("new-unpinned", 300),
            makeConversation("old-pinned", 100, 1),
        ]

        expect(vm.sortConversations().map((c) => c.channel.channelID)).toEqual([
            "old-pinned",
            "new-unpinned",
        ])
    })

    it("updates connection state and removes matching conversations", () => {
        const vm = new ChatVM()
        const notify = vi.spyOn(vm, "notifyListener")
        vm.conversations = [makeConversation("keep", 1), makeConversation("remove", 2)]
        vm.setConnectTitleWithConnectStatus(1 as any)
        expect(vm.connectStatus).toBe(1)
        vm.setConnectTitleWithConnectStatus(0 as any)
        expect(vm.connectStatus).toBe(0)
        vm.setConnectTitleWithConnectStatus(2 as any)
        expect(vm.connectStatus).toBe(2)
        vm.removeConversation(new Channel("remove", 1) as any)
        expect(vm.conversations.map((item) => item.channel.channelID)).toEqual(["keep"])
        expect(notify).toHaveBeenCalled()
        vm.removeConversation(new Channel("missing", 1) as any)
    })

    it("clears an existing conversation and leaves a missing one untouched", async () => {
        const vm = new ChatVM()
        const conversation: any = {
            channel: new Channel("clear", 1), timestamp: 10,
            lastMessage: { messageID: "last" }, unread: 3, extra: { spaceUnread: 2 },
        }
        vm.conversations = [new ConversationWrap(conversation)]
        ;(WKApp.shared as any).currentSpaceId = "space"
        await vm.clearMessages(conversation.channel)
        expect(conversation.lastMessage).toBeUndefined()
        expect(conversation.unread).toBe(0)
        expect(conversation.extra.spaceUnread).toBe(0)
        expect(hoisted.clearMessages).toHaveBeenCalledWith(conversation)
        await vm.clearMessages(new Channel("missing", 1) as any)
    })
})

describe("ChatVM.reloadRequestConversationList", () => {
    it("announces initial conversation hydration so unread title consumers recalculate", async () => {
        const vm = new ChatVM()
        hoisted.emit.mockClear()
        hoisted.sync.mockResolvedValueOnce([])

        expect(vm.loading).toBe(true)
        await vm.reloadRequestConversationList()

        expect(vm.loading).toBe(false)
        expect(hoisted.emit).toHaveBeenCalledWith("conversation-list-refreshed")
    })

    it("leaves the initial loading state when conversation hydration fails", async () => {
        const vm = new ChatVM()
        const notifyListener = vi.spyOn(vm, "notifyListener")
        const error = new Error("sync failed")
        hoisted.sync.mockRejectedValueOnce(error)

        await expect(vm.reloadRequestConversationList()).rejects.toBe(error)

        expect(vm.loading).toBe(false)
        expect(notifyListener).toHaveBeenCalled()
    })

    it("does not let a stale Space sync overwrite the active Space", async () => {
        const vm = new ChatVM()
        const spaceASync = deferred<any[]>()
        const spaceAPins = deferred<any[]>()
        const spaceAConversation = makeConversation("space-a", 100)
        const spaceBConversation = makeConversation("space-b", 200)
        ;(WKApp.shared as any).currentSpaceId = "space-a"
        hoisted.sync
            .mockReturnValueOnce(spaceASync.promise)
            .mockResolvedValueOnce([spaceBConversation.conversation])
        hoisted.pinnedList
            .mockReturnValueOnce(spaceAPins.promise)
            .mockResolvedValueOnce([])

        const spaceARequest = vm.reloadRequestConversationList()
        let spaceARequestSettled = false
        void spaceARequest.then(() => {
            spaceARequestSettled = true
        })
        ;(WKApp.shared as any).currentSpaceId = "space-b"
        await vm.reloadRequestConversationList()

        expect(vm.conversations.map((item) => item.channel.channelID)).toEqual(["space-b"])

        spaceASync.resolve([spaceAConversation.conversation])
        await Promise.resolve()
        await Promise.resolve()

        expect(spaceARequestSettled).toBe(true)
        expect(vm.conversations.map((item) => item.channel.channelID)).toEqual(["space-b"])
    })

    it("does not let a stale Space pinned snapshot overwrite the active Space", async () => {
        const vm = new ChatVM()
        const spaceAPins = deferred<any[]>()
        const spaceAConversation = makeConversation("space-a", 100)
        const spaceBConversation = makeConversation("space-b", 200)
        ;(WKApp.shared as any).currentSpaceId = "space-a"
        hoisted.sync
            .mockResolvedValueOnce([spaceAConversation.conversation])
            .mockResolvedValueOnce([spaceBConversation.conversation])
        hoisted.pinnedList
            .mockReturnValueOnce(spaceAPins.promise)
            .mockResolvedValueOnce([])

        const spaceARequest = vm.reloadRequestConversationList()
        await Promise.resolve()
        ;(WKApp.shared as any).currentSpaceId = "space-b"
        await vm.reloadRequestConversationList()

        expect(vm.conversations.map((item) => item.channel.channelID)).toEqual(["space-b"])

        spaceAPins.resolve([])
        await spaceARequest

        expect(vm.conversations.map((item) => item.channel.channelID)).toEqual(["space-b"])
    })
})

describe("ChatVM.requestConversationList", () => {
    it("leaves loading and handles an active Space sync failure", async () => {
        const vm = new ChatVM()
        const notifyListener = vi.spyOn(vm, "notifyListener")
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
        hoisted.sync.mockRejectedValueOnce(new Error("sync failed"))

        await vm.requestConversationList()

        expect(vm.loading).toBe(false)
        expect(notifyListener).toHaveBeenCalled()
        expect(consoleError).toHaveBeenCalledWith(
            "[ChatVM] failed to sync conversations",
            expect.any(Error)
        )
        consoleError.mockRestore()
    })

    it("restores persisted child-thread pin state before sorting the recent list", async () => {
        const vm = new ChatVM()
        const thread = {
            channel: {
                channelID: "group-1____thread-1",
                channelType: 5,
                getChannelKey: () => "group-1____thread-1-5",
            },
            timestamp: 100,
            extra: { top: 0 },
        }
        const newer = {
            channel: {
                channelID: "alice",
                channelType: 1,
                getChannelKey: () => "alice-1",
            },
            timestamp: 300,
            extra: { top: 0 },
        }
        ;(WKApp.shared as any).currentSpaceId = "space-1"
        hoisted.sync.mockResolvedValueOnce([newer, thread] as any)
        hoisted.pinnedList.mockResolvedValueOnce([
            {
                channel_id: "group-1____thread-1",
                channel_type: 5,
                sort_order: 1,
            },
        ])

        await vm.requestConversationList()

        expect(hoisted.pinnedList).toHaveBeenCalledTimes(1)
        expect(thread.extra.top).toBe(1)
        expect(vm.conversations.map((item) => item.channel.channelID)).toEqual([
            "group-1____thread-1",
            "alice",
        ])
    })

    it("clears stale child-thread pin state when the persisted snapshot is empty", async () => {
        const vm = new ChatVM()
        const thread = {
            channel: {
                channelID: "group-1____thread-1",
                channelType: 5,
                getChannelKey: () => "group-1____thread-1-5",
            },
            timestamp: 100,
            extra: { top: 1 },
        }
        ;(WKApp.shared as any).currentSpaceId = "space-1"
        hoisted.sync.mockResolvedValueOnce([thread] as any)
        hoisted.pinnedList.mockResolvedValueOnce([])

        await vm.requestConversationList()

        expect(thread.extra.top).toBe(0)
    })
})

describe("ChatVM state and collection helpers", () => {
    it("updates view state through setters and finds/removes conversations", () => {
        const vm = new ChatVM()
        const notify = vi.spyOn(vm, "notifyListener")
        const selected = makeConversation("selected", 10)
        vm.conversations = [selected]
        vm.showAddPopover = true
        vm.showGlobalSearch = true
        vm.showChannelSetting = true
        vm.showSpaceCreate = true
        vm.connectTitle = "Connected"
        vm.selectedConversation = selected
        expect(vm.showAddPopover).toBe(true)
        expect(vm.showGlobalSearch).toBe(true)
        expect(vm.showChannelSetting).toBe(true)
        expect(vm.showSpaceCreate).toBe(true)
        expect(vm.connectTitle).toBe("Connected")
        expect(vm.selectedConversation).toBe(selected)
        expect(vm.findConversation(new Channel("selected", 1))).toBe(selected)
        expect(vm.filteredConversations).toEqual([selected])
        vm.removeConversation(new Channel("selected", 1))
        expect(vm.conversations).toEqual([])
        expect(notify).toHaveBeenCalled()
    })

    it("maps connection status to title and reads/preserves list scroll position", () => {
        const vm = new ChatVM()
        vm.setConnectTitleWithConnectStatus(1 as any)
        expect(vm.connectStatus).toBe(1)
        expect(vm.connectTitle).toBe("Octo")
        vm.setConnectTitleWithConnectStatus(0 as any)
        expect(vm.connectStatus).toBe(0)
        vm.setConnectTitleWithConnectStatus(99 as any)
        expect(vm.connectStatus).toBe(2)

        expect(vm.currentConversationListY()).toBeUndefined()
        const list = document.createElement("div")
        list.id = "wk-conversationlist"
        list.scrollTop = 37
        document.body.appendChild(list)
        expect(vm.currentConversationListY()).toBe(37)
        vm.keepPosition(55)
    })

    it("clears a conversation and resets unread state", async () => {
        const vm = new ChatVM()
        const conversation: any = {
            channel: new Channel("peer", 1),
            timestamp: 10,
            unread: 4,
            lastMessage: { messageID: "last" },
            extra: { spaceUnread: 4 },
        }
        vm.conversations = [new ConversationWrap(conversation)]
        ;(WKApp.shared as any).currentSpaceId = "space-1"
        await vm.clearMessages(conversation.channel)
        expect(conversation.lastMessage).toBeUndefined()
        expect(conversation.unread).toBe(0)
        expect(conversation.extra.spaceUnread).toBe(0)
        expect((WKApp as any).conversationProvider.clearConversationMessages).toHaveBeenCalledWith(conversation)
    })
})
