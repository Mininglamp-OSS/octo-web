import { Channel, WKSDK, Message } from "wukongimjssdk/lib/sdk";
import WKApp from "./App";
import React, { Component, ReactNode } from "react";
import { ChatContentPage } from "./Pages/Chat";
import { EndpointCategory, EndpointID } from "./Service/Const";
import { EndpointManager } from "./Service/Module";
import ConversationContext from "./Components/Conversation/context";

export class MessageContextMenus {
  title!:string
  onClick?:()=>void
}

export class EndpointCommon {
  private _onLogins: VoidFunction[] = []; // 登录成功

  constructor() {
    this.registerShowConversation()
  }

  addOnLogin(v: VoidFunction) {
    this._onLogins?.push(v)
  }

  removeOnLogin(v: VoidFunction) {
    const len = this._onLogins.length;
    for (var i = 0; i < len; i++) {
      if (v === this._onLogins[i]) {
        this._onLogins.splice(i, 1);
        return;
      }
    }
  }

  showConversation(channel: Channel) {
    WKApp.shared.openChannel = channel
    EndpointManager.shared.invoke(EndpointID.showConversation, { channel: channel })
    WKApp.shared.notifyListener()
  }

  registerContactsHeader(id: string, callback: (param: any) => JSX.Element, sort?: number) {
    EndpointManager.shared.setMethod(id, (param) => {
      return callback(param)
    }, {
      sort: sort,
      category: EndpointCategory.contactsHeader
    })
  }
  contactsHeaders(): JSX.Element[] {
    return EndpointManager.shared.invokes(EndpointCategory.contactsHeader)
  }

  private registerShowConversation() {
    EndpointManager.shared.setMethod(EndpointID.showConversation, (param: any) => {
      const channel = param.channel as Channel
      const conversation = WKSDK.shared().conversationManager.findConversation(channel)
      let initLocateMessageSeq = 0
      if(conversation && conversation.lastMessage && conversation.unread>0 && conversation.lastMessage.messageSeq  > conversation.unread) {
        initLocateMessageSeq = conversation.lastMessage.messageSeq - conversation.unread
    }
      WKApp.routeRight.replaceToRoot(<ChatContentPage key={channel.getChannelKey()} channel={channel} initLocateMessageSeq={initLocateMessageSeq}></ChatContentPage>)
    }, {})
  }

  registerMessageContextMenus(sid: string, handle: (message: Message,context:ConversationContext) => MessageContextMenus|null,sort?:number) {
    EndpointManager.shared.setMethod(sid, (param: any) => {
      return handle(param.message,param.context)
    }, {
      category: EndpointCategory.messageContextMenus,
      sort: sort,
    })
  }

  messageContextMenus(message: Message,ctx:ConversationContext): MessageContextMenus[] {
    return EndpointManager.shared.invokes(EndpointCategory.messageContextMenus, {message:message,context:ctx})
  }

  registerChatToolbar(sid:string,handle:(ctx:ConversationContext)=>React.ReactNode|undefined) {
      EndpointManager.shared.setMethod(sid,(param)=>{
        return handle(param)
      },{
        category: EndpointCategory.chatToolbars
      })
  }

  chatToolbars(ctx:ConversationContext) :React.ReactNode[] {
    return EndpointManager.shared.invokes(EndpointCategory.chatToolbars,ctx)
  }


  callOnLogin() {
    const len = this._onLogins.length;
    for (var i = 0; i < len; i++) {
      this._onLogins[i]()
    }
  }

}

export class ChatToolbar {
  icon!:string
  onClick?:()=>void
}