import { Channel, Message, MessageContent } from "wukongimjssdk";
import { MessageInputContext } from "../MessageInput";


export default interface ConversationContext {

    /**
     * 发送消息
     * @param content 消息内容
     * @param channel 接受频道,如果为空 则为当前最近会话的频道
     */
     sendMessage(content:MessageContent,channel?:Channel):Promise<Message>

     /**
      * 重发消息
      * @param message 
      */
     resendMessage(message:Message) :Promise<Message>
 
     /**
      * 滚动到底部
      */
     scrollToBottom(animate?:boolean):void
     
     insertText(text:string):void
 
      editOn() :boolean // 编辑模式是否开启
      setEditOn(edit:boolean):void // 是否开启编辑
     // 消息是否被选中
     checkeMessage(message :Message,checked:boolean) :void
 
     /**
      *  删除消息
      * @param messages 
      */
     deleteMessages(messages: Message[]): void

     /**
      *  撤回消息
      * @param message 
      */
     revokeMessage(message:Message) :Promise<void>
 
     /**
      * 点击头像
      * @param uid 
      */
      onTapAvatar(uid: string,event:React.MouseEvent<Element, MouseEvent>): void 
 
      /**
       * 显示用户信息
       * @param uid 用户uid
       */
      showUser(uid:string):any 
     /**
      * 回复消息
      * @param message 
      */
     reply(message: Message): void
 

     /**
      *  显示上下文菜单
      * @param event 
      */
     showContextMenus(message:Message,event:React.MouseEvent):void

     /**
      * 隐藏上下文菜单
      */
     hideContextMenus():void

     channel():Channel

     // 消息输入框上下文
     messageInputContext():MessageInputContext

     /**
      * 设置drag文件到最近会话里的时候会回调设置的此函数
      * @param f 
      */
     setDragFileCallback(f:(file:File)=>void):void

     /**
      * 转发消息给指定的最近会话
      * @param message 
      */
     fowardMessageUI(message:Message):void

     /**
      * 定位消息
      * @param messageSeq 
      * @param tip 是否提醒
      */
     locateMessage(messageSeq:number):any
}