import APIClient from "./APIClient"
import type { Thread } from "./Thread"

export interface CreateThreadFromMessageReq {
  groupNo: string
  name: string
  sourceMessageId: number
  sourceMessagePayload: Record<string, unknown>
}

export type ThreadCreateResult = Partial<Thread> & {
  channel_id?: string
  short_id?: string
}

const ThreadService = {
  createThreadByName(groupNo: string, name: string, sourceMessageId?: number): Promise<Thread> {
    const body: { name: string; source_message_id?: number } = { name }
    if (sourceMessageId !== undefined) {
      body.source_message_id = sourceMessageId
    }
    return APIClient.shared.post(`groups/${groupNo}/threads`, {
      ...body,
    })
  },

  createThreadFromMessage(req: CreateThreadFromMessageReq): Promise<ThreadCreateResult> {
    return APIClient.shared.post(`groups/${req.groupNo}/threads`, {
      name: req.name,
      source_message_id: req.sourceMessageId,
      source_message_payload: req.sourceMessagePayload,
    })
  },
}

export default ThreadService
