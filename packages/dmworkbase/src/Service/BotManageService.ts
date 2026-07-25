import APIClient from "./APIClient"

export interface BotGroupItem {
  group_no: string
  name: string
  no_mention: boolean
}

export interface BotGroupsListResponse {
  list?: BotGroupItem[]
  next_cursor?: string | null
  has_more?: boolean
}

export interface ListBotGroupsRequest {
  robotId: string
  limit: number
  cursor?: string | null
}

const BotManageService = {
  listGroups(request: ListBotGroupsRequest): Promise<BotGroupsListResponse> {
    const param: Record<string, string | number> = {
      limit: request.limit,
    }
    if (request.cursor) {
      param.cursor = request.cursor
    }
    return APIClient.shared.get(`robot/${request.robotId}/groups`, { param })
  },

  enableMentionFree(robotId: string, groupNo: string): Promise<void> {
    return APIClient.shared.put(
      `robot/${robotId}/groups/${groupNo}/mention_pref`,
      { no_mention: 1 },
    )
  },

  disableMentionFree(robotId: string, groupNo: string): Promise<void> {
    return APIClient.shared.delete(
      `robot/${robotId}/groups/${groupNo}/mention_pref`,
    )
  },
}

export default BotManageService
