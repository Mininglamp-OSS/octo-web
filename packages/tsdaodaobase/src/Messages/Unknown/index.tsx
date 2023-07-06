import { UnknownContent } from "wukongimjssdk/lib/sdk";
import React from "react";
import MessageBase from "../Base";
import { MessageCell } from "../MessageCell";


export class UnknownCell  extends MessageCell {
     render()  {
         const {message,context} = this.props
        const content = message.content as UnknownContent
        return <MessageBase context={context} message={message}>[此消息不支持查看，请至手机端查看详情({content.realContentType})]</MessageBase>
    }
}