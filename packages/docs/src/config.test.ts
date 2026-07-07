import { describe, it, expect, afterEach, vi } from 'vitest'
import { resolveCollabWsUrl, resolveBoardWsUrl, WS_ENDPOINT } from './config.ts'

// The doc-editor collab WS origin is delivered solely at runtime via the collab-token response
// (`collabWsUrl`). The legacy build-time env fallback (VITE_COLLAB_WS_ENDPOINT) has been removed
// for the editor path, so a missing/blank URL must fail loudly instead of resolving to a placeholder.
describe('resolveCollabWsUrl', () => {
  it('returns the backend-issued collabWsUrl (trimmed)', () => {
    expect(resolveCollabWsUrl('wss://collab.prod.example.com')).toBe('wss://collab.prod.example.com')
    expect(resolveCollabWsUrl('  wss://collab.prod.example.com  ')).toBe(
      'wss://collab.prod.example.com',
    )
  })

  it('throws when the backend omits collabWsUrl', () => {
    expect(() => resolveCollabWsUrl(undefined)).toThrow(/collabWsUrl/)
  })

  it('throws when collabWsUrl is empty or whitespace-only', () => {
    expect(() => resolveCollabWsUrl('')).toThrow(/collabWsUrl/)
    expect(() => resolveCollabWsUrl('   ')).toThrow(/collabWsUrl/)
  })
})

// The BOARD collab WS origin (P1-4) also prefers the backend-issued collabWsUrl, but — unlike the
// doc editor — falls back to the origin-derived WS_ENDPOINT instead of throwing, so a board still
// opens on a backend that predates the collabWsUrl contract.
describe('resolveBoardWsUrl (P1-4)', () => {
  it('returns the backend-issued collabWsUrl (trimmed) when present', () => {
    expect(resolveBoardWsUrl('wss://collab.prod.example.com')).toBe('wss://collab.prod.example.com')
    expect(resolveBoardWsUrl('  wss://collab.prod.example.com  ')).toBe('wss://collab.prod.example.com')
  })

  it('falls back to the origin-derived WS_ENDPOINT when collabWsUrl is absent/blank', () => {
    expect(resolveBoardWsUrl(undefined)).toBe(WS_ENDPOINT)
    expect(resolveBoardWsUrl('')).toBe(WS_ENDPOINT)
    expect(resolveBoardWsUrl('   ')).toBe(WS_ENDPOINT)
  })
})

// WS_ENDPOINT (whiteboard session) is resolved at module load from import.meta.env + window.location,
// so each case stubs the inputs, resets the module cache, and re-imports to observe the resolution.
async function loadWsEndpoint(): Promise<string> {
  vi.resetModules()
  return (await import('./config.ts')).WS_ENDPOINT
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('WS_ENDPOINT resolution (XIN-124)', () => {
  it('uses VITE_COLLAB_WS_ENDPOINT verbatim when injected', async () => {
    vi.stubEnv('VITE_COLLAB_WS_ENDPOINT', 'ws://192.168.214.189:1234')
    expect(await loadWsEndpoint()).toBe('ws://192.168.214.189:1234')
  })

  it('derives ws://<page-host>:1234 from the page origin when the build-arg is unset', async () => {
    vi.stubEnv('VITE_COLLAB_WS_ENDPOINT', '')
    vi.stubGlobal('window', { location: { protocol: 'http:', hostname: '192.168.214.189' } })
    expect(await loadWsEndpoint()).toBe('ws://192.168.214.189:1234')
  })

  it('uses wss when the page is served over https', async () => {
    vi.stubEnv('VITE_COLLAB_WS_ENDPOINT', '')
    vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'docs.acme.io' } })
    expect(await loadWsEndpoint()).toBe('wss://docs.acme.io:1234')
  })

  it('honours VITE_COLLAB_WS_PORT for the origin-derived default', async () => {
    vi.stubEnv('VITE_COLLAB_WS_ENDPOINT', '')
    vi.stubEnv('VITE_COLLAB_WS_PORT', '9999')
    vi.stubGlobal('window', { location: { protocol: 'http:', hostname: 'host.internal' } })
    expect(await loadWsEndpoint()).toBe('ws://host.internal:9999')
  })

  it('never falls back to an unreachable placeholder host', async () => {
    vi.stubEnv('VITE_COLLAB_WS_ENDPOINT', '')
    vi.stubGlobal('window', { location: { protocol: 'http:', hostname: 'localhost' } })
    expect(await loadWsEndpoint()).not.toContain('example.com')
  })

  it('P2: brackets an IPv6 literal host so the ws:// authority is valid', async () => {
    // window.location.hostname returns an IPv6 literal WITHOUT brackets (e.g. `::1`). Concatenating
    // it unbracketed yields `ws://::1:1234`, an invalid authority the browser cannot parse. RFC 3986
    // requires an IPv6 literal to be bracketed in a URI authority.
    vi.stubEnv('VITE_COLLAB_WS_ENDPOINT', '')
    vi.stubGlobal('window', { location: { protocol: 'http:', hostname: '::1' } })
    expect(await loadWsEndpoint()).toBe('ws://[::1]:1234')
  })

  it('P2: brackets a full IPv6 literal over https', async () => {
    vi.stubEnv('VITE_COLLAB_WS_ENDPOINT', '')
    vi.stubGlobal('window', {
      location: { protocol: 'https:', hostname: '2001:db8::1' },
    })
    expect(await loadWsEndpoint()).toBe('wss://[2001:db8::1]:1234')
  })

  it('P2: leaves an IPv4 / DNS host unbracketed', async () => {
    vi.stubEnv('VITE_COLLAB_WS_ENDPOINT', '')
    vi.stubGlobal('window', { location: { protocol: 'http:', hostname: '10.0.0.5' } })
    expect(await loadWsEndpoint()).toBe('ws://10.0.0.5:1234')
  })
})
