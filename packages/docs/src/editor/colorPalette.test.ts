import { describe, it, expect } from 'vitest'
import {
  PALETTE_HUES,
  TEXT_COLORS,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_TINT,
  toHighlightTint,
  normalizeHexColor,
} from './colorPalette.ts'

// Plan A: the highlight and font-colour presets are DERIVED from one shared hue base so the two
// pickers can never drift apart in count, order, or hue family again. These tests pin that
// relationship (not just the current literal values), so a future edit to PALETTE_HUES that breaks
// the "same count / same order / Nth highlight = light of Nth text" contract fails loudly.

const HEX = /^#[0-9a-f]{6}$/

function relLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  // Perceived brightness proxy (sRGB weighted); good enough to assert "highlight is lighter".
  return 0.2126 * ((n >> 16) & 0xff) + 0.7152 * ((n >> 8) & 0xff) + 0.0722 * (n & 0xff)
}

describe('colorPalette — shared hue base (plan A)', () => {
  it('derives both preset lists from the same hue base, one entry per hue', () => {
    expect(TEXT_COLORS).toHaveLength(PALETTE_HUES.length)
    expect(HIGHLIGHT_COLORS).toHaveLength(PALETTE_HUES.length)
    expect(TEXT_COLORS).toHaveLength(HIGHLIGHT_COLORS.length)
  })

  it('emits every swatch as lossless #rrggbb hex (DOCX/Markdown/Yjs safe)', () => {
    for (const c of [...TEXT_COLORS, ...HIGHLIGHT_COLORS]) expect(c).toMatch(HEX)
  })

  it('keeps TEXT_COLORS as the saturated hue base itself, in order', () => {
    expect([...TEXT_COLORS]).toEqual(PALETTE_HUES.map((h) => h.text))
  })

  it('makes the Nth highlight the light tint of the Nth text colour (same hue, same column)', () => {
    HIGHLIGHT_COLORS.forEach((highlight, i) => {
      expect(highlight).toBe(toHighlightTint(TEXT_COLORS[i]))
    })
  })

  it('keeps every highlight lighter than its matching font colour (foreground/background contrast)', () => {
    HIGHLIGHT_COLORS.forEach((highlight, i) => {
      expect(relLuminance(highlight)).toBeGreaterThan(relLuminance(TEXT_COLORS[i]))
    })
  })
})

describe('colorPalette — toHighlightTint', () => {
  it('leaves a colour unchanged at amount 0 and returns white at amount 1', () => {
    expect(toHighlightTint('#3370ff', 0)).toBe('#3370ff')
    expect(toHighlightTint('#3370ff', 1)).toBe('#ffffff')
  })

  it('mixes toward white by the default tint, lifting each channel', () => {
    // #e03131 → light pink at the shared HIGHLIGHT_TINT.
    expect(toHighlightTint('#e03131', HIGHLIGHT_TINT)).toBe('#f9d6d6')
  })

  it('rejects a non-#rrggbb input rather than emit a broken swatch', () => {
    expect(() => toHighlightTint('red')).toThrow()
    expect(() => toHighlightTint('#fff')).toThrow()
  })
})

describe('colorPalette — normalizeHexColor', () => {
  it('accepts a 6-digit hex with or without the leading # and lowercases it', () => {
    expect(normalizeHexColor('#3370FF')).toBe('#3370ff')
    expect(normalizeHexColor('3370ff')).toBe('#3370ff')
  })

  it('expands the 3-digit shorthand to #rrggbb', () => {
    expect(normalizeHexColor('#f00')).toBe('#ff0000')
    expect(normalizeHexColor('abc')).toBe('#aabbcc')
  })

  it('trims surrounding whitespace before parsing', () => {
    expect(normalizeHexColor('  #1971c2  ')).toBe('#1971c2')
  })

  it('emits the same #rrggbb shape as the presets so it round-trips losslessly', () => {
    TEXT_COLORS.forEach((c) => {
      expect(normalizeHexColor(c)).toBe(c)
      expect(normalizeHexColor(c)).toMatch(/^#[0-9a-f]{6}$/)
    })
  })

  it('returns null for anything that is not a 3-/6-digit hex', () => {
    expect(normalizeHexColor('')).toBeNull()
    expect(normalizeHexColor('#ff')).toBeNull()
    expect(normalizeHexColor('#ffff')).toBeNull()
    expect(normalizeHexColor('#gggggg')).toBeNull()
    expect(normalizeHexColor('rgb(0,0,0)')).toBeNull()
    expect(normalizeHexColor('red')).toBeNull()
  })
})
