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

/**
 * Resolved directory for a space: uid → display name PLUS the set of uids known to be bots.
 *
 * The member row data (rich `Member` / html `HtmlGrant`) only carries uid/role/source, so it can't
 * tell a bot from a human. We already fetch two bot-aware sources here in the SAME Promise.all, so
 * we surface a `botUids` set alongside the names — no extra request. `botUids` is the union of:
 *   - space-member entries flagged `isBot` (host `robot === 1`), and
 *   - every uid returned by `/robot/space_bots` (that endpoint returns bots exclusively).
 *
 * fail-soft direction is "unknown ⇒ human": on empty/failed/unresolved data `botUids` is empty, so
 * every row renders as a person (never hide a real human in a bot fold). The panel relies on this.
 */
export interface SpaceMemberDirectory {
  names: Map<string, string>
  botUids: Set<string>
}

const cache = new Map<string, Promise<SpaceMemberDirectory>>()
// Memoized names-only projection, keyed by the directory promise, so getSpaceMemberNames returns a
// STABLE promise for a given space (same-identity as before) and never triggers a second fetch.
const namesProjection = new WeakMap<Promise<SpaceMemberDirectory>, Promise<Map<string, string>>>()

/**
 * Resolve the uid → display-name + bot directory for a space (cached per spaceId). Always
 * resolves; on a fetch error it yields an empty directory and drops the cache entry so the next
 * call can retry. Still exactly ONE Promise.all (two requests) per space — the bot set is derived
 * from data we already fetch, not a new call.
 */
export function getSpaceMemberDirectory(spaceId: string): Promise<SpaceMemberDirectory> {
  if (!spaceId) return Promise.resolve({ names: new Map<string, string>(), botUids: new Set<string>() })
  const cached = cache.get(spaceId)
  if (cached) return cached
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
    if (members === null) cache.delete(spaceId)
    const map = new Map<string, string>()
    const botUids = new Set<string>()
    for (const m of members ?? []) {
      if (!m.uid) continue
      map.set(m.uid, m.name || m.uid)
      // Only a POSITIVE isBot flag marks a bot; missing/false stays human (fail-soft direction).
      if (m.isBot === true) botUids.add(m.uid)
    }
    // Backfill ONLY uids that are absent or still resolve to their raw uid — never overwrite a
    // real human/member name (bots filtered out of queryMembers are exactly the missing ones).
    // Every space_bots row is a bot by definition → its uid joins botUids.
    for (const b of bots) {
      if (!b.uid) continue
      botUids.add(b.uid)
      const existing = map.get(b.uid)
      if (!existing || existing === b.uid) map.set(b.uid, b.name || b.uid)
    }
    return { names: map, botUids }
  })
  cache.set(spaceId, pending)
  return pending
}

/**
 * Backward-compatible names-only accessor (unchanged signature/behavior). Kept so every existing
 * caller (EditorShell caret label, panels, tests) keeps working without a change; it simply
 * projects the directory down to its `names` map.
 */
export function getSpaceMemberNames(spaceId: string): Promise<Map<string, string>> {
  const dir = getSpaceMemberDirectory(spaceId)
  const existing = namesProjection.get(dir)
  if (existing) return existing
  const names = dir.then((d) => d.names)
  namesProjection.set(dir, names)
  return names
}

/** Test/util hook: drop all cached maps (e.g. between tests or after a space switch). */
export function clearMemberNameCache(): void {
  cache.clear()
}
