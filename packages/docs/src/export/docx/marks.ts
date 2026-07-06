/**
 * Inline mark converters for the DOCX export.
 * Converts ProseMirror marks (bold, italic, code, strike, link, underline,
 * highlight, textStyle, subscript, superscript) into docx TextRun options.
 */

import { type IRunOptions, ExternalHyperlink, TextRun, UnderlineType, type ParagraphChild } from 'docx'
import { FONT_CODE, FONT_EMOJI } from './styles.ts'
import { latexToMathComponent } from './math.ts'
import type { MdNode } from './types.ts'

type MarkDef = { type: string; attrs?: Record<string, unknown> }

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
        // docx highlight only supports named colors; use yellow as default
        opts.highlight = 'yellow'
        break
      }
      case 'textStyle': {
        const textColor = mark.attrs?.color
        if (typeof textColor === 'string' && textColor) {
          opts.color = textColor.startsWith('#') ? textColor.slice(1) : textColor
        }
        const fontSize = mark.attrs?.fontSize
        if (typeof fontSize === 'string') {
          const pt = parseFloat(fontSize)
          if (!isNaN(pt)) opts.size = Math.round(pt * 2) // half-points
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
 * Allowed URL schemes for DOCX hyperlinks. Blocks javascript:, file:, data:,
 * vbscript:, and UNC paths that could be injected via pasted content.
 */
const SAFE_HREF_SCHEMES = /^(?:https?|mailto|tel):/i

/**
 * Check if marks contain a link mark, and return its href (if safe).
 * Returns null for unsafe schemes or non-string values.
 */
export function extractLinkHref(marks: MarkDef[]): string | null {
  const linkMark = marks.find((m) => m.type === 'link')
  if (!linkMark) return null
  const href = linkMark.attrs?.href
  if (typeof href !== 'string') return null
  // Allow relative URLs (no scheme) and whitelisted schemes.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) && !SAFE_HREF_SCHEMES.test(href)) return null
  return href
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
