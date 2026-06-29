// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"

const sdkState = vi.hoisted(() => ({
    sendingQueues: new Map<number, unknown>(),
    channelInfos: new Map<string, any>(),
    syncMessages: vi.fn(),
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
        mittBus: { on: () => {}, off: () => {} },
        conversationProvider: {
            markConversationUnread: () => Promise.resolve(),
            syncMessages: sdkState.syncMessages,
        },
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
vi.mock("../../../Service/ProhibitwordsService", () => ({ ProhibitwordsService: { shared: { filter: (text: unknown) => (typeof text === "string" && text.length > 0 ? text : ""), getProhibitwords: () => [] } } }))
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
        document.body.innerHTML = ""
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
})
