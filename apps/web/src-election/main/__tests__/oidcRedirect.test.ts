import { describe, expect, it } from 'vitest'
import {
  isTrustedSenderUrl,
  classifyOidcNavigation,
  isOidcAuthorizeNavigation,
  isMatchingOidcCallback,
  parseHttpOrigin,
  parseOidcCallback,
  validateOidcHttpRequest,
  validateOpenExternalUrl,
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

  it('forwards login correlation fields so the interceptor can verify them', () => {
    const cb = parseOidcCallback(
      'https://api.example.com/login?authcode=expected&provider=acme&error=access_denied',
      API,
    )
    expect(cb).toEqual({
      path: '/login',
      query: { authcode: 'expected', provider: 'acme', error: 'access_denied' },
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

describe('isOidcAuthorizeNavigation', () => {
  const API = 'https://api.example.com'

  it('allows the matching provider authorize endpoint', () => {
    const authorizeUrl = `${API}/api/v1/auth/oidc/acme-sso/authorize?authcode=abc&return_to=%2Flogin`
    expect(isOidcAuthorizeNavigation(
      authorizeUrl,
      API,
      'acme-sso',
      authorizeUrl,
    )).toBe(true)
  })

  it('rejects callbacks, other providers, and other origins', () => {
    const authorizeUrl = `${API}/api/v1/auth/oidc/acme-sso/authorize?authcode=abc`
    expect(isOidcAuthorizeNavigation(`${API}/login`, API, 'acme-sso', authorizeUrl)).toBe(false)
    expect(isOidcAuthorizeNavigation(`${API}/api/v1/auth/oidc/other/authorize?authcode=abc`, API, 'acme-sso', authorizeUrl)).toBe(false)
    expect(isOidcAuthorizeNavigation('https://evil.example/api/v1/auth/oidc/acme-sso/authorize?authcode=abc', API, 'acme-sso', authorizeUrl)).toBe(false)
  })

  it('rejects an authorize URL that differs only by path or query', () => {
    const authorizeUrl = `${API}/api/v1/auth/oidc/acme-sso/authorize?authcode=abc&flag=2`
    expect(isOidcAuthorizeNavigation(
      `${API}/v1/auth/oidc/acme-sso/authorize?authcode=abc&flag=2`,
      API,
      'acme-sso',
      authorizeUrl,
    )).toBe(false)
  })
})

describe('classifyOidcNavigation', () => {
  const origin = 'https://api.example.com'
  const authorizeUrl = `${origin}/v1/auth/oidc/acme/authorize?authcode=ac&return_to=%2Flogin&flag=2`
  const base = {
    origin,
    providerId: 'acme',
    authorizeUrl,
    authcode: 'ac',
    expiresAt: 2_000,
    now: 1_000,
  }

  it('allows the API callback hop before the terminal frontend callback', () => {
    expect(classifyOidcNavigation({
      ...base,
      url: `${origin}/v1/auth/oidc/acme/callback?code=code&state=state`,
    })).toBe('same-origin')
  })

  it('only classifies a correlated /login callback as terminal', () => {
    expect(classifyOidcNavigation({
      ...base,
      url: `${origin}/login?authcode=ac&provider=acme`,
    })).toBe('callback')
    expect(classifyOidcNavigation({
      ...base,
      url: `${origin}/login?authcode=other&provider=acme`,
    })).toBe('invalid-callback')
  })

  it('marks an expired flow for local-shell recovery', () => {
    expect(classifyOidcNavigation({
      ...base,
      now: 2_000,
      url: 'https://idp.example.com/authorize',
    })).toBe('expired')
  })
})

describe('validateOidcHttpRequest', () => {
  const API = 'https://api.example.com'

  it('allows only the configured origin and endpoint/method pairs', () => {
    expect(validateOidcHttpRequest({
      url: `${API}/v1/auth/oidc/acme/bind/info`, method: 'GET',
    }, API).ok).toBe(true)
    expect(validateOidcHttpRequest({
      url: 'https://attacker.example/v1/user/thirdlogin/authstatus', method: 'GET',
    }, API)).toEqual({ ok: false, error: 'OIDC origin is not allowed' })
    expect(validateOidcHttpRequest({
      url: `${API}/v1/auth/oidc/acme/bind/info`, method: 'POST',
    }, undefined)).toEqual({ ok: false, error: 'OIDC origin is not allowed' })
    expect(validateOidcHttpRequest({
      url: `${API}/v1/auth/oidc/acme/bind/info`, method: 'POST',
    }, API)).toEqual({ ok: false, error: 'Invalid OIDC method' })
  })

  it('does not accept arbitrary paths or non-string token headers', () => {
    expect(validateOidcHttpRequest({
      url: `${API}/v1/secrets`, method: 'GET',
    }, API).ok).toBe(false)
    expect(validateOidcHttpRequest({
      url: `${API}/v1/user/thirdlogin/authstatus`, method: 'GET',
      headers: { token: 123 },
    }, API)).toEqual({ ok: false, error: 'Invalid OIDC headers' })
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

  it('requires both correlation fields for bind callbacks', () => {
    expect(isMatchingOidcCallback(
      { path: '/oidc/bind', query: { token: 'attacker-token' } },
      'pending-authcode',
      'aegis',
    )).toBe(false)
    expect(isMatchingOidcCallback(
      { path: '/oidc/bind', query: { token: 't', authcode: 'pending-authcode', provider: 'aegis' } },
      'pending-authcode',
      'aegis',
    )).toBe(true)
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

  it('keeps the document identity separate from SPA route history', () => {
    // The main-process IPC guard records this result when the document is
    // committed. A later history.pushState('/drive') must not turn the shell
    // into a different local document or revoke its bridge.
    expect(isTrustedSenderUrl(
      'file:///Applications/OCTO.app/build/index.html?sid=window-sid',
      undefined,
      'file:///Applications/OCTO.app/build/index.html',
    )).toBe(true)
    expect(isTrustedSenderUrl(
      'file:///Applications/OCTO.app/build/other.html',
      undefined,
      'file:///Applications/OCTO.app/build/index.html',
    )).toBe(false)
  })

  it('accepts Windows drive-letter case differences in the trusted file path', () => {
    expect(isTrustedSenderUrl(
      'file:///c:/Applications/OCTO.app/build/index.html',
      undefined,
      'file:///C:/Applications/OCTO.app/build/index.html',
    )).toBe(true)
  })

  it('rejects a different local file even when it uses file://', () => {
    expect(isTrustedSenderUrl(
      'file:///tmp/attacker.html',
      undefined,
      'file:///Applications/OCTO.app/build/index.html',
    )).toBe(false)
  })

  it('rejects a different file host even when the path matches', () => {
    expect(isTrustedSenderUrl(
      'file://attacker/build/index.html',
      undefined,
      'file:///build/index.html',
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

describe('validateOpenExternalUrl', () => {
  it('accepts end-session-shaped https URLs across common IdPs', () => {
    // Real end_session URLs we've observed in production integrations. Each
    // vendor's path shape and standard query params must go through.
    for (const url of [
      // Keycloak (RP-initiated logout 1.0)
      'https://idp.example.com/realms/octo/protocol/openid-connect/logout?id_token_hint=jwt&post_logout_redirect_uri=https%3A%2F%2Fapp.example.com%2Flogin&state=abc',
      // Auth0
      'https://tenant.auth0.com/v2/logout?client_id=abc&returnTo=https%3A%2F%2Fapp.example.com',
      // Azure AD
      'https://login.microsoftonline.com/tenant/oauth2/v2.0/logout?post_logout_redirect_uri=https%3A%2F%2Fapp.example.com',
      // Bare end_session with trailing slash (common with reverse proxies).
      'https://idp.example.com/oauth2/end_session/?id_token_hint=jwt',
    ]) {
      const result = validateOpenExternalUrl(url)
      expect(result.ok, url).toBe(true)
    }
  })

  it('rejects http (RFC 8252 §8.10 requires TLS on the end-session leg)', () => {
    expect(validateOpenExternalUrl('http://idp.example.com/oauth2/end_session').ok).toBe(false)
    expect(validateOpenExternalUrl('http://idp.example.com/logout').ok).toBe(false)
  })

  it('rejects non-http(s) schemes forwarded to the OS handler', () => {
    // file:/javascript:/data: to shell.openExternal would let a compromised
    // renderer launch arbitrary local documents or scripts via the user's
    // default handler. All must be rejected before we hit shell.openExternal.
    expect(validateOpenExternalUrl('file:///etc/passwd').ok).toBe(false)
    expect(validateOpenExternalUrl('javascript:alert(1)').ok).toBe(false)
    expect(validateOpenExternalUrl('data:text/html,<script>alert(1)</script>').ok).toBe(false)
    expect(validateOpenExternalUrl('vbscript:msgbox').ok).toBe(false)
    expect(validateOpenExternalUrl('ftp://example.com/end_session').ok).toBe(false)
    // Custom protocol handlers registered by third-party apps (Slack, Zoom,
    // etc.) must not be reachable from this channel either.
    expect(validateOpenExternalUrl('slack://open').ok).toBe(false)
  })

  it('rejects arbitrary https URLs that do not match the end-session shape', () => {
    // Even https:// is not a free pass: a compromised renderer must not be
    // able to smuggle a marketing page, a phishing site, or an arbitrary
    // Google Docs URL through shell.openExternal by wrapping it in a
    // legitimate scheme. Path shape gates this.
    expect(validateOpenExternalUrl('https://evil.example.com/').ok).toBe(false)
    expect(validateOpenExternalUrl('https://idp.example.com/authorize').ok).toBe(false)
    expect(validateOpenExternalUrl('https://idp.example.com/oauth2/token').ok).toBe(false)
  })

  it('rejects userinfo, fragments, and unknown query params', () => {
    // Embedded credentials would be leaked into the OS URL handler + logs.
    expect(validateOpenExternalUrl('https://user:pass@idp.example.com/oauth2/end_session').ok).toBe(false)
    // Fragments are not used by RP-initiated logout; disallow them so a
    // renderer cannot smuggle client-side navigation state.
    expect(validateOpenExternalUrl('https://idp.example.com/oauth2/end_session#/login').ok).toBe(false)
    // Unknown query params fail closed — extending the allowlist is a
    // deliberate action, not something a caller can do at runtime.
    expect(validateOpenExternalUrl('https://idp.example.com/oauth2/end_session?exec=curl').ok).toBe(false)
  })

  it('rejects non-string / malformed inputs', () => {
    expect(validateOpenExternalUrl(undefined).ok).toBe(false)
    expect(validateOpenExternalUrl(null).ok).toBe(false)
    expect(validateOpenExternalUrl(42).ok).toBe(false)
    expect(validateOpenExternalUrl({}).ok).toBe(false)
    expect(validateOpenExternalUrl('').ok).toBe(false)
    expect(validateOpenExternalUrl('not a url').ok).toBe(false)
  })
})

describe('validateOidcHttpRequest provider path allowlist', () => {
  const API = 'https://api.example.com'
  it('accepts realistic slug provider ids', () => {
    const ok = validateOidcHttpRequest(
      { url: `${API}/v1/auth/oidc/aegis/bind/info`, method: 'GET' },
      API,
    )
    expect(ok.ok).toBe(true)
    const dotted = validateOidcHttpRequest(
      { url: `${API}/v1/auth/oidc/corp.sso-eu_1/logout`, method: 'POST' },
      API,
    )
    expect(dotted.ok).toBe(true)
    const encodedAt = validateOidcHttpRequest(
      { url: `${API}/v1/auth/oidc/corp%40sso/logout`, method: 'POST' },
      API,
    )
    expect(encodedAt.ok).toBe(true)
  })

  it('rejects percent-encoded traversal in the provider segment', () => {
    // Regression for review P2-6: [a-z0-9_%.-]+ used to accept %2e%2e / %2f,
    // widening the allowlist beyond `encodeURIComponent(providerId)` output.
    // The tightened class refuses `%` entirely.
    expect(validateOidcHttpRequest(
      { url: `${API}/v1/auth/oidc/%2e%2e/logout`, method: 'POST' },
      API,
    ).ok).toBe(false)
    expect(validateOidcHttpRequest(
      { url: `${API}/v1/auth/oidc/aegis%2f..%2fadmin/logout`, method: 'POST' },
      API,
    ).ok).toBe(false)
  })

  it('rejects provider segments containing unsupported characters', () => {
    expect(validateOidcHttpRequest(
      { url: `${API}/v1/auth/oidc/aegis@corp/logout`, method: 'POST' },
      API,
    ).ok).toBe(false)
    expect(validateOidcHttpRequest(
      { url: `${API}/v1/auth/oidc/aegis:1/logout`, method: 'POST' },
      API,
    ).ok).toBe(false)
  })
})
