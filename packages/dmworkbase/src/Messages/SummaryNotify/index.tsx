import React from "react";
import {
  Channel,
  ChannelTypePerson,
  MessageContent,
  WKSDK,
} from "wukongimjssdk";
import WKApp from "../../App";
import {
  getImChannelInfo,
  fetchImChannelInfo,
} from "../../im-runtime/channelRuntime";
import { t } from "../../i18n";
import { MessageContentTypeConst } from "../../Service/Const";
import { MessageCell } from "../MessageCell";

export class SummaryNotifyContent extends MessageContent {
  fromUID = "";
  fromName = "";

  tipForSender(senderUID: string) {
    let name: string;
    if (senderUID === WKApp.loginInfo.uid) {
      name = t("base.message.summaryNotify.you");
    } else {
      const senderChannel = new Channel(senderUID, ChannelTypePerson);
      const channelInfo = getImChannelInfo(WKSDK.shared(), senderChannel);
      if (!channelInfo && senderUID) {
        void fetchImChannelInfo(WKSDK.shared(), senderChannel);
      }
      // The authenticated envelope UID determines identity. from_name is only
      // a best-effort display fallback while the local profile is unavailable.
      name =
        channelInfo?.orgData?.displayName?.trim() ||
        this.fromName.trim() ||
        t("base.message.summaryNotify.unknown");
    }
    return t("base.message.summaryNotify.text", { values: { name } });
  }

  decodeJSON(content: any): void {
    this.fromUID =
      typeof content?.from_uid === "string" ? content.from_uid.trim() : "";
    this.fromName =
      typeof content?.from_name === "string" ? content.from_name.trim() : "";
  }

  encodeJSON(): any {
    return {
      from_uid: this.fromUID,
      from_name: this.fromName,
    };
  }

  get contentType() {
    return MessageContentTypeConst.summaryNotify;
  }

  get conversationDigest() {
    return t("base.message.summaryNotify.action");
  }
}

export class SummaryNotifyCell extends MessageCell {
  render() {
    const { message } = this.props;
    const content = message.content as SummaryNotifyContent;
    return (
      <div className="wk-message-system">
        {content.tipForSender(message.fromUID)}
      </div>
    );
  }
}

/**
 * Send-side content for the group summary completion tip.
 *
 * Iterates #1379: instead of the custom type-21 message (which needs a
 * dedicated renderer on every client), we emit a WK_TIP (2000) system-range
 * message. Both Web (`SystemCell`) and native clients (`WKSystemContent` /
 * `WKSystemMessageCell`) already render the 1000–2000 system range out of the
 * box, so App needs no adaptation.
 *
 * The payload uses the SDK SystemContent placeholder convention:
 *   { content: "{0}总结了群聊内容", extra: [{ uid, name }] }
 * The SDK replaces `{0}` with `extra[0].name`. Copy is locked to Chinese on
 * the send side (product decision), so no i18n lookup here. Note: native
 * SystemContent additionally renders the tip as "你..." when the viewer's uid
 * matches `extra[0].uid` (accepted per plan option A).
 */
export class SummaryTipContent extends MessageContent {
  fromUID = "";
  fromName = "";

  setSender(uid: string, name: string): this {
    this.fromUID = typeof uid === "string" ? uid.trim() : "";
    this.fromName = typeof name === "string" ? name.trim() : "";
    return this;
  }

  decodeJSON(content: any): void {
    // Receive-side decoding is handled by the SDK SystemContent for the
    // 1000–2000 range; this method exists only so the class is a valid
    // MessageContent for the send path.
    const extra = Array.isArray(content?.extra) ? content.extra[0] : undefined;
    this.fromUID = typeof extra?.uid === "string" ? extra.uid.trim() : "";
    this.fromName = typeof extra?.name === "string" ? extra.name.trim() : "";
  }

  encodeJSON(): any {
    return {
      content: "{0}总结了群聊内容",
      extra: [{ uid: this.fromUID, name: this.fromName }],
    };
  }

  get contentType() {
    return MessageContentTypeConst.summaryTip;
  }

  get conversationDigest() {
    const name = this.fromName || "";
    return `${name}总结了群聊内容`;
  }
}
