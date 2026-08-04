export interface RecentUnreadConversation {
    unread?: number
}

export function getRecentConversationUnreadCount<T extends RecentUnreadConversation>(
    conversations: T[],
    isMutedForRecentConversation: (conversation: T) => boolean,
): number {
    return conversations.reduce((sum, conversation) => {
        if (isMutedForRecentConversation(conversation)) return sum
        return sum + (conversation.unread || 0)
    }, 0)
}

export function shouldShowChatNavUnreadBadge(currentMenuId: string | undefined, unreadCount: number): boolean {
    return currentMenuId !== undefined && currentMenuId !== "chat" && unreadCount > 0
}
