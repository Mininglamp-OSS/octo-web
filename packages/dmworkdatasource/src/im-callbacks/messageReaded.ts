import { Channel, Message } from "wukongimjssdk"

export interface MessageReadedCallbackDeps {
    postMessageReaded: (path: string, body: Record<string, any>) => Promise<any>
}

export function createMessageReadedCallback(deps: MessageReadedCallbackDeps) {
    return async function messageReadedCallback(channel: Channel, messages: Message[]) {
        const messageIDs = []
        if (messages && messages.length > 0) {
            for (const message of messages) {
                messageIDs.push(message.messageID)
            }
        }
        return deps.postMessageReaded("message/readed", {
            "channel_id": channel.channelID,
            "channel_type": channel.channelType,
            "message_ids": messageIDs,
        }).catch(() => undefined)
    }
}
