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

  it('returns null when authcode missing', () => {
    expect(parseBindEntryParams('?token=t&return_to=/')).toBeNull()
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
