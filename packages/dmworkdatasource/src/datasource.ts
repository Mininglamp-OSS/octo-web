import { ChannelQrcodeResp, Contacts, IChannelDataSource, ICommonDataSource, WKApp, RequestConfig, GroupRole, hasSpacePrefix, Thread, ThreadListStatus, ChannelTypeCommunityTopic, buildThreadChannelId, ChannelFilesResp, parseThreadChannelId, IncomingWebhook, IncomingWebhookCreateResp, IncomingWebhookUpsertReq, IncomingWebhookService, StickerItem } from "@octo/base";
import axios from "axios";
import { Channel, ChannelInfo, ChannelTypeGroup, ChannelTypePerson, WKSDK, Message, MessageContentType,ConversationExtra,Subscriber } from "wukongimjssdk";

const MAX_GROUP_LIST_LIMIT = 100000;
const MAX_FAVORITES_PAGE_SIZE = 10000;

interface GroupMemberMap {
    uid: string;
    name?: string;
    remark?: string;
    role?: number;
    version?: number;
    is_deleted?: number;
    status?: number;
    bot_admin?: number;
    [key: string]: unknown;
}

interface GroupMemberLookupResp {
    exists?: boolean;
    member?: GroupMemberMap;
}

function toSubscriber(memberMap: GroupMemberMap): Subscriber {
    const member = new Subscriber();
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
    return member
}

export class ChannelDataSource implements IChannelDataSource {

    async exitChannel(channel: Channel): Promise<void> {
        if (channel.channelType === ChannelTypePerson) {
            return
        }
        return WKApp.apiClient.post(`groups/${channel.channelID}/exit`)
    }

    async groupDisband(channel: Channel): Promise<void> {
        if (channel.channelType === ChannelTypePerson) {
            return
        }
        // 后端：DELETE /groups/:group_no/disband，仅群主有权，幂等。group_no === channelID。
        return WKApp.apiClient.delete(`groups/${channel.channelID}/disband`)
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
    createChannel(uids: string[], options?: { categoryId?: string; name?: string; avatarText?: string; avatarColor?: number }): Promise<any> {
        const body: any = { members: uids }
        const spaceId = WKApp.shared.currentSpaceId
        if (spaceId) {
            body.space_id = spaceId
        }
        if (options?.categoryId) {
            body.category_id = options.categoryId
        }
        if (options?.name) {
            body.name = options.name
        }
        // 自定义群头像：仅在用户显式设置时下发；缺省由服务端渲染默认双人图标。
        if (options?.avatarText) {
            body.avatar_text = options.avatarText
        }
        if (typeof options?.avatarColor === "number" && options.avatarColor >= 0) {
            body.avatar_color = options.avatarColor
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
    async removeSubscribers(channel: Channel, uids: string[]): Promise<void> {
        await WKApp.apiClient.delete(`groups/${channel.channelID}/members`, {
            data: {
                members: uids,
            }
        })
        // Refresh the local member cache so the operator sees the change without a reload.
        // syncSubscribes fires notifySubscribeChangeListeners -> reloadSubscribers, keeping
        // the @mention candidate list in sync. A failure here must not fail the remove
        // itself (members are already removed on the server); worst case degrades back to
        // needing a manual refresh.
        try {
            await WKSDK.shared().channelManager.syncSubscribes(channel)
        } catch (e) {
            console.warn("[removeSubscribers] syncSubscribes failed", e)
        }
    }
    async addSubscribers(channel: Channel, uids: string[]): Promise<void> {
        await WKApp.apiClient.post(`groups/${channel.channelID}/members`, {
            members: uids,
        })
        // Refresh the local member cache so the operator sees new members without a reload.
        // syncSubscribes fires notifySubscribeChangeListeners -> reloadSubscribers, keeping
        // the @mention candidate list in sync. A failure here must not fail the add itself
        // (members are already added on the server); worst case degrades back to needing a
        // manual refresh.
        try {
            await WKSDK.shared().channelManager.syncSubscribes(channel)
        } catch (e) {
            console.warn("[addSubscribers] syncSubscribes failed", e)
        }
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
                members.push(toSubscriber(memberMap));
            }
        }
        return members
    }

    async subscriber(channel: Channel, uid: string): Promise<Subscriber | undefined> {
        const resp: GroupMemberLookupResp | undefined = await WKApp.apiClient.get(`groups/${channel.channelID}/members/${uid}`)
        const memberMap = resp?.member
        if (!resp?.exists || !memberMap) {
            return undefined
        }
        return toSubscriber(memberMap)
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
        } else if (channel.channelType === ChannelTypeCommunityTopic) { // 子区
            const threadInfo = parseThreadChannelId(channel.channelID)
            if (!threadInfo) return
            return WKApp.apiClient.put(`groups/${threadInfo.groupNo}/threads/${threadInfo.shortId}/setting`, setting)
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

    // ---------- 群入站 Webhook ----------

    // 群面：groups/{group}/incoming-webhooks；子区面：groups/{group}/threads/{short}/incoming-webhooks。
    // threadShortId 留空即群面（与历史一致）；传入即切到子区作用域 —— 后端据此隔离 list/管理，
    // 并把 webhook 投递目标绑定到子区（#451 / octo-server #454）。channelID 必须是【父群 group_no】
    // （子区面板传父群 channel），推送 URL 不变，仍按 webhook_id/token。
    incomingWebhooks(channel: Channel, threadShortId?: string): Promise<IncomingWebhook[]> {
        return IncomingWebhookService.list(channel.channelID, threadShortId)
    }

    createIncomingWebhook(channel: Channel, req: IncomingWebhookUpsertReq, threadShortId?: string): Promise<IncomingWebhookCreateResp> {
        return IncomingWebhookService.create(channel.channelID, req, threadShortId)
    }

    updateIncomingWebhook(channel: Channel, webhookId: string, req: IncomingWebhookUpsertReq, threadShortId?: string): Promise<IncomingWebhook> {
        return IncomingWebhookService.update(channel.channelID, webhookId, req, threadShortId)
    }

    deleteIncomingWebhook(channel: Channel, webhookId: string, threadShortId?: string): Promise<void> {
        return IncomingWebhookService.delete(channel.channelID, webhookId, threadShortId)
    }

    regenerateIncomingWebhook(channel: Channel, webhookId: string, threadShortId?: string): Promise<IncomingWebhookCreateResp> {
        return IncomingWebhookService.regenerate(channel.channelID, webhookId, threadShortId)
    }

    testIncomingWebhook(channel: Channel, webhookId: string, threadShortId?: string): Promise<void> {
        return IncomingWebhookService.test(channel.channelID, webhookId, threadShortId)
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
        status?: ThreadListStatus
    }): Promise<Thread[]> {
        const resp = await WKApp.apiClient.get(`groups/${groupNo}/threads`, {
            param: req
        })
        if (Array.isArray(resp)) {
            return resp.map((item: any) => this.toThread(item, groupNo))
        }
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
        const thread = this.toThread(resp, groupNo)
        WKApp.mittBus.emit("wk:thread-created", {
            groupNo,
            shortId: thread.short_id,
            threadChannelId: thread.channel_id,
            thread,
        })
        return thread
    }

    async threadGet(groupNo: string, shortId: string): Promise<Thread> {
        const resp = await WKApp.apiClient.get(`groups/${groupNo}/threads/${shortId}`)
        return this.toThread(resp, groupNo)
    }

    async threadArchive(groupNo: string, shortId: string): Promise<void> {
        return WKApp.apiClient.post(`groups/${groupNo}/threads/${shortId}/archive`)
    }

    async threadUnarchive(groupNo: string, shortId: string): Promise<void> {
        return WKApp.apiClient.post(`groups/${groupNo}/threads/${shortId}/unarchive`)
    }

    async threadDelete(groupNo: string, shortId: string): Promise<void> {
        await WKApp.apiClient.delete(`groups/${groupNo}/threads/${shortId}`)
        const threadChannelId = buildThreadChannelId(groupNo, shortId)
        const threadChannel = new Channel(threadChannelId, ChannelTypeCommunityTopic)
        WKSDK.shared().channelManager.deleteChannelInfo(threadChannel)
        WKSDK.shared().conversationManager.removeConversation(threadChannel)
        WKApp.mittBus.emit("wk:thread-deleted", {
            groupNo,
            shortId,
            threadChannelId,
        })
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
            // tri-state: null=未设置(继承父群) 0=显式不静音 1=显式静音
            mute: data.mute ?? null,
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

// shouldAttachUploadToken decides whether the session token may ride along on a
// sticker upload POST. The token is attached when the (server-returned) upload
// URL is same-origin with EITHER trusted origin: the API the apiClient
// authenticates against, OR the document (app) origin. It is withheld only when
// the upload host matches neither — i.e. a genuinely foreign destination.
//
// `meta.url` is built server-side from APIBaseURL and points at the API's own
// auth-gated `/v1/file/upload`, so in any real deployment it equals one of those
// two origins (the API host in a cross-origin/CORS setup, the app host behind a
// same-origin proxy) → the token attaches exactly as before and the upload
// works. The guard is defense in depth: a backend that returned/redirected to a
// foreign host gets no credential. Matching against BOTH trusted origins (rather
// than the API origin alone) is deliberate — pinning to apiURL only would strip
// the *required* token whenever the upload host equals the app origin but apiURL
// is a different absolute origin, breaking a working upload (a regression the
// narrower check would introduce). On any URL-parse failure we conservatively
// withhold the token. (PR#496 review: Jerry-Xin / OctoBoooot; consistent with
// the same-origin invariant yujiawei verified server-side.)
export function shouldAttachUploadToken(uploadURL: string, apiBaseURL: string, locationHref: string): boolean {
    try {
        const docOrigin = new URL(locationHref).origin
        // apiBaseURL may be relative (e.g. "/api/v1/") or absolute; resolve it
        // against the document so its origin is comparable.
        const apiOrigin = new URL(apiBaseURL || locationHref, locationHref).origin
        const target = new URL(uploadURL, locationHref).origin
        return target === apiOrigin || target === docOrigin
    } catch {
        return false
    }
}

// Isolated axios instance carrying NONE of the project request interceptors. The
// shared global axios has a request interceptor (APIClient) that injects the
// session token into EVERY call with no origin scoping; an upload to a
// non-same-origin URL must not carry that credential, so it goes through this
// bare instance instead (see uploadSticker). Selecting headers at the call site
// is not enough on its own — the global interceptor re-adds the token regardless.
// A finite timeout avoids hanging on an unreachable foreign host.
const noInterceptorAxios = axios.create({ timeout: 60_000 })

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
    userStickers(): Promise<{ list: StickerItem[] }> {
        // 空集合后端返回 {list:[]}（不再 404）。仍兜底为 {list:[]} 以防网络异常。
        return WKApp.apiClient.get(`sticker/user`).then((r) => ({ list: (r && r.list) || [] })).catch(() => ({ list: [] }))
    }
    addSticker(req: { path: string; format: string; placeholder?: string }): Promise<StickerItem> {
        return WKApp.apiClient.post(`sticker/user`, req)
    }
    collectSticker(req: { path: string; placeholder?: string; shortcode?: string; keywords?: string[] }): Promise<StickerItem> {
        // 收藏他人贴纸：path 直接透传，后端从 path 推导 format，且按 path 幂等，
        // 前端不需要（也不能）做重传或去重。错误分支由调用方按 error.code 处理。
        return WKApp.apiClient.post(`sticker/user/collect`, req)
    }
    deleteSticker(stickerId: string): Promise<void> {
        return WKApp.apiClient.delete(`sticker/user/${encodeURIComponent(stickerId)}`)
    }
    async uploadSticker(file: File): Promise<{ path: string; format: string }> {
        // 两步上传：1) 申请上传地址（扩展名由文件名推导，服务端限定 gif/png/jpg/jpeg/webp）；
        // 2) 直传文件本体。沿用本仓库既有的 multipart 上传约定（axios + token，
        // 与头像/群头像/机器人头像上传一致）。
        const meta: any = await WKApp.apiClient.get(`file/upload?type=sticker&filename=${encodeURIComponent(file.name)}`)
        const uploadURL: string = meta && meta.url
        if (!uploadURL) {
            // internal error — surfaced to the user via the caller's localized Toast
            throw new Error("failed to obtain sticker upload url")
        }
        const form = new FormData()
        form.append("file", file)
        const locationHref = typeof window !== "undefined" ? window.location.href : ""
        const sameOrigin = !!locationHref && shouldAttachUploadToken(uploadURL, WKApp.apiClient.config.apiURL, locationHref)
        // Same-origin (the real deployment): use the shared axios so the project
        // request interceptor (APIClient) attaches the session token exactly as the
        // avatar uploads do — the auth-gated endpoint needs it; behaviour unchanged.
        // Foreign host (a URL the backend should never return): use the isolated
        // instance with NONE of the project interceptors, so the global
        // `axios.interceptors.request.use` token injection cannot re-add the
        // credential and leak it cross-origin. Withholding the token at the call
        // site alone was not enough — the interceptor re-added it regardless
        // (PR#496 review: Jerry-Xin / OctoBoooot).
        const client = sameOrigin ? axios : noInterceptorAxios
        const resp = await client.post(uploadURL, form, {
            headers: { "Content-Type": "multipart/form-data" },
        })
        const data: any = resp.data || {}
        const path: string = data.path || ""
        if (!path) {
            // 200 但响应缺 path：视作上传失败，避免拿空 path 去 addSticker 产出坏贴纸
            // （getFileURL("") → 裂图）。由调用方的本地化 Toast 兜底提示。
            throw new Error("sticker upload returned no path")
        }
        const format = String(data.ext || "").replace(/^\./, "").toLowerCase()
        return { path, format }
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
        // path 可能为 undefined/null/空串：某些消息体字段缺失（例如 Gif url、
        // sticker 分类接口失败后 bot 构造的空 content）会一路传到这里。
        // 直接返回空串，由 <img src=""> 走浏览器默认处理，避免整个会话崩溃。
        if (!path) return ''
        if (path.length > 4) {
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
        if (!path) return ''
        if (path.length > 4) {
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
        let friendUids: Set<string> | undefined
        if (spaceId) {
            // Space 模式：并行获取空间成员和好友列表
            const [membersResp, friendsResp] = await Promise.all([
                WKApp.apiClient.get(`space/${spaceId}/members`, {
                    param: { page: "1", limit: "10000" },
                }),
                WKApp.apiClient.get('friend/sync', {
                    param: { "keyword": "", "api_version": "1" }
                }),
            ])
            resp = membersResp
            friendUids = new Set<string>()
            if (friendsResp) {
                for (const f of friendsResp) {
                    if (f.is_deleted !== 1) friendUids.add(f.uid)
                }
            }
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
                // Space 模式：人类成员全部显示，Bot 仅显示已加好友的
                if (spaceId && friendUids && data.robot === 1 && !friendUids.has(data.uid)) {
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
