// Space bot roster → "which uids are Bots?" (comment drawer §3: purple is Bot-only chrome).
//
// The comment wire contract carries no "is this author/mentionee a bot" flag, and a Bot mention is
// deliberately serialised as a plain `@[user:…]` token (mentions/source.ts explains why), so the
// only way to tell a Bot thread from a human one is uid membership. The host already exposes the
// space's bots through the octoweb seam (`GET /robot/space_bots`, one non-viewer-scoped request per
// space — the same endpoint members/memberNames.ts uses to backfill bot display names).
//
// Resilience mirrors memberNames.ts: never throws, an empty set on failure (so every thread just
// renders as a human thread — purple never appears on a guess), and the failed entry is evicted so
// a later open retries.

import { useEffect, useState } from 'react'
import { fetchSpaceBotNames } from '../octoweb/index.ts'

const cache = new Map<string, Promise<ReadonlySet<string>>>()
/** 每个 spaceId 上次成功拉取的时刻,用于判断缓存过不过期。 */
const fetchedAt = new Map<string, number>()

/**
 * 名册缓存的有效期。
 *
 * 之前是**永久缓存**:新建一个 Bot 之后不刷页面就永远看不到它 —— 用户得退出重进,
 * 那不像功能像 bug。全不缓存也不行:每开一次 `@` 下拉就打一次名册接口。
 *
 * 30 秒是个折中:新建 Bot 后最多等半分钟(通常更快 —— 建 Bot 本身就要几秒,
 * 加上切窗口回来的时间),而连续打开下拉时仍然走缓存。
 */
const TTL_MS = 30_000

const EMPTY: ReadonlySet<string> = new Set<string>()

/** Resolve the set of bot uids in a space (cached per spaceId). Always resolves. */
export function getSpaceBotUids(spaceId: string): Promise<ReadonlySet<string>> {
  if (!spaceId) return Promise.resolve(EMPTY)
  const cached = cache.get(spaceId)
  const age = Date.now() - (fetchedAt.get(spaceId) ?? 0)
  if (cached && age < TTL_MS) return cached
  const pending = fetchSpaceBotNames(spaceId).then(
    (bots) => new Set(bots.map((b) => b.uid).filter(Boolean)) as ReadonlySet<string>,
    () => {
      // Transient failure: forget it so a later open retries instead of caching "no bots".
      cache.delete(spaceId)
      fetchedAt.delete(spaceId)
      return EMPTY
    },
  )
  cache.set(spaceId, pending)
  // 与 memberNames 同理:发起时就记,否则并发的第二次调用会重复打请求。
  fetchedAt.set(spaceId, Date.now())
  return pending
}

/** Test/util hook: drop all cached sets (e.g. between tests or after a space switch). */
export function clearSpaceBotUidCache(): void {
  cache.clear()
  // 时间戳一起清:只清 cache 的话下一次取会因为「还新鲜」而跳过重拉。
  fetchedAt.clear()
}

/**
 * Subscribe a component to the space's bot-uid set. Returns an empty set on first render (threads
 * render as human until it lands, then re-render with the Bot chrome) — the fetch never rejects.
 */
export function useSpaceBotUids(spaceId: string): ReadonlySet<string> {
  const [uids, setUids] = useState<ReadonlySet<string>>(EMPTY)
  useEffect(() => {
    let active = true
    void getSpaceBotUids(spaceId).then((set) => {
      if (active) setUids(set)
    })
    return () => {
      active = false
    }
  }, [spaceId])
  return uids
}
