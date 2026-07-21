import type {
  MessageReaction,
  MessageReactionGroup,
  MessageReactionUser,
} from "./types"

/**
 * 把服务端返回的 reaction 明细归一为可直接渲染的 group 列表。
 *
 * 规则（与 brief 对齐）：
 * - 剔除 isDeleted === 1；
 * - 按 (reactionType, reactionKey) 聚合，emoji / sticker 即便 key 相同也分开；
 * - 同一 uid 在同一组内去重，保留首次出现的 name（避免昵称变化时用户列表跳动）；
 * - 用户内排序：seq 升序 → createdAt 升序 → 输入原顺序；
 * - 组间排序：latestSeq 升序（越早出现越靠左），使 UI 展示与用户看到的时间序一致；
 *   全部无 seq 时保持首次出现顺序。
 * - hasMine 由外层传入 currentUid 判定；currentUid 为空时恒为 false。
 * - 不修改入参。
 */
export function aggregateReactions(
  reactions: readonly MessageReaction[] | undefined | null,
  currentUid: string | undefined | null,
): MessageReactionGroup[] {
  if (!reactions || reactions.length === 0) return []

  interface Bucket {
    group: MessageReactionGroup
    /** 用户在原输入中的首次索引，用于排序 tie-break */
    userInsertionOrder: Map<string, number>
    /** 组在原输入中的首次索引 */
    groupInsertionOrder: number
    /** 每个用户挑到的 record（用于取 seq / createdAt / name） */
    userRecord: Map<string, MessageReaction>
    /** 组内最小 seq（首次出现），用于组间「按首次出现顺序」稳定排序 */
    firstSeq?: number
  }

  const buckets = new Map<string, Bucket>()
  let groupIndex = 0

  reactions.forEach((rec, idx) => {
    if (rec.isDeleted === 1) return
    if (!rec.uid || !rec.reactionKey) return

    const bucketKey = `${rec.reactionType}::${rec.reactionKey}`
    let bucket = buckets.get(bucketKey)
    if (!bucket) {
      bucket = {
        group: {
          reactionType: rec.reactionType,
          reactionKey: rec.reactionKey,
          emoji: rec.emoji,
          sticker: rec.sticker,
          users: [],
          hasMine: false,
          latestSeq: undefined,
        },
        userInsertionOrder: new Map(),
        groupInsertionOrder: groupIndex++,
        userRecord: new Map(),
        firstSeq: undefined,
      }
      buckets.set(bucketKey, bucket)
    }

    // 已存在的 uid 保留首次记录（不覆盖 name）；仅记录第一个 record 即可满足排序需求。
    if (!bucket.userRecord.has(rec.uid)) {
      bucket.userRecord.set(rec.uid, rec)
      bucket.userInsertionOrder.set(rec.uid, idx)
    }

    if (typeof rec.seq === "number") {
      // latestSeq = 组内最大 seq（保留为可选元数据）
      if (
        bucket.group.latestSeq === undefined ||
        rec.seq > bucket.group.latestSeq
      ) {
        bucket.group.latestSeq = rec.seq
      }
      // firstSeq = 组内最小 seq，用于组间排序，保证已有组不因新增参与者而跳序
      if (bucket.firstSeq === undefined || rec.seq < bucket.firstSeq) {
        bucket.firstSeq = rec.seq
      }
    }
  })

  const uidCompareKey = (
    r: MessageReaction,
  ): { hasSeq: boolean; seq: number; ts: number } => ({
    hasSeq: typeof r.seq === "number",
    seq: typeof r.seq === "number" ? r.seq : Number.POSITIVE_INFINITY,
    ts: r.createdAt ? Date.parse(r.createdAt) || 0 : 0,
  })

  const groups: MessageReactionGroup[] = []
  buckets.forEach((bucket) => {
    const uids = Array.from(bucket.userRecord.keys())
    uids.sort((a, b) => {
      const ra = bucket.userRecord.get(a)!
      const rb = bucket.userRecord.get(b)!
      const ka = uidCompareKey(ra)
      const kb = uidCompareKey(rb)
      if (ka.hasSeq && kb.hasSeq && ka.seq !== kb.seq) return ka.seq - kb.seq
      if (ka.hasSeq !== kb.hasSeq) return ka.hasSeq ? -1 : 1
      if (ka.ts !== kb.ts) return ka.ts - kb.ts
      return (
        (bucket.userInsertionOrder.get(a) ?? 0) -
        (bucket.userInsertionOrder.get(b) ?? 0)
      )
    })

    const users: MessageReactionUser[] = uids.map((uid) => ({
      uid,
      name: bucket.userRecord.get(uid)!.name,
    }))

    const hasMine = currentUid ? uids.includes(currentUid) : false

    groups.push({
      ...bucket.group,
      users,
      hasMine,
    })
  })

  // 组间排序：按首次出现（firstSeq 最小）升序，保证已有组不因后来新增参与者
  // （latestSeq 变大）而跳到末尾；两组都无 seq 时回退到首次出现的输入顺序。
  groups.sort((a, b) => {
    const aBucket = buckets.get(`${a.reactionType}::${a.reactionKey}`)!
    const bBucket = buckets.get(`${b.reactionType}::${b.reactionKey}`)!
    const aFirst = aBucket.firstSeq
    const bFirst = bBucket.firstSeq
    if (aFirst !== undefined && bFirst !== undefined) {
      if (aFirst !== bFirst) return aFirst - bFirst
    } else if (aFirst !== bFirst) {
      return aFirst === undefined ? 1 : -1
    }
    return aBucket.groupInsertionOrder - bBucket.groupInsertionOrder
  })

  return groups
}
