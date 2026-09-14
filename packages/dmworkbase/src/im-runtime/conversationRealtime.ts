import { MessageContentType, Channel, ChannelTypeGroup, ConversationAction } from "wukongimjssdk";
import type { ChannelInfo, Conversation, Message } from "wukongimjssdk";
import type WKSDK from "wukongimjssdk";
import WKApp from "../App";
import { ConversationWrap } from "../Service/Model";
import { ProhibitwordsService } from "../Service/ProhibitwordsService";
import { shouldSkipChannelForSpace, shouldSkipPersonConversationForSpace, hasSpacePrefix } from "../Service/SpaceService";
import { ChannelTypeCommunityTopic } from "../Service/Const";
import { parseThreadChannelId } from "../Service/Thread";
import { getImChannelInfo } from "./channelRuntime";
import { captureCurrentImConversationSyncContext } from "./conversationSyncContext";
import { createOwnedChannelInfoFetcher } from "./ownedChannelInfoFetcher";

export interface ConversationRealtimeStore {
  readonly sdk: WKSDK;
  conversations: ConversationWrap[];
  readonly pendingSpaceConversations: Map<string, Conversation>;
  readonly lastThreadStatusByChannel: Map<string, number | undefined>;
  findConversation(channel: Channel): ConversationWrap | undefined;
  removeConversation(channel: Channel): void;
  removeThreadsOfParent(parentGroupNo: string): void;
  sortConversations(): ConversationWrap[];
  publish(reason: "data" | "update"): void;
}

function spaceKey(channel: Channel): string {
  return `${channel.channelID}_${channel.channelType}`;
}

export function createConversationRealtimeHandlers(
  store: ConversationRealtimeStore,
  isOwnerCurrent: () => boolean = () => true,
): {
  conversationListener: (conversation: Conversation, action: ConversationAction) => void;
  channelListener: (channelInfo: ChannelInfo) => void;
  messageDeleteListener: (message: Message, preMessage?: Message) => void;
} {
  const fetchChannelInfo = createOwnedChannelInfoFetcher(store.sdk, isOwnerCurrent);
  const conversationListener = (conversation: Conversation, action: ConversationAction): void => {
    const channelInfo = getImChannelInfo(store.sdk, conversation.channel);
    if (!channelInfo) {
      fetchChannelInfo(conversation.channel).catch((error: unknown) => {
        console.warn("[conversationRealtime] fetch channelInfo failed", error);
      });
    }

    if (action === ConversationAction.add) {
      if (conversation.channel.channelType === ChannelTypeGroup) {
        const key = spaceKey(conversation.channel);
        if (!WKApp.shared.channelSpaceMap.has(key)) {
          const info = getImChannelInfo(store.sdk, conversation.channel);
          const sid = info?.orgData?.space_id
            || conversation.channelInfo?.orgData?.space_id
            || conversation.extra?.spaceId;
          if (sid) {
            WKApp.shared.channelSpaceMap.set(key, sid);
          } else if (WKApp.shared.currentSpaceId && !hasSpacePrefix(conversation.channel.channelID)) {
            store.pendingSpaceConversations.set(key, conversation);
            fetchChannelInfo(conversation.channel).catch((error: unknown) => {
              console.warn("[conversationRealtime] fetch pending channelInfo failed", error);
            });
            return;
          }
        }
      } else if (conversation.channel.channelType === ChannelTypeCommunityTopic) {
        const parsed = parseThreadChannelId(conversation.channel.channelID);
        if (parsed) {
          const parentKey = `${parsed.groupNo}_${ChannelTypeGroup}`;
          if (!WKApp.shared.channelSpaceMap.has(parentKey) && WKApp.shared.currentSpaceId) {
            fetchChannelInfo(new Channel(parsed.groupNo, ChannelTypeGroup)).catch((error: unknown) => {
              console.warn("[conversationRealtime] fetch parent channelInfo failed", error);
            });
          }
        }
      }

      if (shouldSkipChannelForSpace(conversation.channel)) return;
      if (shouldSkipPersonConversationForSpace(conversation)) return;

      if (conversation.lastMessage?.content && conversation.lastMessage?.contentType === MessageContentType.text) {
        conversation.lastMessage.content.text = ProhibitwordsService.shared.filter(conversation.lastMessage.content.text);
      }

      const existingConv = store.findConversation(conversation.channel);
      if (existingConv) {
        existingConv.conversation = conversation;
      } else {
        store.conversations = [new ConversationWrap(conversation), ...store.conversations];
      }
      store.publish("data");

    } else if (action === ConversationAction.update) {
      if (conversation.channel.channelType === ChannelTypeGroup) {
        const key = spaceKey(conversation.channel);
        if (!WKApp.shared.channelSpaceMap.has(key)) {
          store.pendingSpaceConversations.set(key, conversation);
          fetchChannelInfo(conversation.channel).catch((error: unknown) => {
            console.warn("[conversationRealtime] fetch update channelInfo failed", error);
          });
          return;
        }
      } else if (conversation.channel.channelType === ChannelTypeCommunityTopic) {
        const parsed = parseThreadChannelId(conversation.channel.channelID);
        if (parsed) {
          const parentKey = `${parsed.groupNo}_${ChannelTypeGroup}`;
          if (!WKApp.shared.channelSpaceMap.has(parentKey) && WKApp.shared.currentSpaceId) {
            fetchChannelInfo(new Channel(parsed.groupNo, ChannelTypeGroup)).catch((error: unknown) => {
              console.warn("[conversationRealtime] fetch parent channelInfo failed", error);
            });
          }
        }
      }

      if (shouldSkipChannelForSpace(conversation.channel)) return;
      if (shouldSkipPersonConversationForSpace(conversation)) return;

      const existConversation = store.findConversation(conversation.channel);
      if (existConversation) {
        if (
          conversation.channel.channelType === ChannelTypeCommunityTopic &&
          existConversation.extra?.top === 1
        ) {
          conversation.extra = conversation.extra || {};
          conversation.extra.top = 1;
        }
        existConversation.conversation = conversation;

        if (conversation.extra) {
          const newMsgSpaceId = conversation.lastMessage?.content?.contentObj?.space_id;
          const currentSpaceId = WKApp.shared.currentSpaceId;
          if (!currentSpaceId || !newMsgSpaceId || newMsgSpaceId === currentSpaceId) {
            conversation.extra.spaceLastMessage = undefined;
          }
        }
        if (existConversation.lastMessage?.content && existConversation.lastMessage?.contentType === MessageContentType.text) {
          existConversation.lastMessage.content.text = ProhibitwordsService.shared.filter(existConversation.lastMessage.content.text);
        }
      }

      store.sortConversations();
      store.publish("update");

    } else if (action === ConversationAction.remove) {
      store.pendingSpaceConversations.delete(spaceKey(conversation.channel));
      store.removeConversation(conversation.channel);
    }
  };

  const channelListener = (channelInfo: ChannelInfo): void => {
    const contextIsCurrent = captureCurrentImConversationSyncContext();
    const isCurrent = () => isOwnerCurrent() && contextIsCurrent();
    if (channelInfo.channel?.channelType === ChannelTypeGroup && channelInfo.orgData?.space_id) {
      const key = spaceKey(channelInfo.channel);
      WKApp.shared.channelSpaceMap.set(key, channelInfo.orgData.space_id);
      if (shouldSkipChannelForSpace(channelInfo.channel)) {
        store.pendingSpaceConversations.delete(key);
        store.removeConversation(channelInfo.channel);
        if (!isCurrent()) return;
        store.removeThreadsOfParent(channelInfo.channel.channelID);
        return;
      }
    }

    const conversation = store.findConversation(channelInfo.channel);
    if (conversation) {
      if (channelInfo.channel.channelType !== ChannelTypeCommunityTopic) {
        conversation.extra.top = channelInfo.top ? 1 : 0;
      }
      store.sortConversations();
      store.publish("data");
    } else if (channelInfo.channel.channelType === ChannelTypeCommunityTopic) {
      const channelID = channelInfo.channel.channelID;
      const nextStatus = channelInfo.orgData?.thread?.status;
      const prevTracked = store.lastThreadStatusByChannel.has(channelID);
      const prevStatus = store.lastThreadStatusByChannel.get(channelID);
      if (!prevTracked || prevStatus !== nextStatus) {
        store.lastThreadStatusByChannel.set(channelID, nextStatus);
        store.publish("data");
      }
    } else if (channelInfo.channel.channelType === ChannelTypeGroup) {
      const key = spaceKey(channelInfo.channel);
      const sid = channelInfo.orgData?.space_id;
      if (sid) {
        WKApp.shared.channelSpaceMap.set(key, sid);
      }

      const pendingConv = store.pendingSpaceConversations.get(key);
      if (pendingConv) {
        store.pendingSpaceConversations.delete(key);
      }
      const conv = pendingConv || store.sdk.conversationManager.findConversation(channelInfo.channel);
      if (conv && !shouldSkipChannelForSpace(channelInfo.channel)) {
        const restoreSdk = !store.sdk.conversationManager.findConversation(channelInfo.channel);
        if (restoreSdk) {
          store.sdk.conversationManager.conversations = [conv, ...store.sdk.conversationManager.conversations];
        }
        const existingInListener = store.findConversation(channelInfo.channel);
        if (!existingInListener) {
          store.conversations = [new ConversationWrap(conv), ...store.conversations];
        }
        store.sortConversations();
        store.publish("data");
        if (restoreSdk && isCurrent()) {
          store.sdk.conversationManager.notifyConversationListeners(conv, ConversationAction.add);
        }
      }
    }
  };

  const messageDeleteListener = (message: Message, preMessage?: Message): void => {
    const conversation = store.sdk.conversationManager.findConversation(message.channel);
    if (conversation) {
      if (conversation.lastMessage && conversation.lastMessage.clientMsgNo === message.clientMsgNo) {
        conversation.lastMessage = preMessage;
        store.sdk.conversationManager.notifyConversationListeners(conversation, ConversationAction.update);
      }
    }
  };

  return { conversationListener, channelListener, messageDeleteListener };
}
