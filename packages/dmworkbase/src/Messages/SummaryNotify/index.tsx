import { Channel, ChannelTypePerson, WKSDK, MessageContent } from "wukongimjssdk";
import React from "react";
import WKApp from "../../App";
import { MessageContentTypeConst } from "../../Service/Const";
import { MessageCell } from "../MessageCell";
import { t } from "../../i18n";
import { getImChannelInfo } from "../../im-runtime/channelRuntime";


export class SummaryNotifyContent extends MessageContent {
    fromUID!: string
    fromName!: string


    tipForSender(senderUID: string) {
        let name = ""
        if (senderUID === WKApp.loginInfo.uid) {
            name = t("base.message.summaryNotify.you")
        } else {
            let channelInfo = getImChannelInfo(WKSDK.shared(), new Channel(senderUID, ChannelTypePerson))
            const displayName = channelInfo?.orgData?.displayName
            // 远端消息只信任 envelope sender 对应的本地资料缓存；from_name 属于
            // sender-controlled payload，缓存未命中时不能用它伪装其他成员。
            name = displayName?.trim() || t("base.message.summaryNotify.unknown")
        }
        return t("base.message.summaryNotify.text", { values: { name } })
    }

    // Content 本身没有认证 envelope，不能根据 payload UID/姓名生成身份文案。
    get tip() {
        return t("base.message.summaryNotify.text", {
            values: { name: t("base.message.summaryNotify.unknown") }
        })
    }

    decodeJSON(content: any): void {
        this.fromUID = typeof content?.["from_uid"] === "string" ? content["from_uid"].trim() : ""
        this.fromName = typeof content?.["from_name"] === "string" ? content["from_name"].trim() : ""
    }

    encodeJSON(): any {
        return { from_uid: this.fromUID || "", from_name: this.fromName || "" }
    }

    get contentType() {
        return MessageContentTypeConst.summaryNotify
    }

    get conversationDigest() {
        // digest 的消费路径拿不到 message envelope，因此必须保持 sender-neutral。
        return this.tip
    }

}

export class SummaryNotifyCell extends MessageCell {
    render() {
        const { message } = this.props
        let content = message.content as SummaryNotifyContent
        // message.fromUID 来自认证后的消息 envelope；payload.from_uid 只保留作兼容字段。
        return <div className="wk-message-system">{content.tipForSender(message.fromUID)}</div>
    }
}
