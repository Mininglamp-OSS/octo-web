import { describe, it, expect } from 'vitest'
import { isSafeReturnTo, safeReturnTo } from './safeReturnTo.ts'

describe('safeReturnTo open-redirect guard', () => {
  it('allows internal /docs/ paths', () => {
    expect(isSafeReturnTo('/docs')).toBe(true)
    expect(isSafeReturnTo('/docs/invite/abc')).toBe(true)
    expect(isSafeReturnTo('/docs/d_1?x=1')).toBe(true)
  })

  it('rejects non-docs internal paths', () => {
    expect(isSafeReturnTo('/admin')).toBe(false)
    expect(isSafeReturnTo('/')).toBe(false)
  })

  it('rejects absolute URLs', () => {
    expect(isSafeReturnTo('https://evil.com/docs')).toBe(false)
    expect(isSafeReturnTo('http://evil.com')).toBe(false)
  })

  it('rejects protocol-relative //host', () => {
    expect(isSafeReturnTo('//evil.com/docs')).toBe(false)
  })

  it('rejects backslash tricks', () => {
    expect(isSafeReturnTo('/\\evil.com')).toBe(false)
    expect(isSafeReturnTo('/docs\\..\\admin')).toBe(false)
  })

  it('rejects embedded scheme', () => {
    expect(isSafeReturnTo('/javascript:alert(1)')).toBe(false)
  })

  it('rejects non-strings / empty', () => {
    expect(isSafeReturnTo('')).toBe(false)
    expect(isSafeReturnTo(null)).toBe(false)
    expect(isSafeReturnTo(123)).toBe(false)
  })

  it('safeReturnTo falls back to /docs for unsafe values', () => {
    expect(safeReturnTo('https://evil.com')).toBe('/docs')
    expect(safeReturnTo('/docs/invite/x')).toBe('/docs/invite/x')
  })
})
