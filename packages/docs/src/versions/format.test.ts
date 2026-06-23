import { describe, it, expect } from 'vitest'
import { formatRelative, formatAbsolute, autosaveLabel, type Translate } from './format.ts'

// A fake translator that echoes the key and appends interpolated values, so the tests
// assert on the branching logic (which key + which value) without depending on a locale.
const fakeT: Translate = (key, opts) => {
  const values = opts?.values
  if (!values) return key
  const parts = Object.entries(values).map(([k, v]) => `${k}=${String(v)}`)
  return `${key}(${parts.join(',')})`
}

const ISO = '2026-06-01T12:00:00.000Z'
const base = new Date(ISO).getTime()

describe('formatRelative (i18n-aware)', () => {
  it('returns the input unchanged for an unparseable date', () => {
    expect(formatRelative('not-a-date', fakeT)).toBe('not-a-date')
  })

  it('uses justNow under a minute', () => {
    expect(formatRelative(ISO, fakeT, base + 30_000)).toBe('docs.time.justNow')
  })

  it('uses minutesAgo with the floored minute count', () => {
    expect(formatRelative(ISO, fakeT, base + 5 * 60_000 + 999)).toBe('docs.time.minutesAgo(n=5)')
  })

  it('uses hoursAgo with the floored hour count', () => {
    expect(formatRelative(ISO, fakeT, base + 3 * 3_600_000)).toBe('docs.time.hoursAgo(n=3)')
  })

  it('uses daysAgo with the floored day count', () => {
    expect(formatRelative(ISO, fakeT, base + 2 * 86_400_000)).toBe('docs.time.daysAgo(n=2)')
  })

  it('falls back to a locale date beyond 7 days', () => {
    const out = formatRelative(ISO, fakeT, base + 30 * 86_400_000)
    expect(out).not.toContain('docs.time.')
    expect(out).toBe(new Date(ISO).toLocaleDateString())
  })
})

describe('formatAbsolute', () => {
  it('returns the input for an unparseable date', () => {
    expect(formatAbsolute('nope')).toBe('nope')
  })
  it('returns a locale string for a valid date', () => {
    expect(formatAbsolute(ISO)).toBe(new Date(ISO).toLocaleString())
  })
})

describe('autosaveLabel (i18n-aware)', () => {
  it('uses the plain key for an unparseable date', () => {
    expect(autosaveLabel('nope', fakeT)).toBe('docs.time.autosavePlain')
  })
  it('interpolates HH:mm into the autosave key', () => {
    const d = new Date(ISO)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    expect(autosaveLabel(ISO, fakeT)).toBe(`docs.time.autosave(time=${hh}:${mm})`)
  })
})
