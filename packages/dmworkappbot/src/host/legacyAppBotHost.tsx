import React from "react";
import { Channel, ChannelInfo } from "wukongimjssdk";
import {
  Conversation,
  Dap,
  SpaceService,
  WKApp,
  createCurrentEmptyImConversation,
  findCurrentImConversation,
  setCurrentImChannelInfoCache,
} from "@octo/base";
import AppBotAvatar from "../features/AppBotAvatar";
import AppBotChatHeader from "../ui/AppBotChatHeader";
import type { AppBotConversationTarget, AppBotHostCapabilities } from "./types";

function renderConversation(
  target: AppBotConversationTarget,
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

export const legacyAppBotHost: AppBotHostCapabilities = {
  getCurrentSpace() {
    return {
      id: WKApp.shared.currentSpaceId || "",
      name: "",
    };
  },

  async resolveSpaceName(spaceId) {
    if (!spaceId) return "";
    const spaces = await SpaceService.shared.getMySpaces();
    return spaces?.find((space) => space.space_id === spaceId)?.name || "";
  },

  subscribeSpaceChanged(listener) {
    WKApp.mittBus.on("space-changed", listener);
    return () => WKApp.mittBus.off("space-changed", listener);
  },

  async openConversation(target) {
    const channel = new Channel(target.channelId, target.channelType);
    const info = new ChannelInfo();
    info.channel = channel;
    info.title = target.displayName;
    info.logo = target.avatar;
    info.orgData = target.metadata;
    setCurrentImChannelInfoCache(info);

    if (!findCurrentImConversation(channel)) {
      createCurrentEmptyImConversation(channel);
    }

    WKApp.routeRight.replaceToRoot(renderConversation(target, channel));
  },

  clearConversation() {
    WKApp.routeRight.popToRoot();
  },

  isOctoAssistant(uid) {
    return WKApp.remoteConfig.octoAssistantUids.includes(uid);
  },

  track(event, properties = {}) {
    Dap.shared.track(event, properties);
  },
};
