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
            const displayName = channelInfo?.orgData?.displayName
            const candidate = [displayName, this.fromName]
                .find((value) => typeof value === "string" && value.trim())
            // 缓存和消息体都缺少有效名称时使用中性称谓，避免空白或误称为“你”。
            name = candidate?.trim() || t("base.message.summaryNotify.unknown")
        }
        return t("base.message.summaryNotify.text", { values: { name } })
    }

    decodeJSON(content: any): void {
        this.fromUID = content["from_uid"]
        this.fromName = content["from_name"]
    }

    encodeJSON(): any {
        return { from_uid: this.fromUID || "", from_name: this.fromName || "" }
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
