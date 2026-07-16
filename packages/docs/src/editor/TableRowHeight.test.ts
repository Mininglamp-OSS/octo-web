import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { Table } from '@tiptap/extension-table'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import * as Y from 'yjs'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { TableMap, addRowBefore, deleteRow } from '@tiptap/pm/tables'
import {
  TableRowHeight,
  TableRowResize,
  MIN_ROW_HEIGHT,
  normalizeRowHeight,
  parseRowHeightPx,
  rowIdentity,
  resolveRowByOrdinal,
} from './TableRowHeight.ts'
import { draggedTableConflict, tableSignatures } from './TableReorderHandle.ts'

// SCHEMA_VERSION 19: the tableRow `height` attr + the row-resize drag handle. These assertions
// guard the wire contract (number | null default null; toDOM `style="height:Npx"` when set, bare
// `<tr>` when null; parseDOM reads integer px back), the setNodeMarkup transaction the resize
// commits, and the Yjs collab round-trip (normalized structural equivalence on the decoded attr —
// NOT a raw Y.Doc byte compare). The real pointer-driven drag is verified in a real browser by
// dev/run-rowheight.mjs; jsdom cannot exercise the geometry, so here the drag is represented by the
// exact setNodeMarkup transaction the plugin dispatches on drop.

const TABLE_HTML =
  '<table><tbody>' +
  '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
  '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
  '</tbody></table>'

function makeEditor(html: string = TABLE_HTML): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Table.configure({ resizable: true }),
      TableRowHeight,
      TableHeader,
      TableCell,
      TableRowResize,
    ],
    content: html,
  })
}

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

/** Position (just before) and node of the Nth tableRow in document order. */
function nthRow(e: Editor, n: number): { pos: number; node: PMNode } {
  const rows: { pos: number; node: PMNode }[] = []
  e.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableRow') rows.push({ pos, node })
    return true
  })
  if (!rows[n]) throw new Error(`no tableRow #${n}`)
  return rows[n]
}

describe('normalizeRowHeight', () => {
  it('rounds, floors at MIN_ROW_HEIGHT, and maps empty/invalid to null', () => {
    expect(normalizeRowHeight(40)).toBe(40)
    expect(normalizeRowHeight(40.6)).toBe(41)
    expect(normalizeRowHeight(MIN_ROW_HEIGHT)).toBe(MIN_ROW_HEIGHT)
    // A positive-but-too-small value clamps up to the min rather than vanishing ("防拖没").
    expect(normalizeRowHeight(5)).toBe(MIN_ROW_HEIGHT)
    // null / non-finite / non-positive → null (no explicit height; the default).
    expect(normalizeRowHeight(null)).toBeNull()
    expect(normalizeRowHeight(undefined)).toBeNull()
    expect(normalizeRowHeight(NaN)).toBeNull()
    expect(normalizeRowHeight(0)).toBeNull()
    expect(normalizeRowHeight(-10)).toBeNull()
    // Numeric strings coerce (defensive against stored string attrs).
    expect(normalizeRowHeight('48')).toBe(48)
  })
})

describe('parseRowHeightPx', () => {
  const trWith = (style: string): HTMLElement => {
    const tr = document.createElement('tr')
    tr.setAttribute('style', style)
    return tr
  }
  it('reads an integer px height from an inline style', () => {
    expect(parseRowHeightPx(trWith('height:40px'))).toBe(40)
    expect(parseRowHeightPx(trWith('height: 56px'))).toBe(56)
  })
  it('returns null when there is no height, it is not px, or it is non-positive', () => {
    expect(parseRowHeightPx(trWith(''))).toBeNull()
    expect(parseRowHeightPx(trWith('color:red'))).toBeNull()
    expect(parseRowHeightPx(trWith('height:auto'))).toBeNull()
    expect(parseRowHeightPx(trWith('height:50%'))).toBeNull()
  })
})

describe('tableRow.height HTML round-trip (style="height:Npx" <-> height attr)', () => {
  it('parses an inline row height from HTML into the height attr', () => {
    editor = makeEditor(
      '<table><tbody><tr style="height:64px"><td><p>x</p></td></tr></tbody></table>',
    )
    expect(nthRow(editor, 0).node.attrs.height).toBe(64)
  })

  it('renders a row with a height as <tr style="height:Npx">', () => {
    editor = makeEditor()
    const { pos, node } = nthRow(editor, 0)
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, height: 50 }))
    // The DOM/CSSOM normalizes the style string (`height:50px` → `height: 50px;`); the byte-aligned
    // persisted form is the numeric attr (50) in the Y.Doc, so assert the px value tolerant of spacing.
    expect(editor.getHTML()).toMatch(/<tr style="height:\s*50px;?">/)
  })

  it('renders no height style when the attr is null (backward-compatible with old docs / v18)', () => {
    editor = makeEditor()
    expect(nthRow(editor, 0).node.attrs.height).toBeNull()
    // No row carries a height style — a bare <tr>, identical to pre-v19 output.
    expect(editor.getHTML()).not.toContain('height:')
  })
})

describe('setTableRowHeight command (the transaction the resize commits on drop)', () => {
  it('sets the height attr on the addressed row and is a no-op when unchanged', () => {
    editor = makeEditor()
    const { pos } = nthRow(editor, 0)

    expect(editor.commands.setTableRowHeight(pos, 72)).toBe(true)
    expect(nthRow(editor, 0).node.attrs.height).toBe(72)

    // Re-setting the same normalized value changes nothing → false (clean boundary).
    expect(editor.commands.setTableRowHeight(pos, 72)).toBe(false)

    // Clearing back to null reverts to content-driven height.
    expect(editor.commands.setTableRowHeight(pos, null)).toBe(true)
    expect(nthRow(editor, 0).node.attrs.height).toBeNull()
  })

  it('clamps a below-min drag result up to MIN_ROW_HEIGHT (防拖没)', () => {
    editor = makeEditor()
    const { pos } = nthRow(editor, 0)
    editor.commands.setTableRowHeight(pos, 4)
    expect(nthRow(editor, 0).node.attrs.height).toBe(MIN_ROW_HEIGHT)
  })

  it('only touches the addressed row, leaving sibling rows unchanged', () => {
    editor = makeEditor()
    editor.commands.setTableRowHeight(nthRow(editor, 0).pos, 90)
    expect(nthRow(editor, 0).node.attrs.height).toBe(90)
    expect(nthRow(editor, 1).node.attrs.height).toBeNull()
  })
})

// The collab boundary strips attrs the schema does not know. Two editors bound to the SAME Y.Doc —
// both registering TableRowHeight — must preserve the height attr across the sync, proving it rides
// through the Yjs XmlFragment intact. Normalized structural check on the decoded attr, not a raw
// encodeStateAsUpdate byte compare (which is flaky across clientID / insertion order).
describe('Yjs collaboration round-trip', () => {
  it('preserves the tableRow.height attr from one peer to another via the shared Y.Doc', () => {
    const ydoc = new Y.Doc()
    const mkPeer = () =>
      new Editor({
        extensions: [
          StarterKit.configure({ undoRedo: false }),
          Table.configure({ resizable: true }),
          TableRowHeight,
          TableHeader,
          TableCell,
          Collaboration.configure({ document: ydoc }),
        ],
      })
    const peerA = mkPeer()
    // Seed content through a real transaction so ySync writes it into the Y.Doc before B forks.
    peerA.commands.insertContent(TABLE_HTML)
    const peerB = mkPeer()
    try {
      const { pos } = nthRow(peerA, 0)
      peerA.view.dispatch(
        peerA.state.tr.setNodeMarkup(pos, undefined, { ...peerA.state.doc.nodeAt(pos)!.attrs, height: 88 }),
      )
      // Both peers share one Y.Doc; the ySync observers apply A's change to B synchronously.
      expect(nthRow(peerA, 0).node.attrs.height).toBe(88)
      expect(nthRow(peerB, 0).node.attrs.height).toBe(88)
    } finally {
      peerA.destroy()
      peerB.destroy()
      ydoc.destroy()
    }
  })
})

// #823 RC blocker (this issue): the row-resize drag captures the target row's position at mousedown but
// only commits the height on mouseup. Under real collaboration a remote peer can insert/delete a row (or
// otherwise change the dragged table) DURING the drag — remapping that captured position — so the commit
// must NOT trust the drag-start position or it writes the height to the WRONG row. The fix mirrors
// TableReorderHandle's plan-B guard (#76 / XIN-1225): pin the dragged row by a STABLE IDENTITY (table
// ordinal + row index), snapshot every table's signature at drag start, latch a conflict when the dragged
// table's slot changes mid-drag, and abort the commit instead of writing to a moved row. These tests bind
// two real Y.Docs through the SAME @tiptap/extension-collaboration + y-tiptap binding the app uses,
// exercise the exact exported guard/resolver the plugin's commit path relies on (the drag geometry itself
// is DOM-driven and covered by dev/run-rowheight.mjs), and prove: a concurrent structural edit to the
// dragged table fires the guard (→ abort, never a wrong-row write), while a benign edit elsewhere leaves
// the guard clear and the row re-resolves to exactly the row the user grabbed.
describe('TableRowResize — concurrent-edit position mapping guard (#823 RC)', () => {
  const FIELD = 'default'

  function makeCollabEditor(ydoc: Y.Doc): Editor {
    return new Editor({
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ document: ydoc, field: FIELD }),
        Table.configure({ resizable: true }),
        TableRowHeight,
        TableHeader,
        TableCell,
        TableRowResize,
      ],
    })
  }

  const trackers: Editor[] = []
  afterEach(() => {
    while (trackers.length) trackers.pop()?.destroy()
  })
  function track(...eds: Editor[]): void {
    trackers.push(...eds)
  }

  function forkedPeers(html: string): { docA: Y.Doc; edA: Editor; docB: Y.Doc; edB: Editor; base: Uint8Array } {
    const docA = new Y.Doc()
    const edA = makeCollabEditor(docA)
    edA.commands.insertContent(html)
    const docB = new Y.Doc()
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA))
    const edB = makeCollabEditor(docB)
    return { docA, edA, docB, edB, base: Y.encodeStateVector(docA) }
  }

  function mergeConcurrent(docA: Y.Doc, docB: Y.Doc, base: Uint8Array): void {
    const uA = Y.encodeStateAsUpdate(docA, base)
    const uB = Y.encodeStateAsUpdate(docB, base)
    Y.applyUpdate(docA, uB)
    Y.applyUpdate(docB, uA)
  }

  /** Document position just before the Nth tableRow of the first table (what beginDrag captures). */
  function rowPosOf(editor: Editor, rowIndex: number): number {
    const rows: number[] = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableRow') rows.push(pos)
      return true
    })
    if (rows[rowIndex] === undefined) throw new Error(`no tableRow #${rowIndex}`)
    return rows[rowIndex]
  }

  /** Drop the caret into the (row,col) cell so a structural command resolves the right table. */
  function selectCell(editor: Editor, row: number, col: number): void {
    let table: { node: PMNode; pos: number } | null = null
    editor.state.doc.descendants((node, pos) => {
      if (!table && node.type.name === 'table') {
        table = { node, pos }
        return false
      }
      return true
    })
    if (!table) throw new Error('no table')
    const t: { node: PMNode; pos: number } = table
    const map = TableMap.get(t.node)
    const $inside = editor.state.doc.resolve(t.pos + 1 + map.map[row * map.width + col] + 1)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($inside)))
  }

  const HTML_2ROWS =
    '<table><tbody>' +
    '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
    '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
    '</tbody></table>'

  const HTML_3ROWS =
    '<table><tbody>' +
    '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
    '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
    '<tr><td><p>r3c1</p></td><td><p>r3c2</p></td></tr>' +
    '</tbody></table>'

  const PROSE_PLUS_TABLE = '<p>lead paragraph</p>' + HTML_3ROWS

  it('captures the dragged row by stable identity (table ordinal + row index)', () => {
    const { edA } = forkedPeers(PROSE_PLUS_TABLE)
    track(edA)
    expect(rowIdentity(edA.state.doc, rowPosOf(edA, 0))).toEqual({ ordinal: 0, rowIndex: 0 })
    expect(rowIdentity(edA.state.doc, rowPosOf(edA, 2))).toEqual({ ordinal: 0, rowIndex: 2 })
    // A non-row position resolves to null (guard disabled rather than mis-firing).
    expect(rowIdentity(edA.state.doc, 0)).toBeNull()
  })

  it('no concurrent edit → guard clear, row re-resolves to exactly the dragged row (happy path)', () => {
    const { edA } = forkedPeers(HTML_3ROWS)
    track(edA)
    const identity = rowIdentity(edA.state.doc, rowPosOf(edA, 1))!
    const baselineSigs = tableSignatures(edA.state.doc)
    expect(draggedTableConflict(edA.state.doc, baselineSigs, identity.ordinal)).toBe(false)
    const target = resolveRowByOrdinal(edA.state.doc, identity.ordinal, identity.rowIndex)
    expect(target).not.toBeNull()
    expect(target!.rowPos).toBe(rowPosOf(edA, 1))
    expect(target!.rowNode.textContent).toContain('r2')
  })

  // THE RC SCENARIO. Peer B inserts a row ABOVE the dragged row during the drag. The stale drag-start
  // position now addresses a different row, so the naive commit would write the height to the WRONG row.
  it('concurrent remote insert-row-above → guard fires (abort), blind resolve-by-index would hit the wrong row', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(HTML_2ROWS)
    track(edA, edB)

    // A grabs row 1 (index 0) — exactly what beginDrag captures.
    const identity = rowIdentity(edA.state.doc, rowPosOf(edA, 0))!
    expect(identity).toEqual({ ordinal: 0, rowIndex: 0 })
    const baselineSigs = tableSignatures(edA.state.doc)
    // Sanity: before any concurrent edit, index 0 is the row the user grabbed.
    expect(resolveRowByOrdinal(edA.state.doc, 0, 0)!.rowNode.textContent).toContain('r1')

    // Peer B concurrently inserts a fresh row above row 0 of the SAME table.
    selectCell(edB, 0, 0)
    addRowBefore(edB.state, edB.view.dispatch)
    mergeConcurrent(docA, docB, base)

    // GUARD FIRES: the dragged table's ordinal slot changed → the plugin aborts the commit (data-safe:
    // it never writes the height to a row the collaborator moved out from under the drag).
    expect(draggedTableConflict(edA.state.doc, baselineSigs, identity.ordinal)).toBe(true)

    // WHY the abort matters: after the insert, the captured (ordinal 0, rowIndex 0) now points at the
    // brand-new EMPTY row — NOT 'r1'. A commit that trusted the drag-start index would resize the wrong
    // row. The guard is what prevents that.
    const nowAtCapturedIndex = resolveRowByOrdinal(edA.state.doc, 0, 0)
    expect(nowAtCapturedIndex).not.toBeNull()
    expect(nowAtCapturedIndex!.rowNode.textContent).not.toContain('r1')
  })

  it('concurrent remote delete-row-above → guard fires (abort)', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(HTML_3ROWS)
    track(edA, edB)

    // A grabs row 3 (index 2).
    const identity = rowIdentity(edA.state.doc, rowPosOf(edA, 2))!
    expect(identity).toEqual({ ordinal: 0, rowIndex: 2 })
    const baselineSigs = tableSignatures(edA.state.doc)

    // Peer B deletes row 1 (index 0), above the dragged row.
    selectCell(edB, 0, 0)
    deleteRow(edB.state, edB.view.dispatch)
    mergeConcurrent(docA, docB, base)

    // Row count of the dragged table dropped → slot changed → guard fires → commit aborts.
    expect(draggedTableConflict(edA.state.doc, baselineSigs, identity.ordinal)).toBe(true)
  })

  it('concurrent remote prose edit OUTSIDE the table → guard stays clear, height resolves to the CORRECT row', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(PROSE_PLUS_TABLE)
    track(edA, edB)

    // A grabs row 2 (index 1) of the table.
    const identity = rowIdentity(edA.state.doc, rowPosOf(edA, 1))!
    expect(identity).toEqual({ ordinal: 0, rowIndex: 1 })
    const baselineSigs = tableSignatures(edA.state.doc)

    // Peer B types in the leading paragraph — nothing to do with the dragged table.
    edB.view.dispatch(edB.state.tr.insertText(' typed', 3))
    mergeConcurrent(docA, docB, base)

    // The dragged table is untouched → guard clear → commit proceeds…
    expect(draggedTableConflict(edA.state.doc, baselineSigs, identity.ordinal)).toBe(false)
    // …and the row re-resolves by identity to exactly the row the user grabbed (correct-row write).
    const target = resolveRowByOrdinal(edA.state.doc, identity.ordinal, identity.rowIndex)
    expect(target).not.toBeNull()
    expect(target!.rowNode.textContent).toContain('r2')
    expect(xmlOf(docA)).toBe(xmlOf(docB))
  })

  it('concurrent remote edit of a DIFFERENT table → guard stays clear (no false abort)', () => {
    const TWO_TABLES =
      HTML_2ROWS +
      '<p>between</p>' +
      '<table><tbody><tr><td><p>B1</p></td></tr><tr><td><p>B2</p></td></tr></tbody></table>'
    const { docA, edA, docB, edB, base } = forkedPeers(TWO_TABLES)
    track(edA, edB)

    // A drags a row of the FIRST table (ordinal 0).
    const identity = rowIdentity(edA.state.doc, rowPosOf(edA, 0))!
    expect(identity.ordinal).toBe(0)
    const baselineSigs = tableSignatures(edA.state.doc)

    // Peer B structurally changes the SECOND table (ordinal 1) — insert a row there.
    const rows: number[] = []
    edB.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableRow') rows.push(pos)
      return true
    })
    const $secondTableCell = edB.state.doc.resolve(rows[2] + 2) // inside first row of the 2nd table
    edB.view.dispatch(edB.state.tr.setSelection(TextSelection.near($secondTableCell)))
    addRowBefore(edB.state, edB.view.dispatch)
    mergeConcurrent(docA, docB, base)

    // The dragged table (#0) is untouched → its ordinal slot still matches → no abort.
    expect(draggedTableConflict(edA.state.doc, baselineSigs, identity.ordinal)).toBe(false)
  })
})

const xmlOf = (doc: Y.Doc): string => doc.getXmlFragment('default').toString()
