import { describe, it, expect } from 'vitest'
import { extractLinkHref } from './marks.ts'
import { isSafeHref } from './nodes.ts'

describe('extractLinkHref — scheme allowlist', () => {
  const mk = (href: string) => [{ type: 'link', attrs: { href } }]

  it('allows https URLs', () => {
    expect(extractLinkHref(mk('https://example.com'))).toBe('https://example.com')
  })

  it('allows http URLs', () => {
    expect(extractLinkHref(mk('http://example.com'))).toBe('http://example.com')
  })

  it('allows mailto URLs', () => {
    expect(extractLinkHref(mk('mailto:a@b.com'))).toBe('mailto:a@b.com')
  })

  it('allows tel URLs', () => {
    expect(extractLinkHref(mk('tel:+1234567890'))).toBe('tel:+1234567890')
  })

  it('allows relative URLs (no scheme)', () => {
    expect(extractLinkHref(mk('/docs/abc'))).toBe('/docs/abc')
    expect(extractLinkHref(mk('docs/abc'))).toBe('docs/abc')
  })

  it('rejects javascript: URLs', () => {
    expect(extractLinkHref(mk('javascript:alert(1)'))).toBeNull()
  })

  it('rejects data: URLs', () => {
    expect(extractLinkHref(mk('data:text/html,<script>alert(1)</script>'))).toBeNull()
  })

  it('rejects file: URLs', () => {
    expect(extractLinkHref(mk('file:///etc/passwd'))).toBeNull()
  })

  it('rejects vbscript: URLs', () => {
    expect(extractLinkHref(mk('vbscript:msgbox(1)'))).toBeNull()
  })

  it('rejects UNC paths (backslash)', () => {
    expect(extractLinkHref(mk('\\\\server\\share'))).toBeNull()
  })

  it('rejects protocol-relative URLs (//host)', () => {
    expect(extractLinkHref(mk('//evil.com/x'))).toBeNull()
  })

  it('returns null for non-string href', () => {
    expect(extractLinkHref([{ type: 'link', attrs: { href: 123 } }])).toBeNull()
  })

  it('returns null when no link mark exists', () => {
    expect(extractLinkHref([{ type: 'bold' }])).toBeNull()
  })
})

describe('isSafeHref — scheme allowlist', () => {
  it('allows https/http/mailto/tel', () => {
    expect(isSafeHref('https://a.com')).toBe(true)
    expect(isSafeHref('http://a.com')).toBe(true)
    expect(isSafeHref('mailto:a@b.com')).toBe(true)
    expect(isSafeHref('tel:+1')).toBe(true)
  })

  it('allows relative URLs', () => {
    expect(isSafeHref('/path')).toBe(true)
    expect(isSafeHref('path')).toBe(true)
  })

  it('rejects javascript/data/file/vbscript', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false)
    expect(isSafeHref('data:text/html,x')).toBe(false)
    expect(isSafeHref('file:///etc/passwd')).toBe(false)
    expect(isSafeHref('vbscript:msgbox(1)')).toBe(false)
  })

  it('rejects UNC and protocol-relative', () => {
    expect(isSafeHref('\\\\server\\share')).toBe(false)
    expect(isSafeHref('//evil.com')).toBe(false)
  })
})
