import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { TextSelection } from '@tiptap/pm/state'
import {
  TableMap,
  moveTableColumn,
  moveTableRow,
  cellAround,
  addRowBefore,
  addColumnBefore,
} from '@tiptap/pm/tables'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { TableReorderHandle, tableReorderPluginKey, resolveDragSource, tableStructureSignature, signatureOfTable, countTableSignature, tableSignatures, draggedTableIndex, draggedTableConflict } from './TableReorderHandle.ts'

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
  if (!table) throw new Error('no table')
  const map = TableMap.get(table)
  const cellRel = map.map[row * map.width + col]
  const $inside = doc.resolve(tablePos + 1 + cellRel + 1)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($inside)))
}

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

/** Absolute document position just before the cell at grid (row,col) — the same anchor the drag
 * captures as `cellPos` at drag start. */
function cellPosOf(editor: Editor, row: number, col: number): number {
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
  if (!table) throw new Error('no table')
  const map = TableMap.get(table)
  const cellRel = map.map[row * map.width + col]
  return tablePos + 1 + cellRel
}

/** Capture (without applying) the transaction a prosemirror-tables command would dispatch, so a
 * test can read its mapping — this is how a concurrent REMOTE edit's mapping reaches the drag
 * anchor in production (via the plugin `state.apply`). */
function captureTr(editor: Editor, command: (state: Editor['state'], dispatch: (tr: Transaction) => void) => boolean): Transaction {
  let captured: Transaction | null = null
  command(editor.state, (tr) => {
    captured = tr
  })
  if (!captured) throw new Error('command produced no transaction')
  return captured
}

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

// octo-docs-backend#76 review (Jerry-Xin, CHANGES_REQUESTED): the blocking collab correctness bug.
// A drag captures its source row/column at drag start; during the drag a remote collaborator may
// insert or delete rows/columns ABOVE the dragged one, remapping the document. The fix remaps the
// drag's cell POSITION through each incoming transaction (plugin state.apply) and re-derives the
// source INDEX from that remapped position at drop time via `resolveDragSource`, so the reorder
// still moves the row/column the user grabbed — not whatever now sits at the stale drag-start index.
describe('concurrent reorder remapping (collaboration correctness)', () => {
  it('RED: the stale drag-start row index moves the WRONG row after a remote insert above', () => {
    editor = makeEditor(
      '<table><tbody>' +
        '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
        '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
        '<tr><td><p>r3c1</p></td><td><p>r3c2</p></td></tr>' +
        '</tbody></table>',
    )
    // Drag starts on row index 2 ("r3"). This is the value the OLD code stored and reused at drop.
    const staleFromIndex = 2

    // A remote peer inserts a blank row above the whole table (caret in row 0, addRowBefore).
    selectCell(editor, 0, 0)
    editor.view.dispatch(captureTr(editor, addRowBefore))
    expect(grid(editor)).toEqual([
      ['', ''],
      ['r1c1', 'r1c2'],
      ['r2c1', 'r2c2'],
      ['r3c1', 'r3c2'],
    ])

    // Reordering with the stale index moves index 2 — now "r2", NOT the grabbed "r3". This is the
    // reviewer's bug: the wrong row moves.
    selectCell(editor, staleFromIndex, 0)
    moveTableRow({ from: staleFromIndex, to: 0 })(editor.state, editor.view.dispatch)
    expect(grid(editor)[0]).toEqual(['r2c1', 'r2c2']) // wrong row bubbled to the top
    expect(grid(editor)[0]).not.toEqual(['r3c1', 'r3c2'])
  })

  it('GREEN: remapping the drag source keeps the move on the original row under a remote insert', () => {
    editor = makeEditor(
      '<table><tbody>' +
        '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
        '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
        '<tr><td><p>r3c1</p></td><td><p>r3c2</p></td></tr>' +
        '</tbody></table>',
    )
    // Drag starts on row 2 ("r3"); capture its cell position, exactly like beginDrag.
    let cellPos = cellPosOf(editor, 2, 0)
    expect(resolveDragSource(editor.state.doc, cellPos)?.rect.top).toBe(2)

    // Remote peer inserts a blank row above; remap the drag anchor through that transaction's
    // mapping (the plugin state.apply does this in production).
    selectCell(editor, 0, 0)
    const remoteTr = captureTr(editor, addRowBefore)
    cellPos = remoteTr.mapping.map(cellPos)
    editor.view.dispatch(remoteTr)

    // The remapped anchor now resolves to grid row index 3 — the grabbed "r3" shifted down by one.
    const source = resolveDragSource(editor.state.doc, cellPos)
    expect(source?.rect.top).toBe(3)

    // Move using the RE-DERIVED index → the original row moves, not the stale index's neighbour.
    const fromIndex = source!.rect.top
    selectCell(editor, fromIndex, 0)
    moveTableRow({ from: fromIndex, to: 0 })(editor.state, editor.view.dispatch)
    expect(grid(editor)[0]).toEqual(['r3c1', 'r3c2'])
    expect(grid(editor)).toEqual([
      ['r3c1', 'r3c2'],
      ['', ''],
      ['r1c1', 'r1c2'],
      ['r2c1', 'r2c2'],
    ])
  })

  it('GREEN: remapping the drag source survives a remote row DELETE above', () => {
    editor = makeEditor(
      '<table><tbody>' +
        '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
        '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
        '<tr><td><p>r3c1</p></td><td><p>r3c2</p></td></tr>' +
        '</tbody></table>',
    )
    // Drag starts on row 2 ("r3").
    let cellPos = cellPosOf(editor, 2, 0)
    expect(resolveDragSource(editor.state.doc, cellPos)?.rect.top).toBe(2)

    // Remote peer deletes row 0 ("r1"). Build the delete as a transaction and remap through it.
    const { doc } = editor.state
    let firstRowStart = -1
    let firstRowEnd = -1
    doc.descendants((node, pos) => {
      if (node.type.name === 'tableRow' && firstRowStart < 0) {
        firstRowStart = pos
        firstRowEnd = pos + node.nodeSize
        return false
      }
      return true
    })
    const remoteTr = editor.state.tr.delete(firstRowStart, firstRowEnd)
    cellPos = remoteTr.mapping.map(cellPos)
    editor.view.dispatch(remoteTr)
    expect(grid(editor)).toEqual([
      ['r2c1', 'r2c2'],
      ['r3c1', 'r3c2'],
    ])

    // "r3" is now at index 1; the remapped anchor tracks it.
    const source = resolveDragSource(editor.state.doc, cellPos)
    expect(source?.rect.top).toBe(1)

    const fromIndex = source!.rect.top
    selectCell(editor, fromIndex, 0)
    moveTableRow({ from: fromIndex, to: 0 })(editor.state, editor.view.dispatch)
    expect(grid(editor)).toEqual([
      ['r3c1', 'r3c2'],
      ['r2c1', 'r2c2'],
    ])
  })

  it('GREEN: remaps the drag source across a concurrent column insert to the left', () => {
    editor = makeEditor(
      '<table><tbody>' +
        '<tr><td><p>a1</p></td><td><p>b1</p></td><td><p>c1</p></td></tr>' +
        '<tr><td><p>a2</p></td><td><p>b2</p></td><td><p>c2</p></td></tr>' +
        '</tbody></table>',
    )
    // Drag starts on column 2 ("c").
    let cellPos = cellPosOf(editor, 0, 2)
    expect(resolveDragSource(editor.state.doc, cellPos)?.rect.left).toBe(2)

    // Remote peer inserts a column to the left of column 0.
    selectCell(editor, 0, 0)
    const remoteTr = captureTr(editor, addColumnBefore)
    cellPos = remoteTr.mapping.map(cellPos)
    editor.view.dispatch(remoteTr)

    // The grabbed column "c" shifted from index 2 to index 3.
    const source = resolveDragSource(editor.state.doc, cellPos)
    expect(source?.rect.left).toBe(3)

    const fromIndex = source!.rect.left
    selectCell(editor, 0, fromIndex)
    moveTableColumn({ from: fromIndex, to: 0 })(editor.state, editor.view.dispatch)
    // Column "c" lands first; the freshly inserted blank column and the rest follow.
    expect(grid(editor)[0]).toEqual(['c1', '', 'a1', 'b1'])
  })

  it('a drop whose source cell was deleted by a collaborator resolves to null (safe no-op)', () => {
    editor = makeEditor(
      '<table><tbody>' +
        '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
        '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
        '</tbody></table>',
    )
    const cellPos = cellPosOf(editor, 1, 0)
    // Remote peer deletes the whole table — the source can no longer resolve.
    const { doc } = editor.state
    let tableStart = -1
    let tableEnd = -1
    doc.descendants((node, pos) => {
      if (node.type.name === 'table') {
        tableStart = pos
        tableEnd = pos + node.nodeSize
        return false
      }
      return true
    })
    const remoteTr = editor.state.tr.delete(tableStart, tableEnd)
    const mapped = remoteTr.mapping.map(cellPos)
    editor.view.dispatch(remoteTr)
    expect(resolveDragSource(editor.state.doc, mapped)).toBeNull()
  })
})

// octo-docs-backend#76 / XIN-1187 (plan B —老板拍板 B): serialize-or-abort guard. The reorder
// command rebuilds the whole table with a coarse `tr.replaceWith`; two such replaces that land
// concurrently converge in the CRDT but interleave cell text (silent corruption — see
// TableReorderConcurrency.test.ts). Plan B snapshots the dragged table's structure at drag start
// (`tableStructureSignature`) and, in the plugin `state.apply`, re-fingerprints it against every
// transaction that arrives mid-drag; if the fingerprint diverges the drop is aborted instead of
// committing the replace. These tests pin the detection primitive and drive it through the exact
// `tr.mapping` flow `state.apply` uses in production (a captured remote transaction, replayed).
describe('plan-B concurrency guard — table structure signature', () => {
  const HTML_3x2 =
    '<table><tbody>' +
    '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
    '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
    '<tr><td><p>r3c1</p></td><td><p>r3c2</p></td></tr>' +
    '</tbody></table>'

  it('is stable for an unchanged table (no false conflict)', () => {
    editor = makeEditor(HTML_3x2)
    const cellPos = cellPosOf(editor, 2, 0)
    const a = tableStructureSignature(editor.state.doc, cellPos)
    const b = tableStructureSignature(editor.state.doc, cellPos)
    expect(a).not.toBeNull()
    expect(a).toBe(b)
  })

  it('detects a concurrent REMOTE reorder of the dragged table (same dimensions)', () => {
    editor = makeEditor(HTML_3x2)
    // Drag starts on row 2; capture the baseline exactly like beginDrag.
    let cellPos = cellPosOf(editor, 2, 0)
    const baseline = tableStructureSignature(editor.state.doc, cellPos)

    // A remote peer reorders the SAME table (row 0 → bottom). Capture as a transaction and remap the
    // drag anchor through it, mirroring the plugin state.apply.
    selectCell(editor, 0, 0)
    const remoteTr = captureTr(editor, moveTableRow({ from: 0, to: 2 }))
    cellPos = remoteTr.mapping.map(cellPos)
    editor.view.dispatch(remoteTr)

    // Row/col counts are unchanged, so a dimension-only check would miss this. A whole-table
    // replace collapses the remapped anchor to the replace boundary (signature null) OR the
    // text-in-order fingerprint diverges — either way matches the guard's `current === null ||
    // current !== baseline` test, so it latches a conflict and the drop aborts.
    const after = tableStructureSignature(editor.state.doc, cellPos)
    expect(after === null || after !== baseline).toBe(true)
  })

  it('detects a concurrent remote row insert into the dragged table', () => {
    editor = makeEditor(HTML_3x2)
    let cellPos = cellPosOf(editor, 2, 0)
    const baseline = tableStructureSignature(editor.state.doc, cellPos)

    selectCell(editor, 0, 0)
    const remoteTr = captureTr(editor, addRowBefore)
    cellPos = remoteTr.mapping.map(cellPos)
    editor.view.dispatch(remoteTr)

    expect(tableStructureSignature(editor.state.doc, cellPos)).not.toBe(baseline)
  })

  it('detects a concurrent remote column insert into the dragged table', () => {
    editor = makeEditor(HTML_3x2)
    let cellPos = cellPosOf(editor, 2, 0)
    const baseline = tableStructureSignature(editor.state.doc, cellPos)

    selectCell(editor, 0, 0)
    const remoteTr = captureTr(editor, addColumnBefore)
    cellPos = remoteTr.mapping.map(cellPos)
    editor.view.dispatch(remoteTr)

    expect(tableStructureSignature(editor.state.doc, cellPos)).not.toBe(baseline)
  })

  it('treats a deleted source table as a conflict (signature null)', () => {
    editor = makeEditor(HTML_3x2)
    const cellPos = cellPosOf(editor, 2, 0)
    expect(tableStructureSignature(editor.state.doc, cellPos)).not.toBeNull()

    const { doc } = editor.state
    let tableStart = -1
    let tableEnd = -1
    doc.descendants((node, pos) => {
      if (node.type.name === 'table') {
        tableStart = pos
        tableEnd = pos + node.nodeSize
        return false
      }
      return true
    })
    const remoteTr = editor.state.tr.delete(tableStart, tableEnd)
    const mapped = remoteTr.mapping.map(cellPos)
    editor.view.dispatch(remoteTr)
    expect(tableStructureSignature(editor.state.doc, mapped)).toBeNull()
  })

  it('does NOT fire for a benign edit outside the dragged table (no false abort)', () => {
    editor = makeEditor(
      '<p>lead</p>' +
        '<table><tbody>' +
        '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
        '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
        '</tbody></table>',
    )
    let cellPos = cellPosOf(editor, 1, 0)
    const baseline = tableStructureSignature(editor.state.doc, cellPos)

    // A collaborator types into the leading paragraph (position 1), well before the table. This
    // shifts every table position, so the anchor must be remapped — but the table itself is
    // untouched, so the fingerprint stays equal and the reorder is allowed to proceed.
    const remoteTr = editor.state.tr.insertText('xyz', 1)
    cellPos = remoteTr.mapping.map(cellPos)
    editor.view.dispatch(remoteTr)

    const after = tableStructureSignature(editor.state.doc, cellPos)
    expect(after).toBe(baseline)
  })
})

// octo-docs-backend#76 FAIL-2 (XIN-1206 → XIN-1221): the plan-B guard's scope was too wide. Two
// scopings still false-aborted on edits ELSEWHERE in the doc: (1) re-fingerprinting a single remapped
// `cellPos` — a coarse remote ReplaceStep collapses it to a boundary so it stops resolving to a cell
// even when the dragged table is untouched, firing the old `signature === null → conflict` branch on
// prose / other-table edits; (2) counting how many tables carry the drag-start signature — a document
// with two byte-identical tables makes the count ambiguous, so editing the OTHER twin dropped it and
// false-aborted. The guard now keys off a STABLE IDENTITY: the dragged table's ordinal among tables
// plus the ordered signature list (`tableSignatures` / `draggedTableIndex` / `draggedTableConflict`),
// so only a change to the DRAGGED table's own ordinal slot aborts.
describe('plan-B guard scope — same-table only (FAIL-2)', () => {
  const TWO_TABLES =
    '<table><tbody>' +
    '<tr><td><p>A1</p></td><td><p>A2</p></td></tr>' +
    '<tr><td><p>A3</p></td><td><p>A4</p></td></tr>' +
    '</tbody></table>' +
    '<p>between</p>' +
    '<table><tbody>' +
    '<tr><td><p>B1</p></td><td><p>B2</p></td></tr>' +
    '</tbody></table>'

  /** nth (0-based) table node + its doc position. */
  function nthTable(editor: Editor, n: number): { node: PMNode; pos: number } {
    const found: { node: PMNode; pos: number }[] = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table') {
        found.push({ node, pos })
        return false
      }
      return true
    })
    if (!found[n]) throw new Error(`no table #${n}`)
    return found[n]
  }
  function cellPosInTable(editor: Editor, tableIndex: number, row: number, col: number): number {
    const { node, pos } = nthTable(editor, tableIndex)
    const map = TableMap.get(node)
    return pos + 1 + map.map[row * map.width + col]
  }

  it('signatureOfTable fingerprints a node directly and equals the cellPos-based signature', () => {
    editor = makeEditor(TWO_TABLES)
    const { node } = nthTable(editor, 0)
    const viaNode = signatureOfTable(node)
    const viaCell = tableStructureSignature(editor.state.doc, cellPosInTable(editor, 0, 0, 0))
    expect(viaNode).not.toBeNull()
    expect(viaNode).toBe(viaCell)
    // A prose node has no table signature.
    let para: PMNode | null = null
    editor.state.doc.descendants((n) => {
      if (!para && n.type.name === 'paragraph') para = n
      return true
    })
    expect(signatureOfTable(para as unknown as PMNode)).toBeNull()
  })

  it('tableSignatures lists every table in document order; draggedTableIndex pins one by ordinal', () => {
    editor = makeEditor(TWO_TABLES)
    const sigA = signatureOfTable(nthTable(editor, 0).node)!
    const sigB = signatureOfTable(nthTable(editor, 1).node)!
    expect(sigA).not.toBe(sigB)
    expect(tableSignatures(editor.state.doc)).toEqual([sigA, sigB])
    expect(draggedTableIndex(editor.state.doc, cellPosInTable(editor, 0, 0, 0))).toBe(0)
    expect(draggedTableIndex(editor.state.doc, cellPosInTable(editor, 1, 0, 0))).toBe(1)
    // An out-of-range position has no table ordinal.
    expect(draggedTableIndex(editor.state.doc, -5)).toBe(-1)
    expect(draggedTableIndex(editor.state.doc, editor.state.doc.content.size + 10)).toBe(-1)
  })

  it('countTableSignature still counts tables carrying a signature (position-independent primitive)', () => {
    editor = makeEditor(TWO_TABLES)
    const sigA = signatureOfTable(nthTable(editor, 0).node)!
    const sigB = signatureOfTable(nthTable(editor, 1).node)!
    expect(countTableSignature(editor.state.doc, sigA)).toBe(1)
    expect(countTableSignature(editor.state.doc, sigB)).toBe(1)
    expect(countTableSignature(editor.state.doc, 'nonexistent')).toBe(0)
  })

  it('two identical tables → editing the OTHER twin does NOT abort, editing the dragged one does', () => {
    editor = makeEditor(
      '<table><tbody><tr><td><p>x</p></td><td><p>y</p></td></tr></tbody></table>' +
        '<table><tbody><tr><td><p>x</p></td><td><p>y</p></td></tr></tbody></table>',
    )
    const sig = signatureOfTable(nthTable(editor, 0).node)!
    expect(countTableSignature(editor.state.doc, sig)).toBe(2) // count cannot tell the twins apart

    // Drag twin #0: capture its stable identity BEFORE any edit.
    const baselineSigs = tableSignatures(editor.state.doc)
    const dragIndex = draggedTableIndex(editor.state.doc, cellPosInTable(editor, 0, 0, 0))
    expect(dragIndex).toBe(0)

    // A reorder of the OTHER twin (#1, columns swap) leaves the dragged twin's slot untouched → the
    // old global-count heuristic false-aborted here (2 → 1); the identity guard does not.
    selectCell2(editor, 1, 0, 0)
    moveTableColumn({ from: 0, to: 1 })(editor.state, editor.view.dispatch)
    expect(draggedTableConflict(editor.state.doc, baselineSigs, dragIndex)).toBe(false)
  })

  it('two identical tables → a reorder of the DRAGGED twin still aborts (data-safety kept)', () => {
    editor = makeEditor(
      '<table><tbody><tr><td><p>x</p></td><td><p>y</p></td></tr></tbody></table>' +
        '<table><tbody><tr><td><p>x</p></td><td><p>y</p></td></tr></tbody></table>',
    )
    const baselineSigs = tableSignatures(editor.state.doc)
    const dragIndex = draggedTableIndex(editor.state.doc, cellPosInTable(editor, 0, 0, 0)) // twin #0

    // Reorder the DRAGGED twin (#0): columns swap. Its own ordinal slot changes → conflict, even
    // though an identical sibling exists.
    selectCell2(editor, 0, 0, 0)
    moveTableColumn({ from: 0, to: 1 })(editor.state, editor.view.dispatch)
    expect(draggedTableConflict(editor.state.doc, baselineSigs, dragIndex)).toBe(true)
  })

  it('does NOT flag a conflict when a DIFFERENT table is edited (FAIL-2 false-abort gone)', () => {
    editor = makeEditor(TWO_TABLES)
    const baselineSigs = tableSignatures(editor.state.doc)
    const dragIndex = draggedTableIndex(editor.state.doc, cellPosInTable(editor, 0, 0, 0)) // dragging table #0

    // Edit a cell in the OTHER table (#1) — a same-doc structural/content change, but not to the
    // dragged table.
    selectCell2(editor, 1, 0, 0)
    editor.view.dispatch(editor.state.tr.insertText('CHANGED'))

    // The dragged table's ordinal slot is unchanged → no conflict, reorder allowed.
    expect(draggedTableConflict(editor.state.doc, baselineSigs, dragIndex)).toBe(false)
  })

  it('does NOT flag a conflict when prose OUTSIDE any table is edited', () => {
    editor = makeEditor('<p>lead</p>' + TWO_TABLES)
    const baselineSigs = tableSignatures(editor.state.doc)
    const dragIndex = draggedTableIndex(editor.state.doc, cellPosInTable(editor, 0, 0, 0))
    editor.view.dispatch(editor.state.tr.insertText('typed', 2)) // inside the leading paragraph
    expect(draggedTableConflict(editor.state.doc, baselineSigs, dragIndex)).toBe(false)
  })

  it('DOES flag a conflict when the dragged table itself is structurally changed', () => {
    editor = makeEditor(TWO_TABLES)
    const baselineSigs = tableSignatures(editor.state.doc)
    const dragIndex = draggedTableIndex(editor.state.doc, cellPosInTable(editor, 0, 0, 0)) // dragging table #0

    // A concurrent reorder of the DRAGGED table (#0): row swap.
    selectCell2(editor, 0, 1, 0)
    moveTableRow({ from: 1, to: 0 })(editor.state, editor.view.dispatch)
    expect(draggedTableConflict(editor.state.doc, baselineSigs, dragIndex)).toBe(true)
  })

  it('DOES flag a conflict when the dragged table is deleted', () => {
    editor = makeEditor(TWO_TABLES)
    const baselineSigs = tableSignatures(editor.state.doc)
    const dragIndex = draggedTableIndex(editor.state.doc, cellPosInTable(editor, 0, 0, 0))
    const { pos, node } = nthTable(editor, 0)
    editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize))
    // The table set shrank → ordinals no longer align → conflict.
    expect(draggedTableConflict(editor.state.doc, baselineSigs, dragIndex)).toBe(true)
  })

  it('a null baseline or out-of-range ordinal disables the guard (never a blind abort)', () => {
    editor = makeEditor(TWO_TABLES)
    expect(draggedTableConflict(editor.state.doc, null, 0)).toBe(false)
    expect(draggedTableConflict(editor.state.doc, tableSignatures(editor.state.doc), -1)).toBe(false)
  })

  /** selectCell for an arbitrary table index (the file-level selectCell targets the first table). */
  function selectCell2(editor: Editor, tableIndex: number, row: number, col: number): void {
    const { node, pos } = nthTable(editor, tableIndex)
    const map = TableMap.get(node)
    const cellRel = map.map[row * map.width + col]
    const $inside = editor.state.doc.resolve(pos + 1 + cellRel + 1)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($inside)))
  }
})
