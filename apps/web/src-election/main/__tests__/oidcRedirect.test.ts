import { describe, expect, it } from 'vitest'
import { parseOidcCallback, withTrustedSessionSid } from '../oidcRedirect'

describe('Electron OIDC callback redirect', () => {
  it('accepts the backend callback and rejects an IdP /login page', () => {
    expect(parseOidcCallback('https://api.example.com/login?oidc_error=1', 'https://api.example.com')?.path).toBe('/login')
    expect(parseOidcCallback('https://idp.example.com/login', 'https://api.example.com')).toBeUndefined()
  })

  it('keeps the window sid authoritative over callback query parameters', () => {
    const callback = parseOidcCallback(
      'https://api.example.com/login?sid=attacker&oidc_error=1',
      'https://api.example.com',
    )!
    expect(withTrustedSessionSid(callback, 'window-sid')).toEqual({
      sid: 'window-sid',
      oidc_error: '1',
    })
  })

  it('marks bind callbacks so the packaged renderer enters the bind route', () => {
    const callback = parseOidcCallback(
      'https://api.example.com/oidc/bind?token=t&return_to=%2F',
      'https://api.example.com',
    )!
    expect(withTrustedSessionSid(callback, 'window-sid')).toMatchObject({
      __octo_route: '/oidc/bind',
      token: 't',
      sid: 'window-sid',
    })
  })

  // Regression: without this, a `/login` callback carrying
  // `__octo_route=/oidc/bind` (from a hostile IdP or open redirect) would be
  // passed straight to the packaged shell with a trusted sid attached, and
  // BindModule.init() would enter the bind flow with an attacker-controlled
  // token. `withTrustedSessionSid` must derive `__octo_route` purely from
  // `callback.path`, never inherit it from the callback query.
  it('never inherits __octo_route from a /login callback query', () => {
    const callback = parseOidcCallback(
      'https://api.example.com/login?__octo_route=/oidc/bind&token=attacker',
      'https://api.example.com',
    )!
    const forwarded = withTrustedSessionSid(callback, 'window-sid')
    expect(forwarded.__octo_route).toBeUndefined()
    expect(forwarded.token).toBe('attacker')
    expect(forwarded.sid).toBe('window-sid')
  })

  it('drops query params outside the forwarding allowlist', () => {
    const callback = parseOidcCallback(
      'https://api.example.com/login?oidc_error=1&extra=leaked&sid=x',
      'https://api.example.com',
    )!
    const forwarded = withTrustedSessionSid(callback, 'window-sid')
    expect(forwarded).toEqual({ sid: 'window-sid', oidc_error: '1' })
    expect(forwarded.extra).toBeUndefined()
  })
})
