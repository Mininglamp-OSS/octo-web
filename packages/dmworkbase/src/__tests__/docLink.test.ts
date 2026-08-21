import { describe, it, expect, vi } from 'vitest'
import { buildDocLink } from '../Utils/docLink'
import { isHttpOrigin, resolveWebOrigin } from '../Utils/webOrigin'
import APIClient from '../Service/APIClient'

const apiConfig = APIClient.shared.config as unknown as { apiURL: string }

describe('buildDocLink — standalone `/d/:docId` share form (Phase-1 no-sp reader)', () => {
  it('points at the standalone `/d/<docId>` page, not the in-shell `/docs?doc=` route', () => {
    const link = buildDocLink({ docId: 'd_1', space: 'demo', folder: 'f_default' })
    expect(link).toContain('/d/d_1')
    expect(link).not.toContain('/docs?')
    expect(link).not.toContain('doc=d_1')
    expect(link).not.toContain('space=')
    expect(link).not.toContain('folder=')
  })

  it('never emits `?sp=` even when a document space is supplied', () => {
    const link = buildDocLink({ docId: 'd_1', space: '105d4a60d0fc4d55a5cfc3c2d0501361' })
    expect(link).toBe('http://localhost:3000/d/d_1')
    expect(link).not.toContain('sp=')
  })

  it('never carries the token-bucket `?sid`, even when currentSpaceId is persisted', () => {
    try {
      window.localStorage.setItem('currentSpaceId', 'sp_current')
      const link = buildDocLink({ docId: 'd_1', space: 'space_doc' })
      expect(link).toBe('http://localhost:3000/d/d_1')
      expect(link).not.toContain('sid=')
      expect(link).not.toContain('sp=')
    } finally {
      window.localStorage.removeItem('currentSpaceId')
    }
  })

  it('works with only a docId and URL-encodes it', () => {
    expect(buildDocLink({ docId: 'd_2' })).toBe('http://localhost:3000/d/d_2')
    expect(buildDocLink({ docId: 'a b' })).toBe('http://localhost:3000/d/a%20b')
  })

  it('falls back to the API origin when the shell origin is "null" or "file://" (packaged build)', () => {
    // Packaged Electron shells load over file:// where window.location.origin
    // is a literal non-origin string ("file://" on Electron 26, "null" on
    // older specs/jsdom). Concatenating it produced file:///d/<docId> or
    // null/d/<docId>; the shared allowlist helper must fall back to the API
    // origin so the outgoing link is a real web URL.
    const originalApiURL = apiConfig.apiURL
    apiConfig.apiURL = 'https://im-test.deepminer.com.cn/api/v1/'
    try {
      for (const badOrigin of ['null', 'file://']) {
        vi.stubGlobal('location', { protocol: 'file:', origin: badOrigin, href: 'file:///app/index.html' })
        expect(buildDocLink({ docId: 'd_1' })).toBe('https://im-test.deepminer.com.cn/d/d_1')
        vi.unstubAllGlobals()
      }
    } finally {
      apiConfig.apiURL = originalApiURL
    }
  })

  it('degrades to a root-relative /d/<docId> when neither origin resolves', () => {
    const originalApiURL = apiConfig.apiURL
    apiConfig.apiURL = ''
    try {
      vi.stubGlobal('location', { protocol: 'file:', origin: 'null', href: 'file:///app/index.html' })
      expect(buildDocLink({ docId: 'd_1' })).toBe('/d/d_1')
      vi.unstubAllGlobals()
    } finally {
      apiConfig.apiURL = originalApiURL
    }
  })
})

describe('resolveWebOrigin / isHttpOrigin (pure)', () => {
  it('accepts http(s) document origins as-is', () => {
    expect(resolveWebOrigin('https://app.example.com', 'https://api.example.com/v1/')).toBe('https://app.example.com')
    expect(resolveWebOrigin('http://localhost:3000', undefined)).toBe('http://localhost:3000')
  })

  it('falls back to the API origin for every non-http(s) document origin', () => {
    // "file://" is what Electron 26 actually reports; "null" is the older
    // spec/jsdom value. Both are truthy strings — a denylist of one misses
    // the other, which is exactly the round-7/round-8 bug.
    for (const bad of ['file://', 'null', 'about://', 'weird', '']) {
      expect(resolveWebOrigin(bad, 'https://api.example.com/v1/')).toBe('https://api.example.com')
    }
  })

  it('returns "" when neither side resolves', () => {
    expect(resolveWebOrigin(undefined, undefined)).toBe('')
    expect(resolveWebOrigin('file://', 'not-a-url')).toBe('')
  })

  it('isHttpOrigin is an http(s) allowlist', () => {
    expect(isHttpOrigin('https://a.com')).toBe(true)
    expect(isHttpOrigin('http://a.com:8080')).toBe(true)
    expect(isHttpOrigin('file://')).toBe(false)
    expect(isHttpOrigin('null')).toBe(false)
    expect(isHttpOrigin(undefined)).toBe(false)
    expect(isHttpOrigin('')).toBe(false)
  })
})
