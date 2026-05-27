import { describe, expect, it, vi } from "vitest"

vi.mock("wukongimjssdk", () => ({
    default: {
        shared: () => ({
            conversationManager: {
                conversations: [],
                addConversationListener: () => {},
                removeConversationListener: () => {},
                sync: () => Promise.resolve([]),
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
        mittBus: { emit: () => {}, on: () => {}, off: () => {} },
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
