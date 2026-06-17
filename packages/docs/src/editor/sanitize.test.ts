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
