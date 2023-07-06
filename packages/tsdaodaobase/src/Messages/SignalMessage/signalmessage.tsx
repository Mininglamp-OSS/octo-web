import { MessageSignalContent } from "wukongimjssdk/lib/sdk"
import React from "react"
import MessageBase from "../Base"
import { MessageCell } from "../MessageCell"

export class SignalMessageContent extends MessageSignalContent {

    public get conversationDigest(): string {
        return "此消息已采用端对端加密，web端无法解密，请在手机端查看"
    }
}

export class SignalMessageCell extends MessageCell {

    render() {
        const { message, context } = this.props
        return <MessageBase context={context} message={message} onBubble={() => {
        }}><div className="wk-message-text"><pre>此消息已采用端对端加密，web端无法解密，请在手机端查看</pre></div></MessageBase>
    }
}