/**
 * Web 端内部统一 reaction 数据模型。
 *
 * 与服务端 wire schema 解耦：进入 Web 前经由 aggregate() / 转换层归一，
 * 避免 emoji reaction、sticker reaction、贴纸收藏三条线共用同一形状。
 */

export type MessageReactionType = "emoji" | "sticker"

/** 单条 reaction 记录（一个用户对某消息的一次操作）。 */
export interface MessageReaction {
  /** 服务端同一消息内单调递增的序号，用于 CMD 乱序丢弃；缺省时按 created_at 排序。 */
  seq?: number
  uid: string
  name: string
  reactionType: MessageReactionType
  /** 聚合 key：emoji 用 unicode 或 `[token]`，sticker 用 sticker_id 或 path。 */
  reactionKey: string
  /** emoji 类型时的可渲染 token（unicode 或 `[收到]`），非 emoji 时可缺省。 */
  emoji?: string
  /** sticker 类型时的可渲染元数据；不能依赖接收方本地是否收藏。 */
  sticker?: MessageReactionSticker
  /** 服务端软删除标记，聚合时会剔除 1。 */
  isDeleted?: 0 | 1
  /** ISO 时间戳，用于 seq 缺省时的排序 tie-break。 */
  createdAt?: string
}

export interface MessageReactionSticker {
  stickerId?: string
  /** 资源路径；配合 datasource getFileURL() 解析成可访问 URL。 */
  path: string
  format?: string
  placeholder?: string
}

/**
 * 聚合后的 reaction 分组，一个 reactionKey 一行 chip。
 * 参与用户按 seq/created_at 升序、去重后给出。
 */
export interface MessageReactionGroup {
  reactionType: MessageReactionType
  reactionKey: string
  emoji?: string
  sticker?: MessageReactionSticker
  users: MessageReactionUser[]
  /** 当前用户是否在 users 内。 */
  hasMine: boolean
  /** 组内最大 seq（若存在），用于外层跨组排序。 */
  latestSeq?: number
}

export interface MessageReactionUser {
  uid: string
  name: string
}
