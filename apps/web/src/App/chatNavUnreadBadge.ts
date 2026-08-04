export interface LiveChatNavUnreadCountOptions<TConversation, TRecentConversation> {
  conversations: TConversation[];
  shouldSkipChannelForSpace: (channel: TConversation extends { channel: infer TChannel } ? TChannel : never) => boolean;
  shouldSkipPersonConversationForSpace: (conversation: TConversation) => boolean;
  toRecentConversation: (conversation: TConversation) => TRecentConversation;
  isMutedForRecentConversation: (conversation: TRecentConversation) => boolean;
  getRecentConversationUnreadCount: (
    conversations: TRecentConversation[],
    isMutedForRecentConversation: (conversation: TRecentConversation) => boolean,
  ) => number;
}

export function getLiveChatNavUnreadCount<
  TConversation extends { channel: unknown },
  TRecentConversation,
>(options: LiveChatNavUnreadCountOptions<TConversation, TRecentConversation>): number {
  const recentConversations = options.conversations
    .filter((conversation) => {
      if (options.shouldSkipChannelForSpace(conversation.channel as never)) return false;
      return !options.shouldSkipPersonConversationForSpace(conversation);
    })
    .map((conversation) => options.toRecentConversation(conversation));

  return options.getRecentConversationUnreadCount(
    recentConversations,
    options.isMutedForRecentConversation,
  );
}
