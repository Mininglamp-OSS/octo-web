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
  const rawMute = thread.channelInfo?.orgData?.thread?.mute
  return rawMute != null ? rawMute === 1 : parentMuted
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
