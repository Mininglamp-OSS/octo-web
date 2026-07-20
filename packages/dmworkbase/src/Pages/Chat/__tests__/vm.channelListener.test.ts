import { describe, expect, it, vi } from "vitest"

// 捕获 ChatVM.channelListener（didMount 里通过 channelManager.addListener 注册）。
const hoisted = vi.hoisted(() => ({
    channelListener: undefined as undefined | ((channelInfo: any) => void),
    spaceChangedHandler: undefined as undefined | ((space: any) => void),
    popToRoot: vi.fn(),
}))

vi.mock("wukongimjssdk", () => ({
    default: {
        shared: () => ({
            conversationManager: {
                conversations: [],
                addConversationListener: () => {},
                removeConversationListener: () => {},
                findConversation: () => undefined,
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
                deleteChannelInfo: () => {},
                addListener: (listener: (channelInfo: any) => void) => {
                    hoisted.channelListener = listener
                },
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
        currentMenuId: "chat",
        mittBus: {
            emit: () => {},
            on: (event: string, handler: (payload: any) => void) => {
                if (event === "space-changed") hoisted.spaceChangedHandler = handler
            },
            off: () => {},
        },
        menus: { refresh: () => {} },
        routeRight: { popToRoot: hoisted.popToRoot },
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
import WKApp from "../../../App"

// 真实 Const 值：子区频道 channelType = 5
const ChannelTypeCommunityTopic = 5
const ChannelTypeGroup = 2

function mountVM(): ChatVM {
    const vm = new ChatVM()
    vm.didMount()
    return vm
}

describe("ChatVM.channelListener — CommunityTopic 子区同步 (issue #345)", () => {
    it("收到子区 channelInfo 变化时调用 notifyListener（即便子区不在 conversations）", () => {
        const vm = mountVM()
        const notifySpy = vi.spyOn(vm, "notifyListener")
        expect(hoisted.channelListener).toBeTypeOf("function")

        // 子区不在 vm.conversations（sidebar-only 关注场景）
        hoisted.channelListener!({
            channel: { channelID: "g1____t1", channelType: ChannelTypeCommunityTopic },
        })

        expect(notifySpy).toHaveBeenCalledTimes(1)
    })

    it("子区在 conversations 中时也 notifyListener（既有 top 分支）", () => {
        const vm = mountVM()
        const threadChannel = {
            channelID: "g1____t2",
            channelType: ChannelTypeCommunityTopic,
            isEqual: (other: any) =>
                other?.channelID === "g1____t2" && other?.channelType === ChannelTypeCommunityTopic,
        }
        vm.conversations = [
            {
                channel: threadChannel,
                extra: {},
            } as any,
        ]
        const notifySpy = vi.spyOn(vm, "notifyListener")

        hoisted.channelListener!({
            channel: threadChannel,
            top: 0,
        })

        expect(notifySpy).toHaveBeenCalledTimes(1)
    })

    it("非子区且不在 conversations 的群 channelInfo 不会走子区分支", () => {
        const vm = mountVM()
        const notifySpy = vi.spyOn(vm, "notifyListener")

        // 群聊且无 space_id、不在 conversations、无 pending → 不应进入子区 notify 分支
        hoisted.channelListener!({
            channel: { channelID: "g-unknown", channelType: ChannelTypeGroup },
        })

        expect(notifySpy).not.toHaveBeenCalled()
    })

    it("同一子区 status 未变化时仅首次 notifyListener（N2 收敛重渲染）", () => {
        const vm = mountVM()
        const notifySpy = vi.spyOn(vm, "notifyListener")
        const channel = { channelID: "g1____t3", channelType: ChannelTypeCommunityTopic }

        // 首次出现：notify
        hoisted.channelListener!({ channel, orgData: { thread: { status: 1 } } })
        // status 未变化（仍为 1，仅其它字段刷新）：跳过 notify
        hoisted.channelListener!({ channel, orgData: { thread: { status: 1 } } })
        expect(notifySpy).toHaveBeenCalledTimes(1)

        // status 变化（1 → 2 归档）：再次 notify
        hoisted.channelListener!({ channel, orgData: { thread: { status: 2 } } })
        expect(notifySpy).toHaveBeenCalledTimes(2)
    })
})

describe("ChatVM.spaceChangedHandler", () => {
    it("does not clear the shared right pane while Chat is mounted in the background", () => {
        mountVM()
        ;(WKApp as any).currentMenuId = "mcp-market"
        hoisted.popToRoot.mockClear()

        hoisted.spaceChangedHandler!({ space_id: "space-next" })

        expect(hoisted.popToRoot).not.toHaveBeenCalled()
    })

    it("clears the shared right pane when Chat is the active menu", () => {
        mountVM()
        ;(WKApp as any).currentMenuId = "chat"
        hoisted.popToRoot.mockClear()

        hoisted.spaceChangedHandler!({ space_id: "space-next" })

        expect(hoisted.popToRoot).toHaveBeenCalledTimes(1)
    })
})
