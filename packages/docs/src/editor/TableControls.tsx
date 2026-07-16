// Table editing UI (#595, right-click menu XIN-1052).
//
// Two pieces, both pure frontend on top of the already-loaded @tiptap/extension-table series
// (schema unchanged):
//
//  1. TableContextMenu — a right-click (contextmenu) menu that opens whenever the user right-clicks
//     inside ANY table cell, so it covers tables that already exist in a document, not just freshly
//     inserted ones. It exposes add/delete row & column (+ delete table), wired to the exact same
//     Tiptap table commands as before — commands that only look at the caret position, never at how
//     the table was born. Before opening, it moves the ProseMirror selection into the right-clicked
//     cell (via posAtCoords) so the position-relative commands act on THAT cell, and it suppresses
//     the native browser context menu only when the click lands inside a table.
//
//  2. TableGridPicker — replaces the old fixed 3×3 insert with a hover grid so the author picks the
//     initial row/column count before inserting.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import type { Editor } from '@tiptap/core'
import { t } from '../octoweb/index.ts'

// Largest table the grid picker can size in one drag. Big enough for the common cases; authors who
// want more can add rows/columns afterwards with the bubble menu.
const GRID_MAX_ROWS = 8
const GRID_MAX_COLS = 8

// Compact 16×16 glyphs (fill: currentColor via .octo-tb-icon) matching the toolbar icon set. Each
// draws a 3×3 grid with the affected row/column tinted and a +/− marker so the action reads at a
// glance.
const IconRowBefore = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 11h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9zm0-2V7h16v2H4z" opacity="0.35" />
    <path d="M12 2a1 1 0 0 1 1 1v1h1a1 1 0 1 1 0 2h-1v1a1 1 0 1 1-2 0V6h-1a1 1 0 1 1 0-2h1V3a1 1 0 0 1 1-1z" />
  </svg>
)
const IconRowAfter = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 4a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v9H4V4zm0 11h16v2H4v-2z" opacity="0.35" />
    <path d="M12 17a1 1 0 0 1 1 1v1h1a1 1 0 1 1 0 2h-1v1a1 1 0 1 1-2 0v-1h-1a1 1 0 1 1 0-2h1v-1a1 1 0 0 1 1-1z" />
  </svg>
)
const IconColBefore = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M13 4h7a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-7V4zm-2 0v16H9V4h2z" opacity="0.35" />
    <path d="M4 12a1 1 0 0 1 1-1h1v-1a1 1 0 1 1 2 0v1h1a1 1 0 1 1 0 2H8v1a1 1 0 1 1-2 0v-1H5a1 1 0 0 1-1-1z" />
  </svg>
)
const IconColAfter = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 5a1 1 0 0 1 1-1h7v16H5a1 1 0 0 1-1-1V5zm11-1h2v16h-2V4z" opacity="0.35" />
    <path d="M16 12a1 1 0 0 1 1-1h1v-1a1 1 0 1 1 2 0v1h1a1 1 0 1 1 0 2h-1v1a1 1 0 1 1-2 0v-1h-1a1 1 0 0 1-1-1z" />
  </svg>
)
const IconDeleteRow = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 9h16v6H4V9z" />
    <path d="M8 19a1 1 0 1 1 0 2h8a1 1 0 1 1 0-2H8zM8 3a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2H8z" opacity="0.35" />
  </svg>
)
const IconDeleteCol = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 4h6v16H9V4z" />
    <path d="M19 8a1 1 0 1 1 2 0v8a1 1 0 1 1-2 0V8zM3 8a1 1 0 1 1 2 0v8a1 1 0 1 1-2 0V8z" opacity="0.35" />
  </svg>
)
const IconDeleteTable = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 3h6a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2h-1v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7H4a1 1 0 0 1 0-2h4V4a1 1 0 0 1 1-1zm1 5a1 1 0 0 0-1 1v8a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1zm4 0a1 1 0 0 0-1 1v8a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1z" />
  </svg>
)
const IconTable = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5zm2 1v3h5V6H6zm7 0v3h5V6h-5zM6 11v3h5v-3H6zm7 0v3h5v-3h-5zm-7 5v2h5v-2H6zm7 0v2h5v-2h-5z" />
  </svg>
)

function TbBtn({
  onClick,
  label,
  title,
  text,
}: {
  onClick: () => void
  label: ReactNode
  title: string
  // When set, a visible text caption is shown next to the icon. Used for the destructive
  // delete controls (#621-2) so the user reads which row/column/table the action removes,
  // instead of guessing from an icon alone.
  text?: string
}) {
  return (
    <button
      type="button"
      className={'octo-tb-btn' + (text ? ' octo-tb-btn--labeled' : '')}
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
      {text ? <span className="octo-tb-btn-label">{text}</span> : null}
    </button>
  )
}

/**
 * Move the ProseMirror selection to `pos` and report whether the caret then sits inside a table.
 *
 * Called by {@link TableContextMenu} right before it opens: the user right-clicked at a screen
 * point, `posAtCoords` mapped that to a document position, and this moves the selection there so the
 * position-relative table commands (addRow / deleteColumn / …) act on the cell that was clicked
 * rather than wherever the caret happened to be. `pos` is clamped into the document so an
 * out-of-range value from `posAtCoords` can never throw.
 *
 * The table test is done on the *resolved* position WITHOUT dispatching anything, so a right-click
 * on ordinary (non-table) text is a complete no-op: the selection is only moved when `pos` really
 * lands inside a table cell. That keeps a right-click outside a table from collapsing the user's
 * existing selection, so the browser's native context menu / Copy still act on the selected text.
 *
 * When a multi-cell {@link CellSelection} is already active and the right-clicked cell is one of the
 * selected cells, the selection is left intact so a range operation (delete column / delete row)
 * still spans every selected cell instead of collapsing to the single clicked one. The selection is
 * only moved when the click lands on a cell OUTSIDE the current selection.
 *
 * Returns whether the click was inside a table — the gate the caller uses to decide whether to open
 * a table menu (and suppress the native one) at all.
 */
export function moveSelectionIntoCell(editor: Editor, pos: number): boolean {
  const { doc, selection } = editor.state
  const safe = Math.max(0, Math.min(pos, doc.content.size))
  const $pos = doc.resolve(safe)

  // Walk the resolved position's ancestors to see whether it sits inside a table, without touching
  // the current selection. Mirrors editor.isActive('table') but for an arbitrary position. Also
  // capture the position of the enclosing cell so we can test CellSelection membership below.
  let inTable = false
  let cellPos: number | null = null
  for (let depth = $pos.depth; depth > 0; depth--) {
    const name = $pos.node(depth).type.name
    if (cellPos === null && (name === 'tableCell' || name === 'tableHeader')) {
      cellPos = $pos.before(depth)
    }
    if (name === 'table') {
      inTable = true
      break
    }
  }
  if (!inTable) return false

  // Preserve an existing multi-cell selection when the click lands inside it, so delete-column /
  // delete-row keep acting on the whole selected range rather than collapsing to one cell.
  if (selection instanceof CellSelection && cellPos !== null) {
    let insideSelection = false
    selection.forEachCell((_cell, p) => {
      if (p === cellPos) insideSelection = true
    })
    if (insideSelection) return true
  }

  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)))
  return true
}

/**
 * Clamp the menu's top-left corner so a menu of the given size stays fully inside the viewport when
 * opened at the pointer `point`. Right-clicks near the right / bottom edge would otherwise open a
 * menu that overflows off-screen; shift it left / up just enough to fit, never past the top-left
 * origin. Pure so it can be unit-tested without a real layout.
 */
export function clampMenuPosition(
  point: { x: number; y: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const left = Math.max(0, Math.min(point.x, viewport.width - menu.width))
  const top = Math.max(0, Math.min(point.y, viewport.height - menu.height))
  return { left, top }
}

/**
 * Right-click (contextmenu) table menu. Opens whenever the user right-clicks inside a table cell —
 * which naturally covers tables that were already in the document, since it keys off the clicked
 * position, not how the table was created. On open it moves the selection into the clicked cell (so
 * the position-relative commands act on it) and suppresses the native browser menu; a right-click
 * outside any table is left alone so the browser's own menu still works. Closes on outside-click /
 * Escape, and after any command runs.
 */
export function TableContextMenu({ editor }: { editor: Editor }) {
  // Viewport-coord anchor point where the user right-clicked; null while the menu is closed.
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // Cell positions (anchor/head) of a multi-cell CellSelection captured at right-click time, or
  // null when the click was on a single cell. See the snapshot in onContextMenu below for why this
  // has to be remembered rather than re-read from the live selection when a menu item is clicked.
  const cellRangeRef = useRef<{ anchor: number; head: number } | null>(null)

  // Attach the contextmenu listener to this editor's DOM. Right-click inside a cell opens the menu
  // at the pointer and preventDefault()s the native menu; anywhere else is left untouched.
  useEffect(() => {
    const dom = editor.view.dom
    const onContextMenu = (e: MouseEvent) => {
      // Read-only editors must never edit a table: leave the native browser menu fully intact —
      // no preventDefault, no selection move, no custom menu. Table mutations are meaningless there.
      if (!editor.isEditable) return
      const coords = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
      if (!coords) return
      if (!moveSelectionIntoCell(editor, coords.pos)) return
      e.preventDefault()
      // Snapshot a multi-cell CellSelection NOW, while it is still intact. After this handler
      // returns the browser processes the native right-click: it moves the caret to the clicked
      // cell and fires `selectionchange`, which ProseMirror syncs back into a single-cell
      // TextSelection — collapsing the multi-column/row rectangle before the user gets to click a
      // menu item. If deleteColumn/deleteRow then read the live selection they would only see the
      // one clicked cell and remove a single column/row (the real-browser "delete N, only 1 goes"
      // bug; jsdom never fires that selectionchange, which is why the old unit tests were green).
      // Remembering the cell range here lets us re-establish it right before the command runs.
      const sel = editor.state.selection
      cellRangeRef.current =
        sel instanceof CellSelection
          ? { anchor: sel.$anchorCell.pos, head: sel.$headCell.pos }
          : null
      setPoint({ x: e.clientX, y: e.clientY })
    }
    dom.addEventListener('contextmenu', onContextMenu)
    return () => dom.removeEventListener('contextmenu', onContextMenu)
  }, [editor])

  // Close on outside-click / Escape, mirroring TableGridPicker.
  useEffect(() => {
    if (!point) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setPoint(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPoint(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [point])

  // Once the menu has real dimensions, nudge it back inside the viewport if the pointer was near an
  // edge. jsdom reports a zero rect (no layout), so this is a harmless no-op in tests.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!point || !el) return
    const rect = el.getBoundingClientRect()
    const { left, top } = clampMenuPosition(
      point,
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    )
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [point])

  if (!point) return null

  // Run a table command then close. When the menu was opened over a multi-cell selection we first
  // re-establish that CellSelection (the browser's right-click caret move will have collapsed it to
  // a single cell in the meantime — see the snapshot in onContextMenu), so range operations such as
  // deleteColumn / deleteRow act on every selected column/row instead of just the clicked one. No
  // document edit happens between opening the menu and this click, so the captured cell positions
  // are still valid; CellSelection.create is guarded in case a position is somehow stale.
  const run = (fn: () => void) => {
    const range = cellRangeRef.current
    if (range) {
      try {
        editor.view.dispatch(
          editor.state.tr.setSelection(
            CellSelection.create(editor.state.doc, range.anchor, range.head),
          ),
        )
      } catch {
        // Stale range (e.g. the table changed out from under us) — fall back to the live selection.
      }
    }
    fn()
    cellRangeRef.current = null
    setPoint(null)
  }

  return (
    <div
      ref={menuRef}
      className="octo-bubble-menu octo-table-context-menu"
      role="menu"
      style={{ position: 'fixed', left: point.x, top: point.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <TbBtn
        label={<IconRowBefore />}
        title={t('docs.table.addRowBefore')}
        text={t('docs.table.addRowBefore')}
        onClick={() => run(() => editor.chain().focus().addRowBefore().run())}
      />
      <TbBtn
        label={<IconRowAfter />}
        title={t('docs.table.addRowAfter')}
        text={t('docs.table.addRowAfter')}
        onClick={() => run(() => editor.chain().focus().addRowAfter().run())}
      />
      <TbBtn
        label={<IconDeleteRow />}
        title={t('docs.table.deleteRow')}
        text={t('docs.table.deleteRow')}
        onClick={() => run(() => editor.chain().focus().deleteRow().run())}
      />
      <span className="octo-tb-sep" />
      <TbBtn
        label={<IconColBefore />}
        title={t('docs.table.addColumnBefore')}
        text={t('docs.table.addColumnBefore')}
        onClick={() => run(() => editor.chain().focus().addColumnBefore().run())}
      />
      <TbBtn
        label={<IconColAfter />}
        title={t('docs.table.addColumnAfter')}
        text={t('docs.table.addColumnAfter')}
        onClick={() => run(() => editor.chain().focus().addColumnAfter().run())}
      />
      <TbBtn
        label={<IconDeleteCol />}
        title={t('docs.table.deleteColumn')}
        text={t('docs.table.deleteColumn')}
        onClick={() => run(() => editor.chain().focus().deleteColumn().run())}
      />
      <span className="octo-tb-sep" />
      <TbBtn
        label={<IconDeleteTable />}
        title={t('docs.table.deleteTable')}
        text={t('docs.table.deleteTable')}
        onClick={() => run(() => editor.chain().focus().deleteTable().run())}
      />
    </div>
  )
}

/**
 * Toolbar control that inserts a new table at a size the author picks from a hover grid, replacing
 * the former hardcoded 3×3. Hovering a cell previews rows×cols; clicking inserts with a header row.
 * Modeled on the highlight/colour popover (relative wrapper + absolute float), closes on
 * outside-click / Escape.
 */
export function TableGridPicker({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  // 1-based hovered extent; 0 means nothing hovered yet.
  const [hover, setHover] = useState<{ rows: number; cols: number }>({ rows: 0, cols: 0 })
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Reset the hover preview each time the picker opens so a stale size never lingers.
  useEffect(() => {
    if (open) setHover({ rows: 0, cols: 0 })
  }, [open])

  function insert(rows: number, cols: number) {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
    setOpen(false)
  }

  const label = hover.rows > 0 ? `${hover.rows} × ${hover.cols}` : t('docs.table.pickerHint')

  return (
    <span className="octo-color-control octo-table-picker-control" ref={ref}>
      <button
        type="button"
        className={'octo-tb-btn' + (open ? ' is-active' : '')}
        title={t('docs.toolbar.table')}
        aria-label={t('docs.toolbar.table')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        <IconTable />
      </button>
      {open && (
        <span className="octo-color-popover octo-table-picker" role="dialog">
          <span className="octo-table-grid" role="grid" aria-label={t('docs.table.pickerLabel')}>
            {Array.from({ length: GRID_MAX_ROWS }, (_, r) =>
              Array.from({ length: GRID_MAX_COLS }, (_, c) => {
                const rows = r + 1
                const cols = c + 1
                const on = rows <= hover.rows && cols <= hover.cols
                return (
                  <button
                    key={`${rows}-${cols}`}
                    type="button"
                    className={'octo-table-grid-cell' + (on ? ' is-on' : '')}
                    aria-label={`${rows} × ${cols}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHover({ rows, cols })}
                    onFocus={() => setHover({ rows, cols })}
                    onClick={() => insert(rows, cols)}
                  />
                )
              }),
            )}
          </span>
          <span className="octo-table-grid-label">{label}</span>
        </span>
      )}
    </span>
  )
}

