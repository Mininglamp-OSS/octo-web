// Self-built table row/column reorder handles (octo-docs-backend#76). A ProseMirror
// plugin renders a grab handle at the left edge of the hovered row and the top edge of
// the hovered column; dragging a handle reorders that row/column within the table.
//
// Why NOT reuse BlockDragHandle: that handle moves a whole top-level block via a
// NodeSelection slice through ProseMirror's native drag pipeline. A table row/column is
// not a top-level block — it lives inside the table's TableMap grid — so a slice move
// would tear the table apart. Reordering has to rebuild the grid in one transaction.
//
// Why NOT hand-roll the grid rebuild: prosemirror-tables (bundled with @tiptap/pm 3.22.2)
// already ships `moveTableRow` / `moveTableColumn` — the exact "TableMap-based reorder in a
// single transaction" the issue asks us to build. They:
//   - rebuild the table with a single `tr.replaceWith` (one transaction, content preserved);
//   - expand the moved index range to cover merged cells (colspan/rowspan) via
//     getSelectionRangeInColumn / …InRow, so a merge group moves as a unit and a drop that
//     would split a merge is a safe no-op (the command returns false) rather than corrupting
//     the grid;
//   - restore a CellSelection on the moved row/column afterwards (`select: true`), which is
//     the "selection/decoration recovery after TableMap rebuild" concern — the library
//     re-resolves the selection against the rebuilt map for us.
// So the reorder COMMAND is the library's; this file is only the drag-handle UI + hit-testing
// that drives it. See the PR description for the full feasibility write-up.
//
// Collaboration-safe by design: the move lands as an ordinary editor transaction
// (`tr.replaceWith`), so y-prosemirror syncs it like any other edit — no bespoke collab code.
// The handle + drop-indicator are plugin-managed DOM outside the document (like
// BlockDragHandle), so the mutation observer never sees them as content.
//
// Concurrency guard (octo-docs-backend#76 / XIN-1187 plan B, reworked in XIN-1225). The reorder command
// rebuilds the whole table with a single coarse `tr.replaceWith`. TableReorderConcurrency.test.ts shows
// the real hazard: two whole-table replaces that land concurrently (a remote reorder, or a remote
// add/delete row·column / merge·split racing our drag) DO converge in the CRDT, but y-prosemirror
// re-diffs each replace against the base and interleaves cell text — the peers agree on a GARBLED
// table, i.e. silent data loss. So if a transaction that arrives DURING the drag changes the DRAGGED
// table, we ABORT the reorder instead of committing the replace — a clear i18n toast tells the user to
// retry. Aborting is a pure early return before any dispatch, so there is no half-commit and no dirty
// state; we would rather cancel than silently corrupt.
//
// The guard must react to changes of the DRAGGED table ONLY — an edit to prose or to a different table
// (even an identical twin) must never cancel the reorder. Earlier tries got the SCOPE wrong by keying off
// a remapped cell anchor or a global signature count. XIN-1225 settled it with RUNTIME EVIDENCE rather
// than another source-level guess: instrumenting `window.__reorderAbortDebug` in a real browser (see
// dev/run-reorder.mjs) showed that @tiptap/y-tiptap delivers a remote edit — even a one-character prose
// edit OUTSIDE the table — to the local peer as ONE coarse ReplaceStep spanning (nearly) the whole
// document. That has two consequences the old attempts fell foul of:
//   • a literal "does a step's RANGE overlap the table" test can't discriminate (the step covers
//     everything), and
//   • any ABSOLUTE position (a remapped cell/table anchor) collapses to the replace boundary — which is
//     ALSO why the drop silently no-op'd (resolveDragSource returned null) even when the guard allowed the
//     reorder: that no-op, not only the guard, was the real "TC01/TC02 reorder didn't happen" defect.
// The only identity that survives a whole-document ReplaceStep is the table's ORDINAL among tables in
// document order. So both the guard and the drop are anchored to that ordinal (captured at drag start):
// the guard aborts only when the dragged table's signature AT ITS ORDINAL changes (twin-safe — an
// identical sibling is a different ordinal), and the drop resolves the source row/column by ordinal +
// the drag-start index (valid because any structural change to the dragged table aborts first). See
// `analyzeDraggedTableConflict` and `resolveDragSourceByOrdinal`.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { TableMap, cellAround, moveTableColumn, moveTableRow } from '@tiptap/pm/tables'
import type { Node as PMNode } from '@tiptap/pm/model'
import { t } from '../octoweb/index.ts'

export const tableReorderPluginKey = new PluginKey('octoTableReorder')

// Opt-in runtime tracing for diagnosing the drag wiring (octo-docs-backend#76). The reorder is
// DOM/pointer-driven, so a jsdom unit test cannot exercise the wiring that connects a real drag to
// moveTableRow / moveTableColumn — this hook captures that path in a real browser. It is inert and
// zero-cost unless a page explicitly opts in with `window.__tableReorderDebug = []` before
// dragging, so it is safe to leave in place: each drag phase then pushes a structured record you
// can read back to confirm dragstart / drop / command dispatch actually fired.
interface ReorderDebugEvent {
  phase: 'begin' | 'move' | 'drop' | 'dispatch'
  [key: string]: unknown
}
function reorderDebug(event: ReorderDebugEvent): void {
  if (typeof window === 'undefined') return
  const sink = (window as unknown as { __tableReorderDebug?: ReorderDebugEvent[] }).__tableReorderDebug
  if (Array.isArray(sink)) sink.push(event)
}

// Opt-in runtime tracing for the CONCURRENCY GUARD specifically (octo-docs-backend#76 / XIN-1225). The
// signature-by-ordinal guard kept passing its jsdom unit tests while real-browser TC01 (prose edit
// outside the table) and TC02 (edit of an identical second table) STILL false-aborted the reorder — a
// runtime-only divergence a source read could not settle. This hook records, for every transaction that
// lands during a drag, what the step-range decision actually saw: the dragged table's node range, each
// step's changed range, whether any step fell inside the dragged table, whether that table's structure
// signature changed, and the resulting abort decision + reason. Inert and zero-cost unless a page opts
// in with `window.__reorderAbortDebug = []` before dragging. This is the "instrument, don't infer"
// evidence base the rework was gated on.
interface ReorderAbortDebugEvent {
  tableRange: { from: number; to: number } | null
  steps: { type: string; ranges: [number, number][] }[]
  touched: boolean
  signatureChanged: boolean | null
  conflict: boolean
  reason: string
}
function reorderAbortDebug(event: ReorderAbortDebugEvent): void {
  if (typeof window === 'undefined') return
  const sink = (window as unknown as { __reorderAbortDebug?: ReorderAbortDebugEvent[] }).__reorderAbortDebug
  if (Array.isArray(sink)) sink.push(event)
}

// Thickness (px) of the grab bar that sits in the gutter above a column / left of a row. Kept
// slim so it hugs the table edge and stays clear of the column-resize handle (interior, right
// edge of each cell) and the block drag handle (further out in the left gutter).
const BAR = 14

/** Resolved geometry for the table cell under a screen point. `rect` holds TableMap grid
 * indices ({left,top,right,bottom} as column/row indices), `cellPos` is the document position
 * just before the cell. Returns null when the point is not inside a table cell. */
interface CellContext {
  table: PMNode
  tableStart: number
  tablePos: number
  map: TableMap
  rect: { left: number; top: number; right: number; bottom: number }
  cellPos: number
}

// Resolve the real `<table>` element for a table node position. `view.nodeDOM(tablePos)` returns
// prosemirror-tables' `.tableWrapper` div, whose box INCLUDES the table's `margin: 12px 0` — the
// wrapper is a block-formatting context (`overflow-x: auto`), so the child table's vertical margin
// sits inside it and the wrapper's top edge is ~12px ABOVE the first row. Clamping / caret geometry
// must use the inner table's rect, not the wrapper's, or vertical positions land in that margin gap
// (this is what made column drags a no-op while rows — whose left margin is 0 — worked). Returns
// null when the node view isn't laid out yet.
function tableElementAt(view: EditorView, tablePos: number): HTMLElement | null {
  const dom = view.nodeDOM(tablePos)
  if (!(dom instanceof HTMLElement)) return null
  if (dom.tagName === 'TABLE') return dom
  const inner = dom.querySelector('table')
  return inner instanceof HTMLElement ? inner : dom
}

/** Re-resolve a drag's source cell against a document, by the position just before it.
 *
 * The blocking collab bug (octo-docs-backend#76 review): `beginDrag` captures the source
 * row/column index and cell position as ABSOLUTE values at drag start. On drop, `runMove` used
 * those stale numbers directly — but this is a y-prosemirror collaborative editor, so a remote
 * peer inserting or deleting a row/column ABOVE the dragged one during the drag remaps the
 * document; the stale index then points at a DIFFERENT row/column and the reorder moves the
 * wrong one (a correctness defect, not a crash).
 *
 * The fix has two halves that meet here: (1) the drag's `cellPos` is remapped through every
 * transaction that arrives mid-drag (the plugin `state.apply` below maps it via `tr.mapping`, so
 * it keeps pointing at the SAME cell across concurrent edits), and (2) at drop / hover time we
 * re-derive the live grid index from that remapped position with this helper instead of trusting
 * the drag-start index. Returns null when the source cell no longer resolves (e.g. a collaborator
 * deleted it), which makes the drop a safe no-op rather than a mis-move. */
export function resolveDragSource(
  doc: PMNode,
  cellPos: number,
): { tableStart: number; rect: { left: number; top: number; right: number; bottom: number }; cellPos: number } | null {
  if (cellPos < 0 || cellPos + 1 > doc.content.size) return null
  let $inside
  try {
    $inside = doc.resolve(cellPos + 1)
  } catch {
    return null
  }
  let depth = -1
  for (let d = $inside.depth; d > 0; d--) {
    if ($inside.node(d).type.spec.tableRole === 'table') {
      depth = d
      break
    }
  }
  if (depth < 0) return null
  const table = $inside.node(depth)
  const tableStart = $inside.start(depth)
  const $cell = cellAround($inside)
  if (!$cell) return null
  const map = TableMap.get(table)
  try {
    const rect = map.findCell($cell.pos - tableStart)
    return { tableStart, rect, cellPos: $cell.pos }
  } catch {
    return null
  }
}

/** Fingerprint of a single table NODE. Folds in exactly the things a corrupting concurrent edit
 * would move: the grid dimensions (add/delete row·column), each cell's colspan/rowspan (merge·split)
 * and each cell's text in grid order (a remote reorder reshuffles the text, a concurrent cell edit
 * rewrites it). Returns null when the node isn't a laid-out table. Keyed only off the node's own
 * content, so it is independent of the node's document position — see `countTableSignature`. */
export function signatureOfTable(table: PMNode): string | null {
  if (table.type.spec.tableRole !== 'table') return null
  let map: TableMap
  try {
    map = TableMap.get(table)
  } catch {
    return null
  }
  const parts: string[] = [`${map.height}x${map.width}`]
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      const cell = table.nodeAt(map.map[r * map.width + c])
      if (!cell) {
        parts.push('-')
        continue
      }
      const colspan = (cell.attrs.colspan as number | undefined) ?? 1
      const rowspan = (cell.attrs.rowspan as number | undefined) ?? 1
      parts.push(`${cell.textContent}#${colspan},${rowspan}`)
    }
  }
  return parts.join('|')
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Step-range concurrency detection (octo-docs-backend#76 / XIN-1225 — replaces the signature-by-ordinal
// guard). The rule the acceptance criteria pin down: a concurrent reorder is aborted ONLY when a
// transaction that lands during the drag actually MODIFIES THE DRAGGED TABLE'S OWN NODE RANGE. An edit to
// prose, or to a different table (even a byte-identical twin), never touches that range, so it can never
// abort — that is TC01/TC02 by construction, with no dependence on table ordinals, a global signature
// count, or a remapped cell anchor (all three of which false-aborted before: an ordinal/count is
// ambiguous with twin tables and shifts on any concurrent table add/delete, and a coarse y-tiptap
// ReplaceStep collapses a remapped interior anchor to a boundary). Here we work in the OLD document's
// coordinate space, where the dragged table's range is exactly known, and ask a direct question of the
// transaction's steps.

/** The dragged table node's position range in `doc`. `tablePos` is the position just BEFORE the table
 * node (what `beginDrag` captures and the plugin remaps each transaction). Returns `{ from, to }` with
 * `from` = tablePos and `to` = tablePos + nodeSize (one past the table's closing token), or null when
 * the position no longer resolves to a table node. */
export function tableNodeRange(doc: PMNode, tablePos: number): { from: number; to: number } | null {
  if (tablePos < 0 || tablePos >= doc.content.size) return null
  const node = doc.nodeAt(tablePos)
  if (!node || node.type.spec.tableRole !== 'table') return null
  return { from: tablePos, to: tablePos + node.nodeSize }
}

/** Does any step in `tr` modify content strictly INSIDE the range `[from, to)` of the document BEFORE
 * `tr` was applied? Each step's changed span is read from its own StepMap in that step's coordinate
 * space, and the table range is mapped forward through the PRIOR steps (`tr.mapping.slice(0, i)`) so both
 * are compared in the same space — a transaction can carry several steps. The overlap test is strict
 * interior (`start < to && end > from`), so an edit that merely abuts the table (an insertion exactly at
 * the boundary before/after it — e.g. typing in the paragraph immediately adjacent) does NOT count, only
 * an edit that lands within the table. Also collects each step's ranges + type for the debug hook. */
export function stepsTouchRange(
  tr: Transaction,
  from: number,
  to: number,
): { touched: boolean; steps: { type: string; ranges: [number, number][] }[] } {
  const steps: { type: string; ranges: [number, number][] }[] = []
  let touched = false
  for (let i = 0; i < tr.steps.length; i++) {
    const prior = tr.mapping.slice(0, i)
    const iFrom = prior.map(from, -1)
    const iTo = prior.map(to, 1)
    const ranges: [number, number][] = []
    tr.mapping.maps[i].forEach((s: number, e: number) => {
      ranges.push([s, e])
      if (s < iTo && e > iFrom) touched = true
    })
    steps.push({ type: tr.steps[i].constructor.name, ranges })
  }
  return { touched, steps }
}

/** The concurrency decision for one mid-drag transaction, scoped to the DRAGGED table only.
 *
 * RUNTIME EVIDENCE (octo-docs-backend#76 / XIN-1225, `window.__reorderAbortDebug`): a remote edit —
 * even a one-character prose edit OUTSIDE the table — arrives on the local peer as a single COARSE
 * ReplaceStep spanning (almost) the whole document, because @tiptap/y-tiptap re-renders the changed
 * XmlFragment wholesale. That has two consequences the earlier attempts missed:
 *   • a literal "does a step's RANGE overlap the table" test is useless — the step covers everything,
 *     so it can never separate an inside-table edit from an outside one; and
 *   • any ABSOLUTE position (a remapped cell/table anchor) collapses to the replace boundary, so it
 *     can no longer locate the dragged table.
 * The only identity that survives a whole-document ReplaceStep is the table's ORDINAL among tables in
 * document order (the tree order is preserved). So we decide the conflict by comparing the dragged
 * table's signature AT ITS ORDINAL against the drag-start baseline: an edit to prose or to another
 * table (even an identical twin — a different ordinal) leaves that slot byte-identical and never
 * aborts (TC01/TC02), while a real reorder / add·delete row·column / merge·split / cell edit on the
 * dragged table itself flips its slot and aborts (TC03, data-safety). A change in the table COUNT
 * means the ordinals no longer align, so we abort conservatively (rare concurrent table add/delete).
 *
 * `stepsTouchRange` is still evaluated — it is an exact FAST PATH for the fine-grained case (a local
 * or non-coarse transaction whose steps provably miss the table's range is benign without a full
 * signature scan) and the evidence recorded by the debug hook — but it is never the sole decider,
 * precisely because the observed remote steps are coarse. */
export function analyzeDraggedTableConflict(
  tr: Transaction,
  oldDoc: PMNode,
  newDoc: PMNode,
  oldTablePos: number,
  dragOrdinal: number,
  baselineSigs: (string | null)[],
): ReorderAbortDebugEvent {
  const range = tableNodeRange(oldDoc, oldTablePos)
  const { touched, steps } = range
    ? stepsTouchRange(tr, range.from, range.to)
    : { touched: true, steps: stepsTouchRange(tr, 0, 0).steps }
  // Fast path: a fine-grained transaction whose steps all miss the dragged table's range cannot have
  // changed it. (Remote edits are coarse and take the ordinal path below.)
  if (range && !touched) {
    return { tableRange: range, steps, touched: false, signatureChanged: null, conflict: false, reason: 'no step inside dragged table range — benign (fine-grained outside edit)' }
  }
  // Ordinal path: compare the dragged table's signature at its stable ordinal. Coarse-ReplaceStep-proof.
  const baselineSig = dragOrdinal >= 0 && dragOrdinal < baselineSigs.length ? baselineSigs[dragOrdinal] : null
  if (baselineSig === null) {
    return { tableRange: range, steps, touched, signatureChanged: null, conflict: false, reason: 'no drag-start signature for dragged table — guard disabled' }
  }
  const nowSigs = tableSignatures(newDoc)
  if (nowSigs.length !== baselineSigs.length) {
    return { tableRange: range, steps, touched, signatureChanged: true, conflict: true, reason: 'table count changed mid-drag — ordinals unaligned, abort (data-safe)' }
  }
  const changed = nowSigs[dragOrdinal] !== baselineSig
  return {
    tableRange: range,
    steps,
    touched,
    signatureChanged: changed,
    conflict: changed,
    reason: changed
      ? 'dragged table (by ordinal) changed structure/content — abort (data-safe)'
      : 'dragged table (by ordinal) unchanged — benign (outside/other-table edit)',
  }
}

/** Locate the DRAGGED table by its drag-start ORDINAL among tables in `doc` and resolve the source
 * row/column's live cell position + grid rect. This is the coarse-ReplaceStep-proof replacement for
 * position-remapped source resolution: the whole-document ReplaceStep y-tiptap emits for a remote edit
 * collapses any absolute cell/table anchor, but the table's ordinal is stable, and the source row/column
 * INDEX captured at drag start stays valid because ANY structural change to the dragged table aborts the
 * drag (see the guard) — so if we reach a drop, the dragged table's grid is exactly as it was. Returns
 * null when the ordinal no longer resolves to a table or the source index is out of range. */
export function resolveDragSourceByOrdinal(
  doc: PMNode,
  ordinal: number,
  kind: 'row' | 'col',
  sourceIndex: number,
): { tableStart: number; tablePos: number; rect: { left: number; top: number; right: number; bottom: number }; cellPos: number } | null {
  if (ordinal < 0) return null
  let seen = 0
  let found: { node: PMNode; pos: number } | null = null
  doc.descendants((node, pos) => {
    if (node.type.spec.tableRole === 'table') {
      if (seen === ordinal) found = { node, pos }
      seen++
      return false // tables don't nest
    }
    return true
  })
  if (!found) return null
  const { node, pos } = found
  let map: TableMap
  try {
    map = TableMap.get(node)
  } catch {
    return null
  }
  if (kind === 'row' ? sourceIndex >= map.height : sourceIndex >= map.width) return null
  const row = kind === 'row' ? sourceIndex : 0
  const col = kind === 'col' ? sourceIndex : 0
  const cellRel = map.map[row * map.width + col]
  let rect
  try {
    rect = map.findCell(cellRel)
  } catch {
    return null
  }
  return { tableStart: pos + 1, tablePos: pos, rect, cellPos: pos + 1 + cellRel }
}

/** Fingerprint of the table that contains `cellPos`. Used at drag start to snapshot the dragged
 * table's structure (the plan-B baseline). Returns null when `cellPos` no longer resolves to a
 * table cell. Thin wrapper over `signatureOfTable` that first locates the enclosing table. */
export function tableStructureSignature(doc: PMNode, cellPos: number): string | null {
  if (cellPos < 0 || cellPos + 1 > doc.content.size) return null
  let $inside
  try {
    $inside = doc.resolve(cellPos + 1)
  } catch {
    return null
  }
  let depth = -1
  for (let d = $inside.depth; d > 0; d--) {
    if ($inside.node(d).type.spec.tableRole === 'table') {
      depth = d
      break
    }
  }
  if (depth < 0) return null
  return signatureOfTable($inside.node(depth))
}

/** How many tables in `doc` currently have structure signature `sig`. Kept as a position-independent
 * diagnostic primitive (see TableReorderConcurrency.test.ts): an edit to OTHER tables or prose leaves
 * the count unchanged, while a structural change to the dragged table drops it. The guard itself no
 * longer decides on this global count — a document with two byte-identical tables makes the count
 * ambiguous (editing the twin drops it too) — see `draggedTableConflict` for the identity-based
 * decision that replaced it. */
export function countTableSignature(doc: PMNode, sig: string): number {
  let n = 0
  doc.descendants((node) => {
    if (node.type.spec.tableRole === 'table') {
      if (signatureOfTable(node) === sig) n++
      return false // tables don't nest; don't descend
    }
    return true
  })
  return n
}

/** Ordered signature of EVERY table in `doc`, in document order. This is the position-independent
 * identity basis for the drag guard: the dragged table is pinned by its ORDINAL in this list (see
 * `draggedTableIndex`) plus the signature at that ordinal, never by an absolute position — a coarse
 * remote `ReplaceStep` can move the table freely and the ordinal still selects it. Entries are null
 * for a table that isn't currently laid out (see `signatureOfTable`). */
export function tableSignatures(doc: PMNode): (string | null)[] {
  const sigs: (string | null)[] = []
  doc.descendants((node) => {
    if (node.type.spec.tableRole === 'table') {
      sigs.push(signatureOfTable(node))
      return false // tables don't nest; don't descend
    }
    return true
  })
  return sigs
}

/** Ordinal of the table containing `cellPos` among all tables in document order, or -1 when the
 * position is not inside a table. Captured at drag start as the dragged table's STABLE IDENTITY:
 * combined with `tableSignatures` it lets the guard re-select exactly the dragged table after any
 * transaction, without trusting an absolute position (which a coarse remote ReplaceStep collapses to
 * a boundary). Positions are valid at drag start, so resolving the ordinal here is reliable even
 * though the position itself becomes unusable once concurrent edits land. */
export function draggedTableIndex(doc: PMNode, cellPos: number): number {
  if (cellPos < 0 || cellPos + 1 > doc.content.size) return -1
  let $inside
  try {
    $inside = doc.resolve(cellPos + 1)
  } catch {
    return -1
  }
  let depth = -1
  for (let d = $inside.depth; d > 0; d--) {
    if ($inside.node(d).type.spec.tableRole === 'table') {
      depth = d
      break
    }
  }
  if (depth < 0) return -1
  const tablePos = $inside.before(depth)
  let seen = 0
  let found = -1
  doc.descendants((node, pos) => {
    if (node.type.spec.tableRole === 'table') {
      if (pos === tablePos) found = seen
      seen++
      return false // tables don't nest; don't descend
    }
    return true
  })
  return found
}

/** Plan-B conflict decision, scoped to the DRAGGED table only, by STABLE IDENTITY. `baselineSigs` is
 * the ordered table-signature list captured at drag start (`tableSignatures`) and `dragIndex` the
 * dragged table's ordinal within it (`draggedTableIndex`). A conflict is latched only when the
 * signature at THAT ordinal changes:
 *   - edits to prose, or to any OTHER table (even a byte-identical twin), leave `now[dragIndex]`
 *     equal to the baseline, so they never false-abort (octo-docs-backend#76 FAIL-2);
 *   - a structural or content change to the dragged table itself flips its slot → abort (the data-
 *     safety guard the acceptance criteria require);
 *   - a concurrent whole-table ADD/DELETE changes the table count, so ordinals no longer align and
 *     we cannot prove the dragged table is untouched → abort conservatively (data-safe; this is a
 *     rare concurrent structural edit, and the user is simply asked to retry).
 * A null baseline list, an out-of-range ordinal, or a null baseline signature at that ordinal (drag
 * never fingerprinted a laid-out table) disables the guard rather than aborting blindly. */
export function draggedTableConflict(
  doc: PMNode,
  baselineSigs: (string | null)[] | null,
  dragIndex: number,
): boolean {
  if (baselineSigs === null || dragIndex < 0 || dragIndex >= baselineSigs.length) return false
  if (baselineSigs[dragIndex] === null) return false
  const now = tableSignatures(doc)
  if (now.length !== baselineSigs.length) return true
  return now[dragIndex] !== baselineSigs[dragIndex]
}

/** Transient, document-external toast telling the user their reorder was cancelled because a
 * collaborator changed the same table mid-drag. Lives in <body> (never the Y.Doc), so it cannot
 * desync collab content — mirrors `notifyFileError` in fileUpload.ts. */
function notifyReorderConflict(): void {
  if (typeof document === 'undefined') return
  const el = document.createElement('div')
  el.className = 'octo-table-reorder-error'
  el.setAttribute('role', 'alert')
  el.textContent = t('docs.table.reorderConflict')
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 4000)
}

function cellContextAt(view: EditorView, clientX: number, clientY: number): CellContext | null {
  const found = view.posAtCoords({ left: clientX, top: clientY })
  if (!found) return null
  const $pos = view.state.doc.resolve(found.pos)
  let depth = -1
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.spec.tableRole === 'table') {
      depth = d
      break
    }
  }
  if (depth < 0) return null
  const table = $pos.node(depth)
  const tableStart = $pos.start(depth)
  const tablePos = $pos.before(depth)
  const $cell = cellAround($pos)
  if (!$cell) return null
  const map = TableMap.get(table)
  const rect = map.findCell($cell.pos - tableStart)
  return { table, tableStart, tablePos, map, rect, cellPos: $cell.pos }
}

/** State captured at drag start: which axis, plus enough table/cell identity to (a) confirm a
 * drop lands in the SAME table and (b) place the selection back inside the source before running
 * the move command. `cellPos`, `tableStart` and `tablePos` are POSITIONS, remapped through every
 * transaction that arrives during the drag (see the plugin `state.apply`), so they survive
 * concurrent remote edits. The source row/column INDEX is intentionally NOT stored: it is
 * re-derived from the (remapped) `cellPos` via `resolveDragSource` at hover/drop time, so a
 * collaborator changing the grid above the dragged row/column can never leave us moving a stale
 * index (octo-docs-backend#76 review fix). */
/** State captured at drag start. Identity is anchored to survive the coarse whole-document ReplaceStep
 * that y-tiptap emits for a remote edit (which collapses any absolute position): `ordinal` is the dragged
 * table's index among tables in document order, and `sourceIndex` is the row/column being dragged. Both
 * are position-independent, so the drop still targets the right row/column after a concurrent remote edit
 * — and they stay valid because ANY structural change to the dragged table aborts the drag (the guard),
 * so if we reach a drop the dragged table's grid is exactly as it was at drag start. Source resolution,
 * the probe clamp and the move all re-derive the table's live position from `ordinal` (see
 * `resolveDragSourceByOrdinal`); nothing here stores an absolute position that a ReplaceStep could
 * collapse. */
interface DragState {
  kind: 'row' | 'col'
  ordinal: number
  sourceIndex: number
}

/** Table row/column reorder extension. */
export const TableReorderHandle = Extension.create({
  name: 'tableReorderHandle',

  addProseMirrorPlugins() {
    let rowHandle: HTMLElement | null = null
    let colHandle: HTMLElement | null = null
    let indicator: HTMLElement | null = null
    // Last cell the pointer hovered while idle — the source for a drag that starts on a handle.
    let hover: CellContext | null = null
    // Non-null only while a handle is being dragged.
    let drag: DragState | null = null
    // Resolved drop target row/column index during a drag (null = no valid target yet).
    let dropIndex: number | null = null
    // Concurrency guard (octo-docs-backend#76 / XIN-1225). `concurrentEdit` latches true when a
    // transaction landing during the drag changes the DRAGGED table's own structure/content — a remote
    // reorder / add·delete row·column / merge·split / cell edit on THAT table (see the plugin
    // `state.apply`, which drives the decision through `analyzeDraggedTableConflict`). Runtime evidence
    // (`window.__reorderAbortDebug`) showed remote edits arrive as ONE coarse whole-document ReplaceStep,
    // so the dragged table is pinned by its stable ORDINAL (drag.ordinal) and compared against the
    // drag-start signature list `dragBaselineSigs`; an edit to prose or to another table (even an
    // identical twin, a different ordinal) leaves the dragged slot byte-identical and never latches.
    // When latched, `runMove` aborts the reorder rather than committing a whole-table replace that would
    // silently corrupt against the concurrent edit.
    let concurrentEdit = false
    let dragBaselineSigs: (string | null)[] = []
    // True only while WE dispatch the reorder move itself, so the guard below does not mistake our own
    // whole-table replace for a concurrent remote conflict (the local move lands while `drag` is still
    // set, and it obviously changes the dragged table).
    let committing = false
    // Latches true once we have seen a mid-drag mousemove that actually reports the primary button
    // held (`buttons & 1`). It gates the "released outside the window" abort below: that abort must
    // only fire on a genuine release, i.e. AFTER the button was observed down. Some event sources
    // deliver a drag whose moves never set `buttons` (a synthetic MouseEvent built without it, a raw
    // CDP `Input.dispatchMouseEvent` that omits the field) — those report `buttons === 0` for the
    // whole drag even though a real button is logically down, and treating the first such move as a
    // release wrongly cancelled the reorder (octo-docs-backend#76 / XIN-1215 headed-Chromium repro).
    let pointerHeldSeen = false

    const hideHandles = () => {
      if (rowHandle) rowHandle.style.display = 'none'
      if (colHandle) colHandle.style.display = 'none'
      hover = null
    }
    const hideIndicator = () => {
      if (indicator) indicator.style.display = 'none'
    }

    // Position the resting row/column handles against the hovered cell. Geometry is read live
    // from the DOM each move so the handles track scrolling inside .tableWrapper.
    const placeHandles = (view: EditorView, ctx: CellContext) => {
      if (!rowHandle || !colHandle) return
      const cellDom = view.nodeDOM(ctx.cellPos)
      const tableDom = tableElementAt(view, ctx.tablePos)
      if (!(cellDom instanceof HTMLElement) || !tableDom) {
        hideHandles()
        return
      }
      const base = (view.dom as HTMLElement).getBoundingClientRect()
      const cell = cellDom.getBoundingClientRect()
      const table = tableDom.getBoundingClientRect()

      // Column handle: a bar spanning the hovered column's width, just above the table.
      colHandle.style.display = 'flex'
      colHandle.style.left = `${cell.left - base.left}px`
      colHandle.style.top = `${table.top - base.top - BAR - 2}px`
      colHandle.style.width = `${cell.width}px`
      colHandle.style.height = `${BAR}px`

      // Row handle: a bar spanning the hovered row's height, just left of the table.
      rowHandle.style.display = 'flex'
      rowHandle.style.left = `${table.left - base.left - BAR - 2}px`
      rowHandle.style.top = `${cell.top - base.top}px`
      rowHandle.style.width = `${BAR}px`
      rowHandle.style.height = `${cell.height}px`

      hover = ctx
    }

    // Draw the insertion caret at the boundary a drop would land on. Mirrors the library's
    // move semantics: dragging toward a lower index lands BEFORE the hovered row/column, toward
    // a higher index lands AFTER it. A drop on the source itself shows nothing (it's a no-op).
    const showIndicator = (view: EditorView, ctx: CellContext) => {
      if (!indicator || !drag) return
      // The source row/column index is fixed at drag start (`drag.sourceIndex`) and stays valid: any
      // structural change to the dragged table aborts the drag, so while a drop is still possible the
      // grid is unchanged. This is coarse-ReplaceStep-proof — unlike re-deriving it from a remapped
      // cellPos, which a whole-document remote ReplaceStep collapses (octo-docs-backend#76 XIN-1225).
      const srcIndex = drag.sourceIndex
      const hovered = drag.kind === 'col' ? ctx.rect.left : ctx.rect.top
      if (hovered === srcIndex) {
        dropIndex = null
        hideIndicator()
        return
      }
      const cellDom = view.nodeDOM(ctx.cellPos)
      const tableDom = tableElementAt(view, ctx.tablePos)
      if (!(cellDom instanceof HTMLElement) || !tableDom) return
      const base = (view.dom as HTMLElement).getBoundingClientRect()
      const cell = cellDom.getBoundingClientRect()
      const table = tableDom.getBoundingClientRect()
      const before = hovered < srcIndex

      indicator.style.display = 'block'
      if (drag.kind === 'col') {
        const x = before ? cell.left : cell.right
        indicator.style.left = `${x - base.left - 1}px`
        indicator.style.top = `${table.top - base.top}px`
        indicator.style.width = '2px'
        indicator.style.height = `${table.height}px`
      } else {
        const y = before ? cell.top : cell.bottom
        indicator.style.left = `${table.left - base.left}px`
        indicator.style.top = `${y - base.top - 1}px`
        indicator.style.width = `${table.width}px`
        indicator.style.height = '2px'
      }
      dropIndex = hovered
    }

    // Run the reorder. The move command resolves the target table from the CURRENT selection
    // (getCellsInColumn/…Row read selection.$from), so first drop the caret into a cell of the
    // source row/column — a pure selection change (no doc edit, so y-prosemirror ignores it) —
    // then dispatch the single-transaction move on the updated state.
    const runMove = (view: EditorView) => {
      if (!drag || dropIndex == null) {
        reorderDebug({ phase: 'drop', dispatched: false, reason: 'no valid target', drag, dropIndex })
        return
      }
      // Plan-B guard: a collaborator changed this table during the drag. Abort BEFORE any dispatch
      // (no selection change, no move) so there is zero half-commit, and tell the user to retry —
      // committing the whole-table replace now would silently corrupt against their edit.
      if (concurrentEdit) {
        reorderDebug({ phase: 'drop', dispatched: false, reason: 'concurrent structural edit — aborted' })
        notifyReorderConflict()
        return
      }
      // Re-resolve the source cell against the CURRENT doc by the dragged table's stable ORDINAL plus
      // the drag-start row/column index — NOT a remapped position. Runtime evidence showed remote edits
      // arrive as a coarse whole-document ReplaceStep that collapses any absolute cell/table anchor, so
      // the old `resolveDragSource(remapped cellPos)` returned null and the drop silently no-op'd even
      // when the guard correctly allowed it — the real cause of TC01/TC02 "reorder didn't happen"
      // (octo-docs-backend#76 XIN-1225). The ordinal survives the ReplaceStep; the source index is valid
      // because any structural change to the dragged table would have aborted above.
      const source = resolveDragSourceByOrdinal(view.state.doc, drag.ordinal, drag.kind, drag.sourceIndex)
      if (!source) {
        reorderDebug({ phase: 'drop', dispatched: false, reason: 'source no longer resolves', drag, dropIndex })
        return
      }
      const fromIndex = drag.kind === 'col' ? source.rect.left : source.rect.top
      if (dropIndex === fromIndex) {
        reorderDebug({ phase: 'drop', dispatched: false, reason: 'no-op (same index)', from: fromIndex, dropIndex })
        return
      }
      let $inside
      try {
        $inside = view.state.doc.resolve(source.cellPos + 1)
      } catch {
        return
      }
      view.dispatch(view.state.tr.setSelection(TextSelection.near($inside)))
      const command =
        drag.kind === 'col'
          ? moveTableColumn({ from: fromIndex, to: dropIndex })
          : moveTableRow({ from: fromIndex, to: dropIndex })
      committing = true
      const dispatched = command(view.state, view.dispatch)
      committing = false
      reorderDebug({ phase: 'dispatch', kind: drag.kind, from: fromIndex, to: dropIndex, dispatched })
      view.focus()
    }

    // Tear down every document/window listener a drag installs. Kept in one place so endDrag (a
    // completed drop), cancelDrag (an interrupted drag) and the plugin destroy all detach the SAME
    // set — a listener left attached after the drag ends would keep firing against stale state.
    const removeDragListeners = () => {
      document.removeEventListener('mousemove', onDocMove, true)
      document.removeEventListener('mouseup', onDocUp, true)
      document.removeEventListener('pointercancel', onDocCancel, true)
      document.removeEventListener('keydown', onDocKey, true)
      window.removeEventListener('blur', onWindowBlur)
    }

    // Clear all drag bookkeeping and restore the resting UI. Critically this un-freezes handle
    // placement: the resting-handle mousemove handler early-returns while `drag` is non-null, so
    // leaving `drag` set (or the body class) after a drag ends would strand the grab cursor and stop
    // the handles from ever tracking the pointer again — the "handles unavailable" failure mode.
    const resetDragState = () => {
      drag = null
      dropIndex = null
      concurrentEdit = false
      committing = false
      dragBaselineSigs = []
      pointerHeldSeen = false
      document.body.classList.remove('octo-table-reordering')
      hideIndicator()
      hideHandles()
    }

    const endDrag = (view: EditorView) => {
      removeDragListeners()
      runMove(view)
      resetDragState()
    }

    // Abort an in-flight drag WITHOUT committing a move. Used when the drag is interrupted rather
    // than completed with a real drop — the window loses focus (alt-tab), the OS cancels the pointer
    // (touch/pen), or the user presses Escape. Without this, a missed mouseup leaves `drag` set and
    // the `octo-table-reordering` body class stuck until the next stray mouseup, wedging the reorder
    // UI (stuck grab cursor + frozen handles). Aborting is a pure early return — no dispatch, no doc
    // change — so it can never corrupt content.
    const cancelDrag = () => {
      if (!drag) return
      reorderDebug({ phase: 'drop', dispatched: false, reason: 'drag interrupted — cancelled' })
      removeDragListeners()
      resetDragState()
    }

    // Bound once so add/removeEventListener pair up; `activeView` is set on drag start.
    let activeView: EditorView | null = null
    const onDocMove = (event: MouseEvent) => {
      if (!drag || !activeView) return
      // The primary button was released while we could not see it — the classic "let go outside the
      // window" interruption: the pointer left the window mid-drag, the mouseup fired over another
      // app (so our document `mouseup` listener never ran), and the button is now up as the pointer
      // re-enters. Treat it as an interruption, NOT a drop: abort with zero dispatch. Without this
      // the drag stays armed and the NEXT stray mouseup would wrongly commit the reorder — the
      // "interrupted drag still reordered the table" defect (octo-docs-backend#76 FAIL-1).
      //
      // Gate this on `pointerHeldSeen`: only abort once a mid-drag move has actually reported the
      // button held. A drag whose moves never carry `buttons` (a hand-built MouseEvent, a raw CDP
      // mouse event that omits the field) reports `buttons === 0` throughout even though the button
      // is logically down; without the gate the very first such move cancelled a perfectly good
      // reorder — which is exactly what made the handle look "unusable" under headed-Chromium
      // automation while a real held-button drag (buttons === 1) worked (octo-docs-backend#76 /
      // XIN-1215). A genuine release is always preceded by at least one held move, so the gate keeps
      // FAIL-1 intact.
      if ((event.buttons & 1) !== 0) {
        pointerHeldSeen = true
      } else if (pointerHeldSeen) {
        cancelDrag()
        return
      }
      event.preventDefault()
      // The grab handles sit in the gutter OUTSIDE the table (left of a row, above a column), and
      // a drag naturally travels along that gutter — so the raw pointer point is usually not over
      // any table cell and posAtCoords resolves nothing. Probe the drop target with the pointer
      // clamped into the table's interior instead: for a row drag the pointer's Y still selects the
      // row (X is pulled inside), for a column drag its X still selects the column. Clamp against
      // the real <table> rect (not the wrapper, whose box includes the table's 12px top/bottom
      // margin) — clamping to the wrapper's top lands ~12px above the first row, in the margin gap
      // over no cell, which is why the column axis was a silent no-op (octo-docs-backend#76 rework).
      let probeX = event.clientX
      let probeY = event.clientY
      // Resolve the dragged table's CURRENT position by its stable ordinal (drag.tablePos would be a
      // drag-start position that a coarse remote ReplaceStep has since invalidated — XIN-1225).
      const live = resolveDragSourceByOrdinal(activeView.state.doc, drag.ordinal, drag.kind, drag.sourceIndex)
      const tableDom = live ? tableElementAt(activeView, live.tablePos) : null
      if (tableDom) {
        const t = tableDom.getBoundingClientRect()
        probeX = Math.min(Math.max(probeX, t.left + 1), t.right - 1)
        probeY = Math.min(Math.max(probeY, t.top + 1), t.bottom - 1)
      }
      const ctx = cellContextAt(activeView, probeX, probeY)
      if (!ctx || !live || ctx.tableStart !== live.tableStart) {
        reorderDebug({
          phase: 'move',
          x: event.clientX,
          y: event.clientY,
          probeX,
          probeY,
          resolved: false,
          reason: !ctx ? 'no cell under pointer' : 'different table',
        })
        dropIndex = null
        hideIndicator()
        return
      }
      showIndicator(activeView, ctx)
      reorderDebug({
        phase: 'move',
        x: event.clientX,
        y: event.clientY,
        resolved: true,
        hovered: drag.kind === 'col' ? ctx.rect.left : ctx.rect.top,
        dropIndex,
      })
    }
    const onDocUp = () => {
      if (activeView) endDrag(activeView)
    }
    // Interruption handlers: an interrupted drag must abort cleanly, never commit a move.
    const onDocCancel = () => cancelDrag()
    const onWindowBlur = () => cancelDrag()
    const onDocKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelDrag()
    }

    const beginDrag = (view: EditorView, kind: 'row' | 'col', event: MouseEvent) => {
      // Only a primary (left) button starts a reorder. A right/middle-click on the grab handle must
      // not begin a drag — it would fight the context menu and, with no matching left mouseup, could
      // strand the drag state (octo-docs-backend#76 review).
      if (event.button !== 0) return
      if (!view.editable || !hover) return
      event.preventDefault()
      drag = {
        kind,
        // Stable, coarse-ReplaceStep-proof identity for the dragged table + source line.
        ordinal: draggedTableIndex(view.state.doc, hover.cellPos),
        sourceIndex: kind === 'col' ? hover.rect.left : hover.rect.top,
      }
      // Snapshot every table's signature so the guard can compare the dragged table's slot (by ordinal)
      // against it on each mid-drag transaction. Reset the latch for this fresh drag.
      dragBaselineSigs = tableSignatures(view.state.doc)
      concurrentEdit = false
      pointerHeldSeen = false
      reorderDebug({ phase: 'begin', kind, index: kind === 'col' ? hover.rect.left : hover.rect.top })
      dropIndex = null
      activeView = view
      document.body.classList.add('octo-table-reordering')
      document.addEventListener('mousemove', onDocMove, true)
      document.addEventListener('mouseup', onDocUp, true)
      document.addEventListener('pointercancel', onDocCancel, true)
      document.addEventListener('keydown', onDocKey, true)
      window.addEventListener('blur', onWindowBlur)
    }

    return [
      new Plugin({
        key: tableReorderPluginKey,
        // Detect a concurrent edit to the DRAGGED table on every transaction that lands during the drag
        // — crucially the REMOTE ones y-prosemirror applies for collaborators. The dragged table is
        // pinned by its stable ORDINAL (drag.ordinal), which survives the coarse whole-document
        // ReplaceStep y-tiptap emits for a remote edit; source resolution and the move also key off that
        // ordinal + drag.sourceIndex, so no absolute position needs remapping here (octo-docs-backend#76
        // XIN-1225). This plugin state holds no value of its own; it exists only for the guard side
        // effect on each transaction.
        state: {
          init: () => null,
          apply: (tr, _value, oldState, newState) => {
            if (drag && tr.docChanged && !concurrentEdit && !committing) {
              // Compare the dragged table's signature at its drag-start ordinal against the baseline.
              // An edit to prose or another table (even an identical twin — a different ordinal) leaves
              // that slot byte-identical and never aborts (real-browser TC01/TC02); a reorder / add·
              // delete row·column / merge·split / cell edit on the dragged table itself flips it and
              // aborts (TC03, data-safety). `stepsTouchRange` inside is an exact fast path for the
              // fine-grained case + the `window.__reorderAbortDebug` evidence trail; it needs the
              // dragged table's CURRENT position (by ordinal) in the pre-transaction doc, not a
              // drag-start position a prior coarse ReplaceStep may have invalidated.
              const liveOld = resolveDragSourceByOrdinal(oldState.doc, drag.ordinal, drag.kind, drag.sourceIndex)
              const decision = analyzeDraggedTableConflict(
                tr,
                oldState.doc,
                newState.doc,
                liveOld ? liveOld.tablePos : -1,
                drag.ordinal,
                dragBaselineSigs,
              )
              reorderAbortDebug(decision)
              if (decision.conflict) concurrentEdit = true
            }
            return null
          },
        },
        view(view) {
          const wrapper = view.dom.parentElement
          rowHandle = document.createElement('div')
          rowHandle.className = 'octo-table-reorder octo-table-reorder--row'
          rowHandle.setAttribute('contenteditable', 'false')
          rowHandle.setAttribute('aria-label', 'Drag to reorder row')
          rowHandle.style.display = 'none'
          colHandle = document.createElement('div')
          colHandle.className = 'octo-table-reorder octo-table-reorder--col'
          colHandle.setAttribute('contenteditable', 'false')
          colHandle.setAttribute('aria-label', 'Drag to reorder column')
          colHandle.style.display = 'none'
          indicator = document.createElement('div')
          indicator.className = 'octo-table-reorder-indicator'
          indicator.setAttribute('contenteditable', 'false')
          indicator.style.display = 'none'

          if (wrapper) {
            rowHandle.style.position = 'absolute'
            colHandle.style.position = 'absolute'
            indicator.style.position = 'absolute'
            wrapper.appendChild(rowHandle)
            wrapper.appendChild(colHandle)
            wrapper.appendChild(indicator)
          }

          const onRowDown = (e: MouseEvent) => beginDrag(view, 'row', e)
          const onColDown = (e: MouseEvent) => beginDrag(view, 'col', e)
          rowHandle.addEventListener('mousedown', onRowDown)
          colHandle.addEventListener('mousedown', onColDown)

          return {
            destroy() {
              removeDragListeners()
              document.body.classList.remove('octo-table-reordering')
              rowHandle?.removeEventListener('mousedown', onRowDown)
              colHandle?.removeEventListener('mousedown', onColDown)
              rowHandle?.remove()
              colHandle?.remove()
              indicator?.remove()
              rowHandle = colHandle = indicator = null
              activeView = null
              drag = null
              concurrentEdit = false
              pointerHeldSeen = false
            },
          }
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              // Freeze the resting handles while a drag is in flight (the document-level
              // listeners own the pointer then).
              if (drag) return false
              if (!view.editable) return false
              const ctx = cellContextAt(view, event.clientX, event.clientY)
              if (!ctx) {
                hideHandles()
                return false
              }
              placeHandles(view, ctx)
              return false
            },
            mouseleave(_view, event) {
              if (drag) return false
              // Keep the handles up when the pointer moves onto one of them (they live outside
              // the editor DOM, so leaving the prose region toward a handle must not hide it).
              const to = (event as MouseEvent).relatedTarget as Node | null
              if (to && (rowHandle?.contains(to) || colHandle?.contains(to))) return false
              hideHandles()
              return false
            },
          },
        },
      }),
    ]
  },
})
