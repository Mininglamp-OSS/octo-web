import { afterEach, describe, expect, it } from 'vitest'
import {
  clearPendingOidcBind,
  consumePendingBindIfMatches,
  getPendingOidcBind,
  hasValidPendingBind,
  isPendingBindExpired,
  savePendingOidcBind,
} from '../pendingBind'
import { OIDC_AUTHCODE_TTL_MS } from '../types'

describe('pendingOidcBind', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('round-trips a marker through localStorage', () => {
    savePendingOidcBind({ providerId: 'aegis', authcode: 'auth-code', savedAt: 1000 })
    expect(getPendingOidcBind()).toEqual({ providerId: 'aegis', authcode: 'auth-code', savedAt: 1000 })
  })

  it('returns null when nothing is saved', () => {
    expect(getPendingOidcBind()).toBeNull()
  })

  it('returns null when the stored value is not valid JSON', () => {
    localStorage.setItem('pending_oidc_bind', 'not-json')
    expect(getPendingOidcBind()).toBeNull()
  })

  it('returns null when required fields are missing', () => {
    localStorage.setItem('pending_oidc_bind', JSON.stringify({ providerId: '', authcode: 'a', savedAt: 1 }))
    expect(getPendingOidcBind()).toBeNull()
    localStorage.setItem('pending_oidc_bind', JSON.stringify({ providerId: 'a', authcode: 'b' }))
    expect(getPendingOidcBind()).toBeNull()
    localStorage.setItem('pending_oidc_bind', JSON.stringify({ savedAt: 1 }))
    expect(getPendingOidcBind()).toBeNull()
  })

  it('reports expiry against OIDC_AUTHCODE_TTL_MS', () => {
    const now = 1_000_000
    expect(isPendingBindExpired({ providerId: 'a', authcode: 'b', savedAt: now }, now)).toBe(false)
    expect(
      isPendingBindExpired({ providerId: 'a', authcode: 'b', savedAt: now - OIDC_AUTHCODE_TTL_MS + 1 }, now),
    ).toBe(false)
    expect(
      isPendingBindExpired({ providerId: 'a', authcode: 'b', savedAt: now - OIDC_AUTHCODE_TTL_MS }, now),
    ).toBe(true)
  })

  it('hasValidPendingBind clears expired markers as a side effect', () => {
    const past = Date.now() - 10 * 60 * 1000
    savePendingOidcBind({ providerId: 'aegis', authcode: 'auth-code', savedAt: past })
    expect(hasValidPendingBind()).toBe(false)
    // The stale marker is retired so a later legitimate flow does not have to
    // race the TTL against a leftover value.
    expect(getPendingOidcBind()).toBeNull()
  })

  it('hasValidPendingBind returns true for an unexpired marker', () => {
    savePendingOidcBind({ providerId: 'aegis', authcode: 'auth-code', savedAt: Date.now() })
    expect(hasValidPendingBind()).toBe(true)
  })

  it('clearPendingOidcBind removes the marker', () => {
    savePendingOidcBind({ providerId: 'aegis', authcode: 'auth-code', savedAt: Date.now() })
    clearPendingOidcBind()
    expect(getPendingOidcBind()).toBeNull()
  })

  it('consumes only a matching provider/authcode pair', () => {
    savePendingOidcBind({ providerId: 'aegis', authcode: 'auth-code', savedAt: Date.now() })
    expect(consumePendingBindIfMatches({ providerId: 'aegis', authcode: 'wrong' })).toBe(false)
    expect(consumePendingBindIfMatches({ providerId: 'aegis', authcode: 'auth-code' })).toBe(true)
    expect(getPendingOidcBind()).toBeNull()
  })

  it('accepts a callback when the backend supplies either correlation field', () => {
    savePendingOidcBind({ providerId: 'aegis', savedAt: Date.now() })
    expect(consumePendingBindIfMatches({ providerId: 'aegis' })).toBe(true)

    savePendingOidcBind({ providerId: 'aegis', authcode: 'auth-code', savedAt: Date.now() })
    expect(consumePendingBindIfMatches({ authcode: 'auth-code' })).toBe(true)
  })

})
