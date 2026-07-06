import { Channel, ChannelInfo, ConversationExtra, Message, Subscriber } from "wukongimjssdk";
import { APIResp } from "../APIClient";
import type { Thread, ThreadListStatus } from "../Thread";
import type {
    IncomingWebhook,
    IncomingWebhookCreateResp,
    IncomingWebhookUpsertReq,
} from "../IncomingWebhook";

export type ContactsChangeListener = () => void;

export class DataSource {
    channelDataSource!: IChannelDataSource
    commonDataSource!: ICommonDataSource

    // ---------- 联系人数据 ----------
    contactsList: Contacts[] = []
    private contactsChangeListeners: ContactsChangeListener[] = []

    async contactsSync() {
        const maxVersion = this.contactsMaxSyncVersion()
        const results = await this.commonDataSource.contactsSync(maxVersion)
        if (results && results.length > 0) {
            const newContactsMap = new Map(results.map(c => [c.uid, c]))
            const newContactsList = this.contactsList.filter(c => !newContactsMap.has(c.uid))
            newContactsList.push(...results)

            this.contactsList = newContactsList
            this.notifyContactsChange()
        }
    }

    private contactsMaxSyncVersion() {
        if (this.contactsList && this.contactsList.length > 0) {
            const lastContacts = this.contactsList[this.contactsList.length - 1]
            return lastContacts.version
        }
        return ""
    }

    addContactsChangeListener(listener: ContactsChangeListener) {
        this.contactsChangeListeners.push(listener)
    }
    removeContactsChangeListener(listener: ContactsChangeListener) {
        const len = this.contactsChangeListeners.length;
        for (let i = 0; i < len; i++) {
            if (listener === this.contactsChangeListeners[i]) {
                this.contactsChangeListeners.splice(i, 1)
                return
            }
        }
    }

    public notifyContactsChange() {
        if (this.contactsChangeListeners) {
            this.contactsChangeListeners.forEach((listener: ContactsChangeListener) => {
                if (listener) {
                    listener();
                }
            });
        }
    }
}

export enum ContactsStatus {
    Blacklist = 2 // 黑明单
}

export class Contacts {
    uid!: string
    name!: string
    mute!: boolean
    top!: boolean
    sex!: number
    online!: boolean
    receipt!: boolean
    robot!: boolean
    lastOffline!: number
    category!: string
    follow!: number
    remark!: string
    chatPwdOn!: boolean
    status!: ContactsStatus
    shortNo!: string
    sourceDesc!: string
    vercode!: string
    screenshot!: boolean
    revokeRemind!: boolean
    beBlacklist!: boolean
    beDeleted!: boolean
    version!: string
    avatar!: string
}

export interface ICommonDataSource {
    imConnectAddr(): Promise<string> // im的连接地址
    imConnectAddrs(): Promise<string[]> // im的连接地址

    /**
     *  联系人同步
     * @param version 版本号 
     */
    contactsSync(version: string): Promise<Contacts[]>

    /**
    *  获取图片完整地址
    * @param path  图片路径
    * @param opts 参数
    */
    getImageURL(path: string, opts?: { width: number, height: number }): string
    getFileURL(path: string): string

    /**
   * 确认好友申请
   * @param token 
   */
    friendSure(token: string): Promise<void>

    /**
     * 好友申请
     * @param req 
     */
    friendApply(req: { uid: string, remark: string, vercode: string }): Promise<void>

    /**
    * 我的二维码
    */
    qrcodeMy(): Promise<any>

    /**
     * 搜索用户
     * @param keyword 
     */
    searchUser(keyword: string): Promise<any>

    /**
     * 用户贴图类别
     */
    userStickerCategory(): Promise<any>

    /**
     * 通过类别获取表情 
     * @param category 
     */
    getStickers(category: string): Promise<any>


    /**
    * 获取所有收藏
    */
    getFavoritesAll(): Promise<any>

    /**
     * 收藏消息
     * @param message 
     */
    favorities(message: Message): Promise<void>

    /**
     * 删除收藏
     * @param id 
     */
    favoritiesDelete(id: string): Promise<void>

    /**
   *  搜索好友
   * @param keyword 关键字
   */
    searchFriends(keyword?: string): Promise<ChannelInfo[]>

    /**
     * 删除好友
     * @param uid 
     */
    deleteFriend(uid: string): Promise<void>

    /**
     *  用户备注
     * @param uid 
     * @param remark 
     */
    userRemark(uid: string, remark: string): Promise<void>

    /**
     * 黑名单添加
     * @param uid 
     */
    blacklistAdd(uid: string): Promise<void>

    /**
     * 黑名单移除
     * @param uid 
     */
    blacklistRemove(uid: string): Promise<void>

}


export class ChannelField {
    static channelName: string = "name"
    static notice = "notice"
}

export interface IChannelDataSource {

    /**
     * 修改频道属性
     * @param channel 
     * @param field 频道属性
     * @param value  属性对应的值
     */

    updateField(channel: Channel, field: string, value: string): Promise<void>


    /**
     *  获取频道二维码
     * @param channel 
     */
    qrcode(channel: Channel): Promise<ChannelQrcodeResp>

    /**
     * 移除订阅者
     * @param uids 
     */
    removeSubscribers(channel: Channel, uids: string[]): Promise<void>

    /**
     * 添加订阅者
     * @param uids 
     */
    addSubscribers(channel: Channel, uids: string[]): Promise<void>

    /**
     * 获取订阅者
     * @param channel 
     */
    subscribers(channel: Channel, req: {
        keyword?: string, // 搜索关键字
        limit?: number, // 每页数量
        page?: number, // 页码
    }): Promise<Subscriber[]>

    /**
     * 按 UID 精确获取单个订阅者
     * @param channel
     * @param uid 订阅者 UID
     */
    subscriber(channel: Channel, uid: string): Promise<Subscriber | undefined>

    /**
     * 更新频道设置
     * @param setting 
     * @param channel 
     */
    updateSetting(setting: any, channel: Channel): Promise<void>

    /**
   *  获取保存的群聊
   * @param keyword 关键字
   */
    groupSaveList(): Promise<ChannelInfo[]>

    /**
     *  创建频道
     * @param uids 
     */
    createChannel(uids: string[], options?: { categoryId?: string }): Promise<any>

    /**
     * 更新订阅者的属性
     * @param channel 
     * @param attr 
     */
    subscriberAttrUpdate(channel: Channel, subscriberUID: string, attr: any): Promise<any>

    /**
     * 退出频道
     * @param channel 
     */
    exitChannel(channel: Channel): Promise<void>

    /**
     * 频道拥有者转移
     * @param channel 
     * @param toUID 
     */
    channelTransferOwner(channel: Channel, toUID: string): Promise<void>

    /**
     * 移除管理者
     * @param channel 
     * @param uids 
     */
    managerRemove(channel: Channel, uids: string[]): Promise<void>

    /**
     * 添加管理员
     * @param channel 
     * @param uids 
     */
    managerAdd(channel: Channel, uids: string[]): Promise<void>

    /**
     * 黑名单添加
     * @param channel 
     * @param uids 
     */
    blacklistAdd(channel: Channel, uids: string[]): Promise<void>

    /**
     * 黑名单移除
     * @param channel 
     * @param uids 
     */
    blacklistRemove(channel: Channel, uids: string[]): Promise<void>

    /**
     * 更新扩展
     * @param conversationExtra
     */
    conversationExtraUpdate(conversationExtra: ConversationExtra): Promise<void>

    getGroupMd(channel: Channel): Promise<{ content: string; version: number }>
    updateGroupMd(channel: Channel, content: string): Promise<{ version: number }>
    deleteGroupMd(channel: Channel): Promise<void>

    // 群入站 Webhook（octo-server incoming-webhooks #250/#254/#297/#340）
    // 列表对任意群成员只读可见；其余操作的权限矩阵由服务端裁决（403/409）。
    incomingWebhooks(channel: Channel): Promise<IncomingWebhook[]>
    /** 创建。返回体里的 token / 推送 URL 仅此一次出现。 */
    createIncomingWebhook(channel: Channel, req: IncomingWebhookUpsertReq): Promise<IncomingWebhookCreateResp>
    /** 部分更新（改名 / 启停；avatar 仅管理员），未传字段不变。 */
    updateIncomingWebhook(channel: Channel, webhookId: string, req: IncomingWebhookUpsertReq): Promise<IncomingWebhook>
    /** 软删除，token 立即失效。 */
    deleteIncomingWebhook(channel: Channel, webhookId: string): Promise<void>
    /** 重置 token，旧 token 立即失效。新 token / URL 仅此一次返回。 */
    regenerateIncomingWebhook(channel: Channel, webhookId: string): Promise<IncomingWebhookCreateResp>
    /** 发送一条样例消息验证配置（不计入 call_count）。 */
    testIncomingWebhook(channel: Channel, webhookId: string): Promise<void>

    // 子区 GROUP.md
    getThreadMd(groupNo: string, shortId: string): Promise<{ content: string; version: number }>
    updateThreadMd(groupNo: string, shortId: string, content: string): Promise<{ version: number }>
    deleteThreadMd(groupNo: string, shortId: string): Promise<void>

    // 子区信息
    threadList(groupNo: string, req?: {
        page_index?: number
        page_size?: number
        status?: ThreadListStatus
    }): Promise<Thread[]>
    threadCreate(groupNo: string, name: string, sourceMessageId?: number): Promise<Thread>
    threadGet(groupNo: string, shortId: string): Promise<Thread>
    threadArchive(groupNo: string, shortId: string): Promise<void>
    threadUnarchive(groupNo: string, shortId: string): Promise<void>
    threadDelete(groupNo: string, shortId: string): Promise<void>
    threadUpdate(groupNo: string, shortId: string, data: { name: string }): Promise<void>
    threadJoin(shortId: string): Promise<void>
    threadLeave(shortId: string): Promise<void>

    setBotAdmin(channel: Channel, uid: string): Promise<void>
    removeBotAdmin(channel: Channel, uid: string): Promise<void>

    /**
     * 获取频道文件列表（图片/视频/文件聚合）
     * @param channelId 频道ID
     * @param channelType 频道类型 1=单聊 2=群聊
     * @param options 可选参数
     */
    channelFiles(channelId: string, channelType: number, options?: {
        category?: 'all' | 'document' | 'image' | 'video' | 'archive' | 'code'
        keyword?: string
        page?: number
        limit?: number
    }): Promise<ChannelFilesResp>
}

/** 频道文件项 */
export interface ChannelFileItem {
    message_id: number
    message_seq: number
    from_uid: string
    from_name: string
    channel_id: string
    channel_type: number
    category: string
    name: string
    url: string
    size: number
    width?: number
    height?: number
    duration?: number
    timestamp: number
}

/** 频道文件列表响应 */
export interface ChannelFilesResp {
    total: number
    page: number
    limit: number
    has_more: boolean
    files: ChannelFileItem[]
}

export class ChannelQrcodeResp implements APIResp {
    fill(data: any): void {
        this.qrcode = data.qrcode
        this.expire = data.expire
        this.invite_url = data.invite_url || ''
    }
    qrcode!: string
    expire!: string
    invite_url!: string
}
