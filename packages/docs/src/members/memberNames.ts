// Space member uid → display-name resolution (features #7 / #8 + cursor label).
//
// Root cause being fixed: awareness `user` was set as `{ id: uid, name: uid }`, so the presence
// avatar initial, the collaboration caret label and the member panel all showed the raw uid
// instead of a human name. The host exposes display names via the space-member source, reached
// through the octoweb seam (fetchAllSpaceMembers). This module fetches that list ONCE per space
// and caches the resulting uid → name map so the editor/member panel can resolve names cheaply.
//
// Resilience: a fetch failure resolves to an EMPTY map (never throws) and the failed entry is
// evicted so a later open retries — callers always fall back to the uid, so first paint can
// never crash on a missing/slow member list.

import { fetchAllSpaceMembers } from '../octoweb/index.ts'

const cache = new Map<string, Promise<Map<string, string>>>()

/**
 * Resolve the uid → display-name map for a space (cached per spaceId). Always resolves; on a
 * fetch error it yields an empty map and drops the cache entry so the next call can retry.
 */
export function getSpaceMemberNames(spaceId: string): Promise<Map<string, string>> {
  if (!spaceId) return Promise.resolve(new Map<string, string>())
  const cached = cache.get(spaceId)
  if (cached) return cached
  const pending = fetchAllSpaceMembers(spaceId)
    .then((members) => {
      const map = new Map<string, string>()
      for (const m of members) {
        if (m.uid) map.set(m.uid, m.name || m.uid)
      }
      return map
    })
    .catch(() => {
      // Transient failure: forget it so a later open retries instead of caching "no names".
      cache.delete(spaceId)
      return new Map<string, string>()
    })
  cache.set(spaceId, pending)
  return pending
}

/** Test/util hook: drop all cached maps (e.g. between tests or after a space switch). */
export function clearMemberNameCache(): void {
  cache.clear()
}
