import { describe, it, expect } from 'vitest'
import {
  findStoredSession,
  findStoredSessions,
  findUniqueStoredSession,
  findSidForToken,
  adoptStoredSession,
  sidsForToken,
  clearSessionsWithToken,
  type StorageLike,
  type WritableStorageLike,
  type SessionSink,
} from '../recoverSession'

/** Minimal in-memory Storage-like bag (insertion-ordered) for the scan. */
function makeStorage(entries: Record<string, string>): StorageLike {
  const keys = Object.keys(entries)
  return {
    length: keys.length,
    key: (i: number) => keys[i] ?? null,
    getItem: (k: string) => (k in entries ? entries[k] : null),
  }
}

describe('findStoredSession — clean cold-load session recovery (AC-3)', () => {
  it('recovers a sid-keyed session opened in a fresh tab with no ?sid= in the URL', () => {
    // The signed-in user logged in under sid "abc"; a shared /d/:docId link opened in a new tab
    // has no ?sid=, so the sid-keyed load() found nothing. The scan adopts the stored session.
    const storage = makeStorage({
      tokenabc: 'octo-session-xyz',
      uidabc: 'u_42',
      nameabc: 'Ada',
      currentSpaceId: 's_1',
    })
    expect(findStoredSession(storage)).toEqual({
      token: 'octo-session-xyz',
      uid: 'u_42',
      name: 'Ada',
    })
  })

  it('recovers the empty-sid session stored under a plain-sid bucket (token"")', () => {
    // A login with no ?sid= persists under token"" → key is exactly "token", which load() already
    // handled; so it is intentionally skipped. A user with only that key is considered loaded by
    // load(), not recovered here → null.
    const storage = makeStorage({ token: 'bare', uid: 'u_bare' })
    expect(findStoredSession(storage)).toBeNull()
  })

  it('returns null for a genuinely anonymous visitor (no token bucket) → login redirect (AC-11)', () => {
    const storage = makeStorage({ currentSpaceId: 's_1', locale: 'en-US' })
    expect(findStoredSession(storage)).toBeNull()
  })

  it('never mistakes the tokenCallback config key for a session', () => {
    const storage = makeStorage({ tokenCallback: 'not-a-token' })
    expect(findStoredSession(storage)).toBeNull()
  })

  it('tolerates a token bucket missing its sibling uid/name', () => {
    const storage = makeStorage({ tokenS9: 'tok' })
    expect(findStoredSession(storage)).toEqual({ token: 'tok', uid: '', name: '' })
  })

  it('skips an empty token value and keeps scanning for a real one', () => {
    const storage = makeStorage({
      tokenEmpty: '',
      tokenReal: 'real-tok',
      uidReal: 'u_real',
      nameReal: 'Real',
    })
    expect(findStoredSession(storage)).toEqual({
      token: 'real-tok',
      uid: 'u_real',
      name: 'Real',
    })
  })
})

/**
 * Faithful stand-in for `@octo/base`'s `LoginInfo`, reduced to the sid-keyed session slots this
 * flow touches. It reproduces the real class's storage contract exactly:
 *   - save()  writes `token{sid}` / `uid{sid}` / `name{sid}` for the CURRENT sid
 *   - load()  reads those same sid-keyed keys back
 *   - getSID() returns whatever `?sid=` the current URL carries ('' when none)
 * so the recover → Back → reload round trip can be exercised without booting the real host. The
 * only behaviour under test is `adoptStoredSession`; this double is just the persistence surface.
 */
class FakeLoginInfo implements SessionSink {
  token?: string
  uid?: string
  name?: string
  constructor(
    private store: Map<string, string>,
    /** Mutable to model navigating between a `?sid=`-bearing URL and a clean one. */
    public sid: string,
  ) {}
  save(): void {
    this.store.set('token' + this.sid, this.token ?? '')
    this.store.set('uid' + this.sid, this.uid ?? '')
    this.store.set('name' + this.sid, this.name ?? '')
  }
  load(): void {
    this.token = this.store.get('token' + this.sid) || ''
    this.uid = this.store.get('uid' + this.sid) || ''
    this.name = this.store.get('name' + this.sid) || ''
  }
}

/** A real Storage-like view over a Map so the same backing store drives both scan and save/load. */
function storageOver(store: Map<string, string>): StorageLike {
  return {
    get length() {
      return store.size
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
  }
}

/** A writable Storage-like view over a Map (adds removeItem) for the expired-session clear. */
function writableStorageOver(store: Map<string, string>): WritableStorageLike {
  return {
    get length() {
      return store.size
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    removeItem: (k: string) => {
      store.delete(k)
    },
  }
}

describe('adoptStoredSession — Back keeps an already-signed-in user logged in (standalone AC)', () => {
  it('persists the recovered session so a subsequent no-sid load stays authenticated', () => {
    // A user signed in under sid "abc"; their session lives in the sid-keyed bucket. They open a
    // shared /d/:docId link in a fresh tab with NO ?sid=, so the clean-tab login slot (empty sid)
    // is empty.
    const store = new Map<string, string>([
      ['tokenabc', 'octo-session-xyz'],
      ['uidabc', 'u_42'],
      ['nameabc', 'Ada'],
    ])

    // Cold-load of /d/:docId — the URL has no ?sid=, so getSID() === '' and load() reads nothing.
    const onDeepLink = new FakeLoginInfo(store, '')
    onDeepLink.load()
    expect(onDeepLink.token).toBe('') // sid-keyed load misses the clean tab → would 401 without recovery

    const adopted = adoptStoredSession(onDeepLink, storageOver(store), { persist: true })
    expect(adopted).toBe(true)
    expect(onDeepLink.token).toBe('octo-session-xyz')

    // Back → /docs is also a no-sid navigation → a full reload boots a fresh login-info that
    // load()s the EMPTY-sid slot. Because adoptStoredSession persisted into that slot, the reloaded
    // session is authenticated and the user is NOT bounced to the login wall.
    const afterBackReload = new FakeLoginInfo(store, '')
    afterBackReload.load()
    expect(afterBackReload.token).toBe('octo-session-xyz')
    expect(afterBackReload.uid).toBe('u_42')
    expect(afterBackReload.name).toBe('Ada')
  })

  it('RED without the persist: recovering in memory only leaves the Back reload logged out', () => {
    // Documents the pre-fix behaviour: adopting the session in memory but NOT saving it leaves the
    // empty-sid slot empty, so the Back → /docs reload reads nothing and bounces to login.
    const store = new Map<string, string>([
      ['tokenabc', 'octo-session-xyz'],
      ['uidabc', 'u_42'],
      ['nameabc', 'Ada'],
    ])
    const onDeepLink = new FakeLoginInfo(store, '')
    const session = findStoredSession(storageOver(store))!
    onDeepLink.token = session.token // in-memory only — the old code path, no save()
    onDeepLink.uid = session.uid
    onDeepLink.name = session.name

    const afterBackReload = new FakeLoginInfo(store, '')
    afterBackReload.load()
    expect(afterBackReload.token).toBe('') // empty-sid slot never written → logged out on reload
  })

  it('is a no-op when a token is already loaded (does not clobber the active session)', () => {
    const store = new Map<string, string>([['tokenabc', 'other']])
    const info = new FakeLoginInfo(store, '')
    info.token = 'already-here'
    expect(adoptStoredSession(info, storageOver(store))).toBe(false)
    expect(info.token).toBe('already-here')
  })

  it('is a no-op for a genuinely anonymous visitor (no stored session)', () => {
    const store = new Map<string, string>([['currentSpaceId', 's_1']])
    const info = new FakeLoginInfo(store, '')
    expect(adoptStoredSession(info, storageOver(store))).toBe(false)
    expect(info.token).toBeUndefined()
  })
})

describe('findStoredSessions / findUniqueStoredSession — ambiguity gate (XIN-392 P1-2)', () => {
  it('collects every valid token bucket, skipping the bare/callback/empty keys', () => {
    const storage = makeStorage({
      token: 'bare', // empty-sid slot load() already read → skipped
      tokenCallback: 'cfg', // unrelated config key → skipped
      tokenA: 'tok-a',
      uidA: 'u_a',
      nameA: 'Alice',
      tokenEmpty: '', // empty value → skipped
      tokenB: 'tok-b',
      uidB: 'u_b',
      nameB: 'Bob',
    })
    expect(findStoredSessions(storage)).toEqual([
      { token: 'tok-a', uid: 'u_a', name: 'Alice' },
      { token: 'tok-b', uid: 'u_b', name: 'Bob' },
    ])
  })

  it('returns the single session when storage holds exactly one', () => {
    const storage = makeStorage({ tokenabc: 'only', uidabc: 'u_1', nameabc: 'Solo' })
    expect(findUniqueStoredSession(storage)).toEqual({ token: 'only', uid: 'u_1', name: 'Solo' })
  })

  it('returns null when MORE THAN ONE session bucket is stored (no first-wins guess)', () => {
    const storage = makeStorage({
      tokenA: 'tok-a',
      uidA: 'u_a',
      tokenB: 'tok-b',
      uidB: 'u_b',
    })
    // findStoredSession still returns the first (invite semantics), but the unique gate refuses.
    expect(findStoredSession(storage)).toEqual({ token: 'tok-a', uid: 'u_a', name: '' })
    expect(findUniqueStoredSession(storage)).toBeNull()
  })

  it('returns null when nothing is stored', () => {
    expect(findUniqueStoredSession(makeStorage({ currentSpaceId: 's_1' }))).toBeNull()
  })
})

describe('adoptStoredSession — persist gating never pins a guessed identity (XIN-392 P1-2)', () => {
  it('with multiple sessions and persist:true, does NOT adopt or persist any identity', () => {
    // Two signed-in sessions (two token{sid} buckets, different uids). A standalone deep-link with no
    // ?sid= must not silently pick the first and pin it into the cross-tab empty-sid slot.
    const store = new Map<string, string>([
      ['tokenA', 'tok-a'],
      ['uidA', 'u_a'],
      ['nameA', 'Alice'],
      ['tokenB', 'tok-b'],
      ['uidB', 'u_b'],
      ['nameB', 'Bob'],
    ])
    const onDeepLink = new FakeLoginInfo(store, '')
    onDeepLink.load()

    expect(adoptStoredSession(onDeepLink, storageOver(store), { persist: true })).toBe(false)
    expect(onDeepLink.token).toBe('') // in-memory identity untouched → falls through to login
    // Nothing pinned into the empty-sid slot, so a Back reload does NOT resurrect a guessed identity.
    const afterBackReload = new FakeLoginInfo(store, '')
    afterBackReload.load()
    expect(afterBackReload.token).toBe('')
    // The original per-sid buckets are left exactly as they were.
    expect(store.get('tokenA')).toBe('tok-a')
    expect(store.get('tokenB')).toBe('tok-b')
  })

  it('with a single session and persist:true, adopts AND persists (XIN-390 Back-keeps-login)', () => {
    const store = new Map<string, string>([
      ['tokenabc', 'octo-session-xyz'],
      ['uidabc', 'u_42'],
      ['nameabc', 'Ada'],
    ])
    const onDeepLink = new FakeLoginInfo(store, '')
    onDeepLink.load()
    expect(adoptStoredSession(onDeepLink, storageOver(store), { persist: true })).toBe(true)
    const afterBackReload = new FakeLoginInfo(store, '')
    afterBackReload.load()
    expect(afterBackReload.token).toBe('octo-session-xyz')
  })
})

describe('adoptStoredSession — invite branch keeps its original non-persistent semantics (XIN-392 P1-2)', () => {
  it('persist:false (default) adopts the first session in memory only and never writes storage', () => {
    // The invite-landing branch has always adopted the first stored session in memory WITHOUT
    // persisting. Sharing adoptStoredSession must not change that — the empty-sid slot stays empty.
    const store = new Map<string, string>([
      ['tokenabc', 'octo-session-xyz'],
      ['uidabc', 'u_42'],
      ['nameabc', 'Ada'],
    ])
    const invite = new FakeLoginInfo(store, '')
    invite.load()

    expect(adoptStoredSession(invite, storageOver(store))).toBe(true)
    expect(invite.token).toBe('octo-session-xyz') // in-memory recovery for the current tab

    // No save(): the empty-sid slot is never written, so a later no-sid reload is NOT persisted.
    const afterReload = new FakeLoginInfo(store, '')
    afterReload.load()
    expect(afterReload.token).toBe('') // invite never pins the recovered session
  })

  it('persist:false still recovers the FIRST of several sessions (unchanged multi-session behavior)', () => {
    const store = new Map<string, string>([
      ['tokenA', 'tok-a'],
      ['uidA', 'u_a'],
      ['tokenB', 'tok-b'],
      ['uidB', 'u_b'],
    ])
    const invite = new FakeLoginInfo(store, '')
    invite.load()
    expect(adoptStoredSession(invite, storageOver(store))).toBe(true)
    expect(invite.token).toBe('tok-a') // first-wins, in memory, exactly as before
    // …and it is still not persisted.
    expect(new Map(store).get('token')).toBeUndefined()
  })
})

describe('findSidForToken — sid of the CURRENT session bucket, never a guess (XIN-398)', () => {
  it('returns the sid whose token bucket holds the current token, among several sessions', () => {
    // A multi-session device: findUniqueStoredSession would refuse to pick (ambiguous), but the
    // current identity is KNOWN by its token — so we can name its own sid without guessing.
    const store = storageOver(
      new Map([
        ['tokenA', 'tok-a'],
        ['uidA', 'u_a'],
        ['tokenB', 'tok-b'],
        ['uidB', 'u_b'],
        ['tokenfresh6', 'tok-current'],
        ['uidfresh6', 'u_cur'],
      ]),
    )
    expect(findSidForToken(store, 'tok-current')).toBe('fresh6')
    expect(findSidForToken(store, 'tok-a')).toBe('A')
  })

  it('returns null when the current session lives only in the empty-sid (bare token) bucket', () => {
    // A no-sid reload already reads the bare `token` bucket, so no `?sid=` needs to be carried and
    // the bare key is intentionally not treated as a sid-keyed bucket.
    const store = storageOver(new Map([['token', 'bare-tok'], ['uid', 'u_bare']]))
    expect(findSidForToken(store, 'bare-tok')).toBeNull()
  })

  it('returns null for an empty token, an unmatched token, and never matches tokenCallback', () => {
    const store = storageOver(
      new Map([['tokenX', 'tok-x'], ['tokenCallback', 'tok-current']]),
    )
    expect(findSidForToken(store, '')).toBeNull()
    expect(findSidForToken(store, 'no-such-token')).toBeNull()
    // The config key `tokenCallback` must never be reported as a session bucket even if its value
    // happens to equal the current token.
    expect(findSidForToken(store, 'tok-current')).toBeNull()
  })
})

describe('multi-session deep-link login round trip — the /d/:docId loop is broken by carrying sid (XIN-398)', () => {
  // Byte-level regression the reviewers reproduced on head ce328eea: an anonymous multi-session
  // user opens a shared /d/:docId, signs in (the fresh session lands in its own `token{sid}`
  // bucket), and goMain reloads /d/:docId. Modeling the reload's sid-keyed load() + the strict
  // XIN-392 P1-2 recovery shows the fix flips this from a login loop to a resolved session.
  function deviceWithThreeSessions() {
    // Two pre-existing sessions on the device + the just-authenticated one.
    return new Map<string, string>([
      ['tokenA', 'tok-a'],
      ['uidA', 'u_a'],
      ['tokenB', 'tok-b'],
      ['uidB', 'u_b'],
      ['tokenfresh6', 'tok-current'],
      ['uidfresh6', 'u_cur'],
    ])
  }

  it('OLD behavior (no sid carried) loops: reload misses + recovery refuses to guess → stuck', () => {
    const store = deviceWithThreeSessions()
    // goMain reloaded /d/:docId with NO sid: the reloaded page's sid-keyed load() reads the
    // empty-sid bucket, which is empty.
    const reloaded = new FakeLoginInfo(store, '')
    reloaded.load()
    expect(reloaded.token).toBe('') // load() misses — the fresh session lives under `tokenfresh6`

    // The standalone branch then tries recovery with persist:true. With three sessions stored the
    // ambiguity gate refuses to adopt one (never pins a guessed identity), so the visitor falls
    // through to the login screen again → the loop.
    const adopted = adoptStoredSession(reloaded, storageOver(store), { persist: true })
    expect(adopted).toBe(false)
    expect(reloaded.token).toBe('') // still unauthenticated → back to login
  })

  it('FIX (carry the current session sid) resolves: reload hits the right bucket directly', () => {
    const store = deviceWithThreeSessions()
    // goMain looks up the current (in-memory) token's own bucket sid and hands it to the reload.
    const currentToken = 'tok-current'
    const sid = findSidForToken(storageOver(store), currentToken)
    expect(sid).toBe('fresh6')

    // The reloaded /d/:docId?sid=fresh6 now runs a sid-keyed load() against that exact bucket…
    const reloaded = new FakeLoginInfo(store, sid ?? '')
    reloaded.load()
    expect(reloaded.token).toBe('tok-current') // hit — authenticated, no recovery, no loop
    expect(reloaded.uid).toBe('u_cur')
  })
})

describe('sidsForToken — buckets holding the current (expired) token, matched by value (XIN-408)', () => {
  it('lists every sid whose token bucket holds the given token, empty-sid reported as ""', () => {
    // The cold-load recover-then-persist case: the same expired token lives in the empty-sid bucket
    // AND its original sid-keyed bucket. Both must be named so a clear tears down both copies.
    const store = storageOver(
      new Map([
        ['token', 'expired-tok'],
        ['uid', 'u_e'],
        ['tokenabc', 'expired-tok'],
        ['uidabc', 'u_e'],
        ['tokenxyz', 'other-valid-tok'],
        ['uidxyz', 'u_v'],
      ]),
    )
    expect(sidsForToken(store, 'expired-tok').sort()).toEqual(['', 'abc'])
    // A different, still-valid session (different token value) is never listed.
    expect(sidsForToken(store, 'other-valid-tok')).toEqual(['xyz'])
  })

  it('matches nothing for an empty token and never treats tokenCallback as a bucket', () => {
    const store = storageOver(new Map([['tokenCallback', 'expired-tok'], ['tokenA', 'expired-tok']]))
    expect(sidsForToken(store, '')).toEqual([])
    expect(sidsForToken(store, 'expired-tok')).toEqual(['A']) // tokenCallback excluded
  })
})

describe('clearSessionsWithToken — clears only the expired session, never a valid one (XIN-408)', () => {
  it('removes every bucket holding the expired token across both stores, leaving valid sessions intact', () => {
    // Model the cross-tab mirror: cross-tab keys live in BOTH sessionStorage and localStorage.
    const session = new Map<string, string>([
      ['token', 'expired-tok'], // empty-sid mirror written by the recover-then-persist path
      ['uid', 'u_e'],
      ['name', 'Expired'],
      ['tokenabc', 'expired-tok'], // the original sid-keyed bucket the token was recovered from
      ['uidabc', 'u_e'],
      ['nameabc', 'Expired'],
      ['tokenGOOD', 'valid-tok'], // a DIFFERENT, still-valid session — must survive
      ['uidGOOD', 'u_v'],
      ['nameGOOD', 'Valid'],
    ])
    const local = new Map(session) // same key set mirrored across tabs

    clearSessionsWithToken('expired-tok', writableStorageOver(session), writableStorageOver(local))

    for (const store of [session, local]) {
      // Every copy of the expired session is gone…
      expect(store.get('token')).toBeUndefined()
      expect(store.get('tokenabc')).toBeUndefined()
      expect(store.get('uidabc')).toBeUndefined()
      expect(store.get('nameabc')).toBeUndefined()
      // …but the unrelated valid session is untouched.
      expect(store.get('tokenGOOD')).toBe('valid-tok')
      expect(store.get('uidGOOD')).toBe('u_v')
    }
  })

  it('is a no-op for an empty token (nothing to match)', () => {
    const store = new Map<string, string>([['tokenA', 'tok-a'], ['uidA', 'u_a']])
    clearSessionsWithToken('', writableStorageOver(store))
    expect(store.get('tokenA')).toBe('tok-a')
  })
})

describe('expired-token deep-link login round trip — the /d/:docId dead-end is cleared (XIN-408)', () => {
  // Byte-trace on head de0b8d82: a signed-in user whose session has EXPIRED opens a shared
  // /d/:docId in a fresh tab (no ?sid=). Layout recovers the sole stored session from `token{sid'}`,
  // persists it into the empty-sid bucket, and mounts the page with a non-empty-but-stale token. The
  // preflight 401s → the OLD code rendered a terminal with no login entry, and clearing only the
  // current (empty) sid left `token{sid'}` behind, so a reload just re-recovered the dead session:
  // a dead-end / re-mount loop. Modeling the storage shows the fix (clear by token value) breaks it.
  function coldLoadWithRecoveredExpiredSession() {
    // Post-recover-then-persist state: the expired token sits in BOTH the empty-sid bucket and the
    // original sid-keyed bucket it was recovered from.
    return new Map<string, string>([
      ['token', 'expired-tok'],
      ['uid', 'u_e'],
      ['name', 'Expired'],
      ['tokenabc', 'expired-tok'],
      ['uidabc', 'u_e'],
      ['nameabc', 'Expired'],
    ])
  }

  it('OLD behavior (clear only the current empty-sid bucket) loops: the sid-keyed copy is re-recovered', () => {
    const store = coldLoadWithRecoveredExpiredSession()
    // The pre-fix clear was sid-scoped to the URL (empty sid here): only the empty-sid bucket goes.
    for (const prefix of ['token', 'uid', 'name']) store.delete(prefix + '')
    // A no-sid reload's recovery scans localStorage — and still finds the unique sid-keyed bucket…
    expect(findUniqueStoredSession(storageOver(store))).toEqual({
      token: 'expired-tok',
      uid: 'u_e',
      name: 'Expired',
    })
    // …so it re-adopts the SAME expired session → the page re-mounts → 401 again → the dead-end loops.
  })

  it('FIX (clear by token value across stores) resolves: no bucket survives → falls through to login', () => {
    const store = coldLoadWithRecoveredExpiredSession()
    clearSessionsWithToken('expired-tok', writableStorageOver(store))
    // Nothing recoverable remains, so the reloaded standalone branch sees `!token` and renders the
    // real login screen. The stashed return target then bounces the user back to the doc post-login.
    expect(findUniqueStoredSession(storageOver(store))).toBeNull()
    expect(findStoredSession(storageOver(store))).toBeNull()
    const reloaded = new FakeLoginInfo(store, '')
    reloaded.load()
    expect(reloaded.token).toBe('') // → login screen, not the dead terminal
  })

  it('a multi-session user keeps their OTHER valid session when the expired one is cleared', () => {
    // Expired session in its own bucket + a second, still-valid session. Clearing the expired token
    // must not disturb the valid one (XIN-392: never touch a valid session).
    const store = new Map<string, string>([
      ['tokenexp', 'expired-tok'],
      ['uidexp', 'u_e'],
      ['tokenok', 'valid-tok'],
      ['uidok', 'u_v'],
      ['nameok', 'Valid'],
    ])
    clearSessionsWithToken('expired-tok', writableStorageOver(store))
    expect(findSidForToken(storageOver(store), 'valid-tok')).toBe('ok')
    const stillThere = new FakeLoginInfo(store, 'ok')
    stillThere.load()
    expect(stillThere.token).toBe('valid-tok')
    expect(stillThere.uid).toBe('u_v')
  })
})
