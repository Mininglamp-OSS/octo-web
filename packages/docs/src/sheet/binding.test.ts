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
} from './binding.ts'

type Cell = { v?: unknown; f?: string; s?: Record<string, unknown> } | null

/** Univer's value mutation id — its real setValue triggers this; we mirror that to test echo. */
const SET_RANGE = 'sheet.mutation.set-range-values'

/** A minimal in-memory sheet that mimics the Facade methods the binding calls. */
class FakeSheet {
  readonly cells = new Map<string, Cell>() // key `r:c`
  readonly colWidths = new Map<number, number>()
  readonly rowHeights = new Map<number, number>()
  readonly merges = new Set<string>() // `sr:sc:er:ec`
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
      // Single-cell form.
      getCellStyleData(): Record<string, unknown> | null {
        return self.cells.get(self.k(r, c))?.s ?? null
      },
      setValue(v: Cell): void {
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
      getActiveSheet: () => self.active(),
      getSheets: () => self.sheets,
      getSheetBySheetId: (id: string) => self.sheets.find((s) => s.getSheetId() === id) ?? null,
      insertSheet: (name?: string) => (self.blockInsertSheet ? null : self.addSheet(name)),
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

/** Push a peer's change into `doc` the way Hocuspocus does: apply a remote (non-local) update. */
function applyRemote(doc: Y.Doc, mutate: (peer: Y.Doc) => void): void {
  const peer = new Y.Doc()
  // Seed the peer with our current state so its update is a clean delta, then mutate.
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
  mutate(peer)
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)))
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
