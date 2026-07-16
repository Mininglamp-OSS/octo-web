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
// Yjs scalar with last-write-wins semantics and involves NO structural change to the table grid, so
// (unlike the #76 reorder) two peers resizing the same row concurrently simply converge on the last
// write; there is no grid-rebuild race to guard against.
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
import type { EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

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

/** Self-built table row-height resize handle. */
export const TableRowResize = Extension.create({
  name: 'tableRowResize',

  addProseMirrorPlugins() {
    let handle: HTMLElement | null = null
    let guide: HTMLElement | null = null
    // Row armed for resize while idle (the source of a drag that starts on the handle).
    let armed: RowTarget | null = null
    // Non-null only while a drag is in flight.
    let drag: { rowPos: number; startY: number; startHeight: number; height: number } | null = null
    let activeView: EditorView | null = null

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
      document.removeEventListener('mousemove', onDocMove, true)
      document.removeEventListener('mouseup', onDocUp, true)
      document.removeEventListener('keydown', onDocKey, true)
      window.removeEventListener('blur', onWindowBlur)
    }

    const resetDrag = () => {
      drag = null
      document.body.classList.remove('octo-row-resizing')
      hideGuide()
      hideHandle()
    }

    // Commit the dragged height as a single setNodeMarkup transaction (y-prosemirror syncs it like any
    // edit). Skipped when the height did not change or the row no longer resolves (a safe no-op).
    const commitDrag = (view: EditorView) => {
      if (!drag) return
      const node = view.state.doc.nodeAt(drag.rowPos)
      if (node && node.type.name === 'tableRow') {
        const next = normalizeRowHeight(drag.height)
        if ((node.attrs.height ?? null) !== next) {
          view.dispatch(view.state.tr.setNodeMarkup(drag.rowPos, undefined, { ...node.attrs, height: next }))
        }
      }
      view.focus()
    }

    function onDocMove(event: MouseEvent) {
      if (!drag || !activeView) return
      event.preventDefault()
      const delta = event.clientY - drag.startY
      drag.height = Math.max(MIN_ROW_HEIGHT, Math.round(drag.startHeight + delta))
      placeGuide(activeView)
    }
    function onDocUp() {
      if (!activeView || !drag) return
      removeDragListeners()
      commitDrag(activeView)
      resetDrag()
    }
    const cancelDrag = () => {
      if (!drag) return
      removeDragListeners()
      resetDrag()
    }
    function onWindowBlur() {
      cancelDrag()
    }
    function onDocKey(event: KeyboardEvent) {
      if (event.key === 'Escape') cancelDrag()
    }

    const beginDrag = (view: EditorView, event: MouseEvent) => {
      if (event.button !== 0 || !view.editable || !armed) return
      event.preventDefault()
      const startHeight = armed.rowDom.getBoundingClientRect().height
      drag = { rowPos: armed.rowPos, startY: event.clientY, startHeight, height: Math.round(startHeight) }
      activeView = view
      document.body.classList.add('octo-row-resizing')
      document.addEventListener('mousemove', onDocMove, true)
      document.addEventListener('mouseup', onDocUp, true)
      document.addEventListener('keydown', onDocKey, true)
      window.addEventListener('blur', onWindowBlur)
    }

    return [
      new Plugin({
        key: tableRowResizePluginKey,
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
          const onHandleDown = (e: MouseEvent) => beginDrag(view, e)
          handle.addEventListener('mousedown', onHandleDown)
          return {
            destroy() {
              removeDragListeners()
              document.body.classList.remove('octo-row-resizing')
              handle?.removeEventListener('mousedown', onHandleDown)
              handle?.remove()
              guide?.remove()
              handle = guide = null
              activeView = null
              drag = null
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
