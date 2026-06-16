import { ChannelTypeCommunityTopic } from './Const'
export interface Thread {
  short_id: string
  group_no: string
  channel_id: string
  channel_type: number
  name: string
  creator_uid: string
  creator_name?: string
  source_message_id?: number
  status: number  // 1=活跃, 2=归档, 3=删除
  created_at: string
  updated_at: string
  is_member?: boolean  // 当前用户是否是成员
  is_followed?: boolean  // 当前用户是否已关注
  member_count?: number  // 成员数量
  message_count?: number  // 消息数量
  unread_count?: number  // 未读数量
  last_message_content?: string  // 最后一条消息内容
  last_message_sender_name?: string  // 最后一条消息发送者名称

  // GROUP.md 相关
  has_thread_md?: boolean
  thread_md_version?: number
  thread_md_updated_at?: string

  // 补齐后端已有字段
  group_name?: string
  last_message_at?: string
  // 当前用户子区免打扰状态，仅 GetThread 填充（tri-state）：
  // null/undefined = 未设置，前端应继承父群组 mute；0 = 显式不静音；1 = 显式静音
  mute?: number | null
}

export enum ThreadStatus {
  Active = 1,
  Archived = 2,
  Deleted = 3,
}

export type ThreadListStatus = "active" | "archived" | "all"

export const ThreadChannelIdSeparator = '____'

export function parseThreadChannelId(channelId: string): { groupNo: string; shortId: string } | null {
  const parts = channelId.split(ThreadChannelIdSeparator)
  if (parts.length !== 2) {
    return null
  }
  return { groupNo: parts[0], shortId: parts[1] }
}

export function buildThreadChannelId(groupNo: string, shortId: string): string {
  return `${groupNo}${ThreadChannelIdSeparator}${shortId}`
}

/** 从 pendingThread 等数据快速构造 Thread 存根（非完整数据，仅用于 UI 导航） */
export function buildThreadStub(shortId: string, groupNo: string, channelId: string, name: string): Thread {
  return {
    short_id: shortId,
    group_no: groupNo,
    channel_id: channelId,
    channel_type: ChannelTypeCommunityTopic,
    name,
    creator_uid: "",
    status: 1,
    created_at: "",
    updated_at: "",
  }
}

/**
 * 计算「有效勿扰」状态。子区采用 tri-state，覆盖优先于继承：
 *   - channelInfo.orgData.thread.mute === 1 → 显式静音（覆盖父群组）
 *   - channelInfo.orgData.thread.mute === 0 → 显式不静音（覆盖父群组）
 *   - channelInfo.orgData.thread.mute null/undefined → 继承父群组 mute
 * 非子区：直接看 channelInfo.mute。
 *
 * 角标 / 列表 / 分组未读 这三处必须共用同一份逻辑，否则 badge 和列表渲染会错位
 * （父群勿扰但子区显式取消勿扰时尤其明显）。
 */
export function isEffectivelyMuted(args: {
  isThread: boolean
  channelInfo: any
  parentChannelInfo?: any
}): boolean {
  const { isThread, channelInfo, parentChannelInfo } = args
  if (!isThread) return !!channelInfo?.mute
  const raw = channelInfo?.orgData?.thread?.mute as number | null | undefined
  if (raw != null) return raw === 1
  return !!parentChannelInfo?.mute
}
