import React from "react";
import { WKApp } from "@octo/base";
import ChatSummaryPanel from "../components/ChatSummaryPanel";
import ChatSummaryStarButton from "../components/ChatSummaryStarButton";
import { isSupportedChannelType } from "../utils/channelType";

export function registerSummaryChatExtension(): void {
  WKApp.endpoints.registerChannelHeaderRightItem(
    "channelheader.summary",
    ({ channel }) => {
      if (!isSupportedChannelType(channel)) return undefined;
      return <ChatSummaryStarButton channel={channel} />;
    },
    5100
  );

  WKApp.endpoints.registerChatSummaryPanel(
    "chatsummarypanel",
    ({ channel, onClose, summaryPanelView }) => (
      <ChatSummaryPanel
        visible={true}
        channel={channel}
        onClose={onClose}
        summaryPanelView={summaryPanelView}
      />
    )
  );
}
