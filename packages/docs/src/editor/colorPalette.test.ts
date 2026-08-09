import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_TEXT_COLOR,
  HIGHLIGHT_TINT,
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
  UNIVER_COLOR_PRESETS,
  normalizeHexColor,
  toHighlightTint,
} from './colorPalette.ts'

const HEX = /^#[0-9A-F]{6}$/

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

const EXPECTED_UNIVER_PRESETS = [
  ['#FFFFFF', '#E1EFFE', '#FDE8E8', '#FEECDC', '#FFF4B9', '#DEF7EC', '#D5F5F6', '#EDEBFE', '#FCE8F3'],
  ['#CDD0D8', '#A4CAFE', '#F8B4B4', '#FDBA8C', '#FAC815', '#84E1BC', '#7EDCE2', '#CABFFD', '#F8B4D9'],
  ['#979DAC', '#3F83F8', '#F05252', '#FF5A1F', '#D49D0F', '#0DA471', '#0694A2', '#9061F9', '#E74694'],
  ['#414657', '#1A56DB', '#C81E1E', '#B43403', '#9A6D15', '#046C4E', '#036672', '#6C2BD9', '#BF125D'],
  ['#000000', '#233876', '#771D1D', '#8A2C0D', '#634312', '#014737', '#014451', '#4A1D96', '#751A3D'],
]

describe('colorPalette — Univer Sheet parity', () => {
  it('matches the preset order shipped by the pinned @univerjs/design runtime', () => {
    // The package does not export colorPresets. Read its pinned runtime source instead of rendering
    // 45 implementation-detail buttons in jsdom: this trips on a dependency upgrade/order change,
    // while remaining independent of CSS, layout, browser colour serialization, and translations.
    const designEntry = createRequire(import.meta.url).resolve('@univerjs/design')
    const source = readFileSync(designEntry, 'utf8')
    const presetModule = source.match(/(?:const|var) colorPresets\s*=\s*(\[[\s\S]*?\n\]);/)
    expect(presetModule, 'pinned Univer runtime must expose its colorPresets literal').not.toBeNull()
    expect(JSON.parse(presetModule![1])).toEqual(UNIVER_COLOR_PRESETS)
  })

  it('pins the exact canonical 5×9 matrix and keeps opaque white as its first real colour', () => {
    expect(UNIVER_COLOR_PRESETS).toEqual(EXPECTED_UNIVER_PRESETS)
    expect(UNIVER_COLOR_PRESETS).toHaveLength(5)
    UNIVER_COLOR_PRESETS.forEach((row) => expect(row).toHaveLength(9))
    expect(UNIVER_COLOR_PRESETS[0][0]).toBe('#FFFFFF')
    expect(UNIVER_COLOR_PRESETS.flat()).not.toContain('transparent')
  })

  it('keeps the text palette as the exact flat canonical palette', () => {
    expect(TEXT_COLORS).toEqual(UNIVER_COLOR_PRESETS.flat())
    expect(TEXT_COLORS).toHaveLength(45)
    for (const color of TEXT_COLORS) expect(color).toMatch(HEX)
  })

  it('derives one light highlight per canonical swatch without changing preset order', () => {
    expect(HIGHLIGHT_COLORS).toHaveLength(45)
    expect(HIGHLIGHT_COLORS).toEqual(TEXT_COLORS.map((color) => toHighlightTint(color)))
    expect(HIGHLIGHT_COLORS[0]).toBe('#ffffff')
    expect(HIGHLIGHT_COLORS.at(-9)).toBe(toHighlightTint('#000000'))
    expect(HIGHLIGHT_COLORS).not.toContain('#000000')
  })

  it('keeps every highlight legible behind ordinary dark text', () => {
    for (const highlight of HIGHLIGHT_COLORS) {
      expect(contrastRatio(highlight, '#1F2329')).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps useful split-button defaults independent of the first white swatch', () => {
    expect(DEFAULT_TEXT_COLOR).toBe('#000000')
    expect(DEFAULT_HIGHLIGHT_COLOR).toBe('#FFF4B9')
  })
})

describe('colorPalette — highlight tint', () => {
  it('preserves the endpoints and restores the established 80% light tint', () => {
    expect(toHighlightTint('#3370ff', 0)).toBe('#3370ff')
    expect(toHighlightTint('#3370ff', 1)).toBe('#ffffff')
    expect(toHighlightTint('#e03131', HIGHLIGHT_TINT)).toBe('#f9d6d6')
  })

  it('rejects values outside the canonical six-digit hex structure', () => {
    expect(() => toHighlightTint('black')).toThrow()
    expect(() => toHighlightTint('#fff')).toThrow()
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
