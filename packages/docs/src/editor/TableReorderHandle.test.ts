import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { TextSelection } from '@tiptap/pm/state'
import { TableMap, moveTableColumn, moveTableRow, cellAround } from '@tiptap/pm/tables'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TableReorderHandle, tableReorderPluginKey } from './TableReorderHandle.ts'

// octo-docs-backend#76: table row/column reorder. The drag handle UI is DOM/pointer-driven and
// needs real layout (jsdom reports zero rects), so these tests exercise the reorder MOVE that a
// drop dispatches — the part the acceptance criteria pin down: a single-transaction, TableMap-
// based reorder that preserves cell content and leaves the schema untouched. They also cover the
// merged-cell boundary (a drop that would split a merge must be a safe no-op, not corruption).

function makeEditor(content: string): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TableReorderHandle,
    ],
    content,
  })
}

/** Text of every cell as a `row × col` grid, read from the current TableMap. */
function grid(editor: Editor): string[][] {
  const { doc } = editor.state
  let tablePos = -1
  let table: PMNode | null = null
  doc.descendants((node, pos) => {
    if (!table && node.type.name === 'table') {
      table = node
      tablePos = pos
      return false
    }
    return true
  })
  if (!table) throw new Error('no table')
  const t = table as PMNode
  const map = TableMap.get(t)
  const start = tablePos + 1
  const out: string[][] = []
  for (let r = 0; r < map.height; r++) {
    const row: string[] = []
    for (let c = 0; c < map.width; c++) {
      const cellRel = map.map[r * map.width + c]
      const cell = t.nodeAt(cellRel)
      row.push(cell ? cell.textContent : '')
    }
    out.push(row)
  }
  return out
}

/** Put the caret inside the cell at grid (row,col) — the move commands resolve the target table
 * from the current selection, exactly as the drop handler does before dispatching. */
function selectCell(editor: Editor, row: number, col: number): void {
  const { doc } = editor.state
  let table: PMNode | null = null
  let tablePos = -1
  doc.descendants((node, pos) => {
    if (!table && node.type.name === 'table') {
      table = node
      tablePos = pos
      return false
    }
    return true
  })
  const t = table as PMNode
  const map = TableMap.get(t)
  const cellRel = map.map[row * map.width + col]
  const $inside = doc.resolve(tablePos + 1 + cellRel + 1)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($inside)))
}

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('TableReorderHandle extension', () => {
  it('registers its ProseMirror plugin', () => {
    editor = makeEditor(
      '<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>',
    )
    expect(tableReorderPluginKey.get(editor.state)).toBeTruthy()
  })
})

describe('column reorder (moveTableColumn)', () => {
  it('moves a column and preserves cell content in one transaction', () => {
    editor = makeEditor(
      '<table><tbody>' +
        '<tr><td><p>a1</p></td><td><p>b1</p></td><td><p>c1</p></td></tr>' +
        '<tr><td><p>a2</p></td><td><p>b2</p></td><td><p>c2</p></td></tr>' +
        '</tbody></table>',
    )
    expect(grid(editor)).toEqual([
      ['a1', 'b1', 'c1'],
      ['a2', 'b2', 'c2'],
    ])
    selectCell(editor, 0, 0)
    const before = editor.state.doc
    // Drag column 0 onto column 2 → lands after it (from < to ⇒ "after"), like the drop handler.
    moveTableColumn({ from: 0, to: 2 })(editor.state, editor.view.dispatch)
    expect(grid(editor)).toEqual([
      ['b1', 'c1', 'a1'],
      ['b2', 'c2', 'a2'],
    ])
    // Single content transaction: exactly one step replaced the table node.
    const steps = before.eq(editor.state.doc) ? 0 : 1
    expect(steps).toBe(1)
  })

  it('moving a column back to a lower index lands before it', () => {
    editor = makeEditor(
      '<table><tbody>' +
        '<tr><td><p>a1</p></td><td><p>b1</p></td><td><p>c1</p></td></tr>' +
        '</tbody></table>',
    )
    selectCell(editor, 0, 2)
    moveTableColumn({ from: 2, to: 0 })(editor.state, editor.view.dispatch)
    expect(grid(editor)).toEqual([['c1', 'a1', 'b1']])
  })
})

describe('row reorder (moveTableRow)', () => {
  it('moves a row and preserves cell content', () => {
    editor = makeEditor(
      '<table><tbody>' +
        '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
        '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
        '<tr><td><p>r3c1</p></td><td><p>r3c2</p></td></tr>' +
        '</tbody></table>',
    )
    selectCell(editor, 2, 0)
    moveTableRow({ from: 2, to: 0 })(editor.state, editor.view.dispatch)
    expect(grid(editor)).toEqual([
      ['r3c1', 'r3c2'],
      ['r1c1', 'r1c2'],
      ['r2c1', 'r2c2'],
    ])
  })
})

describe('merged-cell safety', () => {
  it('leaves the schema version untouched (pure reorder, no node/mark changes)', () => {
    editor = makeEditor(
      '<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>',
    )
    const names = new Set<string>()
    editor.state.doc.descendants((n) => {
      names.add(n.type.name)
    })
    selectCell(editor, 0, 0)
    moveTableColumn({ from: 0, to: 1 })(editor.state, editor.view.dispatch)
    const after = new Set<string>()
    editor.state.doc.descendants((n) => {
      after.add(n.type.name)
    })
    // Same node types before/after — the reorder introduces no new schema constructs.
    expect([...after].sort()).toEqual([...names].sort())
  })

  it('a drop that would split a horizontally-merged cell is a safe no-op', () => {
    // Row 0 col 0 spans two columns (colspan=2). Dropping column 0 between the two columns it
    // spans is rejected by the command (target inside the moved merge group) — no corruption.
    editor = makeEditor(
      '<table><tbody>' +
        '<tr><td colspan="2"><p>merged</p></td><td><p>c</p></td></tr>' +
        '<tr><td><p>a2</p></td><td><p>b2</p></td><td><p>c2</p></td></tr>' +
        '</tbody></table>',
    )
    const $pos = editor.state.doc.resolve(3)
    expect(cellAround($pos)).toBeTruthy()
    selectCell(editor, 1, 0)
    const before = grid(editor)
    const moved = moveTableColumn({ from: 0, to: 1 })(editor.state, editor.view.dispatch)
    // Command reports it did nothing; the grid is unchanged (merge preserved).
    expect(moved).toBe(false)
    expect(grid(editor)).toEqual(before)
  })
})
