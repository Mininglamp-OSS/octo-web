// Univer ↔ Yjs collaborative binding (V1: cell values + formulas).
//
// Design rationale (see also collab/createCollabEditor.ts, which this mirrors):
//   - The docs backend is a generic Hocuspocus server that syncs ANY Y.Doc keyed
//     by documentName; it is content-agnostic for sync/persistence/permission.
//   - A spreadsheet therefore rides the SAME backend as a regular `document`-kind
//     key, but stores its payload in a dedicated Y.Map ('sheet') instead of the
//     Tiptap XmlFragment. No change to the FROZEN documentName contract.
//   - Univer's own real-time collaboration is a paid Pro feature; we do NOT use it.
//     Instead we bind Univer's workbook model to Yjs ourselves (this file) and let
//     the existing Hocuspocus infra carry the CRDT updates — free, and the same
//     channel bots write through (agent/openDirectConnection on the backend).
//
// Granularity: per-cell. The Y.Map is keyed `${sheetId}!${row}:${col}` -> ICellData
// ({ v, f }). This gives cell-level CRDT merge (two users editing different cells
// never conflict), unlike whole-snapshot sync which is last-write-wins on the doc.
//
// Local -> Yjs: we listen for the value mutation and diff the active sheet's cell
// matrix against a cached copy, writing only changed cells. We diff (rather than
// read the mutation params) so the binding depends only on verified Facade APIs
// (getSnapshot / getRange / setValue / onCommandExecuted), not on mutation-param
// internals.
//
// V1 scope: cell value + formula + style (font / color / size / bg / align,
// carried as the RESOLVED IStyleData — see note on `s` below). Out of scope
// (follow-ups): merges, row/col insert/delete, multiple sheets create/remove,
// frozen panes.

import * as Y from 'yjs'
// Side-effect import: pulls in the sheets Facade augmentation that adds
// getActiveWorkbook()/getActiveSheet()/etc. onto FUniver via `declare module`.
// Without it, `import type { FUniver }` alone doesn't include the augmentation.
import '@univerjs/preset-sheets-core'
import type { FUniver } from '@univerjs/core/lib/facade'

/**
 * Commands/mutations that change cell content we sync. Values funnel through the
 * set-range-values MUTATION; style/border come in as their own COMMANDs (onCommandExecuted
 * fires for both). We re-diff on any of them, so the diff — not the id — is the
 * source of truth for what actually changed.
 */
const TRIGGER_IDS = new Set<string>([
  'sheet.mutation.set-range-values', // cell value / formula (and often style too)
  'sheet.command.set-style', // font/color/size/bg/align via toolbar
  'sheet.command.set-border-style', // cell borders
])

/**
 * Mutations that change column widths / row heights. These carry a resize's final size;
 * we re-read the worksheet's sparse column/row size data on any of them and sync the diff,
 * so a resize survives reload (persisted in the Y.Doc) and replicates to other clients.
 */
const DIM_TRIGGER_IDS = new Set<string>([
  'sheet.mutation.set-worksheet-col-width',
  'sheet.mutation.set-worksheet-row-height',
])

/** The Y.Map field holding column-width / row-height overrides (keys `c<idx>` / `r<idx>`). */
export const SHEET_DIMS_FIELD = 'sheetDims'

/** Mutations that add/remove merged cell ranges. */
const MERGE_TRIGGER_IDS = new Set<string>([
  'sheet.mutation.add-worksheet-merge',
  'sheet.mutation.remove-worksheet-merge',
])

/** The Y.Map field holding merged ranges (keys `sr:sc:er:ec`). */
export const SHEET_MERGES_FIELD = 'sheetMerges'

/** The Y.Map field name on the shared Y.Doc that holds spreadsheet payload. */
export const SHEET_YMAP_FIELD = 'sheet'

/**
 * Logical sheet key used in cell keys (`${SHEET_KEY}!${row}:${col}`).
 *
 * CRITICAL: we do NOT key by Univer's workbook sheet id. `createWorkbook({})`
 * generates a RANDOM sheet id per instance, so two clients (or the same client on
 * reopen) get DIFFERENT ids — cells written under one id would be invisible under
 * another, breaking cross-client sync AND making edits "vanish" on reopen. V1 is
 * single-sheet, so we pin a stable logical key that every client agrees on and
 * always apply remote cells to the active sheet. (Multi-sheet: map real ids later.)
 */
const SHEET_KEY = 'default'

/**
 * Hard bounds for remote cell coordinates. The declared grid is 1000×100 (see
 * CollabSheet.ts createWorkbook rowCount/columnCount). A remote peer (or a corrupted /
 * hostile Y.Map key) could carry an out-of-range or negative coordinate; applying it via
 * getRange(row,col).setValue would either throw or write outside the declared grid. We
 * clamp-reject anything outside [0,MAX) as a safety ceiling that never depends on the
 * Facade exposing getMaxRows/getMaxColumns.
 */
const SHEET_MAX_ROWS = 1000
const SHEET_MAX_COLS = 100

/** Minimal cell shape we sync in V1: value, formula, and resolved style. */
interface SyncCell {
  v?: string | number | boolean | null
  f?: string
  /**
   * Resolved style object (IStyleData), NOT a style id. Univer's ICellData.s may
   * be `IStyleData | string`, where the string is an id into the workbook's local
   * style registry — which a remote peer does not share. So we always sync the
   * resolved object (via getCellStyleData) and write it back inline.
   */
  s?: Record<string, unknown>
}

function cellKey(sheetId: string, row: number, col: number): string {
  return `${sheetId}!${row}:${col}`
}

/**
 * Extract the V1-relevant fields from a Univer ICellData. `resolveStyle` is only
 * invoked when the raw style is a string id (needs resolving to an inline object);
 * an already-inline style object is used as-is.
 */
function pickCell(cell: unknown, resolveStyle: () => Record<string, unknown> | null): SyncCell | null {
  if (cell == null || typeof cell !== 'object') return null
  const c = cell as { v?: SyncCell['v']; f?: string; s?: Record<string, unknown> | string }
  const out: SyncCell = {}
  if (c.v !== undefined) out.v = c.v
  if (c.f !== undefined) out.f = c.f
  if (c.s != null) {
    const resolved = typeof c.s === 'string' ? resolveStyle() : c.s
    if (resolved && Object.keys(resolved).length > 0) out.s = resolved
  }
  return out.v === undefined && out.f === undefined && out.s === undefined ? null : out
}

function stylesEqual(a: SyncCell['s'], b: SyncCell['s']): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

function cellsEqual(a: SyncCell | null, b: SyncCell | null): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return a.v === b.v && a.f === b.f && stylesEqual(a.s, b.s)
}

/**
 * Binds a running Univer instance (via its Facade `univerAPI`) to a Y.Doc so that
 * cell edits replicate both ways. Construct AFTER the workbook exists. Call
 * dispose() on teardown.
 */
export class UniverYjsBinding {
  private readonly ymap: Y.Map<SyncCell>
  private readonly commandDisposable: { dispose(): void }
  private readonly observer: (events: Y.YMapEvent<SyncCell>) => void
  /** Guards against echo: while applying a remote change we must not re-emit it. */
  private applyingRemote = false
  /** Last-known cell matrix per sheet, for diffing local edits. */
  private readonly lastSeen = new Map<string, SyncCell | null>()
  /** Column-width / row-height overrides map + its last-known state (keys `c<idx>`/`r<idx>`). */
  private readonly dimMap: Y.Map<number>
  private readonly dimObserver: (event: Y.YMapEvent<number>) => void
  private readonly lastSeenDims = new Map<string, number>()
  /** Merged ranges map + last-known state (keys `sr:sc:er:ec`). */
  private readonly mergeMap: Y.Map<boolean>
  private readonly mergeObserver: (event: Y.YMapEvent<boolean>) => void
  private readonly lastSeenMerges = new Set<string>()
  private disposed = false

  constructor(
    private readonly univerAPI: FUniver,
    ydoc: Y.Doc,
    /**
     * Live write-gate. When it returns false (reader / downgraded role) NO local edit is
     * written to the shared Y.Map — remote changes still apply INTO Univer (read stays live),
     * but the local user's edits never leave the client, so nothing dirty persists to
     * IndexedDB to replay on a later upgrade. The backend also rejects such writes; this is
     * the client-side belt-and-suspenders (§B3).
     */
    private readonly canWrite: () => boolean = () => true,
  ) {
    this.ymap = ydoc.getMap<SyncCell>(SHEET_YMAP_FIELD)

    // 1) Seed: if the Y.Doc already has cells (joined an existing session), push them into
    //    Univer; otherwise seed the Y.Map from the freshly created book — but only if this
    //    client may write (a reader on a brand-new doc must not author the seed).
    if (this.ymap.size > 0) {
      this.applyRemoteToUniver(Array.from(this.ymap.keys()))
    } else if (this.canWrite()) {
      this.seedYmapFromUniver()
    }

    // 2) Local -> Yjs: diff on every relevant value/style command, write changes.
    this.commandDisposable = this.univerAPI.onCommandExecuted(
      (command: { id: string; params?: unknown }) => {
        if (this.disposed || this.applyingRemote) return
        if (!this.canWrite()) return // reader / downgraded: never write local edits to the shared doc
        if (TRIGGER_IDS.has(command.id)) this.syncLocalToYmap()
        else if (DIM_TRIGGER_IDS.has(command.id)) this.syncDimFromCommand(command)
        else if (MERGE_TRIGGER_IDS.has(command.id)) this.syncMergesToYmap()
      },
    )

    // 3) Yjs -> Univer: apply remote cell changes.
    this.observer = (event: Y.YMapEvent<SyncCell>) => {
      if (this.disposed) return
      // Skip our own local transactions (those originate from syncLocalToYmap).
      if (event.transaction.local) return
      this.applyRemoteToUniver(Array.from(event.keys.keys()))
    }
    this.ymap.observe(this.observer)

    // 4) Column-width / row-height sync (its own map, same two-way pattern as cells).
    this.dimMap = ydoc.getMap<number>(SHEET_DIMS_FIELD)
    if (this.dimMap.size > 0) this.applyRemoteDims(Array.from(this.dimMap.keys()))
    this.dimObserver = (event: Y.YMapEvent<number>) => {
      if (this.disposed || event.transaction.local) return
      this.applyRemoteDims(Array.from(event.keys.keys()))
    }
    this.dimMap.observe(this.dimObserver)

    // 5) Merged-cell sync (its own map, same two-way pattern).
    this.mergeMap = ydoc.getMap<boolean>(SHEET_MERGES_FIELD)
    if (this.mergeMap.size > 0) this.applyRemoteMerges(Array.from(this.mergeMap.keys()))
    this.mergeObserver = (event: Y.YMapEvent<boolean>) => {
      if (this.disposed || event.transaction.local) return
      this.applyRemoteMerges(Array.from(event.keys.keys()))
    }
    this.mergeMap.observe(this.mergeObserver)
  }

  /** Read the active sheet's used (content) cell grid as keyed SyncCells. */
  private readGrid(): { sheetId: string; cells: Map<string, SyncCell | null> } | null {
    const workbook = this.univerAPI.getActiveWorkbook()
    if (!workbook) return null
    const sheet = workbook.getActiveSheet()
    if (!sheet) return null
    const cells = new Map<string, SyncCell | null>()
    // Scan only the used (content) range, NOT getMaxRows()×getMaxColumns(). The declared
    // sheet is large (1000×100, so out-of-range formula refs resolve) but almost always
    // sparse; iterating the full declared grid would cost 100k getCellRaw() calls on every
    // keystroke. getLastRow()/getLastColumn() return the last row/col WITH content (-1 when
    // empty), so an empty sheet scans nothing.
    const lastRow = sheet.getLastRow()
    const lastCol = sheet.getLastColumn()
    const rows = lastRow + 1
    const cols = lastCol + 1
    if (rows <= 0 || cols <= 0) return { sheetId: SHEET_KEY, cells }
    const grid = sheet.getRange(0, 0, rows, cols).getCellDataGrid()
    for (let r = 0; r < grid.length; r++) {
      const rowArr = grid[r] ?? []
      for (let c = 0; c < rowArr.length; c++) {
        // Key by the stable logical SHEET_KEY (not Univer's random sheet id) so all
        // clients / reopens agree on the same cell keys. resolveStyle is only called
        // when the cell's raw style is a string id (getCellStyleData resolves it).
        cells.set(
          cellKey(SHEET_KEY, r, c),
          pickCell(rowArr[c], () => sheet.getRange(r, c).getCellStyleData() as Record<string, unknown> | null),
        )
      }
    }
    return { sheetId: SHEET_KEY, cells }
  }

  private seedYmapFromUniver(): void {
    const grid = this.readGrid()
    if (!grid) return
    this.ymap.doc?.transact(() => {
      for (const [key, cell] of grid.cells) {
        this.lastSeen.set(key, cell)
        if (cell) this.ymap.set(key, cell)
      }
    })
  }

  /** Diff the live grid vs lastSeen; write only changed cells into the Y.Map. */
  private syncLocalToYmap(): void {
    const grid = this.readGrid()
    if (!grid) return
    const changed: Array<[string, SyncCell | null]> = []
    for (const [key, cell] of grid.cells) {
      if (!cellsEqual(this.lastSeen.get(key) ?? null, cell)) changed.push([key, cell])
    }
    // Cells we synced before but that now fall OUTSIDE the (shrunk) used range: clearing
    // the last content cell makes getLastRow/Col contract, so those keys no longer appear
    // in grid.cells. They can only have become empty, so emit deletes for them — otherwise
    // a stale value would linger in the Y.Map.
    for (const [key, prev] of this.lastSeen) {
      if (prev !== null && !grid.cells.has(key)) changed.push([key, null])
    }
    if (changed.length === 0) return
    this.ymap.doc?.transact(() => {
      for (const [key, cell] of changed) {
        this.lastSeen.set(key, cell)
        if (cell) this.ymap.set(key, cell)
        else this.ymap.delete(key)
      }
    })
  }

  /** Apply a set of remote-changed keys from the Y.Map into Univer's active sheet. */
  private applyRemoteToUniver(keys: string[]): void {
    const workbook = this.univerAPI.getActiveWorkbook()
    if (!workbook) return
    const sheet = workbook.getActiveSheet()
    if (!sheet) return
    this.applyingRemote = true
    try {
      for (const key of keys) {
        const [keySheetId, rc] = key.split('!')
        // V1 single-sheet: only our logical key; always apply to the active sheet
        // (Univer's own sheet id differs per client, so we never compare against it).
        if (keySheetId !== SHEET_KEY || !rc) continue
        const [rowStr, colStr] = rc.split(':')
        const row = Number(rowStr)
        const col = Number(colStr)
        if (!Number.isInteger(row) || !Number.isInteger(col)) continue
        // Bounds: reject coordinates outside the declared grid. A corrupted / hostile
        // remote key must never drive getRange() out of range (throws) or write past the
        // sheet. Silently skip — the peer that authored it is authoritative for its own
        // grid; we simply don't apply what we can't represent.
        if (row < 0 || row >= SHEET_MAX_ROWS || col < 0 || col >= SHEET_MAX_COLS) continue
        const cell = this.ymap.get(key) ?? null
        // Per-cell isolation: one bad cell's setValue must not abort the whole batch,
        // otherwise a single malformed remote value would silently drop every remaining
        // cell in the same event. And record lastSeen ONLY after setValue succeeds — if
        // it threw, lastSeen must not claim we applied a value Univer never received,
        // which would make the local diff treat the cell as synced forever (divergence).
        try {
          sheet.getRange(row, col).setValue(cell ?? { v: null })
          this.lastSeen.set(key, cell)
        } catch {
          // leave lastSeen untouched so a later local/remote pass can retry this cell
        }
      }
    } finally {
      this.applyingRemote = false
    }
  }

  /**
   * Persist a column-width / row-height change from its mutation params (the sheet Facade
   * exposes no snapshot on this build, so we read the authoritative mutation payload). The
   * col-width mutation carries `{ ranges, colWidth }`, row-height `{ ranges, rowHeight }`.
   */
  private syncDimFromCommand(command: { id: string; params?: unknown }): void {
    const p = command.params as
      | {
          ranges?: Array<{ startRow: number; endRow: number; startColumn: number; endColumn: number }>
          colWidth?: number
          rowHeight?: number
        }
      | undefined
    if (!p?.ranges) return
    const isCol = command.id.includes('col-width')
    const size = isCol ? p.colWidth : p.rowHeight
    if (typeof size !== 'number') return
    const entries: Array<[string, number]> = []
    for (const rg of p.ranges) {
      if (isCol) {
        for (let c = rg.startColumn; c <= rg.endColumn; c++) entries.push([`c${c}`, size])
      } else {
        for (let r = rg.startRow; r <= rg.endRow; r++) entries.push([`r${r}`, size])
      }
    }
    if (entries.length === 0) return
    this.dimMap.doc?.transact(() => {
      for (const [k, v] of entries) {
        this.lastSeenDims.set(k, v)
        this.dimMap.set(k, v)
      }
    })
  }
  /** Apply remote column-width / row-height changes into Univer's active sheet. */
  private applyRemoteDims(keys: string[]): void {
    const sheet = this.univerAPI.getActiveWorkbook()?.getActiveSheet()
    if (!sheet) return
    const ws = sheet as unknown as {
      setColumnWidth?: (col: number, width: number) => void
      setRowHeight?: (row: number, height: number) => void
    }
    this.applyingRemote = true
    try {
      for (const key of keys) {
        const idx = Number(key.slice(1))
        if (!Number.isInteger(idx)) continue
        const v = this.dimMap.get(key)
        if (v == null) {
          this.lastSeenDims.delete(key)
          continue
        }
        this.lastSeenDims.set(key, v)
        if (key.startsWith('c')) ws.setColumnWidth?.(idx, v)
        else if (key.startsWith('r')) ws.setRowHeight?.(idx, v)
      }
    } finally {
      this.applyingRemote = false
    }
  }

  /** Current merged ranges of the active sheet as `sr:sc:er:ec` keys. */
  private readMerges(): Set<string> {
    const out = new Set<string>()
    const sheet = this.univerAPI.getActiveWorkbook()?.getActiveSheet()
    if (!sheet) return out
    const data =
      (sheet as unknown as {
        getMergeData?: () => Array<{
          getRange?: () => { startRow: number; startColumn: number; endRow: number; endColumn: number }
        }>
      }).getMergeData?.() ?? []
    for (const fr of data) {
      const r = fr.getRange?.()
      if (r) out.add(`${r.startRow}:${r.startColumn}:${r.endRow}:${r.endColumn}`)
    }
    return out
  }

  /** Diff current merges vs lastSeen; write additions/removals into the merge map. */
  private syncMergesToYmap(): void {
    const cur = this.readMerges()
    const changed: Array<[string, boolean | null]> = []
    for (const k of cur) if (!this.lastSeenMerges.has(k)) changed.push([k, true])
    for (const k of this.lastSeenMerges) if (!cur.has(k)) changed.push([k, null])
    if (changed.length === 0) return
    this.mergeMap.doc?.transact(() => {
      for (const [k, v] of changed) {
        if (v === null) {
          this.lastSeenMerges.delete(k)
          this.mergeMap.delete(k)
        } else {
          this.lastSeenMerges.add(k)
          this.mergeMap.set(k, true)
        }
      }
    })
  }

  /** Apply remote merge add/remove into Univer's active sheet. */
  private applyRemoteMerges(keys: string[]): void {
    const sheet = this.univerAPI.getActiveWorkbook()?.getActiveSheet()
    if (!sheet) return
    this.applyingRemote = true
    try {
      for (const key of keys) {
        const p = key.split(':').map(Number)
        if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) continue
        const [sr, sc, er, ec] = p
        const range = sheet.getRange(sr, sc, er - sr + 1, ec - sc + 1) as unknown as {
          merge?: () => void
          breakApart?: () => void
        }
        if (this.mergeMap.get(key)) {
          this.lastSeenMerges.add(key)
          try {
            range.merge?.()
          } catch {
            // conflicts with an existing merge — ignore
          }
        } else {
          this.lastSeenMerges.delete(key)
          try {
            range.breakApart?.() // best-effort remote unmerge (facade may not expose it)
          } catch {
            // ignore
          }
        }
      }
    } finally {
      this.applyingRemote = false
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.commandDisposable.dispose()
    this.ymap.unobserve(this.observer)
    this.dimMap.unobserve(this.dimObserver)
    this.mergeMap.unobserve(this.mergeObserver)
    this.lastSeen.clear()
    this.lastSeenDims.clear()
    this.lastSeenMerges.clear()
  }
}
