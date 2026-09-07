import {
  ChatClientStatus,
  ManagedChatClient,
  type ChatChannelRef,
  type ChatMessageLoadOptions,
} from "@octo/chat-core";
import {
  Channel,
  Message,
  MessageContent,
  PullMode,
  SendackPacket,
  WKSDK,
} from "wukongimjssdk";
import WKApp from "../../App";
import type ConversationContext from "../../Components/Conversation/context";
import { SyncMessageOptions } from "../../Service/DataSource/DataProvider";

export interface LegacyChatRuntime {
  client: ManagedChatClient<Message, MessageContent, SendackPacket>;
  bindConversationContext(context: ConversationContext): () => void;
}

function toSdkChannel(channel: ChatChannelRef): Channel {
  return new Channel(channel.channelId, channel.channelType);
}

function toSyncOptions(options?: ChatMessageLoadOptions): SyncMessageOptions {
  const result = new SyncMessageOptions();
  const anchor = Number(options?.anchor || 0);
  const safeAnchor = Number.isFinite(anchor) && anchor > 0 ? anchor : 0;

  if (options?.older !== undefined) {
    result.limit = options.older;
    result.startMessageSeq = Math.max(0, safeAnchor - 1);
    result.pullMode = PullMode.Down;
  } else if (options?.newer !== undefined) {
    result.limit = options.newer;
    result.startMessageSeq = safeAnchor;
    result.pullMode = PullMode.Up;
  } else if (options?.around !== undefined) {
    result.limit = options.around;
    result.startMessageSeq = Math.max(
      0,
      safeAnchor - Math.floor(options.around / 2)
    );
    result.pullMode = PullMode.Up;
  } else {
    result.limit = WKApp.config.pageSizeOfMessage;
  }

  return result;
}

export function createLegacyChatRuntime(): LegacyChatRuntime {
  let activeConversationContext: ConversationContext | undefined;

  const client = new ManagedChatClient<Message, MessageContent, SendackPacket>(
    {
      status: ChatClientStatus.Connected,
      async connect() {},
      async disconnect() {},
    },
    {
      async openConversation(channel) {
        return { channel };
      },
      async closeConversation() {},
    },
    {
      messageAdapter: {
        loadMessages(channel, options) {
          return WKApp.conversationProvider.syncMessages(
            toSdkChannel(channel),
            toSyncOptions(options)
          );
        },
        subscribeMessages(listener) {
          const sdk = WKSDK.shared();
          sdk.chatManager.addMessageListener(listener);
          return () => sdk.chatManager.removeMessageListener(listener);
        },
        subscribeMessageStatus(listener) {
          const sdk = WKSDK.shared();
          const statusListener = (packet: SendackPacket) => {
            const messageId = packet.messageID
              ? packet.messageID.toString()
              : String(packet.clientSeq);
            listener(messageId, packet);
          };
          sdk.chatManager.addMessageStatusListener(statusListener);
          return () =>
            sdk.chatManager.removeMessageStatusListener(statusListener);
        },
        sendMessage(content, channel) {
          if (!activeConversationContext) {
            return Promise.reject(
              new Error(
                "Legacy chat send requires a mounted ConversationWindow context."
              )
            );
          }
          return activeConversationContext.sendMessage(
            content,
            toSdkChannel(channel)
          );
        },
      },
    }
  );

  return {
    client,
    bindConversationContext(context) {
      activeConversationContext = context;
      return () => {
        if (activeConversationContext === context) {
          activeConversationContext = undefined;
        }
      };
    },
  };
}

let sharedLegacyChatRuntime: LegacyChatRuntime | undefined;

export function getLegacyChatRuntime(): LegacyChatRuntime {
  if (!sharedLegacyChatRuntime) {
    sharedLegacyChatRuntime = createLegacyChatRuntime();
    void sharedLegacyChatRuntime.client.start({});
  }
  return sharedLegacyChatRuntime;
}
