import WKSDK, { MessageContentType } from "wukongimjssdk";
import { ChannelInfoListener } from "wukongimjssdk";
import { ConnectStatus, ConnectStatusListener } from "wukongimjssdk";
import { ConversationAction, ConversationListener } from "wukongimjssdk";
import { Channel, ChannelInfo, Conversation, Message, ChannelTypePerson, ChannelTypeGroup } from "wukongimjssdk";
import WKApp, { MessageDeleteListener } from "../../App";
import { ConversationWrap } from "../../Service/Model";
import { ProviderListener } from "../../Service/Provider";
import { animateScroll, scroller } from 'react-scroll';
import { ProhibitwordsService } from "../../Service/ProhibitwordsService";
import { shouldSkipChannelForSpace, shouldSkipPersonConversationForSpace, hasSpacePrefix } from "../../Service/SpaceService";
import { EndpointID } from "../../Service/Const";
import { ShowConversationOptions } from "../../EndpointCommon";
import { Space, SpaceService } from "../../Service/SpaceService";
import { isSafeUrl } from "../../Utils/security";
import { downloadFile } from "../../Utils/download";


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
    private _pendingSpaceConversations: Map<string, Conversation> = new Map() // 等待 channelInfo 的新群会话

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
            this._pendingSpaceConversations.clear()
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
                // 新群补写 channelSpaceMap 缓存（WS 推送新群时缓存可能未命中）
                if (conversation.channel.channelType === ChannelTypeGroup) {
                    const key = `${conversation.channel.channelID}_${conversation.channel.channelType}`
                    if (!WKApp.shared.channelSpaceMap.has(key)) {
                        // 尝试从多个来源同步获取 space_id
                        const info = WKSDK.shared().channelManager.getChannelInfo(conversation.channel)
                        const sid = info?.orgData?.space_id
                            || conversation.channelInfo?.orgData?.space_id
                        if (sid) {
                            WKApp.shared.channelSpaceMap.set(key, sid)
                        } else if (WKApp.shared.currentSpaceId && !hasSpacePrefix(conversation.channel.channelID)) {
                            // Fix: fail-open — 新群假定属于当前 Space，先展示
                            // 建群 API 已带 space_id，channelInfo 异步返回后会补写正确值
                            // 下次 Space 切换时 requestConversationList() 会用真实缓存重新过滤
                            WKApp.shared.channelSpaceMap.set(key, WKApp.shared.currentSpaceId)
                        }
                    }
                }
                // Space 过滤：只添加属于当前 Space 的会话
                if (shouldSkipChannelForSpace(conversation.channel)) {
                    return
                }
                if (shouldSkipPersonConversationForSpace(conversation)) return
                if (conversation.lastMessage?.content && conversation.lastMessage?.contentType === MessageContentType.text) {
                    conversation.lastMessage.content.text = ProhibitwordsService.shared.filter(conversation.lastMessage?.content.text)
                }
                const existingConv = this.findConversation(conversation.channel)
                if (existingConv) {
                    existingConv.conversation = conversation
                } else {
                    this.conversations = [new ConversationWrap(conversation), ...this.conversations]
                }
                this.notifyListener()
            } else if (action === ConversationAction.update) {
                // 缓存未命中时异步补写，避免 fail-close 误丢群聊
                if (conversation.channel.channelType === ChannelTypeGroup) {
                    const key = `${conversation.channel.channelID}_${conversation.channel.channelType}`
                    if (!WKApp.shared.channelSpaceMap.has(key)) {
                        // 缓存未命中：暂存 conversation，等 channelInfoListener 回调补写缓存后再处理
                        this._pendingSpaceConversations.set(key, conversation)
                        WKSDK.shared().channelManager.fetchChannelInfo(conversation.channel)
                        return // 等待 channelInfoListener 回调处理
                    }
                }
                // Space 过滤：忽略不属于当前 Space 的会话更新
                if (shouldSkipChannelForSpace(conversation.channel)) {
                    return
                }
                if (shouldSkipPersonConversationForSpace(conversation)) return
                const existConversation = this.findConversation(conversation.channel)
                if (existConversation) {
                    existConversation.conversation = conversation
                    // WS 更新后有条件清除 spaceLastMessage (#783)
                    // 只在新消息属于当前 Space 时清除（有更新的实时消息可用）
                    // 新消息属于其他 Space 时保留（spaceLastMessage 仍是当前 Space 的最佳预览）
                    if (conversation.extra) {
                        const newMsgSpaceId = conversation.lastMessage?.content?.contentObj?.space_id
                        const currentSpaceId = WKApp.shared.currentSpaceId
                        if (!currentSpaceId || !newMsgSpaceId || newMsgSpaceId === currentSpaceId) {
                            conversation.extra.spaceLastMessage = undefined
                        }
                    }
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
            // 群聊 channelInfo 到达时，更新 channelSpaceMap 并做 Space 二次过滤
            if (channelInfo.channel?.channelType === ChannelTypeGroup && channelInfo.orgData?.space_id) {
                const key = `${channelInfo.channel.channelID}_${channelInfo.channel.channelType}`
                WKApp.shared.channelSpaceMap.set(key, channelInfo.orgData.space_id)
                // 如果该群不属于当前 Space，移除会话
                if (shouldSkipChannelForSpace(channelInfo.channel)) {
                    this.removeConversation(channelInfo.channel)
                    return
                }
            }
            const conversation = this.findConversation(channelInfo.channel)
            if (conversation) {
                conversation.extra.top = channelInfo.top ? 1 : 0
                this.sortConversations()
                this.notifyListener()
            } else if (channelInfo.channel.channelType === ChannelTypeGroup) {
                // 新群 channelInfo 异步返回：用真实 space_id 纠正 fail-open 假定值 + 补插遗漏的会话
                const key = `${channelInfo.channel.channelID}_${channelInfo.channel.channelType}`
                const sid = channelInfo.orgData?.space_id
                if (sid) {
                    WKApp.shared.channelSpaceMap.set(key, sid)
                }
                // Bug #744: 优先从待定队列取回会话（解决 SDK findConversation 可能找不到的问题）
                const pendingConv = this._pendingSpaceConversations.get(key)
                if (pendingConv) {
                    this._pendingSpaceConversations.delete(key)
                }
                const conv = pendingConv || WKSDK.shared().conversationManager.findConversation(channelInfo.channel)
                if (conv && !shouldSkipChannelForSpace(channelInfo.channel)) {
                    const existingInListener = this.findConversation(channelInfo.channel)
                    if (!existingInListener) {
                        this.conversations = [new ConversationWrap(conv), ...this.conversations]
                    }
                    this.sortConversations()
                    this.notifyListener()
                }
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
        this.notifyListener()

        // 快照本次请求对应的 Space,sync 回来后比对 —— 快速 A→B→C 切换时,
        // B 的回包可能晚于 C 的回包到达;如果直接写入会把 C 的 cache 覆盖成 B 的
        // (甚至空数组,见 dmworkdatasource/module.ts 的 stale guard)。
        const requestSpaceId = WKApp.shared.currentSpaceId

        // 先拉取数据，避免清空列表导致 UI 闪烁（fix #266）
        const conversations = await WKSDK.shared().conversationManager.sync({})

        // 回来已经不是本次请求对应的 Space —— 当前 Space 自有更新一次 sync,
        // 直接放弃本次结果。loading 留给新一次 sync 收尾,避免和 loading=false 冲突。
        if (WKApp.shared.currentSpaceId !== requestSpaceId) {
            return
        }

        // _pendingSpaceConversations 是 ChatVM 自己的延迟队列,跟 SDK cache 无关,
        // 切 Space 时清掉避免旧 Space 排队中的 incoming 落入新 Space 视图。
        this._pendingSpaceConversations.clear()

        const conversationWraps = new Array<ConversationWrap>()
        const filteredForSdk = new Array<Conversation>()
        if (conversations && conversations.length > 0) {
            for (const conversation of conversations) {
                // Space 过滤：复用共享函数（含 channelSpaceMap 缓存）
                if (shouldSkipChannelForSpace(conversation.channel)) {
                    continue
                }
                if (shouldSkipPersonConversationForSpace(conversation)) continue
                conversationWraps.push(new ConversationWrap(conversation))
                filteredForSdk.push(conversation)
            }
        }
        // 将过滤后的会话回填到 SDK 全局缓存，保证其它读取者（合并转发选择器、
        // todo 等）在切换 Space 后能立刻读到当前 Space 的最近会话/子区，
        // 而不是看到上一行被清空的空数组。
        WKSDK.shared().conversationManager.conversations = filteredForSdk
        this.conversations = conversationWraps
        this.loading = false

        this.sortConversations()

        this.notifyListener()
        WKApp.menus.refresh() // Fix #3: 切换 Space 后刷新 badge
        // 通知一次性读取 conversationManager.conversations 的消费者（合并转发等）
        // 缓存已经回填,可以重新 load 了。
        WKApp.mittBus.emit('conversation-list-refreshed')
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
                if (shouldSkipPersonConversationForSpace(conversation)) continue
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
        hideModal?.()
        const payload = item.payload;
        if (!payload.url) return;
        const downloadURL = WKApp.dataSource.commonDataSource.getFileURL(payload.url);
        if (!downloadURL) return;
        if (isSafeUrl(downloadURL)) {
            await downloadFile(downloadURL, payload.name || "file");
        }
    }
}
