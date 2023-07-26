import { MessageContent } from "wukongimjssdk"
import React from "react"
import { BeatLoader } from "react-spinners"
import { MessageContentTypeConst } from "../../Service/Const"
import MessageBase from "../Base"
import { MessageCell } from "../MessageCell"

export class TypingContent extends MessageContent {
    fromUID: string
    fromName: string

    constructor(fromUID: string, fromName: string) {
        super()
        this.fromUID = fromUID
        this.fromName = fromName
    }

    public get contentType() {
        return MessageContentTypeConst.typing
    }

}


export class TypingCell extends MessageCell {

    render() {
        const { message,context } = this.props
        return <MessageBase message={message} context={context} hiddenStatus={true}>
           <div style={{height:'18px'}}>
           <BeatLoader size={8} margin={4} color="var(--wk-color-theme)" />
           </div>
        </MessageBase>
    }
}