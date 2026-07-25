// @vitest-environment jsdom
//
// 回归测试：vm.sendMessage 里 `isConversationDisbanded` 守卫是消息发送的最底层
// 汇合点，覆盖输入框发送、重发、以及任何未来又走回 vm.sendMessage 的路径。
// 目前转发流走 ForwardService 独立 disband 过滤（ForwardService.test.ts 已覆盖），
// vm.sendMessage 层的 guard 在正常 typing 路径上没有其它 test 直接钉住——
// 若被误删/短路，回归无 fail。本 spec 保留一条 mini test 让守卫不变哑弹。
//
// 覆盖范围有意最小化：仅验证 disband channel → reject 且不 call chatManager.send。
// 完整的转发场景已迁到 Service/__tests__/ForwardService.test.ts。

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
vi.mock("../../../Utils/sendContentProxy", () => ({ wrapSendContentForInjection: (content: any) => content }))
vi.mock("../../../Service/messageSelection", () => ({ isMessageSelectable: () => true }))
// i18n barrel 在 jsdom 里会间接拉起 lottie-web（无 canvas 会崩在模块加载期），
// 与其他 vm 测试保持一致 stub。
vi.mock("../../../i18n", () => ({
    t: (key: string) => key,
    useI18n: () => ({ t: (key: string) => key }),
}))

import ConversationVM from "../vm"
import { Channel, ChannelTypeGroup } from "wukongimjssdk"

const GroupStatusDisband = 2
const sourceChannel = new Channel("src", ChannelTypeGroup)

describe("vm.sendMessage disband guard", () => {
    beforeEach(() => {
        ConversationVM.sendQueue.clear()
        sdkState.channelInfos.clear()
        sdkState.send.mockReset()
        sdkState.send.mockImplementation((_content: any, channel: any) => Promise.resolve({ channel }))
    })

    it("rejects and does NOT reach chatManager.send for a disbanded group", async () => {
        const vm = new ConversationVM(sourceChannel)
        const dest = new Channel("disbanded-g", ChannelTypeGroup)
        sdkState.channelInfos.set(dest.getChannelKey(), { orgData: { status: GroupStatusDisband } })

        await expect(vm.sendMessage({} as any, dest)).rejects.toThrow(/disband/i)
        expect(sdkState.send).not.toHaveBeenCalled()
    })

    it("sends normally to a non-disbanded group", async () => {
        const vm = new ConversationVM(sourceChannel)
        const dest = new Channel("normal-g", ChannelTypeGroup)
        sdkState.channelInfos.set(dest.getChannelKey(), { orgData: { status: 1 } })

        await vm.sendMessage({} as any, dest)
        expect(sdkState.send).toHaveBeenCalledTimes(1)
    })
})
