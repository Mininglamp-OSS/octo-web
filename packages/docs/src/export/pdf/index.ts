/**
 * PDF Export Module — Main Entry Point.
 *
 * Converts a ProseMirror JSON document into a PDF file (as Blob).
 * Uses the `jspdf` library for PDF generation.
 *
 * Images are resolved via the resolveAttachments API (same as DOCX/markdown export)
 * and fetched as base64 data URLs for embedding.
 */

import { jsPDF } from 'jspdf'
import { resolveAttachments } from '../../attachments/api.ts'
import { resolveAndFetchImages } from './images.ts'
import { renderBlocks } from './nodes.ts'
import { documentContainsCJK, registerChineseFont } from './fonts.ts'
import { registerKatexFonts } from './katex-fonts.ts'
import { domLayoutAvailable, preloadKatexFonts } from './katex-render.ts'
import {
  MARGIN_TOP,
  MARGIN_LEFT,
  CONTENT_WIDTH,
  CONTENT_HEIGHT,
} from './styles.ts'
import type { MdNode, PdfExportOptions, PdfContext } from './types.ts'

export type { MdNode, PdfExportOptions }

/**
 * Export a ProseMirror JSON document to a PDF Blob.
 *
 * @param docId - The document ID (used for resolving attachments).
 * @param doc - The ProseMirror JSON root node (from editor.getJSON()).
 * @param opts - Optional configuration for batch size, resolve function, emoji resolver.
 * @returns A Blob containing the .pdf file.
 */
export async function exportDocToPdf(
  docId: string,
  doc: MdNode,
  opts: PdfExportOptions = {},
): Promise<Blob> {
  const resolve = opts.resolve ?? resolveAttachments

  // Resolve attachment URLs and fetch image data
  const { urls, imageData } = await resolveAndFetchImages(docId, doc, {
    batchSize: opts.batchSize,
    resolve,
  })

  // Create PDF document
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  })

  // Detect CJK content and load Chinese font if needed
  let chineseFontLoaded = false
  if (documentContainsCJK(doc)) {
    chineseFontLoaded = await registerChineseFont(pdf)
  }

  // If the document has math and we can lay it out in a DOM, register the
  // KaTeX fonts so formulas render as real (selectable) text glyphs.
  let katexFontsLoaded = false
  if (domLayoutAvailable() && documentContainsMath(doc)) {
    katexFontsLoaded = await registerKatexFonts(pdf)
    // Critical: force the browser to load the KaTeX web fonts before the
    // synchronous measurement pass, so glyph rects are measured with the SAME
    // fonts we draw with (otherwise big operators like ∑ measure narrow in a
    // fallback font and overflow the following content).
    if (katexFontsLoaded) {
      await preloadKatexFonts()
    }
  }

  // Set default font
  pdf.setFont(chineseFontLoaded ? 'NotoSansSC' : 'helvetica', 'normal')

  // Build the conversion context
  const ctx: PdfContext = {
    pdf,
    urls,
    imageData,
    emojiGlyph: opts.emojiGlyph,
    y: MARGIN_TOP,
    contentWidth: CONTENT_WIDTH,
    contentHeight: CONTENT_HEIGHT,
    marginLeft: MARGIN_LEFT,
    marginTop: MARGIN_TOP,
    listDepth: 0,
    chineseFontLoaded,
    katexFontsLoaded,
  }

  // Convert ProseMirror JSON blocks to PDF content. Fully synchronous: math
  // is laid out with KaTeX and drawn as real text glyphs (no async SVG).
  renderBlocks(doc.content ?? [], ctx)

  // Output as Blob
  const blob = pdf.output('blob')
  return blob
}

/** Walk the doc tree for any inline/block math node. */
function documentContainsMath(node: MdNode): boolean {
  if (node.type === 'blockMath' || node.type === 'inlineMath') return true
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (child && documentContainsMath(child as MdNode)) return true
    }
  }
  return false
}
