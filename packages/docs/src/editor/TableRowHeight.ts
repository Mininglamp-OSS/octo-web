// Table row height + self-built "drag the horizontal row line" resize handle
// (SCHEMA-SPEC §4, SCHEMA_VERSION 19). The row-wise counterpart of the v4 column `colwidth`
// resize (#749): prosemirror-tables ships `columnResizing` but has NO built-in row-height
// resize, so — exactly as the boss signed off on "方案 A" — we add a `height` ATTRIBUTE to the
// `tableRow` node and a self-built ProseMirror plugin that renders a grab handle on the row's
// bottom edge and drives `setNodeMarkup` on drop.
//
// Two exports, mirroring how the editor already splits schema from interaction:
//   • TableRowHeight  — extends @tiptap/extension-table-row with the `height` attr (the schema
//     change; byte-aligned with the backend stub + SCHEMA-SPEC.md at v19). Registered in place of
//     the plain TableRow in extensions.ts.
//   • TableRowResize  — the drag-handle UI + hit-testing plugin (no schema of its own), modelled on
//     TableReorderHandle.ts. Registered AFTER the Table series so its plugin sits above the
//     column-resize / tableEditing plugins.
//
// WIRE CONTRACT (v19, must stay byte-aligned with the backend — octo-docs-backend XIN-1230):
//   • `tableRow.height`: `number | null`, default `null`.
//   • toDOM: height set → `['tr', { style: 'height:' + height + 'px' }, 0]`; null/unset → `['tr', 0]`
//     (no style — the row height is driven by content, identical to v18, so old docs are unchanged).
//   • parseDOM: read an integer px back from the `tr` inline `style="height:Npx"`; none → null.
//   • Unit is fixed px, an integer SCALAR per row (NOT an array — this is the key difference from the
//     v4 cell `colwidth`, which is a `number[]` across the spanned columns).
//
// COLLABORATION: `height` is an ordinary node attribute, so a resize lands as one plain transaction
// (`setNodeMarkup`) that y-prosemirror syncs like any other edit — no bespoke collab code. It is a
// Yjs scalar with last-write-wins semantics and involves NO grid REBUILD (unlike the #76 reorder's
// whole-table replace), so two peers resizing the same row simply converge on the last write.
//
// There is, however, one concurrency race the drag DOES have to guard against — the exact RC blocker
// the #823 review flagged: `beginDrag` captures the dragged row's document position at mousedown, but
// the height is only committed on mouseup. If a remote peer inserts or deletes a row (or otherwise
// changes the dragged table's structure) DURING the drag, that captured absolute position is remapped
// under us and now addresses a DIFFERENT row — committing to it would silently write the height to the
// wrong row. So, mirroring TableReorderHandle's plan-B guard (#76 / XIN-1225), the drag pins the row by
// a STABLE IDENTITY (the dragged table's ORDINAL among tables in document order + the row's index within
// it) and snapshots every table's signature at drag start; a mid-drag transaction that changes the
// dragged table's signature latches `concurrentEdit`, and the commit then ABORTS (a clear toast, zero
// dispatch) rather than write the height to a row the collaborator moved. When nothing concurrent
// touches the dragged table, the row is re-resolved by that ordinal + index at commit, so the write
// always lands on the row the user actually grabbed. See `resolveRowByOrdinal` / `rowIdentity` below.
//
// COEXISTENCE (hit-zone / z-index): the row handle sits on the row's BOTTOM edge (horizontal,
// `row-resize` cursor). That is spatially ORTHOGONAL to the column-resize handle (#749 — interior
// vertical right edge of each cell, `col-resize`), the reorder handles (#76 — left/top gutters,
// `grab`), and the block drag handle (further out in the left gutter). To keep the one place they
// could collide — the bottom-right corner of a cell — unambiguous, the row handle refuses to arm
// while the pointer is within the column-resize grab band of a vertical cell border, so the column
// resize keeps ownership there. Freeze (#755, sticky z-index 6), the font-colour picker (#719) and
// the right-click menu (z-index 1000) are unaffected — this plugin writes only a node attr and an
// overlay div outside the document.

import { Extension } from '@tiptap/core'
import TableRow from '@tiptap/extension-table-row'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { draggedTableConflict, tableSignatures } from './TableReorderHandle.ts'
import { t } from '../octoweb/index.ts'

/** Minimum row height (px) a drag can shrink a row to — the row-height analogue of prosemirror's
 * `cellMinWidth` (25). Kept comfortably above a single line's content box so a row can never be
 * dragged down to an ungrabbable sliver ("拖没"). */
export const MIN_ROW_HEIGHT = 24

/** Thickness (px) of the horizontal grab band straddling a row's bottom edge. Matches the widened
 * column `handleWidth` (12, #749) so both axes have the same comfortable grab feel. Also used as the
 * band around a VERTICAL cell border within which we defer to the column-resize handle. */
export const ROW_HANDLE_BAND = 12

/** Coerce any stored `height` value to a valid integer px >= MIN_ROW_HEIGHT, or null for "no explicit
 * height" (the default). Using null (not 0) as the empty sentinel keeps a plain row attr-free through
 * the Y.Doc — y-prosemirror stores every non-null attr — so old docs stay byte-identical and no
 * migration is needed, exactly how textAlign / lineHeight / indent default to null. */
export function normalizeRowHeight(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  const rounded = Math.round(n)
  return rounded >= MIN_ROW_HEIGHT ? rounded : rounded > 0 ? MIN_ROW_HEIGHT : null
}

/** Parse the integer px height back from a `<tr>`'s inline `style="height:Npx"`. Reads the resolved
 * `element.style.height` (the browser normalises it to e.g. "24px"), so spacing/casing in the source
 * string does not matter. Returns null when there is no height, it is not px, or it is non-positive —
 * which is the exact inverse of the toDOM below. */
export function parseRowHeightPx(element: HTMLElement): number | null {
  const raw = (element.style?.height ?? '').trim()
  if (raw === '' || !/px$/i.test(raw)) return null
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return normalizeRowHeight(n)
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableRowHeight: {
      /** Set the height (px) of the tableRow at document position `rowPos`. Pass null to clear it
       * (row height reverts to content-driven). Used by the resize plugin on drop and available for
       * tests / programmatic use. */
      setTableRowHeight: (rowPos: number, height: number | null) => ReturnType
    }
  }
}

/** @tiptap/extension-table-row + the v19 `height` attribute. */
export const TableRowHeight = TableRow.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      height: {
        // null = no explicit height (default). Kept out of the Y.Doc so old rows are byte-identical.
        default: null,
        parseHTML: (element: HTMLElement) => parseRowHeightPx(element),
        // toDOM: emit `style="height:Npx"` only when a height is set; otherwise no attribute at all,
        // so the row renders as a bare `<tr>` (content-driven height — identical to v18).
        renderHTML: (attributes: { height?: unknown }) => {
          const h = normalizeRowHeight(attributes.height)
          return h == null ? {} : { style: `height:${h}px` }
        },
      },
    }
  },

  addCommands() {
    return {
      setTableRowHeight:
        (rowPos, height) =>
        ({ state, dispatch }) => {
          const node = state.doc.nodeAt(rowPos)
          if (!node || node.type.name !== this.name) return false
          const next = normalizeRowHeight(height)
          if ((node.attrs.height ?? null) === next) return false
          if (dispatch) {
            dispatch(state.tr.setNodeMarkup(rowPos, undefined, { ...node.attrs, height: next }))
          }
          return true
        },
    }
  },
})

export const tableRowResizePluginKey = new PluginKey('octoTableRowResize')
export const tableRowClipPluginKey = new PluginKey('octoTableRowClip')

/** Build the node decorations that make a set row height AUTHORITATIVE (so a row can shrink below
 * its content, not just grow). For every tableRow carrying an explicit height we tag its `<tr>` with
 * `octo-row-fixed` + a `--octo-row-h` custom property; styles.css uses those to cap the cell content
 * wrapper's height with overflow:hidden. Pure view decoration — it changes the editable DOM only, so
 * toDOM/getHTML and the Y.Doc stay byte-identical (the height remains a plain tableRow attr). */
function rowHeightDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'tableRow') {
      const h = normalizeRowHeight(node.attrs.height)
      if (h != null) {
        decos.push(
          Decoration.node(pos, pos + node.nodeSize, { class: 'octo-row-fixed', style: `--octo-row-h:${h}px` }),
        )
      }
      return false // rows do not nest; no need to descend into cells
    }
    return true
  })
  return DecorationSet.create(doc, decos)
}

/** Build the plugin that keeps the row-height clip decorations in sync with the document. A FRESH
 * instance per editor: the live editor gets one via TableRowResize (alongside the drag handle), the
 * read-only preview / version diff gets one via TableRowClip (no drag handle). Both call this same
 * factory over the same `rowHeightDecorations`, so the clip can never drift between edit and preview —
 * a set row height is authoritative in all three states (SCHEMA_VERSION 19, XIN-1250 / XIN-1261). */
function createRowHeightClipPlugin(): Plugin {
  return new Plugin({
    key: tableRowClipPluginKey,
    state: {
      init: (_config, state) => rowHeightDecorations(state.doc),
      apply: (tr, old) => (tr.docChanged ? rowHeightDecorations(tr.doc) : old),
    },
    props: {
      decorations(state) {
        return this.getState(state)
      },
    },
  })
}

/** Read-only row-height clip extension: registers ONLY the clip decorations (no drag handle, no
 * concurrency machinery), so a stored row height is authoritative in the read-only preview / version
 * diff exactly as it is in the live editor. Reuses the SAME createRowHeightClipPlugin / rowHeightDecorations
 * as TableRowResize so the two paths can never drift (XIN-1261). Pair it with the TableCellView NodeView
 * so the `.octo-cell-clip` content wrapper the clip CSS caps actually exists in the preview DOM. */
export const TableRowClip = Extension.create({
  name: 'tableRowClip',
  addProseMirrorPlugins() {
    return [createRowHeightClipPlugin()]
  },
})

/** The tableRow (with its document position) whose bottom edge is currently armed for resize. */
interface RowTarget {
  rowPos: number
  rowNode: PMNode
  rowDom: HTMLElement
  tableDom: HTMLElement
}

/** Resolve the `<table>` element for a point's enclosing table cell. `view.nodeDOM` on a cell returns
 * the `<td>`/`<th>`; `.closest('table')` climbs to the grid element (NOT the `.tableWrapper`, whose box
 * includes the table's vertical margin — see TableReorderHandle.tableElementAt for that hazard). */
function tableOfCell(cellDom: HTMLElement): HTMLElement | null {
  const table = cellDom.closest('table')
  return table instanceof HTMLElement ? table : null
}

/** Resolve the tableRow under a screen point: its document position (just before the node), the node
 * itself, and the `<tr>` + `<table>` DOM. Returns null when the point is not inside a table row. */
function rowAt(view: EditorView, clientX: number, clientY: number): RowTarget | null {
  const found = view.posAtCoords({ left: clientX, top: clientY })
  if (!found) return null
  let $pos
  try {
    $pos = view.state.doc.resolve(found.pos)
  } catch {
    return null
  }
  let depth = -1
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === 'tableRow') {
      depth = d
      break
    }
  }
  if (depth < 0) return null
  const rowNode = $pos.node(depth)
  const rowPos = $pos.before(depth)
  const rowDom = view.nodeDOM(rowPos)
  if (!(rowDom instanceof HTMLElement)) return null
  const tableDom = tableOfCell(rowDom)
  if (!tableDom) return null
  return { rowPos, rowNode, rowDom, tableDom }
}

/** True when a screen X sits within the column-resize grab band of a vertical cell border. When it
 * does we DEFER to prosemirror-tables' column resize and do not arm the row handle, so the one corner
 * the two handles share (a cell's bottom-right) never fights. `cellDom` is the cell under the pointer. */
function nearColumnBorder(cellDom: HTMLElement, clientX: number): boolean {
  const r = cellDom.getBoundingClientRect()
  return Math.abs(clientX - r.left) <= ROW_HANDLE_BAND || Math.abs(clientX - r.right) <= ROW_HANDLE_BAND
}

/** Cell DOM under a point (for the column-border deferral test). */
function cellDomAt(view: EditorView, clientX: number, clientY: number): HTMLElement | null {
  const found = view.posAtCoords({ left: clientX, top: clientY })
  if (!found) return null
  let $pos
  try {
    $pos = view.state.doc.resolve(found.pos)
  } catch {
    return null
  }
  for (let d = $pos.depth; d > 0; d--) {
    const n = $pos.node(d)
    if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') {
      const dom = view.nodeDOM($pos.before(d))
      return dom instanceof HTMLElement ? dom : null
    }
  }
  return null
}

/** The STABLE IDENTITY of the row being resized, captured at drag start: the dragged table's ORDINAL
 * among tables in document order + the row's index within that table. This is the row-height analogue
 * of TableReorderHandle's `draggedTableIndex` (#76 / XIN-1225): under real collaboration y-prosemirror
 * delivers a remote edit as ONE coarse whole-document ReplaceStep that collapses any absolute position,
 * so the drag-start `rowPos` cannot be trusted at commit — but a table's ordinal and a row's index
 * within it both survive that step (tree order is preserved). Returns null when `rowPos` no longer
 * resolves to a table row. */
export function rowIdentity(doc: PMNode, rowPos: number): { ordinal: number; rowIndex: number } | null {
  if (rowPos < 0 || rowPos + 1 > doc.content.size) return null
  let $inside
  try {
    $inside = doc.resolve(rowPos + 1)
  } catch {
    return null
  }
  let tableDepth = -1
  for (let d = $inside.depth; d > 0; d--) {
    if ($inside.node(d).type.spec.tableRole === 'table') {
      tableDepth = d
      break
    }
  }
  if (tableDepth < 0) return null
  const rowIndex = $inside.index(tableDepth) // index of the tableRow child holding rowPos
  const tablePos = $inside.before(tableDepth)
  let seen = 0
  let ordinal = -1
  doc.descendants((node, pos) => {
    if (node.type.spec.tableRole === 'table') {
      if (pos === tablePos) ordinal = seen
      seen++
      return false // tables don't nest
    }
    return true
  })
  return ordinal < 0 ? null : { ordinal, rowIndex }
}

/** Re-resolve the dragged row's document position by its STABLE IDENTITY (table ordinal + row index)
 * against `doc`, returning the row node + the position just before it (what `setNodeMarkup` needs).
 * The row-height analogue of TableReorderHandle's `resolveDragSourceByOrdinal`: the ordinal survives a
 * coarse remote ReplaceStep that would collapse a remapped absolute position, and the row index stays
 * valid because ANY structural change to the dragged table aborts the commit (see the guard), so if we
 * reach a commit the dragged table's rows are exactly as they were at drag start. Returns null when the
 * ordinal no longer resolves to a table or the row index is out of range — a safe no-op. */
export function resolveRowByOrdinal(
  doc: PMNode,
  ordinal: number,
  rowIndex: number,
): { rowPos: number; rowNode: PMNode } | null {
  if (ordinal < 0 || rowIndex < 0) return null
  let seen = 0
  let table: { node: PMNode; pos: number } | null = null
  doc.descendants((node, pos) => {
    if (node.type.spec.tableRole === 'table') {
      if (seen === ordinal) table = { node, pos }
      seen++
      return false // tables don't nest
    }
    return true
  })
  if (!table) return null
  const found: { node: PMNode; pos: number } = table
  const tableStart = found.pos + 1
  let rowSeen = 0
  let result: { rowPos: number; rowNode: PMNode } | null = null
  found.node.forEach((child, offset) => {
    if (result || child.type.name !== 'tableRow') {
      if (child.type.name === 'tableRow') rowSeen++
      return
    }
    if (rowSeen === rowIndex) result = { rowPos: tableStart + offset, rowNode: child }
    rowSeen++
  })
  return result
}

/** Transient, document-external toast telling the user their row resize was cancelled because a
 * collaborator changed the same table mid-drag. Lives in <body> (never the Y.Doc), so it cannot
 * desync collab content — mirrors TableReorderHandle.notifyReorderConflict. */
function notifyRowResizeConflict(): void {
  if (typeof document === 'undefined') return
  const el = document.createElement('div')
  el.className = 'octo-table-row-resize-error'
  el.setAttribute('role', 'alert')
  el.textContent = t('docs.table.rowResizeConflict')
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 4000)
}

/** Self-built table row-height resize handle. */
export const TableRowResize = Extension.create({
  name: 'tableRowResize',

  addProseMirrorPlugins() {
    let handle: HTMLElement | null = null
    let guide: HTMLElement | null = null
    // Row armed for resize while idle (the source of a drag that starts on the handle).
    let armed: RowTarget | null = null
    // Non-null only while a drag is in flight. `rowPos` is the drag-start position, kept live for the
    // guide geometry by remapping it through each mid-drag transaction (a fine-grained fast path); the
    // COMMIT never trusts it — it re-resolves the row by the coarse-ReplaceStep-proof `ordinal` +
    // `rowIndex` identity instead (see `commitDrag`).
    let drag: { rowPos: number; ordinal: number; rowIndex: number; startY: number; startHeight: number; height: number } | null = null
    let activeView: EditorView | null = null
    // Concurrency guard (mirrors TableReorderHandle's plan-B, #76 / XIN-1225). `concurrentEdit` latches
    // true when a transaction landing during the drag changes the DRAGGED table's signature — a remote
    // insert/delete row·column, reorder, merge/split or cell edit on THAT table (see the plugin
    // `state.apply`). The dragged table is pinned by its stable ORDINAL against `dragBaselineSigs`
    // (the drag-start signature list), so an edit to prose or another table never latches. When latched,
    // `commitDrag` aborts rather than write the height to a row the collaborator moved out from under it.
    let concurrentEdit = false
    let dragBaselineSigs: (string | null)[] = []
    // True only while WE dispatch the commit, so the guard does not mistake our own setNodeMarkup for a
    // concurrent remote edit (belt-and-braces: the height attr is not part of a table signature anyway).
    let committing = false
    // Latches true once a mid-drag move has actually reported the primary button held (`buttons & 1`).
    // Gates the "released outside the window" abort in onDocMove so it fires only on a GENUINE release
    // (after the button was seen down), never on an event source whose moves omit `buttons` and report 0
    // throughout — the same latch TableReorderHandle uses to keep its FAIL-1 guard intact without
    // breaking synthetic/CDP-driven drags (#76). Reset in resetDrag / beginDrag.
    let pointerHeldSeen = false
    // Pointer id we captured on the handle at drag start (via setPointerCapture). Capturing routes the
    // terminal pointerup/pointercancel to us EVEN when the pointer is released outside the window, so a
    // drag can never be left silently armed for a later stray event to commit (#823 RC2 / XIN-1252).
    // null when capture was unavailable (jsdom / a synthetic pointer with no live id) — the buttons and
    // release-outside guards below still cover that fallback path.
    let capturedPointerId: number | null = null

    const hideHandle = () => {
      if (handle) handle.style.display = 'none'
      armed = null
    }
    const hideGuide = () => {
      if (guide) guide.style.display = 'none'
    }

    // Place the resting handle bar across the armed row's bottom edge (spanning the table width).
    // Geometry is read live from the DOM each move so the handle tracks scrolling inside .tableWrapper.
    const placeHandle = (view: EditorView, target: RowTarget) => {
      if (!handle) return
      const base = (view.dom as HTMLElement).getBoundingClientRect()
      const row = target.rowDom.getBoundingClientRect()
      const table = target.tableDom.getBoundingClientRect()
      handle.style.display = 'block'
      handle.style.left = `${table.left - base.left}px`
      handle.style.top = `${row.bottom - base.top - ROW_HANDLE_BAND / 2}px`
      handle.style.width = `${table.width}px`
      handle.style.height = `${ROW_HANDLE_BAND}px`
      armed = target
    }

    // Draw the live guide line at the pointer's Y (clamped so the row cannot shrink below the min)
    // while dragging. Overlay-only — the row's real height is committed once, on drop, so the drag
    // never mutates the document DOM and can never desync collaborative cursors.
    const placeGuide = (view: EditorView) => {
      if (!guide || !drag) return
      const target = rowTargetByPos(view, drag.rowPos)
      if (!target) return
      const base = (view.dom as HTMLElement).getBoundingClientRect()
      const row = target.rowDom.getBoundingClientRect()
      const table = target.tableDom.getBoundingClientRect()
      const y = row.top + drag.height // bottom edge implied by the dragged height
      guide.style.display = 'block'
      guide.style.left = `${table.left - base.left}px`
      guide.style.top = `${y - base.top - 1}px`
      guide.style.width = `${table.width}px`
      guide.style.height = '2px'
    }

    const rowTargetByPos = (view: EditorView, rowPos: number): RowTarget | null => {
      const rowNode = view.state.doc.nodeAt(rowPos)
      if (!rowNode || rowNode.type.name !== 'tableRow') return null
      const rowDom = view.nodeDOM(rowPos)
      if (!(rowDom instanceof HTMLElement)) return null
      const tableDom = tableOfCell(rowDom)
      if (!tableDom) return null
      return { rowPos, rowNode, rowDom, tableDom }
    }

    const removeDragListeners = () => {
      document.removeEventListener('pointermove', onDocMove, true)
      document.removeEventListener('pointerup', onDocUp, true)
      document.removeEventListener('pointercancel', onDocCancel, true)
      document.removeEventListener('keydown', onDocKey, true)
      window.removeEventListener('blur', onWindowBlur)
      // Detach the capture-loss listener BEFORE we release the pointer ourselves, so our own
      // releasePointerCapture does not re-enter cancelDrag mid-teardown (which would null `drag`
      // out from under a legitimate commit). A genuine external capture loss still aborts via the
      // listener while it is attached.
      if (handle) handle.removeEventListener('lostpointercapture', onLostCapture)
      if (handle && capturedPointerId != null) {
        try {
          handle.releasePointerCapture(capturedPointerId)
        } catch {
          /* pointer already gone (release outside / synthetic id) — nothing to release */
        }
      }
      capturedPointerId = null
    }

    const resetDrag = () => {
      drag = null
      concurrentEdit = false
      committing = false
      pointerHeldSeen = false
      capturedPointerId = null
      dragBaselineSigs = []
      document.body.classList.remove('octo-row-resizing')
      hideGuide()
      hideHandle()
    }

    // Commit the dragged height as a single setNodeMarkup transaction (y-prosemirror syncs it like any
    // edit). Two ways this is NOT committed, both safe no-ops rather than a wrong write:
    //   • a collaborator changed the dragged table mid-drag (`concurrentEdit`) — the captured row may
    //     have moved or been deleted, so we ABORT with a toast instead of writing the height to whatever
    //     row now sits at the stale position (the #823 RC blocker), and
    //   • the row no longer resolves by its stable identity, or the height did not actually change.
    // The target row is re-resolved by the coarse-ReplaceStep-proof `ordinal` + `rowIndex` identity, so
    // when nothing concurrent touched the table the write lands on exactly the row the user grabbed.
    const commitDrag = (view: EditorView) => {
      if (!drag) return
      if (concurrentEdit) {
        notifyRowResizeConflict()
        view.focus()
        return
      }
      const target = resolveRowByOrdinal(view.state.doc, drag.ordinal, drag.rowIndex)
      if (target) {
        const next = normalizeRowHeight(drag.height)
        if ((target.rowNode.attrs.height ?? null) !== next) {
          committing = true
          view.dispatch(view.state.tr.setNodeMarkup(target.rowPos, undefined, { ...target.rowNode.attrs, height: next }))
          committing = false
        }
      }
      view.focus()
    }

    function onDocMove(event: MouseEvent) {
      if (!drag || !activeView) return
      // Interrupt guard (mirrors TableReorderHandle FAIL-1, #76): the primary button was released while
      // we could not see it — the "let go outside the window, then move back in" path. The pointerup
      // fired over another app so our document `pointerup` never ran; the button is now up as the pointer
      // re-enters. Treat it as an interruption, NOT a drop: abort with zero commit. Without this the drag
      // stays armed and the next stray release commits a STALE row height (#823 RC2). Gate on
      // `pointerHeldSeen` so a synthetic/CDP drag whose moves omit `buttons` (reporting 0 throughout) is
      // not mistaken for a release on its first move; a genuine release always follows a held move.
      if ((event.buttons & 1) !== 0) {
        pointerHeldSeen = true
      } else if (pointerHeldSeen) {
        cancelDrag()
        return
      }
      event.preventDefault()
      const delta = event.clientY - drag.startY
      drag.height = Math.max(MIN_ROW_HEIGHT, Math.round(drag.startHeight + delta))
      placeGuide(activeView)
    }
    // True when a release happened OUTSIDE the window's viewport. Pointer capture (see beginDrag) routes
    // the terminal pointerup to us even when the user lets go past the window edge — the exact real-machine
    // path the tester hit (drag the row line, move the pointer out of the viewport, release, move back).
    // A release outside the window is an INTERRUPTION, not a drop: the user did not drop on a row edge, so
    // we abort and keep the original height rather than commit the last tracked (stale) height (#823 RC2 /
    // XIN-1252). A drop just inside the edge still commits normally.
    const releasedOutsideViewport = (event: MouseEvent): boolean => {
      if (typeof window === 'undefined') return false
      return (
        event.clientX < 0 ||
        event.clientY < 0 ||
        event.clientX > window.innerWidth ||
        event.clientY > window.innerHeight
      )
    }
    function onDocUp(event: MouseEvent) {
      if (!activeView || !drag) return
      const outside = releasedOutsideViewport(event)
      removeDragListeners()
      if (outside) {
        // Released outside the window — abort without committing (the drag was interrupted, not dropped).
        resetDrag()
        activeView.focus()
        return
      }
      commitDrag(activeView)
      resetDrag()
    }
    // Abort an in-flight drag WITHOUT committing — a pure early return, no dispatch, so an interrupted
    // drag can never write a stale height. Used by every interruption path below.
    const cancelDrag = () => {
      if (!drag) return
      removeDragListeners()
      resetDrag()
    }
    // Interruption handlers: an interrupted drag must abort cleanly, never commit a stale row height.
    const onDocCancel = () => cancelDrag()
    // The OS/browser revoked our pointer capture (pointer stolen, tab hidden, gesture recognised) without
    // a pointerup reaching us — treat it exactly like pointercancel and abort. removeDragListeners detaches
    // this before our own releasePointerCapture, so this only fires for genuine EXTERNAL capture loss.
    const onLostCapture = () => cancelDrag()
    function onWindowBlur() {
      cancelDrag()
    }
    function onDocKey(event: KeyboardEvent) {
      if (event.key === 'Escape') cancelDrag()
    }

    const beginDrag = (view: EditorView, event: PointerEvent) => {
      if (event.button !== 0 || !view.editable || !armed) return
      event.preventDefault()
      const startHeight = armed.rowDom.getBoundingClientRect().height
      // Pin the dragged row by its stable identity (table ordinal + row index) so the commit survives a
      // concurrent remote edit that remaps absolute positions (#823 RC / mirrors #76 XIN-1225).
      const identity = rowIdentity(view.state.doc, armed.rowPos)
      drag = {
        rowPos: armed.rowPos,
        ordinal: identity ? identity.ordinal : -1,
        rowIndex: identity ? identity.rowIndex : -1,
        startY: event.clientY,
        startHeight,
        height: Math.round(startHeight),
      }
      // Snapshot every table's signature so the guard can compare the dragged table's slot (by ordinal)
      // on each mid-drag transaction. Reset the latch for this fresh drag.
      dragBaselineSigs = tableSignatures(view.state.doc)
      concurrentEdit = false
      committing = false
      pointerHeldSeen = false
      capturedPointerId = null
      activeView = view
      document.body.classList.add('octo-row-resizing')
      // Capture the pointer on the handle so the terminal pointerup/pointercancel is delivered to US even
      // when the user releases OUTSIDE the window — the real-machine path where the old mouse-only drag
      // lost the release and left the drag armed for a stray mouseup to commit a stale height (#823 RC2 /
      // XIN-1252). Best-effort: a synthetic pointer (jsdom / a hand-built event) has no live id to capture,
      // so we swallow the throw and fall back to the buttons + release-outside guards, which still hold.
      if (handle && typeof event.pointerId === 'number') {
        try {
          handle.setPointerCapture(event.pointerId)
          capturedPointerId = event.pointerId
          handle.addEventListener('lostpointercapture', onLostCapture)
        } catch {
          capturedPointerId = null
        }
      }
      // Drive the drag off POINTER events (not mouse): with capture above, pointerup fires wherever the
      // release happens, so no interruption path can leave the drag silently armed. Listeners stay at the
      // document (capture phase) so captured pointer events — retargeted to the handle — still reach them.
      document.addEventListener('pointermove', onDocMove, true)
      document.addEventListener('pointerup', onDocUp, true)
      document.addEventListener('pointercancel', onDocCancel, true)
      document.addEventListener('keydown', onDocKey, true)
      window.addEventListener('blur', onWindowBlur)
    }

    return [
      createRowHeightClipPlugin(),
      new Plugin({
        key: tableRowResizePluginKey,
        // Detect a concurrent edit to the DRAGGED table on every transaction that lands during the drag
        // — crucially the REMOTE ones y-prosemirror applies for collaborators. The dragged table is
        // pinned by its stable ORDINAL (drag.ordinal) against the drag-start signature list, which
        // survives the coarse whole-document ReplaceStep y-tiptap emits for a remote edit (#76 XIN-1225).
        // This plugin state holds no value of its own; it exists only for the guard side effect + to keep
        // the guide's `rowPos` live for fine-grained (local) edits. `committing` skips our own commit.
        state: {
          init: () => null,
          apply: (tr, _value, _oldState, newState) => {
            if (drag && tr.docChanged && !committing) {
              if (!concurrentEdit && draggedTableConflict(newState.doc, dragBaselineSigs, drag.ordinal)) {
                concurrentEdit = true
              }
              // Best-effort remap for the guide geometry only; the commit never trusts this position.
              drag.rowPos = tr.mapping.map(drag.rowPos)
            }
            return null
          },
        },
        view(view) {
          const wrapper = view.dom.parentElement
          handle = document.createElement('div')
          handle.className = 'octo-table-row-resize'
          handle.setAttribute('contenteditable', 'false')
          handle.setAttribute('aria-label', 'Drag to resize row height')
          handle.style.display = 'none'
          guide = document.createElement('div')
          guide.className = 'octo-table-row-resize-guide'
          guide.setAttribute('contenteditable', 'false')
          guide.style.display = 'none'
          if (wrapper) {
            handle.style.position = 'absolute'
            guide.style.position = 'absolute'
            wrapper.appendChild(handle)
            wrapper.appendChild(guide)
          }
          const onHandleDown = (e: PointerEvent) => beginDrag(view, e)
          handle.addEventListener('pointerdown', onHandleDown)
          return {
            destroy() {
              removeDragListeners()
              document.body.classList.remove('octo-row-resizing')
              handle?.removeEventListener('pointerdown', onHandleDown)
              handle?.remove()
              guide?.remove()
              handle = guide = null
              activeView = null
              drag = null
              concurrentEdit = false
              committing = false
              pointerHeldSeen = false
              capturedPointerId = null
              dragBaselineSigs = []
            },
          }
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              // Freeze the resting handle while a drag owns the pointer (document listeners drive it).
              if (drag) return false
              if (!view.editable) return false
              const target = rowAt(view, event.clientX, event.clientY)
              if (!target) {
                hideHandle()
                return false
              }
              const row = target.rowDom.getBoundingClientRect()
              // Only arm within the horizontal band straddling THIS row's bottom edge.
              if (Math.abs(event.clientY - row.bottom) > ROW_HANDLE_BAND) {
                hideHandle()
                return false
              }
              // Defer to the column-resize handle when the pointer is also on a vertical cell border,
              // so the shared bottom-right corner never fights (col resize keeps ownership there).
              const cell = cellDomAt(view, event.clientX, event.clientY)
              if (cell && nearColumnBorder(cell, event.clientX)) {
                hideHandle()
                return false
              }
              placeHandle(view, target)
              return false
            },
            mouseleave(_view, event) {
              if (drag) return false
              const to = (event as MouseEvent).relatedTarget as Node | null
              if (to && handle?.contains(to)) return false
              hideHandle()
              return false
            },
          },
        },
      }),
    ]
  },
})
