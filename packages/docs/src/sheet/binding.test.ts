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
  /** Coordinates (`r:c`) whose setValue should throw — simulates Univer rejecting a cell. */
  readonly throwOn = new Set<string>()
  constructor(private readonly univer: FakeUniver) {}

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
        // Simulate Univer throwing for a specific cell (e.g. an out-of-range / invalid
        // coordinate the real Facade rejects) so per-cell isolation can be exercised.
        if (self.throwOn.has(self.k(r, c))) throw new Error(`setValue failed at ${r}:${c}`)
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
  readonly sheet: FakeSheet
  private readonly handlers = new Set<(cmd: { id: string; params?: unknown }) => void>()
  constructor() {
    this.sheet = new FakeSheet(this)
  }
  getActiveWorkbook() {
    return { getActiveSheet: () => this.sheet }
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

  it('rejects a remote cell whose coordinate is out of the declared grid (bounds)', () => {
    const { univer, doc } = setup()
    // 1000×100 grid → row 1000 and col 100 are the first out-of-range indices; a negative
    // index is likewise invalid. None must reach setValue (real Facade would throw).
    applyRemote(doc, (peer) => {
      const m = peer.getMap(SHEET_YMAP_FIELD)
      m.set('default!1000:0', { v: 'row-oob' })
      m.set('default!0:100', { v: 'col-oob' })
      m.set('default!-1:0', { v: 'neg' })
    })
    expect(univer.sheet.cells.has('1000:0')).toBe(false)
    expect(univer.sheet.cells.has('0:100')).toBe(false)
    expect(univer.sheet.cells.has('-1:0')).toBe(false)
    // an in-bounds cell in the same batch still applies (last valid index: 999 / 99)
    applyRemote(doc, (peer) => peer.getMap(SHEET_YMAP_FIELD).set('default!999:99', { v: 'edge' }))
    expect(univer.sheet.cells.get('999:99')).toEqual({ v: 'edge' })
  })

  it('isolates a failing cell: one bad setValue does not drop the rest of the batch', () => {
    const { univer, doc } = setup()
    univer.sheet.throwOn.add('1:1') // this cell's setValue will throw
    applyRemote(doc, (peer) => {
      const m = peer.getMap(SHEET_YMAP_FIELD)
      m.set('default!0:0', { v: 'a' })
      m.set('default!1:1', { v: 'boom' }) // throws inside setValue
      m.set('default!2:2', { v: 'c' })
    })
    // The failing cell is skipped, but its neighbours before AND after it still apply.
    expect(univer.sheet.cells.get('0:0')).toEqual({ v: 'a' })
    expect(univer.sheet.cells.has('1:1')).toBe(false)
    expect(univer.sheet.cells.get('2:2')).toEqual({ v: 'c' })
  })

  it('does NOT record lastSeen for a cell whose setValue threw (retry on next pass)', () => {
    const { univer, doc, cellMap } = setup()
    univer.sheet.throwOn.add('0:0')
    applyRemote(doc, (peer) => peer.getMap(SHEET_YMAP_FIELD).set('default!0:0', { v: 'first' }))
    expect(univer.sheet.cells.has('0:0')).toBe(false) // never landed in Univer
    // Once Univer stops rejecting it, a later remote pass on the same key must re-apply —
    // which only happens if lastSeen was NOT poisoned with the value we failed to write.
    univer.sheet.throwOn.delete('0:0')
    applyRemote(doc, (peer) => peer.getMap(SHEET_YMAP_FIELD).set('default!0:0', { v: 'second' }))
    expect(univer.sheet.cells.get('0:0')).toEqual({ v: 'second' })
    expect(cellMap.get('default!0:0')).toEqual({ v: 'second' })
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
    expect(dimMap.get('c2')).toBe(140)
    expect(dimMap.get('c3')).toBe(140)
  })

  it('persists a row-height change from the mutation params', () => {
    const { univer, dimMap } = setup()
    univer.fire({
      id: 'sheet.mutation.set-worksheet-row-height',
      params: { ranges: [{ startRow: 5, endRow: 5, startColumn: 0, endColumn: 0 }], rowHeight: 30 },
    })
    expect(dimMap.get('r5')).toBe(30)
  })

  it('applies a remote column width into the sheet', () => {
    const { univer, doc } = setup()
    applyRemote(doc, (peer) => peer.getMap(SHEET_DIMS_FIELD).set('c1', 88))
    expect(univer.sheet.colWidths.get(1)).toBe(88)
  })
})

describe('UniverYjsBinding — merged cells', () => {
  it('writes an added merge into the merge map', () => {
    const { univer, mergeMap } = setup()
    univer.sheet.merges.add('0:0:1:2')
    univer.fire({ id: 'sheet.mutation.add-worksheet-merge' })
    expect(mergeMap.get('0:0:1:2')).toBe(true)
  })

  it('removes a merge from the map when it is broken apart', () => {
    const { univer, mergeMap } = setup()
    univer.sheet.merges.add('0:0:1:2')
    univer.fire({ id: 'sheet.mutation.add-worksheet-merge' })
    expect(mergeMap.get('0:0:1:2')).toBe(true)
    univer.sheet.merges.delete('0:0:1:2')
    univer.fire({ id: 'sheet.mutation.remove-worksheet-merge' })
    expect(mergeMap.has('0:0:1:2')).toBe(false)
  })

  it('applies a remote merge into the sheet', () => {
    const { univer, doc } = setup()
    applyRemote(doc, (peer) => peer.getMap(SHEET_MERGES_FIELD).set('1:1:2:2', true))
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
