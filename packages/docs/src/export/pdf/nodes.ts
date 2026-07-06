/**
 * Block-level node converters for PDF export.
 * Converts ProseMirror JSON nodes to PDF content.
 */

import type { MdNode, PdfContext } from './types.ts'
import { convertInlineToSegments, renderSegments, getPlainText } from './marks.ts'
import { renderTable } from './tables.ts'
import { getImageData, getImageDimensions } from './images.ts'
import { getBodyFont, getCodeFont, containsCJK } from './fonts.ts'
import { extractMathLayout } from './katex-render.ts'
import { drawMathLayout } from './katex-draw.ts'
import {
  FONT_SIZE_BODY,
  FONT_SIZE_CODE,
  HEADING_SIZES,
  PARAGRAPH_SPACING,
  HEADING_SPACING_BEFORE,
  HEADING_SPACING_AFTER,
  LIST_INDENT,
  CODE_BLOCK_PADDING,
  BLOCKQUOTE_INDENT,
  COLOR_CODE_BG,
  COLOR_MUTED,
  COLOR_BLOCKQUOTE,
  COLOR_LINK,
  CALLOUT_COLORS,
  CALLOUT_EMOJI,
  BULLET_CHARS,
  formatListNumber,
  LINE_HEIGHT,
} from './styles.ts'

/**
 * Ensure enough space on the page, adding a new page if needed.
 */
function ensureSpace(ctx: PdfContext, neededHeight: number): void {
  if (ctx.y + neededHeight > ctx.marginTop + ctx.contentHeight) {
    ctx.pdf.addPage()
    ctx.y = ctx.marginTop
  }
}

/**
 * Convert all blocks in the document.
 */
export function renderBlocks(nodes: MdNode[], ctx: PdfContext): void {
  for (const node of nodes) {
    renderBlock(node, ctx)
  }
}

/**
 * Render a single block-level node.
 */
function renderBlock(node: MdNode, ctx: PdfContext): void {
  switch (node.type) {
    case 'paragraph':
      renderParagraph(node, ctx)
      break
    case 'heading':
      renderHeading(node, ctx)
      break
    case 'bulletList':
      renderBulletList(node, ctx)
      break
    case 'orderedList':
      renderOrderedList(node, ctx)
      break
    case 'taskList':
      renderTaskList(node, ctx)
      break
    case 'blockquote':
      renderBlockquote(node, ctx)
      break
    case 'codeBlock':
      renderCodeBlock(node, ctx)
      break
    case 'horizontalRule':
      renderHorizontalRule(ctx)
      break
    case 'table':
      renderTable(node, ctx)
      ctx.y += PARAGRAPH_SPACING
      break
    case 'image':
      renderImage(node, ctx)
      break
    case 'fileAttachment':
      renderFileAttachment(node, ctx)
      break
    case 'bookmark':
      renderBookmark(node, ctx)
      break
    case 'callout':
      renderCallout(node, ctx)
      break
    case 'blockMath':
      renderBlockMath(node, ctx)
      break
    case 'details':
      renderDetails(node, ctx)
      break
    default:
      // Recurse into unknown containers
      if (node.content && node.content.length) {
        renderBlocks(node.content, ctx)
      } else if (node.text) {
        const segments = [{ text: node.text }]
        ensureSpace(ctx, 10)
        renderSegments(ctx, segments)
        ctx.y += PARAGRAPH_SPACING
      }
  }
}

/**
 * Render a paragraph.
 */
function renderParagraph(node: MdNode, ctx: PdfContext): void {
  const segments = convertInlineToSegments(node.content ?? [], ctx.emojiGlyph)
  if (segments.length === 0) {
    ctx.y += PARAGRAPH_SPACING
    return
  }

  ensureSpace(ctx, 10)
  renderSegments(ctx, segments, { fontSize: FONT_SIZE_BODY })
  ctx.y += PARAGRAPH_SPACING
}

/**
 * Render a heading.
 */
function renderHeading(node: MdNode, ctx: PdfContext): void {
  const level = typeof node.attrs?.level === 'number' ? Math.min(6, Math.max(1, node.attrs.level)) : 1
  const fontSize = HEADING_SIZES[level] ?? FONT_SIZE_BODY
  const segments = convertInlineToSegments(node.content ?? [], ctx.emojiGlyph)

  // Make all segments bold
  const boldSegments = segments.map((s) => ({ ...s, bold: true }))

  ctx.y += HEADING_SPACING_BEFORE
  ensureSpace(ctx, 15)
  renderSegments(ctx, boldSegments, { fontSize })
  ctx.y += HEADING_SPACING_AFTER
}

/**
 * Render a bullet list.
 */
function renderBulletList(node: MdNode, ctx: PdfContext): void {
  const items = node.content ?? []
  const depth = ctx.listDepth

  for (const item of items) {
    renderListItem(item, false, 0, depth, ctx)
  }

  if (depth === 0) {
    ctx.y += PARAGRAPH_SPACING
  }
}

/**
 * Render an ordered list.
 */
function renderOrderedList(node: MdNode, ctx: PdfContext): void {
  const items = node.content ?? []
  const depth = ctx.listDepth
  const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1

  for (let i = 0; i < items.length; i++) {
    renderListItem(items[i], true, start + i, depth, ctx)
  }

  if (depth === 0) {
    ctx.y += PARAGRAPH_SPACING
  }
}

/**
 * Render a task list.
 */
function renderTaskList(node: MdNode, ctx: PdfContext): void {
  const items = node.content ?? []
  const depth = ctx.listDepth

  for (const item of items) {
    const checked = !!item.attrs?.checked
    const checkbox = checked ? '☑ ' : '☐ '
    renderListItem(item, false, 0, depth, ctx, checkbox)
  }

  if (depth === 0) {
    ctx.y += PARAGRAPH_SPACING
  }
}

/**
 * Render a list item.
 */
function renderListItem(
  item: MdNode,
  ordered: boolean,
  num: number,
  depth: number,
  ctx: PdfContext,
  prefixOverride?: string,
): void {
  const blocks = item.content ?? []
  const indent = LIST_INDENT * (depth + 1)

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]

    if (block.type === 'bulletList' || block.type === 'orderedList' || block.type === 'taskList') {
      ctx.listDepth = depth + 1
      renderBlock(block, ctx)
      ctx.listDepth = depth
    } else if (i === 0) {
      // First block gets the marker
      let marker: string
      if (prefixOverride) {
        marker = prefixOverride
      } else if (ordered) {
        marker = formatListNumber(num, depth) + '. '
      } else {
        marker = BULLET_CHARS[Math.min(depth, BULLET_CHARS.length - 1)] + ' '
      }

      const segments = convertInlineToSegments(block.content ?? [], ctx.emojiGlyph)
      const markerSegment = { text: marker }

      ensureSpace(ctx, 10)
      renderSegments(ctx, [markerSegment, ...segments], {
        fontSize: FONT_SIZE_BODY,
        indent,
      })
      // ctx.y already updated by renderSegments
    } else {
      // Continuation blocks
      const segments = convertInlineToSegments(block.content ?? [], ctx.emojiGlyph)
      ensureSpace(ctx, 10)
      renderSegments(ctx, segments, {
        fontSize: FONT_SIZE_BODY,
        indent: indent + LIST_INDENT,
      })
      // ctx.y already updated by renderSegments
    }
  }
}

/**
 * Render a blockquote.
 */
function renderBlockquote(node: MdNode, ctx: PdfContext): void {
  const { pdf, marginLeft } = ctx
  const children = node.content ?? []

  // Track bar segments per page for cross-page blockquotes
  const barSegments: Array<{ page: number; startY: number; endY: number }> = []
  let currentPage = pdf.getNumberOfPages()
  let segStartY = ctx.y - 2

  for (const child of children) {
    const beforePage = pdf.getNumberOfPages()

    if (child.type === 'paragraph') {
      const segments = convertInlineToSegments(child.content ?? [], ctx.emojiGlyph)
      const styledSegments = segments.map((s) => ({
        ...s,
        italic: true,
        color: s.color ?? COLOR_BLOCKQUOTE,
      }))

      ensureSpace(ctx, 10)
      renderSegments(ctx, styledSegments, {
        fontSize: FONT_SIZE_BODY,
        indent: BLOCKQUOTE_INDENT,
      })
    } else {
      renderBlock(child, ctx)
    }

    const afterPage = pdf.getNumberOfPages()

    // If page changed, close the bar segment on the old page and start new one
    if (afterPage > beforePage) {
      barSegments.push({ page: currentPage, startY: segStartY, endY: ctx.marginTop + ctx.contentHeight })
      currentPage = afterPage
      segStartY = ctx.marginTop - 2
    }
  }

  // Close the final bar segment
  barSegments.push({ page: currentPage, startY: segStartY, endY: ctx.y })

  // Draw all bar segments on their respective pages
  const activePage = pdf.getNumberOfPages()
  for (const seg of barSegments) {
    if (seg.startY >= seg.endY) continue
    pdf.setPage(seg.page)
    pdf.setDrawColor(200, 200, 200)
    pdf.setLineWidth(1)
    pdf.line(marginLeft + 2, seg.startY, marginLeft + 2, seg.endY)
  }
  // Restore to active page
  pdf.setPage(activePage)

  ctx.y += PARAGRAPH_SPACING
}

/**
 * Draw a single code line, switching between the monospace (courier) font for
 * ASCII/code runs and the Chinese font for CJK runs. Courier has no CJK glyphs,
 * so drawing CJK with it produces garbled output and spurious letter spacing.
 */
function drawCodeLine(
  pdf: PdfContext['pdf'],
  line: string,
  x: number,
  y: number,
  chineseFontLoaded: boolean,
): void {
  // Split into consecutive CJK / non-CJK runs
  const runs: Array<{ text: string; cjk: boolean }> = []
  let buf = ''
  let bufCjk: boolean | null = null
  for (const ch of line) {
    const isCjk = containsCJK(ch)
    if (bufCjk === null || isCjk === bufCjk) {
      buf += ch
      bufCjk = isCjk
    } else {
      runs.push({ text: buf, cjk: bufCjk })
      buf = ch
      bufCjk = isCjk
    }
  }
  if (buf) runs.push({ text: buf, cjk: bufCjk ?? false })

  let cursorX = x
  for (const run of runs) {
    if (run.cjk && chineseFontLoaded) {
      pdf.setFont('NotoSansSC', 'normal')
    } else {
      pdf.setFont('courier', 'normal')
    }
    pdf.setFontSize(FONT_SIZE_CODE)
    pdf.text(run.text, cursorX, y)
    cursorX += pdf.getTextWidth(run.text)
  }
}

/**
 * Render a code block.
 */
function renderCodeBlock(node: MdNode, ctx: PdfContext): void {
  const { pdf, marginLeft, contentWidth } = ctx
  const code = (node.content ?? []).map((c) => c.text ?? '').join('')
  const lines = code.split('\n')

  const lineHeightMm = (FONT_SIZE_CODE * 0.352778) * 1.4
  const totalHeight = lines.length * lineHeightMm + CODE_BLOCK_PADDING * 2

  ensureSpace(ctx, totalHeight)

  const r = parseInt(COLOR_CODE_BG.substring(0, 2), 16)
  const g = parseInt(COLOR_CODE_BG.substring(2, 4), 16)
  const b = parseInt(COLOR_CODE_BG.substring(4, 6), 16)
  const pageBottom = ctx.marginTop + ctx.contentHeight

  pdf.setFontSize(FONT_SIZE_CODE)
  pdf.setTextColor(0, 0, 0)

  // Walk the lines one page-segment at a time. For each segment we draw its
  // own gray background rect BEFORE the text, so multi-page code blocks get a
  // background on every page (not just the first).
  // Walk the lines one page-segment at a time. For each segment we draw its
  // own gray background rect BEFORE the text, so multi-page code blocks get a
  // background on every page (not just the first). The gap between a segment's
  // rect top and its first text baseline must be identical on every page,
  // otherwise the first line on a continued page pokes above the gray box.
  const TOP_GAP = CODE_BLOCK_PADDING + 2
  let idx = 0
  let segTop = ctx.y - 2
  let currentY = ctx.y + CODE_BLOCK_PADDING

  while (idx < lines.length) {
    // How many lines fit on this page from currentY down.
    let y = currentY
    let segLines = 0
    while (idx + segLines < lines.length && y + lineHeightMm <= pageBottom) {
      y += lineHeightMm
      segLines++
    }
    // Guarantee progress even if a single line can't fit (avoid infinite loop).
    if (segLines === 0) segLines = 1

    const isLastSegment = idx + segLines >= lines.length
    // Cover the last line's descenders; the final segment adds full bottom pad.
    const descentPad = lineHeightMm * 0.3
    const bottomPad = isLastSegment ? CODE_BLOCK_PADDING : descentPad
    // Rect spans from segTop down past the last baseline of this segment.
    const lastBaseline = currentY + (segLines - 1) * lineHeightMm
    const segHeight = (lastBaseline - segTop) + bottomPad

    // Background for this page's slice.
    pdf.setFillColor(r, g, b)
    pdf.rect(marginLeft, segTop, contentWidth, segHeight, 'F')

    // Text for this page's slice.
    for (let i = 0; i < segLines; i++) {
      const line = lines[idx + i]
      drawCodeLine(pdf, line || ' ', marginLeft + CODE_BLOCK_PADDING, currentY, ctx.chineseFontLoaded)
      currentY += lineHeightMm
    }
    idx += segLines

    if (!isLastSegment) {
      pdf.addPage()
      // Continued page: rect starts at the top margin, and the first baseline
      // sits TOP_GAP below it (same gap as the first page) so ascenders are
      // covered by the gray background.
      segTop = ctx.marginTop
      currentY = ctx.marginTop + TOP_GAP
    }
  }

  ctx.y = currentY + CODE_BLOCK_PADDING + PARAGRAPH_SPACING

  // Reset font
  pdf.setFont(getBodyFont(ctx.chineseFontLoaded), 'normal')
}

/**
 * Render a horizontal rule.
 */
function renderHorizontalRule(ctx: PdfContext): void {
  const { pdf, marginLeft, contentWidth } = ctx

  ctx.y += PARAGRAPH_SPACING
  ensureSpace(ctx, 5)

  pdf.setDrawColor(200, 200, 200)
  pdf.setLineWidth(0.5)
  pdf.line(marginLeft, ctx.y, marginLeft + contentWidth, ctx.y)

  ctx.y += PARAGRAPH_SPACING * 2
}

/**
 * Render an image.
 */
function renderImage(node: MdNode, ctx: PdfContext): void {
  const { pdf, marginLeft, contentWidth } = ctx
  const imageData = getImageData(node, ctx)
  const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''

  if (!imageData) {
    // Image couldn't be fetched — emit placeholder
    const text = alt ? `[Image: ${alt}]` : '[Image unavailable]'
    const segments = [{ text, italic: true, color: COLOR_MUTED }]
    ensureSpace(ctx, 10)
    renderSegments(ctx, segments)
    ctx.y += PARAGRAPH_SPACING
    return
  }

  const dims = getImageDimensions(node, contentWidth)
  ensureSpace(ctx, dims.height + 5)

  try {
    // Center the image
    const x = marginLeft + (contentWidth - dims.width) / 2
    pdf.addImage(imageData, 'AUTO', x, ctx.y, dims.width, dims.height)
    ctx.y += dims.height + PARAGRAPH_SPACING
  } catch {
    // Image format not supported
    const text = alt ? `[Image: ${alt}]` : '[Image unavailable]'
    const segments = [{ text, italic: true, color: COLOR_MUTED }]
    renderSegments(ctx, segments)
    ctx.y += PARAGRAPH_SPACING
  }
}

/**
 * Render a file attachment link.
 */
function renderFileAttachment(node: MdNode, ctx: PdfContext): void {
  const { pdf } = ctx
  const attachId = typeof node.attrs?.attachId === 'string' ? node.attrs.attachId : undefined
  const resolved = attachId ? ctx.urls.get(attachId) : undefined
  const name =
    (typeof node.attrs?.fileName === 'string' && node.attrs.fileName) ||
    resolved?.fileName ||
    'attachment'

  ensureSpace(ctx, 10)

  if (resolved?.url) {
    const segments = [
      { text: '📎 ' },
      { text: name, link: resolved.url, color: COLOR_LINK, underline: true },
    ]
    renderSegments(ctx, segments)
    ctx.y += PARAGRAPH_SPACING
  } else {
    const segments = [{ text: '📎 ' + name + ' (unavailable)', italic: true, color: COLOR_MUTED }]
    renderSegments(ctx, segments)
    ctx.y += PARAGRAPH_SPACING
  }
}

/**
 * Render a bookmark.
 */
function renderBookmark(node: MdNode, ctx: PdfContext): void {
  const url = typeof node.attrs?.url === 'string' ? node.attrs.url : ''
  const title = (typeof node.attrs?.title === 'string' && node.attrs.title) || url

  ensureSpace(ctx, 10)

  if (url) {
    const segments = [
      { text: '🔗 ' },
      { text: title, link: url, color: COLOR_LINK, underline: true },
    ]
    renderSegments(ctx, segments)
    ctx.y += PARAGRAPH_SPACING
  } else {
    const segments = [{ text: title || '[bookmark]' }]
    renderSegments(ctx, segments)
    ctx.y += PARAGRAPH_SPACING
  }
}

/**
 * Render a callout.
 */
function renderCallout(node: MdNode, ctx: PdfContext): void {
  const { pdf, marginLeft, contentWidth } = ctx
  const variant = typeof node.attrs?.variant === 'string' ? node.attrs.variant : 'info'
  const bgColor = CALLOUT_COLORS[variant] ?? CALLOUT_COLORS['info']
  const emoji = CALLOUT_EMOJI[variant] ?? CALLOUT_EMOJI['info']
  const children = node.content ?? []

  // Calculate approximate height
  const minHeight = 20

  ensureSpace(ctx, minHeight)

  const startY = ctx.y - 2

  // Render content with indent
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (child.type === 'paragraph') {
      const segments = convertInlineToSegments(child.content ?? [], ctx.emojiGlyph)
      // Prepend emoji to first paragraph
      const prefix = i === 0 ? [{ text: emoji, bold: true }] : []
      renderSegments(ctx, [...prefix, ...segments], {
        fontSize: FONT_SIZE_BODY,
        indent: 6,
      })
      // ctx.y already updated by renderSegments
    } else {
      renderBlock(child, ctx)
    }
  }

  const endY = ctx.y + 2

  // Draw background (behind text - we need to redraw but this is simplified)
  const r = parseInt(bgColor.substring(0, 2), 16)
  const g = parseInt(bgColor.substring(2, 4), 16)
  const b = parseInt(bgColor.substring(4, 6), 16)
  // Note: In a real implementation, we'd need to draw the background first
  // For simplicity, we just add a left border
  pdf.setDrawColor(r, g, b)
  pdf.setLineWidth(2)
  pdf.line(marginLeft + 2, startY, marginLeft + 2, endY)

  ctx.y += PARAGRAPH_SPACING
}

/**
 * Render block math.
 */
function renderBlockMath(node: MdNode, ctx: PdfContext): void {
  const latex = typeof node.attrs?.latex === 'string' ? node.attrs.latex : ''
  if (!latex) return

  // Preferred path: render the formula with KaTeX and draw it as real,
  // selectable text glyphs (fractions stacked, limits above/below operators),
  // exactly like Word/LaTeX-produced PDFs — no SVG, no image. Falls back to
  // raw LaTeX source text when a layout DOM or the KaTeX fonts are unavailable.
  if (ctx.katexFontsLoaded) {
    const layout = extractMathLayout(latex, true)
    if (layout && layout.items.length > 0) {
      const emMm = FONT_SIZE_BODY * 0.352778
      const mmPerPx = emMm / 16 // 16px host em → mm-per-px factor
      const widthMm = layout.widthPx * mmPerPx
      const heightMm = layout.heightPx * mmPerPx
      ensureSpace(ctx, heightMm + PARAGRAPH_SPACING)
      const x = ctx.marginLeft + Math.max(0, (ctx.contentWidth - widthMm) / 2)
      const drawn = drawMathLayout(ctx.pdf, layout, x, ctx.y, emMm)
      ctx.y += drawn.heightMm + PARAGRAPH_SPACING
      ctx.pdf.setFont(getBodyFont(ctx.chineseFontLoaded), 'normal')
      ctx.pdf.setTextColor(0, 0, 0)
      return
    }
  }

  // Fallback: raw LaTeX source as selectable text wrapped in $$...$$.
  const text = `$$${latex}$$`
  const font = ctx.chineseFontLoaded ? 'NotoSansSC' : getBodyFont(ctx.chineseFontLoaded)
  ctx.pdf.setFont(font, 'normal')
  ctx.pdf.setFontSize(FONT_SIZE_BODY)
  ctx.pdf.setTextColor(20, 20, 20)

  // Wrap long formulas to the content width.
  const lines = ctx.pdf.splitTextToSize(text, ctx.contentWidth) as string[]
  const lineH = (FONT_SIZE_BODY * 0.352778) * LINE_HEIGHT
  ensureSpace(ctx, lineH * lines.length + PARAGRAPH_SPACING)
  for (const line of lines) {
    const w = ctx.pdf.getTextWidth(line)
    const x = ctx.marginLeft + Math.max(0, (ctx.contentWidth - w) / 2)
    ctx.pdf.text(line, x, ctx.y)
    ctx.y += lineH
  }
  ctx.pdf.setTextColor(0, 0, 0)
  ctx.pdf.setFont(getBodyFont(ctx.chineseFontLoaded), 'normal')
  ctx.y += PARAGRAPH_SPACING
}

/**
 * Render a details/collapsible block.
 */
function renderDetails(node: MdNode, ctx: PdfContext): void {
  const children = node.content ?? []
  const summaryNode = children.find((c) => c.type === 'detailsSummary')
  const contentNode = children.find((c) => c.type === 'detailsContent')

  // Render summary as bold with toggle indicator
  if (summaryNode) {
    const segments = convertInlineToSegments(summaryNode.content ?? [], ctx.emojiGlyph)
    const toggleSegment = { text: '▸ ', bold: true }

    ensureSpace(ctx, 10)
    renderSegments(ctx, [toggleSegment, ...segments.map((s) => ({ ...s, bold: true }))])
    // ctx.y already updated by renderSegments
  }

  // Render content indented
  const contentChildren = contentNode?.content ?? children.filter((c) => c.type !== 'detailsSummary')
  for (const child of contentChildren) {
    if (child.type === 'paragraph') {
      const segments = convertInlineToSegments(child.content ?? [], ctx.emojiGlyph)
      renderSegments(ctx, segments, { indent: LIST_INDENT })
      // ctx.y already updated by renderSegments
    } else {
      renderBlock(child, ctx)
    }
  }

  ctx.y += PARAGRAPH_SPACING
}
