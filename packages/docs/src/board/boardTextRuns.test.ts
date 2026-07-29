import { describe, expect, it } from 'vitest'
import {
  applyTextStyle,
  clearTextStyleProperties,
  normalizeTextRuns,
  parseTextRuns,
  serializeTextRuns,
  transformTextRuns,
  type BoardTextRun,
} from './boardTextRuns.ts'

describe('boardTextRuns', () => {
  it('normalizes overlaps by property, splits ranges, clamps, and merges equal neighbors', () => {
    expect(
      normalizeTextRuns(
        [
          { start: -3, end: 4, bold: true, color: 'red' },
          { start: 2, end: 8, italic: true },
          { start: 4, end: 20, bold: true, color: 'red' },
        ],
        10,
      ),
    ).toEqual([
      { start: 0, end: 2, bold: true, color: 'red' },
      { start: 2, end: 8, bold: true, italic: true, color: 'red' },
      { start: 8, end: 10, bold: true, color: 'red' },
    ])

    expect(
      normalizeTextRuns(
        [
          { start: 0, end: 2, underline: true },
          { start: 2, end: 4, underline: true },
        ],
        4,
      ),
    ).toEqual([{ start: 0, end: 4, underline: true }])
  })

  it('applies a partial style only to the selection and removes only null properties', () => {
    const runs: BoardTextRun[] = [{ start: 0, end: 6, bold: true, color: 'red' }]
    expect(applyTextStyle(runs, 2, 4, { bold: null, italic: true }, 6)).toEqual([
      { start: 0, end: 2, bold: true, color: 'red' },
      { start: 2, end: 4, italic: true, color: 'red' },
      { start: 4, end: 6, bold: true, color: 'red' },
    ])
  })

  it('retains explicit false to override an element-level true style', () => {
    expect(applyTextStyle([], 1, 3, { bold: false, underline: false }, 4)).toEqual([
      { start: 1, end: 3, bold: false, underline: false },
    ])
  })

  it('drops only properties superseded by a whole-element style', () => {
    expect(clearTextStyleProperties([
      { start: 0, end: 2, color: 'red', bold: true },
      { start: 2, end: 4, color: 'green', italic: true },
    ], ['color', 'bold'], 4)).toEqual([
      { start: 2, end: 4, italic: true },
    ])
  })

  it('uses textarea-compatible UTF-16 offsets for emoji', () => {
    const text = 'A😀B'
    expect(text.length).toBe(4)
    expect(applyTextStyle([], 1, 3, { bold: true }, text.length)).toEqual([
      { start: 1, end: 3, bold: true },
    ])
    expect(transformTextRuns([{ start: 3, end: 4, italic: true }], text, 'A😀xB')).toEqual([
      { start: 4, end: 5, italic: true },
    ])
  })

  it('preserves unaffected runs and shifts them after insertion', () => {
    expect(
      transformTextRuns(
        [
          { start: 0, end: 2, bold: true },
          { start: 2, end: 4, italic: true },
        ],
        'abcd',
        'abXYcd',
        { underline: true },
      ),
    ).toEqual([
      { start: 0, end: 2, bold: true },
      { start: 2, end: 4, underline: true },
      { start: 4, end: 6, italic: true },
    ])
  })

  it('trims intersecting runs and shifts the suffix after deletion', () => {
    expect(
      transformTextRuns(
        [
          { start: 0, end: 3, bold: true },
          { start: 3, end: 6, italic: true },
        ],
        'abcdef',
        'abef',
      ),
    ).toEqual([
      { start: 0, end: 2, bold: true },
      { start: 2, end: 4, italic: true },
    ])
  })

  it('styles replacement text from the supplied active/caret style', () => {
    expect(
      transformTextRuns(
        [
          { start: 0, end: 2, bold: true },
          { start: 2, end: 4, color: 'red' },
          { start: 4, end: 6, italic: true },
        ],
        'abcdef',
        'abXYZef',
        { bold: false, fontSize: 24 },
      ),
    ).toEqual([
      { start: 0, end: 2, bold: true },
      { start: 2, end: 5, fontSize: 24, bold: false },
      { start: 5, end: 7, italic: true },
    ])
  })

  it('parses untrusted customData defensively and serializes normalized data', () => {
    const customData = {
      textRuns: [
        null,
        { start: '0', end: 2, bold: true },
        { start: 0, end: 2, bold: 'yes', italic: true, color: 123 },
        { start: 2, end: 99, italic: true },
        { start: 1, end: Number.NaN, underline: true },
      ],
    }
    const expected = [{ start: 0, end: 5, italic: true }]
    expect(parseTextRuns(customData, 5)).toEqual(expected)
    expect(parseTextRuns({ textRuns: 'bad' }, 5)).toEqual([])
    expect(parseTextRuns(null, 5)).toEqual([])
    expect(serializeTextRuns(expected, 3)).toEqual({
      textRuns: [{ start: 0, end: 3, italic: true }],
    })
  })
})
