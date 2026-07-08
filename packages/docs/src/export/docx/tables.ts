/**
 * Table conversion for DOCX export.
 * Supports merged cells (colspan/rowspan) via TableCell columnSpan/rowSpan properties.
 */

/** Hard cap on colspan/rowspan to prevent malicious/corrupt attrs from freezing the export. */
const MAX_SPAN = 100

/**
 * Coerce a span attribute to a safe integer in [1, MAX_SPAN].
 * `Number('')`/`Number('x')` yield NaN, and `?? 1` only guards null/undefined,
 * so a non-numeric colspan/rowspan would otherwise collapse the grid; `|| 1`
 * catches NaN/0 and falls back to a single span.
 */
function clampSpan(raw: unknown): number {
  const n = Math.floor(Number(raw)) || 1
  return Math.min(MAX_SPAN, Math.max(1, n))
}

import {
  Table,
  TableRow,
  TableCell,
  TableLayoutType,
  Paragraph,
  TextRun,
  WidthType,
  BorderStyle,
  type ITableCellOptions,
} from 'docx'
import { convertInlineContent } from './marks.ts'
import type { MdNode, DocxContext } from './types.ts'

/**
 * Convert a table node to a docx Table element.
 * Handles colspan and rowspan via columnSpan/rowSpan on TableCell.
 */
export function convertTable(node: MdNode, ctx: DocxContext): Table {
  const rows = node.content ?? []

  // Derive per-column widths (in DXA/twips). Always returns a full array so
  // fixed layout produces even columns even when the doc has no explicit widths.
  const columnWidths = deriveColumnWidths(rows)

  const tableRows = rows.map((row, rowIdx) => {
    // Track the grid-column index so cell widths map to the right columns even
    // when earlier cells span multiple columns (colIdx alone is the in-row cell
    // index, not the grid column).
    let gridCol = 0
    const cells = (row.content ?? []).map((cell) => {
      const span = clampSpan(cell.attrs?.colspan)
      // A spanning cell's width is the sum of the grid columns it covers.
      let widthDxa = 0
      for (let i = 0; i < span; i++) widthDxa += columnWidths[gridCol + i] ?? 0
      gridCol += span
      return convertTableCell(cell, ctx, widthDxa)
    })
    // Repeat the first row as a header on every page when it is a header row.
    const isHeaderRow =
      rowIdx === 0 && (row.content ?? []).some((c) => c.type === 'tableHeader')
    return new TableRow({ children: cells, tableHeader: isHeaderRow || undefined })
  })

  return new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    // Fixed layout honors explicit column widths. When the doc has explicit
    // widths we use them; otherwise we distribute the page width evenly so
    // columns don't collapse to their content (Word's auto layout squeezes
    // empty columns). Either way fixed layout gives predictable, even columns.
    columnWidths,
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
    },
  })
}

/**
 * Convert a single table cell (tableCell or tableHeader) node.
 */
function convertTableCell(
  cell: MdNode,
  ctx: DocxContext,
  columnWidthDxa?: number,
): TableCell {
  const colspan = clampSpan(cell.attrs?.colspan)
  const rowspan = clampSpan(cell.attrs?.rowspan)
  const isHeader = cell.type === 'tableHeader'

  // Cell width: use the resolved column width so fixed layout stays even.
  const cellWidthDxa =
    Number.isFinite(columnWidthDxa) && (columnWidthDxa as number) > 0
      ? Math.round(columnWidthDxa as number)
      : undefined

  // Convert cell content — cells contain block content (paragraphs, etc.)
  const paragraphs = convertCellContent(cell.content ?? [], ctx)

  // Ensure at least one paragraph (docx requires it)
  if (paragraphs.length === 0) {
    paragraphs.push(new Paragraph({ children: [] }))
  }

  const cellOptions: ITableCellOptions = {
    children: paragraphs,
    columnSpan: colspan > 1 ? colspan : undefined,
    rowSpan: rowspan > 1 ? rowspan : undefined,
    ...(cellWidthDxa ? { width: { size: cellWidthDxa, type: WidthType.DXA } } : {}),
    ...(isHeader ? { shading: { fill: 'F0F0F0' } } : {}),
  }

  return new TableCell(cellOptions)
}

/**
 * Derive per-column widths (in DXA/twips). Reads explicit ProseMirror
 * `colwidth` (px) when present; any column without an explicit width gets an
 * even share of the remaining page width. Always returns a full array so the
 * table can use fixed layout with evenly distributed columns (Word's auto
 * layout otherwise squeezes empty columns to near-zero).
 */
function deriveColumnWidths(rows: MdNode[]): number[] {
  const firstRow = rows[0]
  const cells = firstRow?.content ?? []

  // Usable content width for A4 portrait with ~1in margins ≈ 9026 twips.
  const PAGE_CONTENT_DXA = 9026

  // Expand colspans so the array is one entry per grid column.
  const explicit: (number | null)[] = []
  for (const cell of cells) {
    const span = clampSpan(cell.attrs?.colspan)
    const cw = Array.isArray(cell.attrs?.colwidth) ? cell.attrs?.colwidth : null
    for (let i = 0; i < span; i++) {
      const raw = cw ? Number(cw[i]) : NaN
      explicit.push(Number.isFinite(raw) && raw > 0 ? Math.round(raw * 15) : null)
    }
  }

  const colCount = explicit.length || 1
  const explicitSum = explicit.reduce<number>((s, w) => s + (w ?? 0), 0)
  const missing = explicit.filter((w) => w === null).length

  if (missing > 0) {
    // Distribute the remaining page width across columns without an explicit
    // width. Guard against overflow: if explicit widths already fill/exceed the
    // page, fall back to a small minimum so the total stays near the page width
    // instead of blowing past the margin (fixed layout would otherwise clip).
    const remaining = PAGE_CONTENT_DXA - explicitSum
    const evenShare = remaining > 0 ? Math.round(remaining / missing) : 0
    const MIN_COL = 200
    const share = Math.max(MIN_COL, evenShare)
    return explicit.map((w) => w ?? share)
  }

  // No explicit widths: split the page evenly across all grid columns.
  const fallbackEven = Math.round(PAGE_CONTENT_DXA / colCount)
  return explicit.map((w) => w ?? fallbackEven)
}

/**
 * Convert cell content (usually paragraphs) into Paragraph elements.
 */
function convertCellContent(nodes: MdNode[], ctx: DocxContext): Paragraph[] {
  const paragraphs: Paragraph[] = []

  for (const node of nodes) {
    if (node.type === 'paragraph') {
      const runs = convertInlineContent(node.content ?? [], ctx.emojiGlyph)
      paragraphs.push(
        new Paragraph({
          children: runs,
          spacing: { before: 40, after: 40 },
        }),
      )
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      // Flatten nested lists in cells into paragraphs with bullet/number prefix
      const items = node.content ?? []
      items.forEach((item, idx) => {
        const prefix = node.type === 'orderedList' ? `${idx + 1}. ` : '• '
        // Extract inline content from the first paragraph inside the list item
        const firstPara = (item.content ?? []).find((c) => c.type === 'paragraph')
        const runs = firstPara
          ? [new TextRun({ text: prefix }), ...convertInlineContent(firstPara.content ?? [], ctx.emojiGlyph)]
          : [new TextRun({ text: prefix + extractPlainText(item) })]
        paragraphs.push(
          new Paragraph({
            children: runs,
            spacing: { before: 20, after: 20 },
          }),
        )
      })
    } else {
      // For other block types in cells, extract text content
      const runs = convertInlineContent(node.content ?? [], ctx.emojiGlyph)
      if (runs.length > 0) {
        paragraphs.push(new Paragraph({ children: runs }))
      }
    }
  }

  return paragraphs
}

/**
 * Extract plain text from a node tree (for simplified table cell content).
 */
function extractPlainText(node: MdNode): string {
  if (node.text) return node.text
  if (!node.content) return ''
  return node.content.map(extractPlainText).join('')
}
