/**
 * Inline mark handling for PDF export.
 * Converts ProseMirror marks to text segments with styling information.
 */

import type { MdNode, TextSegment, PdfContext } from './types.ts'
import { getBodyFont, getCodeFont, containsCJK } from './fonts.ts'

type MarkDef = { type: string; attrs?: Record<string, unknown> }

/**
 * Build styling properties from an array of marks.
 */
function buildStyleFromMarks(marks: MarkDef[]): Partial<TextSegment> {
  const style: Partial<TextSegment> = {}

  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
      case 'strong':
        style.bold = true
        break
      case 'italic':
      case 'em':
        style.italic = true
        break
      case 'code':
        style.code = true
        break
      case 'strike':
        style.strike = true
        break
      case 'underline':
        style.underline = true
        break
      case 'link': {
        const href = mark.attrs?.href
        if (typeof href === 'string') style.link = href
        break
      }
      case 'textStyle': {
        const color = mark.attrs?.color
        if (typeof color === 'string' && color) {
          style.color = color.startsWith('#') ? color.slice(1) : color
        }
        break
      }
      case 'subscript':
        style.subscript = true
        break
      case 'superscript':
        style.superscript = true
        break
    }
  }

  return style
}

/**
 * Convert inline nodes to an array of text segments with styling.
 */
export function convertInlineToSegments(
  nodes: MdNode[],
  emojiGlyph?: (name: string | null | undefined) => string | undefined,
): TextSegment[] {
  const segments: TextSegment[] = []

  for (const node of nodes) {
    switch (node.type) {
      case 'text': {
        const text = node.text ?? ''
        if (!text) break
        const marks = node.marks ?? []
        const style = buildStyleFromMarks(marks)
        segments.push({ text, ...style })
        break
      }
      case 'hardBreak':
        segments.push({ text: '\n' })
        break
      case 'inlineMath': {
        const latex = typeof node.attrs?.latex === 'string' ? node.attrs.latex : ''
        // Render inline math as its raw LaTeX source wrapped in $...$ — plain
        // selectable text, no Unicode transform, no SVG/image (per 小吴).
        segments.push({ text: latex ? `$${latex}$` : '' })
        break
      }
      case 'mention': {
        const label = node.attrs?.label ?? node.attrs?.id ?? ''
        segments.push({ text: `@${label}`, bold: true, color: '1A73E8' })
        break
      }
      case 'emoji': {
        const name = typeof node.attrs?.name === 'string' ? node.attrs.name : null
        const glyph = emojiGlyph?.(name)
        // Emoji as text: show the unicode glyph if the font can draw it, else
        // fall back to the :shortcode: so it is never invisible. (twemoji SVG
        // vector path was reverted per 小吴's request.)
        const emojiText = glyph ?? (name ? `:${name}:` : '')
        segments.push({ text: emojiText })
        break
      }
      case 'image': {
        // Inline images are handled at block level; emit alt text as fallback
        const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '[image]'
        segments.push({ text: alt, italic: true, color: '888888' })
        break
      }
      default: {
        // Recurse into unknown inline containers
        if (node.content && node.content.length) {
          segments.push(...convertInlineToSegments(node.content, emojiGlyph))
        } else if (node.text) {
          segments.push({ text: node.text })
        }
      }
    }
  }

  return segments
}

/**
 * Get plain text from inline nodes (for table cells, etc.).
 */
export function getPlainText(nodes: MdNode[], emojiGlyph?: (name: string | null | undefined) => string | undefined): string {
  const segments = convertInlineToSegments(nodes, emojiGlyph)
  return segments.map((s) => s.text).join('')
}

/**
 * Split text into wrappable tokens.
 * For CJK text, each character is a separate token;
 * for Latin text, split on whitespace boundaries (preserving spaces).
 */
function splitIntoTokens(text: string): string[] {
  // Split into runs of CJK chars vs non-CJK runs
  // CJK char is its own token; Latin words stay grouped
  const tokens: string[] = []
  const cjkRange = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u2E80-\u2EFF\u3000-\u303F\uFF00-\uFFEF]/
  let buffer = ''

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (cjkRange.test(ch)) {
      // Flush any Latin buffer first
      if (buffer) {
        tokens.push(buffer)
        buffer = ''
      }
      // Each CJK char is its own token
      tokens.push(ch)
    } else if (/\s/.test(ch)) {
      // Whitespace breaks Latin words
      if (buffer) {
        tokens.push(buffer)
        buffer = ''
      }
      tokens.push(ch)
    } else {
      buffer += ch
    }
  }
  if (buffer) tokens.push(buffer)

  return tokens
}

/**
 * Render text segments to PDF at the current position.
 * Updates ctx.y directly to track the final position (handles page breaks correctly).
 * Returns the total height consumed on the CURRENT page from the starting position
 * (or from page top if a page break occurred).
 */
export function renderSegments(
  ctx: PdfContext,
  segments: TextSegment[],
  options: {
    fontSize?: number
    indent?: number
    maxWidth?: number
    lineHeight?: number
  } = {},
): number {
  const { pdf, marginLeft, contentWidth } = ctx
  const fontSize = options.fontSize ?? 11
  const indent = options.indent ?? 0
  const maxWidth = options.maxWidth ?? contentWidth - indent
  const lineHeight = options.lineHeight ?? 1.5

  let currentX = marginLeft + indent
  let currentY = ctx.y
  const lineHeightMm = (fontSize * 0.352778) * lineHeight

  for (const segment of segments) {
    if (segment.text === '\n') {
      currentY += lineHeightMm
      currentX = marginLeft + indent
      continue
    }

    // Determine the intended (Latin) font style from marks
    let latinStyle = 'normal'
    if (segment.bold && segment.italic) latinStyle = 'bolditalic'
    else if (segment.bold) latinStyle = 'bold'
    else if (segment.italic) latinStyle = 'italic'

    const latinFont = segment.code ? getCodeFont() : getBodyFont(ctx.chineseFontLoaded)

    // Set color
    const color = segment.color ?? '000000'
    const r = parseInt(color.substring(0, 2), 16)
    const g = parseInt(color.substring(2, 4), 16)
    const b = parseInt(color.substring(4, 6), 16)
    pdf.setTextColor(r, g, b)

    // Split text into wrappable tokens (CJK-aware)
    const tokens = splitIntoTokens(segment.text)
    for (const token of tokens) {
      if (!token) continue

      // CJK characters must always use the Chinese font in 'normal' weight —
      // the NotoSansSC face only carries normal glyphs, and asking jsPDF for a
      // bold/italic CJK variant (or a Latin font like courier) yields garbled
      // output or missing glyphs. Latin tokens keep the intended style.
      // NOTE: inline `code` containing CJK loses its monospace look here (it
      // falls back to the proportional CJK face) — an accepted trade-off, since
      // rendering CJK with courier garbles it. This is a jsPDF-path limitation.
      const tokenIsCJK = containsCJK(token)
      if (tokenIsCJK && ctx.chineseFontLoaded) {
        pdf.setFont('NotoSansSC', 'normal')
      } else {
        pdf.setFont(latinFont, latinStyle)
      }
      pdf.setFontSize(fontSize)

      const tokenWidth = pdf.getTextWidth(token)

      // Check if we need to wrap
      if (currentX + tokenWidth > marginLeft + indent + maxWidth && currentX > marginLeft + indent) {
        currentY += lineHeightMm
        currentX = marginLeft + indent
      }

      // Check page break
      if (currentY + lineHeightMm > ctx.marginTop + ctx.contentHeight) {
        pdf.addPage()
        currentY = ctx.marginTop
        currentX = marginLeft + indent
      }

      // Draw text
      // NOTE: CJK faux-italic via shear transform was removed — it mis-placed
      // sheared glyphs (drawX compensation is unreliable across jsPDF's text
      // coordinate handling, causing 斜体串行/错位). CJK italic now renders
      // upright (NotoSansSC has no italic cut); Latin italic keeps real italic.
      if (segment.link) {
        pdf.setTextColor(26, 115, 232) // Link color
        pdf.textWithLink(token, currentX, currentY, { url: segment.link })
        pdf.setTextColor(r, g, b)
      } else {
        pdf.text(token, currentX, currentY)
      }

      // Simulate bold for CJK by re-stamping with a tiny offset (faux bold),
      // since the CJK face has no real bold weight.
      if (tokenIsCJK && segment.bold && !segment.link) {
        pdf.text(token, currentX + 0.15, currentY)
      }

      // Draw strikethrough
      if (segment.strike) {
        const strikeY = currentY - (fontSize * 0.352778) * 0.3
        pdf.setDrawColor(r, g, b)
        pdf.setLineWidth(0.2)
        pdf.line(currentX, strikeY, currentX + tokenWidth, strikeY)
      }

      // Draw underline
      if (segment.underline || segment.link) {
        const underlineY = currentY + (fontSize * 0.352778) * 0.15
        pdf.setDrawColor(r, g, b)
        pdf.setLineWidth(0.2)
        pdf.line(currentX, underlineY, currentX + tokenWidth, underlineY)
      }

      currentX += tokenWidth
    }
  }

  // Reset text color
  pdf.setTextColor(0, 0, 0)

  // Update ctx.y to the final position (accounts for page breaks correctly)
  const finalY = currentY + lineHeightMm
  ctx.y = finalY

  // Return the height as distance from where we started on this render call.
  // Callers should NOT add this to ctx.y — ctx.y is already updated.
  return 0
}
