export interface ChatUnreadConversation<TChannel = { channelType?: number }> {
  channel: TChannel;
  unread?: number;
  extra?: {
    spaceUnread?: number;
  };
}

export interface ChatUnreadCountOptions<TChannel, TConversation extends ChatUnreadConversation<TChannel>> {
  conversations: TConversation[];
  currentSpaceId?: string;
  personChannelType: number;
  getChannelInfo: (channel: TChannel) => { mute?: boolean } | undefined;
  shouldSkipChannelForSpace: (channel: TChannel) => boolean;
  shouldSkipPersonConversationForSpace: (conversation: TConversation) => boolean;
}

export function getChatUnreadCount<TChannel extends { channelType?: number }, TConversation extends ChatUnreadConversation<TChannel>>(
  options: ChatUnreadCountOptions<TChannel, TConversation>,
): number {
  let unreadCount = 0;

  for (const conversation of options.conversations) {
    const channelInfo = options.getChannelInfo(conversation.channel);
    if (channelInfo?.mute) {
      continue;
    }
    if (options.shouldSkipChannelForSpace(conversation.channel)) {
      continue;
    }
    if (options.shouldSkipPersonConversationForSpace(conversation)) {
      continue;
    }

    if (options.currentSpaceId
      && conversation.channel.channelType === options.personChannelType
      && conversation.extra?.spaceUnread !== undefined) {
      unreadCount += conversation.extra.spaceUnread;
    } else {
      unreadCount += conversation.unread ?? 0;
    }
  }

  return unreadCount;
}

export function shouldShowChatNavUnreadBadge(currentMenuId: string | undefined, unreadCount: number): boolean {
  return currentMenuId !== undefined && currentMenuId !== "chat" && unreadCount > 0;
}
