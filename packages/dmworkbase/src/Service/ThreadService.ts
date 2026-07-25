import APIClient from "./APIClient"
import { buildThreadChannelId, parseThreadChannelId, type Thread } from "./Thread"

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
  async createThreadByName(
    groupNo: string,
    name: string,
    sourceMessageId?: number
  ): Promise<ThreadCreateResult> {
    const body: { name: string; source_message_id?: number } = { name }
    if (sourceMessageId !== undefined) {
      body.source_message_id = sourceMessageId
    }
    const resp = await APIClient.shared.post(`groups/${groupNo}/threads`, {
      ...body,
    })
    return normalizeThreadCreateResult(resp, groupNo)
  },

  createThreadFromMessage(req: CreateThreadFromMessageReq): Promise<ThreadCreateResult> {
    return APIClient.shared.post(`groups/${req.groupNo}/threads`, {
      name: req.name,
      source_message_id: req.sourceMessageId,
      source_message_payload: req.sourceMessagePayload,
    })
  },
}

function normalizeThreadCreateResult(resp: ThreadCreateResult, groupNo: string): ThreadCreateResult {
  const shortId = resp.short_id || (resp.channel_id ? parseThreadChannelId(resp.channel_id)?.shortId : undefined)
  const channelId = resp.channel_id || (shortId ? buildThreadChannelId(groupNo, shortId) : undefined)
  return {
    ...resp,
    group_no: resp.group_no || groupNo,
    short_id: shortId,
    channel_id: channelId,
  }
}

export default ThreadService
