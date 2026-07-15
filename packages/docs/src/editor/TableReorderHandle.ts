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

/** State captured at drag start: which axis, the source row/column index, and enough table
 * identity to (a) confirm a drop lands in the SAME table and (b) place the selection back
 * inside the source before running the move command. */
interface DragState {
  kind: 'row' | 'col'
  index: number
  tableStart: number
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
      const tableDom = view.nodeDOM(ctx.tablePos)
      if (!(cellDom instanceof HTMLElement) || !(tableDom instanceof HTMLElement)) {
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
      const hovered = drag.kind === 'col' ? ctx.rect.left : ctx.rect.top
      if (hovered === drag.index) {
        dropIndex = null
        hideIndicator()
        return
      }
      const cellDom = view.nodeDOM(ctx.cellPos)
      const tableDom = view.nodeDOM(ctx.tablePos)
      if (!(cellDom instanceof HTMLElement) || !(tableDom instanceof HTMLElement)) return
      const base = (view.dom as HTMLElement).getBoundingClientRect()
      const cell = cellDom.getBoundingClientRect()
      const table = tableDom.getBoundingClientRect()
      const before = hovered < drag.index

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
      if (!drag || dropIndex == null || dropIndex === drag.index) return
      const { doc } = view.state
      if (drag.cellPos + 1 > doc.content.size) return
      let $inside
      try {
        $inside = doc.resolve(drag.cellPos + 1)
      } catch {
        return
      }
      view.dispatch(view.state.tr.setSelection(TextSelection.near($inside)))
      const command =
        drag.kind === 'col'
          ? moveTableColumn({ from: drag.index, to: dropIndex })
          : moveTableRow({ from: drag.index, to: dropIndex })
      command(view.state, view.dispatch)
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
      const ctx = cellContextAt(activeView, event.clientX, event.clientY)
      if (!ctx || ctx.tableStart !== drag.tableStart) {
        dropIndex = null
        hideIndicator()
        return
      }
      showIndicator(activeView, ctx)
    }
    const onDocUp = () => {
      if (activeView) endDrag(activeView)
    }

    const beginDrag = (view: EditorView, kind: 'row' | 'col', event: MouseEvent) => {
      if (!view.editable || !hover) return
      event.preventDefault()
      drag = {
        kind,
        index: kind === 'col' ? hover.rect.left : hover.rect.top,
        tableStart: hover.tableStart,
        cellPos: hover.cellPos,
      }
      dropIndex = null
      activeView = view
      document.body.classList.add('octo-table-reordering')
      document.addEventListener('mousemove', onDocMove, true)
      document.addEventListener('mouseup', onDocUp, true)
    }

    return [
      new Plugin({
        key: tableReorderPluginKey,
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
