// Shared colour palette for the editor toolbar (plan A: unify highlight + font-colour presets).
//
// Before this, the highlight and text-colour pickers each hard-coded their own independent 10-colour
// array with no common source, so the two popovers disagreed on both count and hue order. Plan A
// introduces a single hue base, PALETTE_HUES, and DERIVES both preset lists from it:
//   - TEXT_COLORS      = the saturated hue itself (readable as foreground text)
//   - HIGHLIGHT_COLORS = a light tint of the SAME hue at the SAME index (readable as a text
//                        background, i.e. dark glyphs stay legible on top of it)
// so the Nth highlight swatch is the light version of the Nth text swatch — same count, same hue
// order, same column ↦ same colour family across both pickers.
//
// The foreground/background contrast difference is intentional and preserved: highlights must be
// light so dark text on top stays readable, while font colours are saturated so they read as ink.
// That is exactly what deriving the highlight tint via toHighlightTint() (mix the hue toward white)
// guarantees for every hue at once, instead of two lists drifting apart by hand.
//
// All values are emitted as #rrggbb hex, so they round-trip losslessly through Yjs collaboration and
// the DOCX/Markdown exporters (normalizeDocxColor). Existing document marks store their own literal
// hex, so changing these presets never rewrites or migrates already-highlighted content.

/** Fraction each saturated hue is mixed toward white to produce its light highlight tint. */
export const HIGHLIGHT_TINT = 0.8

/**
 * Mix a #rrggbb colour toward white by `amount` (0 = unchanged, 1 = white) and return #rrggbb.
 * A linear mix toward white keeps the hue and only lifts the lightness, which is what turns a
 * saturated font colour into its matching light highlight background.
 */
export function toHighlightTint(hex: string, amount: number = HIGHLIGHT_TINT): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) throw new Error(`toHighlightTint expects #rrggbb, got: ${hex}`)
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const lift = (c: number) => Math.round(c + (255 - c) * amount)
  const to2 = (c: number) => lift(c).toString(16).padStart(2, '0')
  return `#${to2(r)}${to2(g)}${to2(b)}`
}

/**
 * Normalise a user-typed hex string to a canonical lowercase `#rrggbb`, or return null if it is not
 * a valid 3- or 6-digit hex colour. Accepts an optional leading `#`, surrounding whitespace, and any
 * case; expands the 3-digit shorthand (`#f00` → `#ff0000`). This is the input-side counterpart to the
 * preset swatches: it lets the font-colour popover accept an arbitrary hex typed/pasted directly
 * (the "hex 输入" path in #719), OS-dialog-independent, and emits the same `#rrggbb` shape the presets
 * use — so setColor stays lossless through Yjs collaboration and the DOCX/Markdown exporters.
 */
export function normalizeHexColor(raw: string): string | null {
  const s = raw.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    const [r, g, b] = s
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`.toLowerCase()
  return null
}

/**
 * Shared hue base. `text` is the saturated foreground colour; the matching highlight background is
 * derived from it. Ordered neutrals-first (ink, grey) then warm→cool, mirroring the established
 * font-colour identity set so the text picker keeps its familiar swatches.
 */
export const PALETTE_HUES = [
  { name: 'ink', text: '#1f2329' },
  { name: 'grey', text: '#8a919e' },
  { name: 'red', text: '#e03131' },
  { name: 'orange', text: '#f08c00' },
  { name: 'amber', text: '#f2b705' },
  { name: 'green', text: '#2f9e44' },
  { name: 'teal', text: '#0ca678' },
  { name: 'blue', text: '#1971c2' },
  { name: 'indigo', text: '#3370ff' },
  { name: 'purple', text: '#9c36b5' },
] as const

/** Saturated font colours — the hue base itself, one per column. */
export const TEXT_COLORS = PALETTE_HUES.map((h) => h.text) as readonly string[]

/** Light highlight backgrounds — same hue, same column, tinted toward white for dark-text contrast. */
export const HIGHLIGHT_COLORS = PALETTE_HUES.map((h) => toHighlightTint(h.text)) as readonly string[]
