import { beforeEach, describe, expect, it, vi } from "vitest"

const hoisted = vi.hoisted(() => ({
    emit: vi.fn(),
    pinnedList: vi.fn(() => Promise.resolve([])),
    sync: vi.fn(() => Promise.resolve([])),
}))

vi.mock("wukongimjssdk", () => ({
    default: {
        shared: () => ({
            conversationManager: {
                conversations: [],
                addConversationListener: () => {},
                removeConversationListener: () => {},
                sync: hoisted.sync,
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
        conversationProvider: { clearConversationMessages: () => Promise.resolve() },
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

import { ChatVM } from "../vm"
import { ConversationWrap } from "../../../Service/Model"
import WKApp from "../../../App"

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

describe("ChatVM.sortConversations", () => {
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
