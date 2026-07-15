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
import { tableStructureSignature, signatureOfTable, countTableSignature, tableSignatures, draggedTableIndex, draggedTableConflict, analyzeDraggedTableConflict, resolveDragSourceByOrdinal, resolveDragSource } from './TableReorderHandle.ts'
import type { Transaction } from '@tiptap/pm/state'

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

/** Absolute document position just before the (row,col) cell — the anchor a drag captures as
 *  `cellPos` at drag start and the plan-B guard fingerprints from. */
function cellPosOf(editor: Editor, row: number, col: number): number {
  const { node, pos } = firstTable(editor)
  const map = TableMap.get(node)
  return pos + 1 + map.map[row * map.width + col]
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

// Plan B (octo-docs-backend#76 / XIN-1187 —老板拍板 B). The guard added to TableReorderHandle
// snapshots the dragged table's structure at drag start and, if a concurrent edit lands on that
// table during the drag, ABORTS the local reorder (shows an i18n toast) instead of committing the
// coarse whole-table replace. These tests reuse the same dual-Y.Doc harness as the baseline above
// and show the guard's two halves: (1) `tableStructureSignature` detects exactly the concurrent
// structural races the characterization test corrupts on, and (2) once the losing peer aborts, only
// the surviving edit lands, so the peers converge to a clean, non-corrupt table — no silent data
// loss. The baseline/characterization tests above are left untouched as the evidence of the hazard.
describe('table reorder — plan B conflict-abort guard eliminates silent corruption (#76)', () => {
  // The exact scenario the characterization test corrupts on: two concurrent reorders of the same
  // table. With the guard, the peer that detects the concurrent reorder aborts its own move, so only
  // ONE whole-table replace is ever committed — the peers converge to a clean reorder, labels intact.
  it('two concurrent reorders → losing peer aborts, peers converge with NO corruption', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(HTML_3x3)
    track(edA, edB)

    // Peer A begins dragging row 2 and snapshots the table (beginDrag → dragBaseline).
    const dragCell = cellPosOf(edA, 2, 0)
    const baseline = tableStructureSignature(edA.state.doc, dragCell)
    expect(baseline).not.toBeNull()

    // Peer B concurrently reorders the SAME table (row 0 → bottom) and commits it.
    selectCell(edB, 0, 0)
    moveTableRow({ from: 0, to: 2 })(edB.state, edB.view.dispatch)

    // B's concurrent edit reaches A (y-prosemirror). A's guard re-fingerprints the dragged table and
    // sees it diverge from the baseline → the drop is aborted, so A commits NOTHING.
    mergeConcurrent(docA, docB, base)
    const afterMerge = tableStructureSignature(edA.state.doc, cellPosOf(edA, 0, 0))
    expect(afterMerge).not.toBe(baseline) // guard fires → A aborts its reorder

    // Because A aborted, only B's single reorder is in the CRDT: peers converge and every original
    // cell label survives verbatim — the char-interleaving corruption is gone.
    expect(xml(docA)).toBe(xml(docB))
    expect(grid(edA)).toEqual(grid(edB))
    const texts = grid(edA).flat()
    for (const cell of [
      'r1c1', 'r1c2', 'r1c3',
      'r2c1', 'r2c2', 'r2c3',
      'r3c1', 'r3c2', 'r3c3',
    ]) {
      expect(texts).toContain(cell)
    }
    // B's reorder landed cleanly: row 0 ("r1") moved to the bottom.
    expect(grid(edA).map((row) => row[0])).toEqual(['r2c1', 'r3c1', 'r1c1'])
  })

  it('reorder ⟂ concurrent remote row insert → guard fires, insert survives, nothing lost', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(HTML_3x2)
    track(edA, edB)

    // Peer A begins dragging row 2 and snapshots the table.
    const dragCell = cellPosOf(edA, 2, 0)
    const baseline = tableStructureSignature(edA.state.doc, dragCell)

    // Peer B concurrently inserts a row above the first row of the SAME table.
    selectCell(edB, 0, 0)
    addRowBefore(edB.state, edB.view.dispatch)

    mergeConcurrent(docA, docB, base)

    // Row count changed → guard fires → A aborts. Only B's insert lands; peers converge with no loss.
    expect(tableStructureSignature(edA.state.doc, cellPosOf(edA, 0, 0))).not.toBe(baseline)
    expect(xml(docA)).toBe(xml(docB))
    expect(grid(edA)).toEqual(grid(edB))
    const texts = grid(edA).flat()
    for (const cell of ['r1c1', 'r2c1', 'r3c1', 'r1c2', 'r2c2', 'r3c2']) {
      expect(texts).toContain(cell)
    }
    // A brand-new empty row was inserted (a blank leading cell), and the original order is intact.
    expect(texts.filter((t) => t === '').length).toBeGreaterThanOrEqual(1)
    expect(grid(edA).map((row) => row[0]).filter((t) => t.startsWith('r'))).toEqual([
      'r1c1',
      'r2c1',
      'r3c1',
    ])
  })

  it('reorder with NO concurrent edit → guard stays clear, reorder proceeds normally', () => {
    const { edA } = forkedPeers(HTML_3x3)
    track(edA)

    // Single-user drag: snapshot, no concurrent transaction arrives, so the fingerprint is unchanged
    // and the reorder is allowed — the guard never blocks the happy path.
    const dragCell = cellPosOf(edA, 2, 0)
    const baseline = tableStructureSignature(edA.state.doc, dragCell)
    expect(tableStructureSignature(edA.state.doc, cellPosOf(edA, 2, 0))).toBe(baseline)

    selectCell(edA, 2, 0)
    moveTableRow({ from: 2, to: 0 })(edA.state, edA.view.dispatch)
    expect(grid(edA).map((row) => row[0])).toEqual(['r3c1', 'r1c1', 'r2c1'])
  })
})

// octo-docs-backend#76 FAIL-2 (XIN-1206 → XIN-1221): the plan-B guard must fire ONLY for a concurrent
// change to the DRAGGED table. Two earlier scopings still false-aborted on edits OUTSIDE that table:
//   (1) re-fingerprinting a single remapped `cellPos` — under real collaboration y-prosemirror applies
//       a remote update as one coarse ReplaceStep, so mapping that interior anchor forward collapses it
//       to the replace boundary; it stops resolving to a cell even when the dragged table is untouched,
//       and the old `signature === null → conflict` branch then FALSE-ABORTED on prose / other-table
//       edits ("editing text outside the table cancels my reorder").
//   (2) counting how many tables still carry the drag-start signature — position-independent, but a
//       document with two byte-identical tables makes the count ambiguous: editing the OTHER identical
//       table drops the global count and the guard false-aborted, though the dragged table never moved.
// The guard now pins the dragged table by a STABLE IDENTITY — its ORDINAL among tables plus the ordered
// signature list (`tableSignatures` / `draggedTableIndex`) — and aborts only when the signature at that
// ordinal changes. These tests drive that decision through the exact dual-Y.Doc merge.
describe('table reorder — plan B guard scope: same-table only (#76 FAIL-2)', () => {
  const TWO_TABLES =
    '<p>lead</p>' +
    '<table><tbody>' +
    '<tr><td><p>A1</p></td><td><p>A2</p></td></tr>' +
    '<tr><td><p>A3</p></td><td><p>A4</p></td></tr>' +
    '</tbody></table>' +
    '<p>between</p>' +
    '<table><tbody>' +
    '<tr><td><p>B1</p></td><td><p>B2</p></td></tr>' +
    '</tbody></table>'

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
  function cellInsideOf(editor: Editor, tableIndex: number, row: number, col: number): number {
    const { node, pos } = nthTable(editor, tableIndex)
    const map = TableMap.get(node)
    return pos + 1 + map.map[row * map.width + col] + 1 // inside the cell
  }

  // Diagnostic: prove the anchor-drift that broke the OLD position-based approach is real in this
  // harness. After a remote edit merges, the dragged cell's remapped position no longer fingerprints
  // the table — so the guard must NOT depend on that position.
  it('remapped cellPos drifts under a coarse remote ReplaceStep (root cause of the false abort)', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(TWO_TABLES)
    track(edA, edB)
    let cellPos = cellPosOf(edA, 0, 0) // dragging table #0
    const baselineSigs = tableSignatures(edA.state.doc)
    const dragIndex = draggedTableIndex(edA.state.doc, cellPos)
    expect(dragIndex).toBe(0)
    expect(baselineSigs[dragIndex]).not.toBeNull()

    const onTr = ({ transaction }: { transaction: { docChanged: boolean; mapping: { map(p: number): number } } }) => {
      if (transaction.docChanged) cellPos = transaction.mapping.map(cellPos)
    }
    edA.on('transaction', onTr)
    // Peer B edits prose OUTSIDE any table.
    edB.view.dispatch(edB.state.tr.insertText('typed', 2))
    mergeConcurrent(docA, docB, base)
    edA.off('transaction', onTr)

    // The remapped anchor's signature is now null (position collapsed) — an approach that trusted it
    // would abort. This is the FAIL-2 false positive we are eliminating.
    expect(tableStructureSignature(edA.state.doc, cellPos)).toBeNull()
    // Identity approach: the dragged table's ordinal slot is unchanged → no conflict.
    expect(draggedTableConflict(edA.state.doc, baselineSigs, dragIndex)).toBe(false)
  })

  it('reorder ⟂ remote edit of a DIFFERENT table → guard stays clear (no false abort)', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(TWO_TABLES)
    track(edA, edB)
    const baselineSigs = tableSignatures(edA.state.doc)
    const dragIndex = draggedTableIndex(edA.state.doc, cellPosOf(edA, 0, 0)) // dragging table #0
    expect(dragIndex).toBe(0)

    // Peer B edits the OTHER table's cell text.
    const insideB = cellInsideOf(edB, 1, 0, 0)
    edB.view.dispatch(edB.state.tr.insertText('CHANGED', insideB))
    mergeConcurrent(docA, docB, base)

    // Dragged table #0 unchanged → its ordinal slot still matches → reorder allowed.
    expect(draggedTableConflict(edA.state.doc, baselineSigs, dragIndex)).toBe(false)
    expect(xml(docA)).toBe(xml(docB))
  })

  it('reorder ⟂ remote edit of prose OUTSIDE any table → guard stays clear', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(TWO_TABLES)
    track(edA, edB)
    const baselineSigs = tableSignatures(edA.state.doc)
    const dragIndex = draggedTableIndex(edA.state.doc, cellPosOf(edA, 0, 0))

    edB.view.dispatch(edB.state.tr.insertText('hello', 2)) // prose before the tables
    mergeConcurrent(docA, docB, base)

    expect(draggedTableConflict(edA.state.doc, baselineSigs, dragIndex)).toBe(false)
    expect(xml(docA)).toBe(xml(docB))
  })

  it('reorder ⟂ remote structural change to the DRAGGED table → guard fires (data-safety kept)', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(TWO_TABLES)
    track(edA, edB)
    const baselineSigs = tableSignatures(edA.state.doc)
    const dragIndex = draggedTableIndex(edA.state.doc, cellPosOf(edA, 0, 0)) // dragging table #0

    // Peer B reorders the SAME table #0 (row swap).
    const { pos } = nthTable(edB, 0)
    const mapB = TableMap.get(nthTable(edB, 0).node)
    const $inB = edB.state.doc.resolve(pos + 1 + mapB.map[1 * mapB.width + 0] + 1)
    edB.view.dispatch(edB.state.tr.setSelection(TextSelection.near($inB)))
    moveTableRow({ from: 1, to: 0 })(edB.state, edB.view.dispatch)
    mergeConcurrent(docA, docB, base)

    // The dragged table's ordinal slot changed → conflict → local reorder aborts.
    expect(draggedTableConflict(edA.state.doc, baselineSigs, dragIndex)).toBe(true)
  })
})

// octo-docs-backend#76 FAIL-2 continuation (XIN-1221): the specific regression the old global-count
// heuristic could not handle. When the document holds two BYTE-IDENTICAL tables, editing the table the
// user is NOT dragging must not cancel the drag — yet counting drag-start signatures dropped the global
// count (2 → 1) and false-aborted. The stable-identity guard distinguishes the twins by ordinal, so an
// edit to the sibling leaves the dragged table's slot untouched, while a change to the dragged twin
// itself still aborts (data-safety guard preserved even against an identical sibling).
describe('table reorder — plan B guard: identical-twin tables (#76 FAIL-2, XIN-1221)', () => {
  // Two tables with byte-identical content — the case the old count heuristic could not disambiguate.
  const TWIN_TABLES =
    '<table><tbody>' +
    '<tr><td><p>x1</p></td></tr>' +
    '<tr><td><p>x2</p></td></tr>' +
    '</tbody></table>' +
    '<p>between</p>' +
    '<table><tbody>' +
    '<tr><td><p>x1</p></td></tr>' +
    '<tr><td><p>x2</p></td></tr>' +
    '</tbody></table>'

  function nthTwin(editor: Editor, n: number): { node: PMNode; pos: number } {
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

  it('twins share one signature — the count heuristic is ambiguous, identity is not', () => {
    const { edA } = forkedPeers(TWIN_TABLES)
    track(edA)
    const s0 = signatureOfTable(nthTwin(edA, 0).node)
    const s1 = signatureOfTable(nthTwin(edA, 1).node)
    expect(s0).toBe(s1) // byte-identical tables → identical signatures
    expect(countTableSignature(edA.state.doc, s0!)).toBe(2) // global count cannot tell them apart
    // Identity: two distinct ordinals carry that same signature.
    expect(tableSignatures(edA.state.doc)).toEqual([s0, s1])
    expect(draggedTableIndex(edA.state.doc, nthTwin(edA, 0).pos + 1)).toBe(0)
    expect(draggedTableIndex(edA.state.doc, nthTwin(edA, 1).pos + 1)).toBe(1)
  })

  it('reorder ⟂ remote edit of the OTHER identical twin → guard stays clear (no false abort)', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(TWIN_TABLES)
    track(edA, edB)
    // A drags twin #0.
    const baselineSigs = tableSignatures(edA.state.doc)
    const dragIndex = draggedTableIndex(edA.state.doc, nthTwin(edA, 0).pos + 1)
    expect(dragIndex).toBe(0)

    // Peer B edits the OTHER twin's (#1) cell text — this dropped the global signature count 2→1 and
    // false-aborted under the old heuristic.
    const t1 = nthTwin(edB, 1)
    const m1 = TableMap.get(t1.node)
    const insideB = t1.pos + 1 + m1.map[0] + 1
    edB.view.dispatch(edB.state.tr.insertText('EDIT', insideB))
    mergeConcurrent(docA, docB, base)

    // Dragged twin #0 is untouched → its ordinal slot still matches → NO abort.
    expect(draggedTableConflict(edA.state.doc, baselineSigs, dragIndex)).toBe(false)
    expect(xml(docA)).toBe(xml(docB))
  })

  it('reorder ⟂ remote structural change to the DRAGGED twin → guard still fires (data-safety kept)', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(TWIN_TABLES)
    track(edA, edB)
    // A drags twin #0.
    const baselineSigs = tableSignatures(edA.state.doc)
    const dragIndex = draggedTableIndex(edA.state.doc, nthTwin(edA, 0).pos + 1)

    // Peer B reorders the SAME twin #0 (swap its two rows) — even though an identical sibling exists,
    // the dragged twin's own slot must change and abort.
    const { pos } = nthTwin(edB, 0)
    const mapB = TableMap.get(nthTwin(edB, 0).node)
    const $inB = edB.state.doc.resolve(pos + 1 + mapB.map[1 * mapB.width + 0] + 1)
    edB.view.dispatch(edB.state.tr.setSelection(TextSelection.near($inB)))
    moveTableRow({ from: 1, to: 0 })(edB.state, edB.view.dispatch)
    mergeConcurrent(docA, docB, base)

    expect(draggedTableConflict(edA.state.doc, baselineSigs, dragIndex)).toBe(true)
  })
})

// octo-docs-backend#76 XIN-1220/1221 — the exact browser-repro scenario, at the unit level: a SINGLE
// table with prose around it, one peer holding a row drag while the other edits body text OUTSIDE the
// table. The guard must stay clear so the reorder completes; only a change to the table itself aborts.
// This is the "表外正文编辑不误触中止" regression pinned so it cannot come back.
describe('table reorder — plan B guard: single table, edits outside must not abort (#76 XIN-1220)', () => {
  const TABLE_WITH_PROSE =
    '<p>heading</p>' +
    '<table><tbody>' +
    '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
    '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
    '<tr><td><p>r3c1</p></td><td><p>r3c2</p></td></tr>' +
    '</tbody></table>' +
    '<p>trailing paragraph</p>'

  // Mirror the runtime beginDrag capture exactly: snapshot the ordered table signatures and the
  // dragged table's ordinal from the drag-start cell position.
  it('remote edit of prose BEFORE the table → guard stays clear, reorder allowed', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(TABLE_WITH_PROSE)
    track(edA, edB)
    const baselineSigs = tableSignatures(edA.state.doc)
    const dragIndex = draggedTableIndex(edA.state.doc, cellPosOf(edA, 2, 0)) // dragging row 3
    expect(dragIndex).toBe(0)

    edB.view.dispatch(edB.state.tr.insertText(' edited', 8)) // inside the leading paragraph
    mergeConcurrent(docA, docB, base)

    expect(draggedTableConflict(edA.state.doc, baselineSigs, dragIndex)).toBe(false)
    expect(xml(docA)).toBe(xml(docB))
  })

  it('remote edit of prose AFTER the table → guard stays clear, reorder allowed', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(TABLE_WITH_PROSE)
    track(edA, edB)
    const baselineSigs = tableSignatures(edA.state.doc)
    const dragIndex = draggedTableIndex(edA.state.doc, cellPosOf(edA, 2, 0))

    edB.view.dispatch(edB.state.tr.insertText('X', edB.state.doc.content.size - 2)) // trailing paragraph
    mergeConcurrent(docA, docB, base)

    expect(draggedTableConflict(edA.state.doc, baselineSigs, dragIndex)).toBe(false)
    expect(xml(docA)).toBe(xml(docB))
  })

  it('remote structural change to the single table → guard still fires (data-safety kept)', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(TABLE_WITH_PROSE)
    track(edA, edB)
    const baselineSigs = tableSignatures(edA.state.doc)
    const dragIndex = draggedTableIndex(edA.state.doc, cellPosOf(edA, 2, 0))

    selectCell(edB, 0, 0)
    addRowBefore(edB.state, edB.view.dispatch) // changes the dragged table's row count
    mergeConcurrent(docA, docB, base)

    expect(draggedTableConflict(edA.state.doc, baselineSigs, dragIndex)).toBe(true)
  })
})

// octo-docs-backend#76 XIN-1225 — the runtime rework. Real-browser instrumentation
// (window.__reorderAbortDebug, dev/run-reorder.mjs) showed WHY the signature-by-ordinal guard kept
// passing these jsdom tests yet TC01 (prose edit outside) / TC02 (identical second table) still failed
// on a real machine: y-tiptap applies a remote edit on the local peer as ONE COARSE ReplaceStep over
// (nearly) the whole document. That (a) makes any "does a step's RANGE overlap the table" test useless
// (the step covers everything) and (b) collapses the remapped drag cell/table anchor, so the DROP
// silently no-op'd even when the guard allowed the reorder — the real "reorder didn't happen" defect.
// These tests drive the two functions that fix it through the REAL transaction y-prosemirror produces
// on the merge (not a hand-built signature): `analyzeDraggedTableConflict` (guard, ordinal-anchored)
// and `resolveDragSourceByOrdinal` (drop, ordinal-anchored).
describe('table reorder — XIN-1225 real coarse-transaction guard + drop anchor (#76)', () => {
  const TABLE_WITH_PROSE =
    '<p>heading</p>' +
    '<table><tbody>' +
    '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
    '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
    '<tr><td><p>r3c1</p></td><td><p>r3c2</p></td></tr>' +
    '</tbody></table>' +
    '<p>trailing paragraph</p>'

  const TWO_TABLES =
    '<table><tbody>' +
    '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
    '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
    '<tr><td><p>r3c1</p></td><td><p>r3c2</p></td></tr>' +
    '</tbody></table>' +
    '<p>between</p>' +
    '<table><tbody>' +
    '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
    '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
    '<tr><td><p>r3c1</p></td><td><p>r3c2</p></td></tr>' +
    '</tbody></table>'

  /** Position just before the nth table in document order. */
  function tablePosByOrdinal(doc: PMNode, ordinal: number): number {
    let seen = 0
    let pos = -1
    doc.descendants((node, p) => {
      if (node.type.name === 'table') {
        if (seen === ordinal) pos = p
        seen++
        return false
      }
      return true
    })
    return pos
  }

  /** Apply peer B's concurrent diff into A and return the REAL doc-changing transactions y-prosemirror
   *  produces on A (the ones the plugin's state.apply guard would see mid-drag). */
  function captureMergeTransactions(edA: Editor, docA: Y.Doc, docB: Y.Doc, base: Uint8Array): Transaction[] {
    const trs: Transaction[] = []
    const on = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) trs.push(transaction)
    }
    edA.on('transaction', on)
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB, base))
    edA.off('transaction', on)
    return trs
  }

  it('TC01: remote prose edit outside → NO transaction flags a conflict (guard stays clear)', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(TABLE_WITH_PROSE)
    track(edA, edB)
    const cellPos = cellPosOf(edA, 2, 0)
    const dragOrdinal = draggedTableIndex(edA.state.doc, cellPos) // table #0
    const baselineSigs = tableSignatures(edA.state.doc)

    edB.view.dispatch(edB.state.tr.insertText(' edited', 8)) // prose inside the leading paragraph
    const trs = captureMergeTransactions(edA, docA, docB, base)

    expect(trs.length).toBeGreaterThan(0)
    for (const tr of trs) {
      const oldPos = tablePosByOrdinal(tr.before, dragOrdinal)
      const decision = analyzeDraggedTableConflict(tr, tr.before, tr.doc, oldPos, dragOrdinal, baselineSigs)
      expect(decision.conflict).toBe(false)
    }
  })

  it('TC02: remote edit of an identical SECOND table → NO transaction flags a conflict', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(TWO_TABLES)
    track(edA, edB)
    const cellPos = cellPosOf(edA, 2, 0)
    const dragOrdinal = draggedTableIndex(edA.state.doc, cellPos) // dragging table #0
    expect(dragOrdinal).toBe(0)
    const baselineSigs = tableSignatures(edA.state.doc)

    // Edit a cell of the SECOND identical table.
    let secondPos = -1
    let seen = 0
    edB.state.doc.descendants((node, p) => {
      if (node.type.name === 'table') {
        if (seen === 1) secondPos = p
        seen++
        return false
      }
      return true
    })
    const m1 = TableMap.get(edB.state.doc.nodeAt(secondPos)!)
    edB.view.dispatch(edB.state.tr.insertText('X', secondPos + 1 + m1.map[0] + 1))
    const trs = captureMergeTransactions(edA, docA, docB, base)

    expect(trs.length).toBeGreaterThan(0)
    for (const tr of trs) {
      const oldPos = tablePosByOrdinal(tr.before, dragOrdinal)
      const decision = analyzeDraggedTableConflict(tr, tr.before, tr.doc, oldPos, dragOrdinal, baselineSigs)
      expect(decision.conflict).toBe(false)
    }
  })

  it('TC03: remote reorder of the SAME dragged table → a transaction flags a conflict (data-safety)', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(TABLE_WITH_PROSE)
    track(edA, edB)
    const cellPos = cellPosOf(edA, 2, 0)
    const dragOrdinal = draggedTableIndex(edA.state.doc, cellPos)
    const baselineSigs = tableSignatures(edA.state.doc)

    selectCell(edB, 0, 0)
    addRowBefore(edB.state, edB.view.dispatch) // structural change to the dragged table
    const trs = captureMergeTransactions(edA, docA, docB, base)

    const anyConflict = trs.some((tr) => {
      const oldPos = tablePosByOrdinal(tr.before, dragOrdinal)
      return analyzeDraggedTableConflict(tr, tr.before, tr.doc, oldPos, dragOrdinal, baselineSigs).conflict
    })
    expect(anyConflict).toBe(true)
  })

  it('drop anchor: after the merge the dragged source resolves by ORDINAL', () => {
    const { docA, edA, docB, edB, base } = forkedPeers(TABLE_WITH_PROSE)
    track(edA, edB)
    let cellPos = cellPosOf(edA, 2, 0) // row 3 of table #0
    const dragOrdinal = draggedTableIndex(edA.state.doc, cellPos)

    // Peer B edits prose outside; remap the drag anchor through the real merge transactions exactly as
    // the plugin used to — this is the coarse ReplaceStep that collapsed the anchor at runtime.
    edB.view.dispatch(edB.state.tr.insertText(' edited', 8))
    const on = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) cellPos = transaction.mapping.map(cellPos)
    }
    edA.on('transaction', on)
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB, base))
    edA.off('transaction', on)

    // The ordinal-anchored resolver still finds the dragged source row (index 2) — this is what makes the
    // drop complete instead of silently no-op'ing on a collapsed anchor.
    const src = resolveDragSourceByOrdinal(edA.state.doc, dragOrdinal, 'row', 2)
    expect(src).not.toBeNull()
    expect(src!.rect.top).toBe(2)
    // The position-based resolver is the fragile path we moved off of (may return null under a coarse
    // ReplaceStep). Referenced only to document the contrast; the drop no longer depends on it.
    void resolveDragSource(edA.state.doc, cellPos)
  })
})
