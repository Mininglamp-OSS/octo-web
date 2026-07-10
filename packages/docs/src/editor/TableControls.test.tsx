import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { CellSelection } from '@tiptap/pm/tables'
import { TextSelection } from '@tiptap/pm/state'
import { shouldShowTableBubble, TableGridPicker } from './TableControls.tsx'

// #595 — table add/delete row/column UI. The critical acceptance point is that the controls work on
// tables that ALREADY EXIST in a document (parsed from stored HTML), not only freshly inserted
// ones. These tests seed the editor from HTML so every assertion runs against a "historical" table.

function tableEditor(content: string) {
  return new Editor({
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

describe('shouldShowTableBubble — visibility gate (covers historical tables)', () => {
  it('is true when the caret sits inside a cell of a pre-existing table', () => {
    const e = tableEditor(HISTORICAL_DOC)
    e.commands.setTextSelection(firstCellTextPos(e))
    expect(e.isActive('table')).toBe(true)
    expect(shouldShowTableBubble(e)).toBe(true)
    e.destroy()
  })

  it('is false when the caret is outside any table', () => {
    const e = tableEditor(HISTORICAL_DOC)
    e.commands.setTextSelection(2) // inside the leading "before" paragraph
    expect(e.isActive('table')).toBe(false)
    expect(shouldShowTableBubble(e)).toBe(false)
    e.destroy()
  })

  it('is true for a whole-cell (CellSelection) selection', () => {
    const e = tableEditor(HISTORICAL_DOC)
    const cellPos = firstCellTextPos(e) - 2 // position just before the first cell node
    const { tr } = e.state
    const $cell = e.state.doc.resolve(cellPos)
    tr.setSelection(new CellSelection($cell))
    e.view.dispatch(tr)
    expect(e.state.selection).toBeInstanceOf(CellSelection)
    expect(shouldShowTableBubble(e)).toBe(true)
    e.destroy()
  })

  it('is false while a plain text run inside a cell is selected (defers to the formatting bubble)', () => {
    const e = tableEditor(HISTORICAL_DOC)
    const pos = firstCellTextPos(e)
    const { tr } = e.state
    tr.setSelection(TextSelection.create(tr.doc, pos, pos + 1)) // select the "a" character
    e.view.dispatch(tr)
    expect(e.state.selection.empty).toBe(false)
    expect(shouldShowTableBubble(e)).toBe(false)
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
