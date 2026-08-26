export interface UnreadConversationCandidate {
  unread: number;
  crossSpace?: boolean;
  effectivelyMuted?: boolean;
  archived?: boolean;
}

export function countEffectiveUnreadConversations(
  conversations: readonly UnreadConversationCandidate[]
): number {
  return conversations.reduce((count, conversation) => {
    const unread = Number.isFinite(conversation.unread)
      ? conversation.unread
      : 0;
    if (
      unread <= 0 ||
      conversation.crossSpace ||
      conversation.effectivelyMuted ||
      conversation.archived
    ) {
      return count;
    }
    return count + 1;
  }, 0);
}
