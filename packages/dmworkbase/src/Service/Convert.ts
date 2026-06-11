import BigNumber from "bignumber.js";
import { Setting } from "wukongimjssdk";
import { WKSDK, ChannelInfo, Channel, Conversation, Message, MessageStatus, ChannelTypePerson, ChannelTypeGroup,ConversationExtra,Reminder, MessageExtra, Reply } from "wukongimjssdk";
import { displayName as resolveDisplayName } from "../Utils/displayName";


/**
 * 将服务端 msg-level 外部来源字段从原始 JSON map 透传到目标对象上。
 * 覆盖字段：from_is_external / from_source_space_name / from_home_space_id /
 * from_home_space_name。消费方（MessageWrap getter）按 snake_case 属性读取。
 *
 * 用于所有「从服务端 JSON 反序列化得到 Message/Reply」的路径：
 *   - Convert.toMessage（conversation/sync 的 recents / message/channel/sync）
 *   - MergeforwardContent.mapToMessage（合并转发内嵌消息）
 *   - Reply.prototype.decode（引用消息预览，见 patchSdkDecodeForExternalFields）
 *   - 未来任何新的 decode 入口应同样调用此方法
 *
 * target 使用 any 以便同时兼容 SDK 的 Message 与 Reply 实例；两者都没有
 * 对应字段的声明，消费方统一通过 snake_case 属性读取。
 *
 * 硬约束：仅做字段拷贝；不修改 resolver 或渲染逻辑。
 */
export function applyMsgLevelExternalFields(target: any, msgMap: any): void {
    if (!target || !msgMap) return

    const fromIsExternal = msgMap["from_is_external"]
    if (fromIsExternal !== undefined && fromIsExternal !== null) {
        target.from_is_external = fromIsExternal === 1 ? 1 : 0
    }
    const fromSourceSpaceName = msgMap["from_source_space_name"]
    if (fromSourceSpaceName !== undefined && fromSourceSpaceName !== null) {
        target.from_source_space_name = fromSourceSpaceName
    }
    const fromHomeSpaceId = msgMap["from_home_space_id"]
    if (fromHomeSpaceId !== undefined && fromHomeSpaceId !== null) {
        target.from_home_space_id = fromHomeSpaceId
    }
    const fromHomeSpaceName = msgMap["from_home_space_name"]
    if (fromHomeSpaceName !== undefined && fromHomeSpaceName !== null) {
        target.from_home_space_name = fromHomeSpaceName
    }
}

/**
 * 内部工具：判定 home_space_id / name 是否需要兜底（空/未设置算需要）。
 */
function needsHomeSpaceFields(target: any): { needId: boolean; needName: boolean } {
    const needId = target.from_home_space_id === undefined || target.from_home_space_id === null || target.from_home_space_id === ""
    const needName = target.from_home_space_name === undefined || target.from_home_space_name === null || target.from_home_space_name === ""
    return { needId, needName }
}

/**
 * 内部工具：如果 org 中有对应字段，则按需写入 target，空字符串不写入。
 */
function fillHomeSpaceFromOrg(target: any, org: any, need: { needId: boolean; needName: boolean }): void {
    if (!org) return
    if (need.needId) {
        const hsId = org.home_space_id
        if (typeof hsId === "string" && hsId.length > 0) {
            target.from_home_space_id = hsId
        }
    }
    if (need.needName) {
        const hsName = org.home_space_name
        if (typeof hsName === "string" && hsName.length > 0) {
            target.from_home_space_name = hsName
        }
    }
}

/**
 * 内部工具：从 target（Message 实例）或 msgMap（SendPacket / RecvPacket 样式）
 * 中还原出 msg 所在的群 Channel，便于查询群成员列表。
 * 仅当推断出 ChannelTypeGroup 时返回 Channel；否则返回 undefined。
 */
function resolveGroupChannel(target: any, msgMap: any): Channel | undefined {
    const ch: any = target?.channel
    if (ch && ch.channelType === ChannelTypeGroup && typeof ch.channelID === "string" && ch.channelID.length > 0) {
        return ch as Channel
    }
    if (msgMap) {
        const cid = msgMap.channelID ?? msgMap.channel_id
        const ctype = msgMap.channelType ?? msgMap.channel_type
        if (typeof cid === "string" && cid.length > 0 && ctype === ChannelTypeGroup) {
            return new Channel(cid, ChannelTypeGroup)
        }
    }
    return undefined
}

/**
 * dmwork-web#1069 round 4 / 5：
 * 通过 WebSocket 推送（含 Message 构造 / Message.fromSendPacket）投递的消息，
 * 二进制 wire protocol 不携带 msg-level 外部来源字段——SendPacket / RecvPacket
 * 仅含 payload / channelID / fromUID / ... 没有 from_home_space_* 或 from_is_external。
 * 对这条路径仅靠原地字段拷贝不够，需要以 fromUID 反查**本地同步 cache** 补齐
 * 发送者的 home_space_id / home_space_name。
 *
 * 兜底数据源优先级（R5 调整，修 R4 在群聊场景命中率为 0）：
 *   1) wire/REST 自带字段（msgMap / target 现场值）— 优先
 *   2) 群成员列表 `channelManager.getSubscribes(groupChannel)`
 *      → `Subscriber.orgData.home_space_id/home_space_name`
 *      后端 dmworkim#1233 已 enrich 群成员列表，发送者级别 home_space 就在这里；
 *      群员 cache 是「只要你打开过这个群」就会热起来的聚合数据源。
 *   3) Person 频道 `channelManager.getChannelInfo(Person(fromUID)).orgData`
 *      最后一道防线：仅在双方真跟对方私聊（1v1）开过时才有值；
 *      R4 把它当主兜底源是错的（未开 1v1 时 cache miss），现在降级为兜底的兜底。
 * 已有值绝不覆盖；空字符串视为未设置，允许继续向下兜底。
 *
 * 调用位置（R5：不再 monkey-patch SDK prototype）：
 *   - Convert.toMessage（REST / conversation sync）— 本文件收尾
 *   - ConversationVM.didMount messageListener（WebSocket 推送）— 业务层入口
 *   - ConversationVM.sendMessage 收尾（自己发送 / send-ack 回放）— 业务层入口
 *   - 将来任何新的 Message 入口都应在业务层收尾补一次，不要再 patch SDK
 *
 * 硬约束：仅读本地 cache（不触发网络请求），失败（未缓存 / 异常）静默放过。
 */
export function applyMsgLevelExternalFieldsWithFallback(target: any, msgMap: any): void {
    applyMsgLevelExternalFields(target, msgMap)

    if (!target) return
    // 优先使用现场 JSON 携带的值；缺则依次走群成员列表 → Person 频道兜底
    let need = needsHomeSpaceFields(target)
    if (!need.needId && !need.needName) return

    const fromUID: string | undefined = target.fromUID || (msgMap && msgMap.fromUID) || (msgMap && msgMap["from_uid"])
    if (!fromUID) return

    // 2) 群成员列表兜底（R5 新增主路径）：仅在 msg 所在 channel 是群时有意义。
    //    群成员 cache 里的 orgData 是**发送者级别**的 home_space_*（后端 enrich 过），
    //    比 Person channel cache 对「仅在群里见过、没开 1v1」的用户命中率高得多。
    const groupChannel = resolveGroupChannel(target, msgMap)
    if (groupChannel) {
        try {
            const subs: any = WKSDK.shared().channelManager.getSubscribes(groupChannel)
            if (subs && typeof subs.length === "number" && subs.length > 0) {
                const member = subs.find((s: any) => s && s.uid === fromUID)
                fillHomeSpaceFromOrg(target, member?.orgData, need)
                need = needsHomeSpaceFields(target)
                if (!need.needId && !need.needName) return
            }
        } catch (_e) {
            // channelManager 未初始化 / cache 未加载：静默，让 Person 兜底接管
        }
    }

    // 3) Person 频道兜底（R4 原逻辑，保留为最后防线）：仅当 fromUID 对应的
    //    1v1 Channel 已缓存过才会有值（用户真的跟对方私聊过）。
    try {
        const info = WKSDK.shared().channelManager.getChannelInfo(new Channel(fromUID, ChannelTypePerson))
        fillHomeSpaceFromOrg(target, info?.orgData, need)
    } catch (_e) {
        // channelManager 未初始化或查询失败：静默兜底失败，上层保留既有字段
    }
}

let sdkDecodePatched = false

/**
 * Monkey-patch WKSDK 内部 decode 路径，仅限补齐那些**纯二进制 decode 入口**
 * 并且不存在业务层收尾点的场景。
 *
 * 当前仅保留一个 patch：
 *   - `Reply.prototype.decode`：引用消息预览（PR#1073, round 2/3）。
 *     Reply 由 SDK 在各种消息内容里反序列化，业务层没有集中的"刚 new 出来的
 *     Reply"收尾点；必须 patch decode 本身才能拿到这些字段。
 *
 * R5（本次）撤掉 R4 叠加上去的两个无效 patch：
 *   - `Message.fromSendPacket` wrapper：wire protocol 不携带 home_space_*，
 *     原始 patch 仅做"空拷贝"（没东西可拷），既无效又吃 SDK prototype。
 *     自发送 / send-ack 路径改在业务层 `ConversationVM.sendMessage` 收尾处
 *     统一用 `applyMsgLevelExternalFieldsWithFallback` 补字段。
 *   - `ChatManager.prototype.notifyMessageListeners` wrapper：R4 配套的
 *     Person-channel fallback 对"仅在群见过的外部成员"100% cache miss
 *     （im-test 2026-04-29 实测）。WebSocket 推送路径改在业务层
 *     `ConversationVM.didMount` 的 messageListener 里补字段。
 *
 * 维护纪律：不要再往这里堆 SDK prototype patch。新增 Message 入口时，
 * 把 `applyMsgLevelExternalFieldsWithFallback` 调用放在业务层收尾处。
 *
 * 幂等：多次调用只 patch 一次。失败静默。
 *
 * 参见 dmwork-web#1069 round 2 / 4 / 5。
 */
export function patchSdkDecodeForExternalFields(): void {
    if (sdkDecodePatched) return
    sdkDecodePatched = true

    const originalReplyDecode = Reply.prototype.decode
    Reply.prototype.decode = function (data: any) {
        originalReplyDecode.call(this, data)
        applyMsgLevelExternalFields(this, data)
    }
}

export class Convert {
    static toConversation(conversationMap: any): Conversation {
        const conversation = new Conversation()
        conversation.channel = new Channel(conversationMap['channel_id'], conversationMap['channel_type'])
        conversation.unread = conversationMap['unread'] || 0;
        conversation.timestamp = conversationMap['timestamp'] || 0;

        let recents = conversationMap["recents"];
        if (recents && recents.length > 0) {
            const messageModel = this.toMessage(recents[0]);
            conversation.lastMessage = messageModel
        }
        conversation.extra = {}
        conversation.extra.top = conversationMap["stick"]
        conversation.extra.categoryId = conversationMap["category_id"] ?? null
        conversation.extra.categorySort = conversationMap["category_sort"] ?? 0
        // octo-server PR#154+：透传群表权威 space_id 与外部成员自己的 source space。
        // 用于 ChatVM 在 sync 处理时预填 WKApp.shared.channelSpaceMap /
        // channelMySourceSpaceMap，消除实时 WS 消息到达时的 fail-open 竞态窗口。
        // 老后端没有该字段时为空，走原有 channelInfo.orgData / subscriber 路径。
        if (typeof conversationMap["space_id"] === "string" && conversationMap["space_id"]) {
            conversation.extra.spaceId = conversationMap["space_id"]
        }
        if (typeof conversationMap["my_source_space_id"] === "string" && conversationMap["my_source_space_id"]) {
            conversation.extra.mySourceSpaceId = conversationMap["my_source_space_id"]
        }
        // 后端返回的 per-Space 字段
        if (conversationMap["space_unread"] !== undefined && conversationMap["space_unread"] !== null) {
            conversation.extra.spaceUnread = conversationMap["space_unread"]
        }
        if (conversationMap["space_last_message"]) {
            conversation.extra.spaceLastMessage = this.toMessage(conversationMap["space_last_message"])
        }
        if(conversationMap["extra"]) {
            conversation.remoteExtra = this.toConversationExtra(conversation.channel,conversationMap["extra"])
        }

        return conversation
    }

    static toReminder(reminderMap:any) :Reminder {
        const reminder = new Reminder()
        reminder.channel =  new Channel(reminderMap['channel_id'], reminderMap['channel_type'])
        reminder.messageID = reminderMap["message_id"]
        reminder.messageSeq = reminderMap["message_seq"]
        reminder.reminderID = reminderMap["id"]
        reminder.reminderType = reminderMap["reminder_type"]
        reminder.text = reminderMap["text"]
        reminder.data = reminderMap["data"]
        reminder.isLocate = reminderMap["is_locate"] === 1
        reminder.version = reminderMap["version"]
        reminder.done = reminderMap["done"] === 1
        return reminder
    }

    static toConversationExtra(channel:Channel,conversationExtraMap:any) :ConversationExtra {
        const conversationExtra = new ConversationExtra()
        conversationExtra.channel = channel
        conversationExtra.browseTo = conversationExtraMap["browse_to"]
        conversationExtra.keepMessageSeq = conversationExtraMap["keep_message_seq"]
        conversationExtra.keepOffsetY = conversationExtraMap["keep_offset_y"]
        conversationExtra.draft = conversationExtraMap["draft"]||""
        conversationExtra.version = conversationExtraMap["version"] 
        return conversationExtra
    }

    static toMessage(msgMap: any): Message {
        const message = new Message();
        if (msgMap['message_idstr']) {
            message.messageID = msgMap['message_idstr'];
        } else {
            message.messageID = new BigNumber(msgMap['message_id']).toString();
        }
        if (msgMap["header"]) {
            message.header.reddot = msgMap["header"]["red_dot"] === 1 ? true : false
        }
        if (msgMap["setting"]) {
            message.setting = Setting.fromUint8(msgMap["setting"])
        }
        if (msgMap["revoke"]) {
            message.remoteExtra.revoke = msgMap["revoke"] === 1 ? true : false
        }
        if(msgMap["message_extra"]) {
            const messageExtra = msgMap["message_extra"]
           message.remoteExtra = this.toMessageExtra(messageExtra)
        }
        
        message.clientSeq = msgMap["client_seq"]
        message.channel = new Channel(msgMap['channel_id'], msgMap['channel_type']);
        message.messageSeq = msgMap["message_seq"]
        message.clientMsgNo = msgMap["client_msg_no"]
        message.fromUID = msgMap["from_uid"]
        message.timestamp = msgMap["timestamp"]
        message.status = MessageStatus.Normal
        const contentObj = msgMap["payload"]
        let contentType = 0
        if (contentObj) {
            contentType = contentObj.type
        }
        const messageContent = WKSDK.shared().getMessageContent(contentType)
        if (contentObj) {
            messageContent.decode(this.stringToUint8Array(JSON.stringify(contentObj)))
        }
        message.content = messageContent

        message.isDeleted = msgMap["is_deleted"] === 1

        // 外部群成员消息来源字段（dmwork-web#1069）：
        // /message/channel/sync 和 conversation/sync 响应在 msg-level 携带
        // from_is_external / from_source_space_name / from_home_space_id /
        // from_home_space_name。优先透传 wire 值；若个别字段缺失则通过
        // 群成员列表 / Person 频道 cache 兜底（round 5）。
        // 注意：REST 路径 wire 通常已携带字段，fallback 会因短路检查 no-op。
        applyMsgLevelExternalFieldsWithFallback(message, msgMap)

        return message
    }

    static toMessageExtra(msgExtraMap: any) :MessageExtra {
        const messageExtra = new MessageExtra()
        if (msgExtraMap['message_id_str']) {
            messageExtra.messageID = msgExtraMap['message_id_str'];
        } else {
            messageExtra.messageID = new BigNumber(msgExtraMap['message_id']).toString();
        }
        messageExtra.messageSeq = msgExtraMap["message_seq"]
        messageExtra.readed = msgExtraMap["readed"] === 1
        if(msgExtraMap["readed_at"] && msgExtraMap["readed_at"]>0) {
            messageExtra.readedAt = new Date(msgExtraMap["readed_at"] )
        }
        messageExtra.revoke = msgExtraMap["revoke"] === 1
        if(msgExtraMap["revoker"]) {
            messageExtra.revoker = msgExtraMap["revoker"]
        }
        messageExtra.readedCount = msgExtraMap["readed_count"] || 0
        messageExtra.unreadCount = msgExtraMap["unread_count"] || 0
        messageExtra.extraVersion = msgExtraMap["extra_version"] || 0
        messageExtra.editedAt = msgExtraMap["edited_at"] || 0

        const contentEditObj = msgExtraMap["content_edit"]
        if(contentEditObj) {
            const contentEditContentType = contentEditObj.type
            const contentEditContent = WKSDK.shared().getMessageContent(contentEditContentType)
            const contentEditPayloadData = this.stringToUint8Array(JSON.stringify(contentEditObj))
            contentEditContent.decode(contentEditPayloadData)
            messageExtra.contentEditData = contentEditPayloadData
            messageExtra.contentEdit = contentEditContent

            messageExtra.isEdit = true
        }

        return messageExtra
    }
   

    static userToChannelInfo(data: any): ChannelInfo {
        let channelInfo = new ChannelInfo()
        channelInfo.channel = new Channel(data.uid, ChannelTypePerson);
        channelInfo.title = data.name;
        channelInfo.mute = data.mute === 1;
        channelInfo.top = data.top === 1;
        channelInfo.online = data.online === 1;
        channelInfo.lastOffline = data.last_offline

        channelInfo.orgData = data.extra || {};
        channelInfo.orgData = { ...channelInfo.orgData, ...data }
        channelInfo.orgData.remark = data.remark ?? "";
        // GH #1121: 展示名解析接入 OCTO 实名认证。
        // 优先级：real_name（已实名时）> remark（本地备注）> name（昵称）。
        // 所有消费方统一读 `orgData.displayName`，无需逐点判断 real_name。
        // 硬约束：仅在 realname_verified 为 true/1 且 real_name 非空时才覆盖昵称；
        // 字段缺失（老后端）时 behavior 与原实现一致（退化到 remark 或 title）。
        channelInfo.orgData.realname_verified =
            data.realname_verified === true || data.realname_verified === 1 ? 1 : 0;
        channelInfo.orgData.real_name = typeof data.real_name === "string" ? data.real_name : "";
        channelInfo.orgData.displayName = resolveDisplayName({
            remark: data.remark,
            realname_verified: channelInfo.orgData.realname_verified,
            real_name: channelInfo.orgData.real_name,
            name: channelInfo.title,
        }) || channelInfo.title;
        channelInfo.orgData.shortNo = data.short_no ?? ""

        channelInfo.logo = data.logo
        if (!channelInfo.logo || channelInfo.logo === "") {
            channelInfo.logo = `users/${data.uid}/avatar`
        }

        if (data.category === "system" || data.category === "customerService") { // 官方账号
            channelInfo.orgData.identityIcon = "./identity_icon/official.png"
            channelInfo.orgData.identitySize = { width: "18px", height: "18px" }
        } else if (data.category === "visitor") {
            channelInfo.orgData.identityIcon = "./identity_icon/visitor.png"
            channelInfo.orgData.identitySize = { width: "48px", height: "24px" }
        }

        return channelInfo
    }

    static groupToChannelInfo(data: any): ChannelInfo {
        let channelInfo = new ChannelInfo()
        channelInfo.channel = new Channel(data.group_no, ChannelTypeGroup);
        channelInfo.title = data.name;
        channelInfo.mute = data.mute === 1;
        channelInfo.top = data.top === 1;
        channelInfo.online = data.online === 1;
        channelInfo.lastOffline = data.last_offline

        channelInfo.orgData = data.extra || {};
        channelInfo.orgData = { ...channelInfo.orgData, ...data }
        channelInfo.orgData.remark = data.remark ?? "";
        channelInfo.orgData.displayName = data.remark && data.remark !== "" ? data.remark : channelInfo.title;
        channelInfo.orgData.forbidden = data.forbidden;
        channelInfo.orgData.invite = data.invite;
        channelInfo.orgData.forbiddenAddFriend = data.forbidden_add_friend;
        channelInfo.orgData.save = data.save;
        // 群级「允许免@回答」总开关：老数据无字段时回退 1（允许），零回归。
        channelInfo.orgData.allow_no_mention = data.allow_no_mention ?? 1;

        channelInfo.logo = data.logo
        if (!channelInfo.logo || channelInfo.logo === "") {
            channelInfo.logo = `groups/${data.group_no}/avatar`
        }
        return channelInfo
    }

    static stringToUint8Array(str: string): Uint8Array {
        return new TextEncoder().encode(str)
    }
}