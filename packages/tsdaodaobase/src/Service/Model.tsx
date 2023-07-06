import { Setting } from "wukongimjssdk/lib/proto"
import { Channel, ChannelInfo, ChannelTypePerson, Conversation, WKSDK, Message, MessageContentType, MessageStatus,MessageText } from "wukongimjssdk/lib/sdk"
import WKApp from "../App"
import { MessageContentTypeConst, MessageReasonCode, OrderFactor } from "./Const"
import { DefaultEmojiService } from "./EmojiService"
import { TypingManager } from "./TypingManager"

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
        if(this.channelInfo&& this.channelInfo.logo && this.channelInfo.logo !== "") {
            return `${WKApp.dataSource.commonDataSource.getImageURL(this.channelInfo.logo)}?v=${WKApp.shared.getChannelAvatarTag()}`
        }
        return WKApp.shared.avatarChannel(this.channel)
    }

    public get channel() {
        return this.conversation.channel
    }

    public get channelInfo() {
        return this.conversation.channelInfo
    }
    public get unread() {
        return this.conversation.unread
    }
  
    public get timestamp() {
        return this.conversation.timestamp
    }
    public set timestamp(timestamp:number) {
        this.conversation.timestamp = timestamp
    }

    public get lastMessage() {
        return this.conversation.lastMessage
    }
    public set lastMessage(lastMessage: Message | undefined) {
        this.conversation.lastMessage = lastMessage
        
    }

    public get isMentionMe()  {
        return this.conversation.isMentionMe
    }

    public get remoteExtra() {
        return this.conversation.remoteExtra
    }

    public set isMentionMe(isMentionMe:boolean | undefined) {
        this.conversation.isMentionMe = isMentionMe
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
        if(!this.conversation.extra) {
            this.conversation.extra = {}
        }
        return this.conversation.extra
    }
   

    public get category()  {
        if(!this.conversation.channelInfo || !this.conversation.channelInfo.orgData) {
            return ""
        }
        const channelInfo = this.conversation.channelInfo;
        if(channelInfo.orgData.category !=='' && channelInfo.orgData.category ==='solved') {
            return channelInfo.orgData.category
        }
        if(channelInfo.orgData.category ==='' && channelInfo.orgData.agent_uid==='') {
            return "new"
        }
        if(channelInfo.orgData.agent_uid === WKApp.loginInfo.uid) {
            return "assignMe"
        }
        if(channelInfo.orgData.agent_uid!=='') {
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

    constructor(type: PartType, text: string,data?:any) {
        this.type = type
        this.text = text
        this.data = data
    }
}
export class MessageWrap {
    public message: Message
    public checked!: boolean // 是否选中
    public locateRemind?:boolean // 定位到消息后是否需要提醒
    constructor(message: Message) {
        this.message = message
        this.order = message.messageSeq * OrderFactor
    }
    private _parts!: Array<Part>

    preMessage?: MessageWrap
    nextMessage?: MessageWrap
    voiceBuff?: any // 声音的二进制文件，用于缓存
   private  _reasonCode?:number // 消息错误原因代码
    order:number = 0 // 消息排序号
    /* tslint:disable-line */
    public get header() {
        return this.message.header
    }
    public get setting():Setting {
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
        if(this.status == MessageStatus.Normal) {
            return MessageReasonCode.reasonSuccess
        }
        return  this._reasonCode||MessageReasonCode.reasonUnknown
    }
    public set reasonCode(v:number) {
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
    public set readedCount(v:number) {
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
        const textContent = this.content as MessageText
        let text = textContent.text || ''
        const mention = this.content.mention
        if (!mention?.uids || mention.uids.length <= 0) {
            return [new Part(PartType.text, text)]
        }
        let parts = new Array<Part>();
        let i = 0
        while (text.length > 0) {
            const mentionMatchResult = text.match(/@([\w\u4e00-\u9fa5])+/m)
            let index = mentionMatchResult?.index
            if (index === undefined) {
                index = -1
            }
            if (!mentionMatchResult || index === -1) {
                parts.push(new Part(PartType.text, text))
                break
            }
            if (index > 0) {
                parts.push(new Part(PartType.text, text.substring(0, index)));
            }
            let data = {}
            if(i<mention.uids.length) {
                data = {"uid": mention.uids[i]}
            }
           
            parts.push(new Part(PartType.mention, text.substr(index, mentionMatchResult[0].length),data))
            text = text.substring(index + mentionMatchResult[0].length);

            i++
        }
        return parts;
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
                    newParts.push(new Part(PartType.emoji, text.substr(index, matchResult[0].length)));
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
                    const matchResult = text.match(/((http|ftp|https):\/\/|www.)[\w\-_]+(\.[\w\-_]+)+([\w\-\.,@?^=%&amp;:/~\+#]*[\w\-\@?^=%&amp;/~\+#])?/)
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
                    newParts.push(new Part(PartType.link, text.substr(index, matchResult[0].length)));
                    text = text.substring(index + matchResult[0].length);
                }
            }else {
                newParts.push(part)
            }
        }
        return newParts
    }

    public get flame() :boolean {
        if(this.message.content.contentObj) {
            return  this.message.content.contentObj.flame === 1
        }
       return false
    }

    public get remoteExtra() {
        return this.message.remoteExtra
    }

}
