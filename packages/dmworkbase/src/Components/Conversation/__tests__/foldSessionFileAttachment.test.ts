import { beforeEach, describe, expect, it, vi } from "vitest"

const BOT_UIDS = new Set(["claude", "jojo"])

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
                    getChannelInfo: (channel: any) => {
                        if (BOT_UIDS.has(channel.channelID)) {
                            return { orgData: { robot: 1 } }
                        }
                        return undefined
                    },
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
    MessageContentTypeConst: {
        historySplit: -3,
        typing: -2,
        time: -1,
        image: 2,
        gif: 3,
        voice: 4,
        smallVideo: 5,
        file: 8,
        richText: 14,
        interactiveCard: 17,
        rtcData: 9994,
    },
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
vi.mock("../foldSessionSummary", () => ({ getFoldSessionExpandedMessages: (opts: any) => opts.messages }))
vi.mock("../historyScroll", () => ({ getPulldownRestoredScrollTop: () => 0, getRestoredAnchorScrollTop: () => 0 }))
vi.mock("../../../Service/Convert", () => ({ applyMsgLevelExternalFieldsWithFallback: () => {} }))
vi.mock("../sendContentProxy", () => ({ wrapSendContentForInjection: (content: any) => content }))
vi.mock("../../../Service/messageSelection", () => ({ isMessageSelectable: () => true }))

import ConversationVM from "../vm"
import { Channel } from "wukongimjssdk"

const channel = new Channel("g1", 2)

let seqCounter = 1

function botMessage(contentType: number, timestamp: number, fromUID: string = "claude") {
    const messageSeq = seqCounter++
    return {
        clientMsgNo: `msg-${messageSeq}`,
        messageSeq,
        fromUID,
        timestamp,
        contentType,
        revoke: false,
        send: false,
        from: { title: fromUID },
    } as any
}

const TEXT = 1
const IMAGE = 2
const GIF = 3
const VOICE = 4
const SMALL_VIDEO = 5
const FILE = 8
const RICH_TEXT = 14
const INTERACTIVE_CARD = 17

function humanMessage(contentType: number, timestamp: number, fromUID: string = "alice") {
    const messageSeq = seqCounter++
    return {
        clientMsgNo: `msg-${messageSeq}`,
        messageSeq,
        fromUID,
        timestamp,
        contentType,
        revoke: false,
        send: false,
        from: { title: fromUID },
    } as any
}

describe("ConversationVM fold session file attachment", () => {
    beforeEach(() => {
        ConversationVM.sendQueue.clear()
        seqCounter = 1
    })

    // --- All excluded content types ---

    it.each([
        { name: "image", contentType: IMAGE },
        { name: "gif", contentType: GIF },
        { name: "smallVideo", contentType: SMALL_VIDEO },
        { name: "file", contentType: FILE },
        { name: "richText", contentType: RICH_TEXT },
        { name: "interactiveCard", contentType: INTERACTIVE_CARD },
    ])("does not fold a bot $name message (contentType=$contentType) into a fold session", ({ contentType }) => {
        const vm = new ConversationVM(channel)
        const messages = [
            botMessage(TEXT, 100),
            botMessage(contentType, 110),
        ]

        const items = vm.buildRenderItems(messages)

        expect(items.every((item) => item.type === "message")).toBe(true)
        expect(items.map((item) => (item as any).message.contentType)).toEqual([TEXT, contentType])
    })

    // --- Voice should still fold ---

    it("still folds a bot voice message (voice is not a file attachment)", () => {
        const vm = new ConversationVM(channel)
        const messages = [
            botMessage(TEXT, 100),
            botMessage(VOICE, 110),
        ]

        const items = vm.buildRenderItems(messages)

        expect(items.length).toBe(1)
        expect(items[0].type).toBe("foldSession")
        expect((items[0] as any).session.count).toBe(2)
    })

    // --- User-sent file messages are not affected ---

    it("does not affect user-sent file messages (guard is bot-only)", () => {
        const vm = new ConversationVM(channel)
        // Human messages are never folded (they flush pending session and render standalone)
        const messages = [
            humanMessage(FILE, 100),
            humanMessage(IMAGE, 110),
        ]

        const items = vm.buildRenderItems(messages)

        expect(items.every((item) => item.type === "message")).toBe(true)
        expect(items.length).toBe(2)
    })

    // --- Boundary: attachment as first message ---

    it("renders attachment as standalone when it is the first message", () => {
        const vm = new ConversationVM(channel)
        const messages = [
            botMessage(IMAGE, 100),
            botMessage(TEXT, 110),
            botMessage(TEXT, 120),
        ]

        const items = vm.buildRenderItems(messages)

        expect(items.length).toBe(2)
        expect(items[0].type).toBe("message")
        expect((items[0] as any).message.contentType).toBe(IMAGE)
        expect(items[1].type).toBe("foldSession")
        expect((items[1] as any).session.count).toBe(2)
    })

    // --- Boundary: attachment as last message ---

    it("renders attachment as standalone when it is the last message", () => {
        const vm = new ConversationVM(channel)
        const messages = [
            botMessage(TEXT, 100),
            botMessage(TEXT, 110),
            botMessage(FILE, 120),
        ]

        const items = vm.buildRenderItems(messages)

        expect(items.length).toBe(2)
        expect(items[0].type).toBe("foldSession")
        expect((items[0] as any).session.count).toBe(2)
        expect(items[1].type).toBe("message")
        expect((items[1] as any).message.contentType).toBe(FILE)
    })

    // --- Two adjacent attachments ---

    it("renders two adjacent attachment messages as standalone items", () => {
        const vm = new ConversationVM(channel)
        const messages = [
            botMessage(IMAGE, 100),
            botMessage(FILE, 110),
        ]

        const items = vm.buildRenderItems(messages)

        expect(items.length).toBe(2)
        expect(items.every((item) => item.type === "message")).toBe(true)
        expect(items.map((item) => (item as any).message.contentType)).toEqual([IMAGE, FILE])
    })

    // --- Original structural tests ---

    it("breaks a fold group when an image sits between bot text messages", () => {
        const vm = new ConversationVM(channel)
        const messages = [
            botMessage(TEXT, 100),
            botMessage(IMAGE, 110),
            botMessage(TEXT, 120),
        ]

        const items = vm.buildRenderItems(messages)

        expect(items.length).toBe(3)
        expect(items.every((item) => item.type === "message")).toBe(true)
        expect(items.map((item) => (item as any).message.contentType)).toEqual([TEXT, IMAGE, TEXT])
    })

    it("renders foldSession + standalone image + foldSession for two text runs around an image", () => {
        const vm = new ConversationVM(channel)
        const messages = [
            botMessage(TEXT, 100),
            botMessage(TEXT, 110),
            botMessage(IMAGE, 120),
            botMessage(TEXT, 130),
            botMessage(TEXT, 140),
        ]

        const items = vm.buildRenderItems(messages)

        expect(items.length).toBe(3)
        expect(items[0].type).toBe("foldSession")
        expect((items[0] as any).session.count).toBe(2)
        expect(items[1].type).toBe("message")
        expect((items[1] as any).message.contentType).toBe(IMAGE)
        expect(items[2].type).toBe("foldSession")
        expect((items[2] as any).session.count).toBe(2)
    })

    // --- Interactive card (type-17) must stay interactive: never folded ---

    it("keeps an interactive card standalone when followed by a bot command-result message", () => {
        const vm = new ConversationVM(channel)
        // Mirrors the reported bug: a card ("确认部署?") + a command-result text
        // were folded together into "收起2条讨论", hiding the card's buttons.
        const messages = [
            botMessage(INTERACTIVE_CARD, 100),
            botMessage(TEXT, 110),
        ]

        const items = vm.buildRenderItems(messages)

        expect(items.every((item) => item.type === "message")).toBe(true)
        expect(items.map((item) => (item as any).message.contentType)).toEqual([
            INTERACTIVE_CARD,
            TEXT,
        ])
    })

    it("breaks a fold group when an interactive card sits between bot text messages", () => {
        const vm = new ConversationVM(channel)
        const messages = [
            botMessage(TEXT, 100),
            botMessage(TEXT, 110),
            botMessage(INTERACTIVE_CARD, 120),
            botMessage(TEXT, 130),
            botMessage(TEXT, 140),
        ]

        const items = vm.buildRenderItems(messages)

        expect(items.length).toBe(3)
        expect(items[0].type).toBe("foldSession")
        expect((items[0] as any).session.count).toBe(2)
        expect(items[1].type).toBe("message")
        expect((items[1] as any).message.contentType).toBe(INTERACTIVE_CARD)
        expect(items[2].type).toBe("foldSession")
        expect((items[2] as any).session.count).toBe(2)
    })
})
