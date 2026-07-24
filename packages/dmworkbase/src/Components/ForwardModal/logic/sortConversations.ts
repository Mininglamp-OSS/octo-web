/**
 * 会话置顶优先 + timestamp 倒序排序。纯函数，不感知 SDK。
 *
 * PINNED_CONVERSATION_SCORE_BOOST 用大数把置顶项抬到普通项之上，避免拿 timestamp
 * 做减法时溢出 Number.MAX_SAFE_INTEGER。取 1e15：远大于任何合理毫秒时间戳
 * （2050 年 1 月 1 日 ≈ 2.5e12），也远小于 Number.MAX_SAFE_INTEGER（≈ 9e15），
 * 保证「置顶必赢」的偏序在下一个百年内稳定成立。
 */
export const PINNED_CONVERSATION_SCORE_BOOST = 1_000_000_000_000_000

export interface SortableConversation {
  timestamp: number
  channelInfo?: { top?: boolean } | undefined
}

export function sortConversations<T extends SortableConversation>(wraps: T[]): T[] {
  return [...wraps].sort((a, b) => {
    let aScore = a.timestamp
    let bScore = b.timestamp
    if (a.channelInfo?.top) aScore += PINNED_CONVERSATION_SCORE_BOOST
    if (b.channelInfo?.top) bScore += PINNED_CONVERSATION_SCORE_BOOST
    return bScore - aScore
  })
}
