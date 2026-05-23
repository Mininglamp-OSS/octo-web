import { Setting, StreamFlag } from "wukongimjssdk"
import { Channel, ChannelInfo, ChannelTypePerson, Conversation, WKSDK, Message, MessageContentType, MessageStatus, MessageText, ReminderType } from "wukongimjssdk"
import WKApp from "../App"
import { MessageContentTypeConst, MessageReasonCode, OrderFactor } from "./Const"
import { DefaultEmojiService } from "./EmojiService"
import { TypingManager } from "./TypingManager"
import { getSpaceFilteredLastMessage, SYSTEM_BOTS } from "./SpaceService"

export class ConversationWrap {
    conversation: Conversation
    constructor(conversation: Conversation) {
        this.conversation = conversation
    }

    avatarHashTag?: string
    // channel: Channel;
    // private _channelInfo;
    // unread: number;
    // timestamp: number;
    // lastMessage: Message;
    // isMentionMe: boolean;
    // constructor();
    // get channelInfo(): ChannelInfo;
    // isEqual(c: Conversation): boolean;


    public get avatar() {
        if (this.channelInfo && this.channelInfo.logo && this.channelInfo.logo !== "") {
            return `${WKApp.dataSource.commonDataSource.getImageURL(this.channelInfo.logo)}?v=${WKApp.shared.getChannelAvatarTag(this.channel)}`
        }
        return WKApp.shared.avatarChannel(this.channel)
    }

    public get channel() {
        return this.conversation.channel
    }

    public get channelInfo() {
        return this.conversation.channelInfo
    }
    // System/event message content types that should not contribute to unread count
    private static systemContentTypes: Set<number> = new Set([
        MessageContentTypeConst.addMembers,       // 1002 添加群成员
        MessageContentTypeConst.removeMembers,     // 1003 删除群成员
        MessageContentTypeConst.channelUpdate,     // 1005 频道更新
        MessageContentTypeConst.newGroupOwner,     // 1008 新的管理员
        MessageContentTypeConst.approveGroupMember,// 1009 审批群成员
    ])

    private isSystemMessage(message: Message | undefined): boolean {
        if (!message) return false
        return ConversationWrap.systemContentTypes.has(message.contentType)
    }

    public get unread() {
        const rawUnread = this.conversation.unread
        if (rawUnread === 0) return 0

        const currentSpaceId = WKApp.shared.currentSpaceId

        // 后端 per-Space 未读计数：Person 频道优先使用 space_unread
        if (currentSpaceId
            && this.conversation.channel.channelType === ChannelTypePerson
            && this.conversation.extra?.spaceUnread !== undefined) {
            return this.conversation.extra.spaceUnread
        }

        // 系统 Bot（如 BotFather）在 Space 模式下清零未读
        if (currentSpaceId
            && this.conversation.channel.channelType === ChannelTypePerson
            && SYSTEM_BOTS.has(this.conversation.channel.channelID)) {
            const lastMsg = this.conversation.lastMessage
            const msgSpaceId = lastMsg?.content?.contentObj?.space_id
            if (!msgSpaceId) {
                return 0
            }
        }

        // If unread is 1 and the last message is a system/event message,
        // don't show unread badge (fixes #165)
        if (rawUnread === 1 && this.isSystemMessage(this.conversation.lastMessage)) {
            return 0
        }
        return rawUnread
    }

    public get timestamp() {
        return this.conversation.timestamp
    }
    public set timestamp(timestamp: number) {
        this.conversation.timestamp = timestamp
    }

    public get lastMessage() {
        // 后端 per-Space 消息预览：Person 频道优先使用 space_last_message
        const currentSpaceId = WKApp.shared.currentSpaceId
        if (currentSpaceId
            && this.conversation.channel.channelType === ChannelTypePerson
            && this.conversation.extra?.spaceLastMessage) {
            return this.conversation.extra.spaceLastMessage
        }
        return getSpaceFilteredLastMessage(this.conversation)
    }
    public set lastMessage(lastMessage: Message | undefined) {
        this.conversation.lastMessage = lastMessage
    }

    public get isMentionMe(): boolean {
        // 权威来源：server-side reminders（Plan X 下 ais-only 不建 reminder，
        // 且 filterChannelLevelByPublisher 已排除 sender 自通知）
        const hasReminderMention = (this.conversation.reminders?.length ?? 0) > 0
            && this.conversation.reminders!.some(r => r.reminderType === ReminderType.ReminderTypeMentionMe && !r.done)
        if (hasReminderMention) return true

        // 实时兜底：只信 per-uid mention（不信 SDK 的 broadcast 判断）
        // Plan X: mention.all=1 不再代表人类通知，SDK 的 isMentionMe 对 broadcast 不可靠
        const mention = this.conversation.lastMessage?.content?.mention
        const myUid = WKSDK.shared().config.uid
        if (mention?.uids && Array.isArray(mention.uids) && myUid && mention.uids.includes(myUid)) {
            return true
        }

        return false
    }

    public set isMentionMe(isMentionMe: boolean | undefined) {
        this.conversation.isMentionMe = isMentionMe
    }

    public get remoteExtra() {
        return this.conversation.remoteExtra
    }

    public get reminders() {
        return this.conversation.reminders
    }

    public get simpleReminders() {
        return this.conversation.simpleReminders
    }

    reloadIsMentionMe(): void {
        return this.conversation.reloadIsMentionMe()
    }

    public get extra() {
        if (!this.conversation.extra) {
            this.conversation.extra = {}
        }
        return this.conversation.extra
    }


    public get category() {
        if (!this.conversation.channelInfo || !this.conversation.channelInfo.orgData) {
            return ""
        }
        const channelInfo = this.conversation.channelInfo;
        if (channelInfo.orgData.category !== '' && channelInfo.orgData.category === 'solved') {
            return channelInfo.orgData.category
        }
        if (channelInfo.orgData.category === '' && channelInfo.orgData.agent_uid === '') {
            return "new"
        }
        if (channelInfo.orgData.agent_uid === WKApp.loginInfo.uid) {
            return "assignMe"
        }
        if (channelInfo.orgData.agent_uid !== '') {
            return "allAssigned"
        }
        return channelInfo.orgData.category
    }

    isEqual(c: ConversationWrap): boolean {
        return this.conversation.isEqual(c.conversation)
    }
}



export enum PartType {
    text, // 普通文本
    emoji, // emoji
    mention, // @
    link // 链接
}

export enum BubblePosition {
    unknown,
    first, // 第一个
    middle, // 中间
    last,  // 最后一个
    single, // 单独
}


export class Part {
    type!: PartType // 文本内容： text:普通文本 emoji: emoji文本 mention：@文本
    text!: string
    data?: any

    constructor(type: PartType, text: string, data?: any) {
        this.type = type
        this.text = text
        this.data = data
    }
}
export class MessageWrap {
    public message: Message
    public checked!: boolean // 是否选中
    public locateRemind?: boolean // 定位到消息后是否需要提醒
    constructor(message: Message) {
        this.message = message
        this.order = message.messageSeq * OrderFactor
    }
    private _parts?: Array<Part>

    preMessage?: MessageWrap
    nextMessage?: MessageWrap
    voiceBuff?: any // 声音的二进制文件，用于缓存
    private _reasonCode?: number // 消息错误原因代码
    order: number = 0 // 消息排序号
    /* tslint:disable-line */
    public get header() {
        return this.message.header
    }
    public get setting(): Setting {
        return this.message.setting
    }
    public get clientSeq() {
        return this.message.clientSeq
    }
    public get messageID() {
        return this.message.messageID
    }
    public get messageSeq() {
        return this.message.messageSeq
    }
    public get clientMsgNo() {
        return this.message.clientMsgNo
    }
    public get fromUID() {
        return this.message.fromUID
    }

    // 外部群消息来源标记：
    // 由 Convert.toMessage 从 /message/channel/sync 响应 msg-level 字段
    // from_is_external (0|1) / from_source_space_name (string) 透传过来。
    // 消费方优先读这组 msg-level 字段；缺失时再回落到 channelInfo.orgData.is_external。
    public get fromIsExternal(): boolean {
        return (this.message as any).from_is_external === 1
    }
    public get fromSourceSpaceName(): string | undefined {
        const v = (this.message as any).from_source_space_name
        return typeof v === "string" && v.length > 0 ? v : undefined
    }

    // 消息发送者真实归属 Space（相对当前查看 Space 做外部判定）。
    // 由 Convert.toMessage 从 /message/channel/sync 的 msg-level 字段
    // from_home_space_id / from_home_space_name 透传。消费方优先读此组字段，
    // 缺失时才回落到旧的 fromIsExternal + fromSourceSpaceName。
    public get fromHomeSpaceId(): string | undefined {
        const v = (this.message as any).from_home_space_id
        return typeof v === "string" && v.length > 0 ? v : undefined
    }
    public get fromHomeSpaceName(): string | undefined {
        const v = (this.message as any).from_home_space_name
        return typeof v === "string" && v.length > 0 ? v : undefined
    }


    public get from(): ChannelInfo | undefined {
        return WKSDK.shared().channelManager.getChannelInfo(new Channel(this.fromUID, ChannelTypePerson))
    }

    public get channel() {
        return this.message.channel
    }
    public get timestamp() {
        return this.message.timestamp
    }
    public get content() {
        return this.message.content
    }
    public get status() {
        return this.message.status
    }
    public set status(status: MessageStatus) {
        this.message.status = status
    }
    public get reasonCode() {
        if (this.status === MessageStatus.Normal) {
            return MessageReasonCode.reasonSuccess
        }
        return this._reasonCode || MessageReasonCode.reasonUnknown
    }
    public set reasonCode(v: number) {
        this._reasonCode = v
    }
    public get voicePlaying() {
        return this.message.voicePlaying
    }
    public get voiceReaded() {
        return this.message.voiceReaded
    }
    public get reactions() {
        return this.message.reactions
    }
    public get unreadCount() {
        return this.message.remoteExtra.unreadCount
    }
    public get readedCount() {
        return this.message.remoteExtra.readedCount
    }
    public set readedCount(v: number) {
        this.message.remoteExtra.readedCount = v
    }
    public get isDeleted() {
        return this.message.isDeleted
    }

    public set isDeleted(isDeleted: boolean) {
        this.message.isDeleted = isDeleted
    }

    public get revoke() {
        return this.message.remoteExtra.revoke
    }
    public set revoke(revoke: boolean) {
        this.message.remoteExtra.revoke = revoke
    }

    public get revoker() {
        return this.message.remoteExtra.revoker
    }
    public set revoker(revoker: string | undefined) {
        this.message.remoteExtra.revoker = revoker
    }

    // 是否是发送的消息
    public get send(): boolean {
        return this.message.fromUID === WKApp.loginInfo.uid
    }

    public get contentType(): number {
        return this.message.contentType
    }

    public resetParts() {
        this._parts = undefined
        this._parts = this.parts
    }

    public get parts(): Array<Part> {
        if (!this._parts) {
            this._parts = this.parseMention()
            this._parts = this.parseEmoji(this._parts);
            this._parts = this.parseLinks(this._parts)
        }
        return this._parts
    }

    public get bubblePosition(): BubblePosition {

        if (!this.preIsSamePerson && this.nextIsSamePerson) {
            return BubblePosition.first
        }
        if (this.preIsSamePerson && this.nextIsSamePerson) {
            return BubblePosition.middle
        }

        if (this.preIsSamePerson && !this.nextIsSamePerson) {
            return BubblePosition.last
        }
        if (!this.preIsSamePerson && !this.nextIsSamePerson) {
            return BubblePosition.single
        }
        return BubblePosition.unknown
    }

    private get preIsSamePerson(): boolean {
        if (this.preMessage?.content.contentType === MessageContentTypeConst.time) {
            return false
        }
        if (this.preMessage?.revoke) {
            return false
        }
        return this.preMessage?.fromUID === this.fromUID
    }
    private get nextIsSamePerson(): boolean {
        if (this.nextMessage?.content.contentType === MessageContentTypeConst.time) {
            return false
        }
        if (this.nextMessage?.revoke) {
            return false
        }
        return this.nextMessage?.fromUID === this.fromUID
    }

    // 解析@
    private parseMention(): Array<Part> {
        if (this.content.contentType !== MessageContentType.text) {
            return new Array<Part>()
        }
        let textContent = this.content as MessageText
        if (this.message.remoteExtra.isEdit && this.message.remoteExtra.contentEdit !== undefined) {
            textContent = this.message.remoteExtra.contentEdit as MessageText
        }
        const text = textContent.text || ''
        const mention = this.content.mention

        if (!mention) {
            return [new Part(PartType.text, text)]
        }

        // Try entities from SDK first, then fallback to contentObj
        let entities = mention.entities
        if (!entities && this.content.contentObj?.mention?.entities) {
            entities = this.content.contentObj.mention.entities
        }

        if (entities && Array.isArray(entities)) {
            const result = this.parseMentionWithEntities(text, entities)
            if (result !== null) {
                // 如果同时有 @所有人，对 entity 结果里的普通 text 部分再做 @所有人 解析
                if (mention.all) {
                    return result.flatMap(part =>
                        part.type === PartType.text
                            ? this.parseMentionAll(part.text)
                            : [part]
                    )
                }
                return result
            }
        }

        if (mention.uids && Array.isArray(mention.uids) && mention.uids.length > 0) {
            return this.parseMentionLegacy(text, mention.uids)
        }

        // mention.all：把文本中的 @所有人/@all 替换成 uid="all" 的 mention Part
        if (mention.all) {
            return this.parseMentionAll(text)
        }

        return [new Part(PartType.text, text)]
    }

    private parseMentionAll(text: string): Array<Part> {
        const regex = /@所有人|@all/gi
        const parts: Part[] = []
        let lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                parts.push(new Part(PartType.text, text.substring(lastIndex, match.index)))
            }
            parts.push(new Part(PartType.mention, match[0], { uid: 'all' }))
            lastIndex = match.index + match[0].length
        }
        if (lastIndex < text.length) {
            parts.push(new Part(PartType.text, text.substring(lastIndex)))
        }
        return parts.length > 0 ? parts : [new Part(PartType.text, text)]
    }

    private parseMentionWithEntities(text: string, entities: Array<{uid: string; offset: number; length: number}>): Array<Part> | null {
        const validEntities = entities
            .filter((e): e is {uid: string; offset: number; length: number} =>
                e != null &&
                typeof e === 'object' &&
                !Array.isArray(e) &&
                typeof e.uid === 'string' &&
                typeof e.offset === 'number' &&
                typeof e.length === 'number' &&
                Number.isFinite(e.offset) &&
                Number.isFinite(e.length) &&
                e.offset >= 0 &&
                e.length > 0 &&
                e.offset + e.length <= text.length
            )
            .sort((a, b) => a.offset - b.offset)

        if (validEntities.length === 0) {
            return null
        }

        const deduped: Array<{uid: string; offset: number; length: number}> = []
        let lastEnd = 0
        for (const entity of validEntities) {
            if (entity.offset >= lastEnd) {
                deduped.push(entity)
                lastEnd = entity.offset + entity.length
            }
        }

        const parts: Part[] = []
        let cursor = 0

        for (const entity of deduped) {
            if (entity.offset > cursor) {
                parts.push(new Part(PartType.text, text.substring(cursor, entity.offset)))
            }

            const mentionText = text.substring(entity.offset, entity.offset + entity.length)

            if (!mentionText.startsWith('@')) {
                parts.push(new Part(PartType.text, mentionText))
                cursor = entity.offset + entity.length
                continue
            }

            // Defensive check: broadcast tokens (@all / @所有人 / @所有AI)
            // should not bind to personal entities.
            const mentionName = mentionText.slice(1)
            if (mentionName.toLowerCase() === 'all' || mentionName === '所有人' || mentionName === '所有AI') {
                parts.push(new Part(PartType.text, mentionText))
                cursor = entity.offset + entity.length
                continue
            }

            parts.push(new Part(PartType.mention, mentionText, { uid: entity.uid }))
            cursor = entity.offset + entity.length
        }

        if (cursor < text.length) {
            parts.push(new Part(PartType.text, text.substring(cursor)))
        }

        return parts
    }

    private parseMentionLegacy(text: string, uids: string[]): Part[] {
        const parts: Part[] = []
        const mentionRegex = /@[\w\u4e00-\u9fa5.\-]+/gm
        let match: RegExpExecArray | null
        let cursor = 0
        let i = 0

        while ((match = mentionRegex.exec(text)) !== null && i < uids.length) {
            const matchStart = match.index
            const matchText = match[0]
            const mentionName = matchText.slice(1)

            // Skip @all / @所有人 / @所有AI — these correspond to broadcast
            // flags (mentionAll / humans / ais), not individual uid mentions.
            // @所有AI was added for GH#100: client-side bot UID expansion puts
            // routing UIDs into mention.uids, but the broadcast text token must
            // not bind to any of them.
            if (mentionName.toLowerCase() === 'all' || mentionName === '所有人' || mentionName === '所有AI') {
                continue
            }

            if (matchStart > 0) {
                const charBefore = text.charCodeAt(matchStart - 1)
                if ((charBefore >= 97 && charBefore <= 122) ||
                    (charBefore >= 65 && charBefore <= 90) ||
                    (charBefore >= 48 && charBefore <= 57) ||
                    charBefore === 95) {
                    continue
                }
            }

            if (matchStart > cursor) {
                parts.push(new Part(PartType.text, text.substring(cursor, matchStart)))
            }

            const data = i < uids.length ? { uid: uids[i] } : {}
            parts.push(new Part(PartType.mention, matchText, data))
            cursor = matchStart + matchText.length
            i++
        }

        if (cursor < text.length) {
            parts.push(new Part(PartType.text, text.substring(cursor)))
        }

        return parts
    }
    // 解析emoji
    parseEmoji(parts: Array<Part>): Array<Part> {
        if (!parts || parts.length <= 0) {
            return parts;
        }
        let len = parts.length;
        let newParts = new Array<Part>();
        for (let index = 0; index < len; index++) {
            const part = parts[index];
            if (part.type === PartType.text) {
                let text = part.text;
                while (text.length > 0) {
                    const matchResult = text.match(DefaultEmojiService.shared.emojiRegExp())
                    if (!matchResult) {
                        newParts.push(new Part(PartType.text, text))
                        break
                    }
                    let index = matchResult?.index
                    if (index === undefined) {
                        index = -1
                    }
                    if (index === -1) {
                        newParts.push(new Part(PartType.text, text))
                        break
                    }
                    if (index > 0) {
                        newParts.push(new Part(PartType.text, text.substring(0, index)));
                    }
                    newParts.push(new Part(PartType.emoji, text.substring(index, index + matchResult[0].length)));
                    text = text.substring(index + matchResult[0].length);
                }
            } else {
                newParts.push(part);
            }

        }
        return newParts;
    }

    parseLinks(parts: Array<Part>): Array<Part> {
        if (!parts || parts.length <= 0) {
            return parts;
        }
        let newParts = new Array<Part>();
        let len = parts.length;
        for (let index = 0; index < len; index++) {
            const part = parts[index];
            if (part.type === PartType.text) {
                let text = part.text;
                while (text.length > 0) {
                    const matchResult = text.match(/((http|ftp|https):\/\/|www.)[\w\-_]+(\.[\w\-_]+)+([\w\-\.,?^=%&amp;:/~\+#]*[\w\-?^=%&amp;/~\+#])?/)
                    if (!matchResult) {
                        newParts.push(new Part(PartType.text, text))
                        break
                    }
                    let index = matchResult?.index
                    if (index === undefined) {
                        index = -1
                    }
                    if (index === -1) {
                        newParts.push(new Part(PartType.text, text))
                        break
                    }
                    if (index > 0) {
                        newParts.push(new Part(PartType.text, text.substring(0, index)));
                    }
                    newParts.push(new Part(PartType.link, text.substring(index, index + matchResult[0].length)));
                    text = text.substring(index + matchResult[0].length);
                }
            } else {
                newParts.push(part)
            }
        }
        return newParts
    }

    // 是否是流式消息
    public get streamOn(): boolean {
        return this.message.streamOn || false
    }

    // 流式消息是否正在进行中
    public get isStreaming(): boolean {
        return this.streamOn && this.message.streamFlag !== StreamFlag.END
    }

    // 获取流式消息的完整内容（初始内容 + 所有 stream items 的内容拼接）
    public get fullStreamContent(): string {
        const text = (this.content as any)?.text || ''
        if (!this.message.streams || this.message.streams.length === 0) {
            return text
        }
        let result = text
        for (const item of this.message.streams) {
            result += (item.content as any)?.text || ''
        }
        return result
    }

    public get flame(): boolean {
        if (this.message.content.contentObj) {
            return this.message.content.contentObj.flame === 1
        }
        return false
    }

    public get remoteExtra() {
        return this.message.remoteExtra
    }

}
