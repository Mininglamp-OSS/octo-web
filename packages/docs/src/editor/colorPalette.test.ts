import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_TEXT_COLOR,
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
  UNIVER_COLOR_PRESETS,
  normalizeHexColor,
} from './colorPalette.ts'

const HEX = /^#[0-9A-F]{6}$/

const EXPECTED_UNIVER_PRESETS = [
  ['#FFFFFF', '#E1EFFE', '#FDE8E8', '#FEECDC', '#FFF4B9', '#DEF7EC', '#D5F5F6', '#EDEBFE', '#FCE8F3'],
  ['#CDD0D8', '#A4CAFE', '#F8B4B4', '#FDBA8C', '#FAC815', '#84E1BC', '#7EDCE2', '#CABFFD', '#F8B4D9'],
  ['#979DAC', '#3F83F8', '#F05252', '#FF5A1F', '#D49D0F', '#0DA471', '#0694A2', '#9061F9', '#E74694'],
  ['#414657', '#1A56DB', '#C81E1E', '#B43403', '#9A6D15', '#046C4E', '#036672', '#6C2BD9', '#BF125D'],
  ['#000000', '#233876', '#771D1D', '#8A2C0D', '#634312', '#014737', '#014451', '#4A1D96', '#751A3D'],
]

describe('colorPalette — Univer Sheet parity', () => {
  it('pins the exact canonical 5×9 matrix and keeps opaque white as its first real colour', () => {
    expect(UNIVER_COLOR_PRESETS).toEqual(EXPECTED_UNIVER_PRESETS)
    expect(UNIVER_COLOR_PRESETS).toHaveLength(5)
    UNIVER_COLOR_PRESETS.forEach((row) => expect(row).toHaveLength(9))
    expect(UNIVER_COLOR_PRESETS[0][0]).toBe('#FFFFFF')
    expect(UNIVER_COLOR_PRESETS.flat()).not.toContain('transparent')
  })

  it('gives Doc and Board the same flat canonical palette', () => {
    expect(TEXT_COLORS).toEqual(UNIVER_COLOR_PRESETS.flat())
    expect(HIGHLIGHT_COLORS).toEqual(UNIVER_COLOR_PRESETS.flat())
    expect(TEXT_COLORS).toHaveLength(45)
    for (const color of TEXT_COLORS) expect(color).toMatch(HEX)
  })

  it('keeps useful split-button defaults independent of the first white swatch', () => {
    expect(DEFAULT_TEXT_COLOR).toBe('#000000')
    expect(DEFAULT_HIGHLIGHT_COLOR).toBe('#FFF4B9')
  })
})

describe('colorPalette — normalizeHexColor', () => {
  it('normalizes six-digit and shorthand hex values', () => {
    expect(normalizeHexColor('#3370FF')).toBe('#3370ff')
    expect(normalizeHexColor('3370ff')).toBe('#3370ff')
    expect(normalizeHexColor('#f00')).toBe('#ff0000')
    expect(normalizeHexColor('abc')).toBe('#aabbcc')
    expect(normalizeHexColor('  #1971c2  ')).toBe('#1971c2')
  })

  it('round-trips every preset modulo canonical lowercase normalization', () => {
    TEXT_COLORS.forEach((color) => expect(normalizeHexColor(color)).toBe(color.toLowerCase()))
  })

  it('rejects non-hex input', () => {
    for (const value of ['', '#ff', '#ffff', '#gggggg', 'rgb(0,0,0)', 'red', 'transparent']) {
      expect(normalizeHexColor(value)).toBeNull()
    }
  })
})
