import { IConversationProvider, WKApp, SyncMessageOptions } from "@tsdaodao/base";
import axios from "axios";
import { Conversation, Message, Channel, MessageExtra } from "wukongimjssdk";
import { Convert } from "./convert";

export class ConversationProvider implements IConversationProvider {


    async deleteConversation(channel: Channel): Promise<void> {
        return axios.delete(`conversations/${channel.channelID}/${channel.channelType}`)
    }

    // 删除消息
    async deleteMessages(messages: Message[]): Promise<void> {
        if (!messages || messages.length === 0) {
            return undefined
        }
        var params = []
        for (const message of messages) {
            params.push({
                "message_id": message.messageID,
                "channel_id": message.channel.channelID,
                "channel_type": message.channel.channelType,
                "message_seq": message.messageSeq,
            })
        }

        return await axios.delete("message", {
            data: params
        })
    }
    revokeMessage(message: Message): Promise<void> {
        return WKApp.apiClient.post(`message/revoke?channel_id=${message.channel.channelID}&channel_type=${message.channel.channelType}&message_id=${message.messageID}&client_msg_no=${message.clientMsgNo}`)
    }


    markConversationUnread(channel: Channel, unread: number): Promise<void> {
        return WKApp.apiClient.put('coversation/clearUnread', { "channel_id": channel.channelID, "channel_type": channel.channelType, "unread": unread > 0 ? unread : 0 }).catch(function (error) {
            console.log(error);
            return error;
        });

    }

    // 同步消息 由于isdelete导致可能一页消息数量不够 甚至没有，所以 syncGetMessages 写成回调
    async syncMessages(channel: Channel, opts: SyncMessageOptions = new SyncMessageOptions()): Promise<Message[]> {
        var messages = await this.syncGetMessages(channel, opts);
        return messages
    }

    async syncGetMessages(channel: Channel, opts: SyncMessageOptions): Promise<Message[]> {
        let messages = new Array<Message>()
        const limit = opts.limit || 15;
        var resp = await WKApp.apiClient.post(`message/channel/sync`, { "limit": limit, "channel_id": channel.channelID, "channel_type": channel.channelType, "start_message_seq": opts.startMessageSeq || 0, "end_message_seq": opts.endMessageSeq || 0, "pull_mode": opts.pullMode });
        const messageList = resp && resp["messages"]
        if (messageList) {
            messageList.forEach((msg: any) => {
                const message = Convert.toMessage(msg);
                messages.push(message);
            });
            // if (resp.data.more === 1 && messages.length < limit && resp.data["messages"].length) {
            //     opts.maxMessageSeq = resp.data["messages"][0].message_seq;
            //     opts.limit = limit - messages.length;
            //     var data = await this.syncGetMessages(channel, opts);
            //     messages = data.concat(messages);
            // }
        }

        return messages
    }

    async syncMessageExtras(channel: Channel, version: number, limit: number): Promise<MessageExtra[]> {
        let messageExtras = new Array<MessageExtra>()

        let messageExtraObjs = await WKApp.apiClient.post(`message/extra/sync`, { "channel_id": channel.channelID, "channel_type": channel.channelType, "extra_version": version, "limit": limit })
        if(messageExtraObjs) {
            messageExtraObjs.forEach((extraObj:any)=>{
                const messageExtra = Convert.toMessageExtra(extraObj)
                messageExtras.push(messageExtra)
            }) 
        }
        return messageExtras
    }

    clearConversationMessages(conversation: Conversation): Promise<void> {
        return axios.post("message/offset", {
            channel_id: conversation.channel.channelID,
            channel_type: conversation.channel.channelType,
            message_seq: conversation.lastMessage?.messageSeq || 0,
        })
    }
}