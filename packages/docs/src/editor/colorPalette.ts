// The canonical preset palette used by Univer Sheet's @univerjs/design ColorPicker (5 rows × 9
// columns). Doc and Board consume this exact matrix so neither surface can drift from Sheet. The
// first swatch is an opaque white colour, not a transparent/clear sentinel; clearing remains a
// separate explicit action in ColorSplitControl.
export const UNIVER_COLOR_PRESETS = [
  ['#FFFFFF', '#E1EFFE', '#FDE8E8', '#FEECDC', '#FFF4B9', '#DEF7EC', '#D5F5F6', '#EDEBFE', '#FCE8F3'],
  ['#CDD0D8', '#A4CAFE', '#F8B4B4', '#FDBA8C', '#FAC815', '#84E1BC', '#7EDCE2', '#CABFFD', '#F8B4D9'],
  ['#979DAC', '#3F83F8', '#F05252', '#FF5A1F', '#D49D0F', '#0DA471', '#0694A2', '#9061F9', '#E74694'],
  ['#414657', '#1A56DB', '#C81E1E', '#B43403', '#9A6D15', '#046C4E', '#036672', '#6C2BD9', '#BF125D'],
  ['#000000', '#233876', '#771D1D', '#8A2C0D', '#634312', '#014737', '#014451', '#4A1D96', '#751A3D'],
] as const

/** Flat aliases retained for editor/board call sites that iterate the canonical presets. */
export const TEXT_COLORS = UNIVER_COLOR_PRESETS.flat() as readonly string[]
export const HIGHLIGHT_COLORS = UNIVER_COLOR_PRESETS.flat() as readonly string[]

/** Applying the split button before a pick should remain useful even though the first grid cell is white. */
export const DEFAULT_TEXT_COLOR = '#000000'
export const DEFAULT_HIGHLIGHT_COLOR = '#FFF4B9'

/**
 * Normalise a user-typed hex string to canonical lowercase `#rrggbb`, or return null. Accepts an
 * optional leading `#`, surrounding whitespace, and 3-/6-digit notation.
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
