// Self-built table row/column reorder handles (octo-docs-backend#76). A ProseMirror
// plugin renders a grab handle at the left edge of the hovered row and the top edge of
// the hovered column; dragging a handle reorders that row/column within the table.
//
// Why NOT reuse BlockDragHandle: that handle moves a whole top-level block via a
// NodeSelection slice through ProseMirror's native drag pipeline. A table row/column is
// not a top-level block — it lives inside the table's TableMap grid — so a slice move
// would tear the table apart. Reordering has to rebuild the grid in one transaction.
//
// Why NOT hand-roll the grid rebuild: prosemirror-tables (bundled with @tiptap/pm 3.22.2)
// already ships `moveTableRow` / `moveTableColumn` — the exact "TableMap-based reorder in a
// single transaction" the issue asks us to build. They:
//   - rebuild the table with a single `tr.replaceWith` (one transaction, content preserved);
//   - expand the moved index range to cover merged cells (colspan/rowspan) via
//     getSelectionRangeInColumn / …InRow, so a merge group moves as a unit and a drop that
//     would split a merge is a safe no-op (the command returns false) rather than corrupting
//     the grid;
//   - restore a CellSelection on the moved row/column afterwards (`select: true`), which is
//     the "selection/decoration recovery after TableMap rebuild" concern — the library
//     re-resolves the selection against the rebuilt map for us.
// So the reorder COMMAND is the library's; this file is only the drag-handle UI + hit-testing
// that drives it. See the PR description for the full feasibility write-up.
//
// Collaboration-safe by design: the move lands as an ordinary editor transaction
// (`tr.replaceWith`), so y-prosemirror syncs it like any other edit — no bespoke collab code.
// The handle + drop-indicator are plugin-managed DOM outside the document (like
// BlockDragHandle), so the mutation observer never sees them as content.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { TableMap, cellAround, moveTableColumn, moveTableRow } from '@tiptap/pm/tables'
import type { Node as PMNode } from '@tiptap/pm/model'

export const tableReorderPluginKey = new PluginKey('octoTableReorder')

// Opt-in runtime tracing for diagnosing the drag wiring (octo-docs-backend#76). The reorder is
// DOM/pointer-driven, so a jsdom unit test cannot exercise the wiring that connects a real drag to
// moveTableRow / moveTableColumn — this hook captures that path in a real browser. It is inert and
// zero-cost unless a page explicitly opts in with `window.__tableReorderDebug = []` before
// dragging, so it is safe to leave in place: each drag phase then pushes a structured record you
// can read back to confirm dragstart / drop / command dispatch actually fired.
interface ReorderDebugEvent {
  phase: 'begin' | 'move' | 'drop' | 'dispatch'
  [key: string]: unknown
}
function reorderDebug(event: ReorderDebugEvent): void {
  if (typeof window === 'undefined') return
  const sink = (window as unknown as { __tableReorderDebug?: ReorderDebugEvent[] }).__tableReorderDebug
  if (Array.isArray(sink)) sink.push(event)
}

// Thickness (px) of the grab bar that sits in the gutter above a column / left of a row. Kept
// slim so it hugs the table edge and stays clear of the column-resize handle (interior, right
// edge of each cell) and the block drag handle (further out in the left gutter).
const BAR = 14

/** Resolved geometry for the table cell under a screen point. `rect` holds TableMap grid
 * indices ({left,top,right,bottom} as column/row indices), `cellPos` is the document position
 * just before the cell. Returns null when the point is not inside a table cell. */
interface CellContext {
  table: PMNode
  tableStart: number
  tablePos: number
  map: TableMap
  rect: { left: number; top: number; right: number; bottom: number }
  cellPos: number
}

// Resolve the real `<table>` element for a table node position. `view.nodeDOM(tablePos)` returns
// prosemirror-tables' `.tableWrapper` div, whose box INCLUDES the table's `margin: 12px 0` — the
// wrapper is a block-formatting context (`overflow-x: auto`), so the child table's vertical margin
// sits inside it and the wrapper's top edge is ~12px ABOVE the first row. Clamping / caret geometry
// must use the inner table's rect, not the wrapper's, or vertical positions land in that margin gap
// (this is what made column drags a no-op while rows — whose left margin is 0 — worked). Returns
// null when the node view isn't laid out yet.
function tableElementAt(view: EditorView, tablePos: number): HTMLElement | null {
  const dom = view.nodeDOM(tablePos)
  if (!(dom instanceof HTMLElement)) return null
  if (dom.tagName === 'TABLE') return dom
  const inner = dom.querySelector('table')
  return inner instanceof HTMLElement ? inner : dom
}

/** Re-resolve a drag's source cell against a document, by the position just before it.
 *
 * The blocking collab bug (octo-docs-backend#76 review): `beginDrag` captures the source
 * row/column index and cell position as ABSOLUTE values at drag start. On drop, `runMove` used
 * those stale numbers directly — but this is a y-prosemirror collaborative editor, so a remote
 * peer inserting or deleting a row/column ABOVE the dragged one during the drag remaps the
 * document; the stale index then points at a DIFFERENT row/column and the reorder moves the
 * wrong one (a correctness defect, not a crash).
 *
 * The fix has two halves that meet here: (1) the drag's `cellPos` is remapped through every
 * transaction that arrives mid-drag (the plugin `state.apply` below maps it via `tr.mapping`, so
 * it keeps pointing at the SAME cell across concurrent edits), and (2) at drop / hover time we
 * re-derive the live grid index from that remapped position with this helper instead of trusting
 * the drag-start index. Returns null when the source cell no longer resolves (e.g. a collaborator
 * deleted it), which makes the drop a safe no-op rather than a mis-move. */
export function resolveDragSource(
  doc: PMNode,
  cellPos: number,
): { tableStart: number; rect: { left: number; top: number; right: number; bottom: number }; cellPos: number } | null {
  if (cellPos < 0 || cellPos + 1 > doc.content.size) return null
  let $inside
  try {
    $inside = doc.resolve(cellPos + 1)
  } catch {
    return null
  }
  let depth = -1
  for (let d = $inside.depth; d > 0; d--) {
    if ($inside.node(d).type.spec.tableRole === 'table') {
      depth = d
      break
    }
  }
  if (depth < 0) return null
  const table = $inside.node(depth)
  const tableStart = $inside.start(depth)
  const $cell = cellAround($inside)
  if (!$cell) return null
  const map = TableMap.get(table)
  try {
    const rect = map.findCell($cell.pos - tableStart)
    return { tableStart, rect, cellPos: $cell.pos }
  } catch {
    return null
  }
}

function cellContextAt(view: EditorView, clientX: number, clientY: number): CellContext | null {
  const found = view.posAtCoords({ left: clientX, top: clientY })
  if (!found) return null
  const $pos = view.state.doc.resolve(found.pos)
  let depth = -1
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.spec.tableRole === 'table') {
      depth = d
      break
    }
  }
  if (depth < 0) return null
  const table = $pos.node(depth)
  const tableStart = $pos.start(depth)
  const tablePos = $pos.before(depth)
  const $cell = cellAround($pos)
  if (!$cell) return null
  const map = TableMap.get(table)
  const rect = map.findCell($cell.pos - tableStart)
  return { table, tableStart, tablePos, map, rect, cellPos: $cell.pos }
}

/** State captured at drag start: which axis, plus enough table/cell identity to (a) confirm a
 * drop lands in the SAME table and (b) place the selection back inside the source before running
 * the move command. `cellPos`, `tableStart` and `tablePos` are POSITIONS, remapped through every
 * transaction that arrives during the drag (see the plugin `state.apply`), so they survive
 * concurrent remote edits. The source row/column INDEX is intentionally NOT stored: it is
 * re-derived from the (remapped) `cellPos` via `resolveDragSource` at hover/drop time, so a
 * collaborator changing the grid above the dragged row/column can never leave us moving a stale
 * index (octo-docs-backend#76 review fix). */
interface DragState {
  kind: 'row' | 'col'
  tableStart: number
  tablePos: number
  cellPos: number
}

/** Table row/column reorder extension. */
export const TableReorderHandle = Extension.create({
  name: 'tableReorderHandle',

  addProseMirrorPlugins() {
    let rowHandle: HTMLElement | null = null
    let colHandle: HTMLElement | null = null
    let indicator: HTMLElement | null = null
    // Last cell the pointer hovered while idle — the source for a drag that starts on a handle.
    let hover: CellContext | null = null
    // Non-null only while a handle is being dragged.
    let drag: DragState | null = null
    // Resolved drop target row/column index during a drag (null = no valid target yet).
    let dropIndex: number | null = null

    const hideHandles = () => {
      if (rowHandle) rowHandle.style.display = 'none'
      if (colHandle) colHandle.style.display = 'none'
      hover = null
    }
    const hideIndicator = () => {
      if (indicator) indicator.style.display = 'none'
    }

    // Position the resting row/column handles against the hovered cell. Geometry is read live
    // from the DOM each move so the handles track scrolling inside .tableWrapper.
    const placeHandles = (view: EditorView, ctx: CellContext) => {
      if (!rowHandle || !colHandle) return
      const cellDom = view.nodeDOM(ctx.cellPos)
      const tableDom = tableElementAt(view, ctx.tablePos)
      if (!(cellDom instanceof HTMLElement) || !tableDom) {
        hideHandles()
        return
      }
      const base = (view.dom as HTMLElement).getBoundingClientRect()
      const cell = cellDom.getBoundingClientRect()
      const table = tableDom.getBoundingClientRect()

      // Column handle: a bar spanning the hovered column's width, just above the table.
      colHandle.style.display = 'flex'
      colHandle.style.left = `${cell.left - base.left}px`
      colHandle.style.top = `${table.top - base.top - BAR - 2}px`
      colHandle.style.width = `${cell.width}px`
      colHandle.style.height = `${BAR}px`

      // Row handle: a bar spanning the hovered row's height, just left of the table.
      rowHandle.style.display = 'flex'
      rowHandle.style.left = `${table.left - base.left - BAR - 2}px`
      rowHandle.style.top = `${cell.top - base.top}px`
      rowHandle.style.width = `${BAR}px`
      rowHandle.style.height = `${cell.height}px`

      hover = ctx
    }

    // Draw the insertion caret at the boundary a drop would land on. Mirrors the library's
    // move semantics: dragging toward a lower index lands BEFORE the hovered row/column, toward
    // a higher index lands AFTER it. A drop on the source itself shows nothing (it's a no-op).
    const showIndicator = (view: EditorView, ctx: CellContext) => {
      if (!indicator || !drag) return
      // Re-derive the source index from the (remapped) cellPos against the CURRENT doc, so a
      // concurrent remote insert/delete above the dragged row/column shifts the caret and the
      // drop-direction test onto the row/column the user actually grabbed.
      const source = resolveDragSource(view.state.doc, drag.cellPos)
      if (!source) {
        dropIndex = null
        hideIndicator()
        return
      }
      const srcIndex = drag.kind === 'col' ? source.rect.left : source.rect.top
      const hovered = drag.kind === 'col' ? ctx.rect.left : ctx.rect.top
      if (hovered === srcIndex) {
        dropIndex = null
        hideIndicator()
        return
      }
      const cellDom = view.nodeDOM(ctx.cellPos)
      const tableDom = tableElementAt(view, ctx.tablePos)
      if (!(cellDom instanceof HTMLElement) || !tableDom) return
      const base = (view.dom as HTMLElement).getBoundingClientRect()
      const cell = cellDom.getBoundingClientRect()
      const table = tableDom.getBoundingClientRect()
      const before = hovered < srcIndex

      indicator.style.display = 'block'
      if (drag.kind === 'col') {
        const x = before ? cell.left : cell.right
        indicator.style.left = `${x - base.left - 1}px`
        indicator.style.top = `${table.top - base.top}px`
        indicator.style.width = '2px'
        indicator.style.height = `${table.height}px`
      } else {
        const y = before ? cell.top : cell.bottom
        indicator.style.left = `${table.left - base.left}px`
        indicator.style.top = `${y - base.top - 1}px`
        indicator.style.width = `${table.width}px`
        indicator.style.height = '2px'
      }
      dropIndex = hovered
    }

    // Run the reorder. The move command resolves the target table from the CURRENT selection
    // (getCellsInColumn/…Row read selection.$from), so first drop the caret into a cell of the
    // source row/column — a pure selection change (no doc edit, so y-prosemirror ignores it) —
    // then dispatch the single-transaction move on the updated state.
    const runMove = (view: EditorView) => {
      if (!drag || dropIndex == null) {
        reorderDebug({ phase: 'drop', dispatched: false, reason: 'no valid target', drag, dropIndex })
        return
      }
      // Re-resolve the source cell against the CURRENT doc from its remapped position, then take
      // the move's `from` from the live grid rect — never the drag-start index. Under concurrent
      // collaboration a remote peer may have inserted/deleted rows or columns above the dragged
      // one during the drag; the stale index would move the wrong row/column, but the remapped
      // cellPos still identifies the original cell (octo-docs-backend#76 review fix).
      const source = resolveDragSource(view.state.doc, drag.cellPos)
      if (!source) {
        reorderDebug({ phase: 'drop', dispatched: false, reason: 'source no longer resolves', drag, dropIndex })
        return
      }
      const fromIndex = drag.kind === 'col' ? source.rect.left : source.rect.top
      if (dropIndex === fromIndex) {
        reorderDebug({ phase: 'drop', dispatched: false, reason: 'no-op (same index)', from: fromIndex, dropIndex })
        return
      }
      let $inside
      try {
        $inside = view.state.doc.resolve(source.cellPos + 1)
      } catch {
        return
      }
      view.dispatch(view.state.tr.setSelection(TextSelection.near($inside)))
      const command =
        drag.kind === 'col'
          ? moveTableColumn({ from: fromIndex, to: dropIndex })
          : moveTableRow({ from: fromIndex, to: dropIndex })
      const dispatched = command(view.state, view.dispatch)
      reorderDebug({ phase: 'dispatch', kind: drag.kind, from: fromIndex, to: dropIndex, dispatched })
      view.focus()
    }

    const endDrag = (view: EditorView) => {
      document.removeEventListener('mousemove', onDocMove, true)
      document.removeEventListener('mouseup', onDocUp, true)
      document.body.classList.remove('octo-table-reordering')
      runMove(view)
      drag = null
      dropIndex = null
      hideIndicator()
      hideHandles()
    }

    // Bound once so add/removeEventListener pair up; `activeView` is set on drag start.
    let activeView: EditorView | null = null
    const onDocMove = (event: MouseEvent) => {
      if (!drag || !activeView) return
      event.preventDefault()
      // The grab handles sit in the gutter OUTSIDE the table (left of a row, above a column), and
      // a drag naturally travels along that gutter — so the raw pointer point is usually not over
      // any table cell and posAtCoords resolves nothing. Probe the drop target with the pointer
      // clamped into the table's interior instead: for a row drag the pointer's Y still selects the
      // row (X is pulled inside), for a column drag its X still selects the column. Clamp against
      // the real <table> rect (not the wrapper, whose box includes the table's 12px top/bottom
      // margin) — clamping to the wrapper's top lands ~12px above the first row, in the margin gap
      // over no cell, which is why the column axis was a silent no-op (octo-docs-backend#76 rework).
      let probeX = event.clientX
      let probeY = event.clientY
      const tableDom = tableElementAt(activeView, drag.tablePos)
      if (tableDom) {
        const t = tableDom.getBoundingClientRect()
        probeX = Math.min(Math.max(probeX, t.left + 1), t.right - 1)
        probeY = Math.min(Math.max(probeY, t.top + 1), t.bottom - 1)
      }
      const ctx = cellContextAt(activeView, probeX, probeY)
      if (!ctx || ctx.tableStart !== drag.tableStart) {
        reorderDebug({
          phase: 'move',
          x: event.clientX,
          y: event.clientY,
          probeX,
          probeY,
          resolved: false,
          reason: !ctx ? 'no cell under pointer' : 'different table',
        })
        dropIndex = null
        hideIndicator()
        return
      }
      showIndicator(activeView, ctx)
      reorderDebug({
        phase: 'move',
        x: event.clientX,
        y: event.clientY,
        resolved: true,
        hovered: drag.kind === 'col' ? ctx.rect.left : ctx.rect.top,
        dropIndex,
      })
    }
    const onDocUp = () => {
      if (activeView) endDrag(activeView)
    }

    const beginDrag = (view: EditorView, kind: 'row' | 'col', event: MouseEvent) => {
      if (!view.editable || !hover) return
      event.preventDefault()
      drag = {
        kind,
        tableStart: hover.tableStart,
        tablePos: hover.tablePos,
        cellPos: hover.cellPos,
      }
      reorderDebug({ phase: 'begin', kind, index: kind === 'col' ? hover.rect.left : hover.rect.top })
      dropIndex = null
      activeView = view
      document.body.classList.add('octo-table-reordering')
      document.addEventListener('mousemove', onDocMove, true)
      document.addEventListener('mouseup', onDocUp, true)
    }

    return [
      new Plugin({
        key: tableReorderPluginKey,
        // Keep an in-flight drag's captured positions valid across every transaction that lands
        // during the drag — crucially the REMOTE ones y-prosemirror applies for collaborators.
        // Mapping `cellPos`/`tablePos`/`tableStart` through `tr.mapping` means a peer inserting or
        // deleting rows/columns above the dragged one shifts our anchors with the document, so the
        // drop still targets the original row/column (octo-docs-backend#76 review fix). This state
        // holds no value of its own; it exists only for the mapping side effect on the drag anchor.
        state: {
          init: () => null,
          apply: (tr) => {
            if (drag && tr.docChanged) {
              drag = {
                ...drag,
                cellPos: tr.mapping.map(drag.cellPos),
                tablePos: tr.mapping.map(drag.tablePos),
                tableStart: tr.mapping.map(drag.tableStart),
              }
            }
            return null
          },
        },
        view(view) {
          const wrapper = view.dom.parentElement
          rowHandle = document.createElement('div')
          rowHandle.className = 'octo-table-reorder octo-table-reorder--row'
          rowHandle.setAttribute('contenteditable', 'false')
          rowHandle.setAttribute('aria-label', 'Drag to reorder row')
          rowHandle.style.display = 'none'
          colHandle = document.createElement('div')
          colHandle.className = 'octo-table-reorder octo-table-reorder--col'
          colHandle.setAttribute('contenteditable', 'false')
          colHandle.setAttribute('aria-label', 'Drag to reorder column')
          colHandle.style.display = 'none'
          indicator = document.createElement('div')
          indicator.className = 'octo-table-reorder-indicator'
          indicator.setAttribute('contenteditable', 'false')
          indicator.style.display = 'none'

          if (wrapper) {
            rowHandle.style.position = 'absolute'
            colHandle.style.position = 'absolute'
            indicator.style.position = 'absolute'
            wrapper.appendChild(rowHandle)
            wrapper.appendChild(colHandle)
            wrapper.appendChild(indicator)
          }

          const onRowDown = (e: MouseEvent) => beginDrag(view, 'row', e)
          const onColDown = (e: MouseEvent) => beginDrag(view, 'col', e)
          rowHandle.addEventListener('mousedown', onRowDown)
          colHandle.addEventListener('mousedown', onColDown)

          return {
            destroy() {
              document.removeEventListener('mousemove', onDocMove, true)
              document.removeEventListener('mouseup', onDocUp, true)
              document.body.classList.remove('octo-table-reordering')
              rowHandle?.removeEventListener('mousedown', onRowDown)
              colHandle?.removeEventListener('mousedown', onColDown)
              rowHandle?.remove()
              colHandle?.remove()
              indicator?.remove()
              rowHandle = colHandle = indicator = null
              activeView = null
              drag = null
            },
          }
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              // Freeze the resting handles while a drag is in flight (the document-level
              // listeners own the pointer then).
              if (drag) return false
              if (!view.editable) return false
              const ctx = cellContextAt(view, event.clientX, event.clientY)
              if (!ctx) {
                hideHandles()
                return false
              }
              placeHandles(view, ctx)
              return false
            },
            mouseleave(_view, event) {
              if (drag) return false
              // Keep the handles up when the pointer moves onto one of them (they live outside
              // the editor DOM, so leaving the prose region toward a handle must not hide it).
              const to = (event as MouseEvent).relatedTarget as Node | null
              if (to && (rowHandle?.contains(to) || colHandle?.contains(to))) return false
              hideHandles()
              return false
            },
          },
        },
      }),
    ]
  },
})
