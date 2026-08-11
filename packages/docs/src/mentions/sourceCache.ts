// Role-KEYED memoisation of the shared @-mention source (mentions/source.ts).
//
// WHY THIS EXISTS — the defect it fixes:
//
// Every `@` surface memoises `loadMentionSources()` once per editor/controller so a popup does not
// re-fetch the space roster on each keystroke. The role that gates Bot candidates, however, arrives
// LATER than the surface is built (it comes from the collab token) and can change again at runtime
// (a stateless permission frame can downgrade writer → reader mid-session). That is why every caller
// reads it through a THUNK.
//
// A plain `if (!cache) cache = load(...)` throws that away: it snapshots whatever the thunk answered
// on the FIRST `@` and pins the result forever. Both directions are broken by it:
//
//   • role not ready yet (undefined) → resolveBotCandidates fails closed and reports "you may not
//     @Bot"… and that answer is then CACHED. The role lands a moment later, but the popup keeps
//     claiming the caller has no permission for the rest of the session. This is what a document
//     OWNER saw: 「当前权限不能 @Bot」 on their own document.
//   • runtime DOWNGRADE (writer → reader) → the cached list still carries the Bots the caller could
//     reach while they were a writer, so the gate silently stops applying.
//
// Fail-closed stays fail-closed: nothing here decides permissions (that is botCandidates.ts). The
// only thing this module changes is HOW LONG an answer is allowed to live — exactly as long as the
// role it was computed for. A load is keyed on the role, so:
//   • the same role → the same memoised promise (one fetch, as before)
//   • a different role (including "unknown → known" and "writer → reader") → the previous answer is
//     dropped and recomputed from the CURRENT role.
//
// "Unknown" is a cache key like any other, rather than "never cache": a surface whose role never
// arrives (preview / non-collab host) would otherwise re-fetch the whole roster on every keystroke.

import type { Role } from '../auth/roles.ts'
import type { BotNotice } from './botCandidates.ts'
import { loadMentionSources, type MentionItem } from './source.ts'

/**
 * Distinct from every Role AND from `undefined`, so "nothing has been loaded yet" is a different
 * state from "loaded while the role was still unknown". Without it the first load for an unknown
 * role would look like a cache hit and never run.
 */
const NEVER_LOADED = Symbol('mention-source-never-loaded')

export interface MentionSourceCache {
  /** Candidate items for the CURRENT role, memoised per role. Never rejects. */
  load(): Promise<MentionItem[]>
  /** Items of the newest load; `[]` until it settles (and again while a role change re-loads). */
  items(): MentionItem[]
  /** Why the Bot section is empty, from the SAME load that produced `items()`. */
  notice(): BotNotice | null
}

/**
 * 候选列表的有效期。
 *
 * 与 members/botUids.ts 的 TTL 取同一个值 —— 两层缓存过期步调不一致的话,会出现
 * 「下拉里能看到新 Bot,但卡片判定还认不出它」这种半新半旧的状态。
 */
const TTL_MS = 30_000

export function createMentionSourceCache(opts: {
  spaceId: string
  /** The document whose roster decides Bot eligibility. Absent → no Bots (fail closed). */
  docId?: string
  /** Live role of the caller, read as a thunk on every load. Absent → no Bots (fail closed). */
  getRole?: () => Role | undefined
  /** Called after a load settles, so a popup already on screen can repaint with the new answer. */
  onSettle?: () => void
}): MentionSourceCache {
  let pending: Promise<MentionItem[]> | null = null
  let loadedFor: Role | undefined | typeof NEVER_LOADED = NEVER_LOADED
  let items: MentionItem[] = []
  let notice: BotNotice | null = null
  /** 上次发起 load 的时刻,用来让缓存过期(见 TTL_MS)。 */
  let loadedAt = 0

  const load = (): Promise<MentionItem[]> => {
    const role = opts.getRole?.()
    const roleChanged = loadedFor !== role
    const stale = Date.now() - loadedAt >= TTL_MS
    // 同 role 且还新鲜 ⇒ 复用。加 TTL 之前这里只看 role,而 role 不会因为「新建了一个 Bot」
    // 而变 —— 于是新 Bot 永远不出现在下拉里,用户得退出文档重进。
    if (pending !== null && !roleChanged && !stale) return pending
    loadedFor = role
    loadedAt = Date.now()
    // 只在 **role 变了** 时清空当前答案:
    //   - role 变了必须清 —— 降权的 writer 不能继续看到他已经不能选的 Bot 行,
    //     升权的人也不该继续看到「无权限」那句。这是这段代码原本要修的问题。
    //   - 只是过期(role 没变)则**保留旧值**,让新值回来再替换。否则每次过期后打开下拉
    //     都会先闪一下空列表。
    if (roleChanged) {
      items = []
      notice = null
    }
    const p: Promise<MentionItem[]> = loadMentionSources(opts.spaceId, {
      ...(opts.docId ? { docId: opts.docId } : {}),
      ...(role != null ? { role } : {}),
    })
      .then((res) => {
        // A newer load (role changed again while this one was in flight) owns the state now; this
        // one must not overwrite it with the older role's answer.
        if (p !== pending) return res.items
        items = res.items
        notice = res.botNotice
        opts.onSettle?.()
        return res.items
      })
      .catch(() => [])
    pending = p
    return p
  }

  return { load, items: () => items, notice: () => notice }
}
