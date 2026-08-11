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
import { sanitizeLinkHref } from '../editor/sanitize.ts'

/**
 * Univer's low-level "write these cells" mutation. We DISPATCH this directly (rather than calling
 * the `FRange.setValue` facade per cell) when applying a remote batch — see applyCellsBatched.
 */
const SET_RANGE_VALUES_MUTATION = 'sheet.mutation.set-range-values'

/** Cell value/style commands we sync (see V1 note — diff is the source of truth). */
const TRIGGER_IDS = new Set<string>([
  SET_RANGE_VALUES_MUTATION,
  'sheet.command.set-style',
  'sheet.command.set-border-style',
])

/** Column-width / row-height mutations (a manual resize drag). */
const DIM_TRIGGER_IDS = new Set<string>([
  'sheet.mutation.set-worksheet-col-width',
  'sheet.mutation.set-worksheet-row-height',
])

/** Row auto-height recompute. Univer fires THIS mutation (not set-worksheet-row-height) when a
 * layout-affecting cell style — text-wrap (`tb`), font family/size (`ff`/`fs`), rotation (`tr`) —
 * grows a row to fit its content. Heights arrive per-row in `rowsAutoHeightInfo`, a different param
 * shape than the manual resize above. Without syncing it, toggling 自动换行 updates the local model
 * (row grows, UI looks right) but the new height never lands in the Y.Doc, so on reload the row
 * snaps back to the default height and clips the wrapped text (WS-28). */
const AUTO_ROW_HEIGHT_TRIGGER_IDS = new Set<string>([
  'sheet.mutation.set-worksheet-row-auto-height',
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

/**
 * Drawing (image) changes. Insert / update / delete / arrange of every float or cell image
 * ultimately lands on this ONE mutation (with a `type` discriminator), so it's the single
 * point to observe — same idea as the cell/merge mutation triggers above.
 */
const DRAWING_TRIGGER_IDS = new Set<string>(['sheet.mutation.set-drawing-apply'])

/**
 * Range / worksheet PROTECTION rule mutations. Like hyperlinks, protection rules live in a plugin
 * resource (SHEET_RANGE_PROTECTION_PLUGIN / SHEET_WORKSHEET_PROTECTION_PLUGIN) rather than in cell
 * data, so without their own Yjs sync a rule is local-and-ephemeral: it disappears on reload and is
 * invisible to every peer. We observe these mutations AND each model's `ruleChange$` — the UI drives
 * the models through these commands, but the models are directly pokeable too.
 */
const PROTECTION_TRIGGER_IDS = new Set<string>([
  'sheet.mutation.add-range-protection',
  'sheet.mutation.delete-range-protection',
  'sheet.mutation.set-range-protection',
  'sheet.mutation.add-worksheet-protection',
  'sheet.mutation.delete-worksheet-protection',
  'sheet.mutation.set-worksheet-protection',
])

/**
 * Worksheet PERMISSION POINT mutation. Kept in its OWN set rather than added to
 * PROTECTION_TRIGGER_IDS, because that set drives `syncProtectionToYmap()`, which diffs the
 * `sheetProtection` map — a different map with a different key shape and a cross-repo reader.
 */
const POINT_TRIGGER_IDS = new Set<string>([
  'sheet.mutation.set-worksheet-permission-points',
])

export const SHEET_YMAP_FIELD = 'sheet'
export const SHEET_DIMS_FIELD = 'sheetDims'
export const SHEET_MERGES_FIELD = 'sheetMerges'
/** Registry of logical sheets: logicalId -> { name, order }. */
export const SHEET_LIST_FIELD = 'sheetList'
/** Images/drawings: `${logicalId}!${drawingId}` -> serialized ISheetImage (base64 inline). */
export const SHEET_DRAWINGS_FIELD = 'sheetDrawings'
/** Hyperlinks: `${logicalId}!${linkId}` -> { id, row, column, payload, display }. */
export const SHEET_HYPERLINKS_FIELD = 'sheetHyperLinks'
/**
 * Protection rules: `${logicalId}!r:${ruleId}` for a range rule, `${logicalId}!w:` for the
 * one-per-sheet worksheet rule. Runtime unitId/subUnitId are stripped before storage and
 * re-attached on apply — same per-client-id reasoning as drawings above.
 *
 * NOTE the split of concerns. This map carries the RULES (which ranges are protected, in which
 * sheet). WHO may edit them is permissionId-scoped rather than sheet-scoped and lives in a separate
 * map owned by protectionAuthz.ts. Both halves are required: Univer's stock AuthzIoService answers
 * "allowed" for any permissionId it has never seen, so a replicated rule without its grant is
 * decorative — the peer sees the lock icon and edits straight through it.
 */
export const SHEET_PROTECTION_FIELD = 'sheetProtection'

/**
 * Allow-lists for those rules — written and read by protectionAuthz.ts, which owns the shape.
 *
 * Declared here only so the binding can OBSERVE it: unlike every other field, nothing applies this
 * map into a Univer model, so a remote change produces no re-render and no re-query on its own.
 * See the `onProtectionGrantsChanged` constructor parameter.
 */
export const SHEET_PROTECTION_GRANTS_FIELD = 'sheetProtectionGrants'

/**
 * Worksheet PERMISSION POINTS: `${logicalId}` -> `{ permissionId }`, one per sheet.
 *
 * A SEPARATE map from `sheetProtection`, deliberately — and the reason is a cross-repo contract, not
 * tidiness. `sheetProtection` is read by BOTH repos: octo-docs-backend walks it to decide whether a
 * bot/REST write touches a protected cell. Its dispatch recognises `kind: 'w'` and treats everything
 * else as a RANGE rule, reading `rule.ranges` — and a point rule has no `ranges`, so
 * `readRects(undefined)` returns `malformed: true`, which fail-closes to a WHOLE-SHEET lock. Verified
 * by probe against the real `assertSheetWriteAllowed`: a lone point rule in `sheetProtection` makes
 * every non-admin `PATCH /:docId/sheet` on that sheet 403, unfixably — the points dialog produces no
 * grant record (it seeds from the WORKBOOK id), so no allow-list can ever let anyone back in.
 *
 * Keeping them apart means the backend never sees this map and needs no change at all. That is also
 * the honest modelling: `sheetProtection` answers "who may edit this region", which the server can
 * enforce per cell; this map answers "which operations are disabled on this sheet", for which the
 * server has no corresponding object — a bot write carries no Sort or Filter action.
 *
 * NOT reconciled by the backend's versionRestore — see octo-docs-backend#139 known limitations.
 * `reconcileSheetMap()` enumerates SIX map names explicitly (cells, dims, drawings, hyperlinks,
 * merges, sheetList); every protection field is absent, so a version restore leaves them at their
 * CURRENT state rather than the restored version's. Verified by probe, and deliberately not fixed
 * here: it fails safe (restoring a pre-lock version keeps the lock) and `versionRestore.ts` is
 * outside this change. Anyone adding a seventh shared field should know that whitelist exists.
 */
export const SHEET_PERMISSION_POINTS_FIELD = 'sheetPermissionPoints'

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
  // Rich-text document snapshot. Univer stores an INLINE CELL IMAGE here as
  // `p.drawings[id].source` (base64 with the OSS image service), so a cell image is just
  // ordinary cell data — but only if we carry `p`. `t` is the cell type (1 = rich text);
  // both must round-trip or an image cell reloads blank.
  p?: Record<string, unknown>
  t?: number
}

interface SheetMeta {
  name: string
  order: number
}

/**
 * One validated remote cell write, queued for a batched apply. `key` is kept alongside the parsed
 * coordinates so `lastSeen` can be recorded without re-deriving it.
 */
interface RemoteCellWrite {
  key: string
  row: number
  col: number
  cell: SyncCell | null
}

/**
 * A serialized Univer sheet image/drawing. Kept STRUCTURAL (like WSLike below) to avoid a hard
 * type dependency on @univerjs internals — we only ever read a whole drawing object and write it
 * back verbatim. `unitId`/`subUnitId` are per-client / per-doc runtime ids: they are stripped
 * before storage and re-attached (to the receiver's local ids) on apply, exactly as cell keys use
 * the stable logical id rather than Univer's per-client sheet id. With the OSS base64 image service
 * (collaboration:false) `source` is an inline data URL, so the binary rides along in the object and
 * no external image host is needed.
 */
type StoredDrawing = Record<string, unknown> & { drawingId?: string }

/** Minimal ISheetDrawingService read surface: a sheet's images as `{ [drawingId]: image }`. */
export interface DrawingReaderLike {
  getDrawingData(unitId: string, subUnitId: string): Record<string, StoredDrawing> | undefined
}

/** A serialized hyperlink (Univer ISheetHyperLink): a URL (`payload`) + display text on a cell. */
export interface StoredHyperLink {
  id: string
  row: number
  column: number
  payload: string
  display?: string
}

/**
 * Minimal HyperLinkModel surface. Hyperlinks live in the SHEET_HYPER_LINK_PLUGIN resource (not
 * cell data), so — like drawings — they need their own sync. We read per-sheet via getSubUnit,
 * write via add/remove/update, and react to any change through the linkUpdate$ stream.
 */
export interface HyperLinkModelLike {
  getSubUnit(unitId: string, subUnitId: string): StoredHyperLink[]
  addHyperLink(unitId: string, subUnitId: string, link: StoredHyperLink): boolean
  removeHyperLink(unitId: string, subUnitId: string, id: string): boolean
  updateHyperLink(
    unitId: string,
    subUnitId: string,
    id: string,
    payload: Partial<{ payload: string; display: string }>,
    silent?: boolean,
  ): boolean
  getHyperLink(unitId: string, subUnitId: string, id: string): StoredHyperLink | null | undefined
  linkUpdate$: { subscribe(next: () => void): { unsubscribe(): void } }
}

/** A protected range, stored as the four bounds only (Univer's IRange carries extra runtime hints). */
export interface StoredRange {
  startRow: number
  startColumn: number
  endRow: number
  endColumn: number
}

/**
 * A serialized protection rule. `kind` discriminates the two Univer models:
 *   'r' — a RANGE rule (RangeProtectionRuleModel): many per sheet, each with its own `id` + ranges.
 *   'w' — the WORKSHEET rule (WorksheetProtectionRuleModel): at most one per sheet, no ranges.
 *
 * `unitId` / `subUnitId` are deliberately absent: they are per-client runtime ids, re-attached on
 * apply from the logical id in the key. `permissionId` IS portable — it's the handle the grant map
 * in protectionAuthz.ts keys on, so it must survive the round trip for the rule to mean anything.
 */
export interface StoredProtection {
  kind: 'r' | 'w'
  /** Univer rule id. Range rules only; the worksheet rule is identified by its sheet alone. */
  id?: string
  permissionId: string
  description?: string
  /** Univer's UnitObject enum (numeric on the wire). Carried through opaquely. */
  unitType?: number
  /** Univer's ViewStateEnum / EditStateEnum string values, carried through opaquely. */
  viewState?: string
  editState?: string
  ranges?: StoredRange[]
}

/**
 * Minimal RangeProtectionRuleModel surface. Shaped like HyperLinkModelLike: read per-sheet, write
 * via add/set/delete, react through `ruleChange$`.
 */
export interface RangeProtectionModelLike {
  getSubunitRuleList(unitId: string, subUnitId: string): unknown[]
  getRule(unitId: string, subUnitId: string, id: string): unknown | undefined
  addRule(unitId: string, subUnitId: string, rule: unknown): void
  setRule(unitId: string, subUnitId: string, id: string, rule: unknown): void
  deleteRule(unitId: string, subUnitId: string, id: string): void
  ruleChange$: { subscribe(next: () => void): { unsubscribe(): void } }
}

/**
 * Minimal WorksheetProtectionRuleModel surface. Note the asymmetric signatures — `addRule` takes no
 * subUnitId (it reads it off the rule) while `setRule`/`deleteRule`/`getRule` do. That is Univer's
 * actual shape, not a transcription slip.
 */
export interface WorksheetProtectionModelLike {
  getRule(unitId: string, subUnitId: string): unknown | undefined
  addRule(unitId: string, rule: unknown): void
  setRule(unitId: string, subUnitId: string, rule: unknown): void
  deleteRule(unitId: string, subUnitId: string): void
  ruleChange$: { subscribe(next: () => void): { unsubscribe(): void } }
}

/**
 * Univer's WorksheetProtectionPointModel, structurally.
 *
 * NOTE `addRule` takes the WHOLE rule (it reads unitId/subUnitId off it) — unlike
 * WorksheetProtectionRuleModel.addRule(unitId, rule) — and the change stream is `pointChange$`,
 * NOT `ruleChange$`. Verified against @univerjs/sheets@0.25.1; assuming the sibling model's shape
 * here would silently never fire.
 */
export interface WorksheetPointModelLike {
  getRule(unitId: string, subUnitId: string): unknown | undefined
  addRule(rule: unknown): void
  deleteRule(unitId: string, subUnitId: string): void
  pointChange$: { subscribe(next: () => void): { unsubscribe(): void } }
}

/** One permission-point association: which permissionId governs this sheet's operation matrix. */
interface StoredPoint {
  permissionId: string
}

/** Protection key: `${logicalId}!r:${ruleId}` (range) or `${logicalId}!w:` (worksheet). */
function protectionKey(logicalId: string, kind: 'r' | 'w', id = ''): string {
  return `${logicalId}!${kind}:${id}`
}

/** Keep only the four bounds, and only when all are in-grid integers. */
function pickRanges(raw: unknown): StoredRange[] {
  if (!Array.isArray(raw)) return []
  const out: StoredRange[] = []
  for (const r of raw) {
    if (r == null || typeof r !== 'object') continue
    const { startRow, startColumn, endRow, endColumn } = r as Record<string, unknown>
    if (
      !Number.isInteger(startRow) || !Number.isInteger(startColumn) ||
      !Number.isInteger(endRow) || !Number.isInteger(endColumn)
    ) continue
    const sr = startRow as number, sc = startColumn as number
    const er = endRow as number, ec = endColumn as number
    // Same clamp-reject contract as remote cell keys: a hostile/corrupt peer must not drive
    // protection over an out-of-grid region (which Univer would render or intersect oddly).
    if (sr < 0 || sc < 0 || er >= SHEET_MAX_ROWS || ec >= SHEET_MAX_COLS) continue
    if (er < sr || ec < sc) continue
    out.push({ startRow: sr, startColumn: sc, endRow: er, endColumn: ec })
  }
  return out
}

function cellKey(logicalId: string, row: number, col: number): string {
  return `${logicalId}!${row}:${col}`
}

function pickCell(
  cell: unknown,
  resolveStyle: (styleId: string) => Record<string, unknown> | null,
): SyncCell | null {
  if (cell == null || typeof cell !== 'object') return null
  const c = cell as { v?: SyncCell['v']; f?: string; s?: Record<string, unknown> | string; p?: Record<string, unknown>; t?: number }
  const out: SyncCell = {}
  if (c.v !== undefined) out.v = c.v
  if (c.f !== undefined) out.f = c.f
  if (c.s != null) {
    // Univer stores a cell's style BY REFERENCE: `s` is an id into the workbook style pool.
    // Resolving is expensive (see readSheetGrid), so the id is handed to the resolver rather than
    // pre-bound — that lets the caller memoize per id instead of paying per cell.
    const resolved = typeof c.s === 'string' ? resolveStyle(c.s) : c.s
    if (resolved && Object.keys(resolved).length > 0) out.s = resolved
  }
  // Inline cell image (and any other rich text) lives in `p`; keep `t` so Univer re-reads it
  // as rich text rather than a plain value.
  if (c.p != null && typeof c.p === 'object') out.p = c.p
  if (c.t !== undefined) out.t = c.t
  return out.v === undefined && out.f === undefined && out.s === undefined && out.p === undefined && out.t === undefined
    ? null
    : out
}

function stylesEqual(a: SyncCell['s'], b: SyncCell['s']): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

function cellsEqual(a: SyncCell | null, b: SyncCell | null): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return (
    a.v === b.v &&
    a.f === b.f &&
    a.t === b.t &&
    stylesEqual(a.s, b.s) &&
    // `p` holds the rich-text / cell-image snapshot; deep-compare so an image edit is detected
    // but an unchanged image doesn't churn the Y.Map on every unrelated cell scan.
    stylesEqual(a.p, b.p)
  )
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
    /** `'cell'` = the cell's own style; omitted/`'row'` = composed with default/row/column/theme. */
    getCellStyleData(type?: 'cell' | 'row' | 'column'): unknown
    setValue(v: unknown): void
    merge?(): void
    breakApart?(): void
  }
  setColumnWidth?(col: number, width: number): void
  setRowHeight?(row: number, height: number): void
  getMergeData?(): Array<{ getRange?(): { startRow: number; startColumn: number; endRow: number; endColumn: number } }>
  // Drawing (image) facade — used to APPLY remote image changes into this worksheet. Writes go
  // through the facade (which fires the proper commands + updates the UI); reads use the injected
  // DrawingReaderLike instead, since FOverGridImage has no public whole-object getter.
  getImageById?(id: string): unknown | null
  insertImages?(images: StoredDrawing[]): unknown
  updateImages?(images: StoredDrawing[]): unknown
  deleteImages?(images: unknown[]): unknown
  /** Remove a float-DOM drawing by id (images use deleteImages; DOM drawings have no FOverGridImage). */
  removeFloatDom?(id: string): unknown
}
interface WBLike {
  getId?(): string
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
  private readonly drawingMap: Y.Map<StoredDrawing>
  private readonly hyperLinkMap: Y.Map<StoredHyperLink>
  private readonly protectionMap: Y.Map<StoredProtection>
  /** Allow-lists. Not applied into any model — see onProtectionGrantsChanged. */
  private readonly protectionGrantsMap: Y.Map<unknown>
  /** Permission-point associations: logicalId -> { permissionId }. */
  private readonly pointsMap: Y.Map<StoredPoint>
  private readonly commandDisposable: { dispose(): void }
  private readonly observer: (events: Y.YMapEvent<SyncCell>) => void
  private readonly dimObserver: (event: Y.YMapEvent<number>) => void
  private readonly mergeObserver: (event: Y.YMapEvent<boolean>) => void
  private readonly sheetListObserver: (event: Y.YMapEvent<SheetMeta>) => void
  private readonly drawingObserver: (event: Y.YMapEvent<StoredDrawing>) => void
  private readonly hyperLinkObserver: (event: Y.YMapEvent<StoredHyperLink>) => void
  private readonly protectionObserver: (event: Y.YMapEvent<StoredProtection>) => void
  private readonly protectionGrantsObserver: (event: Y.YMapEvent<unknown>) => void
  private readonly pointsObserver: (event: Y.YMapEvent<StoredPoint>) => void
  private hyperLinkSub: { unsubscribe(): void } | null = null
  private rangeProtSub: { unsubscribe(): void } | null = null
  private worksheetProtSub: { unsubscribe(): void } | null = null
  private pointSub: { unsubscribe(): void } | null = null
  /** logicalId -> last replicated permissionId, for the same diff discipline as protection. */
  private readonly lastSeenPoints = new Map<string, string>()
  private applyingRemote = false
  private readonly lastSeen = new Map<string, SyncCell | null>()
  private readonly lastSeenDims = new Map<string, number>()
  private readonly lastSeenMerges = new Set<string>()
  private readonly lastSeenDrawings = new Map<string, StoredDrawing>()
  private readonly lastSeenLinks = new Map<string, StoredHyperLink>()
  private readonly lastSeenProtection = new Map<string, StoredProtection>()
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
    /** Read side of image sync. When null (e.g. unit tests) drawing sync is inert: the observer
     *  still attaches so remote images could apply, but nothing is read/pushed locally. */
    private readonly drawingReader: DrawingReaderLike | null = null,
    /** Hyperlink model. When null (tests) hyperlink sync is inert (observer attaches, nothing read). */
    private readonly hyperLinkModel: HyperLinkModelLike | null = null,
    /** Range-protection rule model. When null (tests) protection sync is inert. */
    private readonly rangeProtectionModel: RangeProtectionModelLike | null = null,
    /** Worksheet-protection rule model. When null (tests) worksheet protection sync is inert. */
    private readonly worksheetProtectionModel: WorksheetProtectionModelLike | null = null,
    /**
     * Admin gate for the protection-replication path. Protection is an admin-only decision, so a
     * plain writer must not be able to push protection changes — including a DELETE — into the
     * shared doc. Defaults to `canWrite` so existing call sites keep working; `CollabSheet` passes
     * the real `canManage(role)`.
     */
    private readonly canManageProtection: () => boolean = () => this.canWrite(),
    /**
     * Called when a PEER changes the grant map (`sheetProtectionGrants`).
     *
     * Grants have no Univer model behind them — their only consumer is `IAuthzIoService.allowed()`,
     * and Univer caches those answers per permission point until something invalidates them. Without
     * this hook a remote revocation was invisible on the victim's own screen until a reload: the grant
     * replicated correctly and the cached "allowed" stayed. Same shape as the role-downgrade cache bug
     * fixed the round before — the state changed and nothing re-asked — one map over.
     *
     * `CollabSheet` passes its permission-refresh call. When null (tests, older call sites) the
     * observer still attaches and simply has nothing to notify.
     */
    private readonly onProtectionGrantsChanged: (() => void) | null = null,
    /**
     * Worksheet PERMISSION POINT model. When null (tests, older call sites) point sync is inert: the
     * observer still attaches so a remote association could apply, but nothing is read or pushed.
     */
    private readonly worksheetPointModel: WorksheetPointModelLike | null = null,
  ) {
    this.ymap = ydoc.getMap<SyncCell>(SHEET_YMAP_FIELD)
    this.dimMap = ydoc.getMap<number>(SHEET_DIMS_FIELD)
    this.mergeMap = ydoc.getMap<boolean>(SHEET_MERGES_FIELD)
    this.sheetListMap = ydoc.getMap<SheetMeta>(SHEET_LIST_FIELD)
    this.drawingMap = ydoc.getMap<StoredDrawing>(SHEET_DRAWINGS_FIELD)
    this.hyperLinkMap = ydoc.getMap<StoredHyperLink>(SHEET_HYPERLINKS_FIELD)
    this.protectionMap = ydoc.getMap<StoredProtection>(SHEET_PROTECTION_FIELD)
    this.protectionGrantsMap = ydoc.getMap<unknown>(SHEET_PROTECTION_GRANTS_FIELD)
    this.pointsMap = ydoc.getMap<StoredPoint>(SHEET_PERMISSION_POINTS_FIELD)

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
        else if (AUTO_ROW_HEIGHT_TRIGGER_IDS.has(command.id)) this.syncAutoRowHeightFromCommand(command)
        else if (MERGE_TRIGGER_IDS.has(command.id)) this.syncMergesToYmap()
        else if (DRAWING_TRIGGER_IDS.has(command.id)) this.syncDrawingsToYmap()
        // Protection is admin-only, so its replication path takes the admin gate, not canWrite.
        // A plain writer reaching `sheet.mutation.delete-range-protection` would otherwise erase
        // the rule for every peer — bypassing the feature by removing the lock.
        else if (PROTECTION_TRIGGER_IDS.has(command.id)) {
          if (this.canManageProtection()) this.syncProtectionToYmap()
        }
        // Same admin gate: the operation matrix is an admin-only decision too.
        else if (POINT_TRIGGER_IDS.has(command.id)) {
          if (this.canManageProtection()) this.syncPointsToYmap()
        }
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
        // Drawings keyed `${logicalId}!${drawingId}` share the `${id}!` prefix with cells; apply
        // the new sheet's images too (same not-yet-mapped-on-first-fire reasoning as dims/merges).
        this.applyRemoteDrawings(Array.from(this.drawingMap.keys()).filter((k) => prefixes.some((p) => k.startsWith(p))))
        // Hyperlinks keyed `${logicalId}!${linkId}` share the `${id}!` prefix too.
        this.applyRemoteHyperLinks(Array.from(this.hyperLinkMap.keys()).filter((k) => prefixes.some((p) => k.startsWith(p))))
        // Protection keys are `${logicalId}!r:...` / `${logicalId}!w:` — same `${id}!` prefix.
        this.applyRemoteProtection(Array.from(this.protectionMap.keys()).filter((k) => prefixes.some((p) => k.startsWith(p))))
        // The points map is keyed by the BARE logical id (one association per sheet, no `!suffix`),
        // so select by exact membership in `created` rather than by prefix.
        this.applyRemotePoints(created.filter((id) => this.pointsMap.has(id)))
      }
    }
    this.sheetListMap.observe(this.sheetListObserver)

    // 7) drawings (images). Remote insert/update/delete -> apply into the sheet it names.
    this.drawingObserver = (event: Y.YMapEvent<StoredDrawing>) => {
      if (this.disposed || event.transaction.local) return
      this.applyRemoteDrawings(Array.from(event.keys.keys()))
    }
    this.drawingMap.observe(this.drawingObserver)

    // 8) hyperlinks. Remote add/remove/update -> apply into the sheet it names.
    this.hyperLinkObserver = (event: Y.YMapEvent<StoredHyperLink>) => {
      if (this.disposed || event.transaction.local) return
      this.applyRemoteHyperLinks(Array.from(event.keys.keys()))
    }
    this.hyperLinkMap.observe(this.hyperLinkObserver)
    // Local -> Yjs for hyperlinks: the model has no command mutation we can observe via
    // onCommandExecuted, but it exposes a change stream. Any local add/remove/update re-scans and
    // diffs into the Y.Map (guarded by applyingRemote so a remote apply doesn't echo back).
    if (this.hyperLinkModel) {
      this.hyperLinkSub = this.hyperLinkModel.linkUpdate$.subscribe(() => {
        if (this.disposed || this.applyingRemote || !this.canWrite()) return
        this.syncHyperLinksToYmap()
      })
    }

    // 9) protection rules. Remote add/set/delete -> apply into the sheet the key names.
    this.protectionObserver = (event: Y.YMapEvent<StoredProtection>) => {
      if (this.disposed || event.transaction.local) return
      this.applyRemoteProtection(Array.from(event.keys.keys()))
    }
    this.protectionMap.observe(this.protectionObserver)
    // 9b) protection GRANTS. Nothing to apply into a model — the grant map only feeds
    // IAuthzIoService.allowed(), whose answers Univer caches per permission point. So the whole job
    // here is to tell Univer to re-ask. Without it a remote revocation stayed invisible on the
    // victim's screen until a reload: state changed, nobody re-queried.
    this.protectionGrantsObserver = (event: Y.YMapEvent<unknown>) => {
      if (this.disposed || event.transaction.local) return
      this.onProtectionGrantsChanged?.()
    }
    this.protectionGrantsMap.observe(this.protectionGrantsObserver)
    // 9c) permission POINTS. Their own map (see SHEET_PERMISSION_POINTS_FIELD) and their own model,
    // whose change stream is `pointChange$` — not `ruleChange$` like the two rule models.
    this.pointsObserver = (event: Y.YMapEvent<StoredPoint>) => {
      if (this.disposed || event.transaction.local) return
      this.applyRemotePoints(Array.from(event.keys.keys()))
    }
    this.pointsMap.observe(this.pointsObserver)
    if (this.worksheetPointModel) {
      this.pointSub = this.worksheetPointModel.pointChange$.subscribe(() => {
        if (this.disposed || this.applyingRemote || !this.canManageProtection()) return
        this.syncPointsToYmap()
      })
    }
    // Local -> Yjs for protection. The mutation triggers above cover the UI path; these streams are
    // the belt-and-braces half (a direct model poke fires ruleChange$ but no command).
    // Gated on canManageProtection, NOT canWrite: syncProtectionToYmap() diffs against
    // lastSeenProtection and DELETES keys that vanished locally, so a plain writer (canWrite true,
    // canManageProtection false) reaching this path would replicate a protection removal to every
    // peer — the same authorization hole the command path at :487 closes.
    if (this.rangeProtectionModel) {
      this.rangeProtSub = this.rangeProtectionModel.ruleChange$.subscribe(() => {
        if (this.disposed || this.applyingRemote || !this.canManageProtection()) return
        this.syncProtectionToYmap()
      })
    }
    if (this.worksheetProtectionModel) {
      this.worksheetProtSub = this.worksheetProtectionModel.ruleChange$.subscribe(() => {
        if (this.disposed || this.applyingRemote || !this.canManageProtection()) return
        this.syncProtectionToYmap()
      })
    }
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
      this.applyRemoteDrawings(Array.from(this.drawingMap.keys()))
      this.applyRemoteHyperLinks(Array.from(this.hyperLinkMap.keys()))
      this.applyRemoteProtection(Array.from(this.protectionMap.keys()))
      // Permission POINTS are the SEVENTH shared field and need listing here like the rest: the
      // observer only fires on a CHANGE, so an association already in the doc at open time would
      // otherwise never reach Univer and the toggles would come back off on every reload.
      this.applyRemotePoints(Array.from(this.pointsMap.keys()))
    } else if (
      this.ymap.size > 0 ||
      this.dimMap.size > 0 ||
      this.mergeMap.size > 0 ||
      this.protectionMap.size > 0 ||
      // A V1 doc whose only populated map is the points map: an admin configured the operation
      // matrix on a still-empty sheet. Omitting it here drops through to the brand-new-doc branch
      // and the toggles vanish — same narrow-but-real hole as sheetProtection had.
      this.pointsMap.size > 0
    ) {
      // Legacy V1 single-sheet doc: has populated `default!r:c` cells (and/or dims / merges /
      // protection rules) but NO sheetList registry. Map the first local sheet to the 'default'
      // logical id, register it for writers (so it joins the multi-sheet lifecycle going forward),
      // then apply the pre-existing content into the fresh Univer workbook. Without this
      // the doc would fall into the brand-new path below and render blank.
      this.initialSynced = true
      this.seedIdentityFromUniver({ registerToYmap: this.canWrite() })
      this.applyRemoteToUniver(Array.from(this.ymap.keys()))
      this.applyRemoteDims(Array.from(this.dimMap.keys()))
      this.applyRemoteMerges(Array.from(this.mergeMap.keys()))
      this.applyRemoteDrawings(Array.from(this.drawingMap.keys()))
      this.applyRemoteHyperLinks(Array.from(this.hyperLinkMap.keys()))
      this.applyRemoteProtection(Array.from(this.protectionMap.keys()))
      this.applyRemotePoints(Array.from(this.pointsMap.keys()))
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
      // A brand-new book normally has no images, but seed defensively (e.g. a book created via
      // an import path that dropped images in) so they aren't lost. No-op when there are none.
      this.syncDrawingsToYmap()
      this.syncHyperLinksToYmap()
      // Protection takes the ADMIN gate, not canWrite — every other call site of these two already
      // does (see the observer wiring above: `if (this.canManageProtection()) …`). This branch was
      // the one that did not, and it is the branch that runs on a brand-new doc.
      //
      // The asymmetry was exploitable in the ordinary case, not a corner one: a plain writer who is
      // FIRST into a fresh book seeds from whatever the local Univer instance holds. Univer's default
      // workbook carries no rules, so `scanAllProtection()` returns an empty map — and because
      // syncProtectionToYmap() diffs live-vs-lastSeenProtection and emits `null` (delete) for keys
      // that vanished locally, a writer racing a cold cache could replicate protection REMOVAL for
      // rules an admin had set. Gating matches the observers and closes it.
      //
      // syncPointsToYmap() is added for SYMMETRY, and it is not cosmetic: the permission POINTS map
      // is a separate Y.Map (SHEET_PERMISSION_POINTS_FIELD) with its own seed path. Seeding
      // `sheetProtection` but not `sheetPermissionPoints` left a brand-new book's operation matrix
      // unreplicated until some later command happened to touch it.
      if (this.canManageProtection()) {
        this.syncProtectionToYmap()
        this.syncPointsToYmap()
      }
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
    // Which sheet the LOCAL viewer is looking at, captured BEFORE we touch the sheet set so it can
    // be restored at the end (see the restore block below). Univer's `FWorkbook.insertSheet()`
    // deliberately activates the sheet it just created (it issues a `SetWorksheetActiveOperation`
    // right after `InsertSheetCommand`), so every sheet this reconcile materializes steals the
    // viewport. This function only ever runs on a REMOTE-driven path — the initial join in
    // runInitialSync() and the sheetList observer (which returns early on `transaction.local`) —
    // so that activation is never something the local user asked for. Two visible bugs came out of
    // it: (1) opening a multi-sheet doc landed on the LAST tab (all sheets after the reused first
    // one are inserted here) instead of the first, which reads as "nothing loaded" when that tab is
    // empty; (2) a peer adding a sheet yanked everyone else's viewport onto it mid-edit.
    const activeBefore = wb.getActiveSheet()?.getSheetId() ?? null
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
      // Restore the viewer's active tab. The active sheet is per-VIEWER state, not document state:
      // it is not in the Y.Doc at all, and `sheet.operation.set-worksheet-active` is absent from
      // every TRIGGER_IDS set, so switching tabs has never replicated — this only undoes the
      // collateral activation from insertSheet() above. Done inside the try so `applyingRemote` is
      // still set (the activation must not be mistaken for a local edit) and via the facade's
      // setActiveSheet(), which issues the same Univer operation the sheet bar does.
      //
      // Fallbacks, in order: the sheet that was active before; else the FIRST tab in registry order
      // (the reorder pass above has already put the tabs in that order). "First" — not "last", and
      // not "first non-empty" — matches Excel/Sheets behaviour for a doc with no saved view state,
      // and keeps a two-sheet doc opening on the sheet whose content the author put first.
      const liveIds = wb.getSheets().map((s) => s.getSheetId())
      const target = (activeBefore && liveIds.includes(activeBefore) ? activeBefore : null) ?? liveIds[0] ?? null
      if (target && wb.getActiveSheet()?.getSheetId() !== target) {
        try {
          wb.setActiveSheet?.(target)
        } catch {
          // setActiveSheet unavailable / rejected — the tab stays where Univer left it. Cosmetic
          // only; every id mapping and all cell content is already correct at this point.
        }
      }
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
    // Univer stores a cell's style BY REFERENCE: `cell.s` is a short id into the workbook's shared
    // style pool, and every cell that looks the same shares ONE id. Resolving an id costs a
    // `getRange(r, c)` (which `injector.createInstance`s a whole FRange + resolves 3 DI deps) plus a
    // `getCellStyleData()` — whose own Univer source carries the comment "WARNING: All sheet
    // CELL_CONTENT interceptors will be called in this method, cause performance issue".
    //
    // Paying that PER CELL is what made "select all -> set background / align" hang the tab: one
    // such command writes a style into every DECLARED cell (1000×100 = 100k, see
    // CollabSheet.createWorkbook), and Univer's `getLastRow()`/`getLastColumn()` count a style-only
    // cell as content (they only test whether the cell matrix has a key), so the very next scan
    // resolved 100k styles one at a time.
    //
    // Memoizing by style id collapses that to one resolution per DISTINCT look — a full-sheet style
    // change has exactly one. This is exact, not approximate: with `'cell'` the resolved value is a
    // pure function of the id (see below), so a hit is indistinguishable from a miss.
    const styleCache = new Map<string, Record<string, unknown> | null>()
    const resolveStyle = (row: number, col: number, styleId: string): Record<string, unknown> | null => {
      // A style that resolves to null is cached AS null, so `has` — not a truthiness test — is what
      // distinguishes "already resolved, it was empty" from "never resolved".
      if (styleCache.has(styleId)) return styleCache.get(styleId) ?? null
      let resolved: Record<string, unknown> | null = null
      try {
        // `'cell'` (not the default `'row'`) is deliberate, and is what makes the cache sound. The
        // default composes default + row + column + theme + cell styles, so its result depends on
        // WHERE the cell is, not just on the id. We want the cell's OWN style anyway: composing
        // would bake this client's default look (font, size, …) into every replicated cell, both
        // inflating the doc and overriding the peer's own defaults. This project sets no row,
        // column or theme styles, so nothing is lost by not composing.
        resolved = sheet.getRange(row, col).getCellStyleData('cell') as Record<string, unknown> | null
      } catch {
        resolved = null
      }
      styleCache.set(styleId, resolved)
      return resolved
    }
    for (let r = 0; r < grid.length; r++) {
      const rowArr = grid[r] ?? []
      for (let c = 0; c < rowArr.length; c++) {
        cells.set(
          cellKey(logicalId, r, c),
          pickCell(rowArr[c], (styleId) => resolveStyle(r, c, styleId)),
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
      // Parse + validate ONCE, grouped by target sheet, so each sheet's whole batch can go in as a
      // single mutation (applyCellsBatched). Applying cell-by-cell through the facade is what made a
      // full-sheet style change unrecoverable: `FRange.setValue` is a complete
      // `SetRangeValuesCommand` every time (deep-clones undo data, pushes an undo entry, dispatches a
      // mutation, re-renders, recomputes auto-height), and a select-all style change produces one key
      // per DECLARED cell — 100k of them (1000×100, see CollabSheet.createWorkbook). Worse, those
      // keys persist in the Y.Doc, so `runInitialSync` replayed all 100k commands on EVERY subsequent
      // open: the document stayed unusable long after the edit that caused it.
      const bySheet = new Map<string, RemoteCellWrite[]>()
      for (const key of keys) {
        const bang = key.indexOf('!')
        if (bang < 0) continue
        const logicalId = key.slice(0, bang)
        const rc = key.slice(bang + 1)
        const localId = this.logicalToLocal.get(logicalId)
        if (!localId) continue // sheet not created locally yet (registry reconcile pending)
        const [rowStr, colStr] = rc.split(':')
        const row = Number(rowStr)
        const col = Number(colStr)
        if (!Number.isInteger(row) || !Number.isInteger(col)) continue
        if (row < 0 || row >= SHEET_MAX_ROWS || col < 0 || col >= SHEET_MAX_COLS) continue
        const entry: RemoteCellWrite = { key, row, col, cell: this.ymap.get(key) ?? null }
        const list = bySheet.get(localId)
        if (list) list.push(entry)
        else bySheet.set(localId, [entry])
      }
      for (const [localId, pending] of bySheet) {
        const sheet = wb.getSheetBySheetId?.(localId) ?? null
        if (!sheet) continue
        if (this.applyCellsBatched(wb, localId, pending)) continue
        // Fall back to the per-cell facade path when batching isn't possible (no workbook id, or a
        // Univer without `syncExecuteCommand` — including the structural fake in binding.test.ts).
        for (const { key, row, col, cell } of pending) {
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
      }
    } finally {
      this.applyingRemote = false
    }
  }

  /**
   * Write one sheet's whole remote batch with a SINGLE `set-range-values` mutation.
   *
   * `cellValue` is a SPARSE `{ [row]: { [col]: cell } }` matrix — Univer walks it with
   * `ObjectMatrix.forValue`, touching only the keys present — so scattered cells cost one dispatch
   * instead of one command each. Dispatching the mutation rather than `SetRangeValuesCommand` also
   * skips the undo-stack push, which is what we WANT here: a peer's edit must not land in this
   * user's undo history. The mutation is in Univer's `COMMAND_LISTENER_VALUE_CHANGE` list, so render
   * + formula invalidation still happen.
   *
   * Trade-off: the command path also runs `generateMutationsOfAutoHeight`, which this skips. Row
   * heights replicate through their own dimMap sync, so a remote wrap/font change no longer grows
   * the row locally until that sync lands.
   *
   * Returns false when batching isn't possible, so the caller can fall back per cell.
   */
  private applyCellsBatched(wb: WBLike, localId: string, pending: RemoteCellWrite[]): boolean {
    const unitId = wb.getId?.()
    if (!unitId) return false
    const exec = (
      this.univerAPI as unknown as { syncExecuteCommand?: (id: string, params: unknown) => unknown }
    ).syncExecuteCommand
    if (typeof exec !== 'function') return false
    const cellValue: Record<number, Record<number, unknown>> = {}
    for (const { row, col, cell } of pending) {
      // `{ v: null }` for a delete matches the previous per-cell behaviour exactly: both paths end in
      // this same mutation, which clears the cell through mergeCellData.
      const value = cell ?? { v: null }
      const rowMap = cellValue[row]
      if (rowMap) rowMap[col] = value
      else cellValue[row] = { [col]: value }
    }
    try {
      // A mutation handler returns false when it can't resolve the unit/sheet. Treat that as "not
      // applied" and let the caller retry per cell rather than marking the batch synced.
      if (exec.call(this.univerAPI, SET_RANGE_VALUES_MUTATION, { unitId, subUnitId: localId, cellValue }) === false) {
        return false
      }
    } catch {
      return false
    }
    for (const { key, cell } of pending) this.lastSeen.set(key, cell)
    return true
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

  /** Persist Univer's auto-recomputed row heights into the SAME dim map + key shape as a manual
   * row-height resize, so reload restores them via applyRemoteDims. Params differ from the manual
   * set-worksheet-row-height: heights arrive per-row in `rowsAutoHeightInfo` ({ row, autoHeight })
   * rather than one `rowHeight` spanning `ranges`. Keyed off the mutation's OWN `subUnitId` (the
   * worksheet the recompute actually targeted) — NOT the active sheet, since an auto-height pass can
   * fire against a non-focused sheet and must not write its heights under the active sheet's keys.
   * Bounds mirror the restore path (applyRemoteDims): row within grid, height finite/positive/≤cap. */
  private syncAutoRowHeightFromCommand(command: { id: string; params?: unknown }): void {
    const p = command.params as
      | { subUnitId?: string; rowsAutoHeightInfo?: Array<{ row?: number; autoHeight?: number }> }
      | undefined
    const infos = p?.rowsAutoHeightInfo
    if (!infos || infos.length === 0) return
    if (typeof p?.subUnitId !== 'string') return
    const logical = this.localToLogical.get(p.subUnitId)
    if (!logical) return
    const entries: Array<[string, number]> = []
    for (const info of infos) {
      const row = info?.row
      const h = info?.autoHeight
      if (!Number.isInteger(row) || (row as number) < 0 || (row as number) >= SHEET_MAX_ROWS) continue
      if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0 || h > SHEET_MAX_DIM_PX) continue
      entries.push([`${logical}:r${row}`, h])
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

  // ---- Drawings (images) --------------------------------------------------------------------

  /**
   * Strip the per-client / per-doc runtime ids (`unitId` / `subUnitId`) from a drawing so the
   * stored form is client-agnostic (the logical sheet id in the Y.Map key identifies the sheet).
   * They are re-attached to the receiver's local ids in applyRemoteDrawings.
   */
  private normalizeDrawing(img: StoredDrawing, drawingId: string): StoredDrawing {
    const rest: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(img)) {
      if (k === 'unitId' || k === 'subUnitId') continue
      rest[k] = v
    }
    rest.drawingId = drawingId
    return rest
  }

  /**
   * Read EVERY mapped sheet's images via the injected drawing service, keyed by
   * `${logicalId}!${drawingId}` and normalized (no local unit/subUnit ids). Cheap — a sheet
   * has at most a handful of images. Returns empty when no reader is wired (tests).
   */
  private scanAllDrawings(): Map<string, StoredDrawing> {
    const out = new Map<string, StoredDrawing>()
    const svc = this.drawingReader
    const wb = this.workbook()
    if (!svc || !wb) return out
    const unitId = wb.getId?.()
    if (!unitId) return out
    for (const [localId, logicalId] of this.localToLogical) {
      let data: Record<string, StoredDrawing> | undefined
      try {
        data = svc.getDrawingData(unitId, localId)
      } catch {
        continue
      }
      if (!data) continue
      for (const [drawingId, img] of Object.entries(data)) {
        if (!img || typeof img !== 'object') continue
        out.set(`${logicalId}!${drawingId}`, this.normalizeDrawing(img, drawingId))
      }
    }
    return out
  }

  /** Diff the live images of all sheets vs lastSeenDrawings; write only changed/removed ones. */
  private syncDrawingsToYmap(): void {
    if (!this.drawingReader) return
    const live = this.scanAllDrawings()
    const changed: Array<[string, StoredDrawing | null]> = []
    for (const [key, d] of live) {
      const prev = this.lastSeenDrawings.get(key)
      if (!prev || JSON.stringify(prev) !== JSON.stringify(d)) changed.push([key, d])
    }
    for (const key of this.lastSeenDrawings.keys()) {
      if (!live.has(key)) changed.push([key, null])
    }
    if (changed.length === 0) return
    this.drawingMap.doc?.transact(() => {
      for (const [key, d] of changed) {
        if (d) {
          this.lastSeenDrawings.set(key, d)
          this.drawingMap.set(key, d)
        } else {
          this.lastSeenDrawings.delete(key)
          this.drawingMap.delete(key)
        }
      }
    })
  }

  /**
   * Apply remote-changed drawing keys into the sheet each names (by logical id). Insert vs update
   * is decided by whether the image already exists locally; a deleted key removes it. Writes go
   * through the FWorksheet drawing facade (which fires the proper commands + updates the UI); the
   * `applyingRemote` guard stops those commands from echoing back into the Y.Map. Per-item isolation
   * mirrors the cell path: one bad image can't abort the batch, and lastSeen is only recorded on
   * success so a failed apply is retried on a later pass.
   */
  private applyRemoteDrawings(keys: string[]): void {
    const wb = this.workbook()
    if (!wb) return
    const unitId = wb.getId?.()
    if (!unitId) return
    this.applyingRemote = true
    try {
      for (const key of keys) {
        const bang = key.indexOf('!')
        if (bang < 0) continue
        const logicalId = key.slice(0, bang)
        const drawingId = key.slice(bang + 1)
        if (!drawingId) continue
        const localId = this.logicalToLocal.get(logicalId)
        if (!localId) continue // sheet not created locally yet (registry reconcile pending)
        const sheet = wb.getSheetBySheetId?.(localId) ?? null
        if (!sheet) continue
        const stored = this.drawingMap.get(key) ?? null
        // Existence check via the drawing service (covers ALL drawing types — images AND float-DOM
        // formulas/charts). getImageById only matches images, so it can't tell if a DOM drawing
        // already exists (which would double-insert on update).
        const alreadyThere = (() => {
          try {
            return !!this.drawingReader?.getDrawingData(unitId, localId)?.[drawingId]
          } catch {
            return false
          }
        })()
        try {
          if (stored) {
            // insertImages/updateImages just dispatch Insert/SetSheetDrawingCommand with the drawing
            // param, so they work for DRAWING_DOM too (render is driven by the drawing-add listener,
            // which handles the DOM type) — not only images.
            const drawing: StoredDrawing = { ...stored, unitId, subUnitId: localId, drawingId }
            if (alreadyThere) sheet.updateImages?.([drawing])
            else sheet.insertImages?.([drawing])
            this.lastSeenDrawings.set(key, stored)
          } else {
            // Delete: an image has an FOverGridImage (deleteImages); a float-DOM drawing does not,
            // so fall back to removeFloatDom by id.
            const img = sheet.getImageById?.(drawingId)
            if (img) sheet.deleteImages?.([img])
            else if (alreadyThere) sheet.removeFloatDom?.(drawingId)
            this.lastSeenDrawings.delete(key)
          }
        } catch {
          // leave lastSeenDrawings untouched so a later pass retries this drawing
        }
      }
    } finally {
      this.applyingRemote = false
    }
  }

  // ---- Hyperlinks ---------------------------------------------------------------------------

  /** Read EVERY mapped sheet's hyperlinks via the model, keyed by `${logicalId}!${id}`. */
  private scanAllHyperLinks(): Map<string, StoredHyperLink> {
    const out = new Map<string, StoredHyperLink>()
    const model = this.hyperLinkModel
    const wb = this.workbook()
    if (!model || !wb) return out
    const unitId = wb.getId?.()
    if (!unitId) return out
    for (const [localId, logicalId] of this.localToLogical) {
      let links: StoredHyperLink[] = []
      try {
        links = model.getSubUnit(unitId, localId) ?? []
      } catch {
        continue
      }
      for (const l of links) {
        if (!l || typeof l.id !== 'string') continue
        // Strip nothing local here: id/row/column/payload/display are all portable.
        out.set(`${logicalId}!${l.id}`, {
          id: l.id,
          row: l.row,
          column: l.column,
          payload: l.payload,
          ...(l.display !== undefined ? { display: l.display } : {}),
        })
      }
    }
    return out
  }

  /** Diff live hyperlinks of all sheets vs lastSeenLinks; write only changed/removed ones. */
  private syncHyperLinksToYmap(): void {
    if (!this.hyperLinkModel) return
    const live = this.scanAllHyperLinks()
    const changed: Array<[string, StoredHyperLink | null]> = []
    for (const [key, l] of live) {
      const prev = this.lastSeenLinks.get(key)
      if (!prev || JSON.stringify(prev) !== JSON.stringify(l)) changed.push([key, l])
    }
    for (const key of this.lastSeenLinks.keys()) {
      if (!live.has(key)) changed.push([key, null])
    }
    if (changed.length === 0) return
    this.hyperLinkMap.doc?.transact(() => {
      for (const [key, l] of changed) {
        if (l) {
          this.lastSeenLinks.set(key, l)
          this.hyperLinkMap.set(key, l)
        } else {
          this.lastSeenLinks.delete(key)
          this.hyperLinkMap.delete(key)
        }
      }
    })
  }

  /**
   * Apply remote-changed hyperlink keys into the sheet each names (by logical id). Add / update /
   * remove via the model; the `applyingRemote` guard stops the model's linkUpdate$ from echoing
   * back into the Y.Map. Per-item isolation mirrors the cell/drawing paths.
   */
  private applyRemoteHyperLinks(keys: string[]): void {
    const model = this.hyperLinkModel
    const wb = this.workbook()
    if (!model || !wb) return
    const unitId = wb.getId?.()
    if (!unitId) return
    this.applyingRemote = true
    try {
      for (const key of keys) {
        const bang = key.indexOf('!')
        if (bang < 0) continue
        const logicalId = key.slice(0, bang)
        const id = key.slice(bang + 1)
        if (!id) continue
        const localId = this.logicalToLocal.get(logicalId)
        if (!localId) continue // sheet not created locally yet (registry reconcile pending)
        const stored = this.hyperLinkMap.get(key) ?? null
        try {
          if (stored) {
            // Remote-apply boundary: a peer could have written an unsanitized payload before this
            // guard existed (or via a non-import path), so re-check the scheme here too — the
            // editor's rule is to sanitize at BOTH the parse and the apply boundary.
            const safePayload = sanitizeLinkHref(stored.payload)
            if (!safePayload) {
              // Drop a pseudo-scheme link rather than replicate it; remove any stale local copy.
              if (model.getHyperLink(unitId, localId, id)) model.removeHyperLink(unitId, localId, id)
              this.lastSeenLinks.set(key, stored)
              continue
            }
            const existing = model.getHyperLink(unitId, localId, id)
            if (existing) {
              model.updateHyperLink(unitId, localId, id, { payload: safePayload, display: stored.display }, true)
            } else {
              model.addHyperLink(unitId, localId, {
                id: stored.id,
                row: stored.row,
                column: stored.column,
                payload: safePayload,
                ...(stored.display !== undefined ? { display: stored.display } : {}),
              })
            }
            this.lastSeenLinks.set(key, stored)
          } else {
            if (model.getHyperLink(unitId, localId, id)) model.removeHyperLink(unitId, localId, id)
            this.lastSeenLinks.delete(key)
          }
        } catch {
          // leave lastSeenLinks untouched so a later pass retries this link
        }
      }
    } finally {
      this.applyingRemote = false
    }
  }

  /**
   * Read every sheet's protection rules, keyed by logical id. Runtime `unitId`/`subUnitId` are
   * dropped (they differ per client — see StoredProtection) and re-derived on apply.
   *
   * Returns NULL — never an empty map — when the live state could not be READ (no workbook, no
   * unit id, or a model that threw). The caller diffs this against lastSeenProtection and treats
   * "absent from live" as "the user deleted it", so an empty map on read failure means a transient
   * local glitch is replicated to every peer as a permanent, un-undoable deletion of all protection
   * (WS-PROT-9b/9c). No information must therefore be distinguishable from "nothing is protected".
   * This mirrors applyRemoteProtection's own policy: on failure, leave lastSeenProtection untouched
   * so a later pass retries.
   */
  private scanAllProtection(): Map<string, StoredProtection> | null {
    const out = new Map<string, StoredProtection>()
    const wb = this.workbook()
    if (!wb) return null
    const unitId = wb.getId?.()
    if (!unitId) return null
    for (const [localId, logicalId] of this.localToLogical) {
      if (this.rangeProtectionModel) {
        let rules: unknown[] = []
        try {
          rules = this.rangeProtectionModel.getSubunitRuleList(unitId, localId) ?? []
        } catch {
          return null
        }
        for (const raw of rules) {
          if (raw == null || typeof raw !== 'object') continue
          const r = raw as Record<string, unknown>
          if (typeof r.id !== 'string' || typeof r.permissionId !== 'string') continue
          out.set(protectionKey(logicalId, 'r', r.id), {
            kind: 'r',
            id: r.id,
            permissionId: r.permissionId,
            ...(typeof r.description === 'string' ? { description: r.description } : {}),
            ...(typeof r.unitType === 'number' ? { unitType: r.unitType } : {}),
            ...(typeof r.viewState === 'string' ? { viewState: r.viewState } : {}),
            ...(typeof r.editState === 'string' ? { editState: r.editState } : {}),
            ranges: pickRanges(r.ranges),
          })
        }
      }
      if (this.worksheetProtectionModel) {
        let raw: unknown
        try {
          raw = this.worksheetProtectionModel.getRule(unitId, localId)
        } catch {
          // Same policy as the range half: a read that threw is NOT "no rule here" (WS-PROT-9b).
          return null
        }
        if (raw != null && typeof raw === 'object') {
          const r = raw as Record<string, unknown>
          if (typeof r.permissionId === 'string') {
            out.set(protectionKey(logicalId, 'w'), {
              kind: 'w',
              permissionId: r.permissionId,
              ...(typeof r.description === 'string' ? { description: r.description } : {}),
              ...(typeof r.unitType === 'number' ? { unitType: r.unitType } : {}),
              ...(typeof r.viewState === 'string' ? { viewState: r.viewState } : {}),
              ...(typeof r.editState === 'string' ? { editState: r.editState } : {}),
            })
          }
        }
      }
    }
    return out
  }

  /** Diff live protection rules of all sheets vs lastSeenProtection; write only changed/removed. */
  /**
   * Read the local permission-point association for every mapped sheet.
   *
   * Returns null when the live state could not be READ — never an empty map. Diffing an empty map
   * against `lastSeenPoints` would emit a delete for every tracked key and wipe the operation matrix
   * for every collaborator, permanently. Same policy (and same reason) as scanAllProtection.
   */
  private scanAllPoints(): Map<string, StoredPoint> | null {
    const out = new Map<string, StoredPoint>()
    if (!this.worksheetPointModel) return out
    const wb = this.workbook()
    if (!wb) return null
    const unitId = wb.getId?.()
    if (!unitId) return null
    for (const [localId, logicalId] of this.localToLogical) {
      let raw: unknown
      try {
        raw = this.worksheetPointModel.getRule(unitId, localId)
      } catch {
        return null
      }
      if (raw != null && typeof raw === 'object') {
        const pid = (raw as { permissionId?: unknown }).permissionId
        if (typeof pid === 'string' && pid) out.set(logicalId, { permissionId: pid })
      }
    }
    return out
  }

  /** Local -> Yjs for permission points. Diff, like every other field; never a blind overwrite. */
  private syncPointsToYmap(): void {
    if (!this.worksheetPointModel) return
    const live = this.scanAllPoints()
    if (live === null) return
    const doc = this.pointsMap.doc
    if (!doc) return
    doc.transact(() => {
      for (const [logicalId, point] of live) {
        if (this.lastSeenPoints.get(logicalId) !== point.permissionId) {
          this.pointsMap.set(logicalId, point)
        }
      }
      for (const logicalId of this.lastSeenPoints.keys()) {
        if (!live.has(logicalId)) this.pointsMap.delete(logicalId)
      }
    })
    this.lastSeenPoints.clear()
    for (const [logicalId, point] of live) this.lastSeenPoints.set(logicalId, point.permissionId)
  }

  /**
   * Yjs -> local for permission points. `addRule` takes the whole rule and reads unitId/subUnitId off
   * it, so THIS client's runtime ids are attached here — the shared map carries only the logical id
   * and the permissionId, for the same per-client-id reason as drawings and protection rules.
   */
  private applyRemotePoints(keys: string[]): void {
    if (!this.worksheetPointModel) return
    const wb = this.workbook()
    if (!wb) return
    const unitId = wb.getId?.()
    if (!unitId) return
    this.applyingRemote = true
    try {
      for (const logicalId of keys) {
        const localId = this.logicalToLocal.get(logicalId)
        if (!localId) continue // sheet not created locally yet (registry reconcile pending)
        const stored = this.pointsMap.get(logicalId) ?? null
        const pid = stored && typeof stored === 'object' ? stored.permissionId : null
        if (typeof pid === 'string' && pid) {
          this.worksheetPointModel.addRule({ unitId, subUnitId: localId, permissionId: pid })
          // RECORD IT. `lastSeenPoints` is the only ledger `syncPointsToYmap` walks to emit deletes,
          // so an association that arrived from a peer and was never written here could not be
          // removed: the admin dropped the restriction locally, the live scan correctly found
          // nothing, and the delete pass had no key to act on. The stale permissionId stayed in the
          // shared map and the restriction stuck for everyone. WS-PROT-13.
          this.lastSeenPoints.set(logicalId, pid)
        } else {
          this.worksheetPointModel.deleteRule(unitId, localId)
          this.lastSeenPoints.delete(logicalId)
        }
      }
    } finally {
      this.applyingRemote = false
    }
  }

  private syncProtectionToYmap(): void {
    if (!this.rangeProtectionModel && !this.worksheetProtectionModel) return
    const live = this.scanAllProtection()
    // null = the live state could not be READ. Diffing against lastSeenProtection here would emit a
    // delete for every tracked key and wipe protection for every peer, permanently (WS-PROT-9b/9c).
    // Abort and let the next command / model emission retry.
    if (live === null) return
    const changed: Array<[string, StoredProtection | null]> = []
    for (const [key, p] of live) {
      const prev = this.lastSeenProtection.get(key)
      if (!prev || JSON.stringify(prev) !== JSON.stringify(p)) changed.push([key, p])
    }
    for (const key of this.lastSeenProtection.keys()) {
      if (!live.has(key)) changed.push([key, null])
    }
    if (changed.length === 0) return
    this.protectionMap.doc?.transact(() => {
      for (const [key, p] of changed) {
        if (p) {
          this.lastSeenProtection.set(key, p)
          this.protectionMap.set(key, p)
        } else {
          this.lastSeenProtection.delete(key)
          this.protectionMap.delete(key)
        }
      }
    })
  }

  /**
   * Apply remote-changed protection keys into the sheet each names (by logical id). The
   * `applyingRemote` guard stops each model's ruleChange$ from echoing straight back into the
   * Y.Map. Per-item isolation mirrors the cell / drawing / hyperlink paths: one bad rule must not
   * abort the batch, and lastSeenProtection is recorded ONLY on success so a failure retries.
   */
  private applyRemoteProtection(keys: string[]): void {
    const wb = this.workbook()
    if (!wb) return
    const unitId = wb.getId?.()
    if (!unitId) return
    this.applyingRemote = true
    try {
      for (const key of keys) {
        const bang = key.indexOf('!')
        if (bang < 0) continue
        const logicalId = key.slice(0, bang)
        const rest = key.slice(bang + 1)
        const colon = rest.indexOf(':')
        if (colon < 0) continue
        const kind = rest.slice(0, colon)
        const ruleId = rest.slice(colon + 1)
        if (kind !== 'r' && kind !== 'w') continue
        const localId = this.logicalToLocal.get(logicalId)
        if (!localId) continue // sheet not created locally yet (registry reconcile pending)
        const stored = this.protectionMap.get(key) ?? null
        try {
          if (kind === 'r') {
            const model = this.rangeProtectionModel
            if (!model || !ruleId) continue
            if (stored) {
              // Re-attach THIS client's runtime ids; everything else rides from the peer.
              const rule = {
                ...stored,
                id: ruleId,
                unitId,
                subUnitId: localId,
                ranges: pickRanges(stored.ranges),
              }
              delete (rule as Record<string, unknown>).kind
              if (model.getRule(unitId, localId, ruleId)) model.setRule(unitId, localId, ruleId, rule)
              else model.addRule(unitId, localId, rule)
              this.lastSeenProtection.set(key, stored)
            } else {
              if (model.getRule(unitId, localId, ruleId)) model.deleteRule(unitId, localId, ruleId)
              this.lastSeenProtection.delete(key)
            }
          } else {
            const model = this.worksheetProtectionModel
            if (!model) continue
            if (stored) {
              const rule = { ...stored, unitId, subUnitId: localId }
              delete (rule as Record<string, unknown>).kind
              delete (rule as Record<string, unknown>).ranges
              if (model.getRule(unitId, localId)) model.setRule(unitId, localId, rule)
              else model.addRule(unitId, rule)
              this.lastSeenProtection.set(key, stored)
            } else {
              if (model.getRule(unitId, localId)) model.deleteRule(unitId, localId)
              this.lastSeenProtection.delete(key)
            }
          }
        } catch {
          // leave lastSeenProtection untouched so a later pass retries this rule
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
    try {
      this.hyperLinkSub?.unsubscribe()
      this.rangeProtSub?.unsubscribe()
      this.worksheetProtSub?.unsubscribe()
    } catch {
      // ignore
    }
    this.ymap.unobserve(this.observer)
    this.dimMap.unobserve(this.dimObserver)
    this.mergeMap.unobserve(this.mergeObserver)
    this.sheetListMap.unobserve(this.sheetListObserver)
    this.drawingMap.unobserve(this.drawingObserver)
    this.hyperLinkMap.unobserve(this.hyperLinkObserver)
    this.protectionMap.unobserve(this.protectionObserver)
    this.protectionGrantsMap.unobserve(this.protectionGrantsObserver)
    this.pointsMap.unobserve(this.pointsObserver)
    this.pointSub?.unsubscribe()
    this.pointSub = null
    this.lastSeen.clear()
    this.lastSeenDims.clear()
    this.lastSeenMerges.clear()
    this.lastSeenDrawings.clear()
    this.lastSeenLinks.clear()
    this.lastSeenProtection.clear()
    // Same ledger discipline as its siblings. Left populated, a re-created binding over the same
    // maps would start with a stale points ledger and could emit a delete for an association it
    // never actually observed this session.
    this.lastSeenPoints.clear()
    this.logicalToLocal.clear()
    this.localToLogical.clear()
  }
}
