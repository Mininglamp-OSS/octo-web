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
import { convertImage } from './nodes.ts'
import type { MdNode, DocxContext } from './types.ts'

/**
 * Convert a table node to a docx Table element.
 * Handles colspan and rowspan via columnSpan/rowSpan on TableCell.
 */
export function convertTable(node: MdNode, ctx: DocxContext, availWidthDxa?: number): Table {
  const rows = node.content ?? []

  // Derive per-column widths (in DXA/twips). Always returns a full array so
  // fixed layout produces even columns even when the doc has no explicit widths.
  // A nested table is constrained by its containing cell's width, not the full
  // page — pass that down so inner columns (and the images inside them) shrink
  // to fit instead of being laid out at page scale.
  const columnWidths = deriveColumnWidths(rows, availWidthDxa)

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
    // A nested table (availWidthDxa provided) must be sized in absolute twips and
    // bounded by its containing cell, otherwise a `100%` percentage width lets it
    // (and an oversized image inside) spill past the cell and collapse its
    // siblings to a sliver. Top-level tables keep 100% of the page content width.
    width:
      typeof availWidthDxa === 'number' && Number.isFinite(availWidthDxa) && availWidthDxa > 0
        ? { size: columnWidths.reduce((s, w) => s + w, 0), type: WidthType.DXA }
        : { size: 100, type: WidthType.PERCENTAGE },
    // Fixed layout honors explicit column widths. When the doc has explicit
    // widths we use them; otherwise we distribute the page width evenly so
    // columns don't collapse to their content (Word's auto layout squeezes
    // empty columns). Either way fixed layout gives predictable, even columns.
    columnWidths,
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'E5E6EB' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E6EB' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'E5E6EB' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'E5E6EB' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E5E6EB' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E5E6EB' },
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

  // Convert cell content — cells contain block content (paragraphs, nested
  // tables, images, lists, etc.). Bound image width to the cell's inner width so
  // images (including those in nested tables) shrink to fit rather than
  // overflowing: px ≈ DXA/15, minus the left+right cell inset (~7pt each ≈ 19px).
  const CELL_INSET_PX = 19
  const cellInnerPx =
    cellWidthDxa && cellWidthDxa > 0
      ? Math.max(24, Math.round(cellWidthDxa / 15) - CELL_INSET_PX)
      : undefined
  // Tighten any inherited (outer-cell) bound further with this cell's own width,
  // so deeply nested cells keep shrinking their images.
  const inheritedMax = ctx.maxImageWidthPx
  const nextMax =
    cellInnerPx != null && inheritedMax != null
      ? Math.min(cellInnerPx, inheritedMax)
      : (cellInnerPx ?? inheritedMax)
  const cellCtx: DocxContext = nextMax != null ? { ...ctx, maxImageWidthPx: nextMax } : ctx
  // Inner DXA width available to a NESTED table in this cell: the cell width
  // minus both insets (~7pt = ~105 twips each). Falls back to undefined so a
  // cell with no resolved width lets the nested table use the page default.
  const CELL_INSET_DXA = 105
  const cellInnerDxa =
    cellWidthDxa && cellWidthDxa > 0 ? Math.max(360, cellWidthDxa - CELL_INSET_DXA * 2) : undefined
  const children = convertCellContent(cell.content ?? [], cellCtx, cellInnerDxa)

  // Ensure at least one paragraph (docx requires a cell to be non-empty, and a
  // cell ending in a table must still be followed by a paragraph).
  if (children.length === 0 || children[children.length - 1] instanceof Table) {
    children.push(new Paragraph({ children: [] }))
  }

  const cellOptions: ITableCellOptions = {
    children,
    columnSpan: colspan > 1 ? colspan : undefined,
    rowSpan: rowspan > 1 ? rowspan : undefined,
    ...(cellWidthDxa ? { width: { size: cellWidthDxa, type: WidthType.DXA } } : {}),
    ...(isHeader ? { shading: { fill: 'F2F3F5' } } : {}),
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
function deriveColumnWidths(rows: MdNode[], availWidthDxa?: number): number[] {
  const firstRow = rows[0]
  const cells = firstRow?.content ?? []

  // Usable content width. For a top-level table this is A4 portrait with ~1in
  // margins ≈ 9026 twips; for a nested table it is the containing cell's inner
  // width so the nested grid never exceeds the space it actually occupies.
  const PAGE_CONTENT_DXA =
    typeof availWidthDxa === 'number' && Number.isFinite(availWidthDxa) && availWidthDxa > 0
      ? availWidthDxa
      : 9026

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
  const isNested = typeof availWidthDxa === 'number' && Number.isFinite(availWidthDxa) && availWidthDxa > 0

  if (missing > 0) {
    // Distribute the remaining page width across columns without an explicit
    // width. Guard against overflow: if explicit widths already fill/exceed the
    // page, fall back to a small minimum so the total stays near the page width
    // instead of blowing past the margin (fixed layout would otherwise clip).
    const remaining = PAGE_CONTENT_DXA - explicitSum
    const evenShare = remaining > 0 ? Math.round(remaining / missing) : 0
    const MIN_COL = 200
    const share = Math.max(MIN_COL, evenShare)
    const mixed = explicit.map((w) => w ?? share)
    // For a NESTED table, oversized explicit columns plus an appended minimum
    // sliver can push the total well past the cell width (e.g. [10500,10500]
    // + 1 missing -> [10500,10500,200] = 21200 twips in a 4303 cell). Fit the
    // whole row to the cell so the nested table can never overflow. Top-level
    // tables keep the page-scale distribution.
    return isNested ? fitColumnWidths(mixed, PAGE_CONTENT_DXA) : mixed
  }

  // No explicit widths: split the page evenly across all grid columns.
  const fallbackEven = Math.round(PAGE_CONTENT_DXA / colCount)
  const resolved = explicit.map((w) => w ?? fallbackEven)

  // All columns have explicit widths. For a NESTED table (availWidthDxa given)
  // the editor colwidths are page-scale pixels and are frequently lopsided
  // (e.g. a resized cell 259px + two 14px siblings -> 3885/209/209 twips). Under
  // FIXED layout Word honours those literally, so a ~14px sliver column crushes
  // its text into a one-character-per-line vertical stack (the "ffdsaf" bug) and
  // inner tables/images overflow. Normalize to the cell's inner width and clamp
  // each column to a sane band so no column collapses to a sliver or hogs the
  // row. Top-level tables keep literal explicit widths (page-scale already), so
  // only nested tables are reflowed. Mirrors the PDF (Typst) nested clamp.
  return isNested ? fitColumnWidths(resolved, PAGE_CONTENT_DXA) : resolved
}

/**
 * Fit a full set of column widths to `avail` for a nested table.
 *
 * Two goals, in priority order:
 *   1. The final total must never exceed `avail` (Word fixed layout would
 *      otherwise overflow the containing cell and crush its siblings).
 *   2. No column should collapse to an unreadable sliver.
 *
 * Steps: scale to `avail`, clamp each column to [MIN_SHARE, MAX_SHARE] x the
 * even share, then — because flooring narrow columns up can push the sum back
 * over `avail` — redistribute any excess by shrinking the above-minimum columns
 * proportionally until `sum <= avail`. If even every column at its floor still
 * exceeds `avail` (very many columns), fall back to an even split.
 */
function fitColumnWidths(widths: number[], avail: number): number[] {
  const n = widths.length
  if (n <= 1) return [Math.round(avail)]
  const sum = widths.reduce((s, w) => s + w, 0)
  if (sum <= 0) return widths.map(() => Math.round(avail / n))

  const even = avail / n
  const MIN_SHARE = 0.6 // no column narrower than 60% of the even share
  const MAX_SHARE = 1.6 // no column wider than 160% of the even share
  const minW = even * MIN_SHARE
  const maxW = even * MAX_SHARE

  // If flooring every column already overflows (too many columns for the min
  // share to fit), the min band is unsatisfiable — split evenly instead.
  if (minW * n > avail) return widths.map(() => Math.round(avail / n))

  // Scale to the available width, then clamp each column into the band.
  const scale = avail / sum
  const clamped = widths.map((w) => Math.min(maxW, Math.max(minW, w * scale)))

  // Flooring narrow columns up can make the total exceed `avail`. Shrink the
  // columns that sit above the floor, proportionally to their slack, until the
  // total fits. This preserves min floors and never overshoots.
  let total = clamped.reduce((s, w) => s + w, 0)
  let excess = total - avail
  if (excess > 1e-6) {
    for (let guard = 0; guard < 8 && excess > 1e-6; guard++) {
      const slack = clamped.reduce((s, w) => s + Math.max(0, w - minW), 0)
      if (slack <= 1e-6) break
      const factor = Math.min(1, excess / slack)
      for (let i = 0; i < n; i++) {
        const room = clamped[i] - minW
        if (room > 0) clamped[i] -= room * factor
      }
      total = clamped.reduce((s, w) => s + w, 0)
      excess = total - avail
    }
  }
  return clamped.map((w) => Math.round(w))
}

/**
 * Convert cell content (usually paragraphs) into Paragraph elements.
 */
function convertCellContent(
  nodes: MdNode[],
  ctx: DocxContext,
  availWidthDxa?: number,
): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []

  for (const node of nodes) {
    if (node.type === 'paragraph') {
      const runs = convertInlineContent(node.content ?? [], ctx.emojiGlyph)
      children.push(
        new Paragraph({
          children: runs,
          spacing: { before: 40, after: 40 },
        }),
      )
    } else if (node.type === 'image') {
      // Images are block atoms, so inside a cell they appear as sibling block
      // nodes (not inline). convertImage returns Paragraph(s) carrying the
      // ImageRun; push them so cell images render instead of vanishing.
      for (const child of convertImage(node, ctx)) {
        if (child instanceof Paragraph) children.push(child)
      }
    } else if (node.type === 'table') {
      // Nested table inside a cell. docx TableCell children accept Table, so
      // recurse instead of dropping it (and its images) via the text-extract
      // fallback below.
      children.push(convertTable(node, ctx, availWidthDxa))
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
        children.push(
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
        children.push(new Paragraph({ children: runs }))
      }
    }
  }

  return children
}

/**
 * Extract plain text from a node tree (for simplified table cell content).
 */
function extractPlainText(node: MdNode): string {
  if (node.text) return node.text
  if (!node.content) return ''
  return node.content.map(extractPlainText).join('')
}
