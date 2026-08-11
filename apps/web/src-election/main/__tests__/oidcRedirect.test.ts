import { describe, expect, it } from 'vitest'
import {
  isTrustedSenderUrl,
  isMatchingOidcCallback,
  parseHttpOrigin,
  parseOidcCallback,
  withTrustedSessionSid,
} from '../oidcRedirect'

describe('parseHttpOrigin', () => {
  it('normalizes http and https URLs to their origin', () => {
    expect(parseHttpOrigin('https://api.example.com/v1/x?y=1')).toBe('https://api.example.com')
    expect(parseHttpOrigin('http://api.example.com:8080/path')).toBe('http://api.example.com:8080')
  })

  it('rejects non-http(s) schemes', () => {
    expect(parseHttpOrigin('file:///etc/passwd')).toBeUndefined()
    expect(parseHttpOrigin('javascript:alert(1)')).toBeUndefined()
    expect(parseHttpOrigin('data:text/html,<script>')).toBeUndefined()
    expect(parseHttpOrigin('ftp://api.example.com')).toBeUndefined()
  })

  it('rejects invalid inputs', () => {
    expect(parseHttpOrigin('')).toBeUndefined()
    expect(parseHttpOrigin('not a url')).toBeUndefined()
    expect(parseHttpOrigin('/relative/path')).toBeUndefined()
    expect(parseHttpOrigin(undefined)).toBeUndefined()
    expect(parseHttpOrigin(null)).toBeUndefined()
    expect(parseHttpOrigin(42)).toBeUndefined()
    expect(parseHttpOrigin({})).toBeUndefined()
  })
})

describe('parseOidcCallback', () => {
  const API = 'https://api.example.com'

  it('accepts only the configured API origin', () => {
    expect(parseOidcCallback('https://idp.example.com/login?oidc_error=1', API)).toBeUndefined()
    expect(parseOidcCallback('https://api.example.com/login?oidc_error=1', API)).toEqual({
      path: '/login',
      query: { oidc_error: '1' },
    })
  })

  it('tolerates a trailing slash on the expected origin', () => {
    // Callers sometimes pass the raw apiURL rather than a normalized origin;
    // parseHttpOrigin() is applied on both sides so the compare stays exact.
    expect(parseOidcCallback('https://api.example.com/login?oidc_error=1', 'https://api.example.com/')).toEqual({
      path: '/login',
      query: { oidc_error: '1' },
    })
  })

  it('rejects mismatched port / scheme', () => {
    expect(parseOidcCallback('http://api.example.com/login?oidc_error=1', API)).toBeUndefined()
    expect(parseOidcCallback('https://api.example.com:8443/login', API)).toBeUndefined()
  })

  it('rejects unknown pathnames', () => {
    expect(parseOidcCallback('https://api.example.com/', API)).toBeUndefined()
    expect(parseOidcCallback('https://api.example.com/login/', API)).toBeUndefined()
    expect(parseOidcCallback('https://api.example.com/LOGIN', API)).toBeUndefined()
    expect(parseOidcCallback('https://api.example.com/attack', API)).toBeUndefined()
  })

  it('rejects non-URL inputs', () => {
    expect(parseOidcCallback('not a url', API)).toBeUndefined()
    expect(parseOidcCallback('/login?x=1', API)).toBeUndefined()
    expect(parseOidcCallback('javascript:alert(1)', API)).toBeUndefined()
  })

  it('rejects an invalid expected origin', () => {
    expect(parseOidcCallback('https://api.example.com/login', 'not a url')).toBeUndefined()
    expect(parseOidcCallback('https://api.example.com/login', 'file:///etc/passwd')).toBeUndefined()
  })

  it('forwards only bind parameters on /oidc/bind', () => {
    expect(
      parseOidcCallback(
        'https://api.example.com/oidc/bind?token=t&provider=acme&authcode=ac&return_to=/foo&evil=x&__octo_route=/attack',
        API,
      ),
    ).toEqual({
      path: '/oidc/bind',
      query: { token: 't', provider: 'acme', authcode: 'ac', return_to: '/foo' },
    })
  })

  it('drops __octo_route sourced from the IdP URL', () => {
    // `__octo_route` is renderer-facing routing metadata injected by
    // withTrustedSessionSid; the IdP MUST NOT be able to steer it.
    const cb = parseOidcCallback(
      'https://api.example.com/oidc/bind?token=t&__octo_route=/somewhere',
      API,
    )
    expect(cb?.query).not.toHaveProperty('__octo_route')
  })

  it('forwards OIDC error fields on /login', () => {
    // Backends returning ?error=access_denied&error_description=... need to
    // reach the login page for i18n error surfacing.
    const cb = parseOidcCallback(
      'https://api.example.com/login?error=access_denied&error_description=user+cancelled&evil=x',
      API,
    )
    expect(cb).toEqual({
      path: '/login',
      query: { error: 'access_denied', error_description: 'user cancelled' },
    })
  })

  it('drops bind-only params on /login', () => {
    const cb = parseOidcCallback(
      'https://api.example.com/login?token=leak&oidc_error=1',
      API,
    )
    expect(cb).toEqual({ path: '/login', query: { oidc_error: '1' } })
  })
})

describe('withTrustedSessionSid', () => {
  it('injects sid and preserves /login query as-is', () => {
    expect(
      withTrustedSessionSid({ path: '/login', query: { oidc_error: '1' } }, 'window-sid'),
    ).toEqual({
      oidc_error: '1',
      sid: 'window-sid',
    })
  })

  it('injects sid + __octo_route on /oidc/bind', () => {
    expect(
      withTrustedSessionSid(
        { path: '/oidc/bind', query: { token: 't', provider: 'acme' } },
        'window-sid',
      ),
    ).toEqual({
      token: 't',
      provider: 'acme',
      sid: 'window-sid',
      __octo_route: '/oidc/bind',
    })
  })

  it('does not add __octo_route on /login even if the caller mutates the map later', () => {
    const result = withTrustedSessionSid({ path: '/login', query: {} }, 's')
    expect(result).not.toHaveProperty('__octo_route')
  })

  it('sid overrides any user-supplied sid in callback query (defense in depth)', () => {
    // Belt-and-suspenders: parseOidcCallback already strips non-whitelisted
    // keys, but if a future path adds `sid` to the allow-list, the trusted
    // window-scoped sid must still win.
    const result = withTrustedSessionSid(
      { path: '/login', query: { oidc_error: '1', sid: 'idp-attacker' } as any },
      'window-sid',
    )
    expect(result.sid).toBe('window-sid')
  })
})

describe('isMatchingOidcCallback', () => {
  it('accepts the authstatus callback that returns to /login without authcode', () => {
    expect(isMatchingOidcCallback(
      { path: '/login', query: {} },
      'pending-authcode',
      'aegis',
    )).toBe(true)
  })

  it('still rejects an explicitly mismatched authcode or provider', () => {
    expect(isMatchingOidcCallback(
      { path: '/login', query: { authcode: 'attacker-code' } },
      'pending-authcode',
      'aegis',
    )).toBe(false)
    expect(isMatchingOidcCallback(
      { path: '/login', query: { provider: 'other' } },
      'pending-authcode',
      'aegis',
    )).toBe(false)
  })
})

describe('isTrustedSenderUrl', () => {
  it('accepts file:// regardless of dev origin (packaged shell)', () => {
    expect(isTrustedSenderUrl(
      'file:///Applications/OCTO.app/build/index.html',
      undefined,
      'file:///Applications/OCTO.app/build/index.html',
    )).toBe(true)
    expect(isTrustedSenderUrl(
      'file:///c:/build/index.html',
      'http://localhost:3000',
      'file:///c:/build/index.html',
    )).toBe(true)
    expect(isTrustedSenderUrl(
      'file:///Applications/OCTO.app/build/index.html?sid=window-sid&__octo_route=%2Foidc%2Fbind#callback',
      undefined,
      'file:///Applications/OCTO.app/build/index.html',
    )).toBe(true)
  })

  it('rejects a different local file even when it uses file://', () => {
    expect(isTrustedSenderUrl(
      'file:///tmp/attacker.html',
      undefined,
      'file:///Applications/OCTO.app/build/index.html',
    )).toBe(false)
  })

  it('accepts an exact dev origin match', () => {
    expect(isTrustedSenderUrl('http://localhost:3000/', 'http://localhost:3000')).toBe(true)
    expect(isTrustedSenderUrl('http://localhost:3000/anything?x=1', 'http://localhost:3000')).toBe(true)
  })

  it('rejects a mismatched port / scheme even in dev', () => {
    expect(isTrustedSenderUrl('http://localhost:3001/', 'http://localhost:3000')).toBe(false)
    expect(isTrustedSenderUrl('https://localhost:3000/', 'http://localhost:3000')).toBe(false)
    expect(isTrustedSenderUrl('http://evil.example/', 'http://localhost:3000')).toBe(false)
  })

  it('rejects http(s) senders when no dev origin was pushed (packaged build)', () => {
    // In packaged builds `TRUSTED_SHELL_DEV_ORIGIN` is undefined — only
    // file:// may reach IPC. A packaged renderer navigated to an http URL
    // (e.g. accidental external navigation) must lose IPC access.
    expect(isTrustedSenderUrl('http://localhost:3000/', undefined)).toBe(false)
    expect(isTrustedSenderUrl('https://api.example.com/', undefined)).toBe(false)
  })

  it('rejects hostile / degenerate schemes', () => {
    expect(isTrustedSenderUrl('javascript:alert(1)', 'http://localhost:3000')).toBe(false)
    expect(isTrustedSenderUrl('data:text/html,<script>', 'http://localhost:3000')).toBe(false)
    expect(isTrustedSenderUrl('chrome-extension://abc/', 'http://localhost:3000')).toBe(false)
    expect(isTrustedSenderUrl('about:blank', 'http://localhost:3000')).toBe(false)
  })

  it('rejects invalid inputs', () => {
    expect(isTrustedSenderUrl(undefined, 'http://localhost:3000')).toBe(false)
    expect(isTrustedSenderUrl('', 'http://localhost:3000')).toBe(false)
    expect(isTrustedSenderUrl('not a url', 'http://localhost:3000')).toBe(false)
  })
})
