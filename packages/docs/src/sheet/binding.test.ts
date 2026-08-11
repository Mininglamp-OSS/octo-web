// Unit tests for the Univer <-> Yjs binding (CRDT correctness, §B2).
//
// The binding is driven entirely through the Univer Facade (getActiveWorkbook /
// getActiveSheet / getRange / onCommandExecuted / setValue / merge / setColumnWidth).
// We back that surface with an in-memory FakeUniver so the tests exercise the REAL
// binding logic (diffing, echo guard, write-gate, shrink-detect) against a REAL Y.Doc —
// only Univer's rendering engine is faked. "Remote" changes arrive the way they do in
// production: a peer's Y.Doc update applied via Y.applyUpdate (transaction.local === false).

import { describe, it, expect, vi } from 'vitest'
import * as Y from 'yjs'
import {
  UniverYjsBinding,
  SHEET_YMAP_FIELD,
  SHEET_DIMS_FIELD,
  SHEET_MERGES_FIELD,
  SHEET_LIST_FIELD,
  SHEET_PROTECTION_FIELD,
} from './binding.ts'

type Cell = { v?: unknown; f?: string; s?: Record<string, unknown> | string } | null

/** Univer's value mutation id — its real setValue triggers this; we mirror that to test echo. */
const SET_RANGE = 'sheet.mutation.set-range-values'

/** A minimal in-memory sheet that mimics the Facade methods the binding calls. */
class FakeSheet {
  readonly cells = new Map<string, Cell>() // key `r:c`
  readonly colWidths = new Map<number, number>()
  readonly rowHeights = new Map<number, number>()
  readonly merges = new Set<string>() // `sr:sc:er:ec`
  /**
   * Univer's shared style pool. Real Univer stores a cell's style BY REFERENCE — `cell.s` is a
   * short id into this pool, and every cell sharing a look shares one id — so a fake that only
   * ever inlines `s` as an object leaves the id-resolution path (binding.ts `resolveStyle`)
   * untested. That is exactly how the select-all hang shipped.
   */
  readonly styles = new Map<string, Record<string, unknown>>()
  /** Facade style resolutions served (NOT memo hits) — the perf guard asserts on this. */
  styleResolveCalls = 0
  /** Per-cell `setValue` calls. The batched remote-apply path must drive this to zero. */
  setValueCalls = 0
  constructor(
    private readonly univer: FakeUniver,
    private readonly id: string = 'local-1',
    private name: string = 'Sheet1',
  ) {}

  getSheetId(): string {
    return this.id
  }
  getSheetName(): string {
    return this.name
  }
  setName(n: string): void {
    this.name = n
  }

  private k(r: number, c: number): string {
    return `${r}:${c}`
  }

  /** Write a cell WITHOUT firing a command (simulates the model updating before the mutation). */
  poke(r: number, c: number, cell: Cell): void {
    if (cell == null || (cell.v == null && cell.f == null && cell.s == null)) this.cells.delete(this.k(r, c))
    else this.cells.set(this.k(r, c), cell)
  }

  getLastRow(): number {
    let m = -1
    for (const [key, cell] of this.cells) {
      if (cell == null) continue
      const r = Number(key.split(':')[0])
      if (r > m) m = r
    }
    return m
  }

  getLastColumn(): number {
    let m = -1
    for (const [key, cell] of this.cells) {
      if (cell == null) continue
      const c = Number(key.split(':')[1])
      if (c > m) m = c
    }
    return m
  }

  getMergeData(): Array<{ getRange: () => { startRow: number; startColumn: number; endRow: number; endColumn: number } }> {
    return [...this.merges].map((key) => {
      const [sr, sc, er, ec] = key.split(':').map(Number)
      return { getRange: () => ({ startRow: sr, startColumn: sc, endRow: er, endColumn: ec }) }
    })
  }

  setColumnWidth(col: number, w: number): void {
    this.colWidths.set(col, w)
  }

  setRowHeight(row: number, h: number): void {
    this.rowHeights.set(row, h)
  }

  getRange(r: number, c: number, rows?: number, cols?: number) {
    const self = this
    return {
      // Block form: getCellDataGrid returns the requested rows×cols window.
      getCellDataGrid(): Cell[][] {
        const grid: Cell[][] = []
        for (let rr = 0; rr < (rows ?? 1); rr++) {
          const row: Cell[] = []
          for (let cc = 0; cc < (cols ?? 1); cc++) row.push(self.cells.get(self.k(r + rr, c + cc)) ?? null)
          grid.push(row)
        }
        return grid
      },
      // Single-cell form. Mirrors real Univer: an `s` that is a style ID must be looked up in the
      // workbook's style pool, which is the call the binding memoizes.
      getCellStyleData(): Record<string, unknown> | null {
        const s = self.cells.get(self.k(r, c))?.s
        if (typeof s === 'string') {
          self.styleResolveCalls++
          return self.styles.get(s) ?? null
        }
        return s ?? null
      },
      setValue(v: Cell): void {
        self.setValueCalls++
        self.poke(r, c, v)
        // Univer's real setValue emits a set-range-values mutation; mirror it so the echo
        // guard (applyingRemote) is actually exercised when the binding writes remote cells.
        self.univer.fire({ id: SET_RANGE })
      },
      merge(): void {
        self.merges.add(`${r}:${c}:${r + (rows ?? 1) - 1}:${c + (cols ?? 1) - 1}`)
        self.univer.fire({ id: 'sheet.mutation.add-worksheet-merge' })
      },
      breakApart(): void {
        self.merges.delete(`${r}:${c}:${r + (rows ?? 1) - 1}:${c + (cols ?? 1) - 1}`)
        self.univer.fire({ id: 'sheet.mutation.remove-worksheet-merge' })
      },
    }
  }
}

class FakeUniver {
  readonly sheets: FakeSheet[]
  private activeId = 'local-1'
  private seq = 1
  /** When true, insertSheet returns null — simulates Univer refusing to create a sheet, which
   * leaves a remote registry entry unmapped locally (the P1-4 delete-guard scenario). */
  blockInsertSheet = false
  /**
   * Workbook unit id. NULL by default, which is what keeps the binding on the per-cell fallback for
   * every pre-existing test: `applyCellsBatched` bails the moment `getId()` is undefined. Set it
   * (see setupBatched) to opt a test into the batched remote-apply path.
   */
  unitId: string | null = null
  /** Every command/mutation dispatched through syncExecuteCommand, in order. */
  readonly mutations: Array<{ id: string; params: unknown }> = []
  /** When true, syncExecuteCommand reports failure so the per-cell retry path can be asserted. */
  failBatch = false
  private readonly handlers = new Set<(cmd: { id: string; params?: unknown }) => void>()
  constructor() {
    this.sheets = [new FakeSheet(this, 'local-1', 'Sheet1')]
  }
  /** The first sheet — kept for back-compat with the single-sheet tests that poke `univer.sheet`. */
  get sheet(): FakeSheet {
    return this.sheets[0]!
  }
  private active(): FakeSheet {
    return this.sheets.find((s) => s.getSheetId() === this.activeId) ?? this.sheets[0]!
  }
  setActive(id: string): void {
    this.activeId = id
  }
  /** Add a sheet the way a user's "+" would (test drives lifecycle by calling this + firing). */
  addSheet(name?: string): FakeSheet {
    this.seq += 1
    const s = new FakeSheet(this, `local-${this.seq}`, name ?? `Sheet${this.seq}`)
    this.sheets.push(s)
    return s
  }
  getActiveWorkbook() {
    const self = this
    return {
      getId: () => self.unitId ?? undefined,
      getActiveSheet: () => self.active(),
      getSheets: () => self.sheets,
      getSheetBySheetId: (id: string) => self.sheets.find((s) => s.getSheetId() === id) ?? null,
      insertSheet: (name?: string) => {
        if (self.blockInsertSheet) return null
        const s = self.addSheet(name)
        // Faithful to real Univer: FWorkbook.insertSheet() issues a SetWorksheetActiveOperation for
        // the sheet it just created ("The new sheet becomes the active sheet"), so anything that
        // materializes sheets — including the remote-driven reconcile — moves the viewer's tab.
        self.setActive(s.getSheetId())
        return s
      },
      setActiveSheet: (sheetOrId: string | FakeSheet) => {
        self.setActive(typeof sheetOrId === 'string' ? sheetOrId : sheetOrId.getSheetId())
      },
      deleteSheet: (sheetOrId: string | FakeSheet) => {
        const id = typeof sheetOrId === 'string' ? sheetOrId : sheetOrId.getSheetId()
        const i = self.sheets.findIndex((s) => s.getSheetId() === id)
        if (i >= 0) self.sheets.splice(i, 1)
      },
      moveSheet: (sheet: FakeSheet, index: number) => {
        const from = self.sheets.findIndex((s) => s.getSheetId() === sheet.getSheetId())
        if (from < 0) return
        const [s] = self.sheets.splice(from, 1)
        const clamped = Math.max(0, Math.min(index, self.sheets.length))
        self.sheets.splice(clamped, 0, s!)
      },
    }
  }
  onCommandExecuted(cb: (cmd: { id: string; params?: unknown }) => void) {
    this.handlers.add(cb)
    return { dispose: () => this.handlers.delete(cb) }
  }
  /**
   * Univer's low-level command bus, used by the binding to write a whole remote batch as ONE
   * `set-range-values` mutation. Mirrors the real handler: walk the SPARSE `{[row]: {[col]: cell}}`
   * matrix and write only the keys present, then dispatch to listeners (a real mutation goes through
   * the same bus `onCommandExecuted` observes, so the applyingRemote guard must hold here too).
   */
  syncExecuteCommand(id: string, params: unknown): boolean {
    this.mutations.push({ id, params })
    if (this.failBatch) return false
    if (id !== SET_RANGE) return true
    const p = params as { subUnitId?: string; cellValue?: Record<string, Record<string, Cell>> }
    const sheet = this.sheets.find((s) => s.getSheetId() === p.subUnitId)
    if (!sheet || !p.cellValue) return false
    for (const [rowStr, row] of Object.entries(p.cellValue)) {
      for (const [colStr, cell] of Object.entries(row)) sheet.poke(Number(rowStr), Number(colStr), cell)
    }
    this.fire({ id })
    return true
  }
  /** Simulate Univer dispatching a command (what a real edit/toolbar action produces). */
  fire(cmd: { id: string; params?: unknown }): void {
    for (const h of [...this.handlers]) h(cmd)
  }
}

/** Wire a binding onto a fresh fake + doc. */
function setup(canWrite = true) {
  const univer = new FakeUniver()
  const doc = new Y.Doc()
  const binding = new UniverYjsBinding(univer as never, doc, () => canWrite)
  const cellMap = doc.getMap(SHEET_YMAP_FIELD)
  const dimMap = doc.getMap(SHEET_DIMS_FIELD)
  const mergeMap = doc.getMap(SHEET_MERGES_FIELD)
  return { univer, doc, binding, cellMap, dimMap, mergeMap }
}

/**
 * Opt a test into the BATCHED remote-apply path: the binding takes it only when the workbook
 * exposes an id and the facade has syncExecuteCommand. `setup()` leaves unitId null, so every other
 * test keeps exercising the per-cell fallback.
 */
function setupBatched(canWrite = true) {
  const univer = new FakeUniver()
  univer.unitId = 'fake-book'
  const doc = new Y.Doc()
  const binding = new UniverYjsBinding(univer as never, doc, () => canWrite)
  return { univer, doc, binding, cellMap: doc.getMap(SHEET_YMAP_FIELD) }
}

/** Push a peer's change into `doc` the way Hocuspocus does: apply a remote (non-local) update. */
function applyRemote(doc: Y.Doc, mutate: (peer: Y.Doc) => void): void {
  const peer = new Y.Doc()
  // Seed the peer with our current state so its update is a clean delta, then mutate.
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
  mutate(peer)
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)))
}

/**
 * Mimic what Univer's `SetStyleCommand` does when the selection is the whole sheet (clicking the
 * top-left select-all corner): write a style into EVERY declared cell. Univer dedups looks, so all
 * of them reference ONE pooled style id — the property the binding's memo relies on.
 */
function fillStyle(
  sheet: FakeSheet,
  rows: number,
  cols: number,
  styleId: string,
  style: Record<string, unknown>,
): void {
  sheet.styles.set(styleId, style)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) sheet.poke(r, c, { s: styleId })
}

describe('UniverYjsBinding — local edit -> Y.Map', () => {
  it('writes a changed cell (value + formula + style) into the shared map', () => {
    const { univer, cellMap } = setup()
    univer.sheet.poke(0, 0, { v: 42, f: '=A2+1', s: { bl: 1 } })
    univer.fire({ id: SET_RANGE })
    expect(cellMap.get('default!0:0')).toEqual({ v: 42, f: '=A2+1', s: { bl: 1 } })
  })

  it('only writes cells that actually changed (diff, not full rewrite)', () => {
    const { univer, cellMap } = setup()
    univer.sheet.poke(0, 0, { v: 'a' })
    univer.fire({ id: SET_RANGE })
    const observer = vi.fn()
    cellMap.observe(observer)
    // Fire again with no change — the diff finds nothing, so no transaction touches the map.
    univer.fire({ id: SET_RANGE })
    expect(observer).not.toHaveBeenCalled()
    // Change a different cell — only that key is written.
    univer.sheet.poke(1, 1, { v: 'b' })
    univer.fire({ id: SET_RANGE })
    expect(cellMap.get('default!1:1')).toEqual({ v: 'b' })
  })

  it('emits a delete when a cell is cleared and the used range shrinks (shrink-detect)', () => {
    const { univer, cellMap } = setup()
    univer.sheet.poke(0, 0, { v: 'keep' })
    univer.sheet.poke(2, 0, { v: 'gone' })
    univer.fire({ id: SET_RANGE })
    expect(cellMap.get('default!2:0')).toEqual({ v: 'gone' })
    // Clear the last content cell: getLastRow contracts, so 2:0 no longer appears in the grid.
    univer.sheet.poke(2, 0, null)
    univer.fire({ id: SET_RANGE })
    expect(cellMap.has('default!2:0')).toBe(false)
    expect(cellMap.get('default!0:0')).toEqual({ v: 'keep' }) // survivor untouched
  })
})

describe('UniverYjsBinding — style-id resolution (select-all must not hang)', () => {
  const RED = { bg: { rgb: '#ff0000' }, ht: 2 }

  it('resolves a pooled style id into the style object before replicating it', () => {
    const { univer, cellMap } = setup()
    univer.sheet.styles.set('st-red', RED)
    univer.sheet.poke(0, 0, { v: 'hi', s: 'st-red' })
    univer.fire({ id: SET_RANGE })
    // The id is LOCAL to this client's style pool, so the resolved object must go on the wire.
    expect(cellMap.get('default!0:0')).toEqual({ v: 'hi', s: RED })
  })

  it('resolves each distinct style id once, no matter how many cells share it', () => {
    // 200x50 = 10k cells, the shape of a select-all + "set background" on a real sheet (1000x100).
    // Before the memo this cost one getRange() + one CELL_CONTENT interceptor walk PER CELL, which
    // is what hung the tab; the whole sheet shares ONE pooled style, so one resolution is correct.
    const { univer, cellMap } = setup()
    fillStyle(univer.sheet, 200, 50, 'st-red', RED)
    univer.fire({ id: SET_RANGE })
    expect(univer.sheet.styleResolveCalls).toBe(1)
    // …and every cell still replicated, with the style resolved — the memo is a speedup, not a skip.
    expect(cellMap.size).toBe(200 * 50)
    expect(cellMap.get('default!0:0')).toEqual({ s: RED })
    expect(cellMap.get('default!199:49')).toEqual({ s: RED })
  })

  it('does not let the memo bleed one style id into another', () => {
    const { univer, cellMap } = setup()
    const BLUE = { bg: { rgb: '#0000ff' } }
    univer.sheet.styles.set('st-red', RED)
    univer.sheet.styles.set('st-blue', BLUE)
    univer.sheet.poke(0, 0, { s: 'st-red' })
    univer.sheet.poke(0, 1, { s: 'st-blue' })
    univer.sheet.poke(1, 0, { s: 'st-red' })
    univer.sheet.poke(1, 1, { s: 'st-blue' })
    univer.fire({ id: SET_RANGE })
    expect(univer.sheet.styleResolveCalls).toBe(2) // one per DISTINCT id, not one per cell
    expect(cellMap.get('default!0:0')).toEqual({ s: RED })
    expect(cellMap.get('default!0:1')).toEqual({ s: BLUE })
    expect(cellMap.get('default!1:0')).toEqual({ s: RED })
    expect(cellMap.get('default!1:1')).toEqual({ s: BLUE })
  })

  it('replicates a style-only change (same value, new style id)', () => {
    const { univer, cellMap } = setup()
    const BOLD = { bl: 1 }
    univer.sheet.styles.set('st-red', RED)
    univer.sheet.styles.set('st-bold', BOLD)
    univer.sheet.poke(0, 0, { v: 1, s: 'st-red' })
    univer.fire({ id: SET_RANGE })
    expect(cellMap.get('default!0:0')).toEqual({ v: 1, s: RED })
    // Only the style changes — the diff must still see it (stylesEqual compares the resolved
    // objects, so a re-pointed id has to survive as a real change).
    univer.sheet.poke(0, 0, { v: 1, s: 'st-bold' })
    univer.fire({ id: SET_RANGE })
    expect(cellMap.get('default!0:0')).toEqual({ v: 1, s: BOLD })
  })

  it('drops an unresolvable style id instead of replicating the raw id', () => {
    const { univer, cellMap } = setup()
    // A dangling id (pool entry missing) must not leak the local id onto the wire, where a peer
    // would resolve it against ITS pool and render an unrelated style.
    univer.sheet.poke(0, 0, { v: 'x', s: 'st-gone' })
    univer.fire({ id: SET_RANGE })
    expect(cellMap.get('default!0:0')).toEqual({ v: 'x' })
  })
})

describe('UniverYjsBinding — remote -> Univer', () => {
  it('applies a remote cell into the active sheet', () => {
    const { univer, doc } = setup()
    applyRemote(doc, (peer) => peer.getMap(SHEET_YMAP_FIELD).set('default!3:4', { v: 'remote' }))
    expect(univer.sheet.cells.get('3:4')).toEqual({ v: 'remote' })
  })

  it('does NOT echo a remote change back into the Y.Map (applyingRemote guard)', () => {
    const { univer, doc, cellMap } = setup()
    // Remote apply calls sheet.setValue, whose fake fires set-range-values — the same trigger
    // a local edit uses. Without the guard the binding would re-diff and re-write the cell,
    // producing a spurious LOCAL transaction (and, cross-client, an update storm).
    const localTxns = vi.fn()
    doc.on('afterTransaction', (txn: Y.Transaction) => {
      if (txn.local && txn.changed.size > 0) localTxns(txn)
    })
    applyRemote(doc, (peer) => peer.getMap(SHEET_YMAP_FIELD).set('default!0:0', { v: 'x' }))
    expect(univer.sheet.cells.get('0:0')).toEqual({ v: 'x' })
    expect(localTxns).not.toHaveBeenCalled()
    expect(cellMap.get('default!0:0')).toEqual({ v: 'x' }) // still exactly the remote value
  })

  it('clears a cell when a remote peer deletes its key', () => {
    const { univer, doc } = setup()
    applyRemote(doc, (peer) => peer.getMap(SHEET_YMAP_FIELD).set('default!1:1', { v: 'v' }))
    expect(univer.sheet.cells.get('1:1')).toEqual({ v: 'v' })
    applyRemote(doc, (peer) => peer.getMap(SHEET_YMAP_FIELD).delete('default!1:1'))
    // setValue({ v: null }) → poke clears the cell.
    expect(univer.sheet.cells.has('1:1')).toBe(false)
  })
})

describe('UniverYjsBinding — batched remote apply (the select-all hang)', () => {
  it('writes a whole remote batch with ONE mutation instead of a command per cell', () => {
    const { univer, doc } = setupBatched()
    applyRemote(doc, (peer) => {
      const m = peer.getMap(SHEET_YMAP_FIELD)
      m.set('default!0:0', { v: 'a' })
      m.set('default!0:1', { v: 'b' })
      m.set('default!5:9', { v: 'c' })
    })
    expect(univer.mutations.filter((m) => m.id === SET_RANGE)).toHaveLength(1)
    expect(univer.sheet.setValueCalls).toBe(0)
    expect(univer.sheet.cells.get('0:0')).toEqual({ v: 'a' })
    expect(univer.sheet.cells.get('0:1')).toEqual({ v: 'b' })
    expect(univer.sheet.cells.get('5:9')).toEqual({ v: 'c' })
  })

  it('sends the batch as a SPARSE matrix (no dense fill of the bounding box)', () => {
    const { univer, doc } = setupBatched()
    applyRemote(doc, (peer) => {
      const m = peer.getMap(SHEET_YMAP_FIELD)
      m.set('default!0:0', { v: 'tl' })
      m.set('default!9:9', { v: 'br' })
    })
    const params = univer.mutations.find((m) => m.id === SET_RANGE)?.params as {
      unitId: string
      subUnitId: string
      cellValue: Record<string, Record<string, unknown>>
    }
    expect(params.unitId).toBe('fake-book')
    expect(params.subUnitId).toBe('local-1')
    // Two opposite corners of a 10×10 box = 2 row entries, not 100 cells.
    expect(Object.keys(params.cellValue)).toEqual(['0', '9'])
    expect(params.cellValue['0']).toEqual({ 0: { v: 'tl' } })
    expect(params.cellValue['9']).toEqual({ 9: { v: 'br' } })
  })

  it('keeps a full-sheet style change at one mutation (the 100k-command regression)', () => {
    // Select-all + set style writes one key per DECLARED cell — 100k in production (1000×100).
    // Reproduce the SHAPE at a size a unit test can hold: the whole batch must still cost ONE
    // dispatch. Before this fix each key was its own SetRangeValuesCommand, on every open.
    const { univer, doc } = setupBatched()
    const ROWS = 100
    const COLS = 20
    applyRemote(doc, (peer) => {
      const m = peer.getMap(SHEET_YMAP_FIELD)
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) m.set(`default!${r}:${c}`, { s: { bg: { rgb: '#ff0000' } } })
      }
    })
    expect(univer.mutations.filter((m) => m.id === SET_RANGE)).toHaveLength(1)
    expect(univer.sheet.setValueCalls).toBe(0)
    expect(univer.sheet.cells.size).toBe(ROWS * COLS)
  })

  it('does not echo a batched apply back into the Y.Map', () => {
    const { univer, doc, cellMap } = setupBatched()
    const localTxns = vi.fn()
    doc.on('afterTransaction', (txn: Y.Transaction) => {
      if (txn.local && txn.changed.size > 0) localTxns(txn)
    })
    // The fake dispatches the mutation through the same bus onCommandExecuted observes, exactly as
    // real Univer does — so applyingRemote has to hold on this path too.
    applyRemote(doc, (peer) => peer.getMap(SHEET_YMAP_FIELD).set('default!0:0', { v: 'x' }))
    expect(univer.sheet.cells.get('0:0')).toEqual({ v: 'x' })
    expect(localTxns).not.toHaveBeenCalled()
    expect(cellMap.get('default!0:0')).toEqual({ v: 'x' })
  })

  it('clears a cell through the batch when a peer deletes its key', () => {
    const { univer, doc } = setupBatched()
    applyRemote(doc, (peer) => peer.getMap(SHEET_YMAP_FIELD).set('default!1:1', { v: 'v' }))
    expect(univer.sheet.cells.get('1:1')).toEqual({ v: 'v' })
    applyRemote(doc, (peer) => peer.getMap(SHEET_YMAP_FIELD).delete('default!1:1'))
    expect(univer.sheet.cells.has('1:1')).toBe(false)
  })

  it('retries per cell when the batch mutation reports failure', () => {
    const { univer, doc } = setupBatched()
    univer.failBatch = true
    applyRemote(doc, (peer) => {
      const m = peer.getMap(SHEET_YMAP_FIELD)
      m.set('default!0:0', { v: 'a' })
      m.set('default!1:0', { v: 'b' })
    })
    // The batch was attempted and refused, so both cells still land — via the facade.
    expect(univer.mutations.filter((m) => m.id === SET_RANGE)).toHaveLength(1)
    expect(univer.sheet.setValueCalls).toBe(2)
    expect(univer.sheet.cells.get('0:0')).toEqual({ v: 'a' })
    expect(univer.sheet.cells.get('1:0')).toEqual({ v: 'b' })
  })

  it('falls back to per-cell writes when the workbook exposes no id', () => {
    // setup() leaves unitId null — the config every other test runs under. Assert it explicitly so
    // batching can never silently become mandatory.
    const { univer, doc } = setup()
    applyRemote(doc, (peer) => peer.getMap(SHEET_YMAP_FIELD).set('default!2:2', { v: 'z' }))
    expect(univer.mutations.filter((m) => m.id === SET_RANGE)).toHaveLength(0)
    expect(univer.sheet.setValueCalls).toBe(1)
    expect(univer.sheet.cells.get('2:2')).toEqual({ v: 'z' })
  })

  it('records lastSeen for batched cells so the next local diff is a no-op', () => {
    const { univer, doc, cellMap } = setupBatched()
    applyRemote(doc, (peer) => peer.getMap(SHEET_YMAP_FIELD).set('default!0:0', { v: 'remote' }))
    const observer = vi.fn()
    cellMap.observe(observer)
    // Without lastSeen bookkeeping on the batched path, the next trigger would "rediscover" the
    // peer's cell as a local edit and write it straight back.
    univer.fire({ id: SET_RANGE })
    expect(observer).not.toHaveBeenCalled()
  })
})

describe('UniverYjsBinding — V1 legacy compat (pre-populated Y.Doc, no sheetList)', () => {
  // A V1 single-sheet doc has populated `default!r:c` cells (and possibly dims/merges)
  // but NO sheetList registry. Constructing a binding over such a doc MUST render the
  // existing content into the fresh Univer book — not treat it as brand-new and blank it.
  // Regression guard for Jerry-Xin's "V1 docs open blank" blocker (#559).

  /** Build a doc that already holds V1 content, THEN construct the binding over it. */
  function setupWithLegacyDoc(canWrite = true) {
    const doc = new Y.Doc()
    // Pre-seed like a REAL V1 writer did: flat `default!r:c` cells + an UNPREFIXED dim + an
    // UNPREFIXED merge (V1 wrote `c1` / `0:0:1:2`, NOT the V2 `default:`-prefixed shape). Using
    // the true legacy shape here is what catches P1-A — the earlier fixtures used the V2 prefixed
    // shape, so the compat suite stayed green while real legacy docs silently dropped dims/merges.
    doc.getMap(SHEET_YMAP_FIELD).set('default!0:0', { v: 'legacy-A1' })
    doc.getMap(SHEET_YMAP_FIELD).set('default!2:3', { v: 'legacy-C3' })
    doc.getMap(SHEET_DIMS_FIELD).set('c1', 120) // V1 format — no logical-id prefix
    doc.getMap(SHEET_MERGES_FIELD).set('1:1:2:2', true) // V1 format — 4 parts, no prefix
    const univer = new FakeUniver()
    const binding = new UniverYjsBinding(univer as never, doc, () => canWrite)
    return { univer, doc, binding }
  }

  it('renders pre-existing V1 cells into the sheet on construction (writer)', () => {
    const { univer } = setupWithLegacyDoc(true)
    expect(univer.sheet.cells.get('0:0')).toEqual({ v: 'legacy-A1' })
    expect(univer.sheet.cells.get('2:3')).toEqual({ v: 'legacy-C3' })
  })

  it('renders pre-existing V1 dims and merges into the sheet on construction', () => {
    const { univer } = setupWithLegacyDoc(true)
    expect(univer.sheet.colWidths.get(1)).toBe(120)
    expect(univer.sheet.merges.has('1:1:2:2')).toBe(true)
  })

  it('registers the legacy sheet into sheetList for writers (joins multi-sheet lifecycle)', () => {
    const { doc } = setupWithLegacyDoc(true)
    // Writer should have back-filled the registry so the doc now participates in V2 sync.
    expect(doc.getMap(SHEET_LIST_FIELD).size).toBe(1)
    expect(doc.getMap(SHEET_LIST_FIELD).has('default')).toBe(true)
  })

  it('renders V1 content for a READER without authoring sheetList', () => {
    const { univer, doc } = setupWithLegacyDoc(false)
    expect(univer.sheet.cells.get('0:0')).toEqual({ v: 'legacy-A1' })
    // A reader must not write the registry (write-gate stays honored).
    expect(doc.getMap(SHEET_LIST_FIELD).size).toBe(0)
  })
})

describe('UniverYjsBinding — deferred initial sync (P1-B: pre-sync seed must not clobber a rename)', () => {
  // IndexedDB replays asynchronously while the binding is constructed synchronously. A writer
  // reopening an EXISTING (possibly renamed) sheet on a cold cache would, under eager seeding,
  // see an empty Y.Doc, take the "brand-new" branch, and author sheetList.default={name:'Sheet1'}
  // — an LWW-losing concurrent write that reverts the persisted rename. Deferring the seed until
  // after the persisted state has been applied fixes it.

  it('does NOT re-seed sheetList when the persisted state (renamed first sheet) arrives after construction', () => {
    // A prior session persisted a renamed first sheet.
    const persisted = new Y.Doc()
    persisted.getMap(SHEET_LIST_FIELD).set('default', { name: 'Budget', order: 0 })
    persisted.getMap(SHEET_YMAP_FIELD).set('default!0:0', { v: 'kept' })

    // New session: doc still empty at construction time (IndexedDB not replayed yet).
    const univer = new FakeUniver()
    const doc = new Y.Doc()
    const binding = new UniverYjsBinding(univer as never, doc, () => true, { deferInitialSync: true })

    // Nothing authored yet — the seed is deferred.
    expect(doc.getMap(SHEET_LIST_FIELD).size).toBe(0)

    // IndexedDB replays: the persisted (renamed) registry lands via a non-local update.
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(persisted))
    // Host signals sync settled -> run the deferred seed decision against the now-populated doc.
    binding.initialSync()

    // The doc is no longer empty, so we take the JOIN path, not the brand-new seed path:
    // the rename survives and no stray Sheet1 write reverted it.
    expect(doc.getMap(SHEET_LIST_FIELD).get('default')).toEqual({ name: 'Budget', order: 0 })
    expect(univer.sheet.cells.get('0:0')).toEqual({ v: 'kept' })
  })

  // [P1-1] The cold-cache race the "seal on either signal" change did NOT close: y-indexeddb's
  // whenSynced is a LOCAL signal that resolves near-instantly on an EMPTY cache with all Y.Maps
  // still empty. If that local-only signal is allowed to author the registry, a writer opening an
  // EXISTING (renamed) doc seeds sheetList.default={name:'Sheet1'} BEFORE the network delivers the
  // persisted rename, and LWW reverts it. The fix gates the brand-new-author branch on the NETWORK
  // being synced: initialSync(false) (local-only) must NOT author and must NOT mark itself done, so
  // the later network-synced call authors against the settled doc (or takes the join path).
  it('does NOT author on a local-only (whenSynced) signal — cold cache must wait for the network', () => {
    // Persisted-elsewhere renamed registry that will arrive over the network AFTER the local wake.
    const persisted = new Y.Doc()
    persisted.getMap(SHEET_LIST_FIELD).set('default', { name: 'Renamed', order: 0 })
    persisted.getMap(SHEET_YMAP_FIELD).set('default!0:0', { v: 'remote' })

    const univer = new FakeUniver()
    const doc = new Y.Doc()
    const binding = new UniverYjsBinding(univer as never, doc, () => true, { deferInitialSync: true })
    expect(doc.getMap(SHEET_LIST_FIELD).size).toBe(0)

    // Cold-cache LOCAL signal fires first (empty IndexedDB) — network NOT synced yet.
    binding.initialSync(false)
    // MUST NOT have authored a registry, and MUST NOT consider itself sealed.
    expect(doc.getMap(SHEET_LIST_FIELD).size).toBe(0)
    expect(binding.hasInitialSynced()).toBe(false)

    // Now the network delivers the persisted (renamed) registry, then the provider 'synced' fires.
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(persisted))
    binding.initialSync(true)

    // The rename survives: we took the JOIN path (doc no longer empty), never authored 'Sheet1'.
    expect(doc.getMap(SHEET_LIST_FIELD).get('default')).toEqual({ name: 'Renamed', order: 0 })
    expect(univer.sheet.cells.get('0:0')).toEqual({ v: 'remote' })
    expect(binding.hasInitialSynced()).toBe(true)
  })

  // Complement: on a genuinely brand-new doc, a local-only signal defers (no author yet), and the
  // subsequent network-synced signal DOES author the default registry.
  it('defers on local-only then authors a brand-new doc once the network is synced', () => {
    const univer = new FakeUniver()
    const doc = new Y.Doc()
    const binding = new UniverYjsBinding(univer as never, doc, () => true, { deferInitialSync: true })
    binding.initialSync(false) // local-only wake: defer
    expect(doc.getMap(SHEET_LIST_FIELD).size).toBe(0)
    expect(binding.hasInitialSynced()).toBe(false)
    binding.initialSync(true) // network synced, doc still empty: author now
    expect(doc.getMap(SHEET_LIST_FIELD).has('default')).toBe(true)
    expect(binding.hasInitialSynced()).toBe(true)
  })

  it('still seeds a genuinely brand-new doc when initialSync runs on an empty doc', () => {
    const univer = new FakeUniver()
    const doc = new Y.Doc()
    const binding = new UniverYjsBinding(univer as never, doc, () => true, { deferInitialSync: true })
    expect(doc.getMap(SHEET_LIST_FIELD).size).toBe(0) // deferred
    binding.initialSync() // doc really is empty -> author the default registry
    expect(doc.getMap(SHEET_LIST_FIELD).has('default')).toBe(true)
    expect(doc.getMap(SHEET_LIST_FIELD).size).toBe(1)
  })

  it('initialSync is idempotent (second call is a no-op)', () => {
    const univer = new FakeUniver()
    const doc = new Y.Doc()
    const binding = new UniverYjsBinding(univer as never, doc, () => true, { deferInitialSync: true })
    binding.initialSync()
    binding.initialSync()
    expect(doc.getMap(SHEET_LIST_FIELD).size).toBe(1)
  })
})

describe('UniverYjsBinding — write-gate (§B3 reader/downgraded)', () => {
  it('does NOT write local edits when canWrite() is false', () => {
    const { univer, cellMap } = setup(false)
    univer.sheet.poke(0, 0, { v: 'reader-typed' })
    univer.fire({ id: SET_RANGE })
    expect(cellMap.size).toBe(0) // nothing left the client
  })

  it('does NOT seed the Y.Map from a fresh book when canWrite() is false', () => {
    const univer = new FakeUniver()
    univer.sheet.poke(0, 0, { v: 'preexisting' }) // book has content before the binding attaches
    const doc = new Y.Doc()
    new UniverYjsBinding(univer as never, doc, () => false)
    expect(doc.getMap(SHEET_YMAP_FIELD).size).toBe(0) // reader must not author the seed
  })

  it('still APPLIES remote changes into Univer for a reader (read stays live)', () => {
    const { univer, doc } = setup(false)
    applyRemote(doc, (peer) => peer.getMap(SHEET_YMAP_FIELD).set('default!0:0', { v: 'from-writer' }))
    expect(univer.sheet.cells.get('0:0')).toEqual({ v: 'from-writer' })
  })
})

describe('UniverYjsBinding — column/row dimensions', () => {
  it('persists a column-width change from the mutation params', () => {
    const { univer, dimMap } = setup()
    univer.fire({
      id: 'sheet.mutation.set-worksheet-col-width',
      params: { ranges: [{ startRow: 0, endRow: 0, startColumn: 2, endColumn: 3 }], colWidth: 140 },
    })
    expect(dimMap.get('default:c2')).toBe(140)
    expect(dimMap.get('default:c3')).toBe(140)
  })

  it('persists a row-height change from the mutation params', () => {
    const { univer, dimMap } = setup()
    univer.fire({
      id: 'sheet.mutation.set-worksheet-row-height',
      params: { ranges: [{ startRow: 5, endRow: 5, startColumn: 0, endColumn: 0 }], rowHeight: 30 },
    })
    expect(dimMap.get('default:r5')).toBe(30)
  })

  it('persists an auto-recomputed row height (e.g. from toggling text-wrap) — WS-28', () => {
    // Toggling 自动换行 grows the row to fit; Univer emits set-worksheet-row-auto-height (NOT the
    // manual set-worksheet-row-height), carrying per-row heights in rowsAutoHeightInfo keyed by the
    // mutation's own subUnitId. Without syncing it the grown height never reaches the Y.Doc and the
    // row snaps back on reload.
    const { univer, dimMap } = setup()
    univer.fire({
      id: 'sheet.mutation.set-worksheet-row-auto-height',
      params: {
        subUnitId: 'local-1', // the first sheet, logical 'default'
        rowsAutoHeightInfo: [
          { row: 0, autoHeight: 48 },
          { row: 2, autoHeight: 66 },
        ],
      },
    })
    expect(dimMap.get('default:r0')).toBe(48)
    expect(dimMap.get('default:r2')).toBe(66)
  })

  it('routes an auto-height mutation to its OWN subUnitId sheet, not the active sheet — WS-28', () => {
    // An auto-height recompute can fire against a non-focused sheet. The mutation's subUnitId is the
    // authoritative target; using the active sheet would persist the height under the wrong sheet's
    // key (right sheet stays clipped on reload, wrong sheet gets over-tall).
    const { univer, dimMap } = setup()
    const s2 = univer.addSheet('Sheet2')
    univer.setActive(s2.getSheetId())
    univer.fire({ id: 'sheet.command.insert-sheet' }) // register Sheet2 into the logical map
    univer.setActive('local-1') // active sheet is now the FIRST sheet ('default')
    // Auto-height targets Sheet2 while 'default' is active.
    univer.fire({
      id: 'sheet.mutation.set-worksheet-row-auto-height',
      params: { subUnitId: s2.getSheetId(), rowsAutoHeightInfo: [{ row: 1, autoHeight: 52 }] },
    })
    expect(dimMap.get(`${s2.getSheetId()}:r1`)).toBe(52) // written under Sheet2's logical id
    expect(dimMap.has('default:r1')).toBe(false) // NOT under the active sheet
  })

  it('ignores an auto-height mutation whose subUnitId maps to no known sheet — WS-28', () => {
    const { univer, dimMap } = setup()
    univer.fire({
      id: 'sheet.mutation.set-worksheet-row-auto-height',
      params: { subUnitId: 'ghost-sheet', rowsAutoHeightInfo: [{ row: 0, autoHeight: 48 }] },
    })
    expect(dimMap.has('default:r0')).toBe(false)
    expect(dimMap.has('ghost-sheet:r0')).toBe(false)
  })

  it('applies a remote column width into the sheet', () => {
    const { univer, doc } = setup()
    applyRemote(doc, (peer) => peer.getMap(SHEET_DIMS_FIELD).set('default:c1', 88))
    expect(univer.sheet.colWidths.get(1)).toBe(88)
  })
})

describe('UniverYjsBinding — merged cells', () => {
  it('writes an added merge into the merge map', () => {
    const { univer, mergeMap } = setup()
    univer.sheet.merges.add('0:0:1:2')
    univer.fire({ id: 'sheet.mutation.add-worksheet-merge' })
    expect(mergeMap.get('default:0:0:1:2')).toBe(true)
  })

  it('removes a merge from the map when it is broken apart', () => {
    const { univer, mergeMap } = setup()
    univer.sheet.merges.add('0:0:1:2')
    univer.fire({ id: 'sheet.mutation.add-worksheet-merge' })
    expect(mergeMap.get('default:0:0:1:2')).toBe(true)
    univer.sheet.merges.delete('0:0:1:2')
    univer.fire({ id: 'sheet.mutation.remove-worksheet-merge' })
    expect(mergeMap.has('default:0:0:1:2')).toBe(false)
  })

  it('applies a remote merge into the sheet', () => {
    const { univer, doc } = setup()
    applyRemote(doc, (peer) => peer.getMap(SHEET_MERGES_FIELD).set('default:1:1:2:2', true))
    expect(univer.sheet.merges.has('1:1:2:2')).toBe(true)
  })
})

describe('UniverYjsBinding — dispose', () => {
  it('stops syncing after dispose()', () => {
    const { univer, binding, cellMap } = setup()
    binding.dispose()
    univer.sheet.poke(0, 0, { v: 'late' })
    univer.fire({ id: SET_RANGE })
    expect(cellMap.size).toBe(0)
  })
})

describe('UniverYjsBinding — multi-sheet (V2)', () => {
  it('seeds the first sheet as logical "default" (V1 back-compat)', () => {
    const { doc } = setup()
    const list = doc.getMap(SHEET_LIST_FIELD)
    expect(list.has('default')).toBe(true)
    expect(list.size).toBe(1)
  })

  it('registers a newly added sheet and keys its cells by a distinct logical id', () => {
    const { univer, doc, cellMap } = setup()
    const list = doc.getMap(SHEET_LIST_FIELD)
    const s2 = univer.addSheet('Sheet2')
    univer.setActive(s2.getSheetId())
    univer.fire({ id: 'sheet.command.insert-sheet' })
    expect(list.size).toBe(2)
    expect(list.has(s2.getSheetId())).toBe(true)
    // Edit on Sheet2 → keyed by ITS logical id, not clobbering 'default'.
    s2.poke(0, 0, { v: 'on-sheet2' })
    univer.fire({ id: SET_RANGE })
    expect(cellMap.get(`${s2.getSheetId()}!0:0`)).toEqual({ v: 'on-sheet2' })
    expect(cellMap.has('default!0:0')).toBe(false)
  })

  it('creates the sheet locally when a remote peer adds one and applies its cells (A adds Sheet2 → B sees it, not aliased onto Sheet1)', () => {
    const { univer, doc } = setup()
    expect(univer.sheets.length).toBe(1)
    applyRemote(doc, (peer) => {
      peer.getMap(SHEET_LIST_FIELD).set('default', { name: 'Sheet1', order: 0 })
      peer.getMap(SHEET_LIST_FIELD).set('s-a-2', { name: 'Sheet2', order: 1 })
      peer.getMap(SHEET_YMAP_FIELD).set('s-a-2!0:0', { v: 'from-A-sheet2' })
    })
    expect(univer.sheets.length).toBe(2)
    const s2 = univer.sheets.find((s) => s.getSheetName() === 'Sheet2')
    expect(s2).toBeTruthy()
    expect(s2!.cells.get('0:0')).toEqual({ v: 'from-A-sheet2' })
    // B's original Sheet1 is NOT overwritten by Sheet2's content (the V1 corruption bug).
    expect(univer.sheet.cells.has('0:0')).toBe(false)
  })

  it('removes the sheet locally when a remote peer deletes it', () => {
    const { univer, doc } = setup()
    applyRemote(doc, (peer) => {
      peer.getMap(SHEET_LIST_FIELD).set('s-x', { name: 'X', order: 1 })
      peer.getMap(SHEET_YMAP_FIELD).set('s-x!0:0', { v: 'x' })
    })
    expect(univer.sheets.length).toBe(2)
    applyRemote(doc, (peer) => peer.getMap(SHEET_LIST_FIELD).delete('s-x'))
    expect(univer.sheets.length).toBe(1)
    expect(univer.sheets.find((s) => s.getSheetName() === 'X')).toBeFalsy()
  })

  // [P1-2] A remote peer reordering tabs writes each sheet's `order` into the registry. Reconcile
  // must APPLY that order to the local tab positions (via moveSheet) — previously it only sorted
  // `desired` to drive iteration but never repositioned local tabs, so reorder never replicated:
  // every other client (and a reload) kept its old order. Assert the local sheet sequence follows
  // the registry `order` after a remote reorder.
  it('applies a remote reorder to local tab positions (reorder replicates)', () => {
    const { univer, doc } = setup()
    // Peer creates a 3-sheet book in order default, s-b, s-c.
    applyRemote(doc, (peer) => {
      const l = peer.getMap(SHEET_LIST_FIELD)
      l.set('default', { name: 'A', order: 0 })
      l.set('s-b', { name: 'B', order: 1 })
      l.set('s-c', { name: 'C', order: 2 })
    })
    expect(univer.sheets.map((s) => s.getSheetName())).toEqual(['A', 'B', 'C'])
    // Peer drags C to the front: order becomes C(0), A(1), B(2).
    applyRemote(doc, (peer) => {
      const l = peer.getMap(SHEET_LIST_FIELD)
      l.set('s-c', { name: 'C', order: 0 })
      l.set('default', { name: 'A', order: 1 })
      l.set('s-b', { name: 'B', order: 2 })
    })
    // Local tabs must now follow the registry order — NOT keep the stale A,B,C.
    expect(univer.sheets.map((s) => s.getSheetName())).toEqual(['C', 'A', 'B'])
  })

  // [P1-4] syncSheetListFromUniver (fired by a local sheet op) diffs the LOCAL sheet set into the
  // registry and prunes entries the user deleted. It must ONLY prune logical ids THIS client
  // actually materialized (present in localToLogical). A remote-owned sheet we failed to render
  // locally (insertSheet returned null) stays in the registry but never made it into our Univer —
  // treating it as "user deleted it" would wipe that sheet's cells/dims/merges for EVERY peer,
  // including its owner. The guard must leave the unmapped remote sheet's registry entry + content
  // untouched.
  it('does NOT prune a remote-owned sheet this client never materialized (delete-guard)', () => {
    const { univer, doc } = setup()
    const list = doc.getMap(SHEET_LIST_FIELD)
    const cells = doc.getMap(SHEET_YMAP_FIELD)
    // A peer adds Sheet2, but our local Univer refuses to create it (insertSheet → null),
    // so 's-remote' remains in the registry with content yet unmapped on this client.
    univer.blockInsertSheet = true
    applyRemote(doc, (peer) => {
      peer.getMap(SHEET_LIST_FIELD).set('default', { name: 'Sheet1', order: 0 })
      peer.getMap(SHEET_LIST_FIELD).set('s-remote', { name: 'Sheet2', order: 1 })
      peer.getMap(SHEET_YMAP_FIELD).set('s-remote!0:0', { v: 'owned-by-peer' })
    })
    // The remote sheet could not be created locally.
    expect(univer.sheets.find((s) => s.getSheetName() === 'Sheet2')).toBeFalsy()
    expect(list.has('s-remote')).toBe(true)
    // Now a purely LOCAL edit fires syncSheetListFromUniver (diff local → registry).
    univer.sheet.poke(0, 0, { v: 'local-edit' })
    univer.fire({ id: SET_RANGE })
    univer.fire({ id: 'sheet.command.set-worksheet-name' })
    // The unmapped remote sheet MUST survive — registry entry AND its cells intact.
    expect(list.has('s-remote')).toBe(true)
    expect(cells.get('s-remote!0:0')).toEqual({ v: 'owned-by-peer' })
  })

  // Complement to the guard: a sheet this client DID materialize and then the user deletes locally
  // must still be pruned from the registry (the guard must not over-suppress real deletions).
  it('still prunes a locally-materialized sheet the user deletes', () => {
    const { univer, doc } = setup()
    const list = doc.getMap(SHEET_LIST_FIELD)
    const s2 = univer.addSheet('Sheet2')
    univer.setActive(s2.getSheetId())
    univer.fire({ id: 'sheet.command.insert-sheet' })
    expect(list.has(s2.getSheetId())).toBe(true)
    // User deletes Sheet2 locally, then a sheet op fires the diff.
    const i = univer.sheets.findIndex((s) => s.getSheetId() === s2.getSheetId())
    univer.sheets.splice(i, 1)
    univer.setActive('local-1')
    univer.fire({ id: 'sheet.command.remove-sheet' })
    expect(list.has(s2.getSheetId())).toBe(false)
  })

  // [P2-E] The sheetList registry is untrusted remote input like every other Y.Map. A malformed
  // entry (null, or missing/NaN order) must not throw inside the reconcile sort and abort the
  // whole observer — a valid sheet in the same batch must still be created.
  it('tolerates a malformed registry entry and still reconciles the valid ones', () => {
    const { univer, doc } = setup()
    applyRemote(doc, (peer) => {
      const list = peer.getMap(SHEET_LIST_FIELD)
      list.set('default', { name: 'Sheet1', order: 0 })
      list.set('s-bad', null as unknown as { name: string; order: number }) // hostile/buggy
      list.set('s-good', { name: 'Good', order: 2 })
    })
    // The malformed entry is filtered out; the well-formed sheet is still created locally.
    expect(univer.sheets.find((s) => s.getSheetName() === 'Good')).toBeTruthy()
  })
})

// The ACTIVE sheet is per-VIEWER state (it is not in the Y.Doc, and no set-worksheet-active
// command is in any TRIGGER_IDS set), but reconcileSheetsFromRegistry materializes remote sheets
// through Univer's `insertSheet()`, which activates each sheet it creates. That made the
// remote-driven reconcile move the viewer's tab as a side effect.
describe('UniverYjsBinding — reconcile must not steal the viewer’s active sheet', () => {
  const activeName = (u: FakeUniver) => u.getActiveWorkbook().getActiveSheet().getSheetName()

  /** Build a doc that ALREADY holds a 2-sheet registry + content, THEN construct the binding —
   *  i.e. exactly what opening an existing multi-sheet doc does (runInitialSync → reconcile). */
  function setupJoiningTwoSheetDoc() {
    const doc = new Y.Doc()
    const l = doc.getMap(SHEET_LIST_FIELD)
    l.set('default', { name: 'Sheet1', order: 0 })
    l.set('s-2', { name: 'Sheet2', order: 1 })
    // Content lives on Sheet1 only — the reported case (Sheet2 empty, so landing there reads
    // as "the document didn't load").
    doc.getMap(SHEET_YMAP_FIELD).set('default!0:0', { v: '你好' })
    doc.getMap(SHEET_YMAP_FIELD).set('default!3:4', { v: 888 })
    const univer = new FakeUniver()
    const binding = new UniverYjsBinding(univer as never, doc, () => true)
    return { univer, doc, binding }
  }

  it('opens an existing multi-sheet doc on the FIRST sheet, not the last one created', () => {
    const { univer } = setupJoiningTwoSheetDoc()
    expect(univer.sheets.map((s) => s.getSheetName())).toEqual(['Sheet1', 'Sheet2'])
    expect(activeName(univer)).toBe('Sheet1')
  })

  it('shows the first sheet’s content on the sheet the viewer lands on', () => {
    const { univer } = setupJoiningTwoSheetDoc()
    const landed = univer.getActiveWorkbook().getActiveSheet()
    expect(landed.cells.get('0:0')).toEqual({ v: '你好' })
    expect(landed.cells.get('3:4')).toEqual({ v: 888 })
  })

  it('lands on the first REGISTRY-ORDER sheet even when the registry order is not insertion order', () => {
    const doc = new Y.Doc()
    const l = doc.getMap(SHEET_LIST_FIELD)
    // Registry iteration order (insertion) is c, a, b; `order` says a, b, c.
    l.set('s-c', { name: 'C', order: 2 })
    l.set('default', { name: 'A', order: 0 })
    l.set('s-b', { name: 'B', order: 1 })
    const univer = new FakeUniver()
    new UniverYjsBinding(univer as never, doc, () => true)
    expect(univer.sheets.map((s) => s.getSheetName())).toEqual(['A', 'B', 'C'])
    expect(activeName(univer)).toBe('A')
  })

  it('keeps the viewer on their current sheet when a PEER adds a new one', () => {
    const { univer, doc } = setup()
    const s2 = univer.addSheet('Sheet2')
    univer.setActive(s2.getSheetId())
    univer.fire({ id: 'sheet.command.insert-sheet' })
    expect(activeName(univer)).toBe('Sheet2')
    // Peer adds Sheet3 while we are looking at Sheet2 — our viewport must not jump to it.
    applyRemote(doc, (peer) => peer.getMap(SHEET_LIST_FIELD).set('s-3', { name: 'Sheet3', order: 2 }))
    expect(univer.sheets.map((s) => s.getSheetName())).toEqual(['Sheet1', 'Sheet2', 'Sheet3'])
    expect(activeName(univer)).toBe('Sheet2')
  })

  it('falls back to the first sheet when a peer deletes the sheet the viewer was on', () => {
    const { univer, doc } = setup()
    applyRemote(doc, (peer) => {
      peer.getMap(SHEET_LIST_FIELD).set('default', { name: 'Sheet1', order: 0 })
      peer.getMap(SHEET_LIST_FIELD).set('s-2', { name: 'Sheet2', order: 1 })
    })
    const s2 = univer.sheets.find((s) => s.getSheetName() === 'Sheet2')!
    univer.setActive(s2.getSheetId())
    applyRemote(doc, (peer) => peer.getMap(SHEET_LIST_FIELD).delete('s-2'))
    expect(univer.sheets.map((s) => s.getSheetName())).toEqual(['Sheet1'])
    expect(activeName(univer)).toBe('Sheet1')
  })

  it('never replicates the active-sheet switch it performs (stays viewer-local)', () => {
    const { doc } = setupJoiningTwoSheetDoc()
    // No shared field records an active/current sheet — restoring the tab must not have added one.
    const asJson = JSON.stringify(doc.toJSON())
    expect(asJson).not.toMatch(/active/i)
    // The registry still holds exactly the two sheets, unchanged.
    expect(doc.getMap(SHEET_LIST_FIELD).toJSON()).toEqual({
      default: { name: 'Sheet1', order: 0 },
      's-2': { name: 'Sheet2', order: 1 },
    })
  })
})

// A malicious or buggy peer can put an out-of-grid / malformed key into the shared maps.
// The binding must clamp-reject BEFORE calling getRange (which throws out of range) so one
// bad key can never abort the whole remote batch or write past the declared 1000×100 grid.
describe('UniverYjsBinding — remote bounds & isolation guards', () => {
  it('rejects an out-of-grid remote cell but still applies a valid one in the same batch', () => {
    const { univer, doc } = setup()
    applyRemote(doc, (peer) => {
      const m = peer.getMap(SHEET_YMAP_FIELD)
      m.set('default!9999:0', { v: 'row-oob' }) // row >= SHEET_MAX_ROWS
      m.set('default!0:9999', { v: 'col-oob' }) // col >= SHEET_MAX_COLS
      m.set('default!0:0', { v: 'ok' }) // valid — must still land
    })
    expect(univer.sheet.cells.get('0:0')).toEqual({ v: 'ok' })
    expect(univer.sheet.cells.has('9999:0')).toBe(false)
    expect(univer.sheet.cells.has('0:9999')).toBe(false)
  })

  it('rejects a negative / non-integer remote cell coordinate', () => {
    const { univer, doc } = setup()
    applyRemote(doc, (peer) => {
      const m = peer.getMap(SHEET_YMAP_FIELD)
      m.set('default!-1:0', { v: 'neg' })
      m.set('default!x:0', { v: 'nan' })
      m.set('default!1:1', { v: 'ok' })
    })
    expect(univer.sheet.cells.get('1:1')).toEqual({ v: 'ok' })
    expect(univer.sheet.cells.has('-1:0')).toBe(false)
  })

  it('ignores a remote cell whose logical sheet does not exist locally (no cross-sheet aliasing)', () => {
    const { univer, doc } = setup()
    applyRemote(doc, (peer) => peer.getMap(SHEET_YMAP_FIELD).set('ghost-sheet!0:0', { v: 'orphan' }))
    // No sheet registered for 'ghost-sheet' → must not fall back onto the active Sheet1.
    expect(univer.sheet.cells.has('0:0')).toBe(false)
  })

  it('rejects an out-of-grid remote column-width but applies a valid one', () => {
    const { univer, doc } = setup()
    applyRemote(doc, (peer) => {
      const m = peer.getMap(SHEET_DIMS_FIELD)
      m.set('default:c9999', 120) // col >= SHEET_MAX_COLS
      m.set('default:c2', 77) // valid
    })
    expect(univer.sheet.colWidths.get(2)).toBe(77)
    expect(univer.sheet.colWidths.has(9999)).toBe(false)
  })

  it('rejects an out-of-grid / inverted remote merge but applies a valid one', () => {
    const { univer, doc } = setup()
    applyRemote(doc, (peer) => {
      const m = peer.getMap(SHEET_MERGES_FIELD)
      m.set('default:0:0:9999:0', true) // endRow past grid
      m.set('default:5:5:1:1', true) // inverted span (end < start)
      m.set('default:0:0:1:1', true) // valid
    })
    expect(univer.sheet.merges.has('0:0:1:1')).toBe(true)
    expect(univer.sheet.merges.has('0:0:9999:0')).toBe(false)
    expect(univer.sheet.merges.has('5:5:1:1')).toBe(false)
  })

  // [P1] Untrusted remote dimension VALUE (not just key index) must be validated: a peer can
  // write NaN / Infinity / negative / absurd sizes straight into setColumnWidth/setRowHeight.
  it('rejects a non-finite / negative / absurd remote dimension value but applies a valid one', () => {
    const { univer, doc } = setup()
    applyRemote(doc, (peer) => {
      const m = peer.getMap(SHEET_DIMS_FIELD)
      m.set('default:c0', Infinity) // non-finite
      m.set('default:c1', -5) // negative
      m.set('default:c2', 0) // zero (collapse)
      m.set('default:c3', 999999) // past sane ceiling
      m.set('default:r0', NaN) // NaN
      m.set('default:c4', 90) // valid
    })
    expect(univer.sheet.colWidths.get(4)).toBe(90)
    expect(univer.sheet.colWidths.has(0)).toBe(false)
    expect(univer.sheet.colWidths.has(1)).toBe(false)
    expect(univer.sheet.colWidths.has(2)).toBe(false)
    expect(univer.sheet.colWidths.has(3)).toBe(false)
    expect(univer.sheet.rowHeights.has(0)).toBe(false)
  })

  // [P1] A hostile FALSY merge value (0 / '') must NOT be interpreted as breakApart — that would
  // let a peer force-break a live merge (data loss). Only `=== true` merges; only key-deletion
  // breaks apart; any other value shape is ignored, leaving the existing merge untouched.
  it('does not break a live merge when a remote peer writes a falsy (non-true) value', () => {
    const { univer, doc } = setup()
    // Establish a live merge from a remote peer.
    applyRemote(doc, (peer) => peer.getMap(SHEET_MERGES_FIELD).set('default:0:0:1:1', true))
    expect(univer.sheet.merges.has('0:0:1:1')).toBe(true)
    // A hostile/malformed falsy write must be IGNORED, not treated as breakApart.
    applyRemote(doc, (peer) => peer.getMap(SHEET_MERGES_FIELD).set('default:0:0:1:1', 0 as unknown as boolean))
    expect(univer.sheet.merges.has('0:0:1:1')).toBe(true)
    // Only an actual key deletion breaks the merge.
    applyRemote(doc, (peer) => peer.getMap(SHEET_MERGES_FIELD).delete('default:0:0:1:1'))
    expect(univer.sheet.merges.has('0:0:1:1')).toBe(false)
  })
})

// [P1] When a remote peer creates a sheet AT RUNTIME, the sheetList observer must replay that
// sheet's dims & merges too — not only its cells. Yjs gives no cross-Y.Map observer ordering
// guarantee within one transaction, so dims/merges applied before the mapping existed were
// dropped and never retried (cells present, widths/heights/merges lost until reload).
describe('UniverYjsBinding — remote-created sheet replays dims & merges (not just cells)', () => {
  it('applies a remote-created sheet\'s column widths, row heights and merges', () => {
    const { univer, doc } = setup()
    expect(univer.sheets.length).toBe(1)
    applyRemote(doc, (peer) => {
      // Single transaction: registry entry + cells + dims + merges all land together, exercising
      // the observer-ordering hazard the fix guards against.
      peer.getMap(SHEET_LIST_FIELD).set('default', { name: 'Sheet1', order: 0 })
      peer.getMap(SHEET_LIST_FIELD).set('s-rt-2', { name: 'Sheet2', order: 1 })
      peer.getMap(SHEET_YMAP_FIELD).set('s-rt-2!0:0', { v: 'cell' })
      peer.getMap(SHEET_DIMS_FIELD).set('s-rt-2:c1', 130)
      peer.getMap(SHEET_DIMS_FIELD).set('s-rt-2:r2', 44)
      peer.getMap(SHEET_MERGES_FIELD).set('s-rt-2:0:0:1:1', true)
    })
    const s2 = univer.sheets.find((s) => s.getSheetName() === 'Sheet2')
    expect(s2).toBeTruthy()
    // Cells (already worked) + dims + merges (the bug) all applied to the new sheet.
    expect(s2!.cells.get('0:0')).toEqual({ v: 'cell' })
    expect(s2!.colWidths.get(1)).toBe(130)
    expect(s2!.rowHeights.get(2)).toBe(44)
    expect(s2!.merges.has('0:0:1:1')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Protection (range + worksheet) sync — WS-PROT.
//
// Regression cover for the three reported symptoms of 保护行列:
//   1. a rule vanished on reload        -> nothing was ever written to the Y.Doc
//   2. peers saw an unprotected sheet   -> no rule mutation was replicated
//   3. rules leaked per-client ids      -> subUnitId differs per client, so a naive
//                                          round-trip lands the rule on the wrong sheet
// ---------------------------------------------------------------------------

const ADD_RANGE_PROT = 'sheet.mutation.add-range-protection'
const ADD_WS_PROT = 'sheet.mutation.add-worksheet-protection'

/** Minimal rxjs-ish subject: just enough for the binding's `.subscribe(next)`. */
function subject() {
  const subs = new Set<() => void>()
  return {
    stream: { subscribe: (n: () => void) => { subs.add(n); return { unsubscribe: () => subs.delete(n) } } },
    fire: () => { for (const n of [...subs]) n() },
  }
}

type Rule = Record<string, unknown>

/** In-memory RangeProtectionRuleModel: Map<`${unitId}/${subUnitId}`, Map<ruleId, rule>>. */
class FakeRangeProtModel {
  readonly store = new Map<string, Map<string, Rule>>()
  private readonly s = subject()
  ruleChange$ = this.s.stream
  private bucket(u: string, sub: string): Map<string, Rule> {
    const k = `${u}/${sub}`
    let m = this.store.get(k)
    if (!m) { m = new Map(); this.store.set(k, m) }
    return m
  }
  getSubunitRuleList(u: string, sub: string): unknown[] {
    if (this.throwOnRead) throw new Error('model read failed (simulated transient glitch)')
    return [...this.bucket(u, sub).values()]
  }
  /** When true, reads throw — the transient failure production's try/catch already anticipates. */
  throwOnRead = false
  getRule(u: string, sub: string, id: string): unknown | undefined { return this.bucket(u, sub).get(id) }
  addRule(u: string, sub: string, rule: unknown): void { const r = rule as Rule; this.bucket(u, sub).set(r.id as string, r) }
  setRule(u: string, sub: string, id: string, rule: unknown): void { this.bucket(u, sub).set(id, rule as Rule) }
  deleteRule(u: string, sub: string, id: string): void { this.bucket(u, sub).delete(id) }
  /** Fire the stream WITHOUT mutating the model — for read-failure / null-workbook scenarios. */
  fireStream(): void { this.s.fire() }
  /** Simulate a local UI edit: mutate the model, then fire the stream the binding listens on. */
  localAdd(u: string, sub: string, rule: Rule): void { this.addRule(u, sub, rule); this.s.fire() }
  localDelete(u: string, sub: string, id: string): void { this.deleteRule(u, sub, id); this.s.fire() }
}

/** In-memory WorksheetProtectionRuleModel — at most ONE rule per sheet, hence no rule id. */
class FakeWsProtModel {
  readonly store = new Map<string, Rule>() // `${unitId}/${subUnitId}` -> rule
  private readonly s = subject()
  ruleChange$ = this.s.stream
  getRule(u: string, sub: string): unknown | undefined { return this.store.get(`${u}/${sub}`) }
  addRule(u: string, rule: unknown): void {
    const r = rule as Rule
    this.store.set(`${u}/${r.subUnitId as string}`, r)
  }
  setRule(u: string, sub: string, rule: unknown): void { this.store.set(`${u}/${sub}`, rule as Rule) }
  deleteRule(u: string, sub: string): void { this.store.delete(`${u}/${sub}`) }
  localAdd(u: string, rule: Rule): void { this.addRule(u, rule); this.s.fire() }
}

function setupProt(canWrite = true) {
  const univer = new FakeUniver()
  // Protection sync keys off the workbook's unit id, so unlike setup() (which deliberately leaves
  // it null to cover the "no unit id yet" path) these tests need a concrete one.
  univer.unitId = 'unit-1'
  const doc = new Y.Doc()
  const range = new FakeRangeProtModel()
  const ws = new FakeWsProtModel()
  const binding = new UniverYjsBinding(
    univer as never, doc, () => canWrite, {}, null, null,
    range as never, ws as never,
  )
  return { univer, doc, binding, range, ws, protMap: doc.getMap(SHEET_PROTECTION_FIELD) }
}

/**
 * Same as setupProt but sets canWrite and canManageProtection INDEPENDENTLY — the shape of a plain
 * writer, who may edit cells but must not create, delete or replicate protection rules.
 */
function setupProtSplit(canWrite: boolean, canManageProtection: boolean, sharedDoc?: Y.Doc) {
  const univer = new FakeUniver()
  univer.unitId = 'unit-1'
  // Pass sharedDoc to put two bindings (e.g. an admin and a writer) on ONE Y.Doc. Without it each
  // binding gets its own doc and cross-client assertions become true by construction — see WS-PROT-9a.
  const doc = sharedDoc ?? new Y.Doc()
  const range = new FakeRangeProtModel()
  const ws = new FakeWsProtModel()
  const binding = new UniverYjsBinding(
    univer as never, doc, () => canWrite, {}, null, null,
    range as never, ws as never,
    () => canManageProtection,
  )
  return { univer, doc, binding, range, ws, protMap: doc.getMap(SHEET_PROTECTION_FIELD) }
}

/** A range rule as Univer's model holds it — note the per-client unitId/subUnitId. */
function rangeRule(id: string, over: Partial<Rule> = {}): Rule {
  return {
    id,
    permissionId: `perm-${id}`,
    unitId: 'unit-1',
    subUnitId: 'local-1',
    unitType: 3,
    viewState: 'othersCanView',
    editState: 'onlyMe',
    ranges: [{ startRow: 4, startColumn: 2, endRow: 4, endColumn: 2 }], // C5
    ...over,
  }
}

describe('UniverYjsBinding — protection: local -> Y.Map (bug 1: rule was never persisted)', () => {
  it('writes an added range rule under the LOGICAL sheet id, stripping per-client ids', () => {
    const { range, protMap } = setupProt()
    range.localAdd('unit-1', 'local-1', rangeRule('r1'))

    // Logical key, not the local univer sheet id.
    expect([...protMap.keys()]).toEqual(['default!r:r1'])
    const stored = protMap.get('default!r:r1') as Record<string, unknown>
    expect(stored.kind).toBe('r')
    expect(stored.id).toBe('r1')
    expect(stored.permissionId).toBe('perm-r1')
    expect(stored.editState).toBe('onlyMe')
    expect(stored.ranges).toEqual([{ startRow: 4, startColumn: 2, endRow: 4, endColumn: 2 }])
    // Runtime ids must NEVER enter shared state — a peer's sheet id differs.
    expect(stored.unitId).toBeUndefined()
    expect(stored.subUnitId).toBeUndefined()
  })

  it('removes the key when the rule is deleted locally', () => {
    const { range, protMap } = setupProt()
    range.localAdd('unit-1', 'local-1', rangeRule('r1'))
    expect(protMap.has('default!r:r1')).toBe(true)
    range.localDelete('unit-1', 'local-1', 'r1')
    expect(protMap.has('default!r:r1')).toBe(false)
  })

  it('writes a worksheet rule under the `w:` key with no ranges', () => {
    const { ws, protMap } = setupProt()
    ws.localAdd('unit-1', {
      permissionId: 'perm-ws', unitId: 'unit-1', subUnitId: 'local-1',
      unitType: 2, viewState: 'othersCanView', editState: 'onlyMe',
    })
    expect([...protMap.keys()]).toEqual(['default!w:'])
    const stored = protMap.get('default!w:') as Record<string, unknown>
    expect(stored.kind).toBe('w')
    expect(stored.permissionId).toBe('perm-ws')
    expect(stored.ranges).toBeUndefined()
  })

  it('a plain WRITER cannot replicate a protection rule via the model stream (admin-only)', () => {
    // Regression guard for a fail-open found in review. The command path was gated on
    // canManageProtection but the two ruleChange$ subscriptions were still on canWrite, so a plain
    // writer (canWrite true / canManageProtection false) could push protection changes to peers.
    const { range, ws, protMap } = setupProtSplit(true, false)
    range.localAdd('unit-1', 'local-1', rangeRule('r1'))
    ws.localAdd('unit-1', {
      permissionId: 'perm-ws', unitId: 'unit-1', subUnitId: 'local-1',
      unitType: 2, viewState: 'othersCanView', editState: 'onlyMe',
    })
    expect(protMap.size).toBe(0)
  })

  it('a plain WRITER cannot replicate a protection DELETE to peers', () => {
    // The dangerous direction: syncProtectionToYmap() diffs against lastSeenProtection and deletes
    // keys that vanished locally. An admin seeds the rule; a writer-scoped binding must not remove it.
    //
    // WS-PROT-9a — this assertion used to be TRUE BY CONSTRUCTION: setupProtSplit() built a fresh
    // Y.Doc per call, so the writer's binding could not reach the admin's map even with every gate
    // removed. Verified empirically: dropping all three `canManageProtection()` guards
    // (binding.ts :513/:619/:625) left this test GREEN while its two siblings correctly went RED.
    // Both bindings must therefore share ONE doc, and the writer must have lastSeenProtection
    // populated (it is the diff against lastSeen — not the live read — that emits the delete).
    const doc = new Y.Doc()
    const admin = setupProtSplit(true, true, doc)
    admin.range.localAdd('unit-1', 'local-1', rangeRule('r1'))
    expect(admin.protMap.has('default!r:r1')).toBe(true)

    // Same doc: the writer observes the admin's rule, so its own lastSeenProtection now tracks
    // 'default!r:r1' — the precondition for a diff-driven delete to be emitted at all.
    const writer = setupProtSplit(true, false, doc)
    expect(writer.protMap.has('default!r:r1')).toBe(true)
    writer.range.addRule('unit-1', 'local-1', rangeRule('r1'))
    writer.range.localDelete('unit-1', 'local-1', 'r1')
    // The shared-state rule survives: the writer's stream was refused by the admin gate.
    expect(admin.protMap.has('default!r:r1')).toBe(true)
    expect(doc.getMap(SHEET_PROTECTION_FIELD).has('default!r:r1')).toBe(true)
  })

  it('WS-PROT-9b: a model read that THROWS must not delete peers\' protection rules', () => {
    // P1-2. scanAllProtection() caught a throwing getSubunitRuleList and returned an EMPTY map,
    // which syncProtectionToYmap() cannot distinguish from "the user deleted every rule" — so it
    // pushed a Yjs delete for every tracked key. A transient local read glitch became permanent,
    // global loss of the very security state this feature exists to add. There is no undo.
    const { range, protMap } = setupProtSplit(true, true)
    range.localAdd('unit-1', 'local-1', rangeRule('r1'))
    range.localAdd('unit-1', 'local-1', rangeRule('r2'))
    expect(protMap.has('default!r:r1')).toBe(true)
    expect(protMap.has('default!r:r2')).toBe(true)

    // The model throws once — exactly the case the production try/catch already anticipates.
    range.throwOnRead = true
    range.fireStream()

    // Read failure => no information => write nothing. Rules must still be there.
    expect(protMap.has('default!r:r1')).toBe(true)
    expect(protMap.has('default!r:r2')).toBe(true)
  })

  it('WS-PROT-9c: a null workbook for one tick must not delete peers\' protection rules', () => {
    // Same fail-open, second source: `if (!wb) return out` / `if (!unitId) return out`. A route
    // change can null the active workbook for a tick while a ruleChange$ event lands.
    const { univer, range, protMap } = setupProtSplit(true, true)
    range.localAdd('unit-1', 'local-1', rangeRule('r1'))
    expect(protMap.has('default!r:r1')).toBe(true)

    univer.unitId = null
    range.fireStream()

    expect(protMap.has('default!r:r1')).toBe(true)
  })

  it('WS-PROT-9d: a genuine local delete still replicates (the guard must not freeze sync)', () => {
    // Positive control for 9b/9c: fail-closed on read failure must not also suppress real deletes,
    // otherwise "protection can never be removed" ships as the new bug.
    const { range, protMap } = setupProtSplit(true, true)
    range.localAdd('unit-1', 'local-1', rangeRule('r1'))
    expect(protMap.has('default!r:r1')).toBe(true)

    range.localDelete('unit-1', 'local-1', 'r1')
    expect(protMap.has('default!r:r1')).toBe(false)
  })

  it('an ADMIN (canManageProtection=true) still replicates normally', () => {
    const { range, protMap } = setupProtSplit(true, true)
    range.localAdd('unit-1', 'local-1', rangeRule('r1'))
    expect(protMap.has('default!r:r1')).toBe(true)
  })

  it('a reader (canWrite=false) never writes protection into shared state', () => {
    const { range, protMap } = setupProt(false)
    range.localAdd('unit-1', 'local-1', rangeRule('r1'))
    expect(protMap.size).toBe(0)
  })

  it('is driven by the mutation trigger too, not only the model stream', () => {
    const { univer, range, protMap } = setupProt()
    // Model changed without firing ruleChange$ (a command-only path).
    range.addRule('unit-1', 'local-1', rangeRule('r9'))
    expect(protMap.size).toBe(0)
    univer.fire({ id: ADD_RANGE_PROT })
    expect(protMap.has('default!r:r9')).toBe(true)
  })
})

describe('UniverYjsBinding — protection: remote -> Univer (bug 2: peers saw no protection)', () => {
  it('applies a remote range rule, re-attaching THIS client\'s unitId/subUnitId', () => {
    const { doc, range } = setupProt()
    applyRemote(doc, (peer) => {
      peer.getMap(SHEET_PROTECTION_FIELD).set('default!r:r1', {
        kind: 'r', id: 'r1', permissionId: 'perm-r1', unitType: 3,
        viewState: 'othersCanView', editState: 'onlyMe',
        ranges: [{ startRow: 4, startColumn: 2, endRow: 4, endColumn: 2 }],
      })
    })
    const applied = range.getRule('unit-1', 'local-1', 'r1') as Record<string, unknown>
    expect(applied).toBeTruthy()
    expect(applied.unitId).toBe('unit-1')
    expect(applied.subUnitId).toBe('local-1') // local id, NOT whatever the peer had
    expect(applied.permissionId).toBe('perm-r1')
    expect(applied.ranges).toEqual([{ startRow: 4, startColumn: 2, endRow: 4, endColumn: 2 }])
    // The discriminator is ours, not Univer's — it must not leak into the model.
    expect(applied.kind).toBeUndefined()
  })

  it('does not echo a remote apply back into the Y.Map', () => {
    const { doc, protMap } = setupProt()
    applyRemote(doc, (peer) => {
      peer.getMap(SHEET_PROTECTION_FIELD).set('default!r:r1', {
        kind: 'r', id: 'r1', permissionId: 'perm-r1', ranges: [],
      })
    })
    // Exactly the remote key, no duplicate/rewritten entry.
    expect([...protMap.keys()]).toEqual(['default!r:r1'])
  })

  it('deletes the local rule when the remote key is removed', () => {
    const { doc, range } = setupProt()
    applyRemote(doc, (peer) => {
      peer.getMap(SHEET_PROTECTION_FIELD).set('default!r:r1', {
        kind: 'r', id: 'r1', permissionId: 'perm-r1', ranges: [],
      })
    })
    expect(range.getRule('unit-1', 'local-1', 'r1')).toBeTruthy()
    applyRemote(doc, (peer) => { peer.getMap(SHEET_PROTECTION_FIELD).delete('default!r:r1') })
    expect(range.getRule('unit-1', 'local-1', 'r1')).toBeUndefined()
  })

  it('applies a remote worksheet rule onto the local sheet', () => {
    const { doc, ws } = setupProt()
    applyRemote(doc, (peer) => {
      peer.getMap(SHEET_PROTECTION_FIELD).set('default!w:', {
        kind: 'w', permissionId: 'perm-ws', editState: 'onlyMe',
      })
    })
    const applied = ws.getRule('unit-1', 'local-1') as Record<string, unknown>
    expect(applied).toBeTruthy()
    expect(applied.permissionId).toBe('perm-ws')
    expect(applied.subUnitId).toBe('local-1')
  })

  it('rejects out-of-grid ranges from a hostile/corrupt peer', () => {
    const { doc, range } = setupProt()
    applyRemote(doc, (peer) => {
      peer.getMap(SHEET_PROTECTION_FIELD).set('default!r:bad', {
        kind: 'r', id: 'bad', permissionId: 'p',
        ranges: [
          { startRow: 0, startColumn: 0, endRow: 99999, endColumn: 2 }, // past MAX_ROWS
          { startRow: -1, startColumn: 0, endRow: 1, endColumn: 1 },    // negative
          { startRow: 5, startColumn: 5, endRow: 1, endColumn: 9 },     // inverted
          { startRow: 1, startColumn: 1, endRow: 2, endColumn: 2 },     // the only good one
        ],
      })
    })
    const applied = range.getRule('unit-1', 'local-1', 'bad') as Record<string, unknown>
    expect(applied.ranges).toEqual([{ startRow: 1, startColumn: 1, endRow: 2, endColumn: 2 }])
  })
})

describe('UniverYjsBinding — protection: reload (bug 1, the user-visible half)', () => {
  it('a fresh binding over a populated doc restores rules into Univer', () => {
    // First session writes a rule...
    const first = setupProt()
    first.range.localAdd('unit-1', 'local-1', rangeRule('r1'))
    const snapshot = Y.encodeStateAsUpdate(first.doc)
    first.binding.dispose()

    // ...second session (a reload) starts from the persisted state with an empty model.
    const univer = new FakeUniver()
    univer.unitId = 'unit-1'
    const doc = new Y.Doc()
    Y.applyUpdate(doc, snapshot)
    const range = new FakeRangeProtModel()
    const ws = new FakeWsProtModel()
    new UniverYjsBinding(univer as never, doc, () => true, {}, null, null, range as never, ws as never)

    const restored = range.getRule('unit-1', 'local-1', 'r1') as Record<string, unknown>
    expect(restored).toBeTruthy()
    expect(restored.permissionId).toBe('perm-r1')
    expect(restored.subUnitId).toBe('local-1')
  })

  // [REVIEW] `runInitialSync`'s legacy-V1 branch gates on "does this doc hold any content?" and
  // that predicate listed cells/dims/merges only. A doc whose ONLY populated map is
  // `sheetProtection` (a V1 doc with no sheetList where an admin protected a still-empty range)
  // therefore fell through to the brand-new-doc branch and the locks silently vanished on reload
  // — the exact "the lock looks like it's there but isn't" failure mode this PR exists to kill.
  // Narrow but real, and cheap to lock down.
  it('restores protection on a legacy doc whose ONLY populated map is sheetProtection', () => {
    const doc = new Y.Doc()
    // No sheetList, no cells, no dims, no merges. Just a rule.
    doc.getMap(SHEET_PROTECTION_FIELD).set('default!r:r1', {
      kind: 'r', id: 'r1', permissionId: 'perm-r1', unitType: 3,
      viewState: 'othersCanView', editState: 'onlyMe',
      ranges: [{ startRow: 4, startColumn: 2, endRow: 4, endColumn: 2 }],
    })

    const univer = new FakeUniver()
    univer.unitId = 'unit-1'
    const range = new FakeRangeProtModel()
    const ws = new FakeWsProtModel()
    new UniverYjsBinding(univer as never, doc, () => true, {}, null, null, range as never, ws as never)

    const restored = range.getRule('unit-1', 'local-1', 'r1') as Record<string, unknown>
    expect(restored).toBeTruthy()
    expect(restored.permissionId).toBe('perm-r1')
    expect(restored.ranges).toEqual([{ startRow: 4, startColumn: 2, endRow: 4, endColumn: 2 }])
  })

  it('restores a whole-sheet rule on a doc whose ONLY populated map is sheetProtection', () => {
    const doc = new Y.Doc()
    doc.getMap(SHEET_PROTECTION_FIELD).set('default!w:', {
      kind: 'w', permissionId: 'perm-ws', unitType: 2,
      viewState: 'othersCanView', editState: 'onlyMe',
    })

    const univer = new FakeUniver()
    univer.unitId = 'unit-1'
    const range = new FakeRangeProtModel()
    const ws = new FakeWsProtModel()
    new UniverYjsBinding(univer as never, doc, () => true, {}, null, null, range as never, ws as never)

    const restored = ws.getRule('unit-1', 'local-1') as Record<string, unknown>
    expect(restored).toBeTruthy()
    expect(restored.permissionId).toBe('perm-ws')
  })
})

/**
 * WS-PROT-2b — the GRANTS map needs an observer of its own.
 *
 * binding.ts observes six Y.Maps plus the protection RULES map. It never observed
 * `sheetProtectionGrants`, and grants are where "who may edit this range" actually lives. A rule
 * change re-renders because the rule models drive the UI; a grant change has no model behind it — the
 * only thing that consumes it is `IAuthzIoService.allowed()`, and Univer caches those answers per
 * permission point until something tells it to re-query.
 *
 * So revoking someone remotely did nothing on their screen: the admin removed them from the roster,
 * the grant replicated correctly, and the victim's client kept answering from the cached "allowed"
 * until a reload. Same class as the role-downgrade cache bug fixed the round before — the state
 * changed and nothing re-asked — one map over.
 */
describe('UniverYjsBinding — a remote GRANT change triggers a permission re-query (WS-PROT-2b)', () => {
  const GRANTS = 'sheetProtectionGrants'

  function setupGrants() {
    const univer = new FakeUniver()
    univer.unitId = 'unit-1'
    const doc = new Y.Doc()
    const range = new FakeRangeProtModel()
    const ws = new FakeWsProtModel()
    const onGrantsChanged = vi.fn()
    const binding = new UniverYjsBinding(
      univer as never, doc, () => true, {}, null, null,
      range as never, ws as never, () => true, onGrantsChanged,
    )
    return { doc, binding, onGrantsChanged }
  }

  it('calls the refresh hook when a peer rewrites a grant', () => {
    const { doc, onGrantsChanged } = setupGrants()
    applyRemote(doc, (peer) => {
      peer.getMap(GRANTS).set('perm-1', { allow: ['u-carol'] })
    })
    expect(onGrantsChanged).toHaveBeenCalled()
  })

  it('calls it when a peer DELETES a grant (revocation is the dangerous direction)', () => {
    const { doc, onGrantsChanged } = setupGrants()
    applyRemote(doc, (peer) => { peer.getMap(GRANTS).set('perm-1', { allow: ['u-bob'] }) })
    onGrantsChanged.mockClear()
    applyRemote(doc, (peer) => { peer.getMap(GRANTS).delete('perm-1') })
    expect(onGrantsChanged).toHaveBeenCalled()
  })

  it('does NOT fire for our own local writes (no self-inflicted refresh loop)', () => {
    const { doc, onGrantsChanged } = setupGrants()
    doc.getMap(GRANTS).set('perm-1', { allow: ['u-bob'] })
    expect(onGrantsChanged).not.toHaveBeenCalled()
  })

  it('stops firing after dispose', () => {
    const { doc, binding, onGrantsChanged } = setupGrants()
    binding.dispose()
    applyRemote(doc, (peer) => { peer.getMap(GRANTS).set('perm-1', { allow: ['u-x'] }) })
    expect(onGrantsChanged).not.toHaveBeenCalled()
  })

  it('is inert when no hook is supplied (existing call sites keep working)', () => {
    const univer = new FakeUniver()
    univer.unitId = 'unit-1'
    const doc = new Y.Doc()
    new UniverYjsBinding(univer as never, doc, () => true, {}, null, null, null, null)
    expect(() =>
      applyRemote(doc, (peer) => { peer.getMap(GRANTS).set('perm-1', { allow: ['u-x'] }) }),
    ).not.toThrow()
  })
})

/**
 * WS-PROT-12 — permission POINTS replicate, in their own map.
 *
 * Without this the toggles were local-and-ephemeral in the worst way: `create()` stored the operation
 * matrix in `sheetProtectionGrants`, but the sheet→permissionId association lived only in Univer's
 * `WorksheetProtectionPointModel` — a model this binding never read, and which Univer persists only
 * through an IResourceManagerService snapshot that this app never saves. So no peer ever asked about
 * that permissionId, and a reload orphaned the grant and minted a new one.
 *
 * The map is deliberately NOT `sheetProtection`: octo-docs-backend reads that one, dispatches on
 * `kind: 'w'`, and treats anything else as a range rule — `readRects(undefined)` then reports
 * `malformed` and fail-closes the WHOLE sheet. Probed against the real `assertSheetWriteAllowed`:
 * a lone point rule there 403s every non-admin bot write on that sheet, unfixably.
 */
describe('UniverYjsBinding — worksheet permission points replicate (WS-PROT-12)', () => {
  const POINTS = 'sheetPermissionPoints'

  class FakePointModel {
    rules = new Map<string, { unitId: string; subUnitId: string; permissionId: string }>()
    private readonly subs: Array<() => void> = []
    pointChange$ = { subscribe: (next: () => void) => { this.subs.push(next); return { unsubscribe: () => {} } } }
    /**
     * Mutations emit, as the REAL model does — `WorksheetProtectionPointModel.addRule` calls
     * `_pointChange.next(rule)` SYNCHRONOUSLY. A silent fake pins the exact interaction the
     * `applyingRemote` echo guard exists to handle, so the guard's own test could not fail:
     * deleting the guard left the suite green. Emitting here is what makes it a real guard test.
     */
    addRule(rule: { unitId: string; subUnitId: string; permissionId: string }) {
      this.rules.set(`${rule.unitId}/${rule.subUnitId}`, rule)
      this.emit()
    }
    deleteRule(unitId: string, subUnitId: string) {
      this.rules.delete(`${unitId}/${subUnitId}`)
      this.emit()
    }
    getRule(unitId: string, subUnitId: string) { return this.rules.get(`${unitId}/${subUnitId}`) }
    /** Drive the local->Yjs path the way Univer's mutation would. */
    emit() { for (const f of this.subs) f() }
  }

  function setupPoints(canManageProtection = true) {
    const univer = new FakeUniver()
    univer.unitId = 'unit-1'
    const doc = new Y.Doc()
    const pm = new FakePointModel()
    const binding = new UniverYjsBinding(
      univer as never, doc, () => true, {}, null, null, null, null,
      () => canManageProtection, null, pm as never,
    )
    return { univer, doc, binding, pm, points: doc.getMap(POINTS) }
  }

  it('pushes a locally-set association into the points map', () => {
    const { pm, points } = setupPoints()
    pm.addRule({ unitId: 'unit-1', subUnitId: 'local-1', permissionId: 'perm-p' })
    pm.emit()
    expect(points.get('default')).toEqual({ permissionId: 'perm-p' })
  })

  it('keys by the LOGICAL sheet id, not this client\'s runtime subUnitId', () => {
    // The whole reason the map exists: `local-1` differs per client and per reopen.
    const { pm, points } = setupPoints()
    pm.addRule({ unitId: 'unit-1', subUnitId: 'local-1', permissionId: 'perm-p' })
    pm.emit()
    expect([...points.keys()]).toEqual(['default'])
  })

  it('applies a REMOTE association, re-attaching this client\'s runtime ids', () => {
    const { doc, pm } = setupPoints()
    applyRemote(doc, (peer) => { peer.getMap(POINTS).set('default', { permissionId: 'perm-p' }) })
    expect(pm.getRule('unit-1', 'local-1')).toEqual({
      unitId: 'unit-1', subUnitId: 'local-1', permissionId: 'perm-p',
    })
  })

  it('applies a REMOTE deletion by removing the local rule', () => {
    const { doc, pm } = setupPoints()
    applyRemote(doc, (peer) => { peer.getMap(POINTS).set('default', { permissionId: 'perm-p' }) })
    expect(pm.getRule('unit-1', 'local-1')).toBeTruthy()
    applyRemote(doc, (peer) => { peer.getMap(POINTS).delete('default') })
    expect(pm.getRule('unit-1', 'local-1')).toBeUndefined()
  })

  it('writes NOTHING into sheetProtection — the backend would lock the whole sheet', () => {
    // The cross-repo assertion. A point association in `sheetProtection` makes every non-admin
    // bot/REST write on that sheet 403 (probe-verified), so this separation is load-bearing, not tidy.
    const { doc, pm } = setupPoints()
    pm.addRule({ unitId: 'unit-1', subUnitId: 'local-1', permissionId: 'perm-p' })
    pm.emit()
    expect(doc.getMap(SHEET_PROTECTION_FIELD).size).toBe(0)
  })

  it('a plain writer cannot push a point change (admin-only, same gate as rules)', () => {
    const { pm, points } = setupPoints(false)
    pm.addRule({ unitId: 'unit-1', subUnitId: 'local-1', permissionId: 'perm-p' })
    pm.emit()
    expect(points.size).toBe(0)
  })

  it('does not echo a remote apply back into the map', () => {
    const { doc, points } = setupPoints()
    // The real WorksheetProtectionPointModel.addRule() calls `_pointChange.next(rule)`
    // SYNCHRONOUSLY, so applying a remote association re-enters our own pointChange$ handler while
    // we are still inside applyRemotePoints — FakePointModel emits for that reason.
    //
    // Assert on LOCAL TRANSACTIONS, not on the map's contents. Once the ledger is recorded
    // (WS-PROT-13) the echo is value-idempotent: it re-writes the identical permissionId, so any
    // size/value assertion holds with the guard deleted and cannot fail. What the guard actually
    // prevents is this client emitting a local update at all — a write it has no business making,
    // which on the real socket is a broadcast to every peer on every open of the document.
    let localWrites = 0
    doc.on('afterTransaction', (tr: Y.Transaction) => { if (tr.local && tr.changed.size > 0) localWrites += 1 })
    applyRemote(doc, (peer) => { peer.getMap(POINTS).set('default', { permissionId: 'perm-p' }) })
    expect(points.get('default')).toEqual({ permissionId: 'perm-p' })
    expect(points.size).toBe(1)
    expect(localWrites).toBe(0)
  })

  it('a local REMOVAL replicates as a delete', () => {
    const { pm, points } = setupPoints()
    pm.addRule({ unitId: 'unit-1', subUnitId: 'local-1', permissionId: 'perm-p' })
    pm.emit()
    expect(points.size).toBe(1)
    pm.deleteRule('unit-1', 'local-1')
    pm.emit()
    expect(points.size).toBe(0)
  })

  it('stops applying after dispose', () => {
    const { doc, binding, pm } = setupPoints()
    binding.dispose()
    applyRemote(doc, (peer) => { peer.getMap(POINTS).set('default', { permissionId: 'perm-p' }) })
    expect(pm.getRule('unit-1', 'local-1')).toBeUndefined()
  })

  it('is inert when no point model is supplied (existing call sites keep working)', () => {
    const univer = new FakeUniver()
    univer.unitId = 'unit-1'
    const doc = new Y.Doc()
    new UniverYjsBinding(univer as never, doc, () => true, {}, null, null, null, null)
    expect(() =>
      applyRemote(doc, (peer) => { peer.getMap(POINTS).set('default', { permissionId: 'p' }) }),
    ).not.toThrow()
  })

  // [REVIEW] The nine tests above all drive the RUNTIME paths — a local mutation, or a remote
  // observer firing on a doc this binding was already attached to. Not one of them opens a doc that
  // ALREADY holds an association, because `setupPoints()` mints a fresh `new Y.Doc()` every time.
  // That isolation hides `runInitialSync`, which is the path a page load / reload takes: it applies
  // cells, dims, merges, drawings, hyperlinks and protection rules explicitly, and a seventh
  // `applyRemotePoints` has to be listed there or the association is never read at open time.
  // Consequence: the toggles replicate live, then come back OFF on the next reload — "the switch
  // looks set but isn't", the same class of failure the whole PR exists to kill.
  it('a fresh binding over a populated doc restores the association into Univer', () => {
    // First session stores an association...
    const first = setupPoints()
    first.pm.addRule({ unitId: 'unit-1', subUnitId: 'local-1', permissionId: 'perm-p' })
    first.pm.emit()
    const snapshot = Y.encodeStateAsUpdate(first.doc)
    first.binding.dispose()

    // ...second session (a reload) starts from the persisted state with an empty model.
    const univer = new FakeUniver()
    univer.unitId = 'unit-1'
    const doc = new Y.Doc()
    Y.applyUpdate(doc, snapshot)
    const pm = new FakePointModel()
    new UniverYjsBinding(
      univer as never, doc, () => true, {}, null, null, null, null,
      () => true, null, pm as never,
    )

    expect(pm.getRule('unit-1', 'local-1')).toEqual({
      unitId: 'unit-1', subUnitId: 'local-1', permissionId: 'perm-p',
    })
  })

  it('restores the association on a legacy doc whose ONLY populated map is sheetPermissionPoints', () => {
    // Mirrors the sheetProtection legacy-V1 case: no sheetList, no cells, just the association.
    const doc = new Y.Doc()
    doc.getMap(POINTS).set('default', { permissionId: 'perm-p' })

    const univer = new FakeUniver()
    univer.unitId = 'unit-1'
    const pm = new FakePointModel()
    new UniverYjsBinding(
      univer as never, doc, () => true, {}, null, null, null, null,
      () => true, null, pm as never,
    )

    expect(pm.getRule('unit-1', 'local-1')).toEqual({
      unitId: 'unit-1', subUnitId: 'local-1', permissionId: 'perm-p',
    })
  })
})

/**
 * WS-PROT-13 — a REMOTE association must be recorded in `lastSeenPoints`, or it can never be removed.
 *
 * `syncPointsToYmap` emits deletes by walking `lastSeenPoints` — that map is the ONLY record of what
 * this client has replicated. `applyRemotePoints` updated Univer but not the ledger, so an association
 * that arrived from a peer was invisible to the delete pass: the admin removed the restriction
 * locally, the live scan correctly found nothing, and the loop had no key to delete. The stale
 * permissionId stayed in the shared map and the restriction stuck for everyone, unremovably.
 *
 * Fixture note: this needs the association to ARRIVE REMOTELY and then be removed LOCALLY. Two
 * directions in one test — a same-direction fixture cannot reach it, which is why the WS-PROT-12
 * suite (all runtime-local, or all remote) missed it.
 */
describe('UniverYjsBinding — a remotely-arrived point association can be removed locally (WS-PROT-13)', () => {
  const POINTS = 'sheetPermissionPoints'

  it('emits the delete after the association arrived from a peer', () => {
    const univer = new FakeUniver()
    univer.unitId = 'unit-1'
    const doc = new Y.Doc()
    const pm = new (class {
      rules = new Map<string, unknown>()
      private readonly subs: Array<() => void> = []
      pointChange$ = { subscribe: (n: () => void) => { this.subs.push(n); return { unsubscribe: () => {} } } }
      addRule(r: { unitId: string; subUnitId: string }) { this.rules.set(`${r.unitId}/${r.subUnitId}`, r) }
      deleteRule(u: string, s: string) { this.rules.delete(`${u}/${s}`) }
      getRule(u: string, s: string) { return this.rules.get(`${u}/${s}`) }
      emit() { for (const f of this.subs) f() }
    })()
    new UniverYjsBinding(
      univer as never, doc, () => true, {}, null, null, null, null,
      () => true, null, pm as never,
    )

    // 1) a PEER sets the association
    applyRemote(doc, (peer) => { peer.getMap(POINTS).set('default', { permissionId: 'perm-p' }) })
    expect(pm.getRule('unit-1', 'local-1')).toBeTruthy()

    // 2) the admin removes it LOCALLY
    pm.deleteRule('unit-1', 'local-1')
    pm.emit()

    // 3) it must be gone from the shared map — otherwise every peer stays restricted forever
    expect(doc.getMap(POINTS).size).toBe(0)
  })
})
