/**
 * Global style configuration for the DOCX export.
 * Chinese font support: 微软雅黑 for body, 微软雅黑 bold for headings.
 */

import {
  type IStylesOptions,
  type IParagraphStyleOptions,
  type ISpacingProperties,
  HeadingLevel,
  AlignmentType,
  LineRuleType,
} from 'docx'
import { sanitizeLineHeight, sanitizeSpacing } from '../../editor/LineHeight.ts'

/** Default font for body text. */
export const FONT_BODY = '微软雅黑'

/** Default font for headings. */
export const FONT_HEADING = '微软雅黑'

/** Monospace font for code. */
export const FONT_CODE = 'Consolas'

/** Fallback monospace fonts. */
export const FONT_CODE_FALLBACK = 'Courier New'

/**
 * Emoji font. 微软雅黑 (the body font) has no emoji glyphs, so emoji inherit it
 * and render as blank boxes in Word/WPS. Segoe UI Emoji is the standard Windows
 * emoji font (used by WPS and Word on Windows); Word on macOS falls back to
 * Apple Color Emoji automatically. Applying it only to emoji runs keeps CJK text
 * on 微软雅黑.
 */
export const FONT_EMOJI = 'Segoe UI Emoji'

/** Standard heading sizes in half-points. */
const HEADING_SIZES: Record<string, number> = {
  [HeadingLevel.HEADING_1]: 36, // 18pt
  [HeadingLevel.HEADING_2]: 32, // 16pt
  [HeadingLevel.HEADING_3]: 28, // 14pt
  [HeadingLevel.HEADING_4]: 26, // 13pt
  [HeadingLevel.HEADING_5]: 24, // 12pt
  [HeadingLevel.HEADING_6]: 22, // 11pt
}

/** Create the default styles for the document. */
export function createDefaultStyles(): NonNullable<IStylesOptions['default']> {
  return {
    document: {
      run: {
        font: FONT_BODY,
        size: 24, // 12pt in half-points
      },
      paragraph: {
        spacing: { after: 120, line: 276 },
      },
    },
    heading1: {
      run: {
        font: FONT_HEADING,
        size: HEADING_SIZES[HeadingLevel.HEADING_1],
        bold: true,
      },
      paragraph: {
        spacing: { before: 240, after: 120 },
      },
    },
    heading2: {
      run: {
        font: FONT_HEADING,
        size: HEADING_SIZES[HeadingLevel.HEADING_2],
        bold: true,
      },
      paragraph: {
        spacing: { before: 200, after: 100 },
      },
    },
    heading3: {
      run: {
        font: FONT_HEADING,
        size: HEADING_SIZES[HeadingLevel.HEADING_3],
        bold: true,
      },
      paragraph: {
        spacing: { before: 160, after: 80 },
      },
    },
    heading4: {
      run: {
        font: FONT_HEADING,
        size: HEADING_SIZES[HeadingLevel.HEADING_4],
        bold: true,
      },
      paragraph: {
        spacing: { before: 120, after: 60 },
      },
    },
    heading5: {
      run: {
        font: FONT_HEADING,
        size: HEADING_SIZES[HeadingLevel.HEADING_5],
        bold: true,
      },
      paragraph: {
        spacing: { before: 100, after: 60 },
      },
    },
    heading6: {
      run: {
        font: FONT_HEADING,
        size: HEADING_SIZES[HeadingLevel.HEADING_6],
        bold: true,
      },
      paragraph: {
        spacing: { before: 80, after: 40 },
      },
    },
  }
}

/** Custom paragraph styles (e.g. code block, blockquote). */
export function createParagraphStyles(): IParagraphStyleOptions[] {
  return [
    {
      id: 'CodeBlock',
      name: 'Code Block',
      basedOn: 'Normal',
      run: {
        font: FONT_CODE,
        size: 20, // 10pt
      },
      paragraph: {
        spacing: { before: 60, after: 60, line: 240 },
        shading: { fill: 'F5F5F5' },
      },
    },
    {
      id: 'BlockQuote',
      name: 'Block Quote',
      basedOn: 'Normal',
      run: {
        italics: true,
        color: '555555',
      },
      paragraph: {
        spacing: { before: 80, after: 80 },
        indent: { left: 720 }, // 0.5 inch indent
      },
    },
    {
      id: 'CalloutInfo',
      name: 'Callout Info',
      basedOn: 'Normal',
      paragraph: {
        spacing: { before: 60, after: 60 },
        indent: { left: 360 },
        shading: { fill: 'E8F4FD' },
      },
    },
    {
      id: 'CalloutWarn',
      name: 'Callout Warning',
      basedOn: 'Normal',
      paragraph: {
        spacing: { before: 60, after: 60 },
        indent: { left: 360 },
        shading: { fill: 'FFF3CD' },
      },
    },
    {
      id: 'CalloutTip',
      name: 'Callout Tip',
      basedOn: 'Normal',
      paragraph: {
        spacing: { before: 60, after: 60 },
        indent: { left: 360 },
        shading: { fill: 'D4EDDA' },
      },
    },
    {
      id: 'CalloutSuccess',
      name: 'Callout Success',
      basedOn: 'Normal',
      paragraph: {
        spacing: { before: 60, after: 60 },
        indent: { left: 360 },
        shading: { fill: 'D4EDDA' },
      },
    },
    {
      // Summary line of a collapsible <details> block. The importer keys on this
      // pStyle id to rebuild the detailsSummary node.
      id: 'DetailsSummary',
      name: 'Details Summary',
      basedOn: 'Normal',
      run: {
        bold: true,
      },
      paragraph: {
        spacing: { before: 80, after: 40 },
      },
    },
    {
      // Invisible boundary markers wrapping a <details> block's content. The
      // importer uses a stack of Start/End markers to reconstruct arbitrarily
      // nested details. Rendered tiny + light so they are visually unobtrusive
      // in Word (they carry no user text).
      id: 'DetailsStart',
      name: 'Details Start',
      basedOn: 'Normal',
      run: { size: 2, color: 'FFFFFF', vanish: true },
      paragraph: { spacing: { before: 0, after: 0 } },
    },
    {
      id: 'DetailsEnd',
      name: 'Details End',
      basedOn: 'Normal',
      run: { size: 2, color: 'FFFFFF', vanish: true },
      paragraph: { spacing: { before: 0, after: 0 } },
    },
    {
      // Invisible boundary markers wrapping a blockquote's content. Like the
      // details markers, the importer uses a Start/End stack to rebuild the
      // quote and keep nested blocks (lists, nested quotes) inside it.
      id: 'BlockQuoteStart',
      name: 'Block Quote Start',
      basedOn: 'Normal',
      run: { size: 2, color: 'FFFFFF', vanish: true },
      paragraph: { spacing: { before: 0, after: 0 } },
    },
    {
      id: 'BlockQuoteEnd',
      name: 'Block Quote End',
      basedOn: 'Normal',
      run: { size: 2, color: 'FFFFFF', vanish: true },
      paragraph: { spacing: { before: 0, after: 0 } },
    },
    {
      // Invisible boundary after a code block, so the importer breaks the run of
      // per-line CodeBlock paragraphs at block boundaries instead of merging two
      // adjacent code blocks into one.
      id: 'CodeBlockEnd',
      name: 'Code Block End',
      basedOn: 'Normal',
      run: { size: 2, color: 'FFFFFF', vanish: true },
      paragraph: { spacing: { before: 0, after: 0 } },
    },
  ]
}

/** Create the full styles options for Document construction. */
function createDocxStyles(): IStylesOptions {
  return {
    default: createDefaultStyles(),
    paragraphStyles: createParagraphStyles(),
  }
}

/** Module-level cached styles (pure static, no need to recreate per export). */
export const DOCX_STYLES: IStylesOptions = createDocxStyles()

/** Map heading level (1-6) to the docx AlignmentType equivalent. */
export function mapTextAlign(align: unknown): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  if (typeof align !== 'string') return undefined
  switch (align) {
    case 'left':
      return AlignmentType.LEFT
    case 'center':
      return AlignmentType.CENTER
    case 'right':
      return AlignmentType.RIGHT
    case 'justify':
      return AlignmentType.JUSTIFIED
    default:
      return undefined
  }
}

// px → twips (1440 twips per inch, 96px per CSS inch → 15 twips/px) and a base
// em size of 16px, so the block-spacing lengths (px|em) map to Word's twip units.
const TWIPS_PER_PX = 15
const PX_PER_EM = 16

/** Convert a sanitised "<n>px|em" spacing length to whole twips, or undefined. */
function spacingToTwips(raw: unknown): number | undefined {
  // Reuse the editor's sanitizeSpacing so the docx path enforces the exact same
  // whitelist AND <=1000 cap as parse/render and the backend schema sanitizer; an
  // out-of-range value is rejected (undefined), never clamped.
  const v = sanitizeSpacing(raw)
  if (v === null) return undefined
  const m = /^(\d+(?:\.\d+)?)(px|em)$/.exec(v)
  if (!m) return undefined
  const px = parseFloat(m[1]) * (m[2] === 'em' ? PX_PER_EM : 1)
  return Math.round(px * TWIPS_PER_PX)
}

/**
 * Map the v17 line-spacing node attrs (lineHeight unitless + spaceBefore/spaceAfter
 * px|em) onto a docx `spacing` object, or undefined when none apply. line-height is a
 * unitless multiplier → Word's line value is in 240ths of a line with lineRule AUTO
 * (e.g. 1.5 → 360). before/after are the block margins in twips.
 */
export function mapSpacing(attrs: Record<string, unknown> | undefined): ISpacingProperties | undefined {
  if (!attrs) return undefined
  const spacing: {
    line?: number
    lineRule?: (typeof LineRuleType)[keyof typeof LineRuleType]
    before?: number
    after?: number
  } = {}

  const lh = sanitizeLineHeight(attrs.lineHeight)
  if (lh !== null) {
    // sanitizeLineHeight enforces the same 0 < lh <= 10 whitelist as parse/render, so the docx
    // lineHeight path is capped identically to the spacing path (sanitizeSpacing, <=1000) — the
    // two are symmetric; an out-of-range multiplier is rejected (undefined), never clamped.
    spacing.line = Math.round(Number(lh) * 240)
    spacing.lineRule = LineRuleType.AUTO
  }

  const before = spacingToTwips(attrs.spaceBefore)
  if (before !== undefined) spacing.before = before
  const after = spacingToTwips(attrs.spaceAfter)
  if (after !== undefined) spacing.after = after

  return Object.keys(spacing).length ? spacing : undefined
}
