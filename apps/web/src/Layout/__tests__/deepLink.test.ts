import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildShellUrlForDeepLink } from '../deepLink'

// Node 25 can disable jsdom's storage when no --localstorage-file is passed.
// Keep this focused helper runnable in CI without changing the app's storage
// contract or requiring a persistent test file.
if (typeof globalThis.localStorage === 'undefined') {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  })
}

// Every non-null assertion below needs a valid pending-bind marker to survive
// the P1-2 correlation check. `dmwork://oidc/bind` is rejected outright
// without one — see the dedicated block at the bottom of this file.
function seedPendingBind(): void {
  localStorage.setItem(
    'pending_oidc_bind',
    JSON.stringify({ providerId: 'aegis', authcode: 'auth-code', savedAt: Date.now() }),
  )
}

describe('buildShellUrlForDeepLink', () => {
  const shell =
    'file:///Applications/OCTO.app/Contents/Resources/app.asar/build/index.html?sid=window-sid'

  beforeEach(() => {
    seedPendingBind()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('routes dmwork://oidc/bind through __octo_route so BindModule.init() picks it up', () => {
    const out = buildShellUrlForDeepLink(
      'dmwork://oidc/bind?token=abc&provider=aegis&authcode=auth-code',
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
      'dmwork://oidc/bind?token=abc&provider=aegis&authcode=auth-code&sid=attacker-sid',
      shell,
    )
    expect(out).not.toBeNull()
    const url = new URL(out!)
    expect(url.searchParams.get('sid')).toBe('window-sid')
  })

  it('refuses to overwrite the route derived from the deep-link path', () => {
    const out = buildShellUrlForDeepLink(
      'dmwork://oidc/bind?token=abc&provider=aegis&authcode=auth-code&__octo_route=/login',
      shell,
    )
    expect(out).not.toBeNull()
    expect(new URL(out!).searchParams.get('__octo_route')).toBe('/oidc/bind')
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
      'dmwork://oidc/bind?token=abc&provider=aegis&authcode=auth-code',
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
    const slashed = buildShellUrlForDeepLink('dmwork://oidc/bind?token=abc&provider=aegis&authcode=auth-code', shell)
    seedPendingBind()
    const bare = buildShellUrlForDeepLink('dmwork:oidc/bind?token=abc&provider=aegis&authcode=auth-code', shell)
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
    const out = buildShellUrlForDeepLink('dmwork://oidc/bind/?token=abc&provider=aegis&authcode=auth-code', shell)
    expect(out).not.toBeNull()
    expect(new URL(out!).searchParams.get('__octo_route')).toBe('/oidc/bind')
  })
})

// P1-2: the `dmwork://` scheme is registered as an OS-level protocol handler
// (electron-builder.js mac/win/linux). Any web page can trigger it. Without
// a client-side correlation check, an attacker could pre-craft a bind link
// whose token binds the attacker's external identity to the victim's account
// once the victim clears the password/OTP challenge — mirrored on the login
// side in login_vm.tsx:650 via `pending_oidc_login`. The bind side gets its
// own persistent marker (localStorage, survives cold restart) so the same
// property holds when SSO round-trips through an external browser.
describe('buildShellUrlForDeepLink — bind correlation check (P1-2)', () => {
  const shell =
    'file:///Applications/OCTO.app/Contents/Resources/app.asar/build/index.html?sid=window-sid'

  afterEach(() => {
    localStorage.clear()
  })

  it('rejects dmwork://oidc/bind when no OIDC flow was locally initiated', () => {
    // No marker written — this is the attack scenario.
    const out = buildShellUrlForDeepLink(
      'dmwork://oidc/bind?token=ATTACKER_TOKEN',
      shell,
    )
    expect(out).toBeNull()
  })

  it('rejects dmwork://oidc/bind when the marker has expired', () => {
    // OIDC_AUTHCODE_TTL_MS is 5 minutes. Backdate the marker past the TTL.
    localStorage.setItem(
      'pending_oidc_bind',
      JSON.stringify({ providerId: 'aegis', savedAt: Date.now() - 10 * 60 * 1000 }),
    )
    const out = buildShellUrlForDeepLink(
      'dmwork://oidc/bind?token=STALE_TOKEN&provider=aegis&authcode=auth-code',
      shell,
    )
    expect(out).toBeNull()
  })

  it('rejects dmwork://oidc/bind when the marker is malformed', () => {
    localStorage.setItem('pending_oidc_bind', 'not-json')
    const out = buildShellUrlForDeepLink(
      'dmwork://oidc/bind?token=BOGUS',
      shell,
    )
    expect(out).toBeNull()
  })

  it('accepts dmwork://oidc/bind when a valid unexpired marker is present', () => {
    localStorage.setItem(
      'pending_oidc_bind',
      JSON.stringify({ providerId: 'aegis', authcode: 'auth-code', savedAt: Date.now() }),
    )
    const out = buildShellUrlForDeepLink(
      'dmwork://oidc/bind?token=LEGITIMATE_TOKEN&provider=aegis&authcode=auth-code',
      shell,
    )
    expect(out).not.toBeNull()
    expect(new URL(out!).searchParams.get('token')).toBe('LEGITIMATE_TOKEN')
  })

  it('rejects a bind callback when authcode is missing', () => {
    localStorage.setItem(
      'pending_oidc_bind',
      JSON.stringify({ providerId: 'aegis', authcode: 'auth-code', savedAt: Date.now() }),
    )
    const out = buildShellUrlForDeepLink(
      'dmwork://oidc/bind?token=LEGITIMATE_TOKEN&provider=aegis',
      shell,
    )
    expect(out).toBeNull()
  })
})
