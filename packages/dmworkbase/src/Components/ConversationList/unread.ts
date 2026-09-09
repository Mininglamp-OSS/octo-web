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

// 折叠子区里的 @我 上浮到父群行。仅判断 mention 有无，不做 mute 过滤——
// 与父群行自己 hasMention 的语义保持一致（免打扰群里的直接 @我 仍然点亮 marker，
// 这是产品行为，若要收紧到 mute-suppress 需要产品明确拍板并同时改动 category header）。
// 注意：传入元素需暴露与 ConversationWrap 一致的 isMentionMe getter，
// 才能读到 reminders + lastMessage.mention.uids 的权威源。
export function collapsedThreadHasMention(
  threads: ThreadRowSource[],
  includeCollapsed: boolean
): boolean {
  if (!includeCollapsed) return false
  return threads.some((thread) => !!thread.isMentionMe)
}
