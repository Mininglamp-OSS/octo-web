/**
 * Inline mark converters for the DOCX export.
 * Converts ProseMirror marks (bold, italic, code, strike, link, underline,
 * highlight, textStyle, subscript, superscript) into docx TextRun options.
 */

import { type IRunOptions, ExternalHyperlink, TextRun, UnderlineType, ShadingType, type ParagraphChild } from 'docx'
import { FONT_CODE, FONT_EMOJI } from './styles.ts'
import { isSafeHref } from './href-safety.ts'
import { latexToMathComponent } from './math.ts'
import type { MdNode } from './types.ts'

type MarkDef = { type: string; attrs?: Record<string, unknown> }

/**
 * Normalise a CSS colour to the bare 6-hex value `<w:color w:val="…"/>` requires.
 * The in-app picker emits `#rrggbb`, but pasted/imported content can carry named
 * colours the browser rewrites to `rgb(…)`, or short `#abc` form. Passing those
 * straight through yields OOXML Word rejects as corrupt, so map what we can to
 * 6-hex and drop (return null) anything we can't, mirroring the safe-fallback
 * approach used elsewhere.
 */
export function normalizeDocxColor(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  // #rrggbb / rrggbb
  let m = /^#?([0-9a-f]{6})$/.exec(s)
  if (m) return m[1]
  // #rgb / rgb -> expand each nibble
  m = /^#?([0-9a-f]{3})$/.exec(s)
  if (m) {
    const [r, g, b] = m[1]
    return `${r}${r}${g}${g}${b}${b}`
  }
  // rgb(r, g, b) with 0-255 components
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/.exec(s)
  if (m) {
    const parts = [m[1], m[2], m[3]].map((n) => {
      const v = Number(n)
      if (v < 0 || v > 255) return null
      return v.toString(16).padStart(2, '0')
    })
    if (parts.every((p) => p !== null)) return parts.join('')
  }
  return null // unmappable (named colour, hsl, etc.) -> drop rather than corrupt
}

/**
 * Regex matching emoji / pictographic codepoints that the body font (微软雅黑)
 * cannot render. Covers the main emoji blocks + variation selectors + ZWJ so
 * multi-codepoint emoji (e.g. 👩‍💻, keycaps, flags) stay in one run.
 *
 * Also covers a few BMP "letterlike / punctuation" symbols that combine with a
 * trailing U+FE0F to form emoji (‼️ U+203C, ⁉️ U+2049, ™️ U+2122, ℹ️ U+2139,
 * ↔️↕️ etc.). Without these, the base char stayed in the body font while the
 * orphaned FE0F got split into an emoji-font run and rendered as a tofu box.
 */
const EMOJI_RE =
  /([\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{203C}\u{2049}\u{2122}\u{2139}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{FE0F}\u{20E3}\u{200D}]+)/u

/**
 * Build a single TextRun for a literal emoji/pictographic glyph, tagged with the
 * emoji font so it doesn't inherit the body font (微软雅黑) and render blank.
 * Use for hardcoded UI glyphs like 📎 / 🔗 / ☑ / callout icons.
 *
 * Strips the U+FE0F variation selector: for base symbols like ℹ (U+2139) / ⚠
 * (U+26A0), the emoji font already renders the colored glyph from the base char,
 * and a trailing FE0F has no composed glyph in many Word emoji fonts (notably on
 * macOS), so it shows up as an extra tofu box right after the icon. Dropping FE0F
 * keeps the colored glyph and removes the box.
 */
export function emojiRun(text: string, opts: IRunOptions = {}): TextRun {
  return new TextRun({ text: text.replace(/\uFE0F/gu, ''), ...opts, font: FONT_EMOJI })
}

/**
 * Emit an icon glyph followed by a single normal-width space, as two runs.
 *
 * The glyph carries the emoji font; the trailing space is a separate run in the
 * inherited body font. A space inside an emoji-font run renders far too wide in
 * Word (looks like an accidental gap), so the separator space must NOT live in
 * the emoji run. Pass the bare glyph here (no trailing space in the string).
 */
export function iconPrefix(glyph: string, opts: IRunOptions = {}): ParagraphChild[] {
  return [emojiRun(glyph, opts), new TextRun({ text: ' ', ...opts })]
}

/**
 * Split text into runs, applying the emoji font only to emoji segments so that
 * CJK/latin text keeps its inherited body font. Returns one or more TextRuns.
 */
export function buildTextRuns(text: string, baseOpts: IRunOptions): TextRun[] {
  if (!text) return []
  // Fast path: no emoji → single run.
  if (!EMOJI_RE.test(text)) return [new TextRun({ text, ...baseOpts })]

  const runs: TextRun[] = []
  // Split keeping delimiters (emoji chunks) via a global clone of the regex.
  const parts = text.split(new RegExp(EMOJI_RE, 'gu'))
  for (const part of parts) {
    if (!part) continue
    const isEmoji = new RegExp(`^${EMOJI_RE.source}$`, 'u').test(part)
    runs.push(
      new TextRun(
        isEmoji
          ? { text: part.replace(/\uFE0F/gu, ''), ...baseOpts, font: FONT_EMOJI }
          : { text: part, ...baseOpts },
      ),
    )
  }
  return runs
}

/**
 * Build IRunOptions properties from an array of marks.
 * Returns run options that should be spread into the TextRun constructor.
 * Uses a mutable intermediate to avoid readonly assignment errors.
 */
export function buildRunOptionsFromMarks(marks: MarkDef[]): IRunOptions {
  const opts: Record<string, unknown> = {}

  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
      case 'strong':
        opts.bold = true
        break
      case 'italic':
      case 'em':
        opts.italics = true
        break
      case 'code':
        opts.font = FONT_CODE
        opts.shading = { fill: 'F0F0F0' }
        break
      case 'strike':
        opts.strike = true
        break
      case 'underline':
        opts.underline = { type: UnderlineType.SINGLE }
        break
      case 'highlight': {
        // The editor's Highlight extension is multicolor: the chosen background
        // rides on the mark's `color` attr (any CSS colour, usually #rrggbb).
        // Word's `w:highlight` only accepts ~16 named colours, so it cannot carry
        // an arbitrary hex losslessly. Emit `w:shd` (shading) with the exact hex
        // fill instead — that renders the true background and round-trips 1:1
        // through the importer (which reads w:shd/@w:fill back into the mark).
        // Fall back to a plain yellow highlight when no usable colour is present.
        const hl = mark.attrs?.color
        const hlHex =
          typeof hl === 'string' && hl ? normalizeDocxColor(hl) : null
        if (hlHex) {
          opts.shading = { type: ShadingType.CLEAR, color: 'auto', fill: hlHex }
        } else {
          opts.highlight = 'yellow'
        }
        break
      }
      case 'textStyle': {
        const textColor = mark.attrs?.color
        if (typeof textColor === 'string' && textColor) {
          const hex = normalizeDocxColor(textColor)
          if (hex) opts.color = hex // drop unmappable colours; a bad w:val corrupts the .docx
        }
        const fontSize = mark.attrs?.fontSize
        if (typeof fontSize === 'string') {
          const pt = parseFloat(fontSize)
          // Clamp to a sane range before emitting <w:sz w:val="…"/> (half-points).
          // A hostile/corrupt attr can carry a negative, zero, non-finite, or
          // absurd size; an out-of-range w:sz produces invalid/unusable OOXML.
          // 2 half-points (1pt) .. 3276 half-points (1638pt) is well within limits.
          if (Number.isFinite(pt) && pt > 0) {
            const halfPoints = Math.round(pt * 2)
            opts.size = Math.min(3276, Math.max(2, halfPoints))
          }
        }
        // v16 fontFamily attr → docx run font. The attr holds a CSS font-family stack
        // (e.g. `SimSun, "宋体", serif`); docx wants a single face name, so take the first
        // family, strip quotes/whitespace, and drop generic CSS keywords (serif/sans-serif/…)
        // which are not real .docx font names. Don't set `opts.font` for `code` — the code
        // branch above already pinned FONT_CODE and must win.
        const fontFamily = mark.attrs?.fontFamily
        if (typeof fontFamily === 'string' && opts.font !== FONT_CODE) {
          const face = fontFamily
            .split(',')[0]
            .replace(/["']/g, '')
            .trim()
          const GENERIC = new Set([
            'serif',
            'sans-serif',
            'monospace',
            'cursive',
            'fantasy',
            'system-ui',
            'ui-serif',
            'ui-sans-serif',
            'ui-monospace',
          ])
          if (face && !GENERIC.has(face.toLowerCase())) opts.font = face
        }
        break
      }
      case 'subscript':
        opts.subScript = true
        break
      case 'superscript':
        opts.superScript = true
        break
      // 'link' is handled separately as it wraps in ExternalHyperlink
    }
  }

  return opts as IRunOptions
}

/**
 * Check if marks contain a link mark, and return its href (if safe).
 * Returns null for unsafe schemes, UNC paths, or non-string values.
 */
export function extractLinkHref(marks: MarkDef[]): string | null {
  const linkMark = marks.find((m) => m.type === 'link')
  if (!linkMark) return null
  const href = linkMark.attrs?.href
  if (typeof href !== 'string') return null
  // Strip leading whitespace / control chars, then apply the shared href policy
  // (scheme allowlist + UNC block). Return the trimmed value so downstream emits
  // the same string the policy vetted.
  const trimmed = href.replace(/^[\s\x00-\x20]+/, '')
  return isSafeHref(trimmed) ? trimmed : null
}

/**
 * Convert inline nodes to an array of TextRun or ExternalHyperlink elements.
 * Handles text nodes with marks, hardBreak, inlineMath, mention, and emoji.
 */
export function convertInlineContent(
  nodes: MdNode[],
  emojiGlyph?: (name: string | null | undefined) => string | undefined,
): ParagraphChild[] {
  const runs: ParagraphChild[] = []

  for (const node of nodes) {
    switch (node.type) {
      case 'text': {
        const text = node.text ?? ''
        if (!text) break
        const marks = node.marks ?? []
        const linkHref = extractLinkHref(marks)
        const runOpts = buildRunOptionsFromMarks(marks.filter((m) => m.type !== 'link'))

        if (linkHref) {
          runs.push(
            new ExternalHyperlink({
              children: buildTextRuns(text, { ...runOpts, style: 'Hyperlink' }),
              link: linkHref,
            }),
          )
        } else {
          runs.push(...buildTextRuns(text, runOpts))
        }
        break
      }
      case 'hardBreak':
        runs.push(new TextRun({ break: 1 }))
        break
      case 'inlineMath': {
        const latex = typeof node.attrs?.latex === 'string' ? node.attrs.latex : ''
        const math = latexToMathComponent(latex, false)
        if (math) {
          // Real OMML formula, rendered natively by Word.
          runs.push(math)
        } else {
          // Fallback: conversion failed — keep the LaTeX source (wrapped in `$`)
          // as monospace text so no content is lost.
          runs.push(
            new TextRun({
              text: `$${latex}$`,
              font: FONT_CODE,
              italics: true,
            }),
          )
        }
        break
      }
      case 'mention': {
        const label = node.attrs?.label ?? node.attrs?.id ?? ''
        runs.push(
          new TextRun({
            text: `@${label}`,
            bold: true,
            color: '1A73E8',
          }),
        )
        break
      }
      case 'emoji': {
        const name = typeof node.attrs?.name === 'string' ? node.attrs.name : null
        const glyph = emojiGlyph?.(name)
        const emojiText = glyph ?? (name ? `:${name}:` : '')
        // Apply the emoji font: the body font (微软雅黑) has no emoji glyphs and
        // Word does NOT auto-fallback, so bare runs render as blank boxes.
        // buildTextRuns only tags actual emoji codepoints (leaves `:name:` text alone).
        runs.push(...buildTextRuns(emojiText, {}))
        break
      }
      case 'image': {
        // Inline images are handled at a higher level; emit alt text as fallback
        const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '[image]'
        runs.push(new TextRun({ text: alt, italics: true, color: '888888' }))
        break
      }
      default: {
        // Recurse into unknown inline containers
        if (node.content && node.content.length) {
          runs.push(...convertInlineContent(node.content, emojiGlyph))
        } else if (node.text) {
          runs.push(new TextRun({ text: node.text }))
        }
      }
    }
  }

  return runs
}
