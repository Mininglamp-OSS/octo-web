// Space member uid → display-name resolution (features #7 / #8 + cursor label).
//
// Root cause being fixed: awareness `user` was set as `{ id: uid, name: uid }`, so the presence
// avatar initial, the collaboration caret label and the member panel all showed the raw uid
// instead of a human name. The host exposes display names via the space-member source, reached
// through the octoweb seam (fetchAllSpaceMembers). This module fetches that list ONCE per space
// and caches the resulting uid → name map so the editor/member panel can resolve names cheaply.
//
// Bot backfill (octo-docs-backend #60): the space-member source (`queryMembers`) drops any bot the
// current user did not create, so a non-friend / non-self-created bot has no name here and the panel
// falls back to its raw uid. We backfill those names with a SINGLE `GET /robot/space_bots?space_id=`
// request per space (not viewer-scoped, no per-uid fanout, no extra permission) and merge only the
// uids that are still missing a real name — human members keep their original name untouched.
//
// Resilience: a fetch failure resolves to an EMPTY map (never throws) and the failed entry is
// evicted so a later open retries — callers always fall back to the uid, so first paint can
// never crash on a missing/slow member list. The bot backfill is independently best-effort: if it
// fails the human names still resolve.

import { fetchAllSpaceMembers, fetchSpaceBotNames } from '../octoweb/index.ts'

const cache = new Map<string, Promise<Map<string, string>>>()
/** 每个 spaceId 上次成功组装的时刻,用来让缓存过期。 */
const fetchedAt = new Map<string, number>()

/**
 * 名字表的有效期。与 mentions/sourceCache.ts、members/botUids.ts 取同一个值。
 *
 * 原来是**永久缓存**:在一个新 Bot 创建之前打开过页面,这张表里就永远没有它的名字 ——
 * 界面于是把它的 uid 直接显示出来(实测:AI 卡片标题显示 `27xnumudu8yb5fe4970_bot`
 * 而不是 `test22`)。三层缓存(候选列表 / Bot 名册 / 名字表)是同一个毛病,必须一起过期,
 * 否则会出现「下拉里有名字、卡片上是 uid」这种半新半旧的状态。
 */
const TTL_MS = 30_000

/**
 * Resolve the uid → display-name map for a space (cached per spaceId). Always resolves; on a
 * fetch error it yields an empty map and drops the cache entry so the next call can retry.
 */
export function getSpaceMemberNames(spaceId: string): Promise<Map<string, string>> {
  if (!spaceId) return Promise.resolve(new Map<string, string>())
  const cached = cache.get(spaceId)
  if (cached && Date.now() - (fetchedAt.get(spaceId) ?? 0) < TTL_MS) return cached
  const pending = Promise.all([
    // Human/self-created-bot names from the space-member source.
    fetchAllSpaceMembers(spaceId).then(
      (members) => members,
      () => null, // signal a transient member-fetch failure so we can evict + retry below
    ),
    // Bot names from the single non-viewer-scoped space_bots request (#60). Independently
    // best-effort: a failure here must never take down the human-member names.
    fetchSpaceBotNames(spaceId).catch(() => [] as Awaited<ReturnType<typeof fetchSpaceBotNames>>),
  ]).then(([members, bots]) => {
    // Transient failure of the member list: forget it so a later open retries instead of
    // caching "no names". We still merge whatever bot names we got for this render.
    if (members === null) {
      cache.delete(spaceId)
      // 时间戳一起清:留着的话下次取会因为「还新鲜」而复用这份缺名字的结果。
      fetchedAt.delete(spaceId)
    }
    const map = new Map<string, string>()
    for (const m of members ?? []) {
      if (m.uid) map.set(m.uid, m.name || m.uid)
    }
    // Backfill ONLY uids that are absent or still resolve to their raw uid — never overwrite a
    // real human/member name (bots filtered out of queryMembers are exactly the missing ones).
    for (const b of bots) {
      if (!b.uid) continue
      const existing = map.get(b.uid)
      if (!existing || existing === b.uid) map.set(b.uid, b.name || b.uid)
    }
    return map
  })
  cache.set(spaceId, pending)
  // ★ 在**发起时**记时间戳,不是等 resolve 之后 —— 否则「第一次还在飞、紧接着第二次调用」
  // 会因为时间戳还是空的而判成过期,又打一次请求(测试 caches per space 正是钉这个)。
  fetchedAt.set(spaceId, Date.now())
  return pending
}

/** Test/util hook: drop all cached maps (e.g. between tests or after a space switch). */
export function clearMemberNameCache(): void {
  cache.clear()
  fetchedAt.clear()
}
