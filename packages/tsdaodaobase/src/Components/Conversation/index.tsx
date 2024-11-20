import { Channel, ChannelTypeGroup, ChannelTypePerson, ConversationAction, WKSDK, Mention, Message, MessageContent, Reminder, ReminderType, Reply,MessageText } from "wukongimjssdk";
import React, { Component, HTMLProps } from "react";
import Provider from "../../Service/Provider";
import ConversationVM from "./vm";
import "./index.css"
import { MessageWrap } from "../../Service/Model";
import WKApp from "../../App";
import { RevokeCell } from "../../Messages/Revoke";
import {  MessageContentTypeConst } from "../../Service/Const";
import ConversationContext from "./context";
import MessageInput, { MentionModel, MessageInputContext } from "../MessageInput";
import ContextMenus, { ContextMenusContext } from "../ContextMenus";
import classNames from "classnames";
import WKAvatar from "../WKAvatar";
import { IconClose } from "@douyinfe/semi-icons";
import { Toast, Spin } from "@douyinfe/semi-ui";
import { FlameMessageCell } from "../../Messages/Flame";

export interface ConversationProps {
    channel: Channel
    chatBg?: string // 聊天背景
    shouldShowHistorySplit?: boolean
    initLocateMessageSeq?: number
    onContext?: (ctx: ConversationContext) => void
}



export class Conversation extends Component<ConversationProps> implements ConversationContext {
    vm!: ConversationVM
    contextMenusContext!: ContextMenusContext
    avatarMenusContext!: ContextMenusContext // 点击头像弹出的菜单
    _messageInputContext!: MessageInputContext
    scrollTimer: number | null = null
    updateBrowseToMessageSeqAndReminderDoneing: boolean = false
    private _dragFileCallback?: (file: File) => void

    constructor(props: any) {
        super(props)
        this.state = {
        }
    }


    async sendMessage(content: MessageContent, channel?: Channel): Promise<Message> {
        // const { channel } = this.props
        let c = channel
        if (!c) {
            c = this.props.channel
        }
        const message = await this.vm.sendMessage(content, c)
        return message
    }

    fowardMessageUI(message: Message): void {
        WKApp.shared.baseContext.showConversationSelect((channels: Channel[]) => {
            let cloneContent = message.content // TODO:这里理论上需要clone一份 但是不clone也没发现问题
            for (const channel of channels) {
                this.sendMessage(cloneContent, channel)
            }
        })
    }
    async resendMessage(message: Message): Promise<Message> {
        await this.vm.deleteMessagesFromLocal([message])
        const newMessage = await this.vm.sendMessage(message.content, message.channel)
        return newMessage
    }
    scrollToBottom(animate?: boolean): void {
        this.vm.scrollToBottom(animate || false)
    }
    insertText(text: string): void {
        this.messageInputContext().insertText(text)
    }
    editOn(): boolean {
        return this.vm.editOn
    }
    setEditOn(edit: boolean): void {
        this.vm.editOn = edit
        if (this.vm.selectMessage && edit) {
            this.vm.checkedMessage(this.vm.selectMessage, true)
        }
    }
    checkeMessage(message: Message, checked: boolean): void {
        this.vm.checkedMessage(message, checked)
    }
    deleteMessages(messages: Message[]): void {
        this.vm.deleteMessages(messages)
    }
    revokeMessage(message: Message): Promise<void> {
        return this.vm.revokeMessage(message)
    }
    onTapAvatar(uid: string, event: React.MouseEvent<Element, MouseEvent>): void {

        this.vm.selectUID = uid
        this.avatarMenusContext.show(event)
    }

    // 定位消息
    locateMessage(messageSeq: number) {
        const messageWrap = this.vm.findMessageWithMessageSeq(messageSeq)
        if (messageWrap) { // 本地存在则直接滚动到消息位置即可
            this.vm.scrollToMessage(messageWrap)
            messageWrap.locateRemind = true
            this.vm.notifyListener()
            return
        }
        // 本地不存在，则需要远程获取后再定位到消息
        this.vm.requestMessagesOfFirstPage(messageSeq, () => {
            const newMessageWrap = this.vm.findMessageWithMessageSeq(messageSeq)
            if (newMessageWrap) {
                newMessageWrap.locateRemind = true
                this.vm.notifyListener()
            }
            return
        })
    }

    // 显示用户信息
    showUser(uid: string) {
        let fromChannel: Channel | undefined
        let vercode: string | undefined
        if (this.vm.channel.channelType === ChannelTypeGroup) {
            fromChannel = this.vm.channel
            const subscriber = this.vm.subscriberWithUID(uid)
            if (subscriber?.orgData?.vercode) {
                vercode = subscriber?.orgData?.vercode
            }
        }
        WKApp.shared.baseContext.showUserInfo(uid, fromChannel, vercode)
    }

    // 回复消息
    reply(message: Message): void {
        if (message.fromUID !== WKApp.loginInfo.uid) {
            const channelInfo = WKSDK.shared().channelManager.getChannelInfo(new Channel(message.fromUID, ChannelTypePerson))
            let name = ""
            if (channelInfo) {
                name = channelInfo.title
            }
            this._messageInputContext.addMention(message.fromUID, name)

        }
        this.vm.currentReplyMessage = message
    }

    setDragFileCallback(f: (file: File) => void): void {
        this._dragFileCallback = f
    }

    channel(): Channel {
        return this.vm.channel
    }

    // 显示消息上下文菜单
    showContextMenus(message: Message, event: React.MouseEvent) {
        this.vm.selectMessage = message
        this.contextMenusContext.show(event)
    }
    hideContextMenus(): void {
        this.contextMenusContext.hide()
    }

    messageInputContext(): MessageInputContext {
        return this._messageInputContext
    }


    componentDidMount() {

        const { channel, onContext } = this.props
        if (onContext) {
            onContext(this)
        }
        WKApp.shared.openChannel = channel
        if (this.vm.hasDraft()) {
            this.insertText(this.vm.draft())
        }

        window.onbeforeunload = () => { // 浏览器关闭
            console.log("浏览器关闭--->")
            this.dealloc()
        }

        this.vm.onFirstMessagesLoaded = () => {
            this.updateBrowseToMessageSeqAndReminderDoneIfNeed()

            this.uploadReadedIfNeed()
        }

    }


    componentWillUnmount() {
        this.dealloc()
    }
    dealloc() {
        this.vm.markUnread()
        this.markConversationExtra()
        WKApp.shared.openChannel = undefined
        WKSDK.shared().conversationManager.openConversation = undefined
    }



    markConversationExtra() {
        let draft = this.messageInputContext().text()
        const conversationLastMessageSeq = this.vm.conversationLastMessageSeq()
        const lastVisiableMessage = this.lastVisiableMessage(null)
        let keepMessageSeq = 0
        if (lastVisiableMessage && lastVisiableMessage.messageSeq >= conversationLastMessageSeq) {
            keepMessageSeq = 0
        } else {
            const firstVisiableMessage = this.firstVisiableMessage(null)
            keepMessageSeq = firstVisiableMessage?.messageSeq || 0
        }

        WKApp.dataSource.channelDataSource.conversationExtraUpdate({
            channel: this.vm.channel,
            browseTo: 0,
            keepMessageSeq: keepMessageSeq,
            keepOffsetY: 0,
            draft: draft || "",
            version: 0,
        })
    }

    _handleContextMenus(event: React.MouseEvent) {
        this.contextMenusContext.show(event)
    }

    messageUI(message: MessageWrap, last: boolean) {
        let MessageCell: React.ElementType | undefined
        if (message.revoke) {
            MessageCell = RevokeCell
        } else if (message.flame) {
            MessageCell = FlameMessageCell
        } else {
            MessageCell = WKApp.messageManager.getCell(message.contentType)

        }
        return <div onAnimationEnd={() => {
            message.locateRemind = false;
            this.setState({})
        }} key={message.clientMsgNo} id={`${message.contentType === MessageContentTypeConst.time ? "time-" : ""}${message.clientMsgNo}`} className={classNames("wk-message-item", last ? "wk-message-item-last" : undefined, message.locateRemind ? 'wk-message-item-reminder' : undefined)} >
            {
                MessageCell ? <MessageCell key={message.clientMsgNo} message={message} context={this} /> : null
            }

        </div>
    }

    handleScroll(e: any) {
        if (this.scrollTimer) {
            clearTimeout(this.scrollTimer)
            this.scrollTimer = null
        }
        this.scrollTimer = window.setTimeout(() => {
            this.handleScrollEnd()
        }, 500) 
        this.contextMenusContext.hide()
        const targetScrollTop = e.target.scrollTop;
        const scrollOffsetTop = e.target.scrollHeight - (targetScrollTop + e.target.clientHeight);
        if (targetScrollTop <= 250 && !this.vm.loading && !this.vm.pulldownFinished) { // 下拉
            this.vm.pulldownMessages()
        } else if (scrollOffsetTop <= 500 && !this.vm.loading && this.vm.pullupHasMore) { // 上拉
            this.vm.pullupMessages()
        }
        if (this.vm.lastMessage) {
            this.vm.lastLocalMessageElement = document.getElementById(this.vm.lastMessage?.clientMsgNo) // 最新消息
            if (this.vm.lastLocalMessageElement) { // 如果有最新消息的dom则判断是否在可见范围内
                if (scrollOffsetTop > this.vm.lastLocalMessageElement.clientHeight + 20) { // 如果滚动距离超过了第一个元素则显示“滚动到底部”
                    this.vm.showScrollToBottomBtn = true
                } else {
                    this.vm.showScrollToBottomBtn = false
                }
            } else {
                this.vm.showScrollToBottomBtn = true
            }
        }

        this.updateBrowseToMessageSeqAndReminderDoneIfNeed()

    }

    handleScrollEnd() {
        this.uploadReadedIfNeed()
    }

    // 上传已读数据
    uploadReadedIfNeed() {
        const viewport = document.getElementById(this.vm.messageContainerId)
        const visiableMessages = this.allVisiableMessages(viewport)
        if (visiableMessages && visiableMessages.length > 0) {
            const unreadMessages = new Array<Message>()
            for (const visiableMessage of visiableMessages) {
                if (!visiableMessage.remoteExtra.readed && visiableMessage.fromUID !== WKApp.loginInfo.uid && visiableMessage.setting.receiptEnabled) {
                    unreadMessages.push(visiableMessage.message)
                }
            }
            WKSDK.shared().receiptManager.addReceiptMessages(this.channel(), unreadMessages)
        }

    }

    // 更新已读位置和提醒项
    updateBrowseToMessageSeqAndReminderDoneIfNeed() {
        const viewport = document.getElementById(this.vm.messageContainerId)

        this.updateBrowseToMessageSeq(viewport) // 更新已读位置

        this.updateReminderDoneIfNeed(viewport) // 更新提醒项
    }

    // 更新已预览的位置
    updateBrowseToMessageSeq(viewport: HTMLElement | null) {
        const lastVisiableMessage = this.lastVisiableMessage(viewport) // 当前UI显示的最后一条可见的消息
        if (lastVisiableMessage && lastVisiableMessage.messageSeq > this.vm.browseToMessageSeq) { // 如果当前UI显示的最后一条消息大于已预览到的最新消息，则更新未读数
            this.vm.browseToMessageSeq = lastVisiableMessage.messageSeq
            this.vm.refreshNewMsgCount() // 刷新最新消息数量
        }
    }

    // 更新提醒项
    updateReminderDoneIfNeed(viewport: HTMLElement | null) {
        if (!this.vm.messages || this.vm.messages.length === 0) {
            return
        }

        const reminders = this.vm.currentConversation?.reminders
        if (!reminders || reminders.length == 0) {
            return
        }
        let change = false
        for (const reminder of reminders) {
            if (reminder.done) {
                continue
            }
            const message = this.vm.findMessageWithMessageSeq(reminder.messageSeq)
            if (message && this.isVisiableMessage(message.message, viewport)) {
                reminder.done = true
                change = true
                continue
            }
        }
        if (change) {
            const conversation = WKSDK.shared().conversationManager.findConversation(this.channel())
            if (conversation) {
                conversation.reminders = reminders
                WKSDK.shared().conversationManager.notifyConversationListeners(conversation, ConversationAction.update)
            }
            this.vm.notifyListener()
        }

    }

    // 消息是否可见
    isVisiableMessage(message: Message, viewport: HTMLElement | null) {
        if (!viewport) {
            return
        }
        const targetScrollTop = viewport.scrollTop;
        const scrollOffsetTop = viewport.scrollHeight - (targetScrollTop + viewport.clientHeight);

        const element = document.getElementById(message.clientMsgNo)
        if (element) {
            if (viewport.scrollHeight - element.offsetTop > scrollOffsetTop && element.offsetTop + element.clientHeight > targetScrollTop) {
                return true
            }
        }
        return false
    }
    // 获取最后一个可见的消息
    lastVisiableMessage(viewport: HTMLElement | null) {
        if (!this.vm.messages || this.vm.messages.length === 0) {
            return
        }
        if (!viewport) {
            viewport = document.getElementById(this.vm.messageContainerId)
        }
        if (!viewport) {
            return
        }
        const targetScrollTop = viewport.scrollTop;
        const scrollOffsetTop = viewport.scrollHeight - (targetScrollTop + viewport.clientHeight);

        for (let index = this.vm.messages.length - 1; index >= 0; index--) {
            const message = this.vm.messages[index];
            const element = document.getElementById(message.clientMsgNo)
            if (element) {
                if (viewport.scrollHeight - element.offsetTop > scrollOffsetTop) {
                    return message
                }
            }
        }
    }

    // 获取第一个可见的消息
    firstVisiableMessage(vp: HTMLElement | null) {
        if (!this.vm.messages || this.vm.messages.length === 0) {
            return
        }
        let viewport = vp
        if (!viewport) {
            viewport = document.getElementById(this.vm.messageContainerId)
        }
        if (!viewport) {
            return
        }
        const targetScrollTop = viewport.scrollTop;
        // const scrollOffsetTop = viewport.scrollHeight - (targetScrollTop + viewport.clientHeight);
        for (let index = 0; index < this.vm.messages.length; index++) {
            const message = this.vm.messages[index];
            const element = document.getElementById(message.clientMsgNo)
            if (element) {
                if (element.offsetTop + element.clientHeight > targetScrollTop) {
                    return message
                }
            }
        }
    }
    // 所有可见的消息
    allVisiableMessages(vp: HTMLElement | null):Array<MessageWrap> {
        const visiableMessages = new Array<MessageWrap>()
        if (!this.vm.messages || this.vm.messages.length === 0) {
            return visiableMessages
        }
        let viewport = vp
        if (!viewport) {
            viewport = document.getElementById(this.vm.messageContainerId)
        }
        if (!viewport) {
            return visiableMessages
        }
        
        const targetScrollTop = viewport.scrollTop;
        for (let index = 0; index < this.vm.messages.length; index++) {
            const message = this.vm.messages[index];
            const element = document.getElementById(message.clientMsgNo)
            if (element) {
                if (element.offsetTop + element.clientHeight / 2 > targetScrollTop) { // message 要漏出来一半才算可见
                    visiableMessages.push(message)
                }
            }
        }
        return visiableMessages
    }

    chatToolbarUI() {
        const toolbars = WKApp.endpoints.chatToolbars(this)
        return <ul className="wk-conversation-chattoolbars">
            {
                toolbars.map((t, i) => {
                    return <li key={i} className="wk-conversation-chattoolbars-item" >
                        {t}
                    </li>
                })
            }
        </ul>
    }

    dragEnd() {
        this.vm.fileDragEnter = false
        this.vm.fileDragLeave = true
        this.vm.notifyListener()
    }
    dragStart() {
        this.vm.fileDragEnter = true
        this.vm.fileDragLeave = false
        this.vm.notifyListener()
    }

    render() {
        const { chatBg, channel } = this.props

        const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel)

        return <Provider create={() => {
            this.vm = new ConversationVM(channel)
            return this.vm
        }} render={(vm: ConversationVM) => {
            return <>
                <div className={classNames("wk-conversation", vm.fileDragEnter ? "wk-conversation-dragover" : undefined, vm.currentReplyMessage ? "wk-conversation-hasreply" : undefined)} style={{ "background": chatBg ? `url(${chatBg}) rgb(245, 247, 249)` : undefined }}>

                    <div onDragOver={(event) => {
                        event.preventDefault()
                    }} onDragEnter={(event) => {
                        event.preventDefault()
                        this.dragStart()

                    }} className={classNames("wk-conversation-content")}>
                        <div className="wk-conversation-messages" id={vm.messageContainerId} onScroll={this.handleScroll.bind(this)}>
                            {
                                vm.messages.map((message, i) => {
                                    let last = false
                                    if (i === vm.messages.length - 1) {
                                        last = true
                                    }
                                    return this.messageUI(message, last)
                                })
                            }

                            {/* 位置view */}
                            <ConversationPositionView onScrollToBottom={async () => {
                                return this.vm.onDownArrow()
                            }} onReminder={(reminder) => {
                                return this.vm.syncMessages(reminder.messageSeq,()=>{
                                    const newMessageWrap = this.vm.findMessageWithMessageSeq(reminder.messageSeq)
                                    if (newMessageWrap) {
                                        newMessageWrap.locateRemind = true // 设置为闪烁提醒
                                        this.vm.notifyListener()
                                    }
                                })
                            }} showScrollToBottom={vm.showScrollToBottomBtn || false} unreadCount={vm.unreadCount} reminders={vm.currentConversation?.reminders?.filter(r => !r.done)}>

                            </ConversationPositionView>

                            {
                                vm.fileDragEnter ? <div className="wk-conversation-content-fileupload-mask" onDragOver={(event) => {
                                    event.preventDefault()
                                }} onDragLeave={(event) => {
                                    event.preventDefault()
                                    this.dragEnd()
                                }} onDrop={(event) => {
                                    event.preventDefault()
                                    this.dragEnd()
                                    const file = event.dataTransfer.files[0]
                                    if (this._dragFileCallback) {
                                        this._dragFileCallback(file)
                                    }
                                }}>
                                    <div className="wk-conversation-content-fileupload-mask-content">
                                        发送给 &nbsp; {channelInfo?.title}
                                    </div>
                                </div> : undefined
                            }

                        </div>
                    </div>
                    <div className="wk-conversation-topview">
                        {
                            vm.currentReplyMessage ? <ReplyView message={vm.currentReplyMessage} onClose={() => {
                                vm.currentReplyMessage = undefined
                            }}></ReplyView> : undefined
                        }
                    </div>
                    <div className={classNames("wk-conversation-multiplepanel", vm.editOn ? "wk-conversation-multiplepanel-show" : undefined)}>
                        <MultiplePanel onClose={() => {
                            vm.editOn = false
                            vm.unCheckAllMessages()
                        }} onForward={() => {
                            WKApp.shared.baseContext.showConversationSelect((channels: Channel[]) => {
                                const messages = vm.getCheckedMessages()
                                if (!messages || messages.length === 0) {
                                    Toast.error("请先选择消息！")
                                    return
                                }
                                for (const message of messages) {
                                    let cloneContent = message.content // TODO:这里理论上需要clone一份 但是不clone也没发现问题
                                    for (const channel of channels) {
                                        this.sendMessage(cloneContent, channel)
                                    }
                                }
                                vm.editOn = false
                                vm.unCheckAllMessages()

                            })
                        }} onMergeForward={() => {
                            WKApp.shared.baseContext.showConversationSelect((channels: Channel[]) => {
                                vm.sendMergeforward(channels)
                                vm.editOn = false
                                vm.unCheckAllMessages()
                            })
                        }} onDelete={async () => {
                            const checkedMessagewraps = vm.getCheckedMessages()
                            const checkedMessages = checkedMessagewraps.map((m) => {
                                return m.message
                            })
                            await vm.deleteMessages(checkedMessages)

                            vm.editOn = false
                            vm.unCheckAllMessages()
                        }}></MultiplePanel>
                    </div>
                    <div className="wk-conversation-footer">
                        <div className="wk-conversation-footer-content">

                            <MessageInput members={this.vm.subscribers.filter((s) => s.uid !== WKApp.loginInfo.uid)} onContext={(ctx) => {
                                this._messageInputContext = ctx
                            }} toolbar={this.chatToolbarUI()} context={this} onSend={(text: string, mention?: MentionModel) => {
                                const content = new MessageText(text)
                                if (mention) {
                                    const mn = new Mention()
                                    mn.all = mention.all
                                    mn.uids = mention.uids
                                    content.mention = mn
                                }
                                if (vm.currentReplyMessage) {
                                    const reply = new Reply()
                                    reply.messageID = vm.currentReplyMessage.messageID
                                    reply.messageSeq = vm.currentReplyMessage.messageSeq
                                    reply.fromUID = vm.currentReplyMessage.fromUID
                                    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(new Channel(vm.currentReplyMessage.fromUID, ChannelTypePerson))
                                    if (channelInfo) {
                                        reply.fromName = channelInfo.title
                                    }
                                    reply.content = vm.currentReplyMessage.content
                                    content.reply = reply
                                    vm.currentReplyMessage = undefined
                                }
                                this.sendMessage(content)
                            }}>

                            </MessageInput>
                        </div>
                    </div>
                </div>
                <ContextMenus onContext={(ctx) => {
                    this.contextMenusContext = ctx
                }} menus={vm.selectMessage ? WKApp.endpoints.messageContextMenus(vm.selectMessage, this).map((menus) => {
                    return {
                        title: menus.title, onClick: () => {
                            if (menus.onClick) {
                                menus.onClick()
                            }
                        }
                    }
                }) : []}></ContextMenus>
                <ContextMenus onContext={(ctx) => {
                    this.avatarMenusContext = ctx
                }} menus={[{
                    title: "@TA",
                    onClick: () => {
                        if (!this.vm.selectUID) {
                            return
                        }
                        const channel = new Channel(this.vm.selectUID, ChannelTypePerson)
                        const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel)

                        this.messageInputContext().addMention(this.vm.selectUID, channelInfo?.title || "")
                    }
                }, {
                    title: "查看用户信息",
                    onClick: () => {
                        if (!this.vm.selectUID) {
                            return
                        }
                        let fromChannel: Channel | undefined
                        let vercode: string | undefined
                        if (this.vm.channel.channelType === ChannelTypeGroup) {
                            fromChannel = this.vm.channel
                            const subscriber = this.vm.subscriberWithUID(this.vm.selectUID)
                            if (subscriber?.orgData?.vercode) {
                                vercode = subscriber?.orgData?.vercode
                            }
                        }
                        WKApp.shared.baseContext.showUserInfo(this.vm.selectUID, fromChannel, vercode)

                    }
                }]} />
            </>
        }}>

        </Provider>
    }
}

interface ConversationPositionViewProps extends HTMLProps<any> {
    showScrollToBottom: boolean // 是否显示滚动到底部
    reminders: Reminder[] | undefined //  提醒项
    unreadCount: number // 未读数量
    onScrollToBottom: () => Promise<void> // 滚动到底部
    onReminder: (reminder: Reminder) => Promise<void>
}

interface ConversationPositionViewState {
    loading: Map<number, boolean>
}

class ConversationPositionView extends Component<ConversationPositionViewProps, ConversationPositionViewState> {
    constructor(props: ConversationPositionViewProps) {
        super(props)
        this.state = {
            loading: new Map(),
        }
    }
    getReminderIcon(reminderType: ReminderType) {
        switch (reminderType) {
            case ReminderType.ReminderTypeMentionMe:
                return "./assets/reminder_mention.png"
            case ReminderType.ReminderTypeApplyJoinGroup:
                return "./assets/reminder_member_invite.png"
        }
    }

    getReminderTypes(reminders: Reminder[] | undefined) {
        if (!reminders || reminders.length == 0) {
            return []
        }
        const types = new Set<number>()
        if (reminders && reminders.length > 0) {
            for (const reminder of reminders) {
                types.add(reminder.reminderType)
            }
        }
        return Array.from(types)
    }

    getRemindersWithType(type: ReminderType) {
        const { reminders } = this.props
        const newReminders = new Array<Reminder>()
        if (reminders && reminders.length > 0) {
            for (const reminder of reminders) {
                if (reminder.reminderType === type) {
                    newReminders.push(reminder)
                }
            }
        }
        return newReminders
    }

    render(): React.ReactNode {
        const { loading } = this.state
        const { showScrollToBottom, unreadCount, onScrollToBottom, reminders, onReminder } = this.props
        const types = this.getReminderTypes(reminders)
        return <div className="wk-conversationpositionview">
            <ul>
                {
                    types && types.map((type) => {
                        const typeReminders = this.getRemindersWithType(type)
                        return <li key={type}>
                            <div className={classNames("wk-conversationpositionview-item", "wk-reveale")} onClick={async () => {
                                if (onReminder) {
                                    if (typeReminders && typeReminders.length > 0) {
                                        loading.set(type, true)
                                        this.setState({
                                            loading: loading,
                                        })
                                        await onReminder(typeReminders[0])
                                        loading.set(type, false)
                                        this.setState({
                                            loading: loading,
                                        })
                                    }
                                }
                            }}>
                                {
                                    this.getReminderIcon(type) ? (
                                        loading.get(type) ? <Spin spinning={true}></Spin> : <img src={require(`${this.getReminderIcon(type)}`)}></img>
                                    ) : undefined
                                }

                                {
                                    typeReminders.length > 0 ? <div className="wk-conversation-unread-count">{typeReminders.length}</div> : null
                                }
                            </div>
                        </li>
                    })
                }

                <li>
                    <div className={classNames("wk-conversationpositionview-item", showScrollToBottom ? "wk-reveale" : undefined)} onClick={async () => {
                        if (onScrollToBottom) {
                            loading.set(-1, true)
                            this.setState({
                                loading: loading,
                            })
                            await onScrollToBottom()
                            loading.set(-1, false)
                            this.setState({
                                loading: loading,
                            })
                        }
                    }}>
                        {loading.get(-1) ? <Spin spinning={true}></Spin> : <img src={require("./assets/message_down.png")}></img>}
                        {
                            unreadCount > 0 ? <div className="wk-conversation-unread-count">{unreadCount}</div> : null
                        }
                    </div>
                </li>
            </ul>

        </div>
    }
}


interface ReplyViewProps {
    message: Message
    onClose?: () => void
}
class ReplyView extends Component<ReplyViewProps> {
    render(): React.ReactNode {
        const { message, onClose } = this.props
        const fromChannelInfo = WKSDK.shared().channelManager.getChannelInfo(new Channel(message.fromUID, ChannelTypePerson))
        return <div className="wk-replyview">
            <div className="wk-replyview-close" onClick={() => {
                if (onClose) {
                    onClose()
                }
            }}>
                <IconClose className="wk-replyview-close-icon" />
            </div>
            <div className="wk-replyview-content">
                <div className="wk-replyview-content-first">
                    <div className="wk-replyview-content-userinfo">
                        <div className="wk-replyview-content-userinfo-avatar">
                            <WKAvatar style={{ "width": "24px", "height": "24px", "borderRadius": "50%" }} channel={new Channel(message.fromUID, ChannelTypePerson)}></WKAvatar>
                        </div>
                        <div className="wk-replyview-content-userinfo-name">
                            {
                                fromChannelInfo?.title
                            }
                        </div>
                    </div>
                </div>
                <div className="wk-replyview-content-second">
                    <div className="wk-replyview-content-msg">
                        {message.content.conversationDigest}
                    </div>
                </div>
            </div>
        </div>
    }
}


interface MultiplePanelProps {
    onClose?: () => void
    onForward?: () => void // 逐条转发
    onMergeForward?: () => void // 合并转发
    onDelete?: () => void // 删除
}
class MultiplePanel extends Component<MultiplePanelProps> {

    render(): React.ReactNode {
        const { onClose, onForward, onMergeForward, onDelete } = this.props
        return <div className="wk-multiplepanel">
            <div className="wk-multiplepanel-close" onClick={() => {
                if (onClose) {
                    onClose()
                }
            }}>
                <IconClose size="large" />
            </div>
            <div className="wk-multiplepanel-content">
                <div className="wk-multiplepanel-content-item" onClick={() => {
                    if (onForward) {
                        onForward()
                    }
                }}>
                    <div className="wk-multiplepanel-content-item-icon">
                        <svg className="wk-multiplepanel-content-item-icon-svg" aria-hidden="true" viewBox="0 0 1024 1024"><path d="M362.666667 704h554.666666a21.333333 21.333333 0 0 1 21.333334 21.333333v42.666667a21.333333 21.333333 0 0 1-21.333334 21.333333H362.666667a21.333333 21.333333 0 0 1-21.333334-21.333333v-42.666667a21.333333 21.333333 0 0 1 21.333334-21.333333zM106.666667 874.666667h810.666666a21.333333 21.333333 0 0 1 21.333334 21.333333v42.666667a21.333333 21.333333 0 0 1-21.333334 21.333333H106.666667a21.333333 21.333333 0 0 1-21.333334-21.333333v-42.666667a21.333333 21.333333 0 0 1 21.333334-21.333333z m427.093333-661.034667V57.152c0-3.84 1.6-7.530667 4.416-10.24a15.36 15.36 0 0 1 21.184 0L846.72 326.122667a21.205333 21.205333 0 0 1 0 30.698666L559.36 635.754667a15.253333 15.253333 0 0 1-10.602667 4.245333 14.72 14.72 0 0 1-14.976-14.485333v-155.733334H503.893333c-116.053333 0-203.946667 22.762667-257.301333 89.792-4.416 5.546667-9.216 11.264-16.256 20.096a8.106667 8.106667 0 0 1-5.248 3.264c-3.989333 0.512-7.125333-1.536-8.128-6.144-2.730667-14.421333-3.626667-29.866667-3.626667-40.746666 0-175.210667 143.466667-322.410667 320.426667-322.410667z m85.333333 85.333333h-85.333333c-80.277333 0-151.914667 41.984-194.453333 104.981334 47.722667-13.44 102.421333-19.52 164.586666-19.52h115.2v74.410666l120.96-117.397333-120.96-117.504v75.029333z"></path></svg>
                    </div>
                    <div className="wk-multiplepanel-content-item-title">
                        逐条转发
                    </div>
                </div>
                <div className="wk-multiplepanel-content-item" onClick={() => {
                    if (onMergeForward) {
                        onMergeForward()
                    }
                }}>
                    <div className="wk-multiplepanel-content-item-icon">
                        <svg className="wk-multiplepanel-content-item-icon-svg" aria-hidden="true" viewBox="0 0 1024 1024"><path d="M362.666667 704h554.666666a21.333333 21.333333 0 0 1 21.333334 21.333333v42.666667a21.333333 21.333333 0 0 1-21.333334 21.333333H362.666667a21.333333 21.333333 0 0 1-21.333334-21.333333v-42.666667a21.333333 21.333333 0 0 1 21.333334-21.333333zM106.666667 874.666667h810.666666a21.333333 21.333333 0 0 1 21.333334 21.333333v42.666667a21.333333 21.333333 0 0 1-21.333334 21.333333H106.666667a21.333333 21.333333 0 0 1-21.333334-21.333333v-42.666667a21.333333 21.333333 0 0 1 21.333334-21.333333z m427.093333-661.034667V57.152c0-3.84 1.6-7.530667 4.416-10.24a15.36 15.36 0 0 1 21.184 0L846.72 326.122667a21.205333 21.205333 0 0 1 0 30.698666L559.36 635.754667a15.253333 15.253333 0 0 1-10.602667 4.245333 14.72 14.72 0 0 1-14.976-14.485333v-155.733334H503.893333c-116.053333 0-203.946667 22.762667-257.301333 89.792-4.416 5.546667-9.216 11.264-16.256 20.096a8.106667 8.106667 0 0 1-5.248 3.264c-3.989333 0.512-7.125333-1.536-8.128-6.144-2.730667-14.421333-3.626667-29.866667-3.626667-40.746666 0-175.210667 143.466667-322.410667 320.426667-322.410667z m85.333333 85.333333h-85.333333c-80.277333 0-151.914667 41.984-194.453333 104.981334 47.722667-13.44 102.421333-19.52 164.586666-19.52h115.2v74.410666l120.96-117.397333-120.96-117.504v75.029333z"></path></svg>
                    </div>
                    <div className="wk-multiplepanel-content-item-title">
                        合并转发
                    </div>
                </div>
                <div className="wk-multiplepanel-content-item" onClick={() => {
                    if (onDelete) {
                        onDelete()
                    }
                }}>
                    <div className="wk-multiplepanel-content-item-icon">
                        <svg className="wk-multiplepanel-content-item-icon-svg" aria-hidden="true" viewBox="0 0 1024 1024"><path d="M362.666667 704h554.666666a21.333333 21.333333 0 0 1 21.333334 21.333333v42.666667a21.333333 21.333333 0 0 1-21.333334 21.333333H362.666667a21.333333 21.333333 0 0 1-21.333334-21.333333v-42.666667a21.333333 21.333333 0 0 1 21.333334-21.333333zM106.666667 874.666667h810.666666a21.333333 21.333333 0 0 1 21.333334 21.333333v42.666667a21.333333 21.333333 0 0 1-21.333334 21.333333H106.666667a21.333333 21.333333 0 0 1-21.333334-21.333333v-42.666667a21.333333 21.333333 0 0 1 21.333334-21.333333z m427.093333-661.034667V57.152c0-3.84 1.6-7.530667 4.416-10.24a15.36 15.36 0 0 1 21.184 0L846.72 326.122667a21.205333 21.205333 0 0 1 0 30.698666L559.36 635.754667a15.253333 15.253333 0 0 1-10.602667 4.245333 14.72 14.72 0 0 1-14.976-14.485333v-155.733334H503.893333c-116.053333 0-203.946667 22.762667-257.301333 89.792-4.416 5.546667-9.216 11.264-16.256 20.096a8.106667 8.106667 0 0 1-5.248 3.264c-3.989333 0.512-7.125333-1.536-8.128-6.144-2.730667-14.421333-3.626667-29.866667-3.626667-40.746666 0-175.210667 143.466667-322.410667 320.426667-322.410667z m85.333333 85.333333h-85.333333c-80.277333 0-151.914667 41.984-194.453333 104.981334 47.722667-13.44 102.421333-19.52 164.586666-19.52h115.2v74.410666l120.96-117.397333-120.96-117.504v75.029333z"></path></svg>
                    </div>
                    <div className="wk-multiplepanel-content-item-title">
                        删除
                    </div>
                </div>
            </div>
        </div>
    }
}