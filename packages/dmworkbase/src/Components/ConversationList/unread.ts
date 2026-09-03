import { isEffectivelyMuted } from "../../Service/Thread"

interface ThreadRowSource {
  unread?: number
  isMentionMe?: boolean
  channelInfo?: {
    orgData?: {
      thread?: {
        mute?: number | null
      }
    }
  }
}

export function isThreadUnreadMuted(
  thread: ThreadRowSource,
  parentMuted: boolean
): boolean {
  return isEffectivelyMuted({
    isThread: true,
    channelInfo: thread.channelInfo,
    parentChannelInfo: { mute: parentMuted ? 1 : 0 },
  })
}

export function collapsedThreadUnread(
  threads: ThreadRowSource[],
  parentMuted: boolean,
  includeCollapsedThreadUnread: boolean
): number {
  if (!includeCollapsedThreadUnread) return 0

  return threads.reduce((sum, thread) => {
    if (isThreadUnreadMuted(thread, parentMuted)) return sum
    return sum + (thread.unread || 0)
  }, 0)
}

// 折叠子区里的 @我 上浮到父群行。签名与 collapsedThreadUnread 对齐，静音语义共用
// isThreadUnreadMuted（父群静音时 thread 不能单独打破，逻辑与未读聚合一致）。
// 注意：传入元素需暴露与 ConversationWrap 一致的 isMentionMe getter，
// 才能读到 reminders + lastMessage.mention.uids 的权威源。
export function collapsedThreadHasMention(
  threads: ThreadRowSource[],
  parentMuted: boolean,
  includeCollapsed: boolean
): boolean {
  if (!includeCollapsed) return false
  return threads.some((thread) => {
    if (isThreadUnreadMuted(thread, parentMuted)) return false
    return !!thread.isMentionMe
  })
}
