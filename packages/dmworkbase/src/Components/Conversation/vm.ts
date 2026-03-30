import { Channel, ChannelTypeGroup, ChannelTypePerson, ConversationAction, WKSDK, Message, MessageContent, MessageStatus, Subscriber, Conversation, MessageExtra, CMDContent, PullMode, MessageContentType, ChannelInfo, ConversationListener } from "wukongimjssdk";
import WKApp from "../../App";
import { SyncMessageOptions } from "../../Service/DataSource/DataProvider";
import { MessageWrap } from "../../Service/Model";
import { ProviderListener } from "../../Service/Provider";
import { animateScroll, scroller } from 'react-scroll';
import { EndpointID, MessageContentTypeConst, OrderFactor } from "../../Service/Const";
import moment from 'moment'
import { TimeContent } from "../../Messages/Time";
import { HistorySplitContent } from "../../Messages/HistorySplit";
import { MessageListener, MessageStatusListener } from "wukongimjssdk";
import { SendackPacket, Setting } from "wukongimjssdk";
import MergeforwardContent from "../../Messages/Mergeforward";
import { TypingListener, TypingManager } from "../../Service/TypingManager";
import { ProhibitwordsService } from "../../Service/ProhibitwordsService";
import { SYSTEM_BOTS } from "../../Service/SpaceService";
import { SuperGroup } from "../../Utils/const";
import { SystemContent } from "wukongimjssdk";

export default class ConversationVM extends ProviderListener {

    loading: boolean = false // 消息是否加载中
    channel: Channel
    channelInfo?: ChannelInfo // 当前会话的频道详情
    messages: MessageWrap[] = [] // 消息集合 
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
    messageContainerId = "viewport" // 消息容器的ID
    static sendQueue: Map<string, Array<MessageWrap>> = new Map() // 发送队列
    private _needSetUnread: boolean = false // 是否需要设置未读数量

    typingListener!: TypingListener // 输入中监听
    messageListener!: MessageListener // 消息监听
    cmdListener!: MessageListener // cmd消息监听
    messageStatusListener!: MessageStatusListener // 消息状态监听
    conversationListener!: ConversationListener // 会话监听
    subscriberChangeListener!: (channel: Channel) => void // 订阅者变化监听
    lastMessage?: MessageWrap // 此会话的最后一条最新的消息
    lastLocalMessageElement?: HTMLElement | null // 最后一条消息的dom元素
    private _showScrollToBottomBtn?: boolean = false // 是否显示底部按钮
    subscribers: Subscriber[] = []

    fileDragEnter?: boolean // 文件拖拽上传（拖进来了）
    fileDragLeave?: boolean // 文件拖拽上传（拖离开了）

    private _selectMessage?: Message // 右键选中的消息

    selectUID?: string // 点击头像的用户uid

    private _currentReplyMessage?: Message // 当前回复的消息
    private _currentHandlerType: number = 0 // 当前处理类型
    onFirstMessagesLoaded?: Function // 第一屏消息已加载完成

    constructor(channel: Channel, initLocateMessageSeq?: number) {
        super()
        this.channel = channel
        if (initLocateMessageSeq == 0) {
            this.initLocateMessageSeq = undefined
        } else {
            this.initLocateMessageSeq = initLocateMessageSeq
        }
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
            return m.checked
        })
    }

    sendMergeforward(toChannels: Channel[]) {
        let users = new Array<any>();

        let checkedMessages = this.getCheckedMessages().map((messageWrap: MessageWrap) => {
            return messageWrap.message
        })
        if (checkedMessages && checkedMessages.length > 0) {
            const addedUIDs = new Set<string>()
            for (const message of checkedMessages) {
                if (addedUIDs.has(message.fromUID)) continue
                addedUIDs.add(message.fromUID)
                let channelInfo = WKSDK.shared().channelManager.getChannelInfo(new Channel(message.fromUID, ChannelTypePerson))
                users.push({ uid: message.fromUID, name: channelInfo?.title })
            }
        }
        if (toChannels && toChannels.length > 0) {
            for (const destChannel of toChannels) {
                this.sendMessage(new MergeforwardContent(this.channel.channelType, users, checkedMessages), destChannel)
            }
        }
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
                    existMessage.revoker = existMessage.fromUID;
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

        WKApp.endpointManager.setMethod(EndpointID.clearChannelMessages, (channel: Channel) => {
            if (channel.isEqual(this.channel)) {
                if (this.messagesOfOrigin.length > 0) {
                    this.browseToMessageSeq = this.messagesOfOrigin[this.messagesOfOrigin.length - 1].messageSeq
                }
                this.messagesOfOrigin = []
                this.messages = []
                this.lastMessage = undefined
                this.notifyListener()
            }
        }, {})

        if (this.channel.channelType === ChannelTypeGroup) {

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
        })

        // 订阅 task 上传失败事件（module.tsx 全局触发，这里仅处理当前 channel）
        WKApp.mittBus.on("task-upload-failed", this._taskUploadFailedHandler)

    }
    // task 上传失败通知处理器（module.tsx 的全局订阅 emit，这里接收并刷新 UI）
    private _taskUploadFailedHandler = (data: { channelKey: string }) => {
        if (data.channelKey === this.channel.getChannelKey()) {
            this.notifyListener()
        }
    }

    didUnMount(): void {
        this.markReminderDones()
        WKSDK.shared().chatManager.removeMessageListener(this.messageListener)
        WKSDK.shared().chatManager.removeMessageStatusListener(this.messageStatusListener)
        WKApp.endpointManager.removeMethod(EndpointID.clearChannelMessages)
        WKSDK.shared().chatManager.removeCMDListener(this.cmdListener)

        TypingManager.shared.removeTypingListener(this.typingListener)
        WKSDK.shared().conversationManager.removeConversationListener(this.conversationListener)
        WKSDK.shared().channelManager.removeSubscriberChangeListener(this.subscriberChangeListener)
        this.pendingMessages = [] // 清理缓冲区

        WKApp.mittBus.off("task-upload-failed", this._taskUploadFailedHandler)
    }

    // 加载频道信息完成
    async loadChannelInfoFinished() {
        if (this.channel.channelType !== ChannelTypeGroup) {
            return
        }
        this.reloadSubscribers()
        this.subscriberChangeListener = (channel: Channel) => {
            if (!this.channel.isEqual(channel)) {
                return
            }
            this.reloadSubscribers()
        }
        WKSDK.shared().channelManager.addSubscriberChangeListener(this.subscriberChangeListener)

        if (this.channelInfo?.orgData?.group_type == SuperGroup) {
            // 如果是超级群则只获取第一页成员
            this.subscribers = await this.getFirstPageMembers()
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
        this.notifyListener()
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
            message.message.messageID = ackPacket.messageID.toString()
            message.message.messageSeq = ackPacket.messageSeq
            if (ackPacket.reasonCode === 1) {
                this.updateLastMessageIfNeed(message)
                message.status = MessageStatus.Normal
                this.removeSendingMessageIfNeed(ackPacket.clientSeq, this.channel)
            } else {
                message.status = MessageStatus.Fail
                const sendingMessage = this.getSendingMessageWithClientMsgNo(message.clientMsgNo)
                if (sendingMessage) {
                    sendingMessage.reasonCode = ackPacket.reasonCode
                    this.fillOrder(sendingMessage)
                }

            }
            message.reasonCode = ackPacket.reasonCode
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
            if(message.content.reply === undefined){
                continue
            }
            if (message.content.reply.messageID && message.content.reply.messageID === extra.messageID) {
                message.content.reply.content = extra.contentEdit
            }
        }
        this.notifyListener()
    }
    // 通过clientSeq获取消息对象
    findMessageWithClientSeq(clientSeq: number): MessageWrap | undefined {
        if (!this.messages || this.messages.length <= 0) {
            return
        }
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const message = this.messages[i]
            if (message.clientSeq === clientSeq) {
                return message
            }
        }
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
        this.messagesOfOrigin.push(messageWrap)

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
        })
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
    refreshNewMsgCount() {

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
                WKSDK.shared().conversationManager.notifyConversationListeners(conversation, ConversationAction.update)
            }
            // 未读数变为0时立即同步到服务端，防止会话列表同步时拿到旧的未读数
            if (this.unreadCount === 0 && oldUnreadCount > 0) {
                WKApp.conversationProvider.markConversationUnread(this.channel, 0)
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

        this.initLocateMessageSeq = 0
        if (lcateMessageSeq === undefined) {
            if (this.currentConversation) {
                const remoteExtra = this.currentConversation.remoteExtra
                if (this.currentConversation.unread > 0) {
                    if (remoteExtra.keepMessageSeq != 0 && remoteExtra.keepMessageSeq < this.browseToMessageSeq) {
                        this.initLocateMessageSeq = remoteExtra.keepMessageSeq
                    } else {
                        this.initLocateMessageSeq = this.browseToMessageSeq
                    }

                } else {
                    this.initLocateMessageSeq = remoteExtra.keepMessageSeq
                }
            }
        } else {
            this.initLocateMessageSeq = lcateMessageSeq
        }
        return this.syncMessages(this.initLocateMessageSeq, stateCallback)
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
    async syncMessages(initMessageSeq?: number, stateCallback?: () => void) {
        this.loading = true
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

        this.messagesOfOrigin = allMessages
        this.refreshAndLocateMessages(allMessages, initMessage, true, () => {
            this.loading = false
            if (stateCallback) {
                stateCallback()
            }
        })
    }
    sortMessages(messages: MessageWrap[]) {
        return messages.sort((a, b) => {
            return a.order - b.order
        })
    }

    // 刷新消息列表并定位到某条消息
    refreshAndLocateMessages(messages: MessageWrap[], locateMessage?: MessageWrap, scrollBottom?: boolean, callback?: () => void) {
        this.refreshMessages(messages, () => {
            if (locateMessage) {
                this.scrollToMessage(locateMessage)
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
    refreshMessages(messages: MessageWrap[], callback?: () => void) {
        let newMessages = messages
        this.distinctMessages(newMessages)
        newMessages = this.filterPersonMessagesBySpace(newMessages)
        newMessages = this.deduplicateSystemTips(newMessages)
        newMessages = this.insertTimeOrHistorySplit(newMessages)
        for (let i = 0; i < newMessages.length; i++) {
            const message = newMessages[i]
            if (message.contentType === MessageContentType.text) {
                message.content.text = ProhibitwordsService.shared.filter(message.content.text)
            }
        }
        this.messages = this.genMessageLinkedData(newMessages)

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
        this.messagesOfOrigin = this.sortMessages(this.messagesOfOrigin)
        this.refreshAndLocateMessages(this.messagesOfOrigin, minMessage, false, () => {
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
            let lastMsg = this.messagesOfOrigin[this.messagesOfOrigin.length - 1];
            return lastMsg;
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
        return moment(message.timestamp * 1000).format('MM月DD日');
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
    // 滚动到指定的消息
    scrollToMessage(message: MessageWrap) {
        scroller.scrollTo(message.clientMsgNo, {
            containerId: this.messageContainerId,
            "duration": 0,
        });
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
        let channelKey = channel.getChannelKey();
        let sending = ConversationVM.sendQueue.get(channelKey);
        return sending || [];
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
        // DM 消息注入 space_id，让 BotFather 等 Bot 知道用户当前 Space
        const spaceId = WKApp.shared.currentSpaceId
        if (spaceId && channel.channelType === ChannelTypePerson) {
            const originalEncodeJSON = content.encodeJSON.bind(content)
            content.encodeJSON = () => {
                const obj = originalEncodeJSON()
                obj.space_id = spaceId
                return obj
            }
            // 同步 contentObj，让本地回显也通过 filterPersonMessagesBySpace (#784)
            if (content.contentObj) {
                content.contentObj.space_id = spaceId
            } else {
                content.contentObj = { space_id: spaceId }
            }
        }
        const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel)
        let setting = new Setting()
        if (channelInfo?.orgData.receipt === 1) {
            setting.receiptEnabled = true
        }
        const message = await WKSDK.shared().chatManager.send(content, channel, setting)
        const messageWrap = new MessageWrap(message)

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
                    message.order = maxMessage.preMessage.order + 1
                } else {
                    message.order = OrderFactor + 1
                }

            } else {
                message.order = maxMessage.order + 1
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