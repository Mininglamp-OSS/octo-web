import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
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
  // and each visual column is 50px wide (a colspan=N cell reports 50*N), so cumulative offsets are
  // predictable. Tables are rendered through a real editor so the DOM and the ProseMirror node the
  // styler derives its TableMap from are guaranteed to line up (as they do in the live plugin).
  function renderTable(tableHtml: string): { e: Editor; node: PMNode; table: HTMLTableElement } {
    const e = editor('<p>x</p>' + tableHtml)
    let pos = -1
    e.state.doc.descendants((n, p) => {
      if (pos === -1 && n.type.name === 'table') {
        pos = p
        return false
      }
      return pos === -1
    })
    const node = e.state.doc.nodeAt(pos)!
    const dom = e.view.nodeDOM(pos) as HTMLElement
    const table = (dom instanceof HTMLTableElement ? dom : dom.querySelector('table'))!
    // The live editor renders tables inside a `.tableWrapper` scroll container (the styler toggles
    // `octo-has-frozen-rows` on it). With resizing off the test editor omits that NodeView, so add
    // the wrapper in place to mirror production without detaching the table from the editor DOM.
    if (!table.closest('.tableWrapper')) {
      const wrapper = document.createElement('div')
      wrapper.className = 'tableWrapper'
      table.parentNode?.insertBefore(wrapper, table)
      wrapper.appendChild(table)
    }
    Array.from(table.rows).forEach((tr) => {
      Object.defineProperty(tr, 'offsetHeight', { value: 20, configurable: true })
      Array.from(tr.cells).forEach((td) => {
        Object.defineProperty(td, 'offsetWidth', {
          value: 50 * (td.colSpan || 1),
          configurable: true,
        })
      })
    })
    return { e, node, table }
  }

  /** Uniform `rows`×`cols` grid (no merged cells), rendered like the live editor. */
  function buildTable(rows: number, cols: number): { e: Editor; node: PMNode; table: HTMLTableElement } {
    let html = '<table><tbody>'
    for (let r = 0; r < rows; r++) {
      html += '<tr>'
      for (let c = 0; c < cols; c++) html += `<td>r${r}c${c}</td>`
      html += '</tr>'
    }
    html += '</tbody></table>'
    return renderTable(html)
  }

  it('marks the first two rows sticky-top with cumulative offsets and z-index', () => {
    const { e, node, table } = buildTable(4, 3)
    applyFrozenStyles(table, node, { rows: 2, cols: 0 })
    const rows = Array.from(table.rows)
    expect(rows[0].cells[0].style.position).toBe('sticky')
    expect(rows[0].cells[0].style.top).toBe('0px')
    expect(rows[0].cells[0].style.zIndex).toBe('3')
    expect(rows[1].cells[2].style.top).toBe('20px')
    expect(rows[2].cells[0].style.position).toBe('')
    expect(table.closest('.tableWrapper')!.classList.contains('octo-has-frozen-rows')).toBe(true)
    // The table switches to the separate-border class so sticky cells actually hold in Chromium.
    expect(table.classList.contains('octo-frozen-table')).toBe(true)
    e.destroy()
  })

  it('marks the first column sticky-left and gives the corner the top z-index', () => {
    const { e, node, table } = buildTable(3, 4)
    applyFrozenStyles(table, node, { rows: 1, cols: 1 })
    const rows = Array.from(table.rows)
    expect(rows[1].cells[0].style.position).toBe('sticky')
    expect(rows[1].cells[0].style.left).toBe('0px')
    expect(rows[1].cells[0].style.zIndex).toBe('2')
    expect(rows[0].cells[0].style.zIndex).toBe('4')
    expect(rows[0].cells[1].style.zIndex).toBe('3')
    expect(table.closest('.tableWrapper')!.classList.contains('octo-has-frozen-rows')).toBe(true)
    e.destroy()
  })

  // Merged-cell regression (#775 review). Both cases fail with the old DOM-index styler: a colspan
  // cell is one DOM entry but several visual columns, and a rowspan cell is absent from the rows it
  // covers — so `row.cells[i]` is NOT visual column `i`. The TableMap-derived styler keys off the
  // grid rect instead, so the frozen band follows the real column geometry.
  it('freezes the true columns of a header row containing a colspan cell', () => {
    // Row 0: [colspan=2 over cols 0-1][col 2]; rows 1-2: three single cells. Freeze first 2 columns.
    const { e, node, table } = renderTable(
      '<table><tbody>' +
        '<tr><th colspan="2">ab</th><th>c</th></tr>' +
        '<tr><td>d</td><td>e</td><td>f</td></tr>' +
        '<tr><td>g</td><td>h</td><td>i</td></tr>' +
        '</tbody></table>',
    )
    applyFrozenStyles(table, node, { rows: 0, cols: 2 })
    const rows = Array.from(table.rows)

    // Header: the colspan cell spans cols 0-1 → frozen at left 0; the lone col-2 cell is NOT frozen.
    // The old code froze both (DOM index 1 < 2) and mis-offset the col-2 header by a column.
    expect(rows[0].cells[0].classList.contains('octo-frozen-col-cell')).toBe(true)
    expect(rows[0].cells[0].style.left).toBe('0px')
    expect(rows[0].cells[1].classList.contains('octo-frozen-cell')).toBe(false)
    expect(rows[0].cells[1].hasAttribute('data-octo-frozen')).toBe(false)

    // Body rows: columns 0 and 1 frozen at 0px / 50px, column 2 untouched.
    expect(rows[1].cells[0].style.left).toBe('0px')
    expect(rows[1].cells[1].style.left).toBe('50px')
    expect(rows[1].cells[2].classList.contains('octo-frozen-cell')).toBe(false)
    e.destroy()
  })

  it('freezes the first column without leaking into a row skipped by a rowspan cell', () => {
    // Col 0 of row 0 spans rows 0-1 (rowspan=2). Row 1 therefore has ONE DOM cell — its col-1 cell.
    // Freeze the first column: only the real col-0 cells should stick.
    const { e, node, table } = renderTable(
      '<table><tbody>' +
        '<tr><td rowspan="2">a</td><td>b</td></tr>' +
        '<tr><td>c</td></tr>' +
        '<tr><td>d</td><td>e</td></tr>' +
        '</tbody></table>',
    )
    applyFrozenStyles(table, node, { rows: 0, cols: 1 })
    const rows = Array.from(table.rows)

    // Row 0: the rowspan cell is col 0 → frozen; its sibling is col 1 → not frozen.
    expect(rows[0].cells[0].classList.contains('octo-frozen-col-cell')).toBe(true)
    expect(rows[0].cells[1].classList.contains('octo-frozen-cell')).toBe(false)

    // Row 1's only DOM cell is col 1 (col 0 is covered by the rowspan) → it must NOT be frozen.
    // The old code froze it because it sat at DOM index 0 (< frozenCols).
    expect(rows[1].cells[0].classList.contains('octo-frozen-cell')).toBe(false)
    expect(rows[1].cells[0].hasAttribute('data-octo-frozen')).toBe(false)

    // Row 2 is a normal row: col 0 frozen, col 1 not.
    expect(rows[2].cells[0].classList.contains('octo-frozen-col-cell')).toBe(true)
    expect(rows[2].cells[1].classList.contains('octo-frozen-cell')).toBe(false)
    e.destroy()
  })

  it('clearFrozenCell fully reverts a styled cell', () => {
    const { e, node, table } = buildTable(2, 2)
    applyFrozenStyles(table, node, { rows: 1, cols: 1 })
    const cell = table.rows[0].cells[0]
    expect(cell.getAttribute('data-octo-frozen')).toBe('')
    clearFrozenCell(cell)
    expect(cell.style.position).toBe('')
    expect(cell.style.top).toBe('')
    expect(cell.style.left).toBe('')
    expect(cell.style.zIndex).toBe('')
    expect(cell.hasAttribute('data-octo-frozen')).toBe(false)
    expect(cell.classList.contains('octo-frozen-cell')).toBe(false)
    e.destroy()
  })
})
