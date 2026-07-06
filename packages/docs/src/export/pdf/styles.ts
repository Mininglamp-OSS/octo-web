/**
 * Style constants for PDF export.
 * Font sizes in points (pt), margins/spacing in millimeters (mm).
 */

/** Page dimensions in mm (A4). */
export const PAGE_WIDTH = 210
export const PAGE_HEIGHT = 297

/** Page margins in mm. */
export const MARGIN_TOP = 25
export const MARGIN_BOTTOM = 25
export const MARGIN_LEFT = 25
export const MARGIN_RIGHT = 25

/** Calculated content dimensions. */
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT
export const CONTENT_HEIGHT = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM

/** Font sizes in points. */
export const FONT_SIZE_BODY = 11
export const FONT_SIZE_H1 = 22
export const FONT_SIZE_H2 = 18
export const FONT_SIZE_H3 = 15
export const FONT_SIZE_H4 = 13
export const FONT_SIZE_H5 = 12
export const FONT_SIZE_H6 = 11
export const FONT_SIZE_CODE = 9
export const FONT_SIZE_SMALL = 9

/** Heading sizes lookup by level. */
export const HEADING_SIZES: Record<number, number> = {
  1: FONT_SIZE_H1,
  2: FONT_SIZE_H2,
  3: FONT_SIZE_H3,
  4: FONT_SIZE_H4,
  5: FONT_SIZE_H5,
  6: FONT_SIZE_H6,
}

/** Line height multiplier. */
export const LINE_HEIGHT = 1.5

/** Spacing in mm. */
export const PARAGRAPH_SPACING = 4
export const HEADING_SPACING_BEFORE = 8
export const HEADING_SPACING_AFTER = 4
export const LIST_INDENT = 6
export const CODE_BLOCK_PADDING = 3
export const BLOCKQUOTE_INDENT = 8

/** Colors (hex without #). */
export const COLOR_TEXT = '000000'
export const COLOR_LINK = '1A73E8'
export const COLOR_CODE_BG = 'F5F5F5'
export const COLOR_MUTED = '888888'
export const COLOR_BLOCKQUOTE = '555555'
export const COLOR_BORDER = 'CCCCCC'

/** Callout background colors. */
export const CALLOUT_COLORS: Record<string, string> = {
  info: 'E8F4FD',
  warn: 'FFF3CD',
  warning: 'FFF3CD',
  tip: 'D4EDDA',
  success: 'D4EDDA',
}

/** Callout emoji prefixes. */
export const CALLOUT_EMOJI: Record<string, string> = {
  info: 'ℹ️ ',
  warn: '⚠️ ',
  warning: '⚠️ ',
  tip: '💡 ',
  success: '✅ ',
}

/** Bullet characters by list level. */
export const BULLET_CHARS = ['•', '◦', '▪', '‣', '⁃']

/** List number formats by level. */
export type NumberFormat = 'decimal' | 'lower-alpha' | 'lower-roman'
export const NUMBER_FORMATS: NumberFormat[] = ['decimal', 'lower-alpha', 'lower-roman', 'decimal', 'lower-alpha']

/** Format a number according to the list level format. */
export function formatListNumber(num: number, level: number): string {
  const format = NUMBER_FORMATS[Math.min(level, NUMBER_FORMATS.length - 1)]
  switch (format) {
    case 'lower-alpha':
      return String.fromCharCode(96 + ((num - 1) % 26) + 1)
    case 'lower-roman':
      return toRoman(num).toLowerCase()
    default:
      return String(num)
  }
}

/** Convert number to Roman numerals. */
function toRoman(num: number): string {
  const values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1]
  const numerals = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I']
  let result = ''
  let n = num
  for (let i = 0; i < values.length; i++) {
    while (n >= values[i]) {
      result += numerals[i]
      n -= values[i]
    }
  }
  return result
}
