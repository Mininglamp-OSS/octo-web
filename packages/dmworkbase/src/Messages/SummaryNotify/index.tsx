import { Channel, ChannelTypePerson, WKSDK, MessageContent } from "wukongimjssdk";
import React from "react";
import WKApp from "../../App";
import { MessageContentTypeConst } from "../../Service/Const";
import { MessageCell } from "../MessageCell";
import { t } from "../../i18n";


export class SummaryNotifyContent extends MessageContent {
    fromUID!: string
    fromName!: string


    get tip() {
        let name = ""
        if (this.fromUID === WKApp.loginInfo.uid) {
            name = t("base.message.summaryNotify.you")
        } else {
            let channelInfo = WKSDK.shared().channelManager.getChannelInfo(new Channel(this.fromUID, ChannelTypePerson))
            if (channelInfo) {
                name = channelInfo?.orgData?.displayName
            } else {
                name = this.fromName
            }
        }
        return t("base.message.summaryNotify.text", { values: { name } })
    }

    encodeJSON(): Record<string, any> {
        return {
            type: this.contentType,
            from_uid: this.fromUID,
            from_name: this.fromName,
        }
    }

    decodeJSON(content: any): void {
        this.fromUID = content["from_uid"]
        this.fromName = content["from_name"]
    }

    get contentType() {
        return MessageContentTypeConst.summaryNotify
    }

    get conversationDigest() {
        return this.tip
    }

}

export class SummaryNotifyCell extends MessageCell {
    render() {
        const { message } = this.props
        let content = message.content as SummaryNotifyContent
        return <div className="wk-message-system">{content.tip}</div>
    }
}
