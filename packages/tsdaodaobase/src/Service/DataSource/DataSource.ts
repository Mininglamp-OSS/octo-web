import { Channel, ChannelInfo, ConversationExtra, Message } from "wukongimjssdk";
import { APIResp } from "../APIClient";

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
            const newContactsList = new Array()
            for (let index = 0; index < this.contactsList.length; index++) {
                const oldContacts = this.contactsList[index];
                var exist: boolean = false
                for (const newContacts of results) {
                    if (oldContacts.uid === newContacts.uid) {
                        exist = true
                        break
                    }
                }
                if (!exist) {
                    newContactsList.push(oldContacts)
                }
            }
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

    private notifyContactsChange() {
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
    createChannel(uids: string[]): Promise<any>

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
    conversationExtraUpdate(conversationExtra:ConversationExtra): Promise<void>
}

export class ChannelQrcodeResp implements APIResp {
    fill(data: any): void {
        this.qrcode = data.qrcode
        this.expire = data.expire
    }
    qrcode!: string
    expire!: string
}