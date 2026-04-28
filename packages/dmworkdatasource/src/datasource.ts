import { ChannelQrcodeResp, Contacts, IChannelDataSource, ICommonDataSource, WKApp, RequestConfig, GroupRole, hasSpacePrefix, Thread, ChannelTypeCommunityTopic, buildThreadChannelId, ChannelFilesResp } from "@octo/base";
import { Channel, ChannelInfo, ChannelTypeGroup, ChannelTypePerson, WKSDK, Message, MessageContentType,ConversationExtra,Subscriber } from "wukongimjssdk";

const MAX_GROUP_LIST_LIMIT = 100000;
const MAX_FAVORITES_PAGE_SIZE = 10000;

export class ChannelDataSource implements IChannelDataSource {

    async exitChannel(channel: Channel): Promise<void> {
        if (channel.channelType === ChannelTypePerson) {
            return
        }
        return WKApp.apiClient.post(`groups/${channel.channelID}/exit`)
    }

    async channelTransferOwner(channel: Channel, toUID: string): Promise<void> {
        if (channel.channelType === ChannelTypePerson) {
            return
        }
        return WKApp.apiClient.post(`groups/${channel.channelID}/transfer/${toUID}`)
    }

    async subscriberAttrUpdate(channel: Channel, subscriberUID: string, attr: any): Promise<any> {
        if (channel.channelType === ChannelTypePerson) {
            return
        }
        return WKApp.apiClient.put(`groups/${channel.channelID}/members/${subscriberUID}`, attr)
    }
    createChannel(uids: string[], options?: { categoryId?: string }): Promise<any> {
        const body: any = { members: uids }
        const spaceId = WKApp.shared.currentSpaceId
        if (spaceId) {
            body.space_id = spaceId
        }
        if (options?.categoryId) {
            body.category_id = options.categoryId
        }
        return WKApp.apiClient.post(`group/create`, body);
    }
    async groupSaveList(): Promise<ChannelInfo[]> {
        const param: any = { "limit": MAX_GROUP_LIST_LIMIT }
        const spaceId = WKApp.shared.currentSpaceId
        if (spaceId) {
            param.space_id = spaceId
        }
        const resp = await WKApp.apiClient.get('group/my', { param });
        const channelInfos = [];
        if (resp) {
            if (!Array.isArray(resp) || resp.length === 0) return [];
            for (const data of resp) {
                let channelInfo = new ChannelInfo();
                channelInfo.channel = new Channel(data.group_no, ChannelTypeGroup);
                channelInfo.title = data.name;
                channelInfo.logo = WKApp.shared.avatarChannel(channelInfo.channel);
                channelInfo.mute = data.mute === 1;
                channelInfo.top = data.top === 1;
                channelInfo.orgData = data;
                if (!channelInfo.orgData) {
                    channelInfo.orgData = {}
                }
                if (channelInfo.orgData.remark && channelInfo.orgData.remark !== "") {
                    channelInfo.orgData.displayName = channelInfo.orgData.remark;
                } else {
                    channelInfo.orgData.displayName = channelInfo.title;
                }

                channelInfos.push(channelInfo);
            }
        }
        return channelInfos;
    }
    removeSubscribers(channel: Channel, uids: string[]): Promise<void> {
        return WKApp.apiClient.delete(`groups/${channel.channelID}/members`, {
            data: {
                members: uids,
            }
        })
    }
    addSubscribers(channel: Channel, uids: string[]): Promise<void> {
        return WKApp.apiClient.post(`groups/${channel.channelID}/members`, {
            members: uids,
        })
    }

    async subscribers(channel: Channel,req:{
        keyword?:string, // 搜索关键字
        limit?:number, // 每页数量
        page?:number, // 页码
    }): Promise<Subscriber[]> {
        const resp = await WKApp.apiClient.get(`groups/${channel.channelID}/members`, {
           param: req
        })
        let members = new Array<Subscriber>();
        if (resp) {
            for (let i = 0; i < resp.length; i++) {
                let memberMap = resp[i];
                let member = new Subscriber();
                member.uid = memberMap.uid;
                member.name = memberMap.name;
                member.remark = memberMap.remark;
                member.role = memberMap.role;
                member.version = memberMap.version;
                member.isDeleted = memberMap.is_deleted;
                member.status = memberMap.status;
                member.orgData = memberMap
                member.orgData.bot_admin = memberMap.bot_admin || 0;
                member.avatar = WKApp.shared.avatarUser(member.uid)
                members.push(member);
            }
        }
        return members
    }

    updateField(channel: Channel, field: string, value: string): Promise<void> {
        const param: any = {}
        param[field] = value
        return WKApp.apiClient.put(`groups/${channel.channelID}`, param)
    }

    qrcode(channel: Channel): Promise<ChannelQrcodeResp> {
        return WKApp.apiClient.get(`groups/${channel.channelID}/qrcode`, {
            resp: () => {
                return new ChannelQrcodeResp()
            }
        })
    }

    async updateSetting(setting: any, channel: Channel): Promise<void> {
        if (channel.channelType === ChannelTypeGroup) {
            return WKApp.apiClient.put(`groups/${channel.channelID}/setting`, setting)
        } else if (channel.channelType === ChannelTypePerson) { // 个人信息
            let uid = channel.channelID;
            if (hasSpacePrefix(uid)) uid = uid.substring(uid.indexOf('_') + 1);
            return WKApp.apiClient.put(`users/${uid}/setting`, setting)
        }
    }

    async managerRemove(channel: Channel, uids: string[]): Promise<void> {
        return WKApp.apiClient.delete(`groups/${channel.channelID}/managers`, {
            data: uids,
        })
    }

    async managerAdd(channel: Channel, uids: string[]): Promise<void> {
        return WKApp.apiClient.post(`groups/${channel.channelID}/managers`, uids)
    }

    blacklistAdd(channel: Channel, uids: string[]): Promise<void> {
        return WKApp.apiClient.post(`groups/${channel.channelID}/blacklist/add`, { uids: uids })
    }


    blacklistRemove(channel: Channel, uids: string[]): Promise<void> {
        return WKApp.apiClient.post(`groups/${channel.channelID}/blacklist/remove`, { uids: uids })
    }

    getGroupMd(channel: Channel): Promise<{ content: string; version: number }> {
        return WKApp.apiClient.get(`groups/${channel.channelID}/md`)
    }

    updateGroupMd(channel: Channel, content: string): Promise<{ version: number }> {
        return WKApp.apiClient.put(`groups/${channel.channelID}/md`, { content })
    }

    deleteGroupMd(channel: Channel): Promise<void> {
        return WKApp.apiClient.delete(`groups/${channel.channelID}/md`)
    }

    getThreadMd(groupNo: string, shortId: string): Promise<{ content: string; version: number }> {
        return WKApp.apiClient.get(`groups/${groupNo}/threads/${shortId}/md`)
    }

    updateThreadMd(groupNo: string, shortId: string, content: string): Promise<{ version: number }> {
        return WKApp.apiClient.put(`groups/${groupNo}/threads/${shortId}/md`, { content })
    }

    deleteThreadMd(groupNo: string, shortId: string): Promise<void> {
        return WKApp.apiClient.delete(`groups/${groupNo}/threads/${shortId}/md`)
    }

    setBotAdmin(channel: Channel, uid: string): Promise<void> {
        return WKApp.apiClient.put(`groups/${channel.channelID}/bot_admin/${uid}`)
    }

    removeBotAdmin(channel: Channel, uid: string): Promise<void> {
        return WKApp.apiClient.delete(`groups/${channel.channelID}/bot_admin/${uid}`)
    }

    conversationExtraUpdate(conversationExtra:ConversationExtra): Promise<void> {
        return WKApp.apiClient.post(`conversations/${conversationExtra.channel.channelID}/${conversationExtra.channel.channelType}/extra`,{
            "browse_to": conversationExtra.browseTo,
            "keep_message_seq": conversationExtra.keepMessageSeq,
            "keep_offset_y": conversationExtra.keepOffsetY,
            "draft": conversationExtra.draft||""

        })
    }

    // Thread (子区) API
    async threadList(groupNo: string, req?: {
        page_index?: number
        page_size?: number
    }): Promise<Thread[]> {
        const resp = await WKApp.apiClient.get(`groups/${groupNo}/threads`, {
            param: req
        })
        if (!resp || !resp.list || !Array.isArray(resp.list)) {
            return []
        }
        return resp.list.map((item: any) => this.toThread(item, groupNo))
    }

    async threadCreate(groupNo: string, name: string, sourceMessageId?: number): Promise<Thread> {
        const body: any = { name }
        if (sourceMessageId !== undefined) {
            body.source_message_id = sourceMessageId
        }
        const resp = await WKApp.apiClient.post(`groups/${groupNo}/threads`, body)
        return this.toThread(resp, groupNo)
    }

    async threadGet(groupNo: string, shortId: string): Promise<Thread> {
        const resp = await WKApp.apiClient.get(`groups/${groupNo}/threads/${shortId}`)
        return this.toThread(resp, groupNo)
    }

    async threadArchive(groupNo: string, shortId: string): Promise<void> {
        return WKApp.apiClient.post(`groups/${groupNo}/threads/${shortId}/archive`)
    }

    async threadDelete(groupNo: string, shortId: string): Promise<void> {
        return WKApp.apiClient.delete(`groups/${groupNo}/threads/${shortId}`)
    }

    async threadUpdate(groupNo: string, shortId: string, data: { name: string }): Promise<void> {
        return WKApp.apiClient.put(`groups/${groupNo}/threads/${shortId}`, data)
    }

    async threadJoin(shortId: string): Promise<void> {
        return WKApp.apiClient.post(`threads/${shortId}/join`)
    }

    async threadLeave(shortId: string): Promise<void> {
        return WKApp.apiClient.post(`threads/${shortId}/leave`)
    }

    async threadMembers(shortId: string, req?: {
        keyword?: string
        limit?: number
        page?: number
    }): Promise<Subscriber[]> {
        const resp = await WKApp.apiClient.get(`threads/${shortId}/members`, {
            param: req
        })
        const members: Subscriber[] = []
        if (resp) {
            for (let i = 0; i < resp.length; i++) {
                const memberMap = resp[i]
                const member = new Subscriber()
                member.uid = memberMap.uid
                member.name = memberMap.name
                member.remark = memberMap.remark
                member.role = memberMap.role
                member.version = memberMap.version
                member.isDeleted = memberMap.is_deleted
                member.status = memberMap.status
                member.orgData = memberMap
                member.avatar = WKApp.shared.avatarUser(member.uid)
                members.push(member)
            }
        }
        return members
    }

    private toThread(data: any, groupNo: string): Thread {
        return {
            short_id: data.short_id,
            group_no: groupNo,
            channel_id: buildThreadChannelId(groupNo, data.short_id),
            channel_type: ChannelTypeCommunityTopic,
            name: data.name,
            creator_uid: data.creator_uid,
            creator_name: data.creator_name,
            source_message_id: data.source_message_id,
            status: data.status,
            created_at: data.created_at,
            updated_at: data.updated_at,
            is_member: data.is_member,
            member_count: data.member_count,
            message_count: data.message_count,
            unread_count: data.unread_count,
            last_message_content: data.last_message_content,
            last_message_sender_name: data.last_message_sender_name,
            has_thread_md: !!data.has_thread_md,
            thread_md_version: data.thread_md_version || 0,
            thread_md_updated_at: data.thread_md_updated_at,
            group_name: data.group_name,
            last_message_at: data.last_message_at,
        }
    }

    async channelFiles(channelId: string, channelType: number, options?: {
        category?: 'all' | 'document' | 'image' | 'video' | 'archive' | 'code'
        keyword?: string
        page?: number
        limit?: number
    }): Promise<ChannelFilesResp> {
        const body: any = {
            channel_id: channelId,
            channel_type: channelType,
        }
        if (options?.category) {
            body.category = options.category
        }
        if (options?.keyword) {
            body.keyword = options.keyword
        }
        if (options?.page) {
            body.page = options.page
        }
        if (options?.limit) {
            body.limit = options.limit
        }
        const resp = await WKApp.apiClient.post('message/channel/files', body)
        return {
            total: resp?.total ?? 0,
            page: resp?.page ?? 1,
            limit: resp?.limit ?? 20,
            has_more: resp?.has_more ?? false,
            files: resp?.files ?? [],
        }
    }
}

export class CommonDataSource implements ICommonDataSource {
    blacklistAdd(uid: string): Promise<void> {
        return WKApp.apiClient.post(`user/blacklist/${uid}`)
    }
    blacklistRemove(uid: string): Promise<void> {
        return WKApp.apiClient.delete(`user/blacklist/${uid}`)
    }
    deleteFriend(uid:string): Promise<void> {
        return WKApp.apiClient.delete(`friends/${uid}`)
    }

    userRemark(uid: string, remark: string): Promise<void> {
        return WKApp.apiClient.put(`friend/remark`, { uid: uid, remark: remark })
    }
    getFavoritesAll(): Promise<any> {
        // TODO: 这里先取10000足够 等后面再做分页
        return WKApp.apiClient.get(`favorite/my?page_index=1&page_size=${MAX_FAVORITES_PAGE_SIZE}`)
    }
    favorities(message: Message): Promise<void>{
        var content: string = ""
        if (message.contentType === MessageContentType.text) {
            content = message.content.contentObj.content;
        } else if (message.contentType === MessageContentType.image) {
            content = message.content.contentObj.url;
        }
        const fromChannelInfo = WKSDK.shared().channelManager.getChannelInfo(new Channel(message.fromUID, ChannelTypePerson))
        return WKApp.apiClient.post(`favorites`, {
            type: message.contentType,
            unique_key: message.messageID,
            author_name: fromChannelInfo?.title || "",
            author_uid: message.fromUID,
            payload: { content: content },
        })
    }
    favoritiesDelete(id: string): Promise<void> {
        return WKApp.apiClient.delete(`favorites/${id}`)
    }
    userStickerCategory(): Promise<any> {
        return WKApp.apiClient.get(`sticker/user/category`).catch(() => [])
    }
    getStickers(category: string): Promise<any> {
        return WKApp.apiClient.get(`sticker/user/sticker?category=${encodeURIComponent(category)}`).catch(() => [])
    }
    searchUser(keyword: string): Promise<any> {
        const spaceId = WKApp.shared.currentSpaceId
        const spaceParam = spaceId ? `&space_id=${encodeURIComponent(spaceId)}` : ''
        return WKApp.apiClient.get(`user/search?keyword=${encodeURIComponent(keyword)}${spaceParam}`)
    }
    qrcodeMy(): Promise<any> {
        return WKApp.apiClient.get("user/qrcode")
    }

    friendSure(token: string): Promise<void> {
        const body: any = { "token": token }
        const spaceId = WKApp.shared.currentSpaceId
        if (spaceId) {
            body.space_id = spaceId
        }
        return WKApp.apiClient.post("friend/sure", body)
    }

    friendApply(req:{uid:string,remark:string,vercode:string}):Promise<void> {
        const body: any = { to_uid: req.uid, remark: req.remark, vercode: req.vercode }
        const spaceId = WKApp.shared.currentSpaceId
        if (spaceId) {
            body.space_id = spaceId
        }
        return WKApp.apiClient.post(`friend/apply`, body)
    }

    /**
    *  获取图片完整地址
    * @param path  图片路径
    * @param opts 参数
    */
    getImageURL(path: string, opts?: { width: number, height: number }): string {
        if (path && path.length > 4) {
            const prefix = path.substring(0, 4)
            if (prefix === 'http') {
                return path
            }
        }
        // file/preview/* paths use public MinIO URL (no auth needed)
        if (path.startsWith('file/preview/')) {
            const origin = typeof window !== 'undefined' ? window.location.origin : ''
            return `${origin}/${path.replace(/^file\/preview\//, "file/")}`
        }
        // All other paths go through API (e.g. users/xxx/avatar)
        const baseURL = WKApp.apiClient.config.apiURL
        return `${baseURL}${path}`
    }
    getFileURL(path: string): string {
        if (path && path.length > 4) {
            const prefix = path.substring(0, 4)
            if (prefix === 'http') {
                return path
            }
        }
        if (path.startsWith('file/preview/')) {
            const origin = typeof window !== 'undefined' ? window.location.origin : ''
            return `${origin}/${path.replace(/^file\/preview\//, "file/")}`
        }
        const baseURL = WKApp.apiClient.config.apiURL
        return `${baseURL}${path}`
    }


    async contactsSync(version: string): Promise<Contacts[]> {
        const spaceId = WKApp.shared.currentSpaceId;
        if (spaceId) {
            // Space 模式：从 Space 成员获取联系人
            // 捕获请求发起时的 spaceId，用于防止竞态条件
            const requestSpaceId = spaceId;
            const members = await WKApp.apiClient.get(`space/${spaceId}/members`, {
                param: { page: "1", limit: "10000" },
            })
            // 请求返回后验证 Space 是否已切换，防止将错误数据应用到当前视图
            if (WKApp.shared.currentSpaceId !== requestSpaceId) {
                return [];
            }
            const contactsList = new Array<Contacts>()
            if (members) {
                for (const m of members) {
                    if (m.uid === WKApp.loginInfo.uid) continue; // 排除自己
                    const c = new Contacts()
                    c.uid = m.uid
                    c.name = m.name
                    c.avatar = m.avatar || ""
                    c.follow = 1
                    c.status = 1
                    c.robot = m.robot === 1
                    contactsList.push(c)
                }
            }
            return contactsList
        }
        // 个人空间：好友同步（兼容）
        const results = await WKApp.apiClient.get(`friend/sync`, {
            param: { version: version,"api_version":"1" },
        })
        const contactsList = new Array<Contacts>()
        if (results) {
            for (const result of results) {
                contactsList.push(this.toContacts(result))
            }
        }
        return contactsList

    }
    imConnectAddr(): Promise<string> {
        return WKApp.apiClient.get(`users/${WKApp.loginInfo.uid}/im`).then((resp) => {
            let addr = resp.wss_addr
            if(!addr || addr==='') {
                addr =  resp.ws_addr
            }
            return addr
        });
    }
    imConnectAddrs(): Promise<string[]> {
        return WKApp.apiClient.get(`users/${WKApp.loginInfo.uid}/im`).then((resp) => {
            let addr = resp.wss_addr
            if(!addr || addr==='') {
                addr =  resp.ws_addr
            }
            return [addr]
        });
    }

    toContacts(resultDic: any): Contacts {
        const contacts = new Contacts()
        contacts.uid = resultDic["uid"] || ""
        contacts.name = resultDic["name"] || ""
        contacts.remark = resultDic["remark"] || ""
        if (resultDic["version"]) {
            contacts.version = resultDic["version"] + ""
        }
        contacts.avatar = WKApp.shared.avatarUser(contacts.uid)
        contacts.status = resultDic["status"] || 0
        contacts.follow = resultDic["follow"] || 0
        contacts.vercode = resultDic["vercode"] || ""
        contacts.robot = resultDic["robot"] === 1
        contacts.category = resultDic["category"] || ""

        return contacts
    }

    async searchFriends(keyword?: string): Promise<ChannelInfo[]> {
        const spaceId = WKApp.shared.currentSpaceId
        let resp: any
        if (spaceId) {
            // Space 模式：从 Space 成员搜索
            resp = await WKApp.apiClient.get(`space/${spaceId}/members`, {
                param: { page: "1", limit: "10000" },
            })
        } else {
            resp = await WKApp.apiClient.get('friend/sync', {
                param: {
                    "keyword": keyword,
                    "api_version": "1"
                }
            })
        }
        const channelInfos = [];
        if (resp) {
            for (const data of resp) {
                if (data.is_deleted === 1) {
                    continue
                }
                // 排除自己
                if (data.uid === WKApp.loginInfo.uid) {
                    continue
                }
                // Space 模式下本地 keyword 过滤
                if (spaceId && keyword) {
                    const name = (data.name || "").toLowerCase()
                    if (!name.includes(keyword.toLowerCase())) {
                        continue
                    }
                }
                let channelInfo = new ChannelInfo();
                channelInfo.channel = new Channel(data.uid, ChannelTypePerson);
                channelInfo.title = data.name;
                channelInfo.logo = WKApp.shared.avatarChannel(channelInfo.channel);
                channelInfo.mute = data.mute === 1;
                channelInfo.top = data.top === 1;
                channelInfo.orgData = data;
                if (!channelInfo.orgData) {
                    channelInfo.orgData = {}
                }
                if (channelInfo.orgData.remark && channelInfo.orgData.remark !== "") {
                    channelInfo.orgData.displayName = channelInfo.orgData.remark;
                } else {
                    channelInfo.orgData.displayName = channelInfo.title;
                }

                channelInfos.push(channelInfo);
            }
        }
        return channelInfos;
    }

}