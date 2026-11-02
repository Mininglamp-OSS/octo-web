import type { ConversationWrap } from "../../Service/Model"
export const conversationFoldKey = (c: ConversationWrap) => `${c.channel.channelType}::${c.channel.channelID}`
export function partitionFolded(conversations: ConversationWrap[], keys: Set<string>, isMuted: (c: ConversationWrap) => boolean) {
 const folded = conversations.filter(c => keys.has(conversationFoldKey(c)))
 return {
  folded,
  recent: conversations.filter(c => !keys.has(conversationFoldKey(c))),
  timestamp: folded.reduce((max, c) => Math.max(max, c.timestamp), 0),
  unread: folded.reduce((n, c) => n + (isMuted(c) ? 0 : c.unread), 0),
  hasUnread: folded.some(c => c.unread > 0),
  mention: folded.some(c => c.isMentionMe),
 }
}
