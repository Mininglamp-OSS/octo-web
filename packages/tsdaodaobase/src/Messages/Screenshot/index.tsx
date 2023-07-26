import { Channel, ChannelTypePerson, WKSDK, MessageContent } from "wukongimjssdk";
import React from "react";
import WKApp from "../../App";
import { MessageContentTypeConst } from "../../Service/Const";
import { MessageCell } from "../MessageCell";


export class ScreenshotContent extends MessageContent {
    fromUID!: string
    fromName!: string


    get tip() {
        let name = ""
        if (this.fromUID == WKApp.loginInfo.uid) {
            name = "你"
        } else {
            let channelInfo = WKSDK.shared().channelManager.getChannelInfo(new Channel(this.fromUID, ChannelTypePerson))
            if (channelInfo) {
                name = channelInfo?.orgData.displayName
            } else {
                name = this.fromName
            }
        }
        return `${name}在聊天中截屏了`
    }

    decodeJSON(content: any): void {
        this.fromUID = content["from_uid"]
        this.fromName = content["from_name"]
    }

    get contentType() {
        return MessageContentTypeConst.screenshot
    }

    get conversationDigest() {
        return this.tip
    }

}

export class ScreenshotCell extends MessageCell {
    render() {
        const { message } = this.props
        let content = message.content as ScreenshotContent
        return <div className="wk-message-system">{content.tip}</div>
    }
}