import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import {
  TableFreeze,
  tableFreezeKey,
  cumulativeOffsets,
  getFreezeSpec,
  isInTable,
  applyFrozenStyles,
  clearFrozenCell,
} from './TableFreeze.ts'

// #755 (XIN-1096) — freeze panes for the Docs editor table. Freeze is VIEW-STATE: the extension
// keeps a Map<tablePos, {rows, cols}> in a ProseMirror plugin (never written to the Y.Doc). These
// tests exercise the pure offset helper, the commands, and the plugin's position remapping across
// edits — the pixel-level sticky styling is verified in the browser (jsdom has no layout).

function editor(content: string) {
  return new Editor({
    editable: true,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TableFreeze,
    ],
    content,
  })
}

const DOC =
  '<p>before</p>' +
  '<table><tbody>' +
  '<tr><th>a</th><th>b</th><th>c</th></tr>' +
  '<tr><td>d</td><td>e</td><td>f</td></tr>' +
  '<tr><td>g</td><td>h</td><td>i</td></tr>' +
  '</tbody></table>' +
  '<p>after</p>'

/** First text position inside the first table cell. */
function firstCellTextPos(e: Editor): number {
  let pos = -1
  e.state.doc.descendants((node, p) => {
    if (pos === -1 && (node.type.name === 'tableCell' || node.type.name === 'tableHeader')) {
      pos = p + 2
      return false
    }
    return pos === -1
  })
  return pos
}

/** Text position inside the cell at (row, col) of the first table (0-based). */
function cellTextPos(e: Editor, row: number, col: number): number {
  let tableStart = -1
  e.state.doc.descendants((node, p) => {
    if (tableStart === -1 && node.type.name === 'table') {
      tableStart = p
      return false
    }
    return tableStart === -1
  })
  const table = e.state.doc.nodeAt(tableStart)!
  let target = -1
  let rowIdx = 0
  table.forEach((rowNode, rowOffset) => {
    if (rowIdx === row) {
      let colIdx = 0
      rowNode.forEach((cellNode, cellOffset) => {
        if (colIdx === col) {
          // tableStart + 1 (into table) + rowOffset + 1 (into row) + cellOffset + 1 (into cell) + 1 (into paragraph)
          target = tableStart + 1 + rowOffset + 1 + cellOffset + 2
        }
        colIdx++
      })
    }
    rowIdx++
  })
  return target
}

describe('cumulativeOffsets', () => {
  it('returns prefix sums with a leading zero', () => {
    expect(cumulativeOffsets([])).toEqual([])
    expect(cumulativeOffsets([40])).toEqual([0])
    expect(cumulativeOffsets([40, 80, 30])).toEqual([0, 40, 120])
  })
})

describe('TableFreeze commands', () => {
  it('toggleFreezeHeaderRow freezes then unfreezes the top row', () => {
    const e = editor(DOC)
    e.commands.setTextSelection(firstCellTextPos(e))
    expect(getFreezeSpec(e.state)).toEqual({ rows: 0, cols: 0 })

    e.chain().focus().toggleFreezeHeaderRow().run()
    expect(getFreezeSpec(e.state)).toEqual({ rows: 1, cols: 0 })

    e.chain().focus().toggleFreezeHeaderRow().run()
    expect(getFreezeSpec(e.state)).toEqual({ rows: 0, cols: 0 })
    e.destroy()
  })

  it('toggleFreezeFirstColumn freezes the first column independently of rows', () => {
    const e = editor(DOC)
    e.commands.setTextSelection(firstCellTextPos(e))
    e.chain().focus().toggleFreezeHeaderRow().run()
    e.chain().focus().toggleFreezeFirstColumn().run()
    expect(getFreezeSpec(e.state)).toEqual({ rows: 1, cols: 1 })

    e.chain().focus().toggleFreezeFirstColumn().run()
    expect(getFreezeSpec(e.state)).toEqual({ rows: 1, cols: 0 })
    e.destroy()
  })

  it('freezeThroughSelectedRow freezes N rows up to the caret row', () => {
    const e = editor(DOC)
    // Caret in row index 1 (the second row) -> freeze 2 rows.
    e.commands.setTextSelection(cellTextPos(e, 1, 0))
    e.chain().focus().freezeThroughSelectedRow().run()
    expect(getFreezeSpec(e.state)).toEqual({ rows: 2, cols: 0 })
    e.destroy()
  })

  it('freezeThroughSelectedColumn freezes N columns up to the caret column', () => {
    const e = editor(DOC)
    // Caret in column index 2 (the third column) -> freeze 3 columns.
    e.commands.setTextSelection(cellTextPos(e, 0, 2))
    e.chain().focus().freezeThroughSelectedColumn().run()
    expect(getFreezeSpec(e.state)).toEqual({ rows: 0, cols: 3 })
    e.destroy()
  })

  it('setTableFreeze clamps the request to the table dimensions', () => {
    const e = editor(DOC) // 3 rows × 3 cols
    e.commands.setTextSelection(firstCellTextPos(e))
    e.chain().focus().setTableFreeze({ rows: 99, cols: 99 }).run()
    expect(getFreezeSpec(e.state)).toEqual({ rows: 3, cols: 3 })
    e.destroy()
  })

  it('clearTableFreeze removes the entry entirely', () => {
    const e = editor(DOC)
    e.commands.setTextSelection(firstCellTextPos(e))
    e.chain().focus().setTableFreeze({ rows: 2, cols: 1 }).run()
    expect(tableFreezeKey.getState(e.state)!.size).toBe(1)

    e.chain().focus().clearTableFreeze().run()
    expect(tableFreezeKey.getState(e.state)!.size).toBe(0)
    expect(getFreezeSpec(e.state)).toEqual({ rows: 0, cols: 0 })
    e.destroy()
  })

  it('does nothing when the caret is not inside a table', () => {
    const e = editor(DOC)
    e.commands.setTextSelection(2) // in the leading "before" paragraph
    expect(isInTable(e.state)).toBe(false)
    const ok = e.chain().focus().toggleFreezeHeaderRow().run()
    expect(ok).toBe(false)
    expect(tableFreezeKey.getState(e.state)!.size).toBe(0)
    e.destroy()
  })
})

describe('TableFreeze plugin state', () => {
  it('keeps the freeze pinned to the table as content is inserted before it', () => {
    const e = editor(DOC)
    e.commands.setTextSelection(firstCellTextPos(e))
    e.chain().focus().toggleFreezeHeaderRow().run()
    expect(getFreezeSpec(e.state)).toEqual({ rows: 1, cols: 0 })

    // Type into the leading paragraph (shifts every position after it, including the table).
    e.chain().setTextSelection(2).insertContent('XYZ more text ').run()

    // The freeze survived the remap and still resolves for the (now shifted) table.
    e.commands.setTextSelection(firstCellTextPos(e))
    expect(getFreezeSpec(e.state)).toEqual({ rows: 1, cols: 0 })
    e.destroy()
  })

  it('drops the freeze entry when its table is deleted', () => {
    const e = editor(DOC)
    e.commands.setTextSelection(firstCellTextPos(e))
    e.chain().focus().setTableFreeze({ rows: 1, cols: 1 }).run()
    expect(tableFreezeKey.getState(e.state)!.size).toBe(1)

    e.chain().focus().deleteTable().run()
    expect(tableFreezeKey.getState(e.state)!.size).toBe(0)
    e.destroy()
  })
})

describe('applyFrozenStyles — sticky styling of the frozen bands', () => {
  // jsdom has no layout, so stub the box metrics the styler measures. Row heights = 20px each,
  // column widths = 50px each, so cumulative offsets are predictable.
  function buildTable(rows: number, cols: number): HTMLTableElement {
    const table = document.createElement('table')
    const wrapper = document.createElement('div')
    wrapper.className = 'tableWrapper'
    wrapper.appendChild(table)
    const tbody = document.createElement('tbody')
    for (let r = 0; r < rows; r++) {
      const tr = document.createElement('tr')
      Object.defineProperty(tr, 'offsetHeight', {
        value: 20,
        configurable: true,
      })
      for (let c = 0; c < cols; c++) {
        const td = document.createElement('td')
        Object.defineProperty(td, 'offsetWidth', {
          value: 50,
          configurable: true,
        })
        tr.appendChild(td)
      }
      tbody.appendChild(tr)
    }
    table.appendChild(tbody)
    return table
  }

  it('marks the first two rows sticky-top with cumulative offsets and z-index', () => {
    const table = buildTable(4, 3)
    applyFrozenStyles(table, { rows: 2, cols: 0 })
    const rows = Array.from(table.rows)
    expect(rows[0].cells[0].style.position).toBe('sticky')
    expect(rows[0].cells[0].style.top).toBe('0px')
    expect(rows[0].cells[0].style.zIndex).toBe('3')
    expect(rows[1].cells[2].style.top).toBe('20px')
    expect(rows[2].cells[0].style.position).toBe('')
    expect(table.closest('.tableWrapper')!.classList.contains('octo-has-frozen-rows')).toBe(true)
    // The table switches to the separate-border class so sticky cells actually hold in Chromium.
    expect(table.classList.contains('octo-frozen-table')).toBe(true)
  })

  it('marks the first column sticky-left and gives the corner the top z-index', () => {
    const table = buildTable(3, 4)
    applyFrozenStyles(table, { rows: 1, cols: 1 })
    const rows = Array.from(table.rows)
    expect(rows[1].cells[0].style.position).toBe('sticky')
    expect(rows[1].cells[0].style.left).toBe('0px')
    expect(rows[1].cells[0].style.zIndex).toBe('2')
    expect(rows[0].cells[0].style.zIndex).toBe('4')
    expect(rows[0].cells[1].style.zIndex).toBe('3')
    expect(table.closest('.tableWrapper')!.classList.contains('octo-has-frozen-rows')).toBe(true)
  })

  it('clearFrozenCell fully reverts a styled cell', () => {
    const table = buildTable(2, 2)
    applyFrozenStyles(table, { rows: 1, cols: 1 })
    const cell = table.rows[0].cells[0]
    expect(cell.getAttribute('data-octo-frozen')).toBe('')
    clearFrozenCell(cell)
    expect(cell.style.position).toBe('')
    expect(cell.style.top).toBe('')
    expect(cell.style.left).toBe('')
    expect(cell.style.zIndex).toBe('')
    expect(cell.hasAttribute('data-octo-frozen')).toBe(false)
    expect(cell.classList.contains('octo-frozen-cell')).toBe(false)
  })
})
