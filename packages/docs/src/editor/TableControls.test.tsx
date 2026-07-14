import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, createEvent } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
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

function tableEditor(content: string, element?: HTMLElement) {
  return new Editor({
    element,
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
