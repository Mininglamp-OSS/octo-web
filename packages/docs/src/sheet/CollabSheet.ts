// Collaborative spreadsheet assembly — the sheet counterpart of collab/createCollabEditor.ts.
//
// Owns exactly one Y.Doc + one HocuspocusProvider + one Univer instance +
// one UniverYjsBinding + one IndexeddbPersistence per sheet, and reuses the
// SAME documentName / collab-token / role / close-code machinery as the Tiptap
// editor path. The only sheet-specific parts are: (a) we mount Univer (not a
// Tiptap Editor) into a DOM container, and (b) the Y.Doc payload lives in the
// 'sheet' Y.Map (see binding.ts), not the Tiptap XmlFragment.
//
// Read-only enforcement note: writes from non-writers are rejected server-side
// by the backend's beforeHandleMessage (§4.5). A UI-level read-only lock for
// Univer is a follow-up (needs the Univer permission Facade verified first);
// for V1 the backend is the authority, same trust boundary as the editor path.

import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { IndexeddbPersistence } from 'y-indexeddb'
import { LocaleType, mergeLocales } from '@univerjs/core'
import { createUniver } from './createUniver.ts'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import sheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN'
import '@univerjs/preset-sheets-core/lib/index.css'

import { buildDocumentName } from '../documentName/index.ts'
import { resolveCollabWsUrl } from '../config.ts'
import { t } from '../octoweb/index.ts'
import { canEdit, type Role } from '../auth/roles.ts'
import { getCollabToken, getCollabTokenEntry, disposeToken } from '../auth/collabToken.ts'
import { cacheKey, deleteDatabaseAwait, type DocScope } from '../offline/cache.ts'
import { RoleController } from '../collab/statelessRole.ts'
import { CloseCodeMachine, type CloseEvent } from '../collab/closeCode.ts'
import type { ConnState, TerminalState } from '../collab/createCollabEditor.ts'
import { UniverYjsBinding } from './binding.ts'
import { SheetCursorOverlay } from './sheetCursors.ts'
import { SheetCommentMarkers, type MarkedCell } from './sheetCommentMarkers.ts'
import { colorFromId } from '../awareness/presence.ts'

/** 0-based column index → spreadsheet letters (0→A, 26→AA). */
function colToA1(col: number): string {
  let n = col
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

/**
 * Whether the app is in dark mode. The octo app toggles `body[theme-mode="dark"]`
 * (dmworkbase App.tsx) across web/desktop; we honor that first, then fall back to
 * the OS `prefers-color-scheme`. Used to render the Univer grid to match the app.
 */
function isDarkTheme(): boolean {
  try {
    if (typeof document !== 'undefined') {
      const mode = document.body.getAttribute('theme-mode')
      if (mode) return mode === 'dark'
    }
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

export interface CollabSheetOptions {
  uid: string
  space: string
  folder: string
  doc: string
  /** Stable doc id for REST (members, etc.). */
  docId: string
  user: { id: string; name: string; avatar?: string }
  /** The DOM element Univer renders into. Must be attached + sized by the caller. */
  container: HTMLElement
  /** Disable local persistence for high-confidentiality docs (§6.4). */
  disableOfflineCache?: boolean
  onRole?: (role: Role) => void
  onConnState?: (state: ConnState) => void
  onTerminal?: (state: TerminalState) => void
}

export class CollabSheet {
  readonly documentName: string
  readonly ydoc: Y.Doc
  readonly provider: HocuspocusProvider
  readonly persistence: IndexeddbPersistence | null

  private readonly univer: ReturnType<typeof createUniver>['univer']
  private readonly univerAPI: ReturnType<typeof createUniver>['univerAPI']
  private readonly binding: UniverYjsBinding
  private cursors: SheetCursorOverlay | null = null
  private commentMarkers: SheetCommentMarkers | null = null
  private commentMarkerClick: ((row: number, col: number, sheetId: string) => void) | null = null
  private commentMenuClick: (() => void) | null = null
  private readonly cacheKeyStr: string
  private readonly roleController: RoleController
  private readonly closeMachine: CloseCodeMachine
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private sealTimer: ReturnType<typeof setTimeout> | null = null

  private currentRole: Role
  private destroyed = false

  private constructor(opts: CollabSheetOptions, initialRole: Role, initialEpoch: number, wsUrl: string) {
    const scope: DocScope = { uid: opts.uid, space: opts.space, folder: opts.folder, doc: opts.doc }
    this.documentName = buildDocumentName(opts.space, opts.folder, opts.doc)
    this.cacheKeyStr = cacheKey(scope)
    this.currentRole = initialRole

    // 1) single Y.Doc
    this.ydoc = new Y.Doc()

    // 2) local persistence before network
    this.persistence = opts.disableOfflineCache
      ? null
      : new IndexeddbPersistence(this.cacheKeyStr, this.ydoc)

    // 3) provider — connect:false; we wire listeners then connect.
    this.provider = new HocuspocusProvider({
      url: wsUrl,
      name: this.documentName,
      document: this.ydoc,
      token: () => getCollabToken(this.documentName),
      connect: false,
    })

    // Publish presence identity into Yjs awareness so the shared PresenceBar shows this
    // user's avatar (the doc gets this for free via Tiptap's CollaborationCaret; the sheet
    // has no such extension, so we set the same `user` field ourselves). color is a stable
    // #6-hex from the uid — matches the backend's validateAwarenessStates (id/name/color) check.
    this.provider.awareness?.setLocalStateField('user', {
      id: opts.user.id,
      name: opts.user.name,
      color: colorFromId(opts.user.id),
      avatar: opts.user.avatar,
    })

    // 4) Univer instance mounted into the caller's container + an empty workbook,
    //    then bind it to the shared Y.Doc. The binding seeds from whichever side
    //    has data (existing session vs fresh book).
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.ZH_CN,
      locales: { [LocaleType.ZH_CN]: mergeLocales(sheetsCoreZhCN) },
      darkMode: isDarkTheme(),
      presets: [
        UniverSheetsCorePreset({
          container: opts.container,
          // Hide the built-in "数据" (Data) ribbon tab. Its only entry is
          // "文本转数字" (text-to-number), which we don't want. Hiding the toolbar
          // menu item empties the DATA ribbon group, so the whole 数据 tab disappears;
          // we also hide the right-click counterpart for consistency.
          menu: {
            'sheet.toolbar.text-to-number': { hidden: true },
            'sheet.contextMenu.text-to-number': { hidden: true },
          },
        }),
      ],
    })
    this.univer = univer
    // Create the workbook with an explicit, generously-sized default sheet. An empty
    // `createWorkbook({})` gets Univer's default worksheet of only 20 columns (A–T), so a
    // formula referencing anything from column U onward (e.g. `=A1+Z99`) can't resolve the
    // reference and yields `#NAME?` instead of treating the empty cell as 0. Declaring
    // 1000×100 makes those references valid empty cells. This does NOT inflate sync cost:
    // binding.ts scans only the used (content) range, not the declared dimensions.
    univerAPI.createWorkbook({
      id: 'octo-sheet',
      sheetOrder: ['octo-sheet-1'],
      sheets: {
        'octo-sheet-1': {
          id: 'octo-sheet-1',
          name: 'Sheet1',
          rowCount: 1000,
          columnCount: 100,
          cellData: {},
        },
      },
    })
    this.univerAPI = univerAPI
    // Pass a live write-gate: readers / downgraded users must NOT write to the shared Y.Doc
    // (the server rejects their writes anyway, but an ungated binding would still persist the
    // edit to local IndexedDB and replay it on a later privilege upgrade — B3).
    // Defer the binding's initial seed/registry decision until local (IndexedDB) state has
    // replayed. Constructing eagerly would let a writer reopening an EXISTING sheet on a cold
    // cache see an empty-looking Y.Doc, fall into the "brand-new" branch, and author
    // `sheetList.default = {name:'Sheet1'}` — which LWW then merges against the about-to-load
    // persisted registry and can revert a renamed first sheet back to "Sheet1" (P1-B). Observers
    // attach eagerly inside the binding, so anything that syncs in during the wait is captured;
    // initialSync() is idempotent and only runs the seed decision once, against the settled doc.
    this.binding = new UniverYjsBinding(univerAPI, this.ydoc, () => canEdit(this.currentRole), {
      deferInitialSync: true,
    })
    // Drive it after the local cache has replayed (whenSynced), or immediately if offline cache
    // is disabled (no persistence layer to wait on). A one-shot guard + the binding's own
    // idempotency make a later provider 'synced' or the timeout fallback harmless.
    if (this.persistence) {
      let sealed = false
      const seal = (networkSynced: boolean) => {
        // The registry-authoring decision (brand-new-author branch) may only run when the NETWORK
        // is synced. A local-only signal (whenSynced on a cold/empty cache) passes networkSynced
        // =false, so binding.initialSync defers authoring and does NOT mark itself done; a later
        // provider 'synced' seal (networkSynced=true) then authors against the settled doc. Non-
        // authoring paths (join existing / legacy V1 / reader) complete on the first signal
        // regardless, and `sealed` flips only once initialSync actually commits (initialSynced).
        if (this.destroyed) return
        if (sealed && this.binding.hasInitialSynced()) return
        this.binding.initialSync(networkSynced)
        if (this.binding.hasInitialSynced()) sealed = true
      }
      // Local replay signal — network is authoritative only if the provider ALSO happens to be
      // synced already; otherwise this is a local-only wake and must not author.
      void this.persistence.whenSynced.then(() => seal(this.provider.synced))
      if (this.provider.synced) seal(true)
      else this.provider.on('synced', () => seal(true))
      // Fallback: never leave the sheet blank if neither signal resolves. Author only if the
      // network is actually synced by then; otherwise this is a no-op and a later 'synced' seals.
      this.sealTimer = setTimeout(() => seal(this.provider.synced), 3000)
    } else {
      // No offline cache: the provider is the only source of truth. Seal on its sync so we never
      // author a registry over a doc whose persisted state hasn't arrived yet.
      if (this.provider.synced) this.binding.initialSync(true)
      else {
        let sealed = false
        const seal = () => {
          if (sealed || this.destroyed) return
          sealed = true
          this.binding.initialSync(true)
        }
        this.provider.on('synced', seal)
        this.sealTimer = setTimeout(seal, 3000)
      }
    }
    // UI read-only lock so a reader can't even type (mirrors the editor's editable gate).
    this.setUniverEditable(canEdit(initialRole))

    // Add a "评论" item to the cell (main-area) right-click menu, in its "others" group.
    // createMenu/appendTo are public Univer facade methods (no internal tokens needed);
    // the action opens the comment panel for the right-clicked cell via a handler the
    // view registers. Wrapped defensively so a Univer API change can't break sheet load.
    try {
      const api = univerAPI as unknown as {
        createMenu(item: { id: string; title: string; action: () => void }): {
          appendTo(path: string | string[]): void
        }
      }
      api
        .createMenu({ id: 'octo.sheet.comment', title: t('docs.sheet.comment.menu'), action: () => this.commentMenuClick?.() })
        .appendTo(['contextMenu.mainArea', 'contextMenu.others'])
    } catch {
      // Univer menu API unavailable/changed — skip the context-menu entry (panel still works).
    }
    // Remote-cursor overlay: shows other users' active cells (color + name tag). It reads the
    // active LOGICAL sheet id (via the resolver) both to tag the local user's broadcast cursor
    // and to filter remote cursors to the current sheet, so a peer's Sheet2 cursor never paints
    // over your Sheet1.
    if (this.provider.awareness) {
      this.cursors = new SheetCursorOverlay(
        univerAPI as unknown as ConstructorParameters<typeof SheetCursorOverlay>[0],
        this.provider.awareness as unknown as ConstructorParameters<typeof SheetCursorOverlay>[1],
        opts.container,
        () => this.binding.activeLogicalId(),
      )
    }
    // Comment-marker overlay: a corner badge on each commented cell (fed by the panel).
    // Clicking a badge routes through a handler the view registers (open panel + focus).
    // The resolver lets the overlay draw only badges whose logical sheet is active.
    this.commentMarkers = new SheetCommentMarkers(
      univerAPI as unknown as ConstructorParameters<typeof SheetCommentMarkers>[0],
      opts.container,
      (row, col, sheetId) => this.commentMarkerClick?.(row, col, sheetId),
      () => this.binding.activeLogicalId(),
    )
    // Role controller: runtime stateless role changes (monotonic epoch).
    this.roleController = new RoleController({
      documentName: this.documentName,
      initialRole,
      initialEpoch,
      onRole: (role) => {
        this.currentRole = role
        // Toggle the Univer UI read-only lock to match the new role (backend also enforces).
        this.setUniverEditable(canEdit(role))
        opts.onRole?.(role)
      },
    })

    // Close-code state machine: the only auth-recovery source is event.code.
    this.closeMachine = new CloseCodeMachine({
      disposeToken: () => disposeToken(this.documentName),
      connect: () => this.provider.connect(),
      disconnect: () => this.provider.disconnect(),
      goLogin: () => opts.onTerminal?.({ kind: 'login' }),
      showForbidden: () => opts.onTerminal?.({ kind: 'deleted' }),
      exitDocument: () => opts.onTerminal?.({ kind: 'not-found' }),
      showLockedOrArchived: () => opts.onTerminal?.({ kind: 'locked' }),
      clearDocCache: () => {
        void this.clearCache()
      },
      rollbackPending: () => {
        // No optimistic-edit buffer for sheets, but a forbidden/epoch close means the user
        // just lost write access — lock the grid read-only so nothing more can be typed.
        this.setUniverEditable(false)
      },
      onTransientClose: () => {
        opts.onConnState?.('disconnected')
      },
      deferReconnect: ({ delayMs }) => {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
        this.reconnectTimer = setTimeout(() => {
          if (!this.destroyed && !this.closeMachine.isTerminated()) this.provider.connect()
        }, delayMs)
      },
      reportServerError: (event) => {
        void event
      },
      backoffDelay: () => 5_000,
    })

    // Listeners registered BEFORE connect.
    this.provider.on('status', (e: { status: ConnState }) => opts.onConnState?.(e.status))
    this.provider.on('synced', () => this.closeMachine.onAuthStable())
    this.provider.on('authenticated', () => this.closeMachine.onAuthStable())
    this.provider.on('stateless', (e: { payload: string }) => {
      this.roleController.handleStatelessFrame(e.payload)
    })
    this.provider.on('close', (e: { event: CloseEvent }) => {
      this.closeMachine.handleClose(e.event)
    })

    // Emit the initial role immediately so the UI (e.g. the members panel, which is
    // admin-only) knows the caller's role without waiting for a runtime stateless frame.
    opts.onRole?.(initialRole)

    // Now connect.
    this.provider.connect()
  }

  /** Identity-first construction (§6.1): confirm identity + role BEFORE wiring network. */
  static async create(opts: CollabSheetOptions): Promise<CollabSheet> {
    const documentName = buildDocumentName(opts.space, opts.folder, opts.doc)
    const entry = await getCollabTokenEntry(documentName)
    const wsUrl = resolveCollabWsUrl(entry.collabWsUrl)
    return new CollabSheet(opts, entry.role, entry.permission_epoch, wsUrl)
  }

  getRole(): Role {
    return this.currentRole
  }

  /**
   * Toggle the whole workbook read-only via Univer's WorkbookEditablePermission. Readers /
   * downgraded users get a locked grid (can't type). Defensive: a Univer API change must not
   * break sheet load, and the binding write-gate is the authoritative stop regardless.
   */
  private setUniverEditable(editable: boolean): void {
    try {
      ;(this.univerAPI.getActiveWorkbook() as unknown as { setEditable?: (v: boolean) => void } | null)?.setEditable?.(
        editable,
      )
    } catch {
      // ignore — write-gate in the binding still prevents unauthorized writes
    }
  }

  /**
   * Update this user's presence display name (avatars + remote-cursor tag). Called once the
   * member-name lookup resolves, since the name isn't known when the sheet is first created.
   */
  updatePresenceName(name: string): void {
    if (!name) return
    const cur = (this.provider.awareness?.getLocalState()?.user ?? {}) as Record<string, unknown>
    this.provider.awareness?.setLocalStateField('user', { ...cur, name })
  }

  /**
   * The currently-selected cell as a stable anchor. `key` matches the Y.Map cell key
   * (`${logicalSheetId}!${row}:${col}`) used for comment anchoring; `a1` is the human A1 label.
   * The sheet segment is the STABLE logical id (not Univer's per-client sheet id) so a comment
   * authored on Sheet2 anchors to Sheet2 for every client — see binding.ts multi-sheet identity.
   */
  getActiveCellRef(): { key: string; a1: string; sheetId: string } | null {
    const wb = this.univerAPI.getActiveWorkbook()
    if (!wb) return null
    const sheet = wb.getActiveSheet()
    if (!sheet) return null
    const range = sheet.getActiveRange()
    if (!range) return null
    const r = range.getRange()
    const row = r.startRow ?? 0
    const col = r.startColumn ?? 0
    const logicalId = this.binding.activeLogicalId()
    return { key: `${logicalId}!${row}:${col}`, a1: `${colToA1(col)}${row + 1}`, sheetId: logicalId }
  }

  /**
   * The active cell plus its on-screen rect (relative to `.octo-sheet-container`), for
   * anchoring an inline comment composer next to the cell — the sheet counterpart of the
   * doc editor's selection bubble. Rect matches the comment badge geometry exactly.
   */
  getActiveCellAnchor():
    | { row: number; col: number; a1: string; key: string; left: number; top: number; width: number; height: number }
    | null {
    const ref = this.getActiveCellRef()
    if (!ref) return null
    const rc = ref.key.split('!')[1]?.split(':')
    const row = Number(rc?.[0])
    const col = Number(rc?.[1])
    if (!Number.isInteger(row) || !Number.isInteger(col)) return null
    const rect = this.commentMarkers?.cellScreenRect(row, col)
    if (!rect) return null
    return { row, col, a1: ref.a1, key: ref.key, ...rect }
  }

  /**
   * Select + scroll to a cell (used to jump from a comment thread to its cell). When the
   * comment lives on a DIFFERENT logical sheet than the active one, switch to that sheet
   * first — otherwise the jump would activate a cell on the wrong sheet. `sheetId` is the
   * logical id from the comment anchor; omit it (legacy calls) to stay on the active sheet.
   */
  focusCell(row: number, col: number, sheetId?: string): void {
    if (sheetId) this.binding.activateLogical(sheetId)
    const sheet = this.univerAPI.getActiveWorkbook()?.getActiveSheet()
    if (!sheet) return
    try {
      sheet.getRange(row, col).activate()
    } catch {
      // out-of-range or not ready — ignore
    }
  }

  /**
   * Notify when the active cell changes (selection op). Fires with the same {key, a1, sheetId}
   * shape as getActiveCellRef. Used by the comment panel to highlight the thread anchored
   * to the just-selected cell. Returns a disposer.
   */
  onActiveCell(cb: (ref: { key: string; a1: string; sheetId: string } | null) => void): () => void {
    const d = this.univerAPI.onCommandExecuted((cmd: { id: string }) => {
      if (cmd.id === 'sheet.operation.set-selections') cb(this.getActiveCellRef())
    })
    return () => {
      try {
        d.dispose()
      } catch {
        // ignore
      }
    }
  }

  /**
   * Feed the set of commented cells to the marker overlay (called by the comment panel). Cells
   * carry their logical `sheetId`; the overlay draws only those on the active sheet so a badge
   * for a comment on Sheet2 never appears over Sheet1.
   */
  setCommentedCells(cells: MarkedCell[]): void {
    this.commentMarkers?.setCells(cells)
  }

  /**
   * Bulk-write imported cells (from an .xlsx upload) into the active sheet, starting at A1.
   * The binding then syncs them to the shared Y.Doc, so an import persists and replicates to
   * other clients like any edit. Clamped to the declared sheet size. Returns false if nothing
   * could be written.
   */
  /**
   * Import one or more parsed worksheets. The first reuses the workbook's active (default)
   * sheet; each subsequent one is created via insertSheet. Every setValues / insertSheet /
   * merge fires a command the binding observes, so the whole multi-sheet import replicates
   * + persists through Yjs. Returns true if any sheet applied.
   */
  importCells(
    sheets: Array<{
      name?: string
      matrix: Array<Array<{ v?: unknown; f?: string; s?: Record<string, unknown> } | null>>
      merges?: Array<{ startRow: number; startColumn: number; endRow: number; endColumn: number }>
    }>,
  ): boolean {
    const wb = this.univerAPI.getActiveWorkbook() as unknown as {
      getActiveSheet: () => unknown
      insertSheet?: (name?: string) => unknown
    } | null
    if (!wb) return false
    const parsed = sheets.filter((s) => s.matrix.length > 0)
    if (parsed.length === 0) return false
    let anyApplied = false
    parsed.forEach((ps, i) => {
      let ws: unknown
      if (i === 0) {
        ws = wb.getActiveSheet()
        if (ws && ps.name) {
          try {
            ;(ws as { setName?: (n: string) => void }).setName?.(ps.name)
          } catch {
            // ignore rename failure — content still imports
          }
        }
      } else {
        ws = wb.insertSheet?.(ps.name) ?? null
      }
      if (ws && this.populateSheet(ws, ps.matrix, ps.merges ?? [])) anyApplied = true
    })
    return anyApplied
  }

  /** Write one parsed matrix (+ merges) into a single Univer worksheet. */
  private populateSheet(
    sheetUnknown: unknown,
    matrix: Array<Array<{ v?: unknown; f?: string; s?: Record<string, unknown> } | null>>,
    merges: Array<{ startRow: number; startColumn: number; endRow: number; endColumn: number }>,
  ): boolean {
    const sheet = sheetUnknown as {
      getMaxRows?: () => number
      getMaxColumns?: () => number
      getRange: (r: number, c: number, rows?: number, cols?: number) => unknown
    }
    if (matrix.length === 0) return false
    const maxRows = sheet.getMaxRows?.() ?? matrix.length
    const maxCols = sheet.getMaxColumns?.() ?? 0
    const rows = Math.min(matrix.length, maxRows)
    let cols = 0
    for (const r of matrix) if (r.length > cols) cols = r.length
    cols = maxCols > 0 ? Math.min(cols, maxCols) : cols
    if (rows <= 0 || cols <= 0) return false
    const grid = matrix.slice(0, rows).map((r) => {
      const row = r.slice(0, cols)
      while (row.length < cols) row.push(null)
      return row
    })
    ;(sheet.getRange(0, 0, rows, cols) as { setValues: (m: unknown) => void }).setValues(grid)
    for (const m of merges) {
      if (m.startRow >= rows || m.startColumn >= cols) continue
      const er = Math.min(m.endRow, rows - 1)
      const ec = Math.min(m.endColumn, cols - 1)
      if (er <= m.startRow && ec <= m.startColumn) continue
      try {
        ;(sheet.getRange(m.startRow, m.startColumn, er - m.startRow + 1, ec - m.startColumn + 1) as {
          merge?: () => void
        }).merge?.()
      } catch {
        // ignore a merge that conflicts with an existing one
      }
    }
    return true
  }

  /** Register the handler invoked when a comment marker (corner badge) is clicked. */
  setCommentMarkerClickHandler(cb: ((row: number, col: number, sheetId: string) => void) | null): void {
    this.commentMarkerClick = cb
  }

  /** Register the handler invoked when the right-click "评论" menu item is chosen. */
  setCommentMenuHandler(cb: (() => void) | null): void {
    this.commentMenuClick = cb
  }

  canEdit(): boolean {
    return canEdit(this.currentRole)
  }

  private async clearCache(): Promise<void> {
    // Mirror CollabEditor's terminal teardown (offline/cache.ts §6.3): disconnecting +
    // destroying the y-indexeddb handle only CLOSES the connection — the on-disk data
    // survives and would replay on next open. We must deleteDatabase to truly clear it
    // (the DB name is exactly the cache key). Destroy the handle first so the delete
    // isn't blocked by an open connection.
    this.provider.disconnect()
    if (this.persistence) await this.persistence.destroy()
    try {
      await deleteDatabaseAwait(this.cacheKeyStr)
    } catch {
      // Best-effort: a failed delete must not wedge the terminal close path.
    }
  }

  /** Strict teardown — mirror of CollabEditor.destroyAll(). */
  destroyAll(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.sealTimer) clearTimeout(this.sealTimer)
    this.cursors?.dispose()
    this.commentMarkers?.dispose()
    this.binding.dispose()
    this.univer.dispose()
    // Clear our presence BEFORE tearing down the provider so peers don't keep seeing a
    // stale avatar / cursor for a disconnected client (otherwise the last-advertised cell
    // lingers as a ghost box until the awareness timeout).
    this.provider.awareness?.setLocalState(null)
    this.provider.destroy()
    void this.persistence?.destroy()
    this.ydoc.destroy()
    disposeToken(this.documentName)
  }
}
