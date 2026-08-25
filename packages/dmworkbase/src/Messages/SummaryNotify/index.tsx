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

export * from "./tip";

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
