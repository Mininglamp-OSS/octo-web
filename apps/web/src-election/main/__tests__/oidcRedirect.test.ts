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
})
