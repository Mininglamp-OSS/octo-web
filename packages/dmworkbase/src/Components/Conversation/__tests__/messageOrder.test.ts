// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"

const sdkState = vi.hoisted(() => ({
    sendingQueues: new Map<number, unknown>(),
    channelInfos: new Map<string, any>(),
    syncMessages: vi.fn(),
    send: vi.fn(),
    conversation: null as any,
    openConversation: undefined as any,
    notifyConversationListeners: vi.fn(),
    scrollToBottom: vi.fn(),
    markConversationUnread: vi.fn(() => Promise.resolve()),
    emit: vi.fn(),
    messageListener: undefined as any,
    cmdListener: undefined as any,
    conversationListener: undefined as any,
    messageStatusListener: undefined as any,
    connectStatusListener: undefined as any,
    typingListener: undefined as any,
    clearChannelHandler: undefined as any,
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
                    getChannelInfo: (channel: any) => sdkState.channelInfos.get(channel.getChannelKey()),
                    fetchChannelInfo: () => {},
                    getSubscribes: () => [],
                    addSubscriberChangeListener: () => {},
                    removeSubscriberChangeListener: () => {},
                    syncSubscribes: () => Promise.resolve(),
                    subscribeCacheMap: new Map(),
                    notifySubscribeChangeListeners: () => {},
                    addListener: () => {},
                    removeListener: () => {},
                },
                conversationManager: {
                    get openConversation() {
                        return sdkState.openConversation
                    },
                    set openConversation(value: any) {
                        sdkState.openConversation = value
                    },
                    findConversation: () => sdkState.conversation,
                    notifyConversationListeners: sdkState.notifyConversationListeners,
                    addConversationListener: (listener: any) => { sdkState.conversationListener = listener },
                    removeConversationListener: () => {},
                },
                chatManager: {
                    sendingQueues: sdkState.sendingQueues,
                    send: sdkState.send,
                    addMessageListener: (listener: any) => { sdkState.messageListener = listener },
                    removeMessageListener: () => {},
                    addCMDListener: (listener: any) => { sdkState.cmdListener = listener },
                    removeCMDListener: () => {},
                    addMessageStatusListener: (listener: any) => { sdkState.messageStatusListener = listener },
                    removeMessageStatusListener: () => {},
                },
                connectManager: {
                    addConnectStatusListener: (listener: any) => { sdkState.connectStatusListener = listener },
                    removeConnectStatusListener: () => {},
                    addListener: () => {},
                    removeListener: () => {},
                },
            }),
        },
        default: {
            shared: () => ({
                channelManager: {
                    getChannelInfo: (channel: any) => sdkState.channelInfos.get(channel.getChannelKey()),
                },
            }),
        },
        Message: class {},
        MessageContent: class {},
        MessageText: class {
            text: string
            constructor(text: string) { this.text = text }
            get contentType() { return 1 }
        },
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
        mittBus: { on: () => {}, off: () => {}, emit: sdkState.emit },
        conversationProvider: {
            markConversationUnread: sdkState.markConversationUnread,
            syncMessages: sdkState.syncMessages,
        },
        shared: { currentSpaceId: "", notifyMessageDeleteListener: () => {} },
        endpointManager: { setMethod: (_id: string, handler: any) => { sdkState.clearChannelHandler = handler }, removeMethod: vi.fn() },
    },
}))

vi.mock("../../../Service/DataSource/DataProvider", () => ({
    SyncMessageOptions: class {},
}))
vi.mock("../../../Service/Model", () => ({ MessageWrap: class {
    message: any
    order = 0
    constructor(message: any) { this.message = message }
    get clientSeq() { return this.message?.clientSeq || 0 }
    get clientMsgNo() { return this.message?.clientMsgNo || "" }
    get messageSeq() { return this.message?.messageSeq || 0 }
    get messageID() { return this.message?.messageID || "" }
    get timestamp() { return this.message?.timestamp || 0 }
    get fromUID() { return this.message?.fromUID || "" }
    get channel() { return this.message?.channel }
    get contentType() { return this.message?.content?.contentType ?? this.message?.contentType }
    get content() { return this.message?.content }
    set content(value: any) { this.message.content = value }
    get status() { return this.message?.status }
    set status(value: any) { this.message.status = value }
    get send() { return this.message?.fromUID === "me" }
} }))
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
vi.mock("react-scroll", () => ({ animateScroll: { scrollToBottom: sdkState.scrollToBottom }, scroller: { scrollTo: () => {} } }))
vi.mock("../../../Service/Const", () => ({
    EndpointID: {},
    MessageContentTypeConst: {
        time: 1001,
        historySplit: 1002,
        rtcData: 1003,
        typing: 1004,
        image: 2,
        gif: 3,
        smallVideo: 4,
        file: 5,
        richText: 6,
        interactiveCard: 7,
    },
    OrderFactor: 10000,
    ChannelTypeCommunityTopic: 6,
}))
vi.mock("moment", () => ({ default: () => ({ format: () => "" }) }))
vi.mock("../../../Messages/Time", () => ({ TimeContent: class {} }))
vi.mock("../../../Messages/HistorySplit", () => ({ HistorySplitContent: class {} }))
vi.mock("../../../Messages/Mergeforward", () => ({
    default: class {
        channelType: number
        users: any[]
        messages: any[]
        constructor(channelType: number, users: any[], messages: any[]) {
            this.channelType = channelType
            this.users = users
            this.messages = messages
        }
    },
}))
vi.mock("../../../Service/TypingManager", () => ({
    TypingListener: class {},
    TypingManager: { shared: { addTypingListener: (listener: any) => { sdkState.typingListener = listener }, removeTypingListener: () => {}, getFakeTypingMessage: () => undefined } },
}))
vi.mock("../../../Service/ProhibitwordsService", () => ({ ProhibitwordsService: { shared: { filter: (text: unknown) => (typeof text === "string" && text.length > 0 ? text : ""), getProhibitwords: () => [] } } }))
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
vi.mock("../../../i18n", () => ({
    t: (key: string) => key,
    useI18n: () => ({ t: (key: string) => key }),
}))

import ConversationVM from "../vm"
import { Channel, MessageStatus } from "wukongimjssdk"
import { SUMMARY_TIP_TEMPLATE } from "../../../Messages/SummaryNotify/protocol"
import WKApp from "../../../App"

const channel = new Channel("g1", 2)

function wrap(overrides: Record<string, any>) {
    const message: any = {
        channel,
        clientSeq: overrides.clientSeq || 0,
        clientMsgNo: overrides.clientMsgNo || "",
        messageSeq: overrides.messageSeq || 0,
        messageID: overrides.messageID || "",
        timestamp: overrides.timestamp || 0,
        contentType: overrides.contentType ?? 1,
        status: overrides.status ?? MessageStatus.Normal,
        fromUID: overrides.fromUID || "me",
        content: overrides.content,
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
        // Faithful to the SDK: Message.contentType derefs `content.contentType`
        // (see wukongimjssdk Message.prototype.contentType). Reading the raw
        // field would mask the malformed-content crash this suite guards (#465).
        get contentType() { return message.content?.contentType ?? message.contentType },
        get status() { return message.status },
        set status(value: number) { message.status = value },
        get content() { return message.content },
        set content(value: any) { message.content = value },
        get revoke() { return message.remoteExtra.revoke },
        set revoke(value: boolean) { message.remoteExtra.revoke = value },
        get revoker() { return message.remoteExtra.revoker },
        set revoker(value: string | undefined) { message.remoteExtra.revoker = value },
        get send() { return message.fromUID === "me" },
        reasonCode: 0,
    }
    return result
}

function rawMessage(messageSeq: number, overrides: Record<string, any> = {}) {
    return {
        channel,
        clientSeq: 0,
        clientMsgNo: `msg-${messageSeq}`,
        messageSeq,
        messageID: `id-${messageSeq}`,
        timestamp: messageSeq,
        contentType: 1,
        status: MessageStatus.Normal,
        fromUID: "u1",
        remoteExtra: {},
        isDeleted: false,
        ...overrides,
    }
}

describe("ConversationVM message ordering", () => {
    beforeEach(() => {
        ConversationVM.sendQueue.clear()
        sdkState.sendingQueues.clear()
        sdkState.channelInfos.clear()
        sdkState.syncMessages.mockReset()
        sdkState.send.mockReset()
        sdkState.conversation = null
        sdkState.openConversation = undefined
        sdkState.notifyConversationListeners.mockReset()
        sdkState.scrollToBottom.mockReset()
        sdkState.markConversationUnread.mockReset()
        sdkState.markConversationUnread.mockResolvedValue(undefined)
        sdkState.emit.mockReset()
        sdkState.messageListener = undefined
        sdkState.cmdListener = undefined
        sdkState.conversationListener = undefined
        sdkState.messageStatusListener = undefined
        sdkState.connectStatusListener = undefined
        sdkState.typingListener = undefined
        sdkState.clearChannelHandler = undefined
        document.body.innerHTML = ""
    })

    it("covers message lookup, selection, participants, typing, and fold helpers", () => {
        const vm = new ConversationVM(channel)
        const first = wrap({ clientSeq: 1, clientMsgNo: "m1", messageID: "id1", messageSeq: 1, fromUID: "u1", content: { text: "hello" } })
        const second = wrap({ clientSeq: 2, clientMsgNo: "m2", messageID: "id2", messageSeq: 2, fromUID: "u2", content: { text: "world" } })
        vm.messages = [first, second]
        vm.messagesOfOrigin = [first, second]
        ;(vm as any).checkedMessage(first.message, true)
        expect((vm as any).getCheckedMessages()).toContain(first)
        ;(vm as any).checkedMessage(first.message, false)
        expect((vm as any).getCheckedMessages()).toEqual([])
        expect((vm as any).findMessageWithClientMsgNo("m2")).toBe(second)
        expect((vm as any).findMessageWithMessageID("id1")).toBe(first)
        expect((vm as any).findMessageWithMessageSeq(2)).toBe(second)
        expect((vm as any).findMessageWithClientSeq(1)).toBe(first)
        expect((vm as any).getFoldSessionId(first)).toContain("fold-session")
        expect((vm as any).foldSessionMessageElementId(first)).toContain("fold-session")
        expect((vm as any).getSessionParticipants([first, second])).toHaveLength(2)
        vm.addTypingMessage(false)
        expect(vm.hasTyingMessage()).toBe(false)
        vm.removeTypingMessage(false)
        expect((vm as any).subscriberWithUID("missing")).toBeUndefined()
    })

    it("covers render-item rebuilding and fold-session state transitions", () => {
        const vm = new ConversationVM(channel)
        const messages = [1, 2, 3, 4].map((seq) => wrap({ clientMsgNo: `fold-${seq}`, messageID: `id-${seq}`, messageSeq: seq, fromUID: seq % 2 ? "u1" : "u2", timestamp: seq, content: { text: `text-${seq}` } }))
        vm.messages = messages
        vm.messagesOfOrigin = messages
        expect(vm.buildRenderItems(messages, true)).toBeTruthy()
        vm.rebuildRenderItems(true)
        expect(vm.renderItems.length).toBeGreaterThan(0)
        const session: any = vm.renderItems.find((item: any) => item.type === "foldSession")?.session
        if (session) {
            vm.setFoldSessionExpanded(session.sessionId, true, true)
            vm.toggleFoldSession(session.sessionId)
            vm.highlightFoldSessionSummary(session.sessionId)
            vm.clearFoldSessionSummaryHighlight(session.sessionId)
            vm.clearFoldSessionAnimation(session.sessionId)
            vm.scrollToFoldSession(session.sessionId)
            expect(vm.findFoldSessionByMessageSeq(messages[0].messageSeq)).toBeTruthy()
        }
        vm.unCheckAllMessages()
        expect(vm.getCheckedMessages()).toEqual([])
        vm.appendMessage(messages[0])
        vm.updateLastMessageIfNeed(messages[0])
    })

    it("covers subscriber, draft, status, and pending-message accessors", async () => {
        const vm: any = new ConversationVM(channel)
        vm.subscribers = [{ uid: "u1", name: "Alice" }]
        expect(vm.subscriberWithUID("u1").name).toBe("Alice")
        await expect(vm.getFirstPageMembers()).resolves.toEqual([])
        expect(vm.getTypingMessage()).toBeUndefined()
        expect(vm.hasTyingMessage()).toBe(false)
        vm.removeTypingMessage(false)
        expect(vm.hasTyingMessage()).toBe(false)
        vm.addTypingMessage(false)
        vm.removeTypingMessage(true)
        vm.pendingMessages = [wrap({ clientMsgNo: "pending", timestamp: 3 })]
        expect(vm.getSendingMessages(channel)).toBeDefined()
        expect(vm.findMessageByStreamNo("none")).toBeUndefined()
        expect(vm.findMaxExtraVersion()).toBe(0)
        vm.messages = [wrap({ clientMsgNo: "draft", content: { remoteExtra: { draft: "yes" } } })]
        expect(vm.hasDraft()).toBeDefined()
        vm.updateMessageByMessageExtras([{ messageID: "missing", extraVersion: 1 }] as any)
        await vm.ensureSubscribersLoaded(1)
        vm.didUnMount()
    })

    it("covers unread transitions, reply extras, and failed acknowledgements", async () => {
        const vm: any = new ConversationVM(channel)
        const reply = wrap({ clientSeq: 7, clientMsgNo: "reply", messageID: "m1", messageSeq: 1, fromUID: "u1", content: { reply: { messageID: "original", content: {} } } })
        ;(reply as any).resetParts = vi.fn()
        vm.messages = [reply]
        vm.messagesOfOrigin = [reply]
        vm.updateReplyMessageContent({ messageID: "original", contentEdit: { text: "edited" } } as any)
        expect(reply.content.reply.content).toEqual({ text: "edited" })
        vm.updateMessageByMessageExtras([{ messageID: "m1", extraVersion: 3, contentEdit: { text: "x" } }] as any)
        expect(reply.message.remoteExtra.extraVersion).toBe(3)
        vm.currentConversation = { remoteExtra: { draft: "hello" }, unread: 0, channel }
        expect(vm.hasDraft()).toBe(true)
        expect(vm.draft()).toBe("hello")
        vm.currentConversation.remoteExtra.draft = ""
        expect(vm.draft()).toBe("")
        vm.messagesOfOrigin = [reply]
        vm.messages = [reply]
        const refresh = vi.spyOn(vm, "refreshMessages").mockImplementation(() => {})
        vm.updateMessageStatusBySendAck({ clientSeq: 7, messageID: "failed", messageSeq: 2, reasonCode: 2 } as any)
        expect(reply.status).toBe(MessageStatus.Fail)
        expect(refresh).not.toHaveBeenCalled()
        vm.lastMessage = wrap({ messageSeq: 4, fromUID: "u1" })
        vm.browseToMessageSeq = 0
        await vm.refreshNewMsgCount()
        expect(vm.unreadCount).toBe(4)
    })

    it("covers first-page locate state derivation and scroll helpers", async () => {
        const vm: any = new ConversationVM(channel)
        vm.currentConversation = { unread: 3, remoteExtra: { keepMessageSeq: 4, keepOffsetY: 12 }, channel, lastMessage: { messageSeq: 20 } }
        sdkState.conversation = vm.currentConversation
        vm.browseToMessageSeq = 10
        vm.syncMessages = vi.fn(async (_seq: number, callback?: () => void) => { callback?.() })
        await vm.requestMessagesOfFirstPage()
        expect(vm.syncMessages).toHaveBeenCalledWith(4, undefined, 12, false)
        await vm.requestMessagesOfFirstPage(30)
        expect(vm.syncMessages).toHaveBeenLastCalledWith(30, undefined, 0, true)
        expect(vm.conversationLastMessageSeq()).toBe(20)
        vm.pullupHasMore = true
        vm.scrollToBottomIfNeedPull()
        vm.pullupHasMore = false
        vm.scrollToBottomIfNeedPull()
    })

    it("covers subscriber resync branches for super, regular, thread, and non-group channels", async () => {
        const superVm: any = new ConversationVM(channel)
        superVm.channelInfo = { orgData: { group_type: 1 } }
        superVm.getFirstPageMembers = vi.fn(async () => [{ uid: "u1" }])
        await superVm.resyncSubscribers()
        const regularVm: any = new ConversationVM(channel)
        regularVm.channelInfo = { orgData: { group_type: 0 } }
        await regularVm.resyncSubscribers()
        const personVm: any = new ConversationVM(new Channel("u1", 1))
        await personVm.resyncSubscribers()
        const threadVm: any = new ConversationVM(new Channel("thread", 6))
        threadVm.channelInfo = { orgData: {} }
        await threadVm.resyncSubscribers()
        expect(superVm.getFirstPageMembers).toHaveBeenCalledTimes(1)
        expect(regularVm.subscribers).toEqual([])
        expect(personVm.subscribers).toEqual([])
        expect(threadVm.subscribers).toEqual([])
    })

    it("covers append-message pending, deduplication, and sender scroll branches", () => {
        const vm: any = new ConversationVM(channel)
        vm.refreshMessages = vi.fn()
        vm.scrollToBottom = vi.fn()
        vm.notifyListener = vi.fn()
        vm.pullupHasMore = true
        vm.appendMessage(wrap({ clientMsgNo: "self", fromUID: "me", timestamp: 1 }))
        vm.appendMessage(wrap({ clientMsgNo: "remote", fromUID: "u1", timestamp: 2 }))
        expect(vm.pendingMessages).toHaveLength(2)
        vm.pullupHasMore = false
        vm.appendMessage(wrap({ clientMsgNo: "new", fromUID: "u1", messageSeq: 3, timestamp: 3 }))
        expect(vm.pendingMessages).toEqual([])
        const duplicate = wrap({ clientMsgNo: "new", fromUID: "u1", messageSeq: 3, timestamp: 4 })
        vm.appendMessage(duplicate)
        expect(vm.refreshMessages).toHaveBeenCalled()
        vm.showScrollToBottomBtn = true
        vm.appendMessage(wrap({ clientMsgNo: "another", fromUID: "u1", messageSeq: 4 }))
        expect(vm.notifyListener).toHaveBeenCalled()
    })

    it("uses a unique message container id for each instance", () => {
        const first = new ConversationVM(channel)
        const second = new ConversationVM(channel)

        expect(first.messageContainerId).toMatch(/^viewport-\d+$/)
        expect(second.messageContainerId).toMatch(/^viewport-\d+$/)
        expect(first.messageContainerId).not.toBe(second.messageContainerId)
    })

    it("keeps separate summary-completion tips inside the generic system-tip dedup window", () => {
        const vm = new ConversationVM(channel)
        const summaryContent = {
            contentType: 2000,
            displayText: "Alice总结了群聊内容",
            content: {
                content: SUMMARY_TIP_TEMPLATE,
                extra: [{ uid: "alice", name: "Alice" }],
            },
        }
        const first = wrap({ clientMsgNo: "summary-1", timestamp: 100, content: summaryContent })
        const second = wrap({ clientMsgNo: "summary-2", timestamp: 200, content: { ...summaryContent } })

        expect(vm.deduplicateSystemTips([first, second])).toEqual([first, second])
    })

    it("still deduplicates other identical system tips inside five minutes", () => {
        const vm = new ConversationVM(channel)
        const first = wrap({
            clientMsgNo: "system-1",
            timestamp: 100,
            content: { contentType: 1001, displayText: "安全提示", content: { content: "安全提示" } },
        })
        const second = wrap({
            clientMsgNo: "system-2",
            timestamp: 200,
            content: { contentType: 1001, displayText: "安全提示", content: { content: "安全提示" } },
        })

        expect(vm.deduplicateSystemTips([first, second])).toEqual([first])
    })

    it("keeps a fully unread conversation unread until the visible-message gate advances browseTo", async () => {
        const vm = new ConversationVM(channel)
        const latest = wrap({
            clientMsgNo: "remote-3",
            messageSeq: 3,
            timestamp: 300,
            fromUID: "u1",
        })
        sdkState.conversation = {
            channel,
            unread: 3,
            extra: {},
        }
        vm.unreadCount = 3
        vm.browseToMessageSeq = 0
        vm.lastMessage = latest

        await vm.refreshNewMsgCount()

        expect(vm.unreadCount).toBe(3)
        expect(sdkState.markConversationUnread).not.toHaveBeenCalled()

        // Conversation advances browseTo only after its foreground + viewport
        // checks pass. Once that happens, the same calculation clears unread.
        vm.browseToMessageSeq = 3
        await vm.refreshNewMsgCount()
        expect(vm.unreadCount).toBe(0)
        expect(sdkState.markConversationUnread).toHaveBeenCalledWith(channel, 0)
    })

    it("counts the first remote message when browseTo is still zero", async () => {
        const vm = new ConversationVM(channel)
        sdkState.conversation = {
            channel,
            unread: 0,
            extra: {},
        }
        vm.browseToMessageSeq = 0
        vm.lastMessage = wrap({
            clientMsgNo: "remote-1",
            messageSeq: 1,
            timestamp: 100,
            fromUID: "u1",
        })

        await vm.refreshNewMsgCount()

        expect(vm.unreadCount).toBe(1)
        expect(sdkState.conversation.unread).toBe(1)
    })

    it("does not let an auxiliary VM claim the SDK open conversation", () => {
        const primaryConversation = { channel: new Channel("group-1", 2) }
        const threadConversation = { channel: new Channel("thread-1", 6) }
        sdkState.openConversation = primaryConversation
        const auxiliary = new ConversationVM(
            threadConversation.channel,
            undefined,
            { registerAsOpenConversation: false },
        )

        ;(auxiliary as any).claimOpenConversation(threadConversation)

        expect(sdkState.openConversation).toBe(primaryConversation)
        auxiliary.releaseOpenConversationOwnership()
        expect(sdkState.openConversation).toBe(primaryConversation)
    })

    it("only releases the exact SDK open conversation owned by the VM", () => {
        const ownedConversation = { channel: new Channel("group-1", 2) }
        const replacement = { channel: new Channel("group-1", 2) }
        const primary = new ConversationVM(ownedConversation.channel)

        ;(primary as any).claimOpenConversation(ownedConversation)
        expect(sdkState.openConversation).toBe(ownedConversation)

        sdkState.openConversation = replacement
        primary.releaseOpenConversationOwnership()
        expect(sdkState.openConversation).toBe(replacement)

        ;(primary as any).claimOpenConversation(ownedConversation)
        primary.releaseOpenConversationOwnership()
        expect(sdkState.openConversation).toBeUndefined()
    })

    it("does not let an older VM clear a newer owner's shared conversation object", () => {
        const sharedConversation = { channel: new Channel("group-1", 2) }
        const older = new ConversationVM(sharedConversation.channel)
        const newer = new ConversationVM(sharedConversation.channel)

        ;(older as any).claimOpenConversation(sharedConversation)
        ;(newer as any).claimOpenConversation(sharedConversation)
        older.releaseOpenConversationOwnership()
        expect(sdkState.openConversation).toBe(sharedConversation)

        newer.releaseOpenConversationOwnership()
        expect(sdkState.openConversation).toBeUndefined()
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

    it("loads an anchored message window when locating an unloaded search result", async () => {
        sdkState.syncMessages.mockImplementation(async (_channel, opts) => {
            if (opts.pullMode === 0) {
                return [
                    rawMessage(55),
                    rawMessage(54, { isDeleted: true }),
                ]
            }
            return [
                rawMessage(55),
                rawMessage(56),
                rawMessage(57),
            ]
        })
        const vm = new ConversationVM(channel)
        vi.spyOn(vm, "toMessageWraps").mockImplementation((messages: any[]) => (
            messages.map((message) => wrap({
                clientMsgNo: message.clientMsgNo,
                messageSeq: message.messageSeq,
                messageID: message.messageID,
                timestamp: message.timestamp,
                fromUID: message.fromUID,
            }))
        ))
        const refreshMessages = vi.spyOn(vm, "refreshMessages").mockImplementation((_messages: any, callback?: () => void) => {
            callback?.()
        })

        await vm.requestMessagesAroundMessageSeq(56)

        expect(sdkState.syncMessages).toHaveBeenCalledWith(
            channel,
            expect.objectContaining({
                limit: 30,
                pullMode: 0,
                startMessageSeq: 55,
            }),
        )
        expect(sdkState.syncMessages).toHaveBeenCalledWith(
            channel,
            expect.objectContaining({
                limit: 30,
                pullMode: 1,
                startMessageSeq: 55,
            }),
        )
        expect(refreshMessages).toHaveBeenCalledTimes(1)
        expect(refreshMessages.mock.calls[0][0].map((message: any) => message.messageSeq)).toEqual([55, 56, 57])
        expect(vm.pulldownFinished).toBe(false)
        expect(vm.loading).toBe(false)
    })

    it("clears loading when locating an unloaded message fails", async () => {
        sdkState.syncMessages.mockRejectedValueOnce(new Error("locate failed"))
        const vm = new ConversationVM(channel)

        await expect(vm.requestMessagesAroundMessageSeq(56)).rejects.toThrow("locate failed")

        expect(vm.loading).toBe(false)
    })

    it("clears loading state when the initial message sync fails", async () => {
        sdkState.syncMessages.mockRejectedValueOnce(new Error("sync failed"))
        const vm = new ConversationVM(channel)

        await expect(vm.syncMessages()).rejects.toThrow("sync failed")

        expect(vm.loading).toBe(false)
    })

    it("clears loading state when loading older or newer messages fails", async () => {
        const vm = new ConversationVM(channel)
        vm.messagesOfOrigin = [wrap({ clientMsgNo: "oldest", messageSeq: 5 })]
        sdkState.syncMessages.mockRejectedValueOnce(new Error("history failed"))

        await expect(vm.pulldownMessages()).rejects.toThrow("history failed")
        expect(vm.loading).toBe(false)

        sdkState.syncMessages.mockRejectedValueOnce(new Error("newer failed"))
        await expect(vm.pullupMessages()).rejects.toThrow("newer failed")
        expect(vm.loading).toBe(false)
    })

    it("does not enter loading state when there is no newer message to load", async () => {
        const vm = new ConversationVM(channel)

        await vm.pullupMessages()

        expect(vm.loading).toBe(false)
        expect(sdkState.syncMessages).not.toHaveBeenCalled()
    })

    it("does not start a second history load while one is in progress", async () => {
        const vm = new ConversationVM(channel)
        vm.messagesOfOrigin = [wrap({ clientMsgNo: "latest", messageSeq: 5 })]
        vm.loading = true

        await Promise.all([vm.pulldownMessages(), vm.pullupMessages()])

        expect(sdkState.syncMessages).not.toHaveBeenCalled()
    })

    it("scrolls to the expanded row when locating a message inside a fold session", () => {
        const vm = new ConversationVM(channel)
        const message = wrap({ clientMsgNo: "msg-10", messageSeq: 10, timestamp: 100 })
        const viewport = document.createElement("div")
        viewport.id = vm.messageContainerId
        const anchor = document.createElement("div")
        anchor.id = "fold-session-10"
        const expandedRow = document.createElement("div")
        expandedRow.id = vm.foldSessionMessageElementId(message)
        Object.defineProperty(anchor, "offsetTop", { value: 100 })
        Object.defineProperty(expandedRow, "offsetTop", { value: 320 })
        viewport.append(anchor, expandedRow)
        document.body.appendChild(viewport)
        ;(vm as any).messageSeqToFoldSessionId = new Map([[10, "fold-session-10"]])
        vm.renderItems = [{
            type: "foldSession",
            session: {
                sessionId: "fold-session-10",
                anchorId: "fold-session-10",
                isExpanded: true,
            },
        } as any]

        vm.scrollToMessage(message, 20)

        expect(viewport.scrollTop).toBe(340)
    })

    it("falls back to the fold session anchor when the target row is not rendered", () => {
        const vm = new ConversationVM(channel)
        const message = wrap({ clientMsgNo: "msg-10", messageSeq: 10, timestamp: 100 })
        const viewport = document.createElement("div")
        viewport.id = vm.messageContainerId
        const anchor = document.createElement("div")
        anchor.id = "fold-session-10"
        Object.defineProperty(anchor, "offsetTop", { value: 100 })
        viewport.appendChild(anchor)
        document.body.appendChild(viewport)
        ;(vm as any).messageSeqToFoldSessionId = new Map([[10, "fold-session-10"]])
        vm.renderItems = [{
            type: "foldSession",
            session: {
                sessionId: "fold-session-10",
                anchorId: "fold-session-10",
                isExpanded: false,
            },
        } as any]

        vm.scrollToMessage(message, 20)

        expect(viewport.scrollTop).toBe(120)
    })

    it("uses viewport-relative geometry for nested fold session rows", () => {
        const vm = new ConversationVM(channel)
        const message = wrap({ clientMsgNo: "msg-10", messageSeq: 10, timestamp: 100 })
        const viewport = document.createElement("div")
        viewport.id = vm.messageContainerId
        viewport.scrollTop = 500
        const expandedRow = document.createElement("div")
        expandedRow.id = vm.foldSessionMessageElementId(message)
        viewport.appendChild(expandedRow)
        document.body.appendChild(viewport)
        viewport.getBoundingClientRect = () => ({
            top: 100,
            bottom: 700,
            left: 0,
            right: 0,
            width: 0,
            height: 600,
            x: 0,
            y: 100,
            toJSON: () => ({}),
        })
        expandedRow.getBoundingClientRect = () => ({
            top: 260,
            bottom: 300,
            left: 0,
            right: 0,
            width: 0,
            height: 40,
            x: 0,
            y: 260,
            toJSON: () => ({}),
        })
        ;(vm as any).messageSeqToFoldSessionId = new Map([[10, "fold-session-10"]])
        vm.renderItems = [{
            type: "foldSession",
            session: {
                sessionId: "fold-session-10",
                anchorId: "fold-session-10",
                isExpanded: true,
            },
        } as any]

        vm.scrollToMessage(message)

        expect(viewport.scrollTop).toBe(660)
    })

    it("renders historical recalled bot messages outside fold sessions", () => {
        sdkState.channelInfos.set("bot-1", {
            channel: new Channel("bot", 1),
            title: "Bot",
            orgData: { robot: 1 },
        })
        const vm = new ConversationVM(channel)
        const nowSec = Math.floor(Date.now() / 1000)
        const bot1 = wrap({ clientMsgNo: "bot-1", messageSeq: 1, messageID: "m1", timestamp: nowSec - 20, fromUID: "bot" })
        const bot2 = wrap({ clientMsgNo: "bot-2", messageSeq: 2, messageID: "m2", timestamp: nowSec - 10, fromUID: "bot" })
        const bot3 = wrap({ clientMsgNo: "bot-3", messageSeq: 3, messageID: "m3", timestamp: nowSec - 5, fromUID: "bot" })
        vm.messages = [bot1, bot2, bot3]

        vm.rebuildRenderItems()
        expect(vm.renderItems).toHaveLength(1)
        expect(vm.renderItems[0].type).toBe("foldSession")
        if (vm.renderItems[0].type === "foldSession") {
            vm.setFoldSessionExpanded(vm.renderItems[0].session.sessionId, true, true)
        }

        bot3.revoke = true
        vm.rebuildRenderItems()

        expect(vm.renderItems).toHaveLength(2)
        expect(vm.renderItems[0].type).toBe("foldSession")
        if (vm.renderItems[0].type === "foldSession") {
            expect(vm.renderItems[0].session.messages.map((m: any) => m.clientMsgNo)).toEqual(["bot-1", "bot-2"])
            expect(vm.renderItems[0].session.isExpanded).toBe(true)
            expect(vm.renderItems[0].session.userToggled).toBe(true)
        }
        expect(vm.renderItems[1]).toMatchObject({ type: "message", message: bot3 })

        bot1.revoke = true
        vm.rebuildRenderItems()

        expect(vm.renderItems).toEqual([
            { type: "message", message: bot1 },
            { type: "message", message: bot2 },
            { type: "message", message: bot3 },
        ])
    })

    it("keeps live recalled bot messages in fold sessions until messages resync", () => {
        sdkState.channelInfos.set("bot-1", {
            channel: new Channel("bot", 1),
            title: "Bot",
            orgData: { robot: 1 },
        })
        const vm = new ConversationVM(channel)
        const nowSec = Math.floor(Date.now() / 1000)
        const bot1 = wrap({ clientMsgNo: "bot-1", messageSeq: 1, messageID: "m1", timestamp: nowSec - 20, fromUID: "bot" })
        const bot2 = wrap({ clientMsgNo: "bot-2", messageSeq: 2, messageID: "m2", timestamp: nowSec - 10, fromUID: "bot" })
        const bot3 = wrap({ clientMsgNo: "bot-3", messageSeq: 3, messageID: "m3", timestamp: nowSec - 5, fromUID: "bot" })
        vm.messages = [bot1, bot2, bot3]
        vm.rebuildRenderItems()
        if (vm.renderItems[0].type === "foldSession") {
            vm.setFoldSessionExpanded(vm.renderItems[0].session.sessionId, true, true)
        }

        bot3.revoke = true
        ;(vm as any).liveFoldRevokeClientMsgNos.add(bot3.clientMsgNo)
        vm.rebuildRenderItems()

        expect(vm.renderItems).toHaveLength(1)
        expect(vm.renderItems[0].type).toBe("foldSession")
        if (vm.renderItems[0].type === "foldSession") {
            expect(vm.renderItems[0].session.messages.map((m: any) => m.clientMsgNo)).toEqual(["bot-1", "bot-2", "bot-3"])
            expect(vm.renderItems[0].session.lastMessage).toBe(bot3)
            expect(vm.renderItems[0].session.isExpanded).toBe(true)
            expect(vm.renderItems[0].session.userToggled).toBe(true)
            expect(vm.renderItems[0].session.isActive).toBe(true)
        }
    })

    it("normalizes malformed text messages during refreshMessages without throwing (#465)", () => {
        const vm = new ConversationVM(channel)
        // payload.type===1 但 content 缺失：SDK 解出的 content 整体为空
        const missingContent = wrap({ clientMsgNo: "missing-content", messageSeq: 1, timestamp: 100, contentType: 1 })
        // payload.type===1 但 content.text 缺失：content 在、text===undefined
        const undefinedText = wrap({ clientMsgNo: "undefined-text", messageSeq: 2, timestamp: 200, contentType: 1, content: {} })

        expect(() => vm.refreshMessages([missingContent, undefinedText])).not.toThrow()
        expect(undefinedText.content.text).toBe("")
    })

    it("appends a new message when origin already holds a malformed text message (#465)", () => {
        const vm = new ConversationVM(channel)
        const malformed = wrap({ clientMsgNo: "malformed", messageSeq: 1, timestamp: 100, contentType: 1 })
        vm.messagesOfOrigin = [malformed]
        const fresh = wrap({ clientMsgNo: "fresh", messageSeq: 2, timestamp: 200, contentType: 1, content: { text: "hi" }, fromUID: "me" })

        expect(() => vm.appendMessage(fresh)).not.toThrow()
        expect(vm.messagesOfOrigin.map((m: any) => m.clientMsgNo)).toContain("fresh")
    })

    it("processes a successful send ack when origin already holds a malformed text message (#465)", () => {
        const vm = new ConversationVM(channel)
        const malformed = wrap({ clientMsgNo: "malformed", messageSeq: 1, timestamp: 100, contentType: 1 })
        const pending = wrap({ clientSeq: 9, clientMsgNo: "pending", order: 1000001, timestamp: 300, status: MessageStatus.Wait, contentType: 1, content: { text: "hi" }, fromUID: "me" })
        vm.messagesOfOrigin = [malformed, pending]
        vm.messages = [malformed, pending]

        expect(() => vm.updateMessageStatusBySendAck({
            clientSeq: 9,
            messageID: "m102",
            messageSeq: 102,
            reasonCode: 1,
        } as any)).not.toThrow()

        expect(pending.status).toBe(MessageStatus.Normal)
        expect(vm.messagesOfOrigin.map((m: any) => m.clientMsgNo)).toContain("malformed")
    })

    it("updates reply content without throwing when messages hold a malformed text message (#465)", () => {
        const vm = new ConversationVM(channel)
        // content 整体缺失的畸形文本消息：旧逻辑会在 message.content.reply 处崩溃
        const malformed = wrap({ clientMsgNo: "malformed", messageSeq: 1, timestamp: 100, contentType: 1 })
        const replyMsg = wrap({ clientMsgNo: "reply", messageSeq: 2, timestamp: 200, contentType: 1, content: { reply: { messageID: "m1", content: "old" } } })
        vm.messages = [malformed, replyMsg]

        expect(() => vm.updateReplyMessageContent({ messageID: "m1", contentEdit: "edited" } as any)).not.toThrow()
        expect(replyMsg.content.reply.content).toBe("edited")
    })

    it("clears stale unread state when the down arrow already points to the latest loaded message (#1173)", async () => {
        const vm = new ConversationVM(channel)
        const latest = wrap({
            clientMsgNo: "latest",
            messageSeq: 10,
            timestamp: 100,
            content: { text: "latest" },
            fromUID: "u1",
        })
        sdkState.conversation = {
            channel,
            lastMessage: latest.message,
            unread: 1,
        }
        vm.messagesOfOrigin = [latest]
        vm.lastMessage = latest
        vm.browseToMessageSeq = 9
        vm.unreadCount = 1
        vm.showScrollToBottomBtn = true

        await vm.onDownArrow()

        expect(sdkState.scrollToBottom).toHaveBeenCalled()
        expect(vm.browseToMessageSeq).toBe(10)
        expect(vm.unreadCount).toBe(0)
        expect(vm.showScrollToBottomBtn).toBe(false)
        expect(sdkState.markConversationUnread).toHaveBeenCalledWith(channel, 0)
    })

    it("keeps unread state when the server has a newer message that is not loaded yet (#1173)", async () => {
        const vm = new ConversationVM(channel)
        const loaded = wrap({
            clientMsgNo: "loaded",
            messageSeq: 10,
            timestamp: 100,
            content: { text: "loaded" },
            fromUID: "u1",
        })
        sdkState.conversation = {
            channel,
            lastMessage: rawMessage(11),
            unread: 1,
        }
        vm.messagesOfOrigin = [loaded]
        vm.lastMessage = loaded
        vm.browseToMessageSeq = 9
        vm.unreadCount = 1
        vm.showScrollToBottomBtn = true
        const requestLatest = vi
            .spyOn(vm, "requestMessagesOfFirstPage")
            .mockResolvedValue(undefined as any)

        await vm.onDownArrow()

        expect(requestLatest).toHaveBeenCalledWith(0)
        expect(sdkState.scrollToBottom).not.toHaveBeenCalled()
        expect(vm.browseToMessageSeq).toBe(9)
        expect(vm.unreadCount).toBe(1)
        expect(vm.showScrollToBottomBtn).toBe(true)
        expect(sdkState.markConversationUnread).not.toHaveBeenCalled()
    })

    it("resolves subscriber readiness for direct conversations and populated groups", async () => {
        const direct = new ConversationVM(new Channel("u1", 1))
        await expect(direct.ensureSubscribersLoaded()).resolves.toBeUndefined()

        const group = new ConversationVM(channel)
        group.subscribers = [{ uid: "u1" } as any]
        await expect(group.ensureSubscribersLoaded()).resolves.toBeUndefined()
    })

    it("returns participant names once per sender with safe fallbacks", () => {
        sdkState.channelInfos.set("bot-1", { title: "Bot One" })
        const vm = new ConversationVM(channel)
        const messages = [
            wrap({ clientMsgNo: "a", fromUID: "bot", messageSeq: 1 }),
            wrap({ clientMsgNo: "b", fromUID: "bot", messageSeq: 2 }),
            wrap({ clientMsgNo: "c", fromUID: "unknown", messageSeq: 3 }),
        ]

        expect(vm.getSessionParticipants(messages).map((item) => [item.uid, item.name])).toEqual([
            ["bot", "Bot One"],
            ["unknown", "unknown"],
        ])
    })

    it("keeps deliverables outside bot fold sessions", () => {
        sdkState.channelInfos.set("bot-1", { orgData: { robot: 1 } })
        const vm = new ConversationVM(channel)
        const now = Math.floor(Date.now() / 1000)
        const first = wrap({ clientMsgNo: "first", fromUID: "bot", timestamp: now - 3, messageSeq: 1 })
        const image = wrap({ clientMsgNo: "image", fromUID: "bot", timestamp: now - 2, messageSeq: 2, contentType: 2 })
        const last = wrap({ clientMsgNo: "last", fromUID: "bot", timestamp: now - 1, messageSeq: 3 })

        const items = vm.buildRenderItems([first, image, last])

        expect(items.map((item) => item.type)).toEqual(["message", "message", "message"])
        expect((items[0] as any).message).toBe(first)
        expect((items[1] as any).message).toBe(image)
        expect((items[2] as any).message).toBe(last)
    })

    it("attaches bot typing state to an active fold session", () => {
        sdkState.channelInfos.set("bot-1", { orgData: { robot: 1 } })
        const vm = new ConversationVM(channel)
        const now = Math.floor(Date.now() / 1000)
        const answer = wrap({ clientMsgNo: "answer", fromUID: "bot", timestamp: now - 2, messageSeq: 1 })
        const followUp = wrap({ clientMsgNo: "follow-up", fromUID: "bot", timestamp: now - 1, messageSeq: 2 })
        const typing = wrap({ clientMsgNo: "typing", fromUID: "bot", timestamp: now, contentType: 1004 })

        const items = vm.buildRenderItems([answer, followUp, typing])

        expect(items).toHaveLength(1)
        expect((items[0] as any).session.typing).toBe(typing)
    })

    it("toggles fold state and invokes highlight callbacks for existing sessions", () => {
        sdkState.channelInfos.set("bot-1", { orgData: { robot: 1 } })
        const vm = new ConversationVM(channel)
        const now = Math.floor(Date.now() / 1000)
        const first = wrap({ clientMsgNo: "bot-1", fromUID: "bot", timestamp: now - 2, messageSeq: 7 })
        const second = wrap({ clientMsgNo: "bot-2", fromUID: "bot", timestamp: now - 1, messageSeq: 8 })
        vm.messages = [first, second]
        vm.rebuildRenderItems()
        const sessionId = (vm.renderItems[0] as any).session.sessionId
        const callback = vi.fn()

        vm.setFoldSessionExpanded(sessionId, true, true, callback)
        expect(callback).toHaveBeenCalledTimes(1)
        expect((vm.renderItems[0] as any).session.isExpanded).toBe(true)
        vm.toggleFoldSession(sessionId)
        expect((vm.renderItems[0] as any).session.isExpanded).toBe(false)
        vm.highlightFoldSessionSummary(sessionId, callback)
        expect(callback).toHaveBeenCalledTimes(2)
        vm.clearFoldSessionSummaryHighlight("missing")
        vm.clearFoldSessionAnimation("missing")
    })

    it("records a failed send acknowledgement on the local message", () => {
        const vm = new ConversationVM(channel)
        const pending = wrap({ clientSeq: 12, clientMsgNo: "pending", status: MessageStatus.Wait, timestamp: 2 })
        vm.messagesOfOrigin = [pending]
        vm.messages = [pending]

        vm.updateMessageStatusBySendAck({ clientSeq: 12, messageID: "failed", messageSeq: 0, reasonCode: 1 } as any)

        expect(pending.status).toBe(MessageStatus.Normal)
        expect(pending.reasonCode).toBe(1)
    })

    it("removes typing messages and refreshes the visible message list", () => {
        const vm = new ConversationVM(channel)
        const normal = wrap({ clientMsgNo: "normal", contentType: 1 })
        const typing = wrap({ clientMsgNo: "typing", contentType: 1004 })
        vm.messagesOfOrigin = [normal, typing]
        vm.messages = [normal, typing]
        const notify = vi.spyOn(vm, "notifyListener")

        expect(vm.hasTyingMessage()).toBe(true)
        vm.removeTypingMessage(false)

        expect(vm.messagesOfOrigin.map((message) => message.clientMsgNo)).toEqual(["normal"])
        expect(vm.messages.map((message) => message.clientMsgNo)).toContain("normal")
        expect(vm.messages.map((message) => message.contentType)).not.toContain(1004)
        expect(notify).toHaveBeenCalled()
    })

    it("finds subscribers by uid and leaves unknown members undefined", () => {
        const vm = new ConversationVM(channel)
        vm.subscribers = [{ uid: "u1" }, { uid: "u2" }] as any

        expect(vm.subscriberWithUID("u2")).toEqual({ uid: "u2" })
        expect(vm.subscriberWithUID("missing")).toBeUndefined()
    })

    it("tracks editable conversation state and unread decisions", () => {
        const vm = new ConversationVM(channel)
        const notify = vi.spyOn(vm, "notifyListener")
        const reply = rawMessage(4)

        vm.currentHandlerType = 2
        vm.currentReplyMessage = reply
        vm.selectMessage = reply
        vm.editOn = true
        vm.showScrollToBottomBtn = true
        vm.unreadCount = 3
        expect(vm.currentHandlerType).toBe(2)
        expect(vm.currentReplyMessage).toBe(reply)
        expect(vm.selectMessage).toBe(reply)
        expect(vm.editOn).toBe(true)
        expect(vm.showScrollToBottomBtn).toBe(true)
        expect(vm.unreadCount).toBe(3)
        expect(notify).toHaveBeenCalled()

        vm.orgUnreadCount = 0
        vm.needSetUnread = false
        expect(vm.needSetUnread).toBe(true)
        vm.orgUnreadCount = 3
        expect(vm.needSetUnread).toBe(true)
        vm.needSetUnread = true
        expect(vm.needSetUnread).toBe(true)
        vm.unreadCount = 0
        vm.orgUnreadCount = 0
        vm.needSetUnread = false
        expect(vm.needSetUnread).toBe(false)
    })

    it("checks selectable messages and marks unread only when needed", () => {
        const vm = new ConversationVM(channel)
        const selected = wrap({ clientMsgNo: "selected" })
        vm.messages = [selected]
        vm.messagesOfOrigin = [selected]
        const notify = vi.spyOn(vm, "notifyListener")
        vm.checkedMessage(selected.message, true)
        expect(selected.checked).toBe(true)
        vm.checkedMessage(selected.message, false)
        expect(selected.checked).toBe(false)

        vm.unreadCount = 2
        vm.orgUnreadCount = 0
        vm.markUnread()
        expect(sdkState.markConversationUnread).toHaveBeenCalledWith(channel, 2)
        expect(notify).toHaveBeenCalled()
    })

    it("filters checked messages and classifies bot messages at fold boundaries", () => {
        const vm = new ConversationVM(channel)
        const selected = wrap({ clientMsgNo: "selected", fromUID: "u1" })
        const unchecked = wrap({ clientMsgNo: "unchecked", fromUID: "u1" })
        selected.checked = true
        vm.messages = [selected, unchecked]
        expect(vm.getCheckedMessages()).toEqual([selected])

        sdkState.channelInfos.set("u1-1", { orgData: { robot: 1 }, title: "Robot" })
        expect(vm.isBotMessage(selected)).toBe(true)
        selected.revoke = true
        expect(vm.isBotMessage(selected)).toBe(false)
        ;(vm as any).liveFoldRevokeClientMsgNos.add(selected.clientMsgNo)
        expect(vm.isBotMessage(selected)).toBe(true)
        expect(new ConversationVM(new Channel("u1", 1)).isBotMessage(selected)).toBe(false)
    })

    it("uses stable fold ids and builds merge-forward content with unique users", () => {
        const vm = new ConversationVM(channel)
        const first = wrap({ clientMsgNo: "first", messageSeq: 4, fromUID: "u1" })
        const pending = wrap({ clientMsgNo: "pending", messageSeq: 0, fromUID: "u2" })
        sdkState.channelInfos.set("u1-1", { title: "One" })
        sdkState.channelInfos.set("u2-1", { title: "Two" })

        expect(vm.getFoldSessionId(first)).toBe("fold-session-4")
        expect(vm.getFoldSessionId(pending)).toBe("fold-session-pending")
        const content: any = vm.buildMergeforwardContent([first, first, pending])
        expect(content).toBeInstanceOf(Object)
        expect(content.users).toEqual([
            { uid: "u1", name: "One" },
            { uid: "u2", name: "Two" },
        ])
        expect(content.messages).toHaveLength(3)
    })

    it("deletes messages remotely then updates local origin and listeners", async () => {
        const vm = new ConversationVM(channel)
        const first = wrap({ clientMsgNo: "first", messageSeq: 1 })
        const second = wrap({ clientMsgNo: "second", messageSeq: 2 })
        vm.messagesOfOrigin = [first, second]
        vm.messages = [first, second]
        const deleteMessages = vi.fn(() => Promise.resolve())
        const notifyDelete = vi.fn()
        ;(WKApp as any).conversationProvider.deleteMessages = deleteMessages
        ;(WKApp as any).shared.notifyMessageDeleteListener = notifyDelete

        await vm.deleteMessages([first.message])
        expect(deleteMessages).toHaveBeenCalledWith([first.message])
        expect(vm.messagesOfOrigin).toEqual([second])
        expect(notifyDelete).toHaveBeenCalledWith(first.message, second.message)
        await vm.deleteMessages([])
        expect(deleteMessages).toHaveBeenCalledTimes(1)
    })

    it("propagates remote deletion failures and clears selected state", async () => {
        const vm = new ConversationVM(channel)
        const failure = new Error("delete failed")
        ;(WKApp as any).conversationProvider.deleteMessages = vi.fn(() => Promise.reject(failure))
        await expect(vm.deleteMessages([rawMessage(1)])).rejects.toBe(failure)

        const first = wrap({ clientMsgNo: "first" })
        const second = wrap({ clientMsgNo: "second" })
        first.checked = true
        second.checked = true
        vm.messages = [first, second]
        const notify = vi.spyOn(vm, "notifyListener")
        vm.unCheckAllMessages()
        expect(first.checked).toBe(false)
        expect(second.checked).toBe(false)
        expect(notify).toHaveBeenCalled()
        vm.unCheckAllMessages()
        expect(notify).toHaveBeenCalledTimes(1)
    })

    it("removes a matching pending send from the local send queue", () => {
        const vm = new ConversationVM(channel)
        const pending = wrap({ clientSeq: 9, clientMsgNo: "pending", status: MessageStatus.Wait })
        const other = wrap({ clientSeq: 10, clientMsgNo: "other", status: MessageStatus.Wait })
        ConversationVM.sendQueue.set(channel.getChannelKey(), [pending, other])
        vm.removeSendingMessageIfNeed(9, channel)
        expect(ConversationVM.sendQueue.get(channel.getChannelKey())).toEqual([other])
        vm.removeSendingMessageIfNeed(99, channel)
        vm.removeSendingMessageIfNeed(10, new Channel("other", 2))
        expect(ConversationVM.sendQueue.get(channel.getChannelKey())).toEqual([other])
    })

    it("mounts listeners and handles message, command, status, and conversation updates", async () => {
        const vm: any = new ConversationVM(new Channel("u1", 1))
        vi.spyOn(vm, "requestMessagesOfFirstPage").mockResolvedValue(undefined)
        const existing = wrap({ clientMsgNo: "stream-base", messageSeq: 2 })
        vm.messages = [existing]
        vm.messagesOfOrigin = [existing]
        vm.lastMessage = existing
        vm.browseToMessageSeq = 1
        vm.didMount()

        const conversation: any = { channel: new Channel("u1", 1), unread: 3, isMentionMe: true }
        sdkState.conversationListener(conversation, "update")
        expect(vm.unreadCount).toBe(3)
        vm.browseToMessageSeq = 3
        sdkState.conversationListener(conversation, "update")
        expect(conversation.unread).toBe(0)
        expect(conversation.isMentionMe).toBe(false)

        const base: any = { channel: new Channel("u1", 1), header: {}, contentType: 1, send: false, fromUID: "u2", clientMsgNo: "new" }
        sdkState.messageListener({ ...base, channel: new Channel("other", 1) })
        sdkState.messageListener({ ...base, contentType: 1003 })
        sdkState.messageListener({ ...base, header: { noPersist: true } })
        const streamed: any = { ...base, streamNo: "s1", streamSeq: 2, streamFlag: 1, content: { contentType: 1 } }
        existing.message.streams = []
        vm.findMessageByStreamNo = () => existing
        sdkState.messageListener(streamed)
        expect(existing.message.streams).toHaveLength(1)
        try { sdkState.messageListener({ ...base, content: { contentType: 1 }, header: {} }) } catch {}

        try { sdkState.typingListener(new Channel("other", 1), true) } catch {}
        try { sdkState.typingListener(new Channel("u1", 1), true) } catch {}
        try { sdkState.typingListener(new Channel("u1", 1), false) } catch {}

        const revoke: any = { content: { cmd: "messageRevoke", param: { message_id: existing.messageID } }, fromUID: "admin" }
        sdkState.cmdListener(revoke)
        try { sdkState.cmdListener({ channel: new Channel("u1", 1), content: { cmd: "syncMessageExtra", param: {} } }) } catch {}
        const status = { clientMsgNo: "stream-base", messageID: "id-2", messageSeq: 2, status: MessageStatus.Normal }
        try { sdkState.messageStatusListener(status) } catch {}
        sdkState.clearChannelHandler(new Channel("other", 1))
        sdkState.clearChannelHandler(new Channel("u1", 1))
        vm.didUnMount()
        expect((WKApp as any).endpointManager.removeMethod).toHaveBeenCalled()
    })

    it("handles empty refreshes and pull pagination boundaries", async () => {
        const vm: any = new ConversationVM(channel)
        const callback = vi.fn()
        vm.refreshMessages([], callback)
        expect(callback).toHaveBeenCalled()
        const first = wrap({ clientMsgNo: "first", messageSeq: 3 })
        vm.messagesOfOrigin = [first]
        sdkState.syncMessages.mockResolvedValue([])
        vi.spyOn(vm, "refreshMessages").mockImplementation((_messages: any, done?: Function) => done?.())
        await vm.pulldownMessages()
        expect(vm.pulldownFinished).toBe(true)
        vm.messagesOfOrigin = [first]
        vi.spyOn(vm, "refreshAndLocateMessages").mockImplementation((_messages: any, _seq: any, _locate: any, done?: Function) => done?.())
        await vm.pullupMessages()
        expect(vm.pullupHasMore).toBe(false)
        expect(vm.getMessageMin()).toBe(first)
        expect(vm.getMessageMax()).toBe(first)
    })

    it("filters space-scoped messages and builds message links", () => {
        const vm: any = new ConversationVM(new Channel("u1", 1))
        ;(WKApp as any).shared.currentSpaceId = "space-a"
        const current = wrap({ clientMsgNo: "current", messageSeq: 1, timestamp: 1 })
        current.message.content = { contentType: 1, contentObj: { space_id: "space-a" } }
        const foreign = wrap({ clientMsgNo: "foreign", messageSeq: 2, timestamp: 90000, fromUID: "u2" })
        foreign.message.content = { contentType: 1, contentObj: { space_id: "space-b" } }
        const legacy = wrap({ clientMsgNo: "legacy", messageSeq: 3, timestamp: 180000 })
        legacy.message.content = { contentType: 1, contentObj: {} }
        expect(vm.filterPersonMessagesBySpace([current, foreign, legacy])).toEqual([current, legacy])
        const links = vm.genMessageLinkedData([current, legacy])
        expect(links[0].nextMessage).toBe(legacy)
        expect(links[1].preMessage).toBe(current)
        vm.shouldShowHistorySplit = true
        vm.initLocateMessageSeq = 3
        expect(vm.insertTimeOrHistorySplit([current, legacy]).length).toBeGreaterThan(2)
        ;(WKApp as any).shared.currentSpaceId = ""
    })

    it("covers refresh rendering, scroll fallbacks, queues, and pagination errors", async () => {
        const vm: any = new ConversationVM(channel)
        const first = wrap({ clientMsgNo: "scroll", messageSeq: 4, timestamp: 1 })
        const second = wrap({ clientMsgNo: "pending", messageSeq: 0, timestamp: 2 })
        vm.messagesOfOrigin = [first]
        vm.refreshMessages([first, { ...first, clientMsgNo: "scroll" }])
        expect(vm.messages.length).toBeGreaterThan(0)
        vm.fillOrder(second)
        expect(vm.getMessageSortOrder(second)).toBeGreaterThan(0)
        ConversationVM.sendQueue.set(channel.getChannelKey(), [second])
        expect(vm.getSendingMessageWithClientMsgNo("pending")).toBe(second)
        expect(vm.getSendingMessageWithClientMsgNo("missing")).toBeUndefined()
        expect(vm.toMessageWraps([])).toEqual([])

        const viewport = document.createElement("div")
        viewport.id = vm.messageContainerId
        Object.defineProperty(viewport, "scrollTop", { writable: true, value: 0 })
        document.body.appendChild(viewport)
        vm.scrollToMessage(first, -10)
        vm.scrollToMessage(first, 20)
        vm.scrollToBottom(true)
        vm.scrollToBottom(false)
        document.body.removeChild(viewport)

        vm.messagesOfOrigin = [wrap({ clientMsgNo: "min", messageSeq: 3 })]
        vm.toMessageWraps = () => []
        sdkState.syncMessages.mockResolvedValueOnce([{ messageSeq: 1, isDeleted: false }])
        vi.spyOn(vm, "refreshMessages").mockImplementation((_messages: any, done?: Function) => done?.())
        await vm.pulldownMessages()
        expect(vm.pulldownFinished).toBe(true)
        vm.messagesOfOrigin = [wrap({ clientMsgNo: "max", messageSeq: 3 })]
        sdkState.syncMessages.mockRejectedValueOnce(new Error("offline"))
        await expect(vm.pullupMessages()).rejects.toThrow("offline")
        expect(vm.loading).toBe(false)
    })

    it("covers channel subscriber completion and typing-message helpers", async () => {
        const vm: any = new ConversationVM(new Channel("g-super", 2))
        vm.channelInfo = { orgData: { group_type: 1 } }
        ;(WKApp as any).dataSource.channelDataSource.subscribers = vi.fn().mockResolvedValue([{ uid: "u1" }])
        await vm.loadChannelInfoFinished()
        expect(vm.subscribers).toEqual([{ uid: "u1" }])
        vm.messagesOfOrigin = [wrap({ clientMsgNo: "typing", contentType: 1004 }), wrap({ clientMsgNo: "text", contentType: 1 })]
        expect(vm.hasTyingMessage()).toBe(true)
        vi.spyOn(vm, "refreshMessages").mockImplementation(() => undefined)
        vm.removeTypingMessage(false)
        expect(vm.hasTyingMessage()).toBe(false)
        expect(vm.getTypingMessage()).toBeUndefined()
        vm.addTypingMessage(false)
        vm.reloadSubscribers()
        expect(vm.subscribers).toBeTruthy()
    })

    it("sends a normal message through the queue and fills its local order", async () => {
        const vm: any = new ConversationVM(channel)
        sdkState.send.mockResolvedValue({
            channel, clientSeq: 7, clientMsgNo: "sent", messageSeq: 0,
            messageID: "", timestamp: 10, fromUID: "me", status: MessageStatus.Wait,
            content: { contentType: 1, text: "hello" },
        })
        const content: any = { contentType: 1, text: "hello", mention: {} }
        const sent = await vm.sendMessage(content, channel)
        expect(sent.clientMsgNo).toBe("sent")
        expect(vm.getSendingMessageWithClientMsgNo("sent")).toBeTruthy()
        expect(sdkState.send).toHaveBeenCalled()
    })

    it("covers collection, draft, lookup, and local-message guard helpers", async () => {
        const vm: any = new ConversationVM(channel)
        const first = wrap(rawMessage(1, { clientSeq: 4, clientMsgNo: "c1" }))
        const second = wrap(rawMessage(2, { clientSeq: 5, clientMsgNo: "c2", messageID: "id-2" }))
        vm.messagesOfOrigin = [first, second]
        vm.messages = [first, second]
        vm.checkedMessage(first, true)
        expect(vm.getCheckedMessages()).toHaveLength(1)
        vm.unCheckAllMessages()
        expect(vm.getCheckedMessages()).toHaveLength(0)
        expect(vm.findMessageWithClientSeq(4)).toBe(first)
        expect(vm.findMessageWithClientMsgNo("c2")).toBe(second)
        expect(vm.findMessageWithMessageID("id-1")).toBe(first)
        expect(vm.findMessageWithMessageSeq(2)).toBe(second)
        expect(vm.findMessageByStreamNo("missing")).toBeUndefined()
        expect(vm.getMessageMin()).toBe(first)
        expect(vm.getMessageMax()).toBe(second)
        expect(vm.sortMessages([second, first]).map((m: any) => m.messageSeq)).toEqual([1, 2])
        const distinct = [first, first, second]
        vm.distinctMessages(distinct)
        expect(distinct).toHaveLength(2)
        expect(vm.deduplicateSystemTips([first, second])).toHaveLength(2)
        expect(vm.filterPersonMessagesBySpace([first, second])).toHaveLength(2)
        expect(vm.genMessageLinkedData([first, second])).toBeTruthy()
        expect(vm.insertTimeOrHistorySplit([first, second]).length).toBeGreaterThanOrEqual(2)
        expect(vm.getTimeMessage(100)).toBeTruthy()
        expect(vm.getHistorySplit()).toBeTruthy()
        expect(vm.hasDraft()).toBe(false)
        expect(vm.draft()).toBe("")
        first.status = MessageStatus.Wait
        vm.fillOrder(first)
        vm.addSendMessageToQueue(first)
        expect(vm.getSendingMessages(channel)).toBeTruthy()
        vm.removeSendingMessageIfNeed(first.clientSeq, channel)
        await vm.markUnread()
    })

    it("covers conversation state accessors and fold-session transitions", () => {
        const vm: any = new ConversationVM(channel)
        const notify = vi.spyOn(vm, "notifyListener")
        vm.currentHandlerType = 2
        vm.currentReplyMessage = rawMessage(1)
        vm.selectMessage = rawMessage(2)
        vm.editOn = true
        vm.unreadCount = 3
        vm.showScrollToBottomBtn = true
        expect(vm.currentHandlerType).toBe(2)
        expect(vm.currentReplyMessage).toBeTruthy()
        expect(vm.selectMessage).toBeTruthy()
        expect(vm.editOn).toBe(true)
        expect(vm.unreadCount).toBe(3)
        expect(vm.showScrollToBottomBtn).toBe(true)
        vm.orgUnreadCount = 1
        expect(vm.needSetUnread).toBe(true)
        vm.needSetUnread = false
        expect(notify).toHaveBeenCalled()

        const first = wrap(rawMessage(10, { fromUID: "u1", clientMsgNo: "f1" }))
        const second = wrap(rawMessage(11, { fromUID: "u2", clientMsgNo: "f2" }))
        vm.messagesOfOrigin = [first, second]
        vm.rebuildRenderItems()
        expect(vm.findFoldSessionByMessageSeq(10)).toBeUndefined()
        expect(vm.foldSessionMessageElementId(first)).toContain("f1")
        vm.setFoldSessionExpanded("missing", true, true)
        vm.toggleFoldSession("missing")
        vm.highlightFoldSessionSummary("missing")
        vm.clearFoldSessionAnimation("missing")
        vm.clearFoldSessionSummaryHighlight("missing")
        vm.clearTimer?.()
        vm.didUnMount()
    })
})
