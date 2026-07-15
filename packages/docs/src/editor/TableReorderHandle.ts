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
//
// Concurrency guard (plan B, octo-docs-backend#76 / XIN-1187). The reorder command rebuilds the
// whole table with a single coarse `tr.replaceWith`. TableReorderConcurrency.test.ts shows the
// real hazard: two whole-table replaces that land concurrently (a remote reorder, or a remote
// add/delete row·column / merge·split racing our drag) DO converge in the CRDT, but y-prosemirror
// re-diffs each replace against the base and interleaves cell text — the peers agree on a GARBLED
// table, i.e. silent data loss. The fine-grained fix (plan A) is scheduled separately; plan B is a
// serialize-or-abort guard layered on top: we snapshot the dragged table's structure at drag start
// (`tableStructureSignature`) and, if any transaction that arrives DURING the drag changes that
// table (structure or cell content), we ABORT the reorder instead of committing the replace — a
// clear i18n toast tells the user to retry. Aborting is a pure early return before any dispatch, so
// there is no half-commit and no dirty state; we would rather cancel than silently corrupt.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { TableMap, cellAround, moveTableColumn, moveTableRow } from '@tiptap/pm/tables'
import type { Node as PMNode } from '@tiptap/pm/model'
import { t } from '../octoweb/index.ts'

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

/** Fingerprint of a single table NODE. Folds in exactly the things a corrupting concurrent edit
 * would move: the grid dimensions (add/delete row·column), each cell's colspan/rowspan (merge·split)
 * and each cell's text in grid order (a remote reorder reshuffles the text, a concurrent cell edit
 * rewrites it). Returns null when the node isn't a laid-out table. Keyed only off the node's own
 * content, so it is independent of the node's document position — see `countTableSignature`. */
export function signatureOfTable(table: PMNode): string | null {
  if (table.type.spec.tableRole !== 'table') return null
  let map: TableMap
  try {
    map = TableMap.get(table)
  } catch {
    return null
  }
  const parts: string[] = [`${map.height}x${map.width}`]
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      const cell = table.nodeAt(map.map[r * map.width + c])
      if (!cell) {
        parts.push('-')
        continue
      }
      const colspan = (cell.attrs.colspan as number | undefined) ?? 1
      const rowspan = (cell.attrs.rowspan as number | undefined) ?? 1
      parts.push(`${cell.textContent}#${colspan},${rowspan}`)
    }
  }
  return parts.join('|')
}

/** Fingerprint of the table that contains `cellPos`. Used at drag start to snapshot the dragged
 * table's structure (the plan-B baseline). Returns null when `cellPos` no longer resolves to a
 * table cell. Thin wrapper over `signatureOfTable` that first locates the enclosing table. */
export function tableStructureSignature(doc: PMNode, cellPos: number): string | null {
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
  return signatureOfTable($inside.node(depth))
}

/** How many tables in `doc` currently have structure signature `sig`. The plan-B guard uses this
 * instead of re-fingerprinting a single remapped anchor. WHY: under real collaboration y-prosemirror
 * applies a remote update as one coarse `ReplaceStep`, and mapping an interior anchor (the dragged
 * cell) through that replace collapses it to the replace boundary — so the anchor no longer resolves
 * to its cell even when the dragged table is UNTOUCHED, and the old anchor+null==conflict check then
 * false-aborted on any edit elsewhere in the doc (octo-docs-backend#76 FAIL-2). Counting tables that
 * still carry the drag-start signature is position-independent, so an edit to OTHER tables or prose
 * leaves the count unchanged, while a structural change to the dragged table drops it. */
export function countTableSignature(doc: PMNode, sig: string): number {
  let n = 0
  doc.descendants((node) => {
    if (node.type.spec.tableRole === 'table') {
      if (signatureOfTable(node) === sig) n++
      return false // tables don't nest; don't descend
    }
    return true
  })
  return n
}

/** Plan-B conflict decision, scoped to the DRAGGED table only. `baselineSig` is the dragged table's
 * signature at drag start and `baselineCount` how many tables shared it then. A conflict is latched
 * only when the number of tables carrying that signature DROPS — i.e. the dragged table's structure
 * (or content) actually changed, or it was deleted. Concurrent edits to other tables or to prose
 * leave the dragged table's signature present, so they no longer trigger a false abort. A null
 * baseline (drag never fingerprinted a table) disables the guard rather than aborting blindly. */
export function draggedTableConflict(doc: PMNode, baselineSig: string | null, baselineCount: number): boolean {
  if (baselineSig === null) return false
  return countTableSignature(doc, baselineSig) < baselineCount
}

/** Transient, document-external toast telling the user their reorder was cancelled because a
 * collaborator changed the same table mid-drag. Lives in <body> (never the Y.Doc), so it cannot
 * desync collab content — mirrors `notifyFileError` in fileUpload.ts. */
function notifyReorderConflict(): void {
  if (typeof document === 'undefined') return
  const el = document.createElement('div')
  el.className = 'octo-table-reorder-error'
  el.setAttribute('role', 'alert')
  el.textContent = t('docs.table.reorderConflict')
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 4000)
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
    // Plan-B concurrency guard. `dragBaseline` is the dragged table's structure signature captured
    // at drag start and `dragBaselineCount` how many tables shared it then; `concurrentEdit` latches
    // true when a transaction landing during the drag drops that count — i.e. the dragged table's own
    // structure/content changed (a remote reorder / add·delete row·column / merge·split / cell edit
    // on THAT table — see the plugin `state.apply`). Edits to other tables or prose leave the count
    // unchanged, so they never latch. When latched, `runMove` aborts the reorder rather than
    // committing a whole-table replace that would silently corrupt against the concurrent edit.
    let dragBaseline: string | null = null
    let dragBaselineCount = 0
    let concurrentEdit = false
    // Latches true once we have seen a mid-drag mousemove that actually reports the primary button
    // held (`buttons & 1`). It gates the "released outside the window" abort below: that abort must
    // only fire on a genuine release, i.e. AFTER the button was observed down. Some event sources
    // deliver a drag whose moves never set `buttons` (a synthetic MouseEvent built without it, a raw
    // CDP `Input.dispatchMouseEvent` that omits the field) — those report `buttons === 0` for the
    // whole drag even though a real button is logically down, and treating the first such move as a
    // release wrongly cancelled the reorder (octo-docs-backend#76 / XIN-1215 headed-Chromium repro).
    let pointerHeldSeen = false

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
      // Plan-B guard: a collaborator changed this table during the drag. Abort BEFORE any dispatch
      // (no selection change, no move) so there is zero half-commit, and tell the user to retry —
      // committing the whole-table replace now would silently corrupt against their edit.
      if (concurrentEdit) {
        reorderDebug({ phase: 'drop', dispatched: false, reason: 'concurrent structural edit — aborted' })
        notifyReorderConflict()
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

    // Tear down every document/window listener a drag installs. Kept in one place so endDrag (a
    // completed drop), cancelDrag (an interrupted drag) and the plugin destroy all detach the SAME
    // set — a listener left attached after the drag ends would keep firing against stale state.
    const removeDragListeners = () => {
      document.removeEventListener('mousemove', onDocMove, true)
      document.removeEventListener('mouseup', onDocUp, true)
      document.removeEventListener('pointercancel', onDocCancel, true)
      document.removeEventListener('keydown', onDocKey, true)
      window.removeEventListener('blur', onWindowBlur)
    }

    // Clear all drag bookkeeping and restore the resting UI. Critically this un-freezes handle
    // placement: the resting-handle mousemove handler early-returns while `drag` is non-null, so
    // leaving `drag` set (or the body class) after a drag ends would strand the grab cursor and stop
    // the handles from ever tracking the pointer again — the "handles unavailable" failure mode.
    const resetDragState = () => {
      drag = null
      dropIndex = null
      dragBaseline = null
      dragBaselineCount = 0
      concurrentEdit = false
      pointerHeldSeen = false
      document.body.classList.remove('octo-table-reordering')
      hideIndicator()
      hideHandles()
    }

    const endDrag = (view: EditorView) => {
      removeDragListeners()
      runMove(view)
      resetDragState()
    }

    // Abort an in-flight drag WITHOUT committing a move. Used when the drag is interrupted rather
    // than completed with a real drop — the window loses focus (alt-tab), the OS cancels the pointer
    // (touch/pen), or the user presses Escape. Without this, a missed mouseup leaves `drag` set and
    // the `octo-table-reordering` body class stuck until the next stray mouseup, wedging the reorder
    // UI (stuck grab cursor + frozen handles). Aborting is a pure early return — no dispatch, no doc
    // change — so it can never corrupt content.
    const cancelDrag = () => {
      if (!drag) return
      reorderDebug({ phase: 'drop', dispatched: false, reason: 'drag interrupted — cancelled' })
      removeDragListeners()
      resetDragState()
    }

    // Bound once so add/removeEventListener pair up; `activeView` is set on drag start.
    let activeView: EditorView | null = null
    const onDocMove = (event: MouseEvent) => {
      if (!drag || !activeView) return
      // The primary button was released while we could not see it — the classic "let go outside the
      // window" interruption: the pointer left the window mid-drag, the mouseup fired over another
      // app (so our document `mouseup` listener never ran), and the button is now up as the pointer
      // re-enters. Treat it as an interruption, NOT a drop: abort with zero dispatch. Without this
      // the drag stays armed and the NEXT stray mouseup would wrongly commit the reorder — the
      // "interrupted drag still reordered the table" defect (octo-docs-backend#76 FAIL-1).
      //
      // Gate this on `pointerHeldSeen`: only abort once a mid-drag move has actually reported the
      // button held. A drag whose moves never carry `buttons` (a hand-built MouseEvent, a raw CDP
      // mouse event that omits the field) reports `buttons === 0` throughout even though the button
      // is logically down; without the gate the very first such move cancelled a perfectly good
      // reorder — which is exactly what made the handle look "unusable" under headed-Chromium
      // automation while a real held-button drag (buttons === 1) worked (octo-docs-backend#76 /
      // XIN-1215). A genuine release is always preceded by at least one held move, so the gate keeps
      // FAIL-1 intact.
      if ((event.buttons & 1) !== 0) {
        pointerHeldSeen = true
      } else if (pointerHeldSeen) {
        cancelDrag()
        return
      }
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
    // Interruption handlers: an interrupted drag must abort cleanly, never commit a move.
    const onDocCancel = () => cancelDrag()
    const onWindowBlur = () => cancelDrag()
    const onDocKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelDrag()
    }

    const beginDrag = (view: EditorView, kind: 'row' | 'col', event: MouseEvent) => {
      // Only a primary (left) button starts a reorder. A right/middle-click on the grab handle must
      // not begin a drag — it would fight the context menu and, with no matching left mouseup, could
      // strand the drag state (octo-docs-backend#76 review).
      if (event.button !== 0) return
      if (!view.editable || !hover) return
      event.preventDefault()
      drag = {
        kind,
        tableStart: hover.tableStart,
        tablePos: hover.tablePos,
        cellPos: hover.cellPos,
      }
      // Snapshot the dragged table's structure so the plan-B guard can detect a concurrent edit to
      // it during the drag: its signature plus how many tables currently share that signature. Reset
      // the latch for this fresh drag.
      dragBaseline = tableStructureSignature(view.state.doc, hover.cellPos)
      dragBaselineCount = dragBaseline === null ? 0 : countTableSignature(view.state.doc, dragBaseline)
      concurrentEdit = false
      pointerHeldSeen = false
      reorderDebug({ phase: 'begin', kind, index: kind === 'col' ? hover.rect.left : hover.rect.top })
      dropIndex = null
      activeView = view
      document.body.classList.add('octo-table-reordering')
      document.addEventListener('mousemove', onDocMove, true)
      document.addEventListener('mouseup', onDocUp, true)
      document.addEventListener('pointercancel', onDocCancel, true)
      document.addEventListener('keydown', onDocKey, true)
      window.addEventListener('blur', onWindowBlur)
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
          apply: (tr, _value, _oldState, newState) => {
            if (drag && tr.docChanged) {
              drag = {
                ...drag,
                cellPos: tr.mapping.map(drag.cellPos),
                tablePos: tr.mapping.map(drag.tablePos),
                tableStart: tr.mapping.map(drag.tableStart),
              }
              // Plan-B conflict detection, scoped to the dragged table only. Count the tables that
              // still carry the drag-start signature; a DROP means the dragged table's own structure
              // or content changed (or it was deleted) — latch a conflict so `runMove` aborts. This
              // is position-independent, so it does NOT depend on the remapped `cellPos` (which a
              // coarse y-prosemirror ReplaceStep can collapse to a boundary even when the table is
              // untouched) — that anchor drift is exactly what made edits OUTSIDE the dragged table
              // false-abort before (octo-docs-backend#76 FAIL-2). Benign edits elsewhere leave the
              // count unchanged, so the latch stays clear.
              if (!concurrentEdit && dragBaseline !== null) {
                if (draggedTableConflict(newState.doc, dragBaseline, dragBaselineCount)) concurrentEdit = true
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
              removeDragListeners()
              document.body.classList.remove('octo-table-reordering')
              rowHandle?.removeEventListener('mousedown', onRowDown)
              colHandle?.removeEventListener('mousedown', onColDown)
              rowHandle?.remove()
              colHandle?.remove()
              indicator?.remove()
              rowHandle = colHandle = indicator = null
              activeView = null
              drag = null
              dragBaseline = null
              dragBaselineCount = 0
              concurrentEdit = false
              pointerHeldSeen = false
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
