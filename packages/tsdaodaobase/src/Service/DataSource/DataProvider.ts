import { Channel, Conversation, Message, MessageExtra, PullMode } from "wukongimjssdk/lib/sdk"


export class SyncMessageOptions {
    startMessageSeq: number = 0 // 开始消息列号（结果包含start_message_seq的消息）
    endMessageSeq: number = 0 // 结束消息列号（结果不包含end_message_seq的消息）0表示不限制
    limit: number = 30 // 每次限制数量
    pullMode!:PullMode // 拉取模式 0:向下拉取 1:向上拉取

    constructor() {

    }
}

export interface IConversationProvider {

    /**
        * 同步消息
        * @param channel 频道
        * @param maxMessageSeq  最大消息seq 默认 0
        * @param limit 消息数量限制 默认：15
        */
    syncMessages(channel: Channel, opts?: SyncMessageOptions): Promise<Array<Message>>

    /**
     * 同步消息扩展
     * @param channel  频道
     * @param version 扩展版本
     * @param limit 
     */
    syncMessageExtras(channel: Channel, version: number, limit: number): Promise<MessageExtra[]> 

    /**
      * 撤回消息
      * @param message 
      */
    revokeMessage(message: Message): Promise<void>

    /**
    * 设置最近会话未读数量
    * @param channel 
    */
    markConversationUnread(channel: Channel,unread:number): Promise<void>

    /**
  *  删除最近会话
  * @param channel 
  */
    deleteConversation(channel: Channel): Promise<void>

    /**
     * 清空某个最近会话的消息
     * @param conversation 
     */
    clearConversationMessages(conversation: Conversation): Promise<void>

      /**
     *  删除消息
     * @param messages 
     * @param Message 
     */
       deleteMessages(messages: Message[]): Promise<void>


}