import { MessageContent } from "wukongimjssdk";
import React from "react";
import MessageBase from "../Base";
import { MessageCell } from "../MessageCell";

const tip = "[收到一条网页版暂不支持的消息类型，请在手机上查看]"

export class UnsupportContent extends MessageContent {


    get conversationDigest() {
        return tip
    }

}


export class UnsupportCell  extends MessageCell {
     render()  {
         const {message,context} = this.props
        return <MessageBase context={context} message={message}>{tip}</MessageBase>
    }
}