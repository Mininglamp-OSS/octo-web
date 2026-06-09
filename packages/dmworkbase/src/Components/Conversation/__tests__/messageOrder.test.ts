import { beforeEach, describe, expect, it, vi } from "vitest"

const sdkState = vi.hoisted(() => ({
    sendingQueues: new Map<number, unknown>(),
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

    return {
        Channel,
        ChannelTypeGroup: 2,
        ChannelTypePerson: 1,
        ChannelTypeCommunityTopic: 6,
        ConversationAction: { update: "update" },
        MessageStatus: { Wait: 0, Normal: 1, Fail: 2 },
        MessageContentType: { text: 1 },
        WKSDK: {
            shared: () => ({
                channelManager: {
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
                    sendingQueues: sdkState.sendingQueues,
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
        },
        Message: class {},
        MessageContent: class {},
        Subscriber: class {},
        Conversation: class {},
        MessageExtra: class {},
        CMDContent: class {},
        PullMode: {},
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
        dataSource: { channelDataSource: { subscribers: () => Promise.resolve([]) } },
        mittBus: { on: () => {}, off: () => {} },
        conversationProvider: { markConversationUnread: () => Promise.resolve() },
        shared: { currentSpaceId: "", notifyMessageDeleteListener: () => {} },
    },
}))

vi.mock("../../../Service/DataSource/DataProvider", () => ({
    SyncMessageOptions: class {},
}))
vi.mock("../../../Service/Model", () => ({ MessageWrap: class {} }))
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
vi.mock("../../../Messages/Mergeforward", () => ({ default: class {} }))
vi.mock("../../../Service/TypingManager", () => ({
    TypingListener: class {},
    TypingManager: { shared: { addTypingListener: () => {}, removeTypingListener: () => {} } },
}))
vi.mock("../../../Service/ProhibitwordsService", () => ({ ProhibitwordsService: { shared: { filter: (text: string) => text, getProhibitwords: () => [] } } }))
vi.mock("../../../Service/SpaceService", () => ({ SYSTEM_BOTS: new Set() }))
vi.mock("../../../Utils/const", () => ({ SuperGroup: 1 }))
vi.mock("../foldSessionSummary", () => ({ getFoldSessionExpandedMessages: () => [] }))
vi.mock("../historyScroll", () => ({ getPulldownRestoredScrollTop: () => 0 }))
vi.mock("../../../Service/Convert", () => ({ applyMsgLevelExternalFieldsWithFallback: () => {} }))
vi.mock("../sendContentProxy", () => ({ wrapSendContentForInjection: (content: any) => content }))
vi.mock("../../../Service/messageSelection", () => ({ isMessageSelectable: () => true }))

import ConversationVM from "../vm"
import { Channel, MessageStatus } from "wukongimjssdk"

const channel = new Channel("g1", 2)

function wrap(overrides: Record<string, any>) {
    const message: any = {
        channel,
        clientSeq: overrides.clientSeq || 0,
        clientMsgNo: overrides.clientMsgNo || "",
        messageSeq: overrides.messageSeq || 0,
        messageID: overrides.messageID || "",
        timestamp: overrides.timestamp || 0,
        status: overrides.status ?? MessageStatus.Normal,
        fromUID: overrides.fromUID || "me",
        remoteExtra: {},
    }
    const result: any = {
        message,
        order: overrides.order ?? (message.messageSeq > 0 ? message.messageSeq * 10000 : 0),
        get clientSeq() { return message.clientSeq },
        get clientMsgNo() { return message.clientMsgNo },
        get messageSeq() { return message.messageSeq },
        get messageID() { return message.messageID },
        get timestamp() { return message.timestamp },
        get fromUID() { return message.fromUID },
        get channel() { return message.channel },
        get status() { return message.status },
        set status(value: number) { message.status = value },
        get send() { return message.fromUID === "me" },
        reasonCode: 0,
    }
    return result
}

describe("ConversationVM message ordering", () => {
    beforeEach(() => {
        ConversationVM.sendQueue.clear()
        sdkState.sendingQueues.clear()
    })

    it("uses a unique message container id for each instance", () => {
        const first = new ConversationVM(channel)
        const second = new ConversationVM(channel)

        expect(first.messageContainerId).toMatch(/^viewport-\d+$/)
        expect(second.messageContainerId).toMatch(/^viewport-\d+$/)
        expect(first.messageContainerId).not.toBe(second.messageContainerId)
    })

    it("sorts no-seq messages with invalid order after sequenced messages", () => {
        const vm = new ConversationVM(channel)
        const seq2 = wrap({ clientMsgNo: "seq2", messageSeq: 2, timestamp: 200 })
        const stale = wrap({ clientMsgNo: "stale", order: Number.NaN, timestamp: 100 })
        const seq1 = wrap({ clientMsgNo: "seq1", messageSeq: 1, timestamp: 150 })

        expect(vm.sortMessages([seq2, stale, seq1]).map((m: any) => m.clientMsgNo)).toEqual([
            "seq1",
            "seq2",
            "stale",
        ])
    })

    it("fills a finite temporary order even when the current max message has invalid order", () => {
        const vm = new ConversationVM(channel)
        vm.messagesOfOrigin = [
            wrap({ clientMsgNo: "seq1", messageSeq: 1, timestamp: 100 }),
            wrap({ clientMsgNo: "stale", order: Number.NaN, timestamp: 200 }),
        ]
        const next = wrap({ clientMsgNo: "next", order: Number.NaN, timestamp: 300 })

        vm.fillOrder(next)

        expect(Number.isFinite(next.order)).toBe(true)
    })

    it("reorders and refreshes origin messages after a successful send ack", () => {
        const vm = new ConversationVM(channel)
        const seq100 = wrap({ clientMsgNo: "seq100", messageSeq: 100, timestamp: 100 })
        const pending = wrap({ clientSeq: 7, clientMsgNo: "pending", order: 1000001, timestamp: 300, status: MessageStatus.Wait })
        const seq101 = wrap({ clientMsgNo: "seq101", messageSeq: 101, timestamp: 200 })
        const queued = wrap({ clientSeq: 7, clientMsgNo: "pending", order: Number.NaN, timestamp: 300, status: MessageStatus.Wait })
        vm.messagesOfOrigin = [seq100, pending, seq101]
        vm.messages = [seq100, pending, seq101]
        ConversationVM.sendQueue.set(channel.getChannelKey(), [queued])
        const refreshMessages = vi.spyOn(vm, "refreshMessages").mockImplementation(() => {})

        vm.updateMessageStatusBySendAck({
            clientSeq: 7,
            messageID: "m102",
            messageSeq: 102,
            reasonCode: 1,
        } as any)

        expect(pending.messageSeq).toBe(102)
        expect(pending.order).toBe(1020000)
        expect(queued.order).toBe(1020000)
        expect(pending.status).toBe(MessageStatus.Normal)
        expect(ConversationVM.sendQueue.get(channel.getChannelKey())).toEqual([])
        expect(vm.messagesOfOrigin.map((m: any) => m.clientMsgNo)).toEqual(["seq100", "seq101", "pending"])
        expect(refreshMessages).toHaveBeenCalledTimes(1)
    })

    it("drops stale wait messages from sendQueue when SDK is no longer sending them", () => {
        const vm = new ConversationVM(channel)
        const stale = wrap({ clientSeq: 7, clientMsgNo: "stale", timestamp: 100, status: MessageStatus.Wait })
        const active = wrap({ clientSeq: 8, clientMsgNo: "active", timestamp: 200, status: MessageStatus.Wait })
        ConversationVM.sendQueue.set(channel.getChannelKey(), [stale, active])
        sdkState.sendingQueues.set(8, {})

        const sendingMessages = vm.getSendingMessages(channel)

        expect(sendingMessages.map((m: any) => m.clientMsgNo)).toEqual(["active"])
        expect(ConversationVM.sendQueue.get(channel.getChannelKey())?.map((m: any) => m.clientMsgNo)).toEqual(["active"])
    })
})
