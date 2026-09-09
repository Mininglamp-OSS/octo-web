import React from "react";
import { Conversation } from "@octo/base";
import type { Channel } from "wukongimjssdk";
import AppBotAvatar from "./AppBotAvatar";
import AppBotChatHeader from "../ui/AppBotChatHeader";
import "./AppBotConversation.css";

export function renderAppBotConversation(
  target: { channelId: string; displayName: string },
  channel: Channel
) {
  return (
    <div key={channel.getChannelKey()} className="appbot-chat-wrap">
      <AppBotChatHeader
        avatar={<AppBotAvatar uid={target.channelId} />}
        displayName={target.displayName}
      />
      <Conversation channel={channel} />
    </div>
  );
}
