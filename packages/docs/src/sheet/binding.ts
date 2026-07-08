// Univer ↔ Yjs collaborative binding (V2: MULTI-sheet — cells + formulas + styles
// + column/row sizes + merges + the sheet set itself).
//
// Design rationale (see also collab/createCollabEditor.ts, which this mirrors):
//   - The docs backend is a generic Hocuspocus server that syncs ANY Y.Doc keyed
//     by documentName; it is content-agnostic for sync/persistence/permission.
//   - A spreadsheet rides the SAME backend, storing its payload in dedicated Y.Maps
//     ('sheet' / 'sheetDims' / 'sheetMerges' / 'sheetList') instead of the Tiptap
//     XmlFragment. No change to the FROZEN documentName contract.
//   - Univer's own real-time collaboration is a paid Pro feature; we do NOT use it.
//     We bind Univer's workbook model to Yjs ourselves and ride the free Hocuspocus
//     infra (the same channel bots write through).
//   - Remote-created sheets replay dims/merges by `${id}:` prefix (Yjs does not order
//     cross-Y.Map observers within a transaction); dim values are bounded; merge ops
//     require strict `=== true` (add) / key-deletion (remove) to avoid dropping data.
//
// MULTI-SHEET identity — the crux (why V1 was single-sheet):
//   Univer assigns each worksheet a runtime id that DIFFERS per client (and per
//   reopen). Keying shared cells by that id would make one client's Sheet2 invisible
//   to another. So we introduce a STABLE *logical* sheet id that every client agrees
//   on, carried in the shared 'sheetList' registry, and keep a per-client
//   local(univer)-id ⇄ logical-id map. All shared keys use the logical id:
//     cells   'sheet'       ->  `${logicalId}!${row}:${col}`
//     dims    'sheetDims'   ->  `${logicalId}:c<idx>` / `${logicalId}:r<idx>`
//     merges  'sheetMerges' ->  `${logicalId}:sr:sc:er:ec`
//     sheets  'sheetList'   ->  logicalId -> { name, order }
//   The first sheet of a freshly-seeded book keeps logicalId 'default' so docs created
//   under the V1 single-sheet scheme keep working unchanged.
//
// Lifecycle sync follows the same DIFF philosophy as cells: on any sheet
// insert/remove/rename/reorder command we re-read getSheets() and diff it against the
// registry (we do NOT parse mutation params). Remote registry changes are reconciled
// into Univer (create/delete/rename sheets), then that sheet's existing cells apply.

import * as Y from 'yjs'
// Side-effect import: pulls in the sheets Facade augmentation that adds
// getActiveWorkbook()/getActiveSheet()/getSheets()/insertSheet()/etc. onto the facade.
import '@univerjs/preset-sheets-core'
import type { FUniver } from '@univerjs/core/lib/facade'

/** Cell value/style commands we sync (see V1 note — diff is the source of truth). */
const TRIGGER_IDS = new Set<string>([
  'sheet.mutation.set-range-values',
  'sheet.command.set-style',
  'sheet.command.set-border-style',
])

/** Column-width / row-height mutations. */
const DIM_TRIGGER_IDS = new Set<string>([
  'sheet.mutation.set-worksheet-col-width',
  'sheet.mutation.set-worksheet-row-height',
])

/** Add/remove merge mutations. */
const MERGE_TRIGGER_IDS = new Set<string>([
  'sheet.mutation.add-worksheet-merge',
  'sheet.mutation.remove-worksheet-merge',
])

/** Sheet-set lifecycle: create / delete / rename / reorder / copy a worksheet. */
const SHEET_LIFECYCLE_IDS = new Set<string>([
  'sheet.command.insert-sheet',
  'sheet.command.remove-sheet',
  'sheet.command.copy-sheet',
  'sheet.command.set-worksheet-name',
  'sheet.command.set-worksheet-order',
  'sheet.mutation.insert-sheet',
  'sheet.mutation.remove-sheet',
  'sheet.mutation.set-worksheet-name',
])

export const SHEET_YMAP_FIELD = 'sheet'
export const SHEET_DIMS_FIELD = 'sheetDims'
export const SHEET_MERGES_FIELD = 'sheetMerges'
/** Registry of logical sheets: logicalId -> { name, order }. */
export const SHEET_LIST_FIELD = 'sheetList'

/**
 * The logical id used for the first/only sheet of a freshly-seeded book. Kept as
 * 'default' so V1 single-sheet docs (whose cell keys are `default!r:c`) keep working.
 */
const DEFAULT_SHEET_ID = 'default'

/**
 * Hard bounds for remote cell coordinates (the declared grid is 1000×100 — see
 * CollabSheet.createWorkbook). A corrupted / hostile remote key must never drive
 * getRange() out of range (throws) or write past the sheet; clamp-reject anything
 * outside [0,MAX) without depending on the Facade exposing getMaxRows/getMaxColumns.
 */
const SHEET_MAX_ROWS = 1000
const SHEET_MAX_COLS = 100
// Sanity ceiling for a single remote row-height / column-width value (px). A hostile or
// buggy peer must not be able to push NaN / Infinity / negative / absurd sizes straight
// into setColumnWidth/setRowHeight and corrupt layout for every collaborator.
const SHEET_MAX_DIM_PX = 2000

interface SyncCell {
  v?: string | number | boolean | null
  f?: string
  s?: Record<string, unknown>
}

interface SheetMeta {
  name: string
  order: number
}

function cellKey(logicalId: string, row: number, col: number): string {
  return `${logicalId}!${row}:${col}`
}

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

/** Minimal FWorksheet surface we rely on. */
interface WSLike {
  getSheetId(): string
  getSheetName?(): string
  setName?(name: string): void
  getLastRow(): number
  getLastColumn(): number
  getRange(row: number, col: number, rows?: number, cols?: number): {
    getCellDataGrid(): unknown[][]
    getCellStyleData(): unknown
    setValue(v: unknown): void
    merge?(): void
    breakApart?(): void
  }
  setColumnWidth?(col: number, width: number): void
  setRowHeight?(row: number, height: number): void
  getMergeData?(): Array<{ getRange?(): { startRow: number; startColumn: number; endRow: number; endColumn: number } }>
}
interface WBLike {
  getSheets(): WSLike[]
  getActiveSheet(): WSLike | null
  getSheetBySheetId?(id: string): WSLike | null
  setActiveSheet?(sheet: string | WSLike): void
  insertSheet?(name?: string): WSLike | null
  deleteSheet?(sheet: string | WSLike): void
  moveSheet?(sheet: WSLike, index: number): void
}

/**
 * Binds a running Univer instance to a Y.Doc so multi-sheet edits replicate both ways.
 * Construct AFTER the workbook exists. Call dispose() on teardown.
 */
export class UniverYjsBinding {
  private readonly ymap: Y.Map<SyncCell>
  private readonly dimMap: Y.Map<number>
  private readonly mergeMap: Y.Map<boolean>
  private readonly sheetListMap: Y.Map<SheetMeta>
  private readonly commandDisposable: { dispose(): void }
  private readonly observer: (events: Y.YMapEvent<SyncCell>) => void
  private readonly dimObserver: (event: Y.YMapEvent<number>) => void
  private readonly mergeObserver: (event: Y.YMapEvent<boolean>) => void
  private readonly sheetListObserver: (event: Y.YMapEvent<SheetMeta>) => void
  private applyingRemote = false
  private readonly lastSeen = new Map<string, SyncCell | null>()
  private readonly lastSeenDims = new Map<string, number>()
  private readonly lastSeenMerges = new Set<string>()
  /** logical id -> local (univer) sheet id, and the reverse. */
  private readonly logicalToLocal = new Map<string, string>()
  private readonly localToLogical = new Map<string, string>()
  private disposed = false
  private initialSynced = false

  constructor(
    private readonly univerAPI: FUniver,
    ydoc: Y.Doc,
    private readonly canWrite: () => boolean = () => true,
    private readonly opts: { deferInitialSync?: boolean } = {},
  ) {
    this.ymap = ydoc.getMap<SyncCell>(SHEET_YMAP_FIELD)
    this.dimMap = ydoc.getMap<number>(SHEET_DIMS_FIELD)
    this.mergeMap = ydoc.getMap<boolean>(SHEET_MERGES_FIELD)
    this.sheetListMap = ydoc.getMap<SheetMeta>(SHEET_LIST_FIELD)

    // 1) Establish the sheet set + identity map, then seed or apply content.
    //    Runs synchronously by default. When the host (CollabSheet) sets `deferInitialSync`,
    //    this is postponed and driven by `initialSync()` AFTER local/remote sync has settled —
    //    so a writer never authors a `sheetList.default` entry over an empty-LOOKING doc that is
    //    about to sync in with an existing (possibly renamed) first sheet, which LWW would then
    //    revert back to "Sheet1" (P1-B). Observers below still attach eagerly so any changes that
    //    arrive during the wait are captured (and replayed by the deferred initialSync).
    if (!this.opts.deferInitialSync) this.runInitialSync(true)

    // 2) Local -> Yjs.
    this.commandDisposable = this.univerAPI.onCommandExecuted(
      (command: { id: string; params?: unknown }) => {
        if (this.disposed || this.applyingRemote) return
        if (!this.canWrite()) return
        if (TRIGGER_IDS.has(command.id)) this.syncLocalToYmap()
        else if (DIM_TRIGGER_IDS.has(command.id)) this.syncDimFromCommand(command)
        else if (MERGE_TRIGGER_IDS.has(command.id)) this.syncMergesToYmap()
        else if (SHEET_LIFECYCLE_IDS.has(command.id)) {
          this.syncSheetListFromUniver()
          // A rename/insert may also expose new content on the (now-)active sheet.
          this.syncLocalToYmap()
        }
      },
    )

    // 3) Yjs -> Univer (cells).
    this.observer = (event: Y.YMapEvent<SyncCell>) => {
      if (this.disposed || event.transaction.local) return
      this.applyRemoteToUniver(Array.from(event.keys.keys()))
    }
    this.ymap.observe(this.observer)

    // 4) dims.
    this.dimObserver = (event: Y.YMapEvent<number>) => {
      if (this.disposed || event.transaction.local) return
      this.applyRemoteDims(Array.from(event.keys.keys()))
    }
    this.dimMap.observe(this.dimObserver)

    // 5) merges.
    this.mergeObserver = (event: Y.YMapEvent<boolean>) => {
      if (this.disposed || event.transaction.local) return
      this.applyRemoteMerges(Array.from(event.keys.keys()))
    }
    this.mergeMap.observe(this.mergeObserver)

    // 6) sheet set (registry). Remote add/remove/rename/reorder -> reconcile Univer,
    //    then apply any content that already exists for a newly-created sheet.
    this.sheetListObserver = (event: Y.YMapEvent<SheetMeta>) => {
      if (this.disposed || event.transaction.local) return
      const created = this.reconcileSheetsFromRegistry()
      if (created.length > 0) {
        const prefixes = created.map((id) => `${id}!`)
        this.applyRemoteToUniver(Array.from(this.ymap.keys()).filter((k) => prefixes.some((p) => k.startsWith(p))))
        // Mirror the constructor join path (lines 195-197): a runtime remote-created sheet
        // must also replay its dims & merges, not just cells. Yjs does not guarantee observer
        // firing order across separate Y.Maps in one transaction, so if dimMap/mergeMap
        // observers fired BEFORE the mapping existed, those keys were skipped and never
        // retried — the new sheet would show cell values but lose column widths / row heights /
        // merges until a reload. Dims/merges keys are `${logicalId}:...`, so filter by `${id}:`.
        const dimMergePrefixes = created.map((id) => `${id}:`)
        const belongs = (k: string) => dimMergePrefixes.some((p) => k.startsWith(p))
        this.applyRemoteDims(Array.from(this.dimMap.keys()).filter(belongs))
        this.applyRemoteMerges(Array.from(this.mergeMap.keys()).filter(belongs))
      }
    }
    this.sheetListMap.observe(this.sheetListObserver)
  }

  private workbook(): WBLike | null {
    return (this.univerAPI.getActiveWorkbook() as unknown as WBLike) ?? null
  }

  /**
   * Establish the sheet set + identity map, then seed or apply content. Idempotent: the first
   * call wins; later calls (e.g. a defensive re-invoke) are no-ops. Splitting this out of the
   * constructor lets CollabSheet defer the "author a brand-new registry" decision until AFTER
   * IndexedDB / the provider have synced, so a writer opening an EXISTING sheet on a cold cache
   * never falls into the brand-new branch and clobbers a persisted rename (P1-B).
   */
  private runInitialSync(canAuthorRegistry: boolean): void {
    if (this.initialSynced) return
    if (this.sheetListMap.size > 0) {
      // Joined an existing session: make local Univer match the shared registry, then
      // pull in all cells / dims / merges. Safe regardless of network state — the registry
      // is already populated, so no authoring decision is made.
      this.initialSynced = true
      this.reconcileSheetsFromRegistry()
      this.applyRemoteToUniver(Array.from(this.ymap.keys()))
      this.applyRemoteDims(Array.from(this.dimMap.keys()))
      this.applyRemoteMerges(Array.from(this.mergeMap.keys()))
    } else if (this.ymap.size > 0 || this.dimMap.size > 0 || this.mergeMap.size > 0) {
      // Legacy V1 single-sheet doc: has populated `default!r:c` cells (and/or dims/merges)
      // but NO sheetList registry. Map the first local sheet to the 'default' logical id,
      // register it for writers (so it joins the multi-sheet lifecycle going forward),
      // then apply the pre-existing content into the fresh Univer workbook. Without this
      // the doc would fall into the brand-new path below and render blank.
      this.initialSynced = true
      this.seedIdentityFromUniver({ registerToYmap: this.canWrite() })
      this.applyRemoteToUniver(Array.from(this.ymap.keys()))
      this.applyRemoteDims(Array.from(this.dimMap.keys()))
      this.applyRemoteMerges(Array.from(this.mergeMap.keys()))
    } else if (this.canWrite()) {
      // Doc LOOKS empty. This is either a genuinely brand-new doc we may author, OR a COLD
      // cache whose persisted (possibly renamed) registry hasn't arrived over the network yet.
      // Authoring `sheetList.default` now — before the network delivers that registry — lets LWW
      // revert a remote rename (P1-1). So only author once the NETWORK is authoritative.
      if (!canAuthorRegistry) {
        // A LOCAL-only signal fired first (y-indexeddb `whenSynced` resolves on an empty cache
        // near-instantly with all Y.Maps still empty). Do NOT author and do NOT mark initialSynced:
        // a later provider-`synced` seal re-runs this with canAuthorRegistry=true and authors
        // against the settled (network-merged) doc. If the persisted registry arrives meanwhile,
        // the sheetList observer reconciles it and the eventual re-run hits the size>0 branch above
        // (skips authoring). The Univer default workbook already renders, so nothing is blank.
        return
      }
      // Network is synced: reaching here guarantees the doc really is empty (not a pre-sync
      // empty-looking cache), so authoring the registry can't revert a rename.
      this.initialSynced = true
      this.seedIdentityFromUniver()
      this.seedContentFromUniver()
    } else {
      // Reader on an empty doc: never authors, so it's safe regardless of network state. Map
      // local sheets so later remote content applies.
      this.initialSynced = true
      this.seedIdentityFromUniver({ registerToYmap: false })
    }
  }

  /**
   * Drive the deferred initial sync once the host knows local/remote state has settled
   * (IndexedDB replayed and/or provider `synced`). No-op if already run — either because
   * `deferInitialSync` was not set (constructor already ran it) or a prior call landed.
   * If content arrived via observers during the wait it is already in Univer; this call
   * only ensures the seed/registry decision runs against the settled doc, exactly once.
   *
   * @param canAuthorRegistry whether authoring a brand-new registry is allowed now. Pass `true`
   *   only when the NETWORK provider is synced (network-authoritative). Pass `false` when driven
   *   by a purely local signal (y-indexeddb `whenSynced`) so a cold cache can't seed a registry
   *   ahead of the persisted one and revert a remote rename (P1-1).
   */
  initialSync(canAuthorRegistry = true): void {
    this.runInitialSync(canAuthorRegistry)
  }

  /** Whether the one-shot initial sync has actually committed (registry authored or reconciled).
   *  A deferred cold-cache local-only wake returns without committing, so callers can tell a real
   *  seal from a no-op and re-drive on the later network-synced signal (P1-1). */
  hasInitialSynced(): boolean {
    return this.initialSynced
  }

  /**
   * The logical sheet id of the CURRENTLY-ACTIVE Univer sheet (the value comment anchors and
   * cursor awareness must carry so multi-sheet overlays don't cross-contaminate). Falls back
   * to `DEFAULT_SHEET_ID` when the mapping isn't established yet (fresh/legacy single-sheet doc).
   */
  activeLogicalId(): string {
    const wb = this.workbook()
    const local = wb?.getActiveSheet()?.getSheetId()
    if (!local) return DEFAULT_SHEET_ID
    return this.localToLogical.get(local) ?? DEFAULT_SHEET_ID
  }

  /** Logical id for a given local (univer) sheet id, or null if unmapped. */
  logicalIdFor(localId: string): string | null {
    return this.localToLogical.get(localId) ?? null
  }

  /**
   * Activate the local Univer sheet that carries `logicalId` (used when jumping to a comment on
   * another sheet). Returns true if a matching sheet was found and activated. Legacy anchors
   * keyed `default` map to the first sheet when no explicit `default` mapping exists yet.
   */
  activateLogical(logicalId: string): boolean {
    const wb = this.workbook()
    if (!wb) return false
    let localId = this.logicalToLocal.get(logicalId)
    if (!localId && logicalId === DEFAULT_SHEET_ID) {
      // Legacy single-sheet anchor with no explicit 'default' mapping — target the first sheet.
      localId = wb.getSheets()[0]?.getSheetId()
    }
    if (!localId) return false
    if (wb.getActiveSheet()?.getSheetId() === localId) return true
    try {
      wb.setActiveSheet?.(localId)
      return true
    } catch {
      return false
    }
  }


  /** logical id for a local (univer) sheet id, assigning+registering a new one if unseen. */
  private logicalFor(localId: string, order: number, name: string, register: boolean): string {
    let logical = this.localToLogical.get(localId)
    if (logical) return logical
    // First unseen sheet on a fresh book keeps 'default' (V1 back-compat); others use
    // the univer id (stable within the doc once written to the shared registry).
    logical = this.localToLogical.size === 0 && !this.sheetListMap.has(DEFAULT_SHEET_ID) ? DEFAULT_SHEET_ID : localId
    this.localToLogical.set(localId, logical)
    this.logicalToLocal.set(logical, localId)
    if (register) this.sheetListMap.set(logical, { name, order })
    return logical
  }

  /** Seed the local↔logical map from the current Univer sheets (optionally register them). */
  private seedIdentityFromUniver(opts: { registerToYmap?: boolean } = {}): void {
    const register = opts.registerToYmap !== false
    const wb = this.workbook()
    if (!wb) return
    const sheets = wb.getSheets()
    const doWork = () => {
      sheets.forEach((s, i) => this.logicalFor(s.getSheetId(), i, s.getSheetName?.() ?? `Sheet${i + 1}`, register))
    }
    if (register) this.sheetListMap.doc?.transact(doWork)
    else doWork()
  }

  /** Make the local Univer workbook's sheet set match the shared registry. Returns the
   *  logical ids of sheets newly CREATED locally (so the caller can apply their cells). */
  private reconcileSheetsFromRegistry(): string[] {
    const wb = this.workbook()
    if (!wb) return []
    const created: string[] = []
    this.applyingRemote = true
    try {
      // Desired order: registry entries sorted by `order`. `sheetList` is a public remote Y.Map
      // typed only locally as SheetMeta — a buggy/hostile peer can write `null`, a missing `order`,
      // or a non-string `name`. Filter to well-formed entries and coerce `order`/`name` to safe
      // values BEFORE sorting/use, so one malformed value can't throw inside the observer and abort
      // reconciliation (matching the rigor of the cell/dim/merge remote paths — P2-E).
      const desired = Array.from(this.sheetListMap.entries())
        .filter((e): e is [string, SheetMeta] => !!e[1] && typeof e[1] === 'object')
        .map(([id, meta]) => {
          const order = Number((meta as SheetMeta).order)
          const name = (meta as SheetMeta).name
          return [id, { name: typeof name === 'string' ? name : id, order: Number.isFinite(order) ? order : 0 }] as [string, SheetMeta]
        })
        .sort((a, b) => a[1].order - b[1].order)
      const localSheets = wb.getSheets()
      let localIdx = 0
      for (const [logicalId, meta] of desired) {
        let localId = this.logicalToLocal.get(logicalId)
        if (!localId) {
          // Reuse an as-yet-unmapped existing local sheet before creating a new one
          // (covers the join case: a fresh book already has 1 default sheet).
          const reuse = localSheets.find((s) => !this.localToLogical.has(s.getSheetId()))
          if (reuse) {
            localId = reuse.getSheetId()
          } else {
            const ns = wb.insertSheet?.(meta.name)
            if (!ns) continue
            localId = ns.getSheetId()
            created.push(logicalId)
          }
          this.logicalToLocal.set(logicalId, localId)
          this.localToLogical.set(localId, logicalId)
        }
        // Rename to match the registry.
        const ws = wb.getSheetBySheetId?.(localId) ?? null
        if (ws && ws.getSheetName?.() !== meta.name) ws.setName?.(meta.name)
        localIdx++
      }
      // Apply the registry's ORDER to the local tab positions (P1-2). `desired` is already sorted
      // by `order`, so its array index IS the target tab position. Without this, a remote reorder
      // (client A drags a tab → writes each sheet's `order` via syncSheetListFromUniver) is stored
      // in the registry but never replicated: reconcile only insert/delete/rename'd and newly
      // inserted sheets were always appended, so every other client (and a reload) kept the old
      // order — reorder didn't replicate at all. moveSheet(sheet, index) is the facade move
      // primitive; wrapped defensively so a Univer API change can't abort reconciliation.
      desired.forEach(([logicalId], targetIdx) => {
        const localId = this.logicalToLocal.get(logicalId)
        if (!localId) return
        const sheet = wb.getSheetBySheetId?.(localId)
        if (!sheet) return
        try {
          const cur = wb.getSheets().findIndex((s) => s.getSheetId() === localId)
          if (cur !== -1 && cur !== targetIdx) wb.moveSheet?.(sheet, targetIdx)
        } catch {
          // moveSheet unavailable / rejected — order stays as-is; data integrity unaffected.
        }
      })
      // Remove local sheets whose logical id is no longer in the registry.
      for (const s of wb.getSheets()) {
        const logical = this.localToLogical.get(s.getSheetId())
        if (logical && !this.sheetListMap.has(logical) && wb.getSheets().length > 1) {
          wb.deleteSheet?.(s.getSheetId())
          this.localToLogical.delete(s.getSheetId())
          this.logicalToLocal.delete(logical)
        }
      }
      void localIdx
    } finally {
      this.applyingRemote = false
    }
    return created
  }

  /** Re-read the local sheet set and diff it into the registry (add/remove/rename). */
  private syncSheetListFromUniver(): void {
    const wb = this.workbook()
    if (!wb) return
    const sheets = wb.getSheets()
    const seenLogical = new Set<string>()
    this.sheetListMap.doc?.transact(() => {
      sheets.forEach((s, i) => {
        const localId = s.getSheetId()
        const name = s.getSheetName?.() ?? `Sheet${i + 1}`
        const logical = this.logicalFor(localId, i, name, true)
        seenLogical.add(logical)
        const prev = this.sheetListMap.get(logical)
        if (!prev || prev.name !== name || prev.order !== i) this.sheetListMap.set(logical, { name, order: i })
      })
      // Deleted locally -> remove from registry (and drop that sheet's cells/dims/merges).
      // CRITICAL (P1-4): only a logical id THIS client actually materialized (present in
      // localToLogical) is a delete candidate. A registry entry we never mapped locally is NOT a
      // "user deleted it" signal — it's a remote-owned sheet we haven't rendered yet (e.g.
      // reconcileSheetsFromRegistry hit `insertSheet` returning null and left it unmapped). Deleting
      // by "in registry but not in local seenLogical" would wipe that remote sheet's entire
      // cells/dims/merges for EVERY peer including its owner. Restrict candidates to ids we hold in
      // logicalToLocal, then drop only those now absent from the live local sheet set.
      const mappedLogical = new Set(this.localToLogical.values())
      for (const logical of Array.from(this.sheetListMap.keys())) {
        if (seenLogical.has(logical)) continue
        if (!mappedLogical.has(logical)) continue // remote-owned, not-yet-materialized — never drop
        this.sheetListMap.delete(logical)
        const localId = this.logicalToLocal.get(logical)
        if (localId) {
          this.logicalToLocal.delete(logical)
          this.localToLogical.delete(localId)
        }
        this.dropSheetContent(logical)
      }
    })
  }

  /** Delete all cells/dims/merges belonging to a logical sheet (on sheet removal). */
  private dropSheetContent(logicalId: string): void {
    const cellPrefix = `${logicalId}!`
    for (const k of Array.from(this.ymap.keys())) if (k.startsWith(cellPrefix)) { this.ymap.delete(k); this.lastSeen.delete(k) }
    const dimPrefix = `${logicalId}:`
    for (const k of Array.from(this.dimMap.keys())) if (k.startsWith(dimPrefix)) { this.dimMap.delete(k); this.lastSeenDims.delete(k) }
    for (const k of Array.from(this.mergeMap.keys())) if (k.startsWith(dimPrefix)) { this.mergeMap.delete(k); this.lastSeenMerges.delete(k) }
  }

  /** Read one sheet's used (content) grid as keyed SyncCells (keys use its logical id). */
  private readSheetGrid(sheet: WSLike, logicalId: string): Map<string, SyncCell | null> {
    const cells = new Map<string, SyncCell | null>()
    const lastRow = sheet.getLastRow()
    const lastCol = sheet.getLastColumn()
    const rows = lastRow + 1
    const cols = lastCol + 1
    if (rows <= 0 || cols <= 0) return cells
    const grid = sheet.getRange(0, 0, rows, cols).getCellDataGrid()
    for (let r = 0; r < grid.length; r++) {
      const rowArr = grid[r] ?? []
      for (let c = 0; c < rowArr.length; c++) {
        cells.set(
          cellKey(logicalId, r, c),
          pickCell(rowArr[c], () => sheet.getRange(r, c).getCellStyleData() as Record<string, unknown> | null),
        )
      }
    }
    return cells
  }

  /** Seed ALL sheets' cells (+ dims + merges) into the Y.Maps from a fresh book. */
  private seedContentFromUniver(): void {
    const wb = this.workbook()
    if (!wb) return
    this.ymap.doc?.transact(() => {
      for (const sheet of wb.getSheets()) {
        const logical = this.localToLogical.get(sheet.getSheetId())
        if (!logical) continue
        for (const [key, cell] of this.readSheetGrid(sheet, logical)) {
          this.lastSeen.set(key, cell)
          if (cell) this.ymap.set(key, cell)
        }
      }
    })
  }

  /** Diff the ACTIVE sheet's live grid vs lastSeen; write only changed cells. */
  private syncLocalToYmap(): void {
    const wb = this.workbook()
    if (!wb) return
    const sheet = wb.getActiveSheet()
    if (!sheet) return
    const localId = sheet.getSheetId()
    const logical = this.localToLogical.get(localId) ?? this.logicalFor(localId, wb.getSheets().length, sheet.getSheetName?.() ?? 'Sheet', true)
    const live = this.readSheetGrid(sheet, logical)
    const changed: Array<[string, SyncCell | null]> = []
    for (const [key, cell] of live) {
      if (!cellsEqual(this.lastSeen.get(key) ?? null, cell)) changed.push([key, cell])
    }
    // Cells of THIS sheet that fell outside the shrunk used range -> emit deletes.
    const prefix = `${logical}!`
    for (const [key, prev] of this.lastSeen) {
      if (prev !== null && key.startsWith(prefix) && !live.has(key)) changed.push([key, null])
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

  /** Apply remote-changed cell keys into the sheet each key names (by logical id). */
  private applyRemoteToUniver(keys: string[]): void {
    const wb = this.workbook()
    if (!wb) return
    this.applyingRemote = true
    try {
      for (const key of keys) {
        const bang = key.indexOf('!')
        if (bang < 0) continue
        const logicalId = key.slice(0, bang)
        const rc = key.slice(bang + 1)
        const localId = this.logicalToLocal.get(logicalId)
        if (!localId) continue // sheet not created locally yet (registry reconcile pending)
        const sheet = wb.getSheetBySheetId?.(localId) ?? null
        if (!sheet) continue
        const [rowStr, colStr] = rc.split(':')
        const row = Number(rowStr)
        const col = Number(colStr)
        if (!Number.isInteger(row) || !Number.isInteger(col)) continue
        if (row < 0 || row >= SHEET_MAX_ROWS || col < 0 || col >= SHEET_MAX_COLS) continue
        const cell = this.ymap.get(key) ?? null
        // Per-cell isolation: one bad setValue must not abort the batch, and record
        // lastSeen ONLY after setValue succeeds — if it threw, the local diff must not
        // treat the cell as synced forever (divergence).
        try {
          sheet.getRange(row, col).setValue(cell ?? { v: null })
          this.lastSeen.set(key, cell)
        } catch {
          // leave lastSeen untouched so a later pass retries this cell
        }
      }
    } finally {
      this.applyingRemote = false
    }
  }

  /** Persist a column-width / row-height change (keyed by the ACTIVE sheet's logical id). */
  private syncDimFromCommand(command: { id: string; params?: unknown }): void {
    const p = command.params as
      | { ranges?: Array<{ startRow: number; endRow: number; startColumn: number; endColumn: number }>; colWidth?: number; rowHeight?: number }
      | undefined
    if (!p?.ranges) return
    const wb = this.workbook()
    const sheet = wb?.getActiveSheet()
    if (!wb || !sheet) return
    const logical = this.localToLogical.get(sheet.getSheetId())
    if (!logical) return
    const isCol = command.id.includes('col-width')
    const size = isCol ? p.colWidth : p.rowHeight
    if (typeof size !== 'number') return
    const entries: Array<[string, number]> = []
    for (const rg of p.ranges) {
      if (isCol) for (let c = rg.startColumn; c <= rg.endColumn; c++) entries.push([`${logical}:c${c}`, size])
      else for (let r = rg.startRow; r <= rg.endRow; r++) entries.push([`${logical}:r${r}`, size])
    }
    if (entries.length === 0) return
    this.dimMap.doc?.transact(() => {
      for (const [k, v] of entries) {
        this.lastSeenDims.set(k, v)
        this.dimMap.set(k, v)
      }
    })
  }

  private applyRemoteDims(keys: string[]): void {
    const wb = this.workbook()
    if (!wb) return
    this.applyingRemote = true
    try {
      for (const key of keys) {
        // V2 dim keys are `${logicalId}:c<idx>` / `:r<idx>`. V1 wrote them UNPREFIXED
        // (`c1`, `r5`) with no logical id — those belong to the 'default' sheet. Treating an
        // unprefixed key as `default` (rather than skipping on indexOf(':') === -1) is what
        // preserves column widths / row heights for legacy single-sheet docs on open (P1-A:
        // every V1 doc silently dropped all dims before this).
        const colon = key.indexOf(':')
        const logicalId = colon < 0 ? DEFAULT_SHEET_ID : key.slice(0, colon)
        const dim = colon < 0 ? key : key.slice(colon + 1) // c<idx> / r<idx>
        const localId = this.logicalToLocal.get(logicalId)
        if (!localId) continue
        const sheet = wb.getSheetBySheetId?.(localId)
        if (!sheet) continue
        const idx = Number(dim.slice(1))
        if (!Number.isInteger(idx)) continue
        const isCol = dim.startsWith('c')
        const isRow = dim.startsWith('r')
        if (!isCol && !isRow) continue
        // Bounds-reject exactly like the cell path (:458): a corrupt/hostile remote
        // key must never drive setColumnWidth/setRowHeight out of the declared grid.
        const max = isCol ? SHEET_MAX_COLS : SHEET_MAX_ROWS
        if (idx < 0 || idx >= max) continue
        const v = this.dimMap.get(key)
        if (v == null) {
          this.lastSeenDims.delete(key)
          continue
        }
        // Untrusted remote value: `sheetDims` is a public Y.Map typed only locally as number.
        // A hostile/buggy peer can `dimMap.set('default:c1', Infinity | NaN | -1)`; passing that
        // straight to setColumnWidth/setRowHeight corrupts layout for every collaborator. The
        // key index is already bounds-checked above — hold the value to the same standard the
        // cell/merge paths apply to remote input: finite, positive, within a sane ceiling.
        if (!Number.isFinite(v) || v <= 0 || v > SHEET_MAX_DIM_PX) continue
        // Per-item isolation: one throwing setColumnWidth/setRowHeight must not abort
        // the rest of the batch, and lastSeenDims is recorded ONLY after it succeeds.
        try {
          if (isCol) sheet.setColumnWidth?.(idx, v)
          else sheet.setRowHeight?.(idx, v)
          this.lastSeenDims.set(key, v)
        } catch {
          // leave lastSeenDims untouched so a later pass retries this key
        }
      }
    } finally {
      this.applyingRemote = false
    }
  }

  /** Current merged ranges of the ACTIVE sheet as `${logical}:sr:sc:er:ec` keys. */
  private readMerges(logical: string, sheet: WSLike): Set<string> {
    const out = new Set<string>()
    const data = sheet.getMergeData?.() ?? []
    for (const fr of data) {
      const r = fr.getRange?.()
      if (r) out.add(`${logical}:${r.startRow}:${r.startColumn}:${r.endRow}:${r.endColumn}`)
    }
    return out
  }

  private syncMergesToYmap(): void {
    const wb = this.workbook()
    const sheet = wb?.getActiveSheet()
    if (!wb || !sheet) return
    const logical = this.localToLogical.get(sheet.getSheetId())
    if (!logical) return
    const cur = this.readMerges(logical, sheet)
    const prefix = `${logical}:`
    const changed: Array<[string, boolean | null]> = []
    for (const k of cur) if (!this.lastSeenMerges.has(k)) changed.push([k, true])
    for (const k of this.lastSeenMerges) if (k.startsWith(prefix) && !cur.has(k)) changed.push([k, null])
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

  private applyRemoteMerges(keys: string[]): void {
    const wb = this.workbook()
    if (!wb) return
    this.applyingRemote = true
    try {
      for (const key of keys) {
        // V2 merge keys are `${logicalId}:sr:sc:er:ec` (5 parts). V1 wrote them UNPREFIXED
        // as `sr:sc:er:ec` (4 parts) with no logical id — those belong to the 'default' sheet.
        // Accepting the 4-part legacy shape as `default` (rather than skipping on length !== 5)
        // is what preserves merged ranges for legacy single-sheet docs on open (P1-A: every V1
        // doc silently dropped all merges before this).
        const rawParts = key.split(':')
        let logicalId: string
        let nums: number[]
        if (rawParts.length === 5) {
          logicalId = rawParts[0]!
          nums = rawParts.slice(1).map(Number)
        } else if (rawParts.length === 4) {
          logicalId = DEFAULT_SHEET_ID
          nums = rawParts.map(Number)
        } else {
          continue
        }
        if (nums.some((n) => !Number.isInteger(n))) continue
        const localId = this.logicalToLocal.get(logicalId)
        if (!localId) continue
        const sheet = wb.getSheetBySheetId?.(localId)
        if (!sheet) continue
        const [sr, sc, er, ec] = nums as [number, number, number, number]
        // Bounds + sanity: reject out-of-grid / inverted spans BEFORE getRange, mirroring
        // the cell path (:458). A hostile key like `logical:-1:-1:999999:999999` must not
        // reach getRange (throws) or produce a negative span (undefined behavior).
        if (sr < 0 || sc < 0 || er < sr || ec < sc) continue
        if (er >= SHEET_MAX_ROWS || ec >= SHEET_MAX_COLS) continue
        // Per-item isolation: getRange itself is inside the try so one bad key can neither
        // abort the whole batch nor escape the observer.
        try {
          const range = sheet.getRange(sr, sc, er - sr + 1, ec - sc + 1)
          // `sheetMerges` is a public remote Y.Map typed only locally as boolean. Treat "add"
          // as STRICTLY `=== true` and "remove" as key-deletion (get() returns undefined). Any
          // other value shape (0, '', null-but-present, object) is an untrusted/malformed write
          // and must be IGNORED — never interpreted as breakApart, which would let a hostile
          // falsy value force-break a live merge (data loss).
          const mv = this.mergeMap.get(key)
          if (mv === true) {
            range.merge?.()
            this.lastSeenMerges.add(key)
          } else if (mv === undefined) {
            range.breakApart?.()
            this.lastSeenMerges.delete(key)
          }
          // else: malformed value — leave the live merge untouched.
        } catch {
          // conflicting/invalid merge — leave lastSeenMerges untouched, skip this key
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
    this.sheetListMap.unobserve(this.sheetListObserver)
    this.lastSeen.clear()
    this.lastSeenDims.clear()
    this.lastSeenMerges.clear()
    this.logicalToLocal.clear()
    this.localToLogical.clear()
  }
}
