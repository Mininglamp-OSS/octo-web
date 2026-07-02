import { describe, it, expect } from 'vitest'
import { findStoredSession, type StorageLike } from '../recoverSession'

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
