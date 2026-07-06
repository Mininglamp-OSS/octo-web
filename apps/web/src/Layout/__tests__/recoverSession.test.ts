import { describe, it, expect } from 'vitest'
import {
  findStoredSession,
  findStoredSessions,
  findUniqueStoredSession,
  adoptStoredSession,
  type StorageLike,
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
