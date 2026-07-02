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
export function findStoredSession(storage: StorageLike): RecoveredSession | null {
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key && key.startsWith('token') && key !== 'token' && key !== 'tokenCallback') {
      const val = storage.getItem(key)
      if (val) {
        const sid = key.substring(5) // "token".length === 5
        return {
          token: val,
          uid: storage.getItem('uid' + sid) || '',
          name: storage.getItem('name' + sid) || '',
        }
      }
    }
  }
  return null
}
