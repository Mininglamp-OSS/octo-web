import { Channel, ChannelInfo } from "wukongimjssdk";
import {
  Dap,
  SpaceService,
  WKApp,
  createCurrentEmptyImConversation,
  findCurrentImConversation,
  getCurrentImChannelInfo,
  setCurrentImChannelInfoCache,
  t,
} from "@octo/base";
import { subscribePageActivation } from "@octo/base/src/Utils/pageActivation";
import { getImChannelDisplayName, seedImChannelDisplayName } from "@octo/base/src/im-runtime/channelDisplayName";
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

  subscribeInvalidation(listener) {
    return subscribePageActivation("appbot", listener, WKApp);
  },

  async openConversation(target) {
    const channel = new Channel(target.channelId, target.channelType);
    const info = getCurrentImChannelInfo<Channel, ChannelInfo>(channel) || new ChannelInfo();
    info.channel = channel;
    if (target.avatar) info.logo = target.avatar;
    seedImChannelDisplayName(info, target.displayName, target.metadata);
    setCurrentImChannelInfoCache(info);

    if (!findCurrentImConversation(channel)) {
      createCurrentEmptyImConversation(channel);
    }

    WKApp.routeRight.replaceToRoot(renderAppBotConversation({
      ...target,
      displayName: getImChannelDisplayName(info) || t("base.chatPage.nameUnavailable"),
    }, channel));
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
