import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, createEvent } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { CellSelection } from '@tiptap/pm/tables'
import { TextSelection } from '@tiptap/pm/state'
import {
  TableGridPicker,
  TableContextMenu,
  moveSelectionIntoCell,
  clampMenuPosition,
} from './TableControls.tsx'

// XIN-1052 — table add/delete row/column UI moved from a floating bubble toolbar to a right-click
// context menu. The critical acceptance points are that the menu opens only on a right-click INSIDE
// a table cell, the native browser menu is suppressed there, the selection is first moved into the
// right-clicked cell so the position-relative commands act on it, and the same commands work on
// tables that ALREADY EXIST in a document (parsed from stored HTML), not only freshly inserted ones.

function tableEditor(content: string, element?: HTMLElement, editable = true) {
  return new Editor({
    element,
    editable,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content,
  })
}

// A 2-row × 3-column table, used for the multi-column CellSelection regression so deleting the two
// selected columns still leaves one column behind (a 2×2 table would collapse entirely).
const MULTI_COL_DOC =
  '<table><tbody>' +
  '<tr><td>a</td><td>b</td><td>c</td></tr>' +
  '<tr><td>d</td><td>e</td><td>f</td></tr>' +
  '</tbody></table>'

/** Positions (pointing AT the cell node, i.e. the value forEachCell / $pos.before report) of every
 *  table cell in document order. */
function cellPositions(e: Editor): number[] {
  const positions: number[] = []
  e.state.doc.descendants((node, p) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') positions.push(p)
    return true
  })
  return positions
}

// A 2-row × 2-column table sitting between two paragraphs, as it would arrive from stored content.
const HISTORICAL_DOC =
  '<p>before</p>' +
  '<table><tbody>' +
  '<tr><th>a</th><th>b</th></tr>' +
  '<tr><td>c</td><td>d</td></tr>' +
  '</tbody></table>' +
  '<p>after</p>'

/** Position of the first text position inside the first table cell in the doc. */
function firstCellTextPos(e: Editor): number {
  let pos = -1
  e.state.doc.descendants((node, p) => {
    if (pos === -1 && (node.type.name === 'tableCell' || node.type.name === 'tableHeader')) {
      pos = p + 2 // step into the cell, then into its paragraph's text
      return false
    }
    return pos === -1
  })
  return pos
}

/** {rows, cols} of the first table in the doc, or null if there is none. */
function tableDims(e: Editor): { rows: number; cols: number } | null {
  let table: import('@tiptap/pm/model').Node | null = null
  e.state.doc.descendants((n) => {
    if (!table && n.type.name === 'table') table = n
    return !table
  })
  if (!table) return null
  const t = table as import('@tiptap/pm/model').Node
  return { rows: t.childCount, cols: t.firstChild ? t.firstChild.childCount : 0 }
}

afterEach(() => cleanup())

describe('moveSelectionIntoCell — gate + selection move for the right-clicked cell', () => {
  it('moves the selection into a pre-existing table cell and reports the caret is in a table', () => {
    const e = tableEditor(HISTORICAL_DOC)
    e.commands.setTextSelection(2) // start with the caret in the leading "before" paragraph
    expect(e.isActive('table')).toBe(false)

    const inTable = moveSelectionIntoCell(e, firstCellTextPos(e))
    expect(inTable).toBe(true)
    expect(e.isActive('table')).toBe(true)
    e.destroy()
  })

  it('reports false (do not open a table menu) when the pointer is outside any table', () => {
    const e = tableEditor(HISTORICAL_DOC)
    const paragraphPos = 2 // inside the leading "before" paragraph
    expect(moveSelectionIntoCell(e, paragraphPos)).toBe(false)
    expect(e.isActive('table')).toBe(false)
    e.destroy()
  })

  it('leaves an existing selection untouched when the pointer is outside any table', () => {
    // Regression: a right-click on ordinary (non-table) text must be a complete no-op — it must
    // NOT collapse the user's current selection, so the browser's native context menu / Copy keeps
    // operating on the still-selected text. Previously the selection was moved before the
    // isActive('table') gate, which collapsed any selection on every out-of-table right-click.
    const e = tableEditor(HISTORICAL_DOC)
    // Select a range inside the leading "before" paragraph (text occupies positions 1..7).
    e.commands.setTextSelection({ from: 2, to: 5 })
    expect(e.state.selection.empty).toBe(false)

    const paragraphPos = 3 // right-click lands inside that same paragraph, outside the table
    expect(moveSelectionIntoCell(e, paragraphPos)).toBe(false)

    // Selection is preserved exactly — not collapsed, not moved.
    expect(e.state.selection.from).toBe(2)
    expect(e.state.selection.to).toBe(5)
    expect(e.state.selection.empty).toBe(false)
    expect(e.isActive('table')).toBe(false)
    e.destroy()
  })

  it('is safe against out-of-range positions', () => {
    const e = tableEditor(HISTORICAL_DOC)
    expect(() => moveSelectionIntoCell(e, 1e9)).not.toThrow()
    expect(() => moveSelectionIntoCell(e, -5)).not.toThrow()
    e.destroy()
  })

  it('keeps a multi-cell CellSelection when the right-click lands inside it, so delete-column removes every selected column', () => {
    // Regression (P1): a user framed a multi-column CellSelection then right-clicked a cell already
    // inside it. moveSelectionIntoCell used to collapse the selection to that single cell, so
    // "delete column" only removed the clicked column instead of the whole multi-column selection.
    const e = tableEditor(MULTI_COL_DOC)
    const cells = cellPositions(e) // [a, b, c, d, e, f] as positions pointing at each cell
    expect(tableDims(e)).toEqual({ rows: 2, cols: 3 })

    // Select columns 0 and 1 (cells a,b,d,e): anchor at cell a (0,0), head at cell e (1,1).
    const sel = CellSelection.create(e.state.doc, cells[0], cells[4])
    e.view.dispatch(e.state.tr.setSelection(sel))
    expect(e.state.selection instanceof CellSelection).toBe(true)

    // Right-click a text position inside cell "b" — which is inside the current selection.
    const insidePos = cells[1] + 2 // step into the cell, then into its paragraph's text
    expect(moveSelectionIntoCell(e, insidePos)).toBe(true)

    // Selection is preserved (not collapsed to the single clicked cell)...
    expect(e.state.selection instanceof CellSelection).toBe(true)
    // ...so delete-column removes BOTH selected columns, leaving the third behind.
    e.chain().focus().deleteColumn().run()
    expect(tableDims(e)).toEqual({ rows: 2, cols: 1 })
    e.destroy()
  })

  it('moves the selection when the right-click lands on a cell outside the current CellSelection', () => {
    // The complement of the case above: right-clicking a cell that is NOT part of the multi-cell
    // selection collapses to that cell, matching the single-cell behaviour authors expect.
    const e = tableEditor(MULTI_COL_DOC)
    const cells = cellPositions(e)
    // Select columns 0 and 1 (cells a,b,d,e).
    e.view.dispatch(e.state.tr.setSelection(CellSelection.create(e.state.doc, cells[0], cells[4])))

    // Right-click cell "c" (column 2), outside the selection.
    const outsidePos = cells[2] + 2
    expect(moveSelectionIntoCell(e, outsidePos)).toBe(true)
    // Selection collapsed to the clicked cell, so delete-column removes only that one column.
    expect(e.state.selection instanceof CellSelection).toBe(false)
    e.chain().focus().deleteColumn().run()
    expect(tableDims(e)).toEqual({ rows: 2, cols: 2 })
    e.destroy()
  })
})

describe('table commands operate on a pre-existing (historical) table', () => {
  it('adds and removes rows', () => {
    const e = tableEditor(HISTORICAL_DOC)
    e.commands.setTextSelection(firstCellTextPos(e))
    expect(tableDims(e)).toEqual({ rows: 2, cols: 2 })
    e.chain().focus().addRowAfter().run()
    expect(tableDims(e)).toEqual({ rows: 3, cols: 2 })
    e.chain().focus().deleteRow().run()
    expect(tableDims(e)).toEqual({ rows: 2, cols: 2 })
    e.destroy()
  })

  it('adds and removes columns', () => {
    const e = tableEditor(HISTORICAL_DOC)
    e.commands.setTextSelection(firstCellTextPos(e))
    e.chain().focus().addColumnAfter().run()
    expect(tableDims(e)).toEqual({ rows: 2, cols: 3 })
    e.chain().focus().deleteColumn().run()
    expect(tableDims(e)).toEqual({ rows: 2, cols: 2 })
    e.destroy()
  })

  it('deletes the whole table', () => {
    const e = tableEditor(HISTORICAL_DOC)
    e.commands.setTextSelection(firstCellTextPos(e))
    e.chain().focus().deleteTable().run()
    expect(tableDims(e)).toBeNull()
    e.destroy()
  })
})

describe('TableContextMenu — right-click inside a cell opens the menu (XIN-1052)', () => {
  it('renders nothing until a right-click lands inside a table cell', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const e = tableEditor(HISTORICAL_DOC, host)
    render(<TableContextMenu editor={e} />)
    expect(document.querySelector('.octo-table-context-menu')).toBeNull()
    e.destroy()
    host.remove()
  })

  it('opens at the pointer, suppresses the native menu, and exposes every table command', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const e = tableEditor(HISTORICAL_DOC, host)
    // jsdom has no layout, so posAtCoords can't map real client coords to a doc position. Point it
    // at the first cell so the handler behaves as it would when the user right-clicks that cell.
    e.view.posAtCoords = () => ({ pos: firstCellTextPos(e), inside: -1 })
    render(<TableContextMenu editor={e} />)

    const evt = createEvent.contextMenu(e.view.dom, { clientX: 120, clientY: 90 })
    fireEvent(e.view.dom, evt)

    // Native context menu is suppressed only when the click is inside a table.
    expect(evt.defaultPrevented).toBe(true)
    const menu = document.querySelector('.octo-table-context-menu') as HTMLElement | null
    expect(menu).toBeTruthy()
    // Selection was moved into the right-clicked cell so position-relative commands act on it.
    expect(e.isActive('table')).toBe(true)
    // All seven table commands are present (add row before/after, delete row, add column
    // before/after, delete column, delete table).
    const buttons = menu!.querySelectorAll('button.octo-tb-btn')
    expect(buttons.length).toBe(7)
    e.destroy()
    host.remove()
  })

  it('leaves the native menu alone when the right-click is outside any table', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const e = tableEditor(HISTORICAL_DOC, host)
    // Point posAtCoords at the trailing paragraph, i.e. not inside the table.
    e.view.posAtCoords = () => ({ pos: e.state.doc.content.size - 1, inside: -1 })
    render(<TableContextMenu editor={e} />)

    const evt = createEvent.contextMenu(e.view.dom, { clientX: 10, clientY: 10 })
    fireEvent(e.view.dom, evt)

    expect(evt.defaultPrevented).toBe(false)
    expect(document.querySelector('.octo-table-context-menu')).toBeNull()
    e.destroy()
    host.remove()
  })

  it('leaves the native menu fully intact on a read-only editor, even inside a table cell', () => {
    // Regression (P1): a reader (editable === false) right-clicking a table used to still get the
    // native menu suppressed and the custom table menu opened, letting them "edit" a read-only doc.
    // A read-only editor must pass the native browser menu through untouched — no preventDefault,
    // no selection move, no custom menu.
    const host = document.createElement('div')
    document.body.appendChild(host)
    const e = tableEditor(HISTORICAL_DOC, host, false)
    expect(e.isEditable).toBe(false)
    // Point posAtCoords at a real cell; the handler must bail on the isEditable gate before it runs.
    e.view.posAtCoords = () => ({ pos: firstCellTextPos(e), inside: -1 })
    render(<TableContextMenu editor={e} />)

    const evt = createEvent.contextMenu(e.view.dom, { clientX: 120, clientY: 90 })
    fireEvent(e.view.dom, evt)

    expect(evt.defaultPrevented).toBe(false)
    expect(document.querySelector('.octo-table-context-menu')).toBeNull()
    e.destroy()
    host.remove()
  })

  it('runs a command and closes when a menu item is clicked', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const e = tableEditor(HISTORICAL_DOC, host)
    e.view.posAtCoords = () => ({ pos: firstCellTextPos(e), inside: -1 })
    render(<TableContextMenu editor={e} />)

    fireEvent(e.view.dom, createEvent.contextMenu(e.view.dom, { clientX: 120, clientY: 90 }))
    expect(tableDims(e)).toEqual({ rows: 2, cols: 2 })

    // "Add row after" — reuse the accessible name from the shared i18n keys.
    fireEvent.click(screen.getByTitle('docs.table.addRowAfter'))
    expect(tableDims(e)).toEqual({ rows: 3, cols: 2 })
    // Menu closes after the action.
    expect(document.querySelector('.octo-table-context-menu')).toBeNull()
    e.destroy()
    host.remove()
  })

  it('closes on Escape', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const e = tableEditor(HISTORICAL_DOC, host)
    e.view.posAtCoords = () => ({ pos: firstCellTextPos(e), inside: -1 })
    render(<TableContextMenu editor={e} />)

    fireEvent(e.view.dom, createEvent.contextMenu(e.view.dom, { clientX: 120, clientY: 90 }))
    expect(document.querySelector('.octo-table-context-menu')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('.octo-table-context-menu')).toBeNull()
    e.destroy()
    host.remove()
  })
})

// Multi-cell delete through the REAL right-click flow, reproducing the behaviour a browser (not
// jsdom) produces. When a user frames a multi-column/row CellSelection and then right-clicks a cell
// inside it, the browser processes the native right-click AFTER our contextmenu handler returns: it
// moves the caret into the clicked cell and fires `selectionchange`, which ProseMirror syncs back
// into a single-cell TextSelection — collapsing the framed rectangle before the user can click a
// menu item. The previous unit tests called moveSelectionIntoCell directly and asserted on the
// still-intact selection, so they never exercised this collapse and stayed green while the real
// browser deleted only the one clicked column ("select N, only 1 goes"). These tests drive the full
// contextmenu -> collapse -> menu-click path and assert the whole framed range is removed.
describe('TableContextMenu — multi-cell delete survives the browser right-click selection collapse', () => {
  // 2 rows × 4 columns, so deleting a 2- or 3-column selection still leaves a table behind.
  const WIDE_DOC =
    '<table><tbody>' +
    '<tr><td>a</td><td>b</td><td>c</td><td>d</td></tr>' +
    '<tr><td>e</td><td>f</td><td>g</td><td>h</td></tr>' +
    '</tbody></table>'
  // 4 rows × 2 columns, for the delete-row counterpart.
  const TALL_DOC =
    '<table><tbody>' +
    '<tr><td>a</td><td>b</td></tr>' +
    '<tr><td>c</td><td>d</td></tr>' +
    '<tr><td>e</td><td>f</td></tr>' +
    '<tr><td>g</td><td>h</td></tr>' +
    '</tbody></table>'

  /**
   * Open the context menu over a framed CellSelection (anchor..head cells), then reproduce the
   * browser collapsing that selection to the single clicked cell before the menu item is clicked.
   * Returns the editor mounted in a live DOM host, ready for a menu-item click.
   */
  function openMenuOverSelectionThenCollapse(
    doc: string,
    anchorCellIdx: number,
    headCellIdx: number,
    clickedCellIdx: number,
  ): { e: Editor; host: HTMLElement } {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const e = tableEditor(doc, host)
    const cells = cellPositions(e)
    e.view.dispatch(
      e.state.tr.setSelection(CellSelection.create(e.state.doc, cells[anchorCellIdx], cells[headCellIdx])),
    )
    expect(e.state.selection instanceof CellSelection).toBe(true)

    // Right-click a text position inside a cell that is part of the framed selection.
    const clickPos = cells[clickedCellIdx] + 2
    e.view.posAtCoords = () => ({ pos: clickPos, inside: -1 })
    render(<TableContextMenu editor={e} />)
    fireEvent(e.view.dom, createEvent.contextMenu(e.view.dom, { clientX: 60, clientY: 40 }))
    expect(document.querySelector('.octo-table-context-menu')).toBeTruthy()

    // The browser now moves the caret into the clicked cell and ProseMirror collapses the
    // CellSelection to a single-cell TextSelection — exactly what jsdom never does on its own.
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, clickPos)))
    expect(e.state.selection instanceof CellSelection).toBe(false)

    return { e, host }
  }

  it('deletes both framed columns (select 2 of 4 -> 2 remain), not just the clicked one', () => {
    // Columns 1 and 2 = cells b(1), c(2), f(5), g(6). Right-click cell c, inside the selection.
    const { e, host } = openMenuOverSelectionThenCollapse(WIDE_DOC, 1, 6, 2)
    fireEvent.click(screen.getByTitle('docs.table.deleteColumn'))
    expect(tableDims(e)).toEqual({ rows: 2, cols: 2 })
    e.destroy()
    host.remove()
  })

  it('deletes N framed columns (select 3 of 4 -> 1 remains)', () => {
    // Columns 0..2 = cells a(0), b(1), c(2), e(4), f(5), g(6). Right-click cell b, inside it.
    const { e, host } = openMenuOverSelectionThenCollapse(WIDE_DOC, 0, 6, 1)
    fireEvent.click(screen.getByTitle('docs.table.deleteColumn'))
    expect(tableDims(e)).toEqual({ rows: 2, cols: 1 })
    e.destroy()
    host.remove()
  })

  it('deletes both framed rows (select 2 of 4 -> 2 remain) via delete row', () => {
    // Rows 1 and 2 = cells c(2), d(3), e(4), f(5). Right-click cell d, inside the selection.
    const { e, host } = openMenuOverSelectionThenCollapse(TALL_DOC, 2, 5, 3)
    fireEvent.click(screen.getByTitle('docs.table.deleteRow'))
    expect(tableDims(e)).toEqual({ rows: 2, cols: 2 })
    e.destroy()
    host.remove()
  })

  it('still collapses to the single clicked cell when the right-click lands outside the framed selection', () => {
    // Complement: a single-cell right-click must NOT be treated as a range. Frame columns 0-1, then
    // right-click cell d (column 3), outside the selection: only that one column is removed.
    const host = document.createElement('div')
    document.body.appendChild(host)
    const e = tableEditor(WIDE_DOC, host)
    const cells = cellPositions(e)
    e.view.dispatch(e.state.tr.setSelection(CellSelection.create(e.state.doc, cells[0], cells[5])))
    const clickPos = cells[3] + 2 // cell d, column 3, outside the selection
    e.view.posAtCoords = () => ({ pos: clickPos, inside: -1 })
    render(<TableContextMenu editor={e} />)
    fireEvent(e.view.dom, createEvent.contextMenu(e.view.dom, { clientX: 60, clientY: 40 }))
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, clickPos)))

    fireEvent.click(screen.getByTitle('docs.table.deleteColumn'))
    expect(tableDims(e)).toEqual({ rows: 2, cols: 3 })
    e.destroy()
    host.remove()
  })
})

describe('TableContextMenu — read-only editor never mutates a table', () => {
  it('right-clicking a table cell in a read-only editor leaves the table unchanged (native menu passes through)', () => {
    // Runnable read-only pass-through evidence: on a reader (editable === false) the handler must
    // bail before touching the selection or opening the menu, so no table command can ever run and
    // the document is untouched. Complements the "native menu intact" assertion above with a direct
    // mutation check.
    const host = document.createElement('div')
    document.body.appendChild(host)
    const e = tableEditor(HISTORICAL_DOC, host, false)
    expect(e.isEditable).toBe(false)
    const before = e.getHTML()
    e.view.posAtCoords = () => ({ pos: firstCellTextPos(e), inside: -1 })
    render(<TableContextMenu editor={e} />)

    const evt = createEvent.contextMenu(e.view.dom, { clientX: 120, clientY: 90 })
    fireEvent(e.view.dom, evt)

    // No custom menu, native menu left intact, and the table is byte-for-byte unchanged.
    expect(evt.defaultPrevented).toBe(false)
    expect(document.querySelector('.octo-table-context-menu')).toBeNull()
    expect(tableDims(e)).toEqual({ rows: 2, cols: 2 })
    expect(e.getHTML()).toBe(before)
    e.destroy()
    host.remove()
  })
})

describe('clampMenuPosition — keep the context menu inside the viewport', () => {
  const VIEWPORT = { width: 1200, height: 800 }
  const MENU = { width: 180, height: 220 }

  it('opens at the pointer when there is room in both directions', () => {
    expect(clampMenuPosition({ x: 300, y: 200 }, MENU, VIEWPORT)).toEqual({ left: 300, top: 200 })
  })

  it('shifts left/up so the menu never overflows the right/bottom edges', () => {
    const { left, top } = clampMenuPosition({ x: 1190, y: 790 }, MENU, VIEWPORT)
    expect(left).toBe(VIEWPORT.width - MENU.width)
    expect(top).toBe(VIEWPORT.height - MENU.height)
  })

  it('never goes negative', () => {
    const { left, top } = clampMenuPosition({ x: -50, y: -50 }, MENU, VIEWPORT)
    expect(left).toBe(0)
    expect(top).toBe(0)
  })
})

describe('TableGridPicker — insert at a chosen size (no more hardcoded 3×3)', () => {
  it('inserts a table sized to the clicked grid cell', () => {
    const e = tableEditor('<p></p>')
    render(<TableGridPicker editor={e} />)
    // Open the picker, then click the 2×4 cell.
    fireEvent.click(screen.getByTitle('docs.toolbar.table'))
    fireEvent.click(screen.getByLabelText('2 × 4'))
    expect(tableDims(e)).toEqual({ rows: 2, cols: 4 })
    e.destroy()
  })

  it('offers an 8×8 grid of size options', () => {
    const e = tableEditor('<p></p>')
    render(<TableGridPicker editor={e} />)
    fireEvent.click(screen.getByTitle('docs.toolbar.table'))
    expect(screen.getByLabelText('1 × 1')).toBeTruthy()
    expect(screen.getByLabelText('8 × 8')).toBeTruthy()
    e.destroy()
  })
})

