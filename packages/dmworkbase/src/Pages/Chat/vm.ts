import WKSDK, { MessageContentType } from "wukongimjssdk";
import { ChannelInfoListener } from "wukongimjssdk";
import { ConnectStatus, ConnectStatusListener } from "wukongimjssdk";
import { ConversationAction, ConversationListener } from "wukongimjssdk";
import { Channel, ChannelInfo, Conversation, Message, ChannelTypePerson } from "wukongimjssdk";
import WKApp, { MessageDeleteListener } from "../../App";
import { ConversationWrap } from "../../Service/Model";
import { ProviderListener } from "../../Service/Provider";
import { animateScroll, scroller } from 'react-scroll';
import { ProhibitwordsService } from "../../Service/ProhibitwordsService";
import { shouldSkipChannelForSpace, shouldSkipSystemBotConversation } from "../../Service/SpaceService";
import { EndpointID } from "../../Service/Const";
import { ShowConversationOptions } from "../../EndpointCommon";
import { Space, SpaceService } from "../../Service/SpaceService";
import { isSafeUrl } from "../../Utils/security";


const TOP_CONVERSATION_SCORE_BOOST = 1000000000000;
export class ChatVM extends ProviderListener {
    conversations: ConversationWrap[] = new Array()
    loading: boolean = false // 最近会话是否加载中
    private _connectTitle: string = "" // 连接标题
    connectStatus: number = 0 // 0=disconnected, 1=connected, 2=connecting
    private _showChannelSetting: boolean = false // 是否显示频道设置
    private _selectedConversation?: ConversationWrap // 选中的最近会话
    private _showAddPopover = false // 点击添加按钮弹出的popover
    private connectStatusListener!: ConnectStatusListener
    private conversationListener!: ConversationListener
    private channelListener!: ChannelInfoListener
    private messageDeleteListener!: MessageDeleteListener
    private conversationListID = "wk-conversationlist"
    private _showGlobalSearch = false // 是否显示全局搜索
    private _selectedSpace?: Space // 选中的 Space
    private _showSpaceCreate = false // 是否显示创建 Space 弹窗
    private _spaceMemberUids: Set<string> = new Set() // 当前 space 的成员 uid 集合

    set showAddPopover(v: boolean) {
        this._showAddPopover = v
        this.notifyListener()
    }

    get showAddPopover() {
        return this._showAddPopover
    }

    set showGlobalSearch(v: boolean) {
        this._showGlobalSearch = v
        this.notifyListener()
    }

    get showGlobalSearch() {
        return this._showGlobalSearch
    }

    set selectedConversation(v: ConversationWrap | undefined) {
        this._selectedConversation = v
        this.notifyListener()
    }

    set showChannelSetting(v: boolean) {
        this._showChannelSetting = v
        this.notifyListener()
    }

    get showChannelSetting() {
        return this._showChannelSetting
    }

    get selectedConversation() {
        return this._selectedConversation
    }

    set connectTitle(v: string) {
        this._connectTitle = v
        this.notifyListener()
    }

    get connectTitle() {
        return this._connectTitle
    }

    set selectedSpace(v: Space | undefined) {
        this._selectedSpace = v
        WKApp.shared.currentSpaceId = v?.space_id || ""
        WKApp.mittBus.emit('space-changed', v)
        if (v) {
            this.loadSpaceMembers(v.space_id)
        } else {
            this._spaceMemberUids = new Set()
        }
        // 切换 Space 时重新同步会话列表
        this.requestConversationList()
    }

    get selectedSpace() {
        return this._selectedSpace
    }

    set showSpaceCreate(v: boolean) {
        this._showSpaceCreate = v
        this.notifyListener()
    }

    get showSpaceCreate() {
        return this._showSpaceCreate
    }

    get filteredConversations(): ConversationWrap[] {
        // Space 模式下，后端 conversation sync 已按 space_id 过滤
        // 前端不再二次过滤，直接返回所有会话
        return this.conversations
    }

    private async loadSpaceMembers(spaceId: string) {
        try {
            const members = await SpaceService.shared.getMembers(spaceId, 1, 10000)
            // Guard against race condition: only update if this space is still selected
            if (this._selectedSpace?.space_id !== spaceId) {
                return
            }
            this._spaceMemberUids = new Set(members.map((m) => m.uid))
        } catch {
            if (this._selectedSpace?.space_id !== spaceId) {
                return
            }
            this._spaceMemberUids = new Set()
        }
        this.notifyListener()
    }

    private spaceChangedHandler?: (space: any) => void

    didMount(): void {
        // 监听 Space 切换（来自全局顶栏 SpaceList）
        this.spaceChangedHandler = (_space: any) => {
            // 确保 currentSpaceId 已更新（防止事件时序问题）
            if (_space?.space_id) {
                WKApp.shared.currentSpaceId = _space.space_id
            }
            WKSDK.shared().conversationManager.conversations = []
            this.selectedConversation = undefined // 清空选中的会话
            WKApp.shared.openChannel = undefined // 清空全局打开的频道
            this._showChannelSetting = false // 关闭频道设置面板
            // 强制关闭右侧聊天窗口，防止跨 Space 消息污染
            WKApp.routeRight.popToRoot()
            WKApp.shared.notifyListener()
            this.requestConversationList()
        }
        WKApp.mittBus.on('space-changed', this.spaceChangedHandler)

        // 根据连接状态设置标题
        this.setConnectTitleWithConnectStatus(WKSDK.shared().connectManager.status)

        if (WKSDK.shared().connectManager.status == ConnectStatus.Connected) { // 如果已经连接则直接加载
            this.reloadRequestConversationList()
        }

        // 监听im连接状态
        this.connectStatusListener = (status: ConnectStatus, reasonCode?: number) => {
            this.setConnectTitleWithConnectStatus(WKSDK.shared().connectManager.status)
            if (status === ConnectStatus.Connected) {
                // 请求最近会话列表
                this.reloadRequestConversationList()
            }
        }
        WKSDK.shared().connectManager.addConnectStatusListener(this.connectStatusListener)

        // ---------- 最近会话 ----------
        this.conversationListener = (conversation: Conversation, action: ConversationAction) => {

            const channelInfo = WKSDK.shared().channelManager.getChannelInfo(conversation.channel)
            if (!channelInfo) {
                WKSDK.shared().channelManager.fetchChannelInfo(conversation.channel)
            }
            if (action === ConversationAction.add) {
                // Space 过滤：只添加属于当前 Space 的会话
                if (shouldSkipChannelForSpace(conversation.channel)) {
                    return
                }
                if (shouldSkipSystemBotConversation(conversation)) {
                    return
                }
                if (conversation.lastMessage?.content && conversation.lastMessage?.contentType === MessageContentType.text) {
                    conversation.lastMessage.content.text = ProhibitwordsService.shared.filter(conversation.lastMessage?.content.text)
                }
                this.conversations = [new ConversationWrap(conversation), ...this.conversations]
                this.notifyListener()
            } else if (action === ConversationAction.update) {
                // Space 过滤：忽略不属于当前 Space 的会话更新
                if (shouldSkipChannelForSpace(conversation.channel)) {
                    return
                }
                if (shouldSkipSystemBotConversation(conversation)) {
                    return
                }
                const existConversation = this.findConversation(conversation.channel)
                if (existConversation) {
                    existConversation.conversation = conversation
                    if (existConversation.lastMessage?.content && existConversation.lastMessage?.contentType === MessageContentType.text) {
                        existConversation.lastMessage.content.text = ProhibitwordsService.shared.filter(existConversation.lastMessage?.content.text)
                    }
                }

                this.sortConversations()
                const conversationY = this.currentConversationListY()
                this.notifyListener(() => {
                    if (conversationY) {
                        this.keepPosition(conversationY)
                    }
                })
            } else if (action === ConversationAction.remove) {
                this.removeConversation(conversation.channel)
            }
        }
        WKSDK.shared().conversationManager.addConversationListener(this.conversationListener)

        this.channelListener = (channelInfo: ChannelInfo) => {
            const conversation = this.findConversation(channelInfo.channel)
            if (conversation) {
                conversation.extra.top = channelInfo.top ? 1 : 0
                this.sortConversations()
                this.notifyListener()
            }
        }
        WKSDK.shared().channelManager.addListener(this.channelListener)

        this.messageDeleteListener = (message: Message, preMessage?: Message) => {
            const conversation = WKSDK.shared().conversationManager.findConversation(message.channel)
            if (conversation) {
                if (conversation.lastMessage && conversation.lastMessage.clientMsgNo === message.clientMsgNo) {
                    conversation.lastMessage = preMessage
                    WKSDK.shared().conversationManager.notifyConversationListeners(conversation, ConversationAction.update)
                }
            }
        }
        WKApp.shared.addMessageDeleteListener(this.messageDeleteListener)

    }
    didUnMount(): void {
        WKSDK.shared().connectManager.removeConnectStatusListener(this.connectStatusListener)
        WKSDK.shared().conversationManager.removeConversationListener(this.conversationListener)
        WKSDK.shared().channelManager.removeListener(this.channelListener)
        WKApp.shared.removeMessageDeleteListener(this.messageDeleteListener)
        if (this.spaceChangedHandler) {
            WKApp.mittBus.off('space-changed', this.spaceChangedHandler)
        }
    }

    findConversation(channel: Channel) {
        if (this.conversations) {
            for (const conversation of this.conversations) {
                if (conversation.channel.isEqual(channel)) {
                    return conversation
                }
            }
        }
    }

    keepPosition(y: number) {
        animateScroll.scrollTo(y, {
            containerId: this.conversationListID,
            "duration": 0,
        })
    }
    currentConversationListY() {
        const conversationElem = document.getElementById(this.conversationListID)
        if (!conversationElem) {
            return
        }
        return conversationElem.scrollTop
    }

    removeConversation(channel: Channel) {
        if (this.conversations) {
            for (let i = 0; i < this.conversations.length; i++) {
                const conversation = this.conversations[i]
                if (conversation.channel.isEqual(channel)) {
                    this.conversations.splice(i, 1)
                    this.notifyListener()
                    break
                }
            }
        }
    }

    async clearMessages(channel: Channel) {

        const conversationWrap = this.findConversation(channel)
        if (!conversationWrap) {
            return
        }
        await WKApp.conversationProvider.clearConversationMessages(conversationWrap.conversation)
        conversationWrap.conversation.lastMessage = undefined
        conversationWrap.conversation.unread = 0
        WKApp.endpointManager.invoke(EndpointID.clearChannelMessages, channel)
        this.sortConversations()
        this.notifyListener()
    }

    setConnectTitleWithConnectStatus(connectStatus: ConnectStatus) {
        if (connectStatus === ConnectStatus.Connected) {
            this.connectStatus = 1
            this.connectTitle = WKApp.config.appName
        } else if (connectStatus === ConnectStatus.Disconnect) {
            this.connectStatus = 0
            this.connectTitle = WKApp.config.appName
        } else {
            this.connectStatus = 2
            this.connectTitle = WKApp.config.appName
        }
    }

    // 排序最近会话列表
    sortConversations(conversations?: Array<ConversationWrap>) {
        let newConversations = conversations;
        if (!newConversations) {
            newConversations = this.conversations
        }
        if (!newConversations || newConversations.length <= 0) {
            return [];
        }
        let sortAfter = newConversations.sort((a, b) => {
            let aScore = a.timestamp;
            let bScore = b.timestamp;
            if (a.extra?.top === 1) {
                aScore += TOP_CONVERSATION_SCORE_BOOST;
            }
            if (b.extra?.top === 1) {
                bScore += TOP_CONVERSATION_SCORE_BOOST;
            }
            return bScore - aScore;
        });
        return sortAfter
    }

    async requestConversationList() {

        this.loading = true
        // 切换 Space 时清空 SDK 内部缓存和当前列表，避免旧 Space 会话残留
        WKSDK.shared().conversationManager.conversations = []
        this.conversations = []
        this.notifyListener()
        const conversationWraps = new Array<ConversationWrap>()
        const conversations = await WKSDK.shared().conversationManager.sync({})
        if (conversations && conversations.length > 0) {
            for (const conversation of conversations) {
                // Space 过滤：复用共享函数（含 channelSpaceMap 缓存）
                if (shouldSkipChannelForSpace(conversation.channel)) {
                    continue
                }
                if (shouldSkipSystemBotConversation(conversation)) {
                    continue
                }
                conversationWraps.push(new ConversationWrap(conversation))
            }
        }
        this.conversations = conversationWraps
        this.loading = false

        this.sortConversations()

        this.notifyListener()
        WKApp.menus.refresh() // Fix #3: 切换 Space 后刷新 badge
    }

    async reloadRequestConversationList() {
        const conversationWraps = new Array<ConversationWrap>()
        const conversations = await WKSDK.shared().conversationManager.sync({})
        if (conversations && conversations.length > 0) {
            for (const conversation of conversations) {
                // Space 过滤：复用共享函数（含 channelSpaceMap 缓存）
                if (shouldSkipChannelForSpace(conversation.channel)) {
                    continue
                }
                if (shouldSkipSystemBotConversation(conversation)) {
                    continue
                }
                if (conversation.lastMessage?.content && conversation.lastMessage?.contentType == MessageContentType.text) {
                    conversation.lastMessage.content.text = ProhibitwordsService.shared.filter(conversation.lastMessage.content.text)
                }
                conversationWraps.push(new ConversationWrap(conversation))
            }
        }
        this.conversations = conversationWraps
        this.sortConversations()

        this.notifyListener()

        WKApp.menus.refresh()
    }
}

// 处理搜索内容点击事件
export async function handleGlobalSearchClick(item: any, type: string,hideModal?:()=>void) {
    if (type === "contacts") {
        if (item.channel_type === ChannelTypePerson) {
            // 个人频道/Bot：通过 users API 检查好友关系
            try {
                const resp = await WKApp.apiClient.get(`users/${item.channel_id}`)
                if (resp.follow === 1) {
                    if(hideModal){
                        hideModal()
                    }
                    WKApp.endpoints.showConversation(new Channel(item.channel_id, item.channel_type))
                } else {
                    if(hideModal){
                        hideModal()
                    }
                    WKApp.shared.baseContext.showUserInfo(item.channel_id, new Channel(item.channel_id, item.channel_type))
                }
            } catch {
                // API 失败时降级到资料页
                if(hideModal){
                    hideModal()
                }
                WKApp.shared.baseContext.showUserInfo(item.channel_id, new Channel(item.channel_id, item.channel_type))
            }
        } else {
            // 非个人频道（如群组）直接进入会话
            if(hideModal){
                hideModal()
            }
            WKApp.endpoints.showConversation(new Channel(item.channel_id, item.channel_type))
        }
    } else if (type === "group") {
        if(hideModal){
            hideModal()
        }
        WKApp.endpoints.showConversation(new Channel(item.channel_id, item.channel_type))
    } else if (type === "message") {
        const opts = new ShowConversationOptions()
        opts.initLocateMessageSeq = item.message_seq
        if(hideModal){
            hideModal()
        }
        WKApp.endpoints.showConversation(new Channel(item.channel.channel_id, item.channel.channel_type), opts)
    } else if (type === "file") {
        // 下载文件
        const payload = item.payload
        let downloadURL = WKApp.dataSource.commonDataSource.getImageURL(payload.url || '')
        if (downloadURL.indexOf("?") != -1) {
            downloadURL += "&filename=" + encodeURIComponent(payload.name)
        } else {
            downloadURL += "?filename=" + encodeURIComponent(payload.name)
        }
        // Validate URL protocol to prevent XSS attacks (fixes #347)
        if (isSafeUrl(downloadURL)) {
            window.open(`${downloadURL}`, 'top');
        }
    }
}