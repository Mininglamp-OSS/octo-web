// Table editing UI (#595).
//
// Two pieces, both pure frontend on top of the already-loaded @tiptap/extension-table series
// (schema unchanged):
//
//  1. TableBubbleMenu — a floating toolbar that appears whenever the caret sits inside ANY table
//     cell (`editor.isActive('table')`), so it covers tables that already exist in a document, not
//     just freshly inserted ones. It exposes add/delete row & column (+ delete table), wired to the
//     Tiptap table commands that only look at the caret position, never at how the table was born.
//
//  2. TableGridPicker — replaces the old fixed 3×3 insert with a hover grid so the author picks the
//     initial row/column count before inserting.
//
// A distinct pluginKey ('octoTableBubble') keeps this menu from clashing with the inline formatting
// BubbleMenu and the comment BubbleMenu that share the same editor.

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
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
}: {
  onClick: () => void
  label: ReactNode
  title: string
}) {
  return (
    <button
      type="button"
      className="octo-tb-btn"
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

/**
 * Whether the floating table toolbar should be visible for the editor's current selection. Shown
 * whenever the caret is inside a table cell — which naturally covers tables that were already in
 * the document, since it keys off the selection, not how the table was created. Suppressed while a
 * plain text run inside a cell is selected so it doesn't fight the inline formatting / comment
 * bubbles; a collapsed caret or a whole-cell (CellSelection) drag both keep it visible.
 */
export function shouldShowTableBubble(editor: Editor): boolean {
  if (!editor.isEditable || !editor.isActive('table')) return false
  const sel = editor.state.selection
  return sel.empty || sel instanceof CellSelection
}

/**
 * Floating table toolbar. See {@link shouldShowTableBubble} for the visibility rule. A distinct
 * pluginKey keeps it from clashing with the inline formatting / comment BubbleMenus on the same
 * editor.
 */
export function TableBubbleMenu({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="octoTableBubble"
      // The toolbar floats over the table while the caret sits in a cell, so its frame would
      // otherwise sit on top of the column-resize hot zone and swallow the hover/drag the resize
      // plugin listens for on the editor DOM. octo-table-bubble-portal makes the floating wrapper
      // transparent to pointer events (see styles.css); only the buttons below re-capture them.
      className="octo-table-bubble-portal"
      options={{ placement: 'top', offset: 8 }}
      shouldShow={({ editor: e }) => shouldShowTableBubble(e)}
    >
      <div className="octo-bubble-menu octo-table-bubble">
        <TbBtn
          label={<IconRowBefore />}
          title={t('docs.table.addRowBefore')}
          onClick={() => editor.chain().focus().addRowBefore().run()}
        />
        <TbBtn
          label={<IconRowAfter />}
          title={t('docs.table.addRowAfter')}
          onClick={() => editor.chain().focus().addRowAfter().run()}
        />
        <TbBtn
          label={<IconDeleteRow />}
          title={t('docs.table.deleteRow')}
          onClick={() => editor.chain().focus().deleteRow().run()}
        />
        <span className="octo-tb-sep" />
        <TbBtn
          label={<IconColBefore />}
          title={t('docs.table.addColumnBefore')}
          onClick={() => editor.chain().focus().addColumnBefore().run()}
        />
        <TbBtn
          label={<IconColAfter />}
          title={t('docs.table.addColumnAfter')}
          onClick={() => editor.chain().focus().addColumnAfter().run()}
        />
        <TbBtn
          label={<IconDeleteCol />}
          title={t('docs.table.deleteColumn')}
          onClick={() => editor.chain().focus().deleteColumn().run()}
        />
        <span className="octo-tb-sep" />
        <TbBtn
          label={<IconDeleteTable />}
          title={t('docs.table.deleteTable')}
          onClick={() => editor.chain().focus().deleteTable().run()}
        />
      </div>
    </BubbleMenu>
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
