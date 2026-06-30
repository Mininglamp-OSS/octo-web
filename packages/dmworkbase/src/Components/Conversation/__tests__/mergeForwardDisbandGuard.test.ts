// @vitest-environment jsdom
//
// 回归测试（review Critical）：合并转发(merge-forward)到「已解散」的群/子区目标
// 必须被发送守卫拦截，不得入队出站消息。
//
// 背景：发送守卫最初只放在组件层 Conversation.sendMessage，而 merge-forward 经
// vm.sendMergeforward → vm.sendMessage → chatManager.send 直达，绕过组件层。修复
// 是把守卫下沉到 ConversationVM.sendMessage（所有发送入口的汇合点）。本测试钉住
// 该不变量：解散目标 → reject 且不调 chatManager.send；混合目标 → 仅正常目标发出，
// 解散目标计入 failed。

import { beforeEach, describe, expect, it, vi } from "vitest"

const sdkState = vi.hoisted(() => ({
    channelInfos: new Map<string, any>(),
    send: vi.fn(),
}))

vi.mock("wukongimjssdk", () => {
    class Channel {
        channelID: string
        channelType: number
        constructor(id: string, type: number) {
            this.channelID = id
            this.channelType = type
        }
        isEqual(other: any) {
            return this.channelID === other.channelID && this.channelType === other.channelType
        }
        getChannelKey() {
            return `${this.channelID}-${this.channelType}`
        }
    }
    const WKSDK = {
        shared: () => ({
            channelManager: {
                getChannelInfo: (channel: any) => sdkState.channelInfos.get(channel.getChannelKey()),
                fetchChannelInfo: () => {},
                getSubscribes: () => [],
                addSubscriberChangeListener: () => {},
                removeSubscriberChangeListener: () => {},
                syncSubscribes: () => Promise.resolve(),
                subscribeCacheMap: new Map(),
                notifySubscribeChangeListeners: () => {},
            },
            conversationManager: {
                findConversation: () => null,
                notifyConversationListeners: () => {},
                addConversationListener: () => {},
                removeConversationListener: () => {},
            },
            chatManager: {
                send: sdkState.send,
                sendingQueues: new Map(),
                addMessageListener: () => {},
                removeMessageListener: () => {},
                addCMDListener: () => {},
                removeCMDListener: () => {},
                addMessageStatusListener: () => {},
                removeMessageStatusListener: () => {},
            },
            connectManager: {
                addConnectStatusListener: () => {},
                removeConnectStatusListener: () => {},
            },
        }),
    }
    return {
        default: WKSDK,
        Channel,
        ChannelTypeGroup: 2,
        ChannelTypePerson: 1,
        ChannelTypeCommunityTopic: 6,
        ConversationAction: { update: "update" },
        MessageStatus: { Wait: 0, Normal: 1, Fail: 2 },
        MessageContentType: { text: 1 },
        WKSDK,
        Message: class {},
        MessageContent: class {},
        Subscriber: class {},
        Conversation: class {},
        MessageExtra: class {},
        CMDContent: class {},
        PullMode: { Down: 0, Up: 1 },
        ChannelInfo: class {},
        ChannelInfoListener: class {},
        ConversationListener: class {},
        ConnectStatus: {},
        ConnectStatusListener: class {},
        MessageListener: class {},
        MessageStatusListener: class {},
        SendackPacket: class {},
        Setting: class {},
        SystemContent: class {},
    }
})

vi.mock("../../../App", () => ({
    default: {
        loginInfo: { uid: "me" },
        config: { pageSizeOfMessage: 30 },
        dataSource: { channelDataSource: { subscribers: () => Promise.resolve([]) } },
        mittBus: { on: () => {}, off: () => {} },
        conversationProvider: {
            markConversationUnread: () => Promise.resolve(),
            syncMessages: () => Promise.resolve([]),
        },
        shared: { currentSpaceId: "", notifyMessageDeleteListener: () => {} },
    },
}))

vi.mock("../../../Service/DataSource/DataProvider", () => ({ SyncMessageOptions: class {} }))
vi.mock("../../../Service/Model", () => ({
    MessageWrap: class {
        constructor(public message: any) {}
        get channel() { return this.message?.channel }
        get clientMsgNo() { return this.message?.clientMsgNo }
        get messageSeq() { return this.message?.messageSeq ?? 0 }
        order = 0
    },
}))
vi.mock("../../../Service/Provider", () => ({
    ProviderListener: class {
        callback?: Function
        notifyListener(done?: Function) { this.callback?.(); done?.() }
        listen(f: Function) { this.callback = f }
        clearListeners() { this.callback = undefined }
        didMount() {}
        didUnMount() {}
    },
}))
vi.mock("react-scroll", () => ({ animateScroll: { scrollToBottom: () => {} }, scroller: { scrollTo: () => {} } }))
vi.mock("../../../Service/Const", () => ({
    EndpointID: {},
    MessageContentTypeConst: { time: 1001, historySplit: 1002, rtcData: 1003 },
    OrderFactor: 10000,
    ChannelTypeCommunityTopic: 6,
}))
vi.mock("moment", () => ({ default: () => ({ format: () => "" }) }))
vi.mock("../../../Messages/Time", () => ({ TimeContent: class {} }))
vi.mock("../../../Messages/HistorySplit", () => ({ HistorySplitContent: class {} }))
vi.mock("../../../Messages/Mergeforward", () => ({ default: class { constructor() {} } }))
vi.mock("../../../Service/TypingManager", () => ({
    TypingListener: class {},
    TypingManager: { shared: { addTypingListener: () => {}, removeTypingListener: () => {} } },
}))
vi.mock("../../../Service/ProhibitwordsService", () => ({ ProhibitwordsService: { shared: { filter: (text: string) => text, getProhibitwords: () => [] } } }))
vi.mock("../../../Service/SpaceService", () => ({ SYSTEM_BOTS: new Set() }))
vi.mock("../../../Utils/const", () => ({ SuperGroup: 1 }))
vi.mock("../foldSessionSummary", () => ({ getFoldSessionExpandedMessages: () => [] }))
vi.mock("../historyScroll", () => ({
    getPulldownRestoredScrollTop: () => 0,
    getRestoredAnchorScrollTop: ({ anchorOffsetTop, keepOffsetY }: any) => anchorOffsetTop + keepOffsetY,
}))
vi.mock("../../../Service/Convert", () => ({ applyMsgLevelExternalFieldsWithFallback: () => {} }))
vi.mock("../sendContentProxy", () => ({ wrapSendContentForInjection: (content: any) => content }))
vi.mock("../../../Service/messageSelection", () => ({ isMessageSelectable: () => true }))

import ConversationVM from "../vm"
import { Channel, ChannelTypeGroup } from "wukongimjssdk"

const GroupStatusDisband = 2
const sourceChannel = new Channel("src", ChannelTypeGroup)

function setChannelStatus(channelID: string, status: number) {
    const ch = new Channel(channelID, ChannelTypeGroup)
    sdkState.channelInfos.set(ch.getChannelKey(), { channel: ch, orgData: { status } })
}

describe("merge-forward disband guard", () => {
    beforeEach(() => {
        ConversationVM.sendQueue.clear()
        sdkState.channelInfos.clear()
        sdkState.send.mockReset()
        // 返回带 channel 的消息：vm.sendMessage 在 send 之后会 new MessageWrap(message)
        // 并读 message.channel.getChannelKey() 入队，channel 缺失会让正常目标也抛错。
        sdkState.send.mockImplementation((_content: any, channel: any) => Promise.resolve({ channel }))
    })

    it("vm.sendMessage rejects and does NOT reach chatManager.send for a disbanded group", async () => {
        const vm = new ConversationVM(sourceChannel)
        const dest = new Channel("disbanded-g", ChannelTypeGroup)
        setChannelStatus("disbanded-g", GroupStatusDisband)

        await expect(vm.sendMessage({} as any, dest)).rejects.toThrow(/disband/i)
        expect(sdkState.send).not.toHaveBeenCalled()
    })

    it("merge-forward into a disbanded destination is blocked, normal destination still sends", async () => {
        const vm = new ConversationVM(sourceChannel)
        // 选中一条消息作为合并转发内容来源。
        vi.spyOn(vm, "getCheckedMessages").mockReturnValue([
            { message: { fromUID: "u1", remoteExtra: {} } } as any,
        ])

        const disbanded = new Channel("disbanded-g", ChannelTypeGroup)
        const normal = new Channel("normal-g", ChannelTypeGroup)
        setChannelStatus("disbanded-g", GroupStatusDisband)
        setChannelStatus("normal-g", 1) // Normal

        const result = await vm.sendMergeforward([disbanded, normal])

        // 解散目标计入 failed、不影响正常目标；总数为 2。
        expect(result).toEqual({ failed: 1, total: 2 })
        // chatManager.send 只对正常目标发生一次（解散目标被守卫拦在 send 之前）。
        expect(sdkState.send).toHaveBeenCalledTimes(1)
    })

    it("merge-forward into all-normal destinations sends to every target", async () => {
        const vm = new ConversationVM(sourceChannel)
        vi.spyOn(vm, "getCheckedMessages").mockReturnValue([
            { message: { fromUID: "u1", remoteExtra: {} } } as any,
        ])
        const a = new Channel("a", ChannelTypeGroup)
        const b = new Channel("b", ChannelTypeGroup)
        setChannelStatus("a", 1)
        setChannelStatus("b", 1)

        const result = await vm.sendMergeforward([a, b])

        expect(result).toEqual({ failed: 0, total: 2 })
        expect(sdkState.send).toHaveBeenCalledTimes(2)
    })
})
