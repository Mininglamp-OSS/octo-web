/**
 * Table rendering for PDF export using jspdf-autotable.
 */

import type { jsPDF } from 'jspdf'
import autoTable, { type RowInput, type CellDef } from 'jspdf-autotable'
import type { MdNode, PdfContext } from './types.ts'
import { getPlainText } from './marks.ts'
import { FONT_SIZE_BODY, COLOR_BORDER } from './styles.ts'

/**
 * Convert a table node to PDF using autotable.
 * Returns the height consumed.
 */
export function renderTable(node: MdNode, ctx: PdfContext): number {
  const { pdf, marginLeft, y, contentWidth, marginTop, contentHeight, emojiGlyph } = ctx
  const rows = node.content ?? []
  if (rows.length === 0) return 0

  // Check if we need a new page
  if (y > marginTop + contentHeight - 20) {
    pdf.addPage()
    ctx.y = marginTop
  }

  const startY = ctx.y

  // Build table data
  const head: RowInput[] = []
  const body: RowInput[] = []

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx]
    const cells = row.content ?? []
    const rowData: CellDef[] = []
    let isHeader = false

    for (const cell of cells) {
      const colspan = Number(cell.attrs?.colspan ?? 1)
      const rowspan = Number(cell.attrs?.rowspan ?? 1)
      isHeader = cell.type === 'tableHeader'

      // Extract text content from cell
      const text = getCellText(cell, emojiGlyph)

      const cellDef: CellDef = {
        content: text,
        colSpan: colspan > 1 ? colspan : undefined,
        rowSpan: rowspan > 1 ? rowspan : undefined,
        styles: isHeader ? { fillColor: [235, 235, 235] } : undefined,
      }
      rowData.push(cellDef)
    }

    // First row with headers goes to head, rest to body
    if (rowIdx === 0 && isHeader) {
      head.push(rowData)
    } else {
      body.push(rowData)
    }
  }

  // Render table with autotable.
  // When Chinese font is loaded, force all cells to use it in 'normal' weight —
  // the NotoSansSC face has no bold variant, so a bold fontStyle would garble
  // CJK text. Header emphasis is conveyed by the fill color instead.
  const useFont = ctx.chineseFontLoaded ? 'NotoSansSC' : 'helvetica'
  autoTable(pdf, {
    startY: ctx.y,
    margin: { left: marginLeft },
    tableWidth: contentWidth,
    head: head.length > 0 ? head : undefined,
    body: body,
    styles: {
      font: useFont,
      fontStyle: 'normal',
      fontSize: FONT_SIZE_BODY - 1,
      cellPadding: 2,
      lineColor: hexToRgb(COLOR_BORDER),
      lineWidth: 0.2,
    },
    headStyles: {
      font: useFont,
      fontStyle: 'normal',
      fillColor: [235, 235, 235],
      textColor: [0, 0, 0],
    },
    alternateRowStyles: {
      fillColor: [250, 250, 250],
    },
    didParseCell: (data) => {
      // Ensure every cell uses the CJK-capable font in normal weight
      data.cell.styles.font = useFont
      data.cell.styles.fontStyle = 'normal'
    },
    didDrawPage: (data) => {
      // Update context Y position after table is drawn
      if (data.cursor) {
        ctx.y = data.cursor.y
      }
    },
  })

  // Get final Y from autotable
  const finalY = (pdf as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? ctx.y
  ctx.y = finalY

  return finalY - startY
}

/**
 * Extract plain text from a table cell, handling nested blocks.
 */
function getCellText(cell: MdNode, emojiGlyph?: (name: string | null | undefined) => string | undefined): string {
  const content = cell.content ?? []
  const parts: string[] = []

  for (const block of content) {
    if (block.type === 'paragraph') {
      parts.push(getPlainText(block.content ?? [], emojiGlyph))
    } else if (block.type === 'bulletList' || block.type === 'orderedList') {
      const items = block.content ?? []
      items.forEach((item, idx) => {
        const prefix = block.type === 'orderedList' ? `${idx + 1}. ` : '• '
        const firstPara = (item.content ?? []).find((c) => c.type === 'paragraph')
        if (firstPara) {
          parts.push(prefix + getPlainText(firstPara.content ?? [], emojiGlyph))
        }
      })
    } else {
      // For other block types, extract text content
      parts.push(getPlainText(block.content ?? [], emojiGlyph))
    }
  }

  return parts.join('\n')
}

/**
 * Convert hex color to RGB tuple.
 */
function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  return [r, g, b]
}
