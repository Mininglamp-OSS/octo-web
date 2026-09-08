import { Channel, ChannelInfo } from "wukongimjssdk";
import {
  Dap,
  SpaceService,
  WKApp,
  createCurrentEmptyImConversation,
  findCurrentImConversation,
  setCurrentImChannelInfoCache,
} from "@octo/base";
import { renderAppBotConversation } from "../features/AppBotConversationView";
import type { AppBotHostCapabilities } from "./types";

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

    WKApp.routeRight.replaceToRoot(renderAppBotConversation(target, channel));
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
