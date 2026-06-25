import { describe, it, expect } from 'vitest'
import { sanitizeLinkHref, sanitizeAssetUrl, sanitizeSrcset, renderLinkAttrs } from './sanitize.ts'

describe('sanitizeLinkHref', () => {
  it('allows http/https/mailto', () => {
    expect(sanitizeLinkHref('https://example.com/x')).toBe('https://example.com/x')
    expect(sanitizeLinkHref('http://example.com')).toBe('http://example.com/')
    expect(sanitizeLinkHref('mailto:a@b.com')).toBe('mailto:a@b.com')
  })

  it('rejects javascript: / data: / vbscript: pseudo-protocols', () => {
    expect(sanitizeLinkHref('javascript:alert(1)')).toBeNull()
    expect(sanitizeLinkHref('data:text/html,<script>')).toBeNull()
    expect(sanitizeLinkHref('vbscript:msgbox')).toBeNull()
  })

  it('treats protocol-relative //evil.com as a normal cross-host link (host restriction is asset-only)', () => {
    // //evil.com resolves against the current origin to http(s)://evil.com — an allowed LINK
    // scheme. Links permit cross-host navigation; only ASSET URLs are host-restricted.
    expect(sanitizeLinkHref('//evil.com/x')).toMatch(/^https?:\/\/evil\.com\/x$/)
  })

  it('returns null for empty input', () => {
    expect(sanitizeLinkHref('')).toBeNull()
    expect(sanitizeLinkHref(null)).toBeNull()
    expect(sanitizeLinkHref(undefined)).toBeNull()
  })
})

describe('sanitizeAssetUrl', () => {
  it('allows whitelisted storage hosts over http/https', () => {
    expect(sanitizeAssetUrl('https://assets.octo.example.com/a.png')).toBe(
      'https://assets.octo.example.com/a.png',
    )
    expect(sanitizeAssetUrl('https://cdn.octo.example.com/b.jpg')).toBe(
      'https://cdn.octo.example.com/b.jpg',
    )
  })

  it('rejects non-whitelisted hosts (no arbitrary external hotlink)', () => {
    expect(sanitizeAssetUrl('https://evil.com/a.png')).toBeNull()
  })

  it('rejects mailto for assets', () => {
    expect(sanitizeAssetUrl('mailto:a@b.com')).toBeNull()
  })

  it('rejects javascript/data pseudo-protocols', () => {
    expect(sanitizeAssetUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeAssetUrl('data:image/svg+xml,<svg>')).toBeNull()
  })

  it('allows the page same-origin host by default (covers self-served / same-origin-proxied assets)', () => {
    // The ASSET_HOST_WHITELIST seeds the page's own origin host (jsdom: localhost:3000) so a
    // deployment serving images from its own origin renders them without an explicit
    // VITE_DOCS_ASSET_HOSTS. A genuinely cross-origin object store (different host:port) is
    // still rejected unless explicitly whitelisted.
    const sameOrigin = `${window.location.origin}/docs/d_1/attachments/a_1`
    expect(sanitizeAssetUrl(sameOrigin)).toBe(sameOrigin)
    // A different host (e.g. a standalone MinIO on another port) is NOT auto-trusted.
    expect(sanitizeAssetUrl('http://192.168.214.189:9000/bucket/a.png')).toBeNull()
  })
})

describe('sanitizeSrcset', () => {
  it('keeps only valid candidates', () => {
    const input = 'https://assets.octo.example.com/a.png 1x, https://evil.com/b.png 2x'
    expect(sanitizeSrcset(input)).toBe('https://assets.octo.example.com/a.png 1x')
  })
  it('returns null when no candidate survives', () => {
    expect(sanitizeSrcset('https://evil.com/a.png 1x')).toBeNull()
  })
})

describe('renderLinkAttrs', () => {
  it('adds rel for safe links', () => {
    expect(renderLinkAttrs('https://example.com')).toEqual({
      href: 'https://example.com/',
      rel: 'noopener noreferrer',
    })
  })
  it('nulls href for unsafe links', () => {
    expect(renderLinkAttrs('javascript:alert(1)')).toEqual({ href: null })
  })
})
