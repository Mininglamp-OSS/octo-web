import { Channel, ChannelTypePerson, WKSDK, MessageContent } from "wukongimjssdk";
import React from "react";
import WKApp from "../../App";
import { MessageContentTypeConst } from "../../Service/Const";
import { MessageCell } from "../MessageCell";
import { t } from "../../i18n";
import { getImChannelInfo, fetchImChannelInfo } from "../../im-runtime/channelRuntime";


export class SummaryNotifyContent extends MessageContent {
    fromUID!: string
    fromName!: string


    tipForSender(senderUID: string) {
        let name = ""
        if (senderUID === WKApp.loginInfo.uid) {
            name = t("base.message.summaryNotify.you")
        } else {
            const senderCh = new Channel(senderUID, ChannelTypePerson)
            let channelInfo = getImChannelInfo(WKSDK.shared(), senderCh)
            const displayName = channelInfo?.orgData?.displayName
            // 远端消息只信任 envelope sender 对应的本地资料缓存；from_name 属于
            // sender-controlled payload，缓存未命中时不能用它伪装其他成员。
            // Cache miss: kick a fetch and fall back to a neutral label for
            // this render. The listener that repopulates the cache will
            // trigger a re-render in the cell — same pattern
            // Components/ConversationList/index.tsx:622 uses for the
            // preview's sender resolution.
            //
            // #1283 round-8 P2 (@yujiawei): gate on `!channelInfo` (true cache
            // miss), NOT `!displayName`. A cached-but-nameless entry — e.g.
            // one populated from `channels/{uid}/{type}` 404 with `orgData:
            // {}` — would otherwise re-fetch on every render, relying on the
            // SDK's notify-before-in-flight-release ordering to avoid a
            // render/fetch loop. That's a fragile coupling to internal SDK
            // ordering; gate on real absence instead.
            if (!channelInfo && senderUID) {
                void fetchImChannelInfo(WKSDK.shared(), senderCh)
            }
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
        // Only from_uid — payload.from_name is deliberately not emitted.
        // The renderer resolves display names from the authenticated envelope
        // + local channel-info cache, never trusting sender-controlled
        // payload (spoofing resistance). Emitting a from_name we ignore is
        // dead wire weight and misleads readers into thinking it is
        // load-bearing. If a future server-side sender needs a name field
        // (bypass local cache in a system context), reintroduce with a
        // comment explaining who reads it. #1283 round-8 P2 (@yujiawei).
        return { from_uid: this.fromUID || "" }
    }

    get contentType() {
        return MessageContentTypeConst.summaryNotify
    }

    get conversationDigest() {
        // Action-only digest — deliberately name-free.
        //
        // The digest consumer (ConversationList) has no message envelope but
        // prepends the authenticated `${sender}: ` on the group/thread branch.
        // Returning the full "{sender} 总结了群聊内容" here would double-name
        // the sender in the preview ("Alice: 某用户总结了群聊内容"), which the
        // round-7 review of #1283 called out. Emitting only the verb+object
        // lets the consumer's own prefix supply the one identity, producing
        // the correct "Alice: 总结了群聊内容". The cell renderer still uses
        // tipForSender(message.fromUID) which reads the authenticated envelope,
        // so the in-conversation line remains "{Alice} 总结了群聊内容"
        // — identity comes from the envelope, never from the payload.
        return t("base.message.summaryNotify.action")
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
