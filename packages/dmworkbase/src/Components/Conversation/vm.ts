import { Channel, ChannelTypeGroup, ChannelTypePerson, ConversationAction, WKSDK, Message, MessageContent, MessageStatus, Subscriber, Conversation, MessageExtra, CMDContent, PullMode, MessageContentType, MessageText, ChannelInfo, ChannelInfoListener, ConversationListener, ConnectStatus, ConnectStatusListener } from "wukongimjssdk";
import WKApp from "../../App";
import { SyncMessageOptions } from "../../Service/DataSource/DataProvider";
import { MessageWrap } from "../../Service/Model";
import { ProviderListener } from "../../Service/Provider";
import { isConversationDisbanded } from "../../Utils/groupDisband";
import { animateScroll, scroller } from 'react-scroll';
import { EndpointID, MessageContentTypeConst, OrderFactor, ChannelTypeCommunityTopic } from "../../Service/Const";
import moment from 'moment'
import { TimeContent } from "../../Messages/Time";
import { HistorySplitContent } from "../../Messages/HistorySplit";
import { MessageListener, MessageStatusListener } from "wukongimjssdk";
import { SendackPacket, Setting } from "wukongimjssdk";
import MergeforwardContent from "../../Messages/Mergeforward";
import {
    InteractiveCardContent,
    InteractiveCardForwardBlockedError,
    isInteractiveCardForwardable,
} from "../../Messages/InteractiveCard/InteractiveCardContent";
import { TypingListener, TypingManager } from "../../Service/TypingManager";
import { ProhibitwordsService } from "../../Service/ProhibitwordsService";
import { SYSTEM_BOTS } from "../../Service/SpaceService";
import { SuperGroup } from "../../Utils/const";
import { SystemContent } from "wukongimjssdk";
import { getFoldSessionExpandedMessages } from "./foldSessionSummary";
import { getPulldownRestoredScrollTop, getRestoredAnchorScrollTop } from "./historyScroll";
import { applyMsgLevelExternalFieldsWithFallback } from "../../Service/Convert";
import { wrapSendContentForInjection } from "../../Utils/sendContentProxy";
import { isMessageSelectable } from "../../Service/messageSelection";
import {
    addImConnectStatusListener,
    handleImReconnectRefresh,
    removeImConnectStatusListener,
} from "../../im-runtime/connectStatus";

export interface FoldSessionParticipant {
    uid: string
    name: string
    channel: Channel
}

interface FoldSessionUIState {
    expanded?: boolean
    userToggled?: boolean
    flash?: boolean
    appearing?: boolean
    highlightSummary?: boolean
}

export interface FoldSessionViewModel {
    sessionId: string
    anchorId: string
    participants: FoldSessionParticipant[]
    messages: MessageWrap[]
    expandedMessages: MessageWrap[]
    lastMessage: MessageWrap
    count: number
    isActive: boolean
    isExpanded: boolean
    userToggled: boolean
    shouldMergeFlash: boolean
    shouldAppear: boolean
    highlightSummary: boolean
    showSummary: boolean
    typing?: MessageWrap
}

export interface ConversationRenderMessageItem {
    type: "message"
    message: MessageWrap
}

export interface ConversationRenderFoldSessionItem {
    type: "foldSession"
    session: FoldSessionViewModel
}

export type ConversationRenderItem = ConversationRenderMessageItem | ConversationRenderFoldSessionItem

const PendingMessageOrderBase = Number.MAX_SAFE_INTEGER / 2

export default class ConversationVM extends ProviderListener {

    private static nextMessageContainerSeq = 0

    loading: boolean = false // 消息是否加载中
    channel: Channel
    channelInfo?: ChannelInfo // 当前会话的频道详情
    messages: MessageWrap[] = [] // 消息集合 
    renderItems: ConversationRenderItem[] = [] // UI 渲染集合（消息项 + 折叠 session）
    currentConversation?: Conversation // 当前最近会话
    messagesOfOrigin: MessageWrap[] = [] // 原始消息集合（不包含时间消息等本地消息）
    browseToMessageSeq: number = 0 //  已经预览到的最新的messageSeq
    initLocateMessageSeq?: number = 0 // 初始定位的消息messageSeq 0为不定位
    shouldShowHistorySplit: boolean = false // 是否应该显示历史消息分割线
    private _editOn: boolean = false // 是否开启编辑模式
    orgUnreadCount: number = 0 // 原未读数量
    private _unreadCount: number = 0 // 当前未读消息数量

    pullupHasMore: boolean = false // 上拉是否有更多
    pulldownFinished: boolean = false // 下拉完成
    pendingMessages: MessageWrap[] = [] // 缓冲区：pullupHasMore 期间收到的实时消息
    messageContainerId = `viewport-${ConversationVM.nextMessageContainerSeq++}` // 消息容器的ID
    static sendQueue: Map<string, Array<MessageWrap>> = new Map() // 发送队列
    static foldSessionPreview: Map<string, { participants: string[], count: number }> = new Map() // 会话列表折叠预览缓存
    private _needSetUnread: boolean = false // 是否需要设置未读数量

    typingListener!: TypingListener // 输入中监听
    messageListener!: MessageListener // 消息监听
    connectStatusListener!: ConnectStatusListener // 连接状态监听（重连补刷当前会话）
    private lastReconnectRefreshAt: number = 0 // 重连补刷（离线消息）去抖时间戳
    private lastSubscriberResyncAt: number = 0 // 成员重同步去抖时间戳（独立于消息补刷，避免前台成员刷压制重连消息补拉，octo-web#568 review）
    cmdListener!: MessageListener // cmd消息监听
    messageStatusListener!: MessageStatusListener // 消息状态监听
    conversationListener!: ConversationListener // 会话监听
    private channelInfoListener!: ChannelInfoListener // channelInfo 变化监听（bot 身份识别）
    subscriberChangeListener!: (channel: Channel) => void // 订阅者变化监听
    lastMessage?: MessageWrap // 此会话的最后一条最新的消息
    lastLocalMessageElement?: HTMLElement | null // 最后一条消息的dom元素
    private _showScrollToBottomBtn?: boolean = false // 是否显示底部按钮
    subscribers: Subscriber[] = []
    private foldSessionState: Map<string, FoldSessionUIState> = new Map()
    private messageSeqToFoldSessionId: Map<number, string> = new Map()
    private liveFoldRevokeClientMsgNos: Set<string> = new Set()
    afterFoldSessionClientMsgNos: Set<string> = new Set() // 紧跟在折叠卡片后的消息，需强制独立显示
    private foldSessionActiveTimer: ReturnType<typeof setTimeout> | null = null // 协作态超时自动结束

    fileDragEnter?: boolean // 文件拖拽上传（拖进来了）
    fileDragLeave?: boolean // 文件拖拽上传（拖离开了）

    // ── Attachment Queue (#143 / #144) ──────────────────────────────────────
    pendingAttachments: File[] = [] // 待发送附件队列

    static readonly MAX_ATTACHMENTS = 20
    static readonly MAX_TOTAL_SIZE = 100 * 1024 * 1024 // 100MB

    private _selectMessage?: Message // 右键选中的消息

    selectUID?: string // 点击头像的用户uid

    private _currentReplyMessage?: Message // 当前回复的消息
    private _currentHandlerType: number = 0 // 当前处理类型
    onFirstMessagesLoaded?: Function // 第一屏消息已加载完成

    private _subscribersReadyResolve?: () => void
    private _subscribersResolved: boolean = false
    subscribersReady: Promise<void>

    constructor(channel: Channel, initLocateMessageSeq?: number) {
        super()
        this.channel = channel
        if (initLocateMessageSeq == 0) {
            this.initLocateMessageSeq = undefined
        } else {
            this.initLocateMessageSeq = initLocateMessageSeq
        }
        this.subscribersReady = new Promise<void>(resolve => {
            this._subscribersReadyResolve = resolve
        })
        if (channel.channelType === ChannelTypePerson) {
            this._resolveSubscribersReady()
        }
    }

    private _resolveSubscribersReady() {
        if (this._subscribersResolved) return
        this._subscribersResolved = true
        this._subscribersReadyResolve?.()
    }

    async ensureSubscribersLoaded(timeoutMs: number = 3000): Promise<void> {
        if (this.subscribers.length > 0) {
            this._resolveSubscribersReady()
            return
        }
        if (this.channel.channelType === ChannelTypePerson) {
            return
        }
        await Promise.race([
            this.subscribersReady,
            new Promise<void>(resolve => setTimeout(resolve, timeoutMs))
        ])
    }
    get currentHandlerType(): number {
        return this._currentHandlerType
    }
    set currentHandlerType(v: number) {
        this._currentHandlerType = v
        this.notifyListener()
    }
    get currentReplyMessage() {
        return this._currentReplyMessage
    }

    set currentReplyMessage(v: Message | undefined) {
        this._currentReplyMessage = v
        this.notifyListener()
    }

    get selectMessage(): Message | undefined {
        return this._selectMessage
    }

    set selectMessage(v: Message | undefined) {
        this._selectMessage = v
        this.notifyListener()
    }

    set unreadCount(v: number) {
        this._unreadCount = v
        this.notifyListener()
    }

    get unreadCount() {
        return this._unreadCount
    }

    get editOn(): boolean {
        return this._editOn
    }

    set editOn(v: boolean) {
        this._editOn = v
        this.notifyListener()
    }

    set showScrollToBottomBtn(v: boolean | undefined) {
        this._showScrollToBottomBtn = v
        this.notifyListener()
    }

    get showScrollToBottomBtn() {
        return this._showScrollToBottomBtn
    }

    set needSetUnread(v: boolean) {
        this._needSetUnread = v
    }
    get needSetUnread() {
        if (this._needSetUnread) {
            return true
        }
        if (this.orgUnreadCount > 0) {
            return true
        }
        if (this.orgUnreadCount != this.unreadCount) {
            return true
        }
        return false
    }

    // 标记为未读
    markUnread() {
        if (this.needSetUnread) {
            WKApp.conversationProvider.markConversationUnread(this.channel, this.unreadCount)
        }
    }

    // 选中消息
    checkedMessage(message: Message, checked: boolean): void {
        if (checked && !isMessageSelectable(message)) {
            return
        }
        let messageWrap = this.findMessageWithClientMsgNo(message.clientMsgNo)
        if (!messageWrap) {
            return
        }
        messageWrap.checked = checked
        this.notifyListener()
    }

    // 获取被选中的消息列表
    getCheckedMessages() {
        return this.messages.filter((m) => {
            return m.checked && isMessageSelectable(m)
        })
    }

    /** 当前 channel 是否支持 AI 消息折叠（群聊或子区） */
    private get supportsFolding(): boolean {
        return this.channel.channelType === ChannelTypeGroup
            || this.channel.channelType === ChannelTypeCommunityTopic
    }

    isBotMessage(message: MessageWrap): boolean {
        if (!this.supportsFolding) {
            return false
        }
        if (message.send) {
            return false
        }
        if (message.revoke && !this.liveFoldRevokeClientMsgNos.has(message.clientMsgNo)) {
            return false
        }
        if (message.contentType === MessageContentTypeConst.time
            || message.contentType === MessageContentTypeConst.historySplit
            || message.contentType === MessageContentTypeConst.typing) {
            return false
        }
        const channelInfo = WKSDK.shared().channelManager.getChannelInfo(new Channel(message.fromUID, ChannelTypePerson))
        return channelInfo?.orgData?.robot === 1
    }

    // 不可折叠的独立交付物：带附件的消息（图片/GIF/小视频/文件/富文本）
    // 以及互动卡片（interactiveCard=17）。
    // 这类消息是用户需要直接看到、直接操作的交付物，不应被折叠进 FoldSessionCard
    // ——尤其互动卡片带按钮/输入，一旦被折叠就无法交互。
    // 注意：语音（voice=4）可以折叠，故不在此列。
    private isUnfoldableDeliverable(message: MessageWrap): boolean {
        switch (message.contentType) {
            case MessageContentTypeConst.image:
            case MessageContentTypeConst.gif:
            case MessageContentTypeConst.smallVideo:
            case MessageContentTypeConst.file:
            case MessageContentTypeConst.richText:
            case MessageContentTypeConst.interactiveCard:
                return true
            default:
                return false
        }
    }

    getSessionParticipants(messages: MessageWrap[]): FoldSessionParticipant[] {
        const participants = new Array<FoldSessionParticipant>()
        const seenUIDs = new Set<string>()
        for (const message of messages) {
            if (seenUIDs.has(message.fromUID)) {
                continue
            }
            seenUIDs.add(message.fromUID)
            const channel = new Channel(message.fromUID, ChannelTypePerson)
            const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel)
            // 优先使用 message.from.title, 再用 channelInfo.title, 最后用 fromUID
            const name = message.from?.title || channelInfo?.title || message.fromUID
            participants.push({
                uid: message.fromUID,
                name: name,
                channel,
            })
        }
        return participants
    }

    getFoldSessionId(message: MessageWrap): string {
        if (message.messageSeq > 0) {
            return `fold-session-${message.messageSeq}`
        }
        return `fold-session-${message.clientMsgNo}`
    }

    buildRenderItems(messages: MessageWrap[], allowFoldAnimation: boolean = false): ConversationRenderItem[] {
        const renderItems = new Array<ConversationRenderItem>()
        const nextFoldSessionState = new Map<string, FoldSessionUIState>()
        const nextMessageSeqToFoldSessionId = new Map<number, string>()
        const typingMessages = new Array<MessageWrap>()
        const sourceMessages = new Array<MessageWrap>()

        for (const message of messages) {
            if (message.contentType === MessageContentTypeConst.typing) {
                typingMessages.push(message)
            } else {
                sourceMessages.push(message)
            }
        }

        let pendingSessionMessages = new Array<MessageWrap>()

        const flushPendingSession = (isActive: boolean) => {
            if (pendingSessionMessages.length === 0) {
                return
            }
            if (pendingSessionMessages.length >= 2) {
                const firstMessage = pendingSessionMessages[0]
                const sessionId = this.getFoldSessionId(firstMessage)
                const previousState = this.foldSessionState.get(sessionId)
                const lastMessage = pendingSessionMessages[pendingSessionMessages.length - 1]
                const shouldAnimate = allowFoldAnimation && isActive && pendingSessionMessages.length === 2 && !previousState
                const sessionState: FoldSessionUIState = {
                    expanded: previousState?.expanded || false,
                    userToggled: previousState?.userToggled || false,
                    flash: previousState?.flash || shouldAnimate,
                    appearing: previousState?.appearing || shouldAnimate,
                    highlightSummary: previousState?.highlightSummary || false,
                }

                nextFoldSessionState.set(sessionId, sessionState)
                for (const message of pendingSessionMessages) {
                    if (message.messageSeq > 0) {
                        nextMessageSeqToFoldSessionId.set(message.messageSeq, sessionId)
                    }
                }

                renderItems.push({
                    type: "foldSession",
                    session: {
                        sessionId,
                        anchorId: sessionId,
                        participants: this.getSessionParticipants(pendingSessionMessages),
                        messages: [...pendingSessionMessages],
                        expandedMessages: getFoldSessionExpandedMessages({ messages: pendingSessionMessages }),
                        lastMessage,
                        count: pendingSessionMessages.length,
                        isActive,
                        isExpanded: sessionState.expanded || false,
                        userToggled: sessionState.userToggled || false,
                        shouldMergeFlash: sessionState.flash || false,
                        shouldAppear: sessionState.appearing || false,
                        highlightSummary: sessionState.highlightSummary || false,
                        showSummary: !isActive || (sessionState.highlightSummary || false),
                    },
                })
            } else {
                for (const message of pendingSessionMessages) {
                    renderItems.push({ type: "message", message })
                }
            }
            pendingSessionMessages = []
        }

        for (const message of sourceMessages) {
            if (this.isBotMessage(message)) {
                // 带附件的 bot 消息 / 互动卡片作为折叠分组的边界：先 flush 当前分组，再独立渲染，
                // 保证图片/文件/卡片等交付物始终可见，无需展开折叠卡片。
                if (this.isUnfoldableDeliverable(message)) {
                    flushPendingSession(false)
                    renderItems.push({ type: "message", message })
                    continue
                }
                if (pendingSessionMessages.length > 0) {
                    const previousMessage = pendingSessionMessages[pendingSessionMessages.length - 1]
                    if (message.timestamp - previousMessage.timestamp < 120) {
                        pendingSessionMessages.push(message)
                        continue
                    }
                    flushPendingSession(false)
                }
                pendingSessionMessages.push(message)
                continue
            }
            flushPendingSession(false)
            renderItems.push({ type: "message", message })
        }

        const lastPendingMsg = pendingSessionMessages.length > 0 ? pendingSessionMessages[pendingSessionMessages.length - 1] : null
        const nowSec = Math.floor(Date.now() / 1000)
        const isStillActive = lastPendingMsg !== null && !this.pullupHasMore && (nowSec - lastPendingMsg.timestamp < 120)
        flushPendingSession(isStillActive)

        // 协作态超时自动结束：active 时设一次性定时器，到期重建刷新状态
        if (this.foldSessionActiveTimer) {
            clearTimeout(this.foldSessionActiveTimer)
            this.foldSessionActiveTimer = null
        }
        if (isStillActive && lastPendingMsg) {
            const remainMs = (120 - (nowSec - lastPendingMsg.timestamp)) * 1000
            this.foldSessionActiveTimer = setTimeout(() => {
                this.foldSessionActiveTimer = null
                this.rebuildRenderItems()
                this.notifyListener()
                // 通知会话列表刷新，清除 "AI协作中" 预览
                const conversation = WKSDK.shared().conversationManager.findConversation(this.channel)
                if (conversation) {
                    WKSDK.shared().conversationManager.notifyConversationListeners(conversation, ConversationAction.update)
                }
            }, remainMs)
        }

        for (const typingMessage of typingMessages) {
            const lastItem = renderItems[renderItems.length - 1]
            // isBotMessage() excludes typing content type, so check fromUID directly
            const typingFromBot = typingMessage.fromUID &&
                WKSDK.shared().channelManager.getChannelInfo(new Channel(typingMessage.fromUID, ChannelTypePerson))?.orgData?.robot === 1
            if (lastItem?.type === "foldSession" && lastItem.session.isActive && typingFromBot) {
                lastItem.session.typing = typingMessage
                lastItem.session.expandedMessages = getFoldSessionExpandedMessages({
                    messages: lastItem.session.messages,
                })
            } else {
                renderItems.push({ type: "message", message: typingMessage })
            }
        }

        this.foldSessionState = nextFoldSessionState
        this.messageSeqToFoldSessionId = nextMessageSeqToFoldSessionId

        // 标记紧跟在折叠卡片后的第一条消息，防止 isContinue() 误判导致头像丢失
        const afterFold = new Set<string>()
        for (let i = 1; i < renderItems.length; i++) {
            if (renderItems[i - 1].type === "foldSession" && renderItems[i].type === "message") {
                afterFold.add(renderItems[i].message.clientMsgNo)
            }
        }
        this.afterFoldSessionClientMsgNos = afterFold

        // 更新会话列表折叠预览缓存
        const channelKey = this.channel.getChannelKey()
        const lastNonTypingItem = renderItems.filter(item => !(item.type === "message" && item.message.contentType === MessageContentTypeConst.typing)).pop()
        if (lastNonTypingItem && lastNonTypingItem.type === "foldSession" && lastNonTypingItem.session.isActive) {
            ConversationVM.foldSessionPreview.set(channelKey, {
                participants: lastNonTypingItem.session.participants.map(p => p.name),
                count: lastNonTypingItem.session.count,
            })
        } else {
            ConversationVM.foldSessionPreview.delete(channelKey)
        }

        return renderItems
    }

    rebuildRenderItems(allowFoldAnimation: boolean = false) {
        this.renderItems = this.buildRenderItems(this.messages, allowFoldAnimation)
    }

    // loading 完成后主动确保 bot channelInfo 已加载，避免 loading 期间 channelInfoListener 被跳过
    private ensureBotChannelInfos() {
        if (this.channel.channelType !== ChannelTypeGroup) return
        const seenUIDs = new Set<string>()
        const botUIDs = new Set<string>()
        for (const msg of this.messagesOfOrigin) {
            if (!msg.send && msg.fromUID && !seenUIDs.has(msg.fromUID)) {
                seenUIDs.add(msg.fromUID)
                const ci = WKSDK.shared().channelManager.getChannelInfo(new Channel(msg.fromUID, ChannelTypePerson))
                if (!ci) {
                    // channelInfo 还没缓存，fetch 后触发 channelInfoListener 自然 rebuild
                    WKSDK.shared().channelManager.fetchChannelInfo(new Channel(msg.fromUID, ChannelTypePerson))
                } else if (ci.orgData?.robot === 1) {
                    botUIDs.add(msg.fromUID)
                }
            }
        }
        // 已缓存且 robot===1，直接 rebuild 确保头部正确渲染
        if (botUIDs.size > 0) {
            this.rebuildRenderItems()
            this.notifyListener()
        }
    }

    findFoldSessionByMessageSeq(messageSeq: number): FoldSessionViewModel | undefined {
        const sessionId = this.messageSeqToFoldSessionId.get(messageSeq)
        if (!sessionId) {
            return
        }
        const renderItem = this.renderItems.find((item) => item.type === "foldSession" && item.session.sessionId === sessionId)
        if (renderItem && renderItem.type === "foldSession") {
            return renderItem.session
        }
    }

    foldSessionMessageElementId(message: MessageWrap | Message): string {
        return `fold-session-message-${message.clientMsgNo}`
    }

    private messageSeqElement(messageSeq: number): HTMLElement | null {
        return document.querySelector<HTMLElement>(
            `[data-locate-message-row="true"][data-message-seq="${messageSeq}"]`,
        )
    }

    setFoldSessionExpanded(sessionId: string, expanded: boolean, userToggled: boolean = false, stateCallback?: () => void) {
        const state = this.foldSessionState.get(sessionId) || {}
        state.expanded = expanded
        if (userToggled) {
            state.userToggled = true
        }
        this.foldSessionState.set(sessionId, state)
        this.rebuildRenderItems()
        this.notifyListener(stateCallback)
    }

    toggleFoldSession(sessionId: string) {
        const session = this.renderItems.find((item) => item.type === "foldSession" && item.session.sessionId === sessionId)
        if (!session || session.type !== "foldSession") {
            return
        }
        this.setFoldSessionExpanded(sessionId, !session.session.isExpanded, true)
    }

    highlightFoldSessionSummary(sessionId: string, stateCallback?: () => void) {
        const state = this.foldSessionState.get(sessionId) || {}
        state.highlightSummary = true
        this.foldSessionState.set(sessionId, state)
        this.rebuildRenderItems()
        this.notifyListener(stateCallback)
    }

    clearFoldSessionAnimation(sessionId: string) {
        const state = this.foldSessionState.get(sessionId)
        if (!state || (!state.flash && !state.appearing)) {
            return
        }
        state.flash = false
        state.appearing = false
        this.foldSessionState.set(sessionId, state)
        this.rebuildRenderItems()
        this.notifyListener()
    }

    clearFoldSessionSummaryHighlight(sessionId: string) {
        const state = this.foldSessionState.get(sessionId)
        if (!state || !state.highlightSummary) {
            return
        }
        state.highlightSummary = false
        this.foldSessionState.set(sessionId, state)
        this.rebuildRenderItems()
        this.notifyListener()
    }

    scrollToFoldSession(sessionId: string) {
        scroller.scrollTo(sessionId, {
            containerId: this.messageContainerId,
            duration: 0,
        })
    }

    // 构建合并转发消息内容（不发送）。发送由上层 ForwardService 统一处理。
    // 保留 InteractiveCard 校验：不可转发的编辑态卡片抛 InteractiveCardForwardBlockedError
    // → ForwardService Phase 1 abort，Phase 2 完全不进入。
    buildMergeforwardContent(checkedMessagesWrap: MessageWrap[]): MergeforwardContent {
        const checkedMessages = checkedMessagesWrap.map((messageWrap: MessageWrap) => {
            const msg = messageWrap.message
            // 如果消息被编辑过，用编辑后内容替换 content，保证合并转发预览和内容正确
            if (msg.remoteExtra?.isEdit && msg.remoteExtra?.contentEdit) {
                const edited = Object.assign(Object.create(Object.getPrototypeOf(msg)), msg, {
                    content: msg.remoteExtra.contentEdit
                })
                if (
                    edited.content instanceof InteractiveCardContent &&
                    !isInteractiveCardForwardable(edited.content)
                ) {
                    throw new InteractiveCardForwardBlockedError()
                }
                return edited
            }
            if (
                msg.content instanceof InteractiveCardContent &&
                !isInteractiveCardForwardable(msg.content)
            ) {
                throw new InteractiveCardForwardBlockedError()
            }
            return msg
        })

        const users = new Array<any>()
        if (checkedMessages && checkedMessages.length > 0) {
            const addedUIDs = new Set<string>()
            for (const message of checkedMessages) {
                if (addedUIDs.has(message.fromUID)) continue
                addedUIDs.add(message.fromUID)
                const channelInfo = WKSDK.shared().channelManager.getChannelInfo(new Channel(message.fromUID, ChannelTypePerson))
                users.push({ uid: message.fromUID, name: channelInfo?.title })
            }
        }
        return new MergeforwardContent(this.channel.channelType, users, checkedMessages)
    }

    // 删除消息
    async deleteMessages(deletedMessages: Message[]): Promise<void> {
        if (!deletedMessages || deletedMessages.length === 0) {
            return
        }

        try {
            await WKApp.conversationProvider.deleteMessages(deletedMessages)
        } catch (error) {
            console.error('Failed to delete messages remotely:', error)
            throw error
        }

        this.deleteMessagesFromLocal(deletedMessages)
    }

    // 撤回消息
    async revokeMessage(message: Message): Promise<void> {

        return WKApp.conversationProvider.revokeMessage(message)

    }

    // 编辑消息
    async editMessage(messageID: String, messageSeq: number, channelID: String, channelType: number, content: String): Promise<void> {
        return WKApp.conversationProvider.editMessage(messageID, messageSeq, channelID, channelType, content)
    }

    // 仅仅删除本地消息
    async deleteMessagesFromLocal(deletedMessages: Message[]): Promise<void> {

        let messages = this.messagesOfOrigin
        let newMessages = new Array()
        for (const message of messages) {
            let exist = false
            for (const deletedMessage of deletedMessages) {
                if (deletedMessage.clientMsgNo === message.clientMsgNo) {
                    exist = true
                    this.removeSendingMessageIfNeed(deletedMessage.clientSeq, deletedMessage.channel)
                    if (this.lastMessage?.clientMsgNo === deletedMessage.clientMsgNo) {
                        this.lastMessage = this.messagesOfOrigin[this.messagesOfOrigin.length - 1];
                    }
                    break
                }
            }
            if (!exist) {
                newMessages.push(message)
            }
        }

        let lastMessage: Message | undefined;
        if (newMessages.length > 0) {
            lastMessage = newMessages[newMessages.length - 1].message
        }

        for (const deletedMessage of deletedMessages) {
            WKApp.shared.notifyMessageDeleteListener(deletedMessage, lastMessage)
        }
        this.messagesOfOrigin = newMessages
        this.refreshMessages(newMessages)
    }

    // 移除发送中的消息
    removeSendingMessageIfNeed(clientSeq: number, channel: Channel) {

        let sending = ConversationVM.sendQueue.get(channel.getChannelKey())
        if (!sending) {
            return
        }
        let i = 0
        for (const sendingMsg of sending) {
            if (sendingMsg.clientSeq === clientSeq) {
                ConversationVM.sendQueue.get(channel.getChannelKey())?.splice(i, 1)
                return
            }
            i++
        }
    }

    private static getSdkSendingQueues(): Map<number, unknown> | undefined {
        const chatManager = WKSDK.shared().chatManager as unknown as { sendingQueues?: Map<number, unknown> }
        return chatManager.sendingQueues
    }

    private static shouldKeepSendingMessage(message: MessageWrap, sdkSendingQueues?: Map<number, unknown>): boolean {
        if (message.messageSeq && message.messageSeq > 0) {
            return false
        }
        if (message.status === MessageStatus.Fail) {
            return true
        }
        if (message.status !== MessageStatus.Wait) {
            return false
        }
        if (!message.clientSeq || message.clientSeq <= 0 || !sdkSendingQueues) {
            return true
        }
        return sdkSendingQueues.has(message.clientSeq)
    }

    private reconcileSendingMessages(channel: Channel): MessageWrap[] {
        const channelKey = channel.getChannelKey()
        const sendingMessages = ConversationVM.sendQueue.get(channelKey)
        if (!sendingMessages || sendingMessages.length === 0) {
            return []
        }

        const sdkSendingQueues = ConversationVM.getSdkSendingQueues()
        const nextSendingMessages = sendingMessages.filter((message) => {
            return ConversationVM.shouldKeepSendingMessage(message, sdkSendingQueues)
        })

        if (nextSendingMessages.length !== sendingMessages.length) {
            if (nextSendingMessages.length > 0) {
                ConversationVM.sendQueue.set(channelKey, nextSendingMessages)
            } else {
                ConversationVM.sendQueue.delete(channelKey)
            }
        }

        return nextSendingMessages
    }

    private forEachLocalMessageWithClientSeq(clientSeq: number, handler: (message: MessageWrap) => void) {
        const visited = new Set<MessageWrap>()
        const visit = (messages?: MessageWrap[]) => {
            if (!messages || messages.length === 0) {
                return
            }
            for (const message of messages) {
                if (message.clientSeq === clientSeq && !visited.has(message)) {
                    visited.add(message)
                    handler(message)
                }
            }
        }

        visit(this.messagesOfOrigin)
        visit(this.pendingMessages)
        visit(this.messages)
        visit(ConversationVM.sendQueue.get(this.channel.getChannelKey()))
    }

    // 取消所有消息的选中
    unCheckAllMessages() {
        let hasChange = false
        for (const message of this.messages) {
            if (message.checked) {
                message.checked = false
                hasChange = true
            }
        }
        if (hasChange) {
            this.notifyListener()
        }
    }

    didMount(): void {

        this.conversationListener = (conversation: Conversation, action: ConversationAction) => {
            if (!conversation.channel.isEqual(this.channel)) {
                return
            }
            if (action == ConversationAction.update) {
                // 如果本地已读位置比服务端更新（browseToMessageSeq >= lastMessage.messageSeq），
                // 说明用户已读完消息，不应该被服务端的旧未读数覆盖
                if (this.lastMessage && this.browseToMessageSeq >= this.lastMessage.messageSeq) {
                    if (conversation.unread > 0) {
                        // 有意直接修改 conversation.unread（side effect），
                        // 确保 SDK 缓存的 Conversation 对象与本地已读状态保持一致
                        conversation.unread = 0
                    }
                    // 用户已读到底，同步清 SDK 的 isMentionMe，防止新消息到来时角标误显示
                    conversation.isMentionMe = false
                }
                this.unreadCount = conversation.unread
            }
        }
        WKSDK.shared().conversationManager.addConversationListener(this.conversationListener)

        // 消息监听
        this.messageListener = (message: Message) => {
            if (!message.channel.isEqual(this.channel)) {
                return
            }
            // dmwork-web#1069 R5：WebSocket 推送的 Message 是 SDK 内部
            // `new Message(recvPacket)` 产物，wire 不携带 msg-level 的
            // from_home_space_* 等字段。在业务层收尾用群成员列表 / Person cache
            // 兜底补齐；已有值不覆盖、失败静默。此处是 WS 推送 bubble 的唯一入口。
            applyMsgLevelExternalFieldsWithFallback(message, undefined)
            if (message.contentType == MessageContentTypeConst.rtcData) {
                return
            }
            if (message.header.noPersist) { // 不存储的消息不显示
                return
            }
            if (!message.send && message.header.reddot) {
                this.needSetUnread = true
            }

            // 流式消息处理：追加到已有消息
            if (message.streamNo) {
                const existMsg = this.findMessageByStreamNo(message.streamNo)
                if (existMsg) {
                    if (!existMsg.message.streams) {
                        existMsg.message.streams = []
                    }
                    const streamSeq = message.streamSeq || 0
                    // 去重：跳过已存在的 streamSeq
                    const exists = existMsg.message.streams.some(s => s.streamSeq === streamSeq)
                    if (!exists) {
                        existMsg.message.streams.push({
                            clientMsgNo: message.clientMsgNo,
                            streamSeq: streamSeq,
                            content: message.content
                        })
                        // 按 streamSeq 排序，确保乱序到达时内容正确拼接
                        existMsg.message.streams.sort((a, b) => a.streamSeq - b.streamSeq)
                    }
                    existMsg.message.streamFlag = message.streamFlag
                    this.rebuildRenderItems()
                    this.notifyListener()
                    return
                }
            }

            const messageWrap = new MessageWrap(message)
            this.fillOrder(messageWrap)
            this.appendMessage(messageWrap)
        }
        WKSDK.shared().chatManager.addMessageListener(this.messageListener)

        // cmd监听
        this.cmdListener = (message: Message) => {
            const cmdContent = message.content as CMDContent
            const param = cmdContent.param
            if (cmdContent.cmd === 'messageRevoke') { //消息撤回
                let existMessage = this.findMessageWithMessageID(param.message_id)
                if (existMessage) {
                    existMessage.revoke = true
                    existMessage.revoker = message.fromUID;
                    if (this.findFoldSessionByMessageSeq(existMessage.messageSeq)) {
                        this.liveFoldRevokeClientMsgNos.add(existMessage.clientMsgNo)
                    }
                    this.rebuildRenderItems()
                    this.notifyListener()
                }
            } else if (cmdContent.cmd === 'syncMessageExtra') { // 同步消息扩展
                if (message.channel.isEqual(this.channel)) {
                    WKSDK.shared().chatManager.syncMessageExtras(this.channel, this.findMaxExtraVersion()).then((messageExtras) => {
                        this.updateMessageByMessageExtras(messageExtras)
                    }).catch((err) => {
                        console.error('[ConversationVM] syncMessageExtras failed:', err)
                    })
                }

            }
        }
        WKSDK.shared().chatManager.addCMDListener(this.cmdListener)

        // 消息状态监听
        this.messageStatusListener = (ackPacket: SendackPacket): void => {
            this.updateMessageStatusBySendAck(ackPacket)
        }
        WKSDK.shared().chatManager.addMessageStatusListener(this.messageStatusListener)

        // 监听 channelInfo 变化，确保 bot 身份信息到达后重建折叠卡片
        this.channelInfoListener = (channelInfo: ChannelInfo) => {
            if (this.loading) {
                return
            }
            if (!this.supportsFolding) {
                return
            }
            if (channelInfo.channel.channelType !== ChannelTypePerson) {
                return
            }
            if (channelInfo.orgData?.robot !== 1) {
                return
            }
            const hasBotMsg = this.messagesOfOrigin.some(m => m.fromUID === channelInfo.channel.channelID)
            if (hasBotMsg) {
                this.rebuildRenderItems()
                this.notifyListener()
            }
        }
        WKSDK.shared().channelManager.addListener(this.channelInfoListener)

        WKApp.endpointManager.setMethod(EndpointID.clearChannelMessages, (channel: Channel) => {
            if (channel.isEqual(this.channel)) {
                if (this.messagesOfOrigin.length > 0) {
                    this.browseToMessageSeq = this.messagesOfOrigin[this.messagesOfOrigin.length - 1].messageSeq
                }
                this.messagesOfOrigin = []
                this.messages = []
                this.renderItems = []
                this.foldSessionState.clear()
                this.messageSeqToFoldSessionId.clear()
                this.liveFoldRevokeClientMsgNos.clear()
                if (this.foldSessionActiveTimer) {
                    clearTimeout(this.foldSessionActiveTimer)
                    this.foldSessionActiveTimer = null
                }
                this.lastMessage = undefined
                this.notifyListener()
            }
        }, {})

        if (this.supportsFolding) {

            // 加载频道信息
            this.channelInfo = WKSDK.shared().channelManager.getChannelInfo(this.channel)
            if (this.channelInfo) {
                this.loadChannelInfoFinished()
            } else {
                WKSDK.shared().channelManager.fetchChannelInfo(this.channel).then(() => {
                    this.channelInfo = WKSDK.shared().channelManager.getChannelInfo(this.channel)
                    this.loadChannelInfoFinished()
                }).catch((err) => {
                    console.error('[ConversationVM] fetchChannelInfo failed:', err)
                    this.loadChannelInfoFinished()
                })
            }

        }

        // 输入中监听
        this.typingListener = (channel: Channel, add: boolean) => {
            if (this.showScrollToBottomBtn) {
                return
            }
            if (this.channel.isEqual(channel)) {

                this.removeTypingMessage(false)
                if (add) {
                    this.addTypingMessage(false)
                }
                this.notifyListener(() => {
                    this.scrollToBottom(false)
                })
            }
        }
        TypingManager.shared.addTypingListener(this.typingListener)

        // 重连补刷：SDK 重连不补拉离线消息，断连期间当前会话窗口不刷新。
        // Connected 时补刷首屏。5s 去抖（参考 App.tsx remoteConfig foreground
        // refresh pattern），避免频繁断连重连重复拉首屏。
        // ⚠️ 必须在 didUnMount 成对 removeConnectStatusListener，否则页面切换
        // 累积 listener → 内存泄漏 + 重连时多实例并发拉首屏。
        this.connectStatusListener = (status: ConnectStatus) => {
            // 断连期间的成员变更 CMD（加/减成员，含龙虾）随 WS 丢失，SDK 重连
            // 只 reSubscribe 不补拉，subscriberChangeListener 因此不会被触发，
            // 导致 subscribers 停在断连前旧快照 → @ 提及弹窗搜不到新成员。
            // 成员重同步自带独立节流（lastSubscriberResyncAt），不与上方消息补拉
            // 共用时间戳，修复 octo-web#567/#568。
            handleImReconnectRefresh(status, {
                getLastRefreshAt: () => this.lastReconnectRefreshAt,
                setLastRefreshAt: (time) => {
                    this.lastReconnectRefreshAt = time
                },
                refreshMessages: () => this.requestMessagesOfFirstPage(0),
                resyncSubscribers: () => this.resyncSubscribers(),
            })
        }
        addImConnectStatusListener(WKSDK.shared(), this.connectStatusListener)

        // 回前台补刷：合盖/息屏久后回到页面，WS 可能已断且成员变更事件已丢失。
        // App.tsx 的 visibilitychange/focus 只刷 remoteConfig，不碰成员，这里补上。
        WKApp.mittBus.on("wk:app-foreground", this._foregroundResyncHandler)

        const conversation = WKSDK.shared().conversationManager.findConversation(this.channel)
        if (conversation) {
            const unread = conversation.unread
            this.orgUnreadCount = unread
            this.unreadCount = unread
            this.currentConversation = conversation

            this.shouldShowHistorySplit = unread > 0
            if (unread > 0) {
                if (conversation.lastMessage && conversation.lastMessage.messageSeq > 0) {
                    this.browseToMessageSeq = conversation.lastMessage.messageSeq - unread
                }

            } else {
                this.browseToMessageSeq = conversation.lastMessage?.messageSeq || 0
            }

            if (conversation.lastMessage) {
                this.updateLastMessageIfNeed(new MessageWrap(conversation.lastMessage))
            }

            WKSDK.shared().conversationManager.openConversation = conversation
        }

        this.requestMessagesOfFirstPage(this.initLocateMessageSeq, () => {
            if (this.onFirstMessagesLoaded) {
                this.onFirstMessagesLoaded()
            }
            // 进入会话即标记 reminders 已读，避免折叠分组后 @ 角标残留
            this.markReminderDones()
        })

        // 订阅 task 上传失败事件（module.tsx 全局触发，这里仅处理当前 channel）
        WKApp.mittBus.on("task-upload-failed", this._taskUploadFailedHandler)

        // 订阅内置表情清单更新：清单异步到达后，已解析缓存的消息按新表(token→图/正则)
        // 重新解析并重渲染一次，修复首屏竞态下新增服务端表情显示为裸 [xxx] 的问题。
        WKApp.mittBus.on("emoji-manifest-updated", this._emojiManifestUpdatedHandler)

    }
    // task 上传失败通知处理器（module.tsx 的全局订阅 emit，这里接收并刷新 UI）
    private _taskUploadFailedHandler = (data: { channelKey: string }) => {
        if (data.channelKey === this.channel.getChannelKey()) {
            this.notifyListener()
        }
    }

    // 表情清单更新处理器：清空已渲染消息的解析缓存使其按新清单重解析，再重建渲染项并刷新。
    private _emojiManifestUpdatedHandler = () => {
        for (const m of this.messages) {
            m.resetParts()
        }
        this.rebuildRenderItems()
        this.notifyListener()
    }

    didUnMount(): void {
        this.markReminderDones()
        WKSDK.shared().chatManager.removeMessageListener(this.messageListener)
        WKSDK.shared().chatManager.removeMessageStatusListener(this.messageStatusListener)
        WKApp.endpointManager.removeMethod(EndpointID.clearChannelMessages)
        WKSDK.shared().chatManager.removeCMDListener(this.cmdListener)

        TypingManager.shared.removeTypingListener(this.typingListener)
        removeImConnectStatusListener(WKSDK.shared(), this.connectStatusListener)
        WKSDK.shared().conversationManager.removeConversationListener(this.conversationListener)
        WKSDK.shared().channelManager.removeSubscriberChangeListener(this.subscriberChangeListener)
        WKSDK.shared().channelManager.removeListener(this.channelInfoListener)
        if (this.foldSessionActiveTimer) {
            clearTimeout(this.foldSessionActiveTimer)
            this.foldSessionActiveTimer = null
        }
        this.pendingMessages = [] // 清理缓冲区

        WKApp.mittBus.off("task-upload-failed", this._taskUploadFailedHandler)
        WKApp.mittBus.off("emoji-manifest-updated", this._emojiManifestUpdatedHandler)
        WKApp.mittBus.off("wk:app-foreground", this._foregroundResyncHandler)
    }

    // 加载频道信息完成
    async loadChannelInfoFinished() {
        // 子区（ChannelTypeCommunityTopic）使用父群聊的成员列表来支持 @
        if (this.channel.channelType === ChannelTypeCommunityTopic) {
            const parentGroupNo = this.channelInfo?.orgData?.parentGroupNo
            if (parentGroupNo) {
                const parentChannel = new Channel(parentGroupNo, ChannelTypeGroup)
                const parentChannelInfo = WKSDK.shared().channelManager.getChannelInfo(parentChannel)
                const isSuperGroup = parentChannelInfo?.orgData?.group_type == SuperGroup
                if (isSuperGroup) {
                    // 超级群：只取第一页
                    this.subscribers = await WKApp.dataSource.channelDataSource.subscribers(parentChannel, {
                        limit: 100,
                        page: 1,
                    })
                    this._resolveSubscribersReady()
                } else {
                    // 普通群：从缓存拿，没有则同步
                    const cached = WKSDK.shared().channelManager.getSubscribes(parentChannel)
                    if (cached && cached.length > 0) {
                        this.subscribers = cached
                        this._resolveSubscribersReady()
                    } else {
                        await WKSDK.shared().channelManager.syncSubscribes(parentChannel)
                        this.subscribers = WKSDK.shared().channelManager.getSubscribes(parentChannel) || []
                        this._resolveSubscribersReady()
                        // 注册前先移除旧监听器，避免多次调用时重复注册
                        if (this.subscriberChangeListener) {
                            WKSDK.shared().channelManager.removeSubscriberChangeListener(this.subscriberChangeListener)
                        }
                        this.subscriberChangeListener = (channel: Channel) => {
                            if (channel.channelID !== parentGroupNo) return
                            this.subscribers = WKSDK.shared().channelManager.getSubscribes(parentChannel) || []
                            this._resolveSubscribersReady()
                            this.notifyListener()
                        }
                        WKSDK.shared().channelManager.addSubscriberChangeListener(this.subscriberChangeListener)
                    }
                }
                this.notifyListener()
            }
            return
        }
        if (this.channel.channelType !== ChannelTypeGroup) {
            return
        }
        this.reloadSubscribers()
        this.subscriberChangeListener = (channel: Channel) => {
            if (!this.channel.isEqual(channel)) {
                return
            }
            this.reloadSubscribers()
            this._resolveSubscribersReady()
        }
        WKSDK.shared().channelManager.addSubscriberChangeListener(this.subscriberChangeListener)

        if (this.channelInfo?.orgData?.group_type == SuperGroup) {
            // 如果是超级群则只获取第一页成员
            this.subscribers = await this.getFirstPageMembers()
            this._resolveSubscribersReady()
            WKSDK.shared().channelManager.subscribeCacheMap.set(this.channel.getChannelKey(), this.subscribers)
            WKSDK.shared().channelManager.notifySubscribeChangeListeners(this.channel)
            this.notifyListener()
        } else {
            WKSDK.shared().channelManager.syncSubscribes(this.channel)
        }

    }

    // 获取第一页成员列表（超大群）
    getFirstPageMembers() {
        return WKApp.dataSource.channelDataSource.subscribers(this.channel, {
            limit: 100,
            page: 1
        })
    }

    // 标记提醒已完成
    markReminderDones() {
        const conversation = WKSDK.shared().conversationManager.findConversation(this.channel)
        if (conversation && conversation.reminders && conversation.reminders.length > 0) {
            const ids = new Array<number>()
            for (const reminder of conversation.reminders) {
                if (!reminder.done) {
                    ids.push(reminder.reminderID)
                }
            }
            if (ids.length > 0) {
                WKSDK.shared().reminderManager.done(ids)
            }
        }
        // 进场兜底：清 SDK 本地的 isMentionMe，与 reminders done 保持一致
        const conv = WKSDK.shared().conversationManager.findConversation(this.channel)
        if (conv) {
            conv.isMentionMe = false
        }

    }

    async onDownArrow() {
        const conversation = WKSDK.shared().conversationManager.findConversation(this.channel)
        let onlyScroll = false
        if (conversation && conversation.lastMessage) {
            if (this.messagesOfOrigin && this.messagesOfOrigin.length > 0) {
                const lastMessage = this.messagesOfOrigin[this.messagesOfOrigin.length - 1]
                if (lastMessage.messageSeq >= conversation.lastMessage.messageSeq) {
                    onlyScroll = true
                }
            }
        }

        if (onlyScroll) {
            this.scrollToBottom(true)
        } else {
            return this.requestMessagesOfFirstPage(0)
        }

    }

    // 获取“输入中”这条消息
    getTypingMessage(): MessageWrap | undefined {
        const typingMessage = TypingManager.shared.getFakeTypingMessage(this.channel)
        if (typingMessage) {
            const typingMessageWrap = new MessageWrap(typingMessage)
            if (this.messages && this.messages.length > 0) {
                typingMessageWrap.preMessage = this.messages[this.messages.length - 1]
            }
            return typingMessageWrap
        }
        return
    }

    // 是否有“输入中”的消息
    hasTyingMessage() {
        if (this.messagesOfOrigin.length === 0) {
            return false
        }
        for (let i = this.messagesOfOrigin.length - 1; i >= 0; i--) {
            const message = this.messagesOfOrigin[i];
            if (message.contentType === MessageContentTypeConst.typing) {
                return true
            }
        }
        return false
    }
    // 移除“输入中”这条消息
    removeTypingMessage(notify: boolean = true) {
        const newMessages = new Array()
        for (let i = 0; i < this.messagesOfOrigin.length; i++) {
            const message = this.messagesOfOrigin[i];
            if (message.contentType !== MessageContentTypeConst.typing) {
                newMessages.push(message)
            }
        }
        this.messagesOfOrigin = newMessages
        this.refreshMessages(newMessages)
    }

    // 添加“输入中”这条消息
    addTypingMessage(notify: boolean = true) {
        const typingMessage = this.getTypingMessage()
        if (!this.hasTyingMessage() && typingMessage) {
            this.appendMessage(typingMessage)
            if (notify) {
                this.notifyListener()
            }
        }
    }

    // 重新加载订阅者
    reloadSubscribers() {
        this.subscribers = WKSDK.shared().channelManager.getSubscribes(this.channel)
        if (this.subscribers.length > 0) {
            this._resolveSubscribersReady()
        }
        this.notifyListener()
    }

    // 回前台重刷处理器：App.tsx 回前台时全局 emit，这里直接重同步当前会话成员。
    // 节流已下沉到 resyncSubscribers 内（lastSubscriberResyncAt），不再共用重连的
    // lastReconnectRefreshAt，避免前台成员刷抢先设时间戳后压制重连的消息补拉（octo-web#568 review）。
    private _foregroundResyncHandler = () => {
        this.resyncSubscribers()
    }

    // 主动重同步当前会话成员列表（重连 / 回前台调用）。
    // 断连期间的成员变更 CMD 随 WS 丢失、SDK 重连不补拉，subscriberChangeListener
    // 因此不会触发，subscribers 停在旧快照 → @ 弹窗搜不到新成员（octo-web#567）。
    // 自带 5s 节流（lastSubscriberResyncAt），与重连的消息补拉节流相互独立。
    // 复用进频道时的加载分支：超级群（含子区的超级群父群）拉第一页，普通群走服务端全量同步。
    async resyncSubscribers() {
        const now = Date.now()
        if (now - this.lastSubscriberResyncAt < 5000) {
            return
        }
        this.lastSubscriberResyncAt = now
        try {
            if (this.channel.channelType === ChannelTypeCommunityTopic) {
                // 子区用父群成员。需镜像进频道时的分支：父群是超级群时只拉第一页，
                // 否则会对几千人的超级群父群每次重连/回前台都全量同步（octo-web#568 review）。
                const parentGroupNo = this.channelInfo?.orgData?.parentGroupNo
                if (!parentGroupNo) {
                    return
                }
                const parentChannel = new Channel(parentGroupNo, ChannelTypeGroup)
                const parentChannelInfo = WKSDK.shared().channelManager.getChannelInfo(parentChannel)
                const isSuperGroup = parentChannelInfo?.orgData?.group_type == SuperGroup
                if (isSuperGroup) {
                    // 超级群父群：只拉第一页（与进频道时一致）
                    this.subscribers = await WKApp.dataSource.channelDataSource.subscribers(parentChannel, {
                        limit: 100,
                        page: 1,
                    })
                } else {
                    // 普通父群：全量同步后取缓存
                    await WKSDK.shared().channelManager.syncSubscribes(parentChannel)
                    this.subscribers = WKSDK.shared().channelManager.getSubscribes(parentChannel) || []
                }
                this._resolveSubscribersReady()
                this.notifyListener()
                return
            }
            if (this.channel.channelType !== ChannelTypeGroup) {
                return
            }
            if (this.channelInfo?.orgData?.group_type == SuperGroup) {
                // 超级群只拉第一页（与进频道时一致）
                this.subscribers = await this.getFirstPageMembers()
                this._resolveSubscribersReady()
                WKSDK.shared().channelManager.subscribeCacheMap.set(this.channel.getChannelKey(), this.subscribers)
                WKSDK.shared().channelManager.notifySubscribeChangeListeners(this.channel)
                this.notifyListener()
            } else {
                // 普通群走服务端全量同步，完成后 subscriberChangeListener 回调刷新
                await WKSDK.shared().channelManager.syncSubscribes(this.channel)
                this.reloadSubscribers()
            }
        } catch (e) {
            console.warn("[ConversationVM] resyncSubscribers failed", e)
        }
    }

    // 通过uid获取订阅者对象
    subscriberWithUID(uid: string): Subscriber | undefined {
        if (this.subscribers) {
            for (const subscriber of this.subscribers) {
                if (subscriber.uid === uid) {
                    return subscriber
                }
            }
        }
    }

    // 更新消息状态
    updateMessageStatusBySendAck(ackPacket: SendackPacket) {
        const message = this.findMessageWithClientSeq(ackPacket.clientSeq)
        if (message) {
            const ackOrder = ackPacket.messageSeq * OrderFactor
            this.forEachLocalMessageWithClientSeq(ackPacket.clientSeq, (localMessage) => {
                localMessage.message.messageID = ackPacket.messageID.toString()
                localMessage.message.messageSeq = ackPacket.messageSeq
                localMessage.reasonCode = ackPacket.reasonCode
                if (ackPacket.reasonCode === 1) {
                    localMessage.order = ackOrder
                    localMessage.status = MessageStatus.Normal
                } else {
                    localMessage.status = MessageStatus.Fail
                    this.fillOrder(localMessage)
                }
            })
            if (ackPacket.reasonCode === 1) {
                // 发送成功后同步更新 order 并重排渲染列表，纠正本地回显阶段的临时位置。
                message.order = ackOrder
                this.updateLastMessageIfNeed(message)
                this.removeSendingMessageIfNeed(ackPacket.clientSeq, this.channel)
                this.messagesOfOrigin = ConversationVM.deduplicateMessages(this.sortMessages(this.messagesOfOrigin))
                this.refreshMessages(this.messagesOfOrigin)
                return
            }
        }
        this.notifyListener()
    }

    // 更新消息扩展数据
    updateMessageByMessageExtras(messageExtras: MessageExtra[]) {
        if (!messageExtras || messageExtras.length == 0) {
            return
        }
        for (const messageExtra of messageExtras) {
            this.updateReplyMessageContent(messageExtra)
            const message = this.findMessageWithMessageID(messageExtra.messageID)
            if (message) {
                message.message.remoteExtra = messageExtra
                message.resetParts()
            }
        }
        this.notifyListener()

    }

    // 修改被回复的消息体
    updateReplyMessageContent(extra: MessageExtra) {
        if (!this.messages || this.messages.length <= 0) {
            return
        }
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const message = this.messages[i]
            // 防御畸形消息：content 可能整体缺失（#465 保留了此类消息），用可选链避免读取 undefined.reply 崩溃。
            if (message.content?.reply === undefined) {
                continue
            }
            if (message.content.reply.messageID && message.content.reply.messageID === extra.messageID) {
                message.content.reply.content = extra.contentEdit
            }
        }
        this.notifyListener()
    }
    // 通过clientSeq获取消息对象（同时搜索本地列表/缓冲区/sendQueue，避免 ack 丢失）
    findMessageWithClientSeq(clientSeq: number): MessageWrap | undefined {
        const findIn = (messages?: MessageWrap[]) => {
            if (!messages || messages.length <= 0) {
                return
            }
            for (let i = messages.length - 1; i >= 0; i--) {
                const message = messages[i]
                if (message.clientSeq === clientSeq) {
                    return message
                }
            }
        }

        return findIn(this.messages)
            || findIn(this.messagesOfOrigin)
            || findIn(this.pendingMessages)
            || findIn(ConversationVM.sendQueue.get(this.channel.getChannelKey()))
    }

    // 通过clientMsgNo获取消息对象
    findMessageWithClientMsgNo(clientMsgNo: string): MessageWrap | undefined {
        if (!this.messages || this.messages.length <= 0) {
            return
        }
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const message = this.messages[i]
            if (message.clientMsgNo === clientMsgNo) {
                return message
            }
        }
    }

    // 通过messageID获取消息对象
    findMessageWithMessageID(messageID: string): MessageWrap | undefined {
        if (!this.messages || this.messages.length <= 0) {
            return
        }
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const message = this.messages[i]
            if (message.messageID === messageID) {
                return message
            }
        }
    }

    // 通过streamNo查找流式消息
    findMessageByStreamNo(streamNo: string): MessageWrap | undefined {
        if (!this.messages || this.messages.length <= 0) {
            return
        }
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const message = this.messages[i]
            if (message.message.streamNo === streamNo) {
                return message
            }
        }
    }

    // 通过messageSeq获取消息对象
    findMessageWithMessageSeq(messageSeq: number) {
        if (!this.messages || this.messages.length <= 0) {
            return
        }
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const message = this.messages[i]
            if (message.messageSeq === messageSeq) {
                return message
            }
        }
    }

    // 获取最大的扩展版本
    findMaxExtraVersion() {
        let extraVersion = 0
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const message = this.messages[i]
            if (message.remoteExtra.extraVersion > extraVersion) {
                extraVersion = message.remoteExtra.extraVersion
            }
        }
        return extraVersion
    }

    // 向列表追加消息
    appendMessage(messageWrap: MessageWrap) {
        const senderIsSelf = messageWrap.fromUID === WKApp.loginInfo.uid
        this.updateLastMessageIfNeed(messageWrap)
        if (this.pullupHasMore) {
            // 缓存消息，等 pullupHasMore 变 false 后追加，避免消息丢失 (#246)
            this.pendingMessages.push(messageWrap)
            if (senderIsSelf) {
                this.notifyListener()
                this.scrollToBottomIfNeedPull()
            } else {
                this.notifyListener()
            }
            return
        }
        // flush 缓冲区中的 pending 消息
        if (this.pendingMessages.length > 0) {
            this.messagesOfOrigin.push(...this.pendingMessages)
            this.pendingMessages = []
        }
        // 去重：避免实时消息与历史拉取竞态导致同一条消息重复出现
        // clientMsgNo/messageID 为主键，messageSeq > 0 时额外用 seq 兜底（防止不同 clientMsgNo 的同一条消息重复）
        const msgKey = messageWrap.clientMsgNo || messageWrap.messageID?.toString()
        const alreadyExists = this.messagesOfOrigin.some(m => {
            if (msgKey && (m.clientMsgNo || m.messageID?.toString()) === msgKey) return true
            if (messageWrap.messageSeq > 0 && m.messageSeq === messageWrap.messageSeq) return true
            return false
        })
        if (!alreadyExists) {
            this.messagesOfOrigin.push(messageWrap)
        }

        this.refreshMessages(this.messagesOfOrigin, () => {
            if (senderIsSelf) {
                this.scrollToBottom(true)
                this.notifyListener()
            } else {
                if (this.showScrollToBottomBtn) {
                    this.notifyListener()
                } else {
                    this.scrollToBottom(true)
                }
            }
        }, { allowFoldAnimation: true })
    }

    // 根据情况更新最后一条消息
    updateLastMessageIfNeed(message: MessageWrap) {
        let change = false
        if (!this.lastMessage) {
            this.lastMessage = message
            change = true
        } else if (message.messageSeq > this.lastMessage.messageSeq) {
            this.lastMessage = message
            change = true
        }
        if (change) {
            this.refreshNewMsgCount()
        }
    }

    // 刷新新消息数量
    async refreshNewMsgCount() {

        const oldUnreadCount = this.unreadCount
        if (this.browseToMessageSeq == 0) {
            this.unreadCount = 0
        } else if (!this.lastMessage) { // 没有给定最新的消息 没办法算未读数量
            this.unreadCount = 0
        } else if (this.lastMessage.send) { // // 如果最后一条消息是自己发的 则新消息数量为0
            this.browseToMessageSeq = this.lastMessage.messageSeq
            this.unreadCount = 0
        } else if (this.lastMessage.messageSeq <= this.browseToMessageSeq) { // 如果最新消息的序号小于或等于预览到的 则最新消息为0
            this.unreadCount = 0
        } else {
            if (this.lastMessage.messageSeq >= this.browseToMessageSeq) {
                this.unreadCount = this.lastMessage.messageSeq - this.browseToMessageSeq
            }
        }
        if (oldUnreadCount != this.unreadCount) {
            const conversation = WKSDK.shared().conversationManager.findConversation(this.channel)
            if (conversation) {
                conversation.unread = this.unreadCount
            }
            // 未读清零时：先持久化到服务端，成功后再通知监听者 + 刷新 sidebar 快照（#203）。
            // markConversationUnread 是异步 HTTP PUT，必须 await 确保 /sidebar/sync 读到
            // 的是已持久化的状态，而不是旧快照。
            let shouldClear = this.unreadCount === 0 && oldUnreadCount > 0
            // 先通知本地监听者：conversation.unread 已归零，让会话列表 UI 立即反映，
            // 不等待网络请求。sidebar-reload 才需要等服务端确认后再触发（#203）。
            if (conversation) {
                WKSDK.shared().conversationManager.notifyConversationListeners(conversation, ConversationAction.update)
            }
            if (shouldClear) {
                try {
                    await WKApp.conversationProvider.markConversationUnread(this.channel, 0)
                } catch (_e) {
                    // 清未读失败时跳过 sidebar 刷新——服务端还是旧状态，
                    // sync 拉回来的快照仍是旧值，刷新没有意义。
                    shouldClear = false
                }
            }
            // 仅未读清零且服务端确认后刷新 sidebar：按 schema sidebar/sync 拿到最新 follow 快照，
            // 关注 tab 中 sidebar-only 项的角标才能归零。
            if (shouldClear) {
                WKApp.mittBus.emit("sidebar-reload" as any)
            }
        }

    }

    //滚动到底部，如果需要远程pull数据就去pull
    scrollToBottomIfNeedPull(): void {
        if (this.pullupHasMore) {
            // TODO: 如果有更多应该先去请求最后一页数据后再滚动到底部，这里暂未实现
            animateScroll.scrollToBottom({
                containerId: this.messageContainerId,
                "duration": 0,
            });
        } else {
            animateScroll.scrollToBottom({
                containerId: this.messageContainerId,
                "duration": 0,
            });
        }

    }

    // 是否有草稿
    hasDraft() {
        if (this.currentConversation) {
            const draft = this.currentConversation.remoteExtra.draft
            if (draft && draft !== "") {
                return true
            }
        }
        return false
    }

    // 获取草稿内容
    draft() {
        if (this.currentConversation) {
            const draft = this.currentConversation.remoteExtra.draft
            if (draft && draft !== "") {
                return draft
            }
        }
        return ""
    }

    // 获取第一屏消息
    requestMessagesOfFirstPage(lcateMessageSeq?: number, stateCallback?: () => void) {

        // Only an explicit positive argument represents a user-initiated
        // locate (for example from global search). The undefined path below
        // may derive a seq from unread/scroll-restoration state and must not
        // flash a message on every normal conversation open.
        const shouldHighlightLocatedMessage = typeof lcateMessageSeq === "number" && lcateMessageSeq > 0
        this.initLocateMessageSeq = 0
        let initLocateOffsetY = 0
        if (lcateMessageSeq === undefined) {
            if (this.currentConversation) {
                const remoteExtra = this.currentConversation.remoteExtra
                const savedKeepMessageSeq = Number(remoteExtra.keepMessageSeq || 0)
                const savedKeepOffsetY = Number(remoteExtra.keepOffsetY || 0)
                const keepMessageSeq = Number.isFinite(savedKeepMessageSeq) ? savedKeepMessageSeq : 0
                const keepOffsetY = Number.isFinite(savedKeepOffsetY) ? savedKeepOffsetY : 0
                if (this.currentConversation.unread > 0) {
                    if (keepMessageSeq > 0 && keepMessageSeq < this.browseToMessageSeq) {
                        this.initLocateMessageSeq = keepMessageSeq
                        initLocateOffsetY = keepOffsetY
                    } else {
                        this.initLocateMessageSeq = this.browseToMessageSeq
                    }

                } else {
                    this.initLocateMessageSeq = keepMessageSeq
                    initLocateOffsetY = keepMessageSeq > 0 ? keepOffsetY : 0
                }
            }
        } else {
            this.initLocateMessageSeq = lcateMessageSeq
        }
        return this.syncMessages(
            this.initLocateMessageSeq,
            stateCallback,
            initLocateOffsetY,
            shouldHighlightLocatedMessage,
        )
    }

    // 最近会话显示的最后一条消息的messageSeq
    conversationLastMessageSeq() {
        const conversation = WKSDK.shared().conversationManager.findConversation(this.channel)
        if (conversation && conversation.lastMessage) {
            return conversation.lastMessage?.messageSeq
        }
        return 0
    }

    // 同步消息
    async syncMessages(
        initMessageSeq?: number,
        stateCallback?: () => void,
        locateOffsetY: number = 0,
        highlightLocatedMessage: boolean = false,
    ) {
        this.loading = true
        this.liveFoldRevokeClientMsgNos.clear()
        this.notifyListener()

        const opts = new SyncMessageOptions()
        opts.limit = WKApp.config.pageSizeOfMessage
        const lastRemoteMessageSeq = this.conversationLastMessageSeq() // 服务器最新的一条消息的序号
        if (initMessageSeq && initMessageSeq > 0) {
            if (lastRemoteMessageSeq <= 0 && initMessageSeq > opts.limit) {
                opts.startMessageSeq = initMessageSeq - 5
                if (opts.startMessageSeq < 0) {
                    opts.startMessageSeq = 0
                }
                opts.pullMode = PullMode.Up
            } else if (lastRemoteMessageSeq > 0 && lastRemoteMessageSeq - initMessageSeq > opts.limit) {
                opts.startMessageSeq = initMessageSeq - 5
                if (opts.startMessageSeq < 0) {
                    opts.startMessageSeq = 0
                }
                opts.pullMode = PullMode.Up
            }
        }
        const remoteMessages = await WKApp.conversationProvider.syncMessages(this.channel, opts)

        const newMessages = new Array<Message>()
        if (remoteMessages && remoteMessages.length > 0) {
            remoteMessages.forEach(msg => {
                if (!msg.isDeleted) {
                    newMessages.push(msg)
                }
            });
        }
        const sendingMessages = this.getSendingMessages(this.channel)
        let allMessages = [...this.toMessageWraps(newMessages), ...sendingMessages]
        allMessages = this.sortMessages(allMessages)

        if (remoteMessages && remoteMessages.length > 0) {
            if (lastRemoteMessageSeq <= 0 && remoteMessages.length >= opts.limit) {
                this.pullupHasMore = true
            } else if (lastRemoteMessageSeq > remoteMessages[remoteMessages.length - 1].messageSeq) {
                this.pullupHasMore = true
            } else {
                this.pullupHasMore = false
            }
        } else {
            this.pullupHasMore = false;
        }
        // 首页加载完成后 flush 缓冲的实时消息 (#246)
        if (!this.pullupHasMore && this.pendingMessages.length > 0) {
            allMessages = [...allMessages, ...this.pendingMessages]
            allMessages = this.sortMessages(allMessages)
            this.pendingMessages = []
        }
        let initMessage: MessageWrap | undefined
        if (initMessageSeq && initMessageSeq > 0) {
            for (const message of allMessages) {
                if (message.messageSeq === initMessageSeq) {
                    initMessage = message
                    break
                }
            }
        }
        if (initMessage && highlightLocatedMessage) {
            initMessage.locateRemind = true
        }

        this.messagesOfOrigin = allMessages
        this.refreshAndLocateMessages(allMessages, initMessage, true, () => {
            this.loading = false
            if (stateCallback) {
                stateCallback()
            }
            // loading 完成后，主动确保 bot 消息的 channelInfo 已载入
            // 修复：loading 期间 channelInfoListener 会被跳过，导致 AI 标识不显示
            this.ensureBotChannelInfos()
        }, locateOffsetY)
    }

    async requestMessagesAroundMessageSeq(messageSeq: number, stateCallback?: () => void) {
        if (!messageSeq || messageSeq <= 0) {
            if (stateCallback) {
                stateCallback()
            }
            return
        }

        this.loading = true
        this.initLocateMessageSeq = 0
        this.liveFoldRevokeClientMsgNos.clear()
        this.notifyListener()

        // 搜索定位不依赖当前已加载列表，而是以目标 seq 建立一个前后都可继续分页的窗口。
        const anchorStartMessageSeq = Math.max(0, messageSeq - 1)
        const olderOpts = new SyncMessageOptions()
        olderOpts.limit = WKApp.config.pageSizeOfMessage
        olderOpts.pullMode = PullMode.Down
        olderOpts.startMessageSeq = anchorStartMessageSeq

        const newerOpts = new SyncMessageOptions()
        newerOpts.limit = WKApp.config.pageSizeOfMessage
        newerOpts.pullMode = PullMode.Up
        newerOpts.startMessageSeq = anchorStartMessageSeq

        const [olderRemoteMessages, newerRemoteMessages] = await Promise.all([
            WKApp.conversationProvider.syncMessages(this.channel, olderOpts),
            WKApp.conversationProvider.syncMessages(this.channel, newerOpts),
        ])
        const toAvailableMessageWraps = (remoteMessages?: Message[]) => {
            const messages = new Array<Message>()
            if (remoteMessages && remoteMessages.length > 0) {
                remoteMessages.forEach(msg => {
                    if (!msg.isDeleted) {
                        messages.push(msg)
                    }
                })
            }
            return this.sortMessages(this.toMessageWraps(messages))
        }

        const olderWraps = toAvailableMessageWraps(olderRemoteMessages)
        const newerWraps = toAvailableMessageWraps(newerRemoteMessages)
        const sendingMessages = this.getSendingMessages(this.channel)
        let allMessages = ConversationVM.deduplicateMessages([...olderWraps, ...newerWraps, ...sendingMessages])
        allMessages = this.sortMessages(allMessages)

        const firstSeq = olderWraps.find(msg => msg.messageSeq > 0)?.messageSeq
            || newerWraps.find(msg => msg.messageSeq > 0)?.messageSeq
            || 0
        const lastSeq = [...newerWraps].reverse().find(msg => msg.messageSeq > 0)?.messageSeq
            || [...olderWraps].reverse().find(msg => msg.messageSeq > 0)?.messageSeq
            || 0
        const lastRemoteMessageSeq = this.conversationLastMessageSeq()
        const olderRemoteCount = olderRemoteMessages?.length || 0
        const newerRemoteCount = newerRemoteMessages?.length || 0

        this.pulldownFinished = firstSeq > 0
            ? firstSeq <= 1
            : olderRemoteCount <= 0
        if (lastRemoteMessageSeq > 0 && lastSeq > 0) {
            this.pullupHasMore = lastSeq < lastRemoteMessageSeq
        } else {
            this.pullupHasMore = newerRemoteCount >= newerOpts.limit
        }

        if (!this.pullupHasMore && this.pendingMessages.length > 0) {
            allMessages = this.sortMessages([...allMessages, ...this.pendingMessages])
            this.pendingMessages = []
        }

        this.messagesOfOrigin = allMessages
        this.refreshMessages(this.messagesOfOrigin, () => {
            this.loading = false
            if (stateCallback) {
                stateCallback()
            }
            this.ensureBotChannelInfos()
        })
    }

    private getMessageSortOrder(message: MessageWrap): number {
        if (message.messageSeq && message.messageSeq > 0) {
            return message.messageSeq * OrderFactor
        }
        if (Number.isFinite(message.order) && message.order > 0) {
            return message.order
        }
        const timestamp = Number.isFinite(message.timestamp) && message.timestamp > 0 ? message.timestamp : 0
        const clientSeq = Number.isFinite(message.clientSeq) && message.clientSeq > 0 ? message.clientSeq : 0
        return PendingMessageOrderBase + timestamp * 1000 + clientSeq
    }

    sortMessages(messages: MessageWrap[]) {
        return messages.sort((a, b) => {
            const orderDiff = this.getMessageSortOrder(a) - this.getMessageSortOrder(b)
            if (orderDiff !== 0) {
                return orderDiff
            }
            const timestampDiff = (a.timestamp || 0) - (b.timestamp || 0)
            if (timestampDiff !== 0) {
                return timestampDiff
            }
            const clientSeqDiff = (a.clientSeq || 0) - (b.clientSeq || 0)
            if (clientSeqDiff !== 0) {
                return clientSeqDiff
            }
            return (a.clientMsgNo || "").localeCompare(b.clientMsgNo || "")
        })
    }

    // 按 clientMsgNo 去重，保留最后一次出现（实时消息优先于历史拉取）
    // clientMsgNo 为空时用 messageID 作为 fallback，两者均空则直接保留（不去重）
    static deduplicateMessages(messages: MessageWrap[]): MessageWrap[] {
        const seen = new Map<string, MessageWrap>()
        const noKey: MessageWrap[] = []
        for (const msg of messages) {
            const key = msg.clientMsgNo || msg.messageID?.toString()
            if (!key) {
                noKey.push(msg)
                continue
            }
            seen.set(key, msg)
        }
        return [...Array.from(seen.values()), ...noKey]
    }

    // 刷新消息列表并定位到某条消息
    refreshAndLocateMessages(messages: MessageWrap[], locateMessage?: MessageWrap, scrollBottom?: boolean, callback?: () => void, locateOffsetY: number = 0) {
        this.refreshMessages(messages, () => {
            if (locateMessage) {
                this.scrollToMessage(locateMessage, locateOffsetY)
            } else if (scrollBottom) {
                this.scrollToBottom(false)
            }
            if (callback) {
                callback()
            }
        })
    }

    // 去重频繁的系统提示消息（如安全警告），同一内容在5分钟内只保留第一条
    deduplicateSystemTips(messages: Array<MessageWrap>): Array<MessageWrap> {
        const minIntervalSec = 300 // 5 minutes
        const lastSeenMap = new Map<string, number>() // displayText -> timestamp
        return messages.filter((m) => {
            // Only process system messages (content_type 1000-2000)
            if (m.contentType < 1000 || m.contentType > 2000) return true
            const content = m.content as SystemContent
            const text = content?.displayText
            if (!text) return true
            const lastTimestamp = lastSeenMap.get(text)
            if (lastTimestamp !== undefined && Math.abs(m.timestamp - lastTimestamp) < minIntervalSec) {
                return false // skip duplicate within interval
            }
            lastSeenMap.set(text, m.timestamp)
            return true
        })
    }

    // 过滤 1:1 私聊消息的 Space 隔离
    // 对所有 Person 类型频道（包括系统 Bot 和普通用户）按 space_id 过滤
    // 规则：payload 有 space_id 且匹配当前 Space → 显示
    //       payload 有 space_id 且不匹配 → 隐藏
    //       payload 无 space_id（历史消息）→ 所有 Space 都显示（向前兼容）
    filterPersonMessagesBySpace(messages: MessageWrap[]): MessageWrap[] {
        if (this.channel.channelType !== ChannelTypePerson) {
            return messages
        }
        const currentSpaceId = WKApp.shared.currentSpaceId
        if (!currentSpaceId) {
            return messages // 无 Space 上下文，不过滤
        }
        return messages.filter((m) => {
            const msgSpaceId = m.message?.content?.contentObj?.space_id
            if (!msgSpaceId) {
                // 系统 Bot（BotFather）无 space_id 的旧消息不显示（每个 Space 独立上下文）
                if (SYSTEM_BOTS.has(this.channel.channelID)) return false
                return true // 普通私聊：旧消息向前兼容
            }
            return msgSpaceId === currentSpaceId
        })
    }

    // 刷新消息列表
    refreshMessages(messages: MessageWrap[], callback?: () => void, options?: { allowFoldAnimation?: boolean }) {
        // 单点归一（#465）：content 整体缺失的畸形消息（如 payload.type=text 但
        // 解码失败）会让 SDK 的 Message.contentType getter 以及 MessageWrap 的
        // flame / parts 解引用 undefined 而崩页，且这一步发生在下面排序 / 去重 /
        // 渲染读取 contentType 之前。这里在任何 contentType 读取之前补一个空文本
        // content，让畸形消息渲染成空气泡而非拖垮整个消息列表。
        for (const m of messages) {
            if (m.message.content == null) {
                m.message.content = new MessageText("")
            }
        }
        let newMessages = messages
        // 渲染前先按 order（seq）排序，防止延迟推送/重连补推导致消息位置错乱
        newMessages = this.sortMessages(newMessages)
        this.distinctMessages(newMessages)
        newMessages = this.filterPersonMessagesBySpace(newMessages)
        newMessages = this.deduplicateSystemTips(newMessages)
        newMessages = this.insertTimeOrHistorySplit(newMessages)
        for (let i = 0; i < newMessages.length; i++) {
            const message = newMessages[i]
            if (message.contentType === MessageContentType.text) {
                // 防御畸形文本消息：content 整体缺失时跳过，避免读取 undefined.text 崩溃（#465）。
                const content = message.content
                if (content) {
                    content.text = ProhibitwordsService.shared.filter(content.text)
                }
            }
        }
        this.messages = this.genMessageLinkedData(newMessages)
        this.rebuildRenderItems(options?.allowFoldAnimation || false)

        this.notifyListener(() => {
            if (callback) {
                callback()
            }
        })
    }

    // 向下拉取消息
    async pulldownMessages() {

        const minMessage = this.getMessageMin();
        if (minMessage?.messageSeq === 1) { // 如果最小messageSeq=1 说明下拉没消息了直接return
            return
        }
        if (minMessage == null || minMessage.messageSeq <= 0) { // 没有消息直接return
            return
        }

        const viewport = document.getElementById(this.messageContainerId) as HTMLElement | null
        const previousScrollTop = viewport?.scrollTop || 0
        const previousScrollHeight = viewport?.scrollHeight || 0

        this.loading = true
        const opts = new SyncMessageOptions()
        opts.limit = WKApp.config.pageSizeOfMessage
        opts.pullMode = PullMode.Down
        opts.startMessageSeq = minMessage.messageSeq - 1

        let remoteMessages = await WKApp.conversationProvider.syncMessages(this.channel, opts)
        const newMessages = new Array<Message>()
        if (remoteMessages && remoteMessages.length > 0) {
            remoteMessages.forEach(msg => {
                if (!msg.isDeleted) {
                    newMessages.push(msg)
                }
            });
        }
        if (remoteMessages.length <= 0 || remoteMessages[0].messageSeq === 1) {
            this.pulldownFinished = true
        }
        this.messagesOfOrigin = [...this.toMessageWraps(newMessages), ...this.messagesOfOrigin]
        this.messagesOfOrigin = ConversationVM.deduplicateMessages(this.messagesOfOrigin)
        this.messagesOfOrigin = this.sortMessages(this.messagesOfOrigin)
        this.refreshMessages(this.messagesOfOrigin, () => {
            const nextViewport = document.getElementById(this.messageContainerId) as HTMLElement | null
            if (nextViewport) {
                nextViewport.scrollTop = getPulldownRestoredScrollTop({
                    previousScrollHeight,
                    previousScrollTop,
                    nextScrollHeight: nextViewport.scrollHeight,
                })
            }
            this.loading = false
        })
    }

    // 向上拉取消息
    async pullupMessages() {
        this.loading = true
        const maxMessage = this.getMessageMax()
        if (maxMessage == null || maxMessage.messageSeq <= 0) { // 没有消息直接return
            return
        }

        const opts = new SyncMessageOptions()
        opts.limit = WKApp.config.pageSizeOfMessage
        opts.pullMode = PullMode.Up
        opts.startMessageSeq = maxMessage.messageSeq

        let remoteMessages = await WKApp.conversationProvider.syncMessages(this.channel, opts)
        const newMessages = new Array<Message>()
        if (remoteMessages && remoteMessages.length > 0) {
            remoteMessages.forEach(msg => {
                if (!msg.isDeleted) {
                    newMessages.push(msg)
                }
            });
        }
        if (remoteMessages.length < opts.limit) {
            this.pullupHasMore = false
        } else {
            this.pullupHasMore = true
        }
        this.messagesOfOrigin = [...this.messagesOfOrigin, ...this.toMessageWraps(newMessages)]
        // pullup 结束后 flush 缓冲的实时消息 (#246)
        if (!this.pullupHasMore && this.pendingMessages.length > 0) {
            this.messagesOfOrigin.push(...this.pendingMessages)
            this.pendingMessages = []
        }
        this.messagesOfOrigin = ConversationVM.deduplicateMessages(this.messagesOfOrigin)
        this.refreshAndLocateMessages(this.messagesOfOrigin, undefined, false, () => {
            this.loading = false
        })
    }

    // 获取当前消息列表的最小序列号的消息
    getMessageMin(): MessageWrap | undefined {
        if (this.messagesOfOrigin && this.messagesOfOrigin.length > 0) {
            let lastMsg = this.messagesOfOrigin[0];
            return lastMsg;
        }
    }
    // 获取当前消息列表的最小序列号的消息
    getMessageMax(): MessageWrap | undefined {
        if (this.messagesOfOrigin && this.messagesOfOrigin.length > 0) {
            let maxMessage = this.messagesOfOrigin[0]
            for (const message of this.messagesOfOrigin) {
                if (this.getMessageSortOrder(message) > this.getMessageSortOrder(maxMessage)) {
                    maxMessage = message
                }
            }
            return maxMessage
        }
    }

    // 生成消息链表结构
    genMessageLinkedData(messages: Array<MessageWrap>) {
        if (messages) {
            for (let i = 0; i < messages.length; i++) {
                const message = messages[i]
                message.preMessage = undefined
                message.nextMessage = undefined
                if (i === 0 && messages.length > 1) {
                    message.nextMessage = messages[i + 1]
                } else {
                    message.preMessage = messages[i - 1]
                    messages[i - 1].nextMessage = message
                }
            }
        }
        return messages
    }

    // 插入时间或历史消息分割线
    insertTimeOrHistorySplit(messages: Array<MessageWrap>) {
        const newMessages = new Array<MessageWrap>()
        const shouldShowHistorySplit = this.shouldShowHistorySplit
        if (messages && messages.length > 0) {
            for (let i = 0; i < messages.length; i++) {
                const message = messages[i]
                if (newMessages.length === 0) {
                    const timeMessage = this.getTimeMessage(message.timestamp)
                    newMessages.push(new MessageWrap(timeMessage))
                } else {
                    const preMessage = newMessages[newMessages.length - 1]
                    if (preMessage.contentType !== MessageContentTypeConst.time && preMessage.contentType !== MessageContentTypeConst.historySplit && this.formatMessageTime(preMessage) !== this.formatMessageTime(message)) {
                        const timeMessage = this.getTimeMessage(message.timestamp)
                        newMessages.push(new MessageWrap(timeMessage))
                    }
                }
                newMessages.push(message)
                if (shouldShowHistorySplit && this.initLocateMessageSeq && this.initLocateMessageSeq > 0 && message.messageSeq === this.initLocateMessageSeq) {
                    newMessages.push(new MessageWrap(this.getHistorySplit()))
                }
            }
        }
        return newMessages
    }

    // 获取时间消息
    getTimeMessage(timestamp: number): Message {
        const message = new Message()
        message.timestamp = timestamp
        message.clientMsgNo = timestamp.toString()
        message.content = new TimeContent(timestamp)
        return message
    }

    // 格式化时间
    formatMessageTime(message: MessageWrap) {
        return moment(message.timestamp * 1000).format('YYYY-MM-DD');
    }

    // 获取历史分割线消息
    getHistorySplit() {
        const message = new Message()
        message.timestamp = new Date().getTime() / 10000
        message.clientMsgNo = `split-${message.timestamp}`
        message.content = new HistorySplitContent()
        return message
    }

    // 消息去重
    distinctMessages(messages: Array<MessageWrap>) {
        for (let i = 0; i < messages.length; i++) {
            for (let j = i + 1; j < messages.length; j++) {
                if (messages[i].clientMsgNo && messages[i].clientMsgNo !== '' && messages[i].clientMsgNo === messages[j].clientMsgNo) {
                    messages.splice(j, 1)
                    j--;
                }
            }
        }
    }
    private messageScrollElement(message: MessageWrap): HTMLElement | null {
        const foldSession = message.messageSeq && message.messageSeq > 0
            ? this.findFoldSessionByMessageSeq(message.messageSeq)
            : undefined
        if (foldSession?.isExpanded) {
            const expandedElement = document.getElementById(this.foldSessionMessageElementId(message))
            if (expandedElement) {
                return expandedElement
            }
        }
        if (!foldSession && message.messageSeq && message.messageSeq > 0) {
            const seqElement = this.messageSeqElement(message.messageSeq)
            if (seqElement) {
                return seqElement
            }
        }
        const element = document.getElementById(message.clientMsgNo)
        if (element) {
            return element
        }
        if (!foldSession) {
            return null
        }
        return document.getElementById(foldSession.anchorId)
    }

    private scrollTopForElement(viewport: HTMLElement, element: HTMLElement, keepOffsetY: number): number {
        const viewportRect = viewport.getBoundingClientRect()
        const elementRect = element.getBoundingClientRect()
        const hasRectLayout = viewportRect.height > 0
            || elementRect.height > 0
            || viewportRect.top !== 0
            || elementRect.top !== 0

        if (hasRectLayout) {
            const anchorOffsetTop = viewport.scrollTop + elementRect.top - viewportRect.top
            return getRestoredAnchorScrollTop({
                anchorOffsetTop,
                keepOffsetY,
            })
        }

        return getRestoredAnchorScrollTop({
            anchorOffsetTop: element.offsetTop,
            keepOffsetY,
        })
    }

    // 滚动到指定的消息
    scrollToMessage(message: MessageWrap, offsetY: number = 0) {
        const viewport = document.getElementById(this.messageContainerId)
        const element = this.messageScrollElement(message)
        const keepOffsetY = Number.isFinite(offsetY) ? Math.max(0, offsetY) : 0
        if (viewport && element) {
            viewport.scrollTop = this.scrollTopForElement(viewport, element, keepOffsetY)
            return
        }
        scroller.scrollTo(message.clientMsgNo, {
            containerId: this.messageContainerId,
            "duration": 0,
        });
        if (keepOffsetY > 0) {
            const restoreOffset = () => {
                const nextViewport = document.getElementById(this.messageContainerId)
                if (nextViewport) {
                    nextViewport.scrollTop += keepOffsetY
                }
            }
            if (typeof requestAnimationFrame === "function") {
                requestAnimationFrame(restoreOffset)
            } else {
                setTimeout(restoreOffset, 0)
            }
        }
    }
    // 只滚动到底部
    scrollToBottom(animate: boolean) {
        const opts: any = {
            containerId: this.messageContainerId,
        }
        if (animate) {
            opts.smooth = true
            opts.duration = 200.0
        } else {
            opts.duration = 0.0
        }
        animateScroll.scrollToBottom(opts);

    }

    // 获取当前发送中的消息
    getSendingMessages(channel: Channel) {
        return this.reconcileSendingMessages(channel)
    }
    // 获取当前发送中的消息
    getSendingMessageWithClientMsgNo(clientMsgNo: string) {

        let sending = ConversationVM.sendQueue.get(this.channel.getChannelKey());
        if (!sending || sending.length === 0) {
            return
        }
        for (const message of sending) {
            if (message.clientMsgNo === clientMsgNo) {
                return message
            }
        }
    }
    // Message转换为MessageWrap
    toMessageWraps(messages: Array<Message>): Array<MessageWrap> {
        const messageWraps = new Array<MessageWrap>()
        if (messages) {
            for (const message of messages) {
                messageWraps.push(new MessageWrap(message))
            }
        }
        return messageWraps
    }

    // 发送消息
    async sendMessage(content: MessageContent, channel: Channel): Promise<Message> {
        // 解散守卫（最底层）：所有走 vm.sendMessage 的入口最终都汇到这里再调
        // chatManager.send，因此守卫下沉到此处即可覆盖输入框发送、重发等路径。
        // 转发（单条 / 多选 / 合并）现在走 ForwardService.send 独立发送路径，
        // 在 Service 层内部也做了 isConversationDisbanded 过滤（见 ForwardService.ts）；
        // 两条路径互不依赖，各自保留 disband 守卫，互为保险。
        // 群/子区解散后只读，直接 reject——组件层 sendMessage/resendMessage 另有 toast。
        if (isConversationDisbanded(channel)) {
            return Promise.reject(new Error("group disbanded"))
        }
        // 发送前注入两类业务字段（详细原因见 sendContentProxy.ts header）：
        //   1. space_id —— 仅 DM (ChannelTypePerson)，让 BotFather 等 Bot
        //      知道用户当前 Space (#784)。
        //   2. mention.humans / mention.ais —— 任意 channel（DM + Group）。
        //      `wukongimjssdk@1.3.5` 的 `MessageContent.encode()` 丢弃 mention
        //      的 humans/ais 三态字段。群聊里 @所有AI 后 server 收不到
        //      `mention.ais=1`，AI bot 不响应（octo-web#62 / YUJ-1378）。
        //
        // wrapSendContentForInjection 不会污染原始 content（重要：转发场景
        // 同一 content 可能被多目标复用，直接 monkey-patch 会有副作用）。
        const spaceId = WKApp.shared.currentSpaceId
        const mentionAny = content.mention as any
        const sendContent = wrapSendContentForInjection(content, {
            spaceId: channel.channelType === ChannelTypePerson ? spaceId : null,
            mentionHumans: !!(mentionAny && mentionAny.humans),
            mentionAis: !!(mentionAny && mentionAny.ais),
        })
        const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel)
        let setting = new Setting()
        if (channelInfo?.orgData.receipt === 1) {
            setting.receiptEnabled = true
        }
        const message = await WKSDK.shared().chatManager.send(sendContent, channel, setting)
        // dmwork-web#1069 R5：SDK 内部 `Message.fromSendPacket` 产物的 Message，
        // wire 不携带 from_home_space_* 等字段；在业务层收尾统一补一次，避免自发送
        // bubble 丢外部来源标识。已有值不覆盖、失败静默。
        applyMsgLevelExternalFieldsWithFallback(message, undefined)
        const messageWrap = new MessageWrap(message)
        this.fillOrder(messageWrap)

        this.addSendMessageToQueue(messageWrap)
        return message
    }

    // 填充消息排序的序号
    fillOrder(message: MessageWrap) {
        if (message.messageSeq && message.messageSeq !== 0) {
            message.order = OrderFactor * message.messageSeq
            return
        }
        const maxMessage = this.getMessageMax()

        if (maxMessage) {
            if (message.clientMsgNo === maxMessage.clientMsgNo) {
                if (maxMessage.preMessage) {
                    message.order = this.getMessageSortOrder(maxMessage.preMessage) + 1
                } else {
                    message.order = OrderFactor + 1
                }

            } else {
                message.order = this.getMessageSortOrder(maxMessage) + 1
            }

        } else {
            message.order = OrderFactor + 1
        }
    }
    // 放入到队列内
    addSendMessageToQueue(message: MessageWrap) {
        const channelKey = message.channel.getChannelKey()
        let sendingMessages = ConversationVM.sendQueue.get(channelKey)
        if (!sendingMessages) {
            sendingMessages = new Array<MessageWrap>()
        }
        sendingMessages.push(message)
        ConversationVM.sendQueue.set(channelKey, sendingMessages)
    }
}
