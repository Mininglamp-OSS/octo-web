// Concurrent-collaboration convergence baseline for table row/column reorder
// (octo-docs-backend#76, XIN-1174 #12). These tests bind TWO real Y.Docs through the SAME
// binding the app uses at runtime — @tiptap/extension-collaboration over @tiptap/y-tiptap
// (Tiptap's y-prosemirror fork) — seed an identical table on both, apply a reorder on one peer
// and a concurrent edit on the other, exchange only the concurrent diffs, and compare the merged
// Y.Doc XmlFragment on both peers.
//
// WHY: the reorder command (prosemirror-tables moveTableRow/moveTableColumn) rebuilds the whole
// table with a single `tr.replaceWith`. The concern raised in #76 was that this coarse whole-table
// replace would make the CRDT diverge against a concurrent row insert. These tests are the
// evidence base for that question and the regression baseline for whatever fix is chosen.
//
// WHAT THEY SHOW (see the issue analysis comment for the full write-up):
//   * The CRDT layer CONVERGES in every case measured here — both peers reach a byte-identical
//     XmlFragment. Strict Yjs non-convergence from the whole-table replace is NOT reproduced.
//   * The real hazard of the coarse replace is convergent-but-CORRUPT content: two concurrent
//     whole-table replaces (reorder vs reorder) interleave cell text char-by-char, so both peers
//     agree on a garbled table. That is the behaviour a finer-grained fix must eliminate — it is
//     pinned as a characterization test below, not as desired behaviour.

import { describe, it, expect, afterEach } from 'vitest'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { TextSelection } from '@tiptap/pm/state'
import {
  TableMap,
  moveTableRow,
  moveTableColumn,
  addRowBefore,
  tableEditingKey,
} from '@tiptap/pm/tables'
import type { Node as PMNode } from '@tiptap/pm/model'

// Same collab field name the editor wires in production (schema/index.ts COLLAB_FIELD).
const FIELD = 'default'

function makeCollabEditor(ydoc: Y.Doc): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false }), // yUndo owns history under collaboration
      Collaboration.configure({ document: ydoc, field: FIELD }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
  })
}

function firstTable(editor: Editor): { node: PMNode; pos: number } {
  const { doc } = editor.state
  let node: PMNode | null = null
  let pos = -1
  doc.descendants((n, p) => {
    if (!node && n.type.name === 'table') {
      node = n
      pos = p
      return false
    }
    return true
  })
  if (!node) throw new Error('no table')
  return { node, pos }
}

/** Cell text as a `row × col` grid, read from the current TableMap. */
function grid(editor: Editor): string[][] {
  const { node } = firstTable(editor)
  const map = TableMap.get(node)
  const out: string[][] = []
  for (let r = 0; r < map.height; r++) {
    const row: string[] = []
    for (let c = 0; c < map.width; c++) {
      const cell = node.nodeAt(map.map[r * map.width + c])
      row.push(cell ? cell.textContent : '')
    }
    out.push(row)
  }
  return out
}

/** Drop the caret into the (row,col) cell — the move commands resolve the target table from the
 *  selection, exactly as the drop handler does before dispatching. */
function selectCell(editor: Editor, row: number, col: number): void {
  const { node, pos } = firstTable(editor)
  const map = TableMap.get(node)
  const cellRel = map.map[row * map.width + col]
  const $inside = editor.state.doc.resolve(pos + 1 + cellRel + 1)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($inside)))
}

/** Seed peer A with `html`, fork peer B from A's identical Y state, return both peers plus the
 *  shared base state vector (used to extract each peer's concurrent-only diff). */
function forkedPeers(html: string): {
  docA: Y.Doc
  edA: Editor
  docB: Y.Doc
  edB: Editor
  base: Uint8Array
} {
  const docA = new Y.Doc()
  const edA = makeCollabEditor(docA)
  // Seed via a real transaction so ySyncPlugin writes the table into the Y.Doc (passing `content`
  // to the editor while Collaboration is attached does not reliably seed the shared type).
  edA.commands.insertContent(html)
  const docB = new Y.Doc()
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA))
  const edB = makeCollabEditor(docB)
  return { docA, edA, docB, edB, base: Y.encodeStateVector(docA) }
}

/** Exchange only the post-base (concurrent) diffs in both directions — a true concurrent merge. */
function mergeConcurrent(docA: Y.Doc, docB: Y.Doc, base: Uint8Array): void {
  const uA = Y.encodeStateAsUpdate(docA, base)
  const uB = Y.encodeStateAsUpdate(docB, base)
  Y.applyUpdate(docA, uB)
  Y.applyUpdate(docB, uA)
}

const xml = (doc: Y.Doc): string => doc.getXmlFragment(FIELD).toString()

const HTML_3x2 =
  '<table><tbody>' +
  '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
  '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
  '<tr><td><p>r3c1</p></td><td><p>r3c2</p></td></tr>' +
  '</tbody></table>'

const HTML_3x3 =
  '<table><tbody>' +
  '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td><td><p>r1c3</p></td></tr>' +
  '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td><td><p>r2c3</p></td></tr>' +
  '<tr><td><p>r3c1</p></td><td><p>r3c2</p></td><td><p>r3c3</p></td></tr>' +
  '</tbody></table>'

const editors: Editor[] = []
afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
})
function track(...eds: Editor[]): void {
  editors.push(...eds)
}

describe('table reorder — collaborative convergence baseline (#76)', () => {
  it('binds through the runtime table-editing plugin (harness fidelity)', () => {
    const { edA } = forkedPeers(HTML_3x2)
    track(edA)
    // prosemirror-tables registers tableEditingKey ("selectingCells") and runs fixTables in its
    // appendTransaction; its presence confirms we exercise the same repair path as production.
    expect(tableEditingKey.get(edA.state)).toBeTruthy()
  })

  it('two peers start byte-identical after fork', () => {
    const { docA, edA, docB, edB } = forkedPeers(HTML_3x2)
    track(edA, edB)
    expect(xml(docA)).toBe(xml(docB))
    expect(grid(edA)).toEqual(grid(edB))
  })

  // BASELINE INVARIANT — the healthy path the acceptance criteria pin down: a reorder on one peer
  // and a concurrent row insert on the other must converge with no lost content on either side.
  it('row reorder ⟂ concurrent insert-row-above → peers converge, nothing lost', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(HTML_3x2)
    track(edA, edB)

    // Peer A: drag row 2 to the top (whole-table tr.replaceWith).
    selectCell(edA, 2, 0)
    moveTableRow({ from: 2, to: 0 })(edA.state, edA.view.dispatch)
    // Peer B (concurrent): insert a row above the first row.
    selectCell(edB, 0, 0)
    addRowBefore(edB.state, edB.view.dispatch)

    mergeConcurrent(docA, docB, base)

    // CRDT convergence: both peers reach the same Y state.
    expect(xml(docA)).toBe(xml(docB))
    expect(grid(edA)).toEqual(grid(edB))
    // No content loss: the reorder result and the inserted row both survive the merge.
    const merged = grid(edA)
    const texts = merged.flat()
    for (const cell of ['r1c1', 'r2c1', 'r3c1', 'r1c2', 'r2c2', 'r3c2']) {
      expect(texts).toContain(cell)
    }
    // The moved row (r3) sits above the rows that were below it pre-move.
    expect(merged.map((row) => row[0]).filter((t) => t.startsWith('r'))).toEqual([
      'r3c1',
      'r1c1',
      'r2c1',
    ])
    // A brand-new empty row was inserted (one blank leading cell).
    expect(texts.filter((t) => t === '').length).toBeGreaterThanOrEqual(1)
  })

  it('column reorder ⟂ concurrent insert-row-above → peers converge, nothing lost', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(HTML_3x2)
    track(edA, edB)

    selectCell(edA, 0, 1)
    moveTableColumn({ from: 1, to: 0 })(edA.state, edA.view.dispatch)
    selectCell(edB, 0, 0)
    addRowBefore(edB.state, edB.view.dispatch)

    mergeConcurrent(docA, docB, base)

    expect(xml(docA)).toBe(xml(docB))
    expect(grid(edA)).toEqual(grid(edB))
    for (const cell of ['r1c1', 'r2c1', 'r3c1', 'r1c2', 'r2c2', 'r3c2']) {
      expect(grid(edA).flat()).toContain(cell)
    }
  })

  // CHARACTERIZATION — documents the real hazard of the coarse whole-table replace. Two concurrent
  // reorders (each a whole-table tr.replaceWith) DO converge, but y-prosemirror re-diffs each
  // replace against the base and maps cell text to different target cells, so the concurrent
  // character edits interleave and cell content is GARBLED. This is convergent-but-corrupt, and it
  // is the behaviour the chosen fix must eliminate. When a fix lands, tighten this test.
  it('CHARACTERIZATION: two concurrent reorders converge but corrupt cell content', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(HTML_3x3)
    track(edA, edB)

    // Peer A moves row 2 to top; peer B moves row 0 to bottom — both whole-table replaces.
    selectCell(edA, 2, 0)
    moveTableRow({ from: 2, to: 0 })(edA.state, edA.view.dispatch)
    selectCell(edB, 0, 0)
    moveTableRow({ from: 0, to: 2 })(edB.state, edB.view.dispatch)

    mergeConcurrent(docA, docB, base)

    // Still converges (CRDT invariant holds even here)…
    expect(xml(docA)).toBe(xml(docB))
    // …but the content is corrupted: the clean, per-row cell labels no longer survive intact.
    const texts = new Set(grid(edA).flat())
    const anyPristineRowLabel = ['r1c1', 'r2c1', 'r3c1'].some((t) => texts.has(t))
    expect(anyPristineRowLabel).toBe(false) // documents today's garbling; a fix should flip this
  })
})
