import { describe, it, expect } from 'vitest'
import { buildAuthorizeURL, parseOidcUrlState, OIDC_FLAG_WEB, OIDC_FLAG_PC } from '../url'
import type { SSOProvider } from '../types'

const acmeSso: SSOProvider = {
  id: 'acme-sso',
  name: 'Acme SSO',
  authorizePath: '/v1/auth/oidc/acme-sso/authorize',
}

describe('buildAuthorizeURL', () => {
  it('includes authcode and default return_to=/login and flag=1 (web)', () => {
    const url = buildAuthorizeURL(acmeSso, 'abc123')
    expect(url.startsWith('/v1/auth/oidc/acme-sso/authorize?')).toBe(true)
    const qs = new URLSearchParams(url.split('?')[1])
    expect(qs.get('authcode')).toBe('abc123')
    expect(qs.get('return_to')).toBe('/login')
    // Must equal WKSDK's hardcoded deviceFlag (1 = web). If this drifts the
    // backend signs the IM token under the wrong device slot and the WS
    // CONNECT silently fails IM-side auth.
    expect(qs.get('flag')).toBe('1')
  })

  it('uses custom return_to when provided', () => {
    const url = buildAuthorizeURL(acmeSso, 'abc', '/login?next=/home')
    const qs = new URLSearchParams(url.split('?')[1])
    expect(qs.get('return_to')).toBe('/login?next=/home')
  })

  it('encodes special characters in authcode', () => {
    const url = buildAuthorizeURL(acmeSso, 'a b&c')
    expect(url).toContain('authcode=a+b%26c')
  })

  it('uses flag=2 (pc) for Electron desktop when explicitly passed', () => {
    const url = buildAuthorizeURL(
      acmeSso,
      'AC-pc',
      'https://api.example.com/login',
      OIDC_FLAG_PC,
    )
    const qs = new URLSearchParams(url.split('?')[1])
    expect(qs.get('flag')).toBe('2')
    expect(qs.get('return_to')).toBe('https://api.example.com/login')
  })

  it('resolves the server-relative authorize path against an Electron API origin', () => {
    const url = buildAuthorizeURL(
      acmeSso,
      'AC-pc',
      '/login',
      OIDC_FLAG_PC,
      'https://api.example.com/v1/',
    )
    expect(url).toMatch(/^https:\/\/api\.example\.com\/v1\/auth\/oidc\/acme-sso\/authorize\?/)
  })

  it('OIDC_FLAG_WEB is "1" and OIDC_FLAG_PC is "2"', () => {
    expect(OIDC_FLAG_WEB).toBe('1')
    expect(OIDC_FLAG_PC).toBe('2')
  })
})

describe('parseOidcUrlState', () => {
  it('detects oidc_error=1', () => {
    expect(parseOidcUrlState('?oidc_error=1').error).toBe(true)
    expect(parseOidcUrlState('foo=bar&oidc_error=1').error).toBe(true)
  })

  it('returns error=false for clean query', () => {
    expect(parseOidcUrlState('').error).toBe(false)
    expect(parseOidcUrlState('?foo=bar').error).toBe(false)
  })

  it('treats oidc_error=0 or missing as no error', () => {
    expect(parseOidcUrlState('?oidc_error=0').error).toBe(false)
  })
})
