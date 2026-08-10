import { describe, expect, it } from 'vitest'
import { buildShellUrlForDeepLink } from '../deepLink'

describe('buildShellUrlForDeepLink', () => {
  const shell =
    'file:///Applications/OCTO.app/Contents/Resources/app.asar/build/index.html?sid=window-sid'

  it('routes dmwork://oidc/bind through __octo_route so BindModule.init() picks it up', () => {
    const out = buildShellUrlForDeepLink(
      'dmwork://oidc/bind?token=abc&provider=aegis',
      shell,
    )
    expect(out).not.toBeNull()
    const url = new URL(out!)
    expect(url.protocol).toBe('file:')
    expect(url.pathname).toBe('/Applications/OCTO.app/Contents/Resources/app.asar/build/index.html')
    expect(url.searchParams.get('__octo_route')).toBe('/oidc/bind')
    expect(url.searchParams.get('token')).toBe('abc')
    expect(url.searchParams.get('provider')).toBe('aegis')
    // sid from the shell URL must survive — main.ts owns that value.
    expect(url.searchParams.get('sid')).toBe('window-sid')
  })

  it('refuses to overwrite the trusted sid captured by main.ts', () => {
    const out = buildShellUrlForDeepLink(
      'dmwork://oidc/bind?token=abc&sid=attacker-sid',
      shell,
    )
    expect(out).not.toBeNull()
    const url = new URL(out!)
    expect(url.searchParams.get('sid')).toBe('window-sid')
  })

  it('returns null for non-dmwork schemes', () => {
    expect(buildShellUrlForDeepLink('https://example.com/oidc/bind?token=abc', shell))
      .toBeNull()
    expect(buildShellUrlForDeepLink('javascript:alert(1)', shell)).toBeNull()
  })

  it('returns null for malformed URLs', () => {
    expect(buildShellUrlForDeepLink('not-a-url', shell)).toBeNull()
    expect(buildShellUrlForDeepLink('', shell)).toBeNull()
  })

  it('works when the shell URL is http (dev mode)', () => {
    const out = buildShellUrlForDeepLink(
      'dmwork://oidc/bind?token=abc',
      'http://localhost:3000/?sid=dev-sid',
    )
    expect(out).not.toBeNull()
    const url = new URL(out!)
    expect(url.origin).toBe('http://localhost:3000')
    expect(url.searchParams.get('__octo_route')).toBe('/oidc/bind')
    expect(url.searchParams.get('token')).toBe('abc')
    expect(url.searchParams.get('sid')).toBe('dev-sid')
  })

  it('normalizes dmwork:oidc/bind (no double slash) to the same route as dmwork://oidc/bind', () => {
    // The URL parser collapses both forms to `host=oidc, pathname=/bind` on
    // any WHATWG-compliant runtime, so downstream handling is identical.
    // Documenting the invariant here catches future parser changes.
    const slashed = buildShellUrlForDeepLink('dmwork://oidc/bind?token=abc', shell)
    const bare = buildShellUrlForDeepLink('dmwork:oidc/bind?token=abc', shell)
    expect(slashed).not.toBeNull()
    expect(bare).not.toBeNull()
    expect(new URL(slashed!).searchParams.get('__octo_route')).toBe('/oidc/bind')
    expect(new URL(bare!).searchParams.get('__octo_route')).toBe('/oidc/bind')
  })

  it('strips a trailing slash so `dmwork://oidc/bind/` still matches BindModule', () => {
    // BindModule.init() uses exact equality on `__octo_route === '/oidc/bind'`.
    // Some protocol handlers / OS shells may normalize URIs with a trailing
    // slash; without stripping it here the latch never sets and the bind
    // token is dropped on the floor.
    const out = buildShellUrlForDeepLink('dmwork://oidc/bind/?token=abc', shell)
    expect(out).not.toBeNull()
    expect(new URL(out!).searchParams.get('__octo_route')).toBe('/oidc/bind')
  })
})
