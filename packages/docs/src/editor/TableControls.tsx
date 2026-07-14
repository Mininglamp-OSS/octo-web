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

// Vertical space (px) reserved above the anchor band so the toolbar — placed above the anchor with
// `placement: 'top'` — always has room to render inside the viewport. Covers the ~40px control row
// plus the 8px placement offset with margin to spare.
const TOOLBAR_SAFE_TOP = 64

/**
 * Clamp a table's rect into the visual viewport and collapse it to a thin anchor band near its
 * visible top (#625 off-screen fix). This is the pure core of {@link tableReferenceElement},
 * split out so it can be unit-tested without a real layout.
 *
 * Why: the toolbar anchors to the table's OUTER edge and floats above it with `placement: 'top'`.
 * For a long table scrolled so its top leaves the viewport (`rect.top` a large negative), the raw
 * rect's top is off-screen above and its bottom is far below the viewport; Floating-UI's default
 * `flip` then re-anchors to that off-screen bottom edge and the controls land below the viewport
 * (observed: toolbar top ~1051 vs a 1000px viewport), completely unreachable. `shift` doesn't save
 * it because its default boundary is the tall scroll container, not the visual viewport.
 *
 * Fix: build the reference from a zero-height band whose `top` is the table's top edge CLAMPED into
 * `[TOOLBAR_SAFE_TOP, viewport.height - 8]`, with the horizontal extent clamped into the viewport.
 * A thin band near the top means both `top` and any flipped `bottom` placement resolve to a y just
 * inside the viewport, so the controls stay reachable regardless of flip/shift boundary quirks. In
 * the normal, fully-visible case the table top already sits below `TOOLBAR_SAFE_TOP`, so the band
 * stays at the real top edge and the toolbar floats above the table exactly as before — no
 * TC-P0-001 regression.
 */
export function clampToolbarAnchorRect(
  rect: { top: number; bottom: number; left: number; right: number },
  viewport: { width: number; height: number },
): DOMRect {
  const left = Math.max(0, Math.min(rect.left, viewport.width))
  const right = Math.min(viewport.width, Math.max(rect.right, left))
  const width = Math.max(0, right - left)
  // Keep the band at least TOOLBAR_SAFE_TOP from the viewport top (room for the toolbar above it)
  // and never below the viewport bottom, following the real top edge in between.
  const top = Math.max(TOOLBAR_SAFE_TOP, Math.min(rect.top, viewport.height - 8))
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top,
    width,
    height: 0,
    toJSON() {
      return this
    },
  } as DOMRect
}

/**
 * Reference rect for the floating table toolbar (#625). Anchors to the OUTER edge of the table
 * (its scroll wrapper when present) rather than the caret's cell, so the toolbar — placed above
 * with `placement: 'top'` — floats in the block margin above the whole table instead of landing on
 * top of the text rows above the caret. The rect is clamped into the visual viewport (see
 * {@link clampToolbarAnchorRect}) so a long table scrolled past the top of the viewport keeps the
 * controls reachable instead of pushing them off-screen. Returns a Floating-UI virtual element
 * (computed lazily so scrolling/resizing stays accurate), or null when the caret is not inside a
 * table, in which case the BubbleMenu falls back to its default cursor-based positioning.
 */
function tableReferenceElement(editor: Editor): { getBoundingClientRect: () => DOMRect; getClientRects: () => DOMRect[] } | null {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'table') {
      const dom = editor.view.nodeDOM($from.before(depth))
      if (dom instanceof HTMLElement) {
        // Prefer the ProseMirror `.tableWrapper` scroll box so a horizontally scrolled wide table
        // still anchors to the visible table region.
        const anchor = (dom.closest('.tableWrapper') as HTMLElement | null) ?? dom
        const band = () =>
          clampToolbarAnchorRect(anchor.getBoundingClientRect(), {
            width: window.innerWidth,
            height: window.innerHeight,
          })
        return {
          getBoundingClientRect: band,
          getClientRects: () => [band()],
        }
      }
    }
  }
  return null
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
      // Anchor the toolbar to the table's outer edge rather than the caret's cell, so with
      // placement: 'top' it floats in the block margin above the whole table and never covers the
      // in-table text rows above the caret (#625). Falls back to the default caret rect when the
      // helper can't find a table (never happens while shouldShow is satisfied).
      getReferencedVirtualElement={() => tableReferenceElement(editor)}
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
          text={t('docs.table.deleteRow')}
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
          text={t('docs.table.deleteColumn')}
          onClick={() => editor.chain().focus().deleteColumn().run()}
        />
        <span className="octo-tb-sep" />
        <TbBtn
          label={<IconDeleteTable />}
          title={t('docs.table.deleteTable')}
          text={t('docs.table.deleteTable')}
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
