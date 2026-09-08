import {
  ForwardService,
  interpretForwardResult,
  isConversationDisbanded,
  SummaryTipContent,
  WKApp,
} from "@octo/base";
import {
  Channel,
  ChannelTypeGroup,
  MessageText,
  WKSDK,
} from "wukongimjssdk";
import { TaskStatus } from "../types/summary";
import { sendGroupSummaryCompletionTips } from "../utils/groupSummaryNotify";
import { splitSummaryText } from "../utils/splitMessage";
import type { SummaryMessagingPort } from "./types";
import { toSummaryConversationMember } from "./subscriberMembers";
import { SummaryForwardContextExpiredError } from "./forwardErrors";

const INTER_MESSAGE_DELAY_MS = 200;

export const legacySummaryMessagingPort: SummaryMessagingPort = {
  getCurrentUser() {
    const uid = WKApp.loginInfo.uid ?? "";
    return {
      uid,
      displayName:
        WKApp.loginInfo.selfDisplayName?.() || WKApp.loginInfo.name || uid,
    };
  },

  async loadConversationMembers(target) {
    const channel = new Channel(target.channelId, target.channelType);
    const sdk = WKSDK.shared();
    await sdk.channelManager.syncSubscribes(channel);
    return (sdk.channelManager.getSubscribes(channel) || []).map(toSummaryConversationMember);
  },

  async openConversation(target) {
    WKApp.endpoints.showConversation(
      new Channel(target.channelId, target.channelType),
      {
        initLocateMessageSeq: target.messageSeq,
        openChannelSearch: target.openChannelSearch,
      }
    );
  },

  async notifySummaryCompleted({ previousStatus, detail }) {
    const uid = WKApp.loginInfo.uid ?? "";
    const displayName =
      WKApp.loginInfo.selfDisplayName?.() || WKApp.loginInfo.name || uid;
    await sendGroupSummaryCompletionTips(
      previousStatus,
      detail,
      uid,
      TaskStatus.COMPLETED,
      ChannelTypeGroup,
      {
        sendToChannel: async (channel, currentUserId) => {
          const content = new SummaryTipContent().setSender(
            currentUserId,
            displayName || currentUserId
          );
          await WKSDK.shared().chatManager.send(content, channel);
        },
        isDisbanded: isConversationDisbanded,
        warn: (message, context) => console.warn(message, context),
      }
    );
  },

  requestForward({ content, title, onComplete, onError, onCancel, isActive }) {
    const spaceId = WKApp.shared.currentSpaceId;
    const active = () => WKApp.shared.currentSpaceId === spaceId && (isActive?.() ?? true);
    WKApp.shared.baseContext.showConversationSelect(
      async (channels: Channel[]) => {
        if (!active()) { onError?.(new SummaryForwardContextExpiredError()); return; }
        try {
          const chunks = splitSummaryText(content);
          const result = await ForwardService.send(
            channels,
            () => {
              if (!active()) throw new SummaryForwardContextExpiredError();
              return chunks.map((chunk) => new MessageText(chunk));
            },
            {
              channelMode: "serial",
              messageMode: "serial",
              interMessageDelayMs: INTER_MESSAGE_DELAY_MS,
              spaceId,
            }
          );
          if (!active()) { onError?.(new SummaryForwardContextExpiredError()); return; }
          onComplete(interpretForwardResult(result, "targets"));
        } catch (error) {
          onError?.(active() ? error : new SummaryForwardContextExpiredError());
        }
      },
      title,
      undefined,
      onCancel
    );
  },

  subscribeInvalidation(listener) {
    WKApp.mittBus.on("summary-list-refresh-requested" as any, listener);
    WKApp.mittBus.on("summary-space-changed", listener);
    return () => {
      WKApp.mittBus.off("summary-list-refresh-requested" as any, listener);
      WKApp.mittBus.off("summary-space-changed", listener);
    };
  },
};
