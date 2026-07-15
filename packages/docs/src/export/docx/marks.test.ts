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

// v16: the textStyle fontFamily attr carries a CSS font-family stack; docx runs want a single
// real face name, so buildRunOptionsFromMarks takes the first family, strips quotes, and drops
// generic CSS keywords (which are not .docx font names). The `code` mark's monospace font wins.
describe('buildRunOptionsFromMarks — fontFamily', () => {
  const fontOf = (fontFamily: string) =>
    buildRunOptionsFromMarks([{ type: 'textStyle', attrs: { fontFamily } }]).font

  it('takes the first family from a stack and strips quotes', () => {
    expect(fontOf('SimSun, "宋体", serif')).toBe('SimSun')
    expect(fontOf('"Times New Roman", Times, serif')).toBe('Times New Roman')
    expect(fontOf('Arial, Helvetica, sans-serif')).toBe('Arial')
  })

  it('drops a bare generic keyword (not a real docx font name)', () => {
    expect(fontOf('serif')).toBeUndefined()
    expect(fontOf('sans-serif')).toBeUndefined()
    expect(fontOf('')).toBeUndefined()
  })

  it('lets the code mark font win over a textStyle fontFamily', () => {
    // Order-independent: the code branch pins the monospace face and the fontFamily
    // branch must not overwrite it, whichever mark is processed first.
    const a = buildRunOptionsFromMarks([
      { type: 'code' },
      { type: 'textStyle', attrs: { fontFamily: 'Arial' } },
    ]).font
    const b = buildRunOptionsFromMarks([
      { type: 'textStyle', attrs: { fontFamily: 'Arial' } },
      { type: 'code' },
    ]).font
    expect(a).toBe(b)
    expect(a).not.toBe('Arial')
  })
})

// The editor's Highlight extension is multicolor: the chosen background rides on
// the mark's `color` attr. Word's `w:highlight` only supports ~16 named colours,
// so an arbitrary hex is emitted as `w:shd` (shading fill) instead, which the
// importer reads back verbatim for a lossless round-trip.
describe('buildRunOptionsFromMarks — highlight colour', () => {
  it('emits an arbitrary highlight colour as a shading fill (not w:highlight)', () => {
    const opts = buildRunOptionsFromMarks([
      { type: 'highlight', attrs: { color: '#00FFCC' } },
    ])
    expect(opts.shading).toEqual({ type: 'clear', color: 'auto', fill: '00ffcc' })
    expect(opts.highlight).toBeUndefined()
  })

  it('normalises rgb()/short-hex highlight colours to 6-hex fill', () => {
    expect(
      buildRunOptionsFromMarks([{ type: 'highlight', attrs: { color: 'rgb(255, 0, 0)' } }])
        .shading,
    ).toEqual({ type: 'clear', color: 'auto', fill: 'ff0000' })
    expect(
      buildRunOptionsFromMarks([{ type: 'highlight', attrs: { color: '#fc0' } }]).shading,
    ).toEqual({ type: 'clear', color: 'auto', fill: 'ffcc00' })
  })

  it('falls back to a named yellow highlight when no usable colour is present', () => {
    expect(buildRunOptionsFromMarks([{ type: 'highlight' }]).highlight).toBe('yellow')
    // An unmappable colour (e.g. hsl) also degrades to the yellow fallback.
    expect(
      buildRunOptionsFromMarks([{ type: 'highlight', attrs: { color: 'hsl(0,100%,50%)' } }])
        .highlight,
    ).toBe('yellow')
  })
})
