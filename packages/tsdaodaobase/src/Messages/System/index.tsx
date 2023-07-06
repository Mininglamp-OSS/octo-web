import { SystemContent } from "wukongimjssdk/lib/sdk"
import React from "react"
import { MessageCell } from "../MessageCell"
import  './index.css'

export class SystemCell  extends MessageCell {

     render()  {
         const {message} = this.props
        const content = message.content as SystemContent
        return <div className="wk-message-system">{content.displayText}</div>
    }
}