// 把一条 Bot 评论串对上它那个「改前安全快照」版本。
//
// 为什么需要:评论区的任务卡片上有「查看 Diff」,但**评论串里没有记录版本号** —— 后端没有把
// 「这条评论触发的那次修改产生了哪个版本」存下来。所以只能从已有数据推。
//
// 推法必须 fail-closed。把别人的改动展示成这条评论的结果,是会让人据此做出错误判断的那种错
// (比如看到一处不该有的改动,以为是自己刚让 Bot 干的)。所以:
//   - 唯一命中 → 直接打开那个 Diff
//   - 命中 0 个或多个 → 不猜,退回「打开版本记录自己看」
//
// 判据(三条同时成立):
//   1. 这是一个 Bot 改前安全快照(isBotEditVersion,label 精确命中白名单)
//   2. createdBy 就是被 @ 的那个 Bot —— 同一篇文档里可能有多个 Bot 在干活
//   3. createdAt 落在 [根评论创建时间, Bot 回复时间] 这个闭区间里 —— 快照必然在任务开始
//      之后、回复之前产生
//
// 同一个 Bot 在一条串里被追问多次时会有多个快照落在区间内,那正是「多个命中」的情形,
// 按上面的规则退回版本记录。不取「最后一个」:追问序列里哪一次对应用户此刻问的那句,
// 光靠时间戳分不出来。

import { isBotEditVersion } from './botEdit.ts'
import type { VersionMeta } from './api.ts'

export interface BotDiffHint {
  /** 被 @ 的 Bot uid。 */
  botUid: string
  /** 根评论创建时间(ISO)。 */
  fromISO: string
  /** Bot 回复时间(ISO)。 */
  toISO: string
}

/**
 * 从版本列表里挑出这条评论串对应的 Bot 安全快照。
 *
 * 返回 null = 无法唯一确定(0 个或多个候选),调用方应退回「打开版本记录」而不是随便挑一个。
 */
export function pickBotEditVersion(
  versions: readonly VersionMeta[],
  hint: BotDiffHint | null | undefined,
): VersionMeta | null {
  if (!hint) return null
  const from = Date.parse(hint.fromISO)
  const to = Date.parse(hint.toISO)
  // 时间戳解不出来就别推 —— 拿 NaN 去比较会让区间判断恒为假,不如显式退回。
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null

  const candidates = versions.filter((v) => {
    if (!isBotEditVersion(v)) return false
    if (v.createdBy !== hint.botUid) return false
    const at = Date.parse(v.createdAt)
    return Number.isFinite(at) && at >= from && at <= to
  })
  return candidates.length === 1 ? candidates[0]! : null
}
