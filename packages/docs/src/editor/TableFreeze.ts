// Table freeze panes (#755, XIN-1096).
//
// Adds "freeze rows / freeze columns" (冻结窗格) to the Docs editor table without touching the
// collaborative content model. Freeze is a VIEW-STATE feature:
//
//   - The set of frozen tables (keyed by the table node's document position) lives in a ProseMirror
//     plugin state, NOT in the Y.Doc. Nothing is written to the schema, so SCHEMA_VERSION and the
//     backend stub are untouched and there is no collab-sync surface to conflict on. The trade-off
//     is that freeze is per-client and does not persist across reload — documented in the PR. (If
//     leadership later wants durable, shared freeze, it becomes a coordinated schema-version bump
//     adding frozenRows/frozenCols attrs to the `table` node, the same class of change as v18.)
//
//   - The plugin's view applies `position: sticky` to the first N rows / first N columns of each
//     frozen table, measuring row heights / column widths from the live DOM so the sticky offsets
//     line up with resized columns (#749). A frozen table is also flipped to separate borders
//     (`octo-frozen-table` class) because Chromium ignores sticky on `<td>/<th>` under
//     border-collapse:collapse and the table's default overflow:hidden captures the sticky offset —
//     both verified in the browser. Styling the cells' own DOM is safe under collaboration:
//     TableCellView.ignoreMutation already discards attribute/style mutations on the cell element,
//     so these writes never round-trip as document edits.
//
// The ribbon button (Toolbar) and the right-click submenu (TableControls) both drive the commands
// declared here; they never manipulate freeze state directly.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TableMap, selectionCell } from '@tiptap/pm/tables'

/** How many leading rows / columns of a table are frozen. `{ rows: 0, cols: 0 }` means unfrozen. */
export interface FreezeSpec {
  rows: number
  cols: number
}

/** Frozen tables, keyed by the document position immediately BEFORE the table node. */
export type FreezeMap = Map<number, FreezeSpec>

interface FreezeMeta {
  pos: number
  spec: FreezeSpec
}

export const tableFreezeKey = new PluginKey<FreezeMap>('octoTableFreeze')

/**
 * Prefix sums of `sizes`: element i is the sum of every size before it (so the first is always 0).
 * Used to turn a list of frozen row heights / column widths into the sticky `top` / `left` offset
 * for each frozen band. Pure so it can be unit-tested without a real layout (jsdom reports 0-size
 * boxes, so the browser is where the pixel offsets are actually verified).
 */
export function cumulativeOffsets(sizes: number[]): number[] {
  const out: number[] = []
  let acc = 0
  for (const s of sizes) {
    out.push(acc)
    acc += s
  }
  return out
}

interface CellContext {
  /** Position immediately before the enclosing table node (the FreezeMap key). */
  tablePos: number
  /** Zero-based row / column index of the cell holding the selection head. */
  rowIndex: number
  colIndex: number
  /** Table dimensions, used to clamp a freeze request to what the table can actually offer. */
  rowCount: number
  colCount: number
}

/**
 * Resolve the table cell around the selection head, or null when the caret is not inside a table.
 * Returns the enclosing table's position (used as the freeze key) plus the clicked cell's row/column
 * index so "freeze up to this row/column" can turn the caret position into a frozen band count.
 */
function cellContext(state: EditorState): CellContext | null {
  let $cell
  try {
    $cell = selectionCell(state)
  } catch {
    return null
  }
  if (!$cell) return null
  const table = $cell.node(-1)
  if (!table || table.type.name !== 'table') return null
  const map = TableMap.get(table)
  const tableStart = $cell.start(-1)
  const rect = map.findCell($cell.pos - tableStart)
  return {
    tablePos: $cell.before(-1),
    rowIndex: rect.top,
    colIndex: rect.left,
    rowCount: map.height,
    colCount: map.width,
  }
}

/** Whether the caret currently sits inside a table (gates the freeze UI). */
export function isInTable(state: EditorState): boolean {
  return cellContext(state) !== null
}

/**
 * Freeze spec for the table around the current selection, `{ rows: 0, cols: 0 }` when unfrozen or
 * outside a table. The ribbon/menu read this to show active state.
 */
export function getFreezeSpec(state: EditorState): FreezeSpec {
  const ctx = cellContext(state)
  if (!ctx) return { rows: 0, cols: 0 }
  return tableFreezeKey.getState(state)?.get(ctx.tablePos) ?? { rows: 0, cols: 0 }
}

// --- rendering (plugin view) -------------------------------------------------------------------

const FROZEN_ATTR = 'data-octo-frozen'

export function clearFrozenCell(cell: HTMLElement): void {
  cell.style.position = ''
  cell.style.top = ''
  cell.style.left = ''
  cell.style.zIndex = ''
  cell.classList.remove('octo-frozen-cell', 'octo-frozen-row-cell', 'octo-frozen-col-cell')
  cell.removeAttribute(FROZEN_ATTR)
}

/**
 * Per-visual-column widths for a table, measured from the live DOM against the span-aware grid.
 *
 * A `colspan` cell owns several grid columns (one DOM cell, N visual columns) and a `rowspan` cell
 * is absent from the `<tr>`s it covers, so a plain `row.cells[i].offsetWidth` is NOT the width of
 * visual column `i`. We walk the ProseMirror rows/cells in lockstep with the DOM cells — they render
 * in the same order — and size each column from a `colspan=1` cell wherever one exists, falling back
 * to splitting a spanning cell's width across the columns it is the only source for.
 */
function measureColumnWidths(domRows: HTMLTableRowElement[], node: PMNode, map: TableMap): number[] {
  const widths = new Array<number>(map.width).fill(NaN)
  const spanning: { left: number; right: number; width: number }[] = []

  node.forEach((rowNode, rowOffset, rowIdx) => {
    const domRow = domRows[rowIdx]
    if (!domRow) return
    const domCells = domRow.cells
    let d = 0
    rowNode.forEach((_cellNode, cellOffset) => {
      const cell = domCells[d++]
      if (!cell) return
      const rect = map.findCell(rowOffset + 1 + cellOffset)
      if (rect.right - rect.left === 1) {
        if (Number.isNaN(widths[rect.left])) widths[rect.left] = cell.offsetWidth
      } else {
        spanning.push({ left: rect.left, right: rect.right, width: cell.offsetWidth })
      }
    })
  })

  // Columns only ever covered by spanning cells: split the spanning cell's width across the columns
  // it alone touches, so cumulative left offsets stay monotonic.
  for (const s of spanning) {
    const unknown: number[] = []
    let known = 0
    for (let c = s.left; c < s.right; c++) {
      if (Number.isNaN(widths[c])) unknown.push(c)
      else known += widths[c]
    }
    if (unknown.length) {
      const each = Math.max(0, (s.width - known) / unknown.length)
      for (const c of unknown) widths[c] = each
    }
  }

  for (let c = 0; c < widths.length; c++) if (Number.isNaN(widths[c])) widths[c] = 0
  return widths
}

/**
 * Apply sticky styling to the first `spec.rows` rows and `spec.cols` columns of `table`. Frozen-band
 * membership and the sticky offsets are derived from the table's `TableMap` — the same span-aware
 * grid model the freeze commands use — NOT from raw DOM cell indices, so merged cells stay aligned:
 * a `colspan` cell occupies its full column range and a `rowspan` cell only lives in the row it
 * starts in (the rows it covers have no DOM cell of their own). Offsets are still measured from the
 * live DOM so they follow column resizes. A frozen row's cells stick to the top; a frozen column's
 * cells stick to the left; a corner cell (both) stacks above either single axis.
 */
export function applyFrozenStyles(table: HTMLTableElement, node: PMNode, spec: FreezeSpec): void {
  const domRows = Array.from(table.rows)
  if (!domRows.length) return
  const map = TableMap.get(node)
  const frozenRows = Math.max(0, Math.min(spec.rows, map.height))
  const frozenCols = Math.max(0, Math.min(spec.cols, map.width))
  const anyFrozen = frozenRows > 0 || frozenCols > 0

  // A frozen table switches to separate borders and is no longer its own scroll container — both
  // required for position:sticky on cells to actually hold (Chromium ignores sticky cells under
  // border-collapse:collapse, and the table's default overflow:hidden captures the sticky offset).
  // The border redraw lives in CSS keyed off this class.
  table.classList.toggle('octo-frozen-table', anyFrozen)

  // A frozen header needs a vertical scroll container to stick within — the wrapper already scrolls
  // horizontally, so bound its height (CSS) only while rows are frozen.
  const wrapper = table.closest('.tableWrapper')
  if (wrapper) wrapper.classList.toggle('octo-has-frozen-rows', frozenRows > 0)

  // Each <tr> is exactly one visual row, so DOM row index == grid row index — top offsets come
  // straight from the row boxes. Column widths must respect spans, so measure against the grid.
  const rowTops = cumulativeOffsets(domRows.slice(0, frozenRows).map((r) => r.offsetHeight))
  const colWidths = measureColumnWidths(domRows, node, map)
  const colLefts = cumulativeOffsets(colWidths.slice(0, frozenCols))

  node.forEach((rowNode, rowOffset, rowIdx) => {
    const domRow = domRows[rowIdx]
    if (!domRow) return
    const domCells = domRow.cells
    let d = 0
    rowNode.forEach((_cellNode, cellOffset) => {
      const cell = domCells[d++]
      if (!cell) return
      const rect = map.findCell(rowOffset + 1 + cellOffset)
      const inFrozenRow = rect.top < frozenRows
      const inFrozenCol = rect.left < frozenCols
      if (!inFrozenRow && !inFrozenCol) return
      cell.setAttribute(FROZEN_ATTR, '')
      cell.classList.add('octo-frozen-cell')
      cell.style.position = 'sticky'
      if (inFrozenRow) {
        cell.classList.add('octo-frozen-row-cell')
        cell.style.top = `${rowTops[rect.top]}px`
      }
      if (inFrozenCol) {
        cell.classList.add('octo-frozen-col-cell')
        cell.style.left = `${colLefts[rect.left]}px`
      }
      cell.style.zIndex = inFrozenRow && inFrozenCol ? '4' : inFrozenRow ? '3' : '2'
    })
  })
}

/**
 * Plugin view that keeps the DOM in sync with the freeze state: on every editor update it clears any
 * previously frozen cells and re-applies sticky styling for the currently frozen tables. Re-measuring
 * each time keeps the offsets correct after column resizes, row insert/delete, or remote edits.
 */
class FreezeStyleView {
  private view: EditorView

  constructor(view: EditorView) {
    this.view = view
    this.render()
  }

  update(): void {
    this.render()
  }

  destroy(): void {
    this.reset()
  }

  private reset(): void {
    this.view.dom
      .querySelectorAll<HTMLElement>(`[${FROZEN_ATTR}]`)
      .forEach((el) => clearFrozenCell(el))
    this.view.dom
      .querySelectorAll('.octo-has-frozen-rows')
      .forEach((el) => el.classList.remove('octo-has-frozen-rows'))
    this.view.dom
      .querySelectorAll('.octo-frozen-table')
      .forEach((el) => el.classList.remove('octo-frozen-table'))
  }

  private render(): void {
    this.reset()
    const map = tableFreezeKey.getState(this.view.state)
    if (!map || map.size === 0) return
    map.forEach((spec, pos) => {
      if (spec.rows <= 0 && spec.cols <= 0) return
      const node = this.view.state.doc.nodeAt(pos)
      if (!node || node.type.name !== 'table') return
      let dom: Node | null = null
      try {
        dom = this.view.nodeDOM(pos)
      } catch {
        dom = null
      }
      if (!(dom instanceof HTMLElement)) return
      const table =
        dom instanceof HTMLTableElement ? dom : dom.querySelector<HTMLTableElement>('table')
      if (!table) return
      applyFrozenStyles(table, node, spec)
    })
  }
}

/**
 * The freeze plugin: holds the FreezeMap, remaps it across document edits (dropping entries whose
 * table was deleted), and mounts the styling view.
 */
export function tableFreezePlugin(): Plugin<FreezeMap> {
  return new Plugin<FreezeMap>({
    key: tableFreezeKey,
    state: {
      init: () => new Map(),
      apply(tr, value) {
        let next = value
        if (tr.docChanged && value.size) {
          const mapped: FreezeMap = new Map()
          value.forEach((spec, pos) => {
            const mappedPos = tr.mapping.map(pos, -1)
            const node = tr.doc.nodeAt(mappedPos)
            if (node && node.type.name === 'table') mapped.set(mappedPos, spec)
          })
          next = mapped
        }
        const meta = tr.getMeta(tableFreezeKey) as FreezeMeta | undefined
        if (meta) {
          next = new Map(next)
          if (meta.spec.rows <= 0 && meta.spec.cols <= 0) next.delete(meta.pos)
          else next.set(meta.pos, meta.spec)
        }
        return next
      },
    },
    view(view) {
      return new FreezeStyleView(view)
    },
  })
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableFreeze: {
      /** Set an explicit freeze extent on the current table (fields left undefined keep their value). */
      setTableFreeze: (spec: Partial<FreezeSpec>) => ReturnType
      /** Toggle freezing the top header row (rows 0 ↔ 1), keeping the frozen-column count. */
      toggleFreezeHeaderRow: () => ReturnType
      /** Toggle freezing the first column (cols 0 ↔ 1), keeping the frozen-row count. */
      toggleFreezeFirstColumn: () => ReturnType
      /** Freeze every row down to and including the row holding the caret. */
      freezeThroughSelectedRow: () => ReturnType
      /** Freeze every column up to and including the column holding the caret. */
      freezeThroughSelectedColumn: () => ReturnType
      /** Remove all freezing from the current table. */
      clearTableFreeze: () => ReturnType
    }
  }
}

/** Table freeze-panes extension: view-state freeze plus the commands the UI drives. */
export const TableFreeze = Extension.create({
  name: 'tableFreeze',

  addProseMirrorPlugins() {
    return [tableFreezePlugin()]
  },

  addCommands() {
    const dispatchFreeze = (
      state: EditorState,
      dispatch: ((tr: import('@tiptap/pm/state').Transaction) => void) | undefined,
      compute: (current: FreezeSpec, ctx: CellContext) => FreezeSpec,
    ): boolean => {
      const ctx = cellContext(state)
      if (!ctx) return false
      const current = tableFreezeKey.getState(state)?.get(ctx.tablePos) ?? {
        rows: 0,
        cols: 0,
      }
      const wanted = compute(current, ctx)
      const spec: FreezeSpec = {
        rows: Math.max(0, Math.min(Math.round(wanted.rows), ctx.rowCount)),
        cols: Math.max(0, Math.min(Math.round(wanted.cols), ctx.colCount)),
      }
      if (dispatch) {
        const meta: FreezeMeta = { pos: ctx.tablePos, spec }
        dispatch(state.tr.setMeta(tableFreezeKey, meta))
      }
      return true
    }

    return {
      setTableFreeze:
        (spec) =>
        ({ state, dispatch }) =>
          dispatchFreeze(state, dispatch, (current) => ({
            rows: spec.rows ?? current.rows,
            cols: spec.cols ?? current.cols,
          })),
      toggleFreezeHeaderRow:
        () =>
        ({ state, dispatch }) =>
          dispatchFreeze(state, dispatch, (current) => ({
            rows: current.rows >= 1 ? 0 : 1,
            cols: current.cols,
          })),
      toggleFreezeFirstColumn:
        () =>
        ({ state, dispatch }) =>
          dispatchFreeze(state, dispatch, (current) => ({
            rows: current.rows,
            cols: current.cols >= 1 ? 0 : 1,
          })),
      freezeThroughSelectedRow:
        () =>
        ({ state, dispatch }) =>
          dispatchFreeze(state, dispatch, (current, ctx) => ({
            rows: ctx.rowIndex + 1,
            cols: current.cols,
          })),
      freezeThroughSelectedColumn:
        () =>
        ({ state, dispatch }) =>
          dispatchFreeze(state, dispatch, (current, ctx) => ({
            rows: current.rows,
            cols: ctx.colIndex + 1,
          })),
      clearTableFreeze:
        () =>
        ({ state, dispatch }) =>
          dispatchFreeze(state, dispatch, () => ({ rows: 0, cols: 0 })),
    }
  },
})
