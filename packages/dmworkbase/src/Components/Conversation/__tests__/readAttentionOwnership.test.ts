// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"

const gate = vi.hoisted(() => {
    let allowed = true
    const listeners = new Set<(allowed: boolean) => void>()
    return {
        get allowed() { return allowed },
        setAllowed(value: boolean) {
            const next = !!value
            if (next === allowed) return
            allowed = next
            for (const listener of Array.from(listeners)) listener(allowed)
        },
        setInitial(value: boolean) { allowed = !!value },
        subscribe(listener: (v: boolean) => void) {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        reset() {
            allowed = true
            listeners.clear()
        },
    }
})

vi.mock("../../../im-runtime/readAttentionHost", () => ({
    isImReadAttentionAllowed: () => gate.allowed,
    subscribeImReadAttention: (listener: (v: boolean) => void) => gate.subscribe(listener),
    installImReadAttentionGate: () => { throw new Error("not used") },
}))

const sdkState = vi.hoisted(() => ({
    conversation: null as any,
    openConversation: undefined as any,
    conversationListener: undefined as any,
    notifyConversationListeners: vi.fn(),
    markConversationUnread: vi.fn(() => Promise.resolve()),
    emit: vi.fn(),
    activeChannel: undefined as any,
}))

vi.mock("wukongimjssdk", () => {
    class Channel {
        channelID: string
        channelType: number
        constructor(id: string, type: number) {
            this.channelID = id
            this.channelType = type
        }
        isEqual(other: any) { return this.channelID === other.channelID && this.channelType === other.channelType }
        getChannelKey() { return `${this.channelID}-${this.channelType}` }
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
                    getChannelInfo: () => undefined,
                    fetchChannelInfo: () => Promise.resolve(undefined),
                    addListener: () => {},
                    removeListener: () => {},
                    getSubscribes: () => [],
                    addSubscriberChangeListener: () => {},
                    removeSubscriberChangeListener: () => {},
                    syncSubscribes: () => Promise.resolve(),
                    subscribeCacheMap: new Map(),
                    notifySubscribeChangeListeners: () => {},
                },
                conversationManager: {
                    get openConversation() { return sdkState.openConversation },
                    set openConversation(value: any) { sdkState.openConversation = value },
                    findConversation: () => sdkState.conversation,
                    notifyConversationListeners: sdkState.notifyConversationListeners,
                    addConversationListener: (listener: any) => { sdkState.conversationListener = listener },
                    removeConversationListener: () => {},
                },
                chatManager: {
                    addMessageListener: () => {},
                    removeMessageListener: () => {},
                    addCMDListener: () => {},
                    removeCMDListener: () => {},
                    addMessageStatusListener: () => {},
                    removeMessageStatusListener: () => {},
                },
                connectManager: { addConnectStatusListener: () => {}, removeConnectStatusListener: () => {} },
            }),
        },
        default: { shared: () => ({ channelManager: { getChannelInfo: () => undefined, fetchChannelInfo: () => Promise.resolve(undefined), addListener: () => {}, removeListener: () => {}, getSubscribes: () => [], addSubscriberChangeListener: () => {}, removeSubscriberChangeListener: () => {}, syncSubscribes: () => Promise.resolve(), subscribeCacheMap: new Map(), notifySubscribeChangeListeners: () => {} } }) },
        Message: class {},
        MessageContent: class {},
        MessageText: class {},
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
        apiClient: { config: { apiURL: "https://test.invalid/" } },
        config: { pageSizeOfMessage: 30 },
        dataSource: { channelDataSource: { subscribers: () => Promise.resolve([]) } },
        mittBus: { on: () => {}, off: () => {}, emit: sdkState.emit },
        conversationProvider: { markConversationUnread: sdkState.markConversationUnread, syncMessages: vi.fn(() => Promise.resolve([])) },
        shared: { currentSpaceId: "", get openChannel() { return sdkState.activeChannel }, notifyMessageDeleteListener: () => {} },
        endpointManager: { setMethod: () => {}, removeMethod: vi.fn() },
    },
}))
vi.mock("../../../Service/DataSource/DataProvider", () => ({ SyncMessageOptions: class {} }))
vi.mock("../../../Service/Model", () => ({ MessageWrap: class {
    constructor(message: any) { this.message = message }
    get messageSeq() { return this.message?.messageSeq || 0 }
    get clientSeq() { return this.message?.clientSeq || 0 }
    get clientMsgNo() { return this.message?.clientMsgNo || "" }
    get messageID() { return this.message?.messageID || "" }
    get timestamp() { return this.message?.timestamp || 0 }
    get fromUID() { return this.message?.fromUID || "" }
    get channel() { return this.message?.channel }
    get contentType() { return this.message?.contentType }
    get send() { return this.message?.fromUID === "me" }
    get status() { return this.message?.status }
    set status(v: number) { this.message.status = v }
    get content() { return this.message?.content }
    set content(v: any) { this.message.content = v }
    get lastMessage() { return this.message?.lastMessage }
} }))
vi.mock("../../../Service/Provider", () => ({ ProviderListener: class {
    callback?: Function
    notifyListener(done?: Function) { this.callback?.(); done?.() }
    listen(f: Function) { this.callback = f }
    clearListeners() { this.callback = undefined }
    didMount() {}
    didUnMount() {}
} }))
vi.mock("react-scroll", () => ({ animateScroll: { scrollToBottom: vi.fn() }, scroller: { scrollTo: () => {} } }))
vi.mock("../../../Service/Const", () => ({
    EndpointID: {},
    MessageContentTypeConst: { time: 1001, historySplit: 1002, rtcData: 1003, typing: 1004, image: 2, gif: 3, smallVideo: 4, file: 5, richText: 6, interactiveCard: 7 },
    OrderFactor: 10000,
    ChannelTypeCommunityTopic: 6,
}))
vi.mock("moment", () => ({ default: () => ({ format: () => "" }) }))
vi.mock("../../../Messages/Time", () => ({ TimeContent: class {} }))
vi.mock("../../../Messages/HistorySplit", () => ({ HistorySplitContent: class {} }))
vi.mock("../../../Messages/Mergeforward", () => ({ default: class {} }))
vi.mock("../../../Service/TypingManager", () => ({ TypingListener: class {}, TypingManager: { shared: { addTypingListener: () => {}, removeTypingListener: () => {}, getFakeTypingMessage: () => undefined } } }))
vi.mock("../../../Service/ProhibitwordsService", () => ({ ProhibitwordsService: { shared: { filter: (text: unknown) => (typeof text === "string" ? text : ""), getProhibitwords: () => [] } } }))
vi.mock("../../../Service/SpaceService", () => ({ SYSTEM_BOTS: new Set() }))
vi.mock("../../../Utils/const", () => ({ SuperGroup: 1 }))
vi.mock("../foldSessionSummary", () => ({ getFoldSessionExpandedMessages: () => [] }))
vi.mock("../historyScroll", () => ({ getPulldownRestoredScrollTop: () => 0, getRestoredAnchorScrollTop: ({ anchorOffsetTop, keepOffsetY }: any) => anchorOffsetTop + keepOffsetY }))
vi.mock("../../../Service/Convert", () => ({ applyMsgLevelExternalFieldsWithFallback: () => {} }))
vi.mock("../../../Utils/sendContentProxy", () => ({ wrapSendContentForInjection: (content: any) => content }))
vi.mock("../../../Service/messageSelection", () => ({ isMessageSelectable: () => true }))
vi.mock("../../../i18n", () => ({ t: (key: string) => key, useI18n: () => ({ t: (key: string) => key }) }))

import ConversationVM from "../vm"
import { Channel } from "wukongimjssdk"

const channel = new Channel("g1", 2)

describe("ConversationVM read-attention gate", () => {
    beforeEach(() => {
        ConversationVM.sendQueue.clear()
        gate.reset()
        sdkState.conversation = null
        sdkState.openConversation = undefined
        sdkState.conversationListener = undefined
        sdkState.activeChannel = channel
        sdkState.notifyConversationListeners.mockReset()
        sdkState.markConversationUnread.mockReset()
        sdkState.markConversationUnread.mockResolvedValue(undefined)
        sdkState.emit.mockReset()
        document.body.innerHTML = ""
        ConversationVM["openConversationOwner"] = undefined
    })

    it("does not claim SDK openConversation while the gate is denied", () => {
        gate.setInitial(false)
        const vm = new ConversationVM(channel)
        const conversation = { channel, unread: 1, lastMessage: { messageSeq: 5 }, channelInfo: {}, remoteExtra: {} }
        sdkState.conversation = conversation
        vm.didMount()
        expect(sdkState.openConversation).toBeUndefined()
        expect(vm.ownedOpenConversation).toBeUndefined()
        vm.didUnMount()
    })

    it("releases its own SDK openConversation when the gate is denied after mount", () => {
        gate.setInitial(true)
        const vm = new ConversationVM(channel)
        const conversation = { channel, unread: 1, lastMessage: { messageSeq: 5 }, channelInfo: {}, remoteExtra: {} }
        sdkState.conversation = conversation
        vm.didMount()
        expect(sdkState.openConversation).toBe(conversation)
        gate.setAllowed(false)
        expect(sdkState.openConversation).toBeUndefined()
        expect(vm.ownedOpenConversation).toBeUndefined()
        vm.didUnMount()
    })

    it("reclaims only its own already-current conversation on the gate turning true", () => {
        gate.setInitial(false)
        const vm = new ConversationVM(channel)
        const conversation = { channel, unread: 1, lastMessage: { messageSeq: 5 }, channelInfo: {}, remoteExtra: {} }
        sdkState.conversation = conversation
        vm.didMount()
        expect(sdkState.openConversation).toBeUndefined()

        // Another owner already claimed the SDK openConversation.
        sdkState.openConversation = { channel: new Channel("other", 2), unread: 0, remoteExtra: {} }
        ConversationVM["openConversationOwner"] = Symbol("other")
        gate.setAllowed(true)
        // Our vm should NOT steal the existing owner.
        expect(sdkState.openConversation?.channel.channelID).toBe("other")
        expect(vm.ownedOpenConversation).toBeUndefined()
        vm.didUnMount()
    })

    it("reclaims only its own current conversation on gate true when unowned", () => {
        gate.setInitial(false)
        const vm = new ConversationVM(channel)
        const conversation = { channel, unread: 1, lastMessage: { messageSeq: 5 }, channelInfo: {}, remoteExtra: {} }
        sdkState.conversation = conversation
        vm.didMount()
        expect(sdkState.openConversation).toBeUndefined()
        expect(vm.currentConversation).toBe(conversation)

        gate.setAllowed(true)
        expect(sdkState.openConversation).toBe(conversation)
        expect(vm.ownedOpenConversation).toBe(conversation)
        vm.didUnMount()
    })

    it("never reclaims after unmount (no stale owner)", () => {
        gate.setInitial(true)
        const vm = new ConversationVM(channel)
        const conversation = { channel, unread: 1, lastMessage: { messageSeq: 5 }, channelInfo: {}, remoteExtra: {} }
        sdkState.conversation = conversation
        vm.didMount()
        expect(sdkState.openConversation).toBe(conversation)

        vm.didUnMount()
        // Gate turns false then true: released on unmount, no re-claim.
        gate.setAllowed(false)
        gate.setAllowed(true)
        expect(sdkState.openConversation).toBeUndefined()
    })

    it("does not let a retained hidden conversation reclaim before the selected conversation", () => {
        gate.setInitial(false)
        const old = new ConversationVM(channel)
        sdkState.conversation = { channel, unread: 3, channelInfo: {}, remoteExtra: {} }
        old.didMount()
        const selected = new Channel("g2", 2)
        sdkState.activeChannel = selected
        const next = new ConversationVM(selected)
        const conversation = { channel: selected, unread: 2, channelInfo: {}, remoteExtra: {} }
        sdkState.conversation = conversation
        next.didMount()
        gate.setAllowed(true)
        expect(sdkState.openConversation).toBe(conversation)
        expect(old.ownedOpenConversation).toBeUndefined()
        next.didUnMount()
        old.didUnMount()
    })

    it("auxiliary conversation never claims the SDK openConversation", () => {
        gate.setInitial(true)
        const aux = new ConversationVM(channel, undefined, { registerAsOpenConversation: false })
        sdkState.conversation = { channel, unread: 1, channelInfo: {}, remoteExtra: {} }
        aux.didMount()
        expect(sdkState.openConversation).toBeUndefined()
        aux.didUnMount()
    })

    it("does not zero realtime unread from a previous browse seq while denied", () => {
        gate.setInitial(true)
        const vm = new ConversationVM(channel)
        const conversation = { channel, unread: 3, lastMessage: { messageSeq: 5 }, channelInfo: {}, remoteExtra: {} }
        sdkState.conversation = conversation
        vm.didMount()
        // Simulate a previous browse that advanced past the last message.
        vm.browseToMessageSeq = 6
        vm.lastMessage = { messageSeq: 5, fromUID: "u1" }

        // Deny attention and publish an update.
        gate.setAllowed(false)
        sdkState.conversationListener(conversation, "update")
        // The hidden UI must not reset realtime unread.
        expect(conversation.unread).toBe(3)
        expect(vm.unreadCount).toBe(3)
        vm.didUnMount()
    })

    it("still zeroes unread from a previous browse seq when allowed", () => {
        gate.setInitial(true)
        const vm = new ConversationVM(channel)
        const conversation = { channel, unread: 3, lastMessage: { messageSeq: 5 }, channelInfo: {}, remoteExtra: {} }
        sdkState.conversation = conversation
        vm.didMount()
        vm.browseToMessageSeq = 6
        vm.lastMessage = { messageSeq: 5, fromUID: "u1" }
        sdkState.conversationListener(conversation, "update")
        expect(conversation.unread).toBe(0)
        expect(vm.unreadCount).toBe(0)
        vm.didUnMount()
    })

    it("does not reconcile stale unread while the host denies attention", async () => {
        gate.setInitial(false)
        const vm = new ConversationVM(channel)
        const conversation = { channel, unread: 1, lastMessage: { messageSeq: 5 }, channelInfo: {}, remoteExtra: {} }
        sdkState.conversation = conversation
        vm.didMount()
        vm.browseToMessageSeq = 5

        await vm.refreshNewMsgCount({ reconcileRead: true })

        expect(conversation.unread).toBe(1)
        expect(sdkState.markConversationUnread).not.toHaveBeenCalled()
        vm.didUnMount()
    })

    it("does not suppress a newer snapshot using the previous loaded last message", () => {
        const vm = new ConversationVM(channel)
        sdkState.conversation = { channel, unread: 1, lastMessage: { messageSeq: 5 }, channelInfo: {}, remoteExtra: {} }
        vm.didMount()
        vm.browseToMessageSeq = 5
        const incoming = { channel, unread: 1, lastMessage: { messageSeq: 6 } }

        sdkState.conversationListener(incoming, "update")

        expect(incoming.unread).toBe(1)
        expect(vm.unreadCount).toBe(1)
        vm.didUnMount()
    })
})
