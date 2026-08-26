import APIClient from "./APIClient"
import { apiPath } from "./apiPath"

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
  /** 后端 g.name LIKE %q% 全库搜索关键字；空串 / 仅空白不下发。 */
  q?: string
}

/**
 * Bot 配置项目录中的一项（`GET /v1/robot/:robot_id/settings` 的 list 元素）。
 *
 * 注意这是一份「可配置项目录」，不是「已设置项列表」：所有已注册的键都会返回，
 * 没设过的 `value` 为 null。服务端加新键时客户端不发版就能看到它，所以字段全部
 * 声明为可选 + 宽类型，由上层 VM 做白名单过滤与类型收窄。
 *
 * 三个值字段不能合并（服务端文档明确要求）：
 *   - `value`           该 Bot 的显式覆盖，null = 没设过
 *   - `effective_value` 实际生效值（覆盖 → 全局默认 → 代码默认，逐层回落）
 *   - `source`          生效值来自哪一层：bot / global / default / env
 * 合并之后就分不出「显式设成 false」和「没设、上层默认 false」，而这两种情况下
 * 「恢复默认」按钮该不该出现、点了之后变成什么，完全不同。
 */
export interface BotSettingItem {
  key: string
  /** 目前只有 "bool"。上层跳过非 bool，防服务端将来加 int/string 键打挂 UI。 */
  type?: string
  value?: unknown
  effective_value?: unknown
  source?: string
  /** false = 只读（如 env 派生的 bot.card_enabled），写它会 400。 */
  editable?: boolean
}

export interface BotSettingsListResponse {
  list?: BotSettingItem[]
}

/** 批量写入的单项。全批原子：任一非法则整批拒绝。 */
export interface BotSettingWriteItem {
  key: string
  value: boolean
}

const BotManageService = {
  listGroups(request: ListBotGroupsRequest): Promise<BotGroupsListResponse> {
    const param: Record<string, string | number> = {
      limit: request.limit,
    }
    if (request.cursor) {
      param.cursor = request.cursor
    }
    const q = (request.q || "").trim()
    if (q) {
      param.q = q
    }
    return APIClient.shared.get(apiPath`robot/${request.robotId}/groups`, { param })
  },

  enableMentionFree(robotId: string, groupNo: string): Promise<void> {
    return APIClient.shared.put(
      apiPath`robot/${robotId}/groups/${groupNo}/mention_pref`,
      { no_mention: 1 },
    )
  },

  disableMentionFree(robotId: string, groupNo: string): Promise<void> {
    return APIClient.shared.delete(
      apiPath`robot/${robotId}/groups/${groupNo}/mention_pref`,
    )
  },

  /**
   * 读取 Bot 配置项目录。仅 bot 创建者可访问，带按登录用户的限流。
   *
   * 响应带 `Cache-Control: private, no-store` —— 不要在任何层缓存，改完配置
   * 立刻重读必须看到新值。
   *
   * 注：`robotId` 未做 encode，与本文件既有的群相关方法保持一致（robotId 是服务端
   * 下发的 uid，不含路径分隔符）。下面 deleteSetting 的 `key` 则做了 encode，因为
   * 它是代码里拼出来的带点号常量，编码一下更稳妥。这个不对称是既有约定，不是笔误。
   */
  listSettings(robotId: string): Promise<BotSettingsListResponse> {
    return APIClient.shared.get(apiPath`robot/${robotId}/settings`)
  },

  /**
   * 批量写入配置覆盖。全批原子，不存在「三项里生效两项」的中间态；
   * 同一请求内 key 重复 / 空 items / 未注册 key / 写只读键都会被拒（400）。
   */
  putSettings(
    robotId: string,
    items: BotSettingWriteItem[],
  ): Promise<void> {
    return APIClient.shared.put(apiPath`robot/${robotId}/settings`, { items })
  },

  /**
   * 删除某项覆盖 = 回落到上一层（全局默认 / 代码默认），**不是设为 false**。
   * 这是「恢复默认」按钮该调的接口。幂等：删不存在的覆盖也返回成功。
   *
   * key 形如 `bot.display_enabled`（含点号）。encodeURIComponent 不转义点号，
   * 这里编码只为防御 key 里出现路径分隔符等意外字符。
   */
  deleteSetting(robotId: string, key: string): Promise<void> {
    return APIClient.shared.delete(
      apiPath`robot/${robotId}/settings/${encodeURIComponent(key)}`,
    )
  },
}

export default BotManageService
