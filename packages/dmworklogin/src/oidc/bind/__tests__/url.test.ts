import { describe, it, expect, vi } from 'vitest'
import {
  parseBindEntryParams,
  sanitizeReturnTo,
  clearBindUrl,
} from '../url'

describe('parseBindEntryParams', () => {
  it('parses token / authcode / return_to / provider from query string', () => {
    const r = parseBindEntryParams('?token=tok123&authcode=ac456&return_to=/home&provider=aegis')
    expect(r).toEqual({
      token: 'tok123',
      authcode: 'ac456',
      returnTo: '/home',
      provider: 'aegis',
    })
  })

  it('handles missing leading ?', () => {
    const r = parseBindEntryParams('token=t&authcode=a')
    expect(r).toEqual({
      token: 't',
      authcode: 'a',
      returnTo: '/',
    })
  })

  it('returns null when token missing', () => {
    expect(parseBindEntryParams('?authcode=a&return_to=/')).toBeNull()
  })

  it('accepts entry with token but no authcode (authcode is server-side only, PR #72 review B3)', () => {
    const r = parseBindEntryParams('?token=t&return_to=/')
    expect(r).not.toBeNull()
    expect(r?.token).toBe('t')
    expect(r?.authcode).toBe('')
  })

  it('falls back return_to to /', () => {
    const r = parseBindEntryParams('?token=t&authcode=a')
    expect(r?.returnTo).toBe('/')
  })

  it('does not include provider key when absent (distinguishable from explicit empty)', () => {
    const r = parseBindEntryParams('?token=t&authcode=a')
    expect(r).not.toHaveProperty('provider')
  })

  it('rejects protocol-relative return_to', () => {
    const r = parseBindEntryParams('?token=t&authcode=a&return_to=//evil.com/x')
    expect(r?.returnTo).toBe('/')
  })

  it('rejects absolute url return_to', () => {
    const r = parseBindEntryParams('?token=t&authcode=a&return_to=https://evil.com')
    expect(r?.returnTo).toBe('/')
  })
})

describe('sanitizeReturnTo', () => {
  it('accepts safe relative paths', () => {
    expect(sanitizeReturnTo('/home')).toBe('/home')
    expect(sanitizeReturnTo('/contacts/123')).toBe('/contacts/123')
  })

  it('rejects protocol-relative', () => {
    expect(sanitizeReturnTo('//evil')).toBe('/')
  })

  it('rejects javascript:', () => {
    expect(sanitizeReturnTo('javascript:alert(1)')).toBe('/')
  })

  it('rejects absolute', () => {
    expect(sanitizeReturnTo('https://evil')).toBe('/')
  })

  it('rejects empty', () => {
    expect(sanitizeReturnTo('')).toBe('/')
  })

  // ---- regression: PR #72 Jerry-Xin review — sanitize must reject backslash
  // variants. Browsers normalise `\` to `/` in URL parsing, so `/\evil.com`
  // resolves to https://evil.com/ via the URL ctor. Both raw `\` and the
  // URL-encoded `%5C` / `%5c` must be rejected.
  it('rejects raw backslash injection', () => {
    expect(sanitizeReturnTo('/\\evil.com')).toBe('/')
    expect(sanitizeReturnTo('/\\\\evil.com')).toBe('/')
    expect(sanitizeReturnTo('\\evil.com')).toBe('/')
  })

  it('rejects URL-encoded backslash injection', () => {
    expect(sanitizeReturnTo('/%5Cevil.com')).toBe('/')
    expect(sanitizeReturnTo('/%5cevil.com')).toBe('/')
    expect(sanitizeReturnTo('/safe%5Cbut-encoded')).toBe('/')
  })

  // Defense-in-depth: even if some unicode same-shape char slips past the
  // string-level checks, the URL ctor cross-origin check catches it.
  it('rejects URLs whose parsed origin differs from page origin', () => {
    const pageOrigin = 'http://localhost:3000'
    // Same as cross-origin via raw backslash but exercised through the URL
    // ctor branch by mocking the page origin.
    expect(sanitizeReturnTo('http://evil.com/path', pageOrigin)).toBe('/')
  })

  it('accepts when parsed origin matches page origin (sanity)', () => {
    expect(sanitizeReturnTo('/home', 'http://localhost:3000')).toBe('/home')
  })
})

describe('clearBindUrl', () => {
  it('calls history.replaceState with pathname only', () => {
    const replaceState = vi.fn()
    const win = {
      history: { replaceState } as unknown as History,
      location: { pathname: '/oidc/bind' } as Location,
    }
    clearBindUrl(win)
    expect(replaceState).toHaveBeenCalledWith({}, '', '/oidc/bind')
  })

  it('does not throw when history is unavailable', () => {
    const win = {
      history: {
        replaceState: () => {
          throw new Error('SSR')
        },
      } as unknown as History,
      location: { pathname: '/x' } as Location,
    }
    expect(() => clearBindUrl(win)).not.toThrow()
  })
})
