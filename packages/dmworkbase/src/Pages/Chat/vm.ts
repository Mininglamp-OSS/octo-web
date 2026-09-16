import WKSDK, { Channel, ChannelTypePerson, ConnectStatus, ConversationAction } from "wukongimjssdk";
import WKApp from "../../App";
import { ConversationWrap } from "../../Service/Model";
import { ProviderListener } from "../../Service/Provider";
import { animateScroll } from "react-scroll";
import { EndpointID } from "../../Service/Const";
import { ShowConversationOptions } from "../../EndpointCommon";
import { Space, SpaceService } from "../../Service/SpaceService";
import { isSafeUrl } from "../../Utils/security";
import { downloadFile } from "../../Utils/download";
import { getImConnectStatus } from "../../im-runtime/connectStatus";
import { getBrowserUnreadConversationSync } from "../../features/documentTitle";
import { chatPageTitleController } from "./chatPageTitleController";
import { Dap } from "../../Service/Dap";
import { getCurrentImConversationStore } from "../../im-runtime/currentConversationStore";
import { applyImSpaceContext } from "../../im-runtime/spaceContext";
import { captureCurrentImConversationSyncContext } from "../../im-runtime/conversationSyncContext";

export { applyPinnedThreadSnapshot } from "../../im-runtime/conversationSnapshot";

export class ChatVM extends ProviderListener {
    private readonly store = getCurrentImConversationStore();
    private releaseStore?: () => void;
    private unsubscribeStore?: () => void;
    private mounted = false;
    private pageRevision = 0;
    private _connectTitle = "";
    connectStatus = 0;
    private _showChannelSetting = false;
    private _selectedConversation?: ConversationWrap;
    private _showAddPopover = false;
    private activeMenuChangedHandler?: (payload: { menuId?: string }) => void;
    private readonly conversationListID = "wk-conversationlist";
    private _showGlobalSearch = false;
    private _selectedSpace?: Space;
    private _showSpaceCreate = false;
    private _spaceMemberUids = new Set<string>();

    get conversations(): ConversationWrap[] { return this.store.conversations; }
    set conversations(value: ConversationWrap[]) { this.store.conversations = value; }
    get loading(): boolean { return this.store.loading; }

    set showAddPopover(value: boolean) {
        this._showAddPopover = value;
        this.notifyListener();
    }
    get showAddPopover() { return this._showAddPopover; }

    set showGlobalSearch(value: boolean) {
        this._showGlobalSearch = value;
        this.notifyListener();
    }
    get showGlobalSearch() { return this._showGlobalSearch; }

    set selectedConversation(value: ConversationWrap | undefined) {
        this._selectedConversation = value;
        this.notifyListener();
    }
    get selectedConversation() { return this._selectedConversation; }

    set showChannelSetting(value: boolean) {
        this._showChannelSetting = value;
        this.notifyListener();
    }
    get showChannelSetting() { return this._showChannelSetting; }

    set connectTitle(value: string) {
        this._connectTitle = value;
        this.notifyListener();
    }
    get connectTitle() { return this._connectTitle; }

    set selectedSpace(value: Space | undefined) {
        this.pageRevision++;
        this._selectedSpace = value;
        applyImSpaceContext(value);
        if (value) void this.loadSpaceMembers(value.space_id);
        else this._spaceMemberUids = new Set();
    }
    get selectedSpace() { return this._selectedSpace; }

    set showSpaceCreate(value: boolean) {
        this._showSpaceCreate = value;
        this.notifyListener();
    }
    get showSpaceCreate() { return this._showSpaceCreate; }
    get filteredConversations(): ConversationWrap[] { return this.conversations; }

    private async loadSpaceMembers(spaceId: string) {
        const revision = this.pageRevision;
        try {
            const members = await SpaceService.shared.getMembers(spaceId, 1, 10000);
            if (revision !== this.pageRevision || this._selectedSpace?.space_id !== spaceId) return;
            this._spaceMemberUids = new Set(members.map((member) => member.uid));
        } catch {
            if (revision !== this.pageRevision || this._selectedSpace?.space_id !== spaceId) return;
            this._spaceMemberUids = new Set();
        }
        this.notifyListener();
    }

    didMount(): void {
        if (this.mounted) return;
        this.mounted = true;
        this.activeMenuChangedHandler = ({ menuId }) => {
            if (menuId === "chat") return;
            chatPageTitleController.clear();
            WKApp.shared.openChannel = undefined;
            this._showChannelSetting = false;
            this.selectedConversation = undefined;
        };
        WKApp.mittBus.on("wk:active-menu-changed", this.activeMenuChangedHandler);
        this.unsubscribeStore = this.store.subscribe((change) => {
            if (change === "space") this.clearSpacePresentation();
            if (change === "connection") {
                this.setConnectTitleWithConnectStatus(getImConnectStatus(this.store.sdk));
                return;
            }
            const y = change === "update" ? this.currentConversationListY() : undefined;
            this.notifyListener(() => {
                if (y !== undefined && this.mounted) this.keepPosition(y);
            });
        });
        this.setConnectTitleWithConnectStatus(getImConnectStatus(this.store.sdk));
        this.releaseStore = this.store.retain();
    }

    private clearSpacePresentation(): void {
        this.pageRevision++;
        chatPageTitleController.clear();
        this._selectedConversation = undefined;
        WKApp.shared.openChannel = undefined;
        this._showChannelSetting = false;
        // The shared right pane may currently belong to a different module.
        if (WKApp.currentMenuId === "chat") WKApp.routeRight.popToRoot();
        WKApp.shared.notifyListener();
    }

    didUnMount(): void {
        this.pageRevision++;
        this.mounted = false;
        chatPageTitleController.clear();
        if (this.activeMenuChangedHandler) {
            WKApp.mittBus.off("wk:active-menu-changed", this.activeMenuChangedHandler);
            this.activeMenuChangedHandler = undefined;
        }
        this.unsubscribeStore?.();
        this.unsubscribeStore = undefined;
        this.releaseStore?.();
        this.releaseStore = undefined;
        this.store.stopIfUnowned();
    }

    findConversation(channel: Channel) { return this.store.findConversation(channel); }

    keepPosition(y: number): void {
        animateScroll.scrollTo(y, { containerId: this.conversationListID, duration: 0 });
    }
    currentConversationListY(): number | undefined {
        return document.getElementById(this.conversationListID)?.scrollTop;
    }

    removeConversation(channel: Channel): void {
        this.store.removeConversation(channel);
        if (!this.mounted) this.notifyListener();
    }
    removeThreadsOfParent(parentGroupNo: string): void {
        this.store.removeThreadsOfParent(parentGroupNo);
    }

    async clearMessages(channel: Channel): Promise<void> {
        const conversationWrap = this.findConversation(channel);
        if (!conversationWrap) return;
        const contextIsCurrent = captureCurrentImConversationSyncContext();
        await WKApp.conversationProvider.clearConversationMessages(conversationWrap.conversation);
        if (!contextIsCurrent()) return;
        // Only explicit clear actions emit this business event, not generic offset requests.
        Dap.shared.track("conversation_cleared", {});
        conversationWrap.conversation.lastMessage = undefined;
        conversationWrap.conversation.unread = 0;
        if (WKApp.shared.currentSpaceId && channel.channelType === ChannelTypePerson &&
            conversationWrap.conversation.extra?.spaceUnread !== undefined) {
            conversationWrap.conversation.extra.spaceUnread = 0;
        }
        WKSDK.shared().conversationManager.notifyConversationListeners(
            conversationWrap.conversation, ConversationAction.update,
        );
        getBrowserUnreadConversationSync().publish({
            accountId: WKApp.loginInfo.uid,
            spaceId: WKApp.shared.currentSpaceId || "",
            channelId: channel.channelID,
            channelType: channel.channelType,
            unread: 0,
        });
        WKApp.endpointManager.invoke(EndpointID.clearChannelMessages, channel);
        this.sortConversations();
        this.notifyListener();
    }

    setConnectTitleWithConnectStatus(status: ConnectStatus): void {
        this.connectStatus = status === ConnectStatus.Connected ? 1
            : status === ConnectStatus.Disconnect ? 0 : 2;
        this.connectTitle = WKApp.config.appName;
    }
    sortConversations(conversations?: ConversationWrap[]): ConversationWrap[] {
        return this.store.sortConversations(conversations);
    }

    async requestConversationList(): Promise<void> {
        const revision = this.pageRevision;
        try {
            const request = this.store.refresh();
            if (!this.mounted) this.notifyListener();
            await request;
        } catch (error) {
            console.error("[ChatVM] failed to sync conversations", error);
        } finally {
            if (!this.mounted && revision === this.pageRevision) this.notifyListener();
        }
    }
    async reloadRequestConversationList(): Promise<void> {
        const revision = this.pageRevision;
        try { await this.store.refresh({ reload: true }); }
        finally {
            if (!this.mounted && revision === this.pageRevision) this.notifyListener();
        }
    }
}

// 处理搜索内容点击事件
export async function handleGlobalSearchClick(item: any, type: string,hideModal?:()=>void) {
    if (type === "contacts") {
        if (item.channel_type === ChannelTypePerson) {
            // 联系人 tab 点击自己：无条件走资料页，不查 follow、不开"自己和自己"会话。
            // 后端 GetUserDetail 对 self 的 follow 判定不可靠：非 friend 时会用
            // GetCommonSpaceID(loginUID, uid) 兜底，而 self 和 self 永远在同一
            // Space —— 结果 follow 恒为 1，原逻辑因此走 showConversation 打开
            // 「自己和自己」的私聊，这不是用户搜自己的产品意图（对齐微信/Slack：
            // 搜自己应看资料页）。后端 notes-to-self 通道仍是合法的，只是不
            // 通过这个入口触发它。（不锁 octo-server 行号，重构会挪。）
            if (item.channel_id === WKApp.loginInfo.uid) {
                // self 分支不调 hideModal():用户搜自己看一眼资料多半只是好奇/
                // 查证,并没完成主要检索意图,不应把搜索面板收掉——UserInfo
                // 弹层直接叠在全局搜索面板之上,关掉 UserInfo 后能顺畅继续搜
                // 其他人。与他人点击(follow=1 开会话/follow=0 开资料页)的
                // hideModal 语义有意不对称:开会话是"检索完成、转移注意力",
                // 开自己资料是"顺手一看、还没完成"。
                WKApp.shared.baseContext.showUserInfo(item.channel_id, new Channel(item.channel_id, item.channel_type))
                return
            }
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
