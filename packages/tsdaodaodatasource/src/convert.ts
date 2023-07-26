import BigNumber from "bignumber.js";
import { Setting } from "wukongimjssdk";
import { WKSDK, ChannelInfo, Channel, Conversation, Message, MessageStatus, ChannelTypePerson, ChannelTypeGroup,ConversationExtra,Reminder, MessageExtra } from "wukongimjssdk";


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
        channelInfo.orgData.displayName = data.remark && data.remark !== "" ? data.remark : channelInfo.title;
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

        channelInfo.logo = data.logo
        if (!channelInfo.logo || channelInfo.logo === "") {
            channelInfo.logo = `groups/${data.group_no}/avatar`
        }
        return channelInfo
    }

    static stringToUint8Array(str: string): Uint8Array {
        const newStr = unescape(encodeURIComponent(str))
        var arr = [];
        for (var i = 0, j = newStr.length; i < j; ++i) {
            arr.push(newStr.charCodeAt(i));
        }
        var tmpUint8Array = new Uint8Array(arr);
        return tmpUint8Array
    }
}