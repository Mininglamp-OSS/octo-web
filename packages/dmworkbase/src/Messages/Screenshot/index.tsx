import { Channel, ChannelTypePerson, WKSDK, MessageContent } from "wukongimjssdk";
import React from "react";
import WKApp from "../../App";
import { MessageContentTypeConst } from "../../Service/Const";
import { MessageCell } from "../MessageCell";
import { t } from "../../i18n";
import { getImChannelInfo } from "../../im-runtime/channelRuntime";


export class ScreenshotContent extends MessageContent {
    fromUID!: string
    fromName!: string


    get tip() {
        let name = ""
        if (this.fromUID === WKApp.loginInfo.uid) {
            name = t("base.message.screenshot.you")
        } else {
            let channelInfo = getImChannelInfo(WKSDK.shared(), new Channel(this.fromUID, ChannelTypePerson))
            if (channelInfo) {
                name = channelInfo?.orgData?.displayName
            } else {
                name = this.fromName
            }
        }
        return t("base.message.screenshot.text", { values: { name } })
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
