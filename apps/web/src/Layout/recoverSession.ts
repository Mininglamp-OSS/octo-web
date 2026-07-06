// Clean deep-link session recovery (octo-web #512).
//
// Standalone doc links (`/d/:docId`) and invite links (`?invite=`) are routinely opened in a
// fresh tab whose URL carries no `?sid=`. The app persists each session under a sid-keyed
// `token{sid}` bucket in localStorage, so the sid-keyed `WKApp.loginInfo.load()` reads nothing on
// such a cold-load even though the user is signed in — every request then 401s. This mirrors the
// recovery the invite-landing path has always done: scan localStorage for the first stored
// session and adopt it, so the deep-link authenticates against the real session instead of
// bouncing to a sign-in wall (AC-3).
//
// Kept as a pure function over a Storage-like object (not reading the WKApp singleton) so the
// scan logic is unit-testable without a live host.

/** A session recovered from a `token{sid}` bucket. */
export interface RecoveredSession {
  token: string
  uid: string
  name: string
}

/** The subset of the Web Storage API the scan needs. */
export type StorageLike = Pick<Storage, 'length' | 'key' | 'getItem'>

/**
 * Collect EVERY stored octo session in a Storage-like bag, in iteration order.
 *
 * Session buckets are keyed `token{sid}` (with sibling `uid{sid}` / `name{sid}`). The bare `token`
 * key is skipped — it is the empty-sid slot `loginInfo.load()` already read — as is the unrelated
 * `tokenCallback` config key, and empty-valued token buckets. Used by both the "first wins" invite
 * recovery (findStoredSession) and the "exactly one" standalone recovery (findUniqueStoredSession).
 */
export function findStoredSessions(store: StorageLike): RecoveredSession[] {
  // NB: the parameter is `store`, not `storage`. Under apps/extension's WXT build, a bare
  // `storage` identifier is auto-imported from `wxt/utils/storage`, which Rolldown then fails to
  // resolve in this shared web file (`pnpm build` exit 1). Keep the name off that registered token.
  const sessions: RecoveredSession[] = []
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (key && key.startsWith('token') && key !== 'token' && key !== 'tokenCallback') {
      const val = store.getItem(key)
      if (val) {
        const sid = key.substring(5) // "token".length === 5
        sessions.push({
          token: val,
          uid: store.getItem('uid' + sid) || '',
          name: store.getItem('name' + sid) || '',
        })
      }
    }
  }
  return sessions
}

/**
 * Find the FIRST stored octo session in a Storage-like bag, or null when none is present.
 *
 * Returns the token plus its sibling uid/name so the caller can populate `loginInfo` exactly as a
 * normal load would. "First wins" is the invite-landing branch's original recovery semantics — it
 * adopts this in memory only (never persisted), so a stale storage-iteration order can at worst make
 * the current tab authenticate as one of the user's own sessions, never pinned anywhere.
 */
export function findStoredSession(store: StorageLike): RecoveredSession | null {
  return findStoredSessions(store)[0] ?? null
}

/**
 * The sid of the stored `token{sid}` bucket whose token equals `token`, or null when none matches.
 *
 * Used by the post-login standalone return path to hand the reloaded `/d/:docId` an explicit
 * `?sid=` that its sid-keyed `load()` will hit directly — instead of leaning on the multi-session
 * recovery, which now (XIN-392 P1-2) refuses to guess an identity when several sessions are stored
 * and would otherwise bounce a multi-session user into a login loop. Unlike findUniqueStoredSession
 * this makes NO guess: it matches the CURRENT authenticated identity by its own token and returns
 * that session's own sid, so it is safe even with several sessions stored — we carry a known sid,
 * we never pin an arbitrary one. Returns null when the current session lives only in the empty-sid
 * (`token`) bucket, where a no-sid reload already reads it and no `?sid=` is needed.
 */
export function findSidForToken(store: StorageLike, token: string): string | null {
  if (!token) return null
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (key && key.startsWith('token') && key !== 'token' && key !== 'tokenCallback') {
      if (store.getItem(key) === token) return key.substring(5) // "token".length === 5
    }
  }
  return null
}

/**
 * The single UNAMBIGUOUS stored session, or null when storage holds zero or MORE THAN ONE session
 * bucket.
 *
 * This is the gate for the standalone branch, which PERSISTS what it adopts (see adoptStoredSession).
 * "First wins" is fine for in-memory-only invite recovery, but persisting a first-of-several guess
 * would pin one arbitrary identity into the cross-tab `token` slot (StorageService mirrors it into
 * the cross-tab localStorage whitelist) — a multi-session user could be silently bound to, and stuck
 * across tabs on, the wrong session. Requiring exactly one bucket means we only ever persist when
 * there is no guess to make; with several, the caller falls through to the login screen instead
 * (XIN-392 P1-2).
 */
export function findUniqueStoredSession(store: StorageLike): RecoveredSession | null {
  const sessions = findStoredSessions(store)
  return sessions.length === 1 ? sessions[0] : null
}

/**
 * The subset of `WKApp.loginInfo` the adoption path writes. Kept structural (not the concrete
 * `LoginInfo` class from `@octo/base`) so this stays a pure, host-free unit.
 */
export interface SessionSink {
  token?: string
  uid?: string
  name?: string
  /** Persist the current fields to storage (sid-keyed, exactly as `LoginInfo.save()` does). */
  save: () => void
}

/** Options controlling how a recovered session is adopted. */
export interface AdoptOptions {
  /**
   * Persist the adopted session back to the current (sid-keyed) bucket via `sink.save()`.
   *
   * When true (the standalone `/d/:docId` branch): a later no-sid navigation — the standalone page's
   * Back → /docs full reload — reads the empty-sid slot; persisting into it there keeps an
   * already-signed-in user logged in across that reload (XIN-390 Back-keeps-login). But `save()` also
   * mirrors token/uid/name into the cross-tab localStorage whitelist (StorageService), so it is only
   * safe when the stored session is UNAMBIGUOUS. Persisting therefore requires EXACTLY ONE stored
   * session (findUniqueStoredSession); with zero or several this is a no-op (returns false) and the
   * visitor falls through to login rather than having a guessed identity pinned across tabs (XIN-392).
   *
   * When false (the DEFAULT — the invite-landing branch): adopt the first stored session IN MEMORY
   * ONLY and never call `save()`. This is the invite branch's original, pre-#512 recovery behavior;
   * it must not start persisting just because it now shares this helper.
   */
  persist?: boolean
}

/**
 * Adopt a stored octo session into `sink` for a clean deep-link cold-load.
 *
 * By default (invite branch) this writes only the in-memory `token`/`uid`/`name` fields, adopting the
 * FIRST stored session and persisting nothing — the pre-#512 invite semantics. Pass `{ persist: true }`
 * (standalone branch) to also `sink.save()` the adopted session so a subsequent no-sid reload stays
 * authenticated (XIN-390) — but persistence only happens when EXACTLY ONE session is stored, so a
 * multi-session user's identity is never guessed-and-pinned across tabs (XIN-392).
 *
 * No-op (returns false) when a token is already loaded, when none is stored, or when persistence is
 * requested but the stored session is ambiguous — a genuinely anonymous (or ambiguous) visitor is
 * left untouched to fall through to the login screen.
 */
export function adoptStoredSession(
  sink: SessionSink,
  store: StorageLike,
  options: AdoptOptions = {},
): boolean {
  if (sink.token) return false
  const { persist = false } = options
  // Persisting demands an unambiguous session (never pin a guess cross-tab); in-memory-only
  // recovery keeps the original "first wins" behavior.
  const session = persist ? findUniqueStoredSession(store) : findStoredSession(store)
  if (!session) return false
  sink.token = session.token
  sink.uid = session.uid
  sink.name = session.name
  if (persist) {
    // Persist to the current sid bucket so a later same-tab navigation that also lacks `?sid=`
    // (e.g. Back → /docs) reloads this session rather than an empty one.
    sink.save()
  }
  return true
}
