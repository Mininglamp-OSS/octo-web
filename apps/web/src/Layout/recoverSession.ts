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
 * Find the first stored octo session in a Storage-like bag, or null when none is present.
 *
 * Session buckets are keyed `token{sid}` (with sibling `uid{sid}` / `name{sid}`). The bare
 * `token` key is skipped — it is the empty-sid slot `loginInfo.load()` already read — as is the
 * unrelated `tokenCallback` config key. Returns the token plus its sibling uid/name so the caller
 * can populate `loginInfo` exactly as a normal load would.
 */
export function findStoredSession(store: StorageLike): RecoveredSession | null {
  // NB: the parameter is `store`, not `storage`. Under apps/extension's WXT build, a bare
  // `storage` identifier is auto-imported from `wxt/utils/storage`, which Rolldown then fails to
  // resolve in this shared web file (`pnpm build` exit 1). Keep the name off that registered token.
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (key && key.startsWith('token') && key !== 'token' && key !== 'tokenCallback') {
      const val = store.getItem(key)
      if (val) {
        const sid = key.substring(5) // "token".length === 5
        return {
          token: val,
          uid: store.getItem('uid' + sid) || '',
          name: store.getItem('name' + sid) || '',
        }
      }
    }
  }
  return null
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

/**
 * Adopt a stored octo session into `sink` for a clean deep-link cold-load, then PERSIST it.
 *
 * Recovery alone (writing the in-memory `token`/`uid`/`name` fields) is not enough: the sid-keyed
 * bucket the session came from is `token{sid}`, but a clean deep-link (`/d/:docId` with no `?sid=`)
 * and the `/docs` list it Backs into both read the empty-sid bucket (`token`). So after the user
 * hits Back, the full-reload `loginInfo.load()` reads the empty-sid slot, finds nothing, and bounces
 * an already-signed-in user to the login wall. Calling `sink.save()` here writes the adopted session
 * into the *current* (empty-sid, since the URL has no `?sid=`) bucket, so the subsequent no-sid
 * navigation reloads an authenticated session instead. Without this save the Back-keeps-login AC
 * fails; with it, the session survives the reload.
 *
 * No-op (returns false) when a token is already loaded or none is stored — a genuinely anonymous
 * visitor is left untouched to fall through to the login screen.
 */
export function adoptStoredSession(sink: SessionSink, store: StorageLike): boolean {
  if (sink.token) return false
  const session = findStoredSession(store)
  if (!session) return false
  sink.token = session.token
  sink.uid = session.uid
  sink.name = session.name
  // Persist to the current sid bucket so a later same-tab navigation that also lacks `?sid=`
  // (e.g. Back → /docs) reloads this session rather than an empty one.
  sink.save()
  return true
}
