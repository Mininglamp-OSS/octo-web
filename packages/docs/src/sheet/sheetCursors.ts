// Remote-cursor overlay for the collaborative spreadsheet — the sheet counterpart of
// the doc editor's CollaborationCaret. Technique (borrowed from the standard live-cursor
// pattern, e.g. Rows n' Columns): each client broadcasts its active cell via Yjs awareness;
// every client renders the others' active cells as absolutely-positioned overlay boxes
// (their color + a name tag) on top of the Univer grid, using Univer's own cell→pixel API.
//
// Univer OSS exposes exactly what we need (no Pro required):
//   - univerAPI.addEvent(Event.SelectionChanged) — local selection changes
//   - FWorksheet.onScroll — reposition overlays while scrolling
//   - FRange.getCellRect(): DOMRect — a cell's pixel rectangle (viewport coords)
//
// Note: remote-cursor geometry is kept in sync with sheetCommentMarkers' overlay via the
// shared getScrollState-derived viewport offset (see the scroll-model reconciliation).

import { t } from '../octoweb/index.ts'

interface Disposable {
  dispose(): void
}

interface RangeLike {
  getRange(): { startRow: number; startColumn: number }
  getCellRect(): DOMRect
}

interface SheetLike {
  getSheetId(): string
  getActiveRange(): RangeLike | null
  getRange(row: number, col: number): RangeLike
  onScroll?(cb: () => void): Disposable
  /** Current viewport scroll: first visible row/col + a sub-cell pixel offset (frozen-header aware). */
  getScrollState?(): { offsetX: number; offsetY: number; sheetViewStartRow?: number; sheetViewStartColumn?: number }
}

interface UniverApiLike {
  getActiveWorkbook(): { getActiveSheet(): SheetLike | null } | null
  onCommandExecuted(cb: (cmd: { id: string }) => void): Disposable
}

/** Univer operation dispatched whenever the selection changes (click / keyboard / drag). */
const SET_SELECTIONS_OP = 'sheet.operation.set-selections'
/** Univer op dispatched when the active worksheet changes (sheet tab switch). */
const SET_WORKSHEET_ACTIVE_OP = 'sheet.operation.set-worksheet-active'

/**
 * A friendly cursor label. When the display name hasn't resolved we get the raw uid
 * (a long hex / `u_…` id) — showing that verbatim looks like garbage on the cursor tag,
 * so fall back to a generic label until a real name is available.
 */
function displayName(name?: string): string {
  if (!name) return t('docs.sheet.collaborator')
  if (/^[0-9a-fA-F]{16,}$/.test(name) || /^u_[0-9A-Za-z]+$/.test(name)) return t('docs.sheet.collaborator')
  return name
}

interface AwarenessLike {
  clientID: number
  getStates(): Map<number, { user?: { id?: string; name?: string; color?: string }; cell?: { row: number; col: number; sheetId?: string } }>
  setLocalStateField(field: string, value: unknown): void
  on(event: 'change', cb: () => void): void
  off(event: 'change', cb: () => void): void
}

export class SheetCursorOverlay {
  private readonly layer: HTMLDivElement
  private readonly mount: HTMLElement
  private readonly cursors = new Map<number, HTMLDivElement>()
  private readonly disposers: Disposable[] = []
  private readonly onAwareness: () => void
  private disposed = false
  // Univer dispatches a `set-selections` op on mount for its DEFAULT A1 selection, before
  // the user has touched anything. Broadcasting that made every peer show a stray box on A1.
  // So we only start broadcasting after the first REAL user interaction with the grid.
  private interacted = false
  // Grid-settle handling (mirrors sheetCommentMarkers): on first open the grid canvas isn't sized
  // / positioned yet, so we re-lay out on a ResizeObserver + a burst of timers instead of drawing
  // once at transient coordinates and waiting for a user click.
  private ro: ResizeObserver | null = null
  private rafId = 0
  private settleTimers: ReturnType<typeof setTimeout>[] = []

  constructor(
    private readonly univerAPI: UniverApiLike,
    private readonly awareness: AwarenessLike,
    private readonly container: HTMLElement,
    /**
     * Resolves the active LOGICAL sheet id. Broadcast alongside the cell so peers can tell WHICH
     * sheet a cursor is on; remote cursors on a different sheet are not drawn. When omitted, the
     * cursor is sheet-agnostic (single-sheet callers / tests) and always drawn.
     */
    private readonly activeSheetId?: () => string,
  ) {
    // Mount the overlay on the STABLE ancestor (the SheetView container), NOT on the
    // Univer host we were handed: React StrictMode / host re-renders swap that host div
    // in and out of the DOM, and cursors drawn into a detached host are invisible. The
    // host's parent (`.octo-sheet-container`) is SheetView's stable ref and stays mounted.
    this.mount = this.container.parentElement ?? this.container
    // Overlay layer sits above the grid; never intercepts pointer events.
    this.layer = document.createElement('div')
    Object.assign(this.layer.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
      zIndex: '4',
    } satisfies Partial<CSSStyleDeclaration>)
    if (getComputedStyle(this.mount).position === 'static') this.mount.style.position = 'relative'
    this.mount.appendChild(this.layer)

    // 1) Broadcast local selection whenever it changes — but ONLY after the user has
    // actually interacted with the grid. Univer fires a `set-selections` op on mount for
    // its default A1 selection; broadcasting that put a stray A1 box on every peer. We arm
    // `interacted` on the first real pointerdown / keydown, then broadcast the current cell.
    const arm = () => {
      if (this.interacted) return
      this.interacted = true
      this.broadcastSelection()
    }
    this.mount.addEventListener('pointerdown', arm, true)
    this.mount.addEventListener('keydown', arm, true)
    this.disposers.push({
      dispose: () => {
        this.mount.removeEventListener('pointerdown', arm, true)
        this.mount.removeEventListener('keydown', arm, true)
      },
    })
    this.disposers.push(
      this.univerAPI.onCommandExecuted((cmd) => {
        // Re-broadcast the local cursor on selection changes AND on sheet switches: switching
        // sheets keeps the same row/col selection but moves the cursor to a different logical
        // sheet, so peers must be told the new sheetId or they'd keep drawing it on the old one.
        if ((cmd.id === SET_SELECTIONS_OP || cmd.id === SET_WORKSHEET_ACTIVE_OP) && this.interacted) {
          this.broadcastSelection()
        }
        // A sheet switch also changes which REMOTE cursors are on the active sheet — redraw now.
        if (cmd.id === SET_WORKSHEET_ACTIVE_OP) this.render()
      }),
    )

    // 2) Re-render others' cursors on awareness change + on scroll.
    this.onAwareness = () => this.render()
    this.awareness.on('change', this.onAwareness)
    const sheet = this.activeSheet()
    // Univer's onScroll (validViewportScrollInfo$) is the primary signal but doesn't always
    // fire for wheel; a native wheel listener on the mount is the reliable backstop. Both just
    // re-render (render() reads the live scroll offset). Mirrors sheetCommentMarkers.ts.
    if (sheet?.onScroll) this.disposers.push(sheet.onScroll(() => this.render()))
    const onWheel = () => this.render()
    this.mount.addEventListener('wheel', onWheel, { passive: true, capture: true })
    this.disposers.push({ dispose: () => this.mount.removeEventListener('wheel', onWheel, true) })

    // The grid canvas isn't at its final size/position the instant the sheet opens (layout +
    // Univer's async render settle over the next frames). A cursor drawn during that window lands
    // at transient coords / anchored to the toolbar canvas ("光标位置是坏的，点一下才好"). Re-lay
    // out on every size change of the grid area, and across the first few seconds after open, so
    // it snaps to the real cell WITHOUT needing a user click. Mirrors sheetCommentMarkers.
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.scheduleRender())
      this.ro.observe(this.mount)
    }
    this.render()
    this.scheduleSettleRenders()
  }

  /** Coalesce re-renders to one per frame (ResizeObserver can fire in bursts). */
  private scheduleRender(): void {
    if (this.disposed || this.rafId) return
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0
      this.render()
    })
  }

  /**
   * Re-lay out the cursor repeatedly over the first few seconds after open. Two things settle
   * asynchronously: (a) the grid canvas may not exist yet (render() no-ops via mainCanvas() until
   * it does), and (b) once it exists the canvas still shifts DOWN as Univer's toolbar / formula bar
   * mount — a position change the ResizeObserver can't see. These retries draw nothing until the
   * grid is ready, then snap the cursor to its final spot.
   */
  private scheduleSettleRenders(): void {
    for (const t of this.settleTimers) clearTimeout(t)
    this.settleTimers = [50, 150, 350, 700, 1200, 2000, 3000, 4000].map((ms) =>
      setTimeout(() => this.render(), ms),
    )
  }

  private activeSheet(): SheetLike | null {
    return this.univerAPI.getActiveWorkbook()?.getActiveSheet() ?? null
  }

  /**
   * The main Univer grid canvas, or null if it isn't rendered/sized yet. getCellRect is relative
   * to the GRID canvas's origin, so we must anchor to THAT one — not the largest canvas, which
   * during load is the short toolbar / formula-bar canvas (height ~27px). Requiring a grid-sized
   * canvas (tall + wide) is what stops the cursor from drawing before the grid exists / anchoring
   * to the wrong canvas. Mirrors sheetCommentMarkers.mainCanvas().
   */
  private mainCanvas(): HTMLCanvasElement | null {
    const MIN_GRID = 80
    let best: HTMLCanvasElement | null = null
    let bestArea = 0
    for (const c of this.mount.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect()
      if (r.height < MIN_GRID || r.width < MIN_GRID) continue // skip toolbar / formula-bar canvases
      const area = r.width * r.height
      if (area > bestArea) {
        bestArea = area
        best = c as HTMLCanvasElement
      }
    }
    return best
  }

  /**
   * Offset of the Univer grid canvas relative to our overlay mount. getCellRect is relative to the
   * grid canvas's origin, but the canvas sits BELOW Univer's toolbar + formula bar inside the
   * container — so we add this offset to land on the real cell.
   */
  private gridOffset(canvas: HTMLCanvasElement): { x: number; y: number } {
    const mountRect = this.mount.getBoundingClientRect()
    const r = canvas.getBoundingClientRect()
    return { x: r.left - mountRect.left, y: r.top - mountRect.top }
  }

  private broadcastSelection(): void {
    const sheet = this.activeSheet()
    const range = sheet?.getActiveRange()
    if (!sheet || !range) return
    const r = range.getRange()
    // Carry the STABLE logical sheet id (not Univer's per-client random sheetId, which would
    // never match across clients — same reason binding.ts keys shared state by logical id) so a
    // peer can tell which sheet the cursor is on and only draw it on that sheet. Omitting it (no
    // resolver) keeps the V1 single-sheet behaviour where every cursor is drawn.
    const sheetId = this.activeSheetId?.()
    this.awareness.setLocalStateField('cell', { row: r.startRow, col: r.startColumn, sheetId })
  }

  private getOrCreate(clientId: number, color: string, name: string): HTMLDivElement {
    let el = this.cursors.get(clientId)
    if (!el) {
      el = document.createElement('div')
      Object.assign(el.style, {
        position: 'absolute',
        boxSizing: 'border-box',
        border: `2px solid ${color}`,
        pointerEvents: 'none',
      } satisfies Partial<CSSStyleDeclaration>)
      const tag = document.createElement('div')
      tag.className = 'octo-sheet-cursor-tag'
      Object.assign(tag.style, {
        position: 'absolute',
        top: '-18px',
        left: '-2px',
        height: '16px',
        lineHeight: '16px',
        padding: '0 6px',
        fontSize: '11px',
        whiteSpace: 'nowrap',
        color: '#fff',
        background: color,
        borderRadius: '3px',
      } satisfies Partial<CSSStyleDeclaration>)
      tag.textContent = name
      el.appendChild(tag)
      this.layer.appendChild(el)
      this.cursors.set(clientId, el)
    } else {
      // keep color/name current
      el.style.borderColor = color
      const tag = el.firstElementChild as HTMLElement | null
      if (tag) {
        tag.style.background = color
        tag.textContent = name
      }
    }
    return el
  }

  private render(): void {
    if (this.disposed) return
    const sheet = this.activeSheet()
    if (!sheet) return
    // Don't draw until the real grid canvas is sized/positioned. On first open Univer mounts the
    // toolbar / formula-bar canvases FIRST; drawing then anchors the cursor to the wrong canvas so
    // it floats before the grid appears and lands at a stale spot after (the reported bug). The
    // ResizeObserver + settle renders re-run this the moment the grid is ready.
    const canvas = this.mainCanvas()
    if (!canvas) return
    const off = this.gridOffset(canvas)
    // getCellRect is CONTENT-absolute (unaffected by scroll) — the SAME semantics the comment
    // markers rely on. We must subtract the viewport scroll ourselves, or remote cursors stay
    // pinned to their content position and drift out of view / over the headers on scroll (the
    // bug reported in review). getScrollState gives the first visible row/col + a sub-cell
    // offset (NOT a pixel scroll), so derive the pixel scroll from the content-distance between
    // the origin cell and the first visible cell — robust to variable row/col sizes.
    // NOTE: getScrollState() may THROW (not just be undefined) — the core preset doesn't
    // register SheetScrollManagerService, so the facade call raises a redi injection error.
    // Optional-chaining (?.) only guards "method missing", NOT "method throws", so wrap it.
    // On failure we fall back to no-scroll positioning: cursors stay visible (scroll-follow
    // degrades gracefully) instead of the whole app crashing.
    let scroll: { offsetX: number; offsetY: number; sheetViewStartRow?: number; sheetViewStartColumn?: number } = { offsetX: 0, offsetY: 0 }
    try {
      scroll = sheet.getScrollState?.() ?? scroll
    } catch {
      // SheetScrollManagerService not registered in this preset — degrade to no-scroll.
    }
    const startRow = scroll.sheetViewStartRow ?? 0
    const startCol = scroll.sheetViewStartColumn ?? 0
    let scrollX = 0
    let scrollY = 0
    // The frozen column-header height / row-header width equal A1's content-absolute top/left
    // (data starts below/right of the headers); use them to hide cursors that scroll up/left
    // into the header bands so a remote box never floats over the row/col headers.
    let headerH = 0
    let rowHdrW = 0
    try {
      const origin = sheet.getRange(0, 0).getCellRect()
      const first = sheet.getRange(startRow, startCol).getCellRect()
      headerH = origin.top
      rowHdrW = origin.left
      scrollY = first.top - origin.top + (scroll.offsetY ?? 0)
      scrollX = first.left - origin.left + (scroll.offsetX ?? 0)
    } catch {
      // fall back to no-scroll positioning
    }
    const seen = new Set<number>()
    // The active logical sheet id: a remote cursor is only drawn if it's on THIS sheet, so a
    // peer editing Sheet2 doesn't paint a box on your Sheet1. When there's no resolver (V1
    // single-sheet) or a peer broadcast no sheetId (older client), don't filter — draw it.
    const activeSheetId = this.activeSheetId?.()
    // Collapse multiple sessions of the SAME person to a single cursor, mirroring the
    // PresenceBar's dedupeById (awareness/presence.ts). Without this, one collaborator with two
    // tabs — or a stale awareness state left by a reload/disconnect that hasn't timed out yet —
    // paints several ghost boxes for the same name ("评论单元又乱了"). Rules:
    //   - skip our own clientID (never render self);
    //   - skip any state whose uid == the local user's uid (a second tab of yourself is not a
    //     separate collaborator);
    //   - for each remaining uid keep only ONE clientID — the highest (most recent session),
    //     so a fresh tab wins over a lingering ghost from an earlier one.
    // A state with no uid (shouldn't happen — the backend validates id/name/color) falls back to
    // per-client rendering so it is never silently dropped.
    const states = this.awareness.getStates()
    const localUid = states.get(this.awareness.clientID)?.user?.id
    const chosen = new Set<number>()
    const repByUid = new Map<string, number>()
    for (const [clientId, state] of states) {
      if (clientId === this.awareness.clientID) continue
      if (!state.user || !state.cell) continue
      // Off-sheet cursors don't participate in dedup either — otherwise a peer's Sheet2 session
      // (higher clientId) could win the rep slot and suppress their Sheet1 cursor we DO want.
      if (activeSheetId != null && state.cell.sheetId != null && state.cell.sheetId !== activeSheetId) continue
      const uid = state.user.id
      if (!uid) {
        chosen.add(clientId)
        continue
      }
      if (localUid && uid === localUid) continue
      const prev = repByUid.get(uid)
      if (prev == null || clientId > prev) repByUid.set(uid, clientId)
    }
    for (const clientId of repByUid.values()) chosen.add(clientId)

    for (const [clientId, state] of states) {
      if (clientId === this.awareness.clientID) continue // skip self
      if (!chosen.has(clientId)) continue // deduped: another session of the same (or local) user
      const cell = state.cell
      const user = state.user
      if (!cell || !user) continue
      // Skip a remote cursor that lives on a different logical sheet — its row/col are for THAT
      // sheet, not the one on screen (drawing it here is exactly the cross-sheet ghost bug).
      if (activeSheetId != null && cell.sheetId != null && cell.sheetId !== activeSheetId) continue
      let rect: DOMRect
      try {
        rect = sheet.getRange(cell.row, cell.col).getCellRect()
      } catch {
        continue
      }
      if (!rect || rect.width <= 0 || rect.height <= 0) continue
      // On-screen position = content-absolute rect minus the viewport scroll (matches the
      // comment-badge geometry exactly, so cursor and badge on the same cell stay aligned).
      const top = off.y + rect.top - scrollY
      const left = off.x + rect.left - scrollX
      const el = this.getOrCreate(clientId, user.color || '#7C5CFC', displayName(user.name))
      // Hide once the cell scrolls up/left into (or past) the frozen header bands, so a remote
      // cursor never floats over the column/row headers.
      if (top < off.y + headerH || left < off.x + rowHdrW) {
        el.style.display = 'none'
        seen.add(clientId)
        continue
      }
      el.style.left = `${left}px`
      el.style.top = `${top}px`
      el.style.width = `${rect.width}px`
      el.style.height = `${rect.height}px`
      el.style.display = 'block'
      seen.add(clientId)
    }
    // Remove cursors for users who left / moved to another sheet.
    for (const [clientId, el] of this.cursors) {
      if (!seen.has(clientId)) {
        el.remove()
        this.cursors.delete(clientId)
      }
    }
  }

  /** Public hook to force a re-render (e.g. after the container resizes). */
  refresh(): void {
    this.render()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.rafId) cancelAnimationFrame(this.rafId)
    for (const t of this.settleTimers) clearTimeout(t)
    this.ro?.disconnect()
    this.awareness.off('change', this.onAwareness)
    for (const d of this.disposers) {
      try {
        d.dispose()
      } catch {
        // ignore
      }
    }
    this.layer.remove()
    this.cursors.clear()
  }
}
