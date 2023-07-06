import React from "react"
import { MessageWrap } from "../../Service/Model"
import MessageBase from "../Base"
import { MessageCell } from "../MessageCell"



export class  FlameMessageCell extends MessageCell {

    render() {
        const { message, context } = this.props
        return <MessageBase context={context} message={message} onBubble={() => {
        }}><div className="wk-message-text">{FlameMessageCell.tip(message)}</div></MessageBase>
    }

    static tip(message: MessageWrap) {
        return "[此消息为阅后即焚消息，请在手机端查看]"
    }
}