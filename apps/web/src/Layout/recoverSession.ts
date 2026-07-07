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

/** A Storage-like bag that also supports removal (for clearing an expired session). */
export type WritableStorageLike = StorageLike & Pick<Storage, 'removeItem'>

/**
 * Session key prefixes a single login bucket occupies, keyed `<prefix><sid>`. This is the union of
 * the cross-tab whitelist StorageService mirrors into localStorage and the extra keys
 * `LoginInfo.logout()` clears, so removing all of them for a given sid tears down the whole bucket —
 * exactly the set logout() would clear, but for a sid we name explicitly rather than the URL's.
 */
const SESSION_KEY_PREFIXES = [
  'token',
  'uid',
  'short_no',
  'app_id',
  'name',
  'role',
  'is_work',
  'sex',
  'login_provider',
  'realname_verified',
  'real_name',
  'realname_verified_at',
] as const

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
 * The FIRST stored session when storage holds SEVERAL buckets that all belong to the SAME identity
 * (same non-empty uid), or null otherwise (zero buckets, one bucket, or buckets spanning >1 uid).
 *
 * The multi-session / multi-space real-device case (XIN-519 blocker 2, boss decision B): one person
 * signed in more than once — e.g. across two spaces — leaves several `token{sid}` buckets, all with
 * the SAME uid. findUniqueStoredSession refuses these (length > 1), so a sid-less `/d/:docId` cold
 * load recovered nothing and bounced the user to login even though every bucket is the same person.
 * When every bucket shares one uid there is no IDENTITY to guess between, so returning the first is
 * safe. Buckets spanning different uids stay genuinely ambiguous and return null — the caller falls
 * through to login rather than picking a person (the XIN-392 P1-2 guarantee is untouched).
 *
 * Deliberately NOT a by-`sp` selection: token buckets store no space (see SESSION_KEY_PREFIXES) and
 * same-identity buckets are interchangeable anyway, so `sp` cannot and need not pick among them — it
 * stays the StandaloneDocPage preflight's space-addressing param only. The caller adopts this result
 * IN MEMORY ONLY (never persists it) so a multi-bucket pick is never mirrored into the cross-tab slot.
 */
export function findSameIdentityStoredSession(store: StorageLike): RecoveredSession | null {
  const sessions = findStoredSessions(store)
  if (sessions.length <= 1) return null
  const uid = sessions[0].uid
  if (!uid) return null
  return sessions.every((s) => s.uid === uid) ? sessions[0] : null
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
   * safe when the stored session is UNAMBIGUOUS. Persistence therefore happens ONLY when EXACTLY ONE
   * session is stored (findUniqueStoredSession). With several buckets that all share one identity, the
   * session is adopted IN MEMORY ONLY (never persisted) — see the standalone branch below; with
   * buckets spanning different identities, this is a no-op (returns false) and the visitor falls
   * through to login rather than having a guessed identity pinned across tabs (XIN-392).
   *
   * When false (the DEFAULT — the invite-landing branch): adopt the first stored session IN MEMORY
   * ONLY and never call `save()`. This is the invite branch's original, pre-#512 recovery behavior;
   * it must not start persisting just because it now shares this helper.
   */
  persist?: boolean
}

/** Copy a recovered session's fields into `sink` (in-memory adoption; no persistence). */
function applyRecoveredSession(sink: SessionSink, session: RecoveredSession): void {
  sink.token = session.token
  sink.uid = session.uid
  sink.name = session.name
}

/**
 * Adopt a stored octo session into `sink` for a clean deep-link cold-load.
 *
 * By default (invite branch) this writes only the in-memory `token`/`uid`/`name` fields, adopting the
 * FIRST stored session and persisting nothing — the pre-#512 invite semantics.
 *
 * Pass `{ persist: true }` (standalone `/d/:docId` branch) to recover a signed-in user's session on a
 * sid-less cold load. Bucket selection there is tiered so a multi-session user is neither bounced to
 * login nor pinned to a guessed identity (XIN-392 P1-2 / XIN-519 blocker 2, boss decision B):
 *   - exactly one stored bucket → adopt AND `sink.save()` it, so a later no-sid Back → /docs reload
 *     stays authenticated (XIN-390 Back-keeps-login);
 *   - several buckets, all the SAME identity (same non-empty uid — one person signed in across e.g.
 *     two spaces) → adopt the first IN MEMORY ONLY (no `save()`), so the sid-less link opens the doc
 *     instead of bouncing to login, without mirroring a multi-bucket pick into the cross-tab slot;
 *   - several buckets spanning DIFFERENT identities → no-op (login), never guessing a person.
 *
 * `sp` is intentionally not consulted here: token buckets carry no space, and same-identity buckets
 * are interchangeable, so `sp` cannot pick among them — it stays the preflight's addressing param.
 *
 * No-op (returns false) when a token is already loaded, when none is stored, or when persistence is
 * requested but the stored buckets span more than one identity — the visitor falls through to login.
 */
export function adoptStoredSession(
  sink: SessionSink,
  store: StorageLike,
  options: AdoptOptions = {},
): boolean {
  if (sink.token) return false
  const { persist = false } = options
  if (!persist) {
    // Invite branch: first-wins, in-memory only (pre-#512 semantics).
    const session = findStoredSession(store)
    if (!session) return false
    applyRecoveredSession(sink, session)
    return true
  }
  // Standalone branch. Persisting mirrors the identity into the cross-tab whitelist, so we persist
  // ONLY the unambiguous single-bucket case; a same-identity multi-bucket set is recovered in memory.
  const unique = findUniqueStoredSession(store)
  if (unique) {
    applyRecoveredSession(sink, unique)
    // Persist to the current sid bucket so a later same-tab navigation that also lacks `?sid=`
    // (e.g. Back → /docs) reloads this session rather than an empty one.
    sink.save()
    return true
  }
  const sameIdentity = findSameIdentityStoredSession(store)
  if (sameIdentity) {
    // Several buckets, one person: adopt the first IN MEMORY ONLY. No sink.save() — never pin a
    // multi-bucket pick into the cross-tab empty-sid slot (XIN-392). A Back → /docs reload re-runs
    // this same same-identity recovery, so the user stays authenticated across it without a pin.
    applyRecoveredSession(sink, sameIdentity)
    return true
  }
  return false
}

/**
 * The sids of every stored bucket whose `token{sid}` value equals `token`. The bare `token` bucket
 * (empty sid) is reported as ''. Matching by VALUE, not by sid, is the whole point: it names ONLY
 * the session that carries this exact token, so a caller clearing an expired session never touches a
 * DIFFERENT, still-valid session (whose token differs). `tokenCallback` (a config key) is never
 * treated as a session bucket, and an empty `token` argument matches nothing.
 *
 * Used by clearSessionsWithToken to tear down an expired standalone session across BOTH the empty-sid
 * bucket and any sid-keyed bucket that holds the same dead token (the cold-load recover-then-persist
 * case mirrors it into two places), so a post-clear reload's recovery can't resurrect it (XIN-408).
 */
export function sidsForToken(store: StorageLike, token: string): string[] {
  const sids: string[] = []
  if (!token) return sids
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (key && key.startsWith('token') && key !== 'tokenCallback' && store.getItem(key) === token) {
      sids.push(key === 'token' ? '' : key.substring(5)) // "token".length === 5
    }
  }
  return sids
}

/**
 * Remove every stored session whose token value equals `token` from the given store(s), clearing all
 * of that bucket's sid-keyed sibling keys (uid/name/…). Pass BOTH sessionStorage and localStorage so
 * the cross-tab mirror StorageService writes is fully torn down — otherwise a reload's
 * StorageService-backed `load()` (sessionStorage first, then localStorage) or the localStorage
 * recovery scan could still find the dead session and re-adopt it, looping the user back to the
 * expired terminal (XIN-408).
 *
 * Because buckets are matched by the (expired) token's VALUE, a different valid session — different
 * token — is never cleared. This is the "只清当前过期 session，别误清有效 session" guarantee. No-op for
 * an empty token.
 */
export function clearSessionsWithToken(token: string, ...stores: WritableStorageLike[]): void {
  if (!token) return
  const sids = new Set<string>()
  for (const store of stores) {
    for (const sid of sidsForToken(store, token)) sids.add(sid)
  }
  for (const store of stores) {
    for (const sid of sids) {
      for (const prefix of SESSION_KEY_PREFIXES) store.removeItem(prefix + sid)
    }
  }
}
