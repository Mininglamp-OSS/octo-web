import WKApp from "../../App"
import ThreadService, { type ThreadCreateResult } from "../../Service/ThreadService"
import { buildThreadChannelId, type Thread } from "../../Service/Thread"

export async function createThreadByNameAndNotify(
  groupNo: string,
  name: string,
  sourceMessageId?: number
): Promise<ThreadCreateResult> {
  const result = await ThreadService.createThreadByName(groupNo, name, sourceMessageId)
  emitThreadCreated(groupNo, result)
  return result
}

export function emitThreadCreated(groupNo: string, thread: ThreadCreateResult) {
  const shortId = thread.short_id
  const threadChannelId = thread.channel_id || (shortId ? buildThreadChannelId(groupNo, shortId) : undefined)
  if (!threadChannelId) return

  WKApp.mittBus.emit("wk:thread-created", {
    groupNo,
    shortId,
    threadChannelId,
    thread: thread as Thread,
  })
}
