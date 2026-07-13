import { describe, it, expect } from 'vitest'
import { normalizeDocxColor, buildRunOptionsFromMarks } from './marks.ts'

// <w:color w:val="…"/> requires a bare 6-hex value. Authored content from the
// in-app picker is already #rrggbb, but pasted/imported content can carry
// rgb(…) or short #abc forms the browser produced. Passing those straight
// through yields OOXML Word rejects as corrupt, so normalizeDocxColor maps what
// it can to 6-hex and drops the rest.
describe('normalizeDocxColor', () => {
  it('passes through 6-hex (with or without #), lowercased', () => {
    expect(normalizeDocxColor('#FF0000')).toBe('ff0000')
    expect(normalizeDocxColor('abcdef')).toBe('abcdef')
  })

  it('expands short #abc / abc to 6-hex', () => {
    expect(normalizeDocxColor('#abc')).toBe('aabbcc')
    expect(normalizeDocxColor('f0a')).toBe('ff00aa')
  })

  it('converts rgb()/rgba() with 0-255 components to 6-hex', () => {
    expect(normalizeDocxColor('rgb(255, 0, 0)')).toBe('ff0000')
    expect(normalizeDocxColor('rgba(0, 128, 255, 0.5)')).toBe('0080ff')
  })

  it('drops (returns null) values it cannot safely map', () => {
    expect(normalizeDocxColor('red')).toBeNull() // named colour
    expect(normalizeDocxColor('hsl(0, 100%, 50%)')).toBeNull()
    expect(normalizeDocxColor('rgb(300, 0, 0)')).toBeNull() // out of range
    expect(normalizeDocxColor('#12g')).toBeNull()
    expect(normalizeDocxColor('')).toBeNull()
  })
})

// <w:sz w:val="…"/> is in half-points. A hostile/corrupt textStyle fontSize can
// carry a negative, zero, non-finite, or absurd value; an out-of-range w:sz
// produces invalid/unusable OOXML, so buildRunOptionsFromMarks clamps it.
describe('buildRunOptionsFromMarks — fontSize clamp', () => {
  const sizeOf = (fontSize: string) =>
    buildRunOptionsFromMarks([{ type: 'textStyle', attrs: { fontSize } }]).size

  it('converts a normal pt size to half-points', () => {
    expect(sizeOf('16px')).toBe(32)
    expect(sizeOf('12')).toBe(24)
  })

  it('clamps an absurd size to the max (3276 half-points)', () => {
    expect(sizeOf('100000px')).toBe(3276)
  })

  it('drops non-positive / non-finite sizes', () => {
    expect(sizeOf('0')).toBeUndefined()
    expect(sizeOf('-12px')).toBeUndefined()
    expect(sizeOf('NaNpx')).toBeUndefined()
    expect(sizeOf('abc')).toBeUndefined()
  })

  it('clamps a tiny sub-1pt size up to the min (2 half-points)', () => {
    expect(sizeOf('0.1px')).toBe(2)
  })
})
