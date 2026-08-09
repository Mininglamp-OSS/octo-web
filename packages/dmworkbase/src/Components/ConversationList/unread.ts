import { isEffectivelyMuted } from "../../Service/Thread"

interface ThreadUnreadSource {
  unread?: number
  channelInfo?: {
    orgData?: {
      thread?: {
        mute?: number | null
      }
    }
  }
}

export function isThreadUnreadMuted(
  thread: ThreadUnreadSource,
  parentMuted: boolean
): boolean {
  return isEffectivelyMuted({
    isThread: true,
    channelInfo: thread.channelInfo,
    parentChannelInfo: { mute: parentMuted ? 1 : 0 },
  })
}

export function collapsedThreadUnread(
  threads: ThreadUnreadSource[],
  parentMuted: boolean,
  includeCollapsedThreadUnread: boolean
): number {
  if (!includeCollapsedThreadUnread) return 0

  return threads.reduce((sum, thread) => {
    if (isThreadUnreadMuted(thread, parentMuted)) return sum
    return sum + (thread.unread || 0)
  }, 0)
}
