// Comment markers for the collaborative spreadsheet — the sheet counterpart of the
// doc editor's comment-highlight decoration layer. Given the set of cells that carry
// comments, it draws a small corner badge on each of those cells so a reader can see
// at a glance which cells have been commented (the document draws an inline highlight;
// a sheet cell has no inline range, so we mark its top-right corner instead).
//
// The badges are CLICKABLE: clicking one opens the comment panel focused on that cell
// (via the onClick callback). The overlay layer itself never intercepts pointer events
// (so cell selection still works everywhere) — only the small badge hit-areas do.
//
// Geometry mirrors sheetCursors.ts: getCellRect is relative to the Univer grid canvas
// origin, and the canvas sits below the toolbar + formula bar, so we add gridOffset().

import { t } from '../octoweb/index.ts'

interface Disposable {
  dispose(): void
}

interface RangeLike {
  getCellRect(): DOMRect
}

/** Scroll info emitted by FWorksheet.onScroll (validViewportScrollInfo). */
interface ScrollInfo {
  viewportScrollX?: number
  viewportScrollY?: number
  scrollX?: number
  scrollY?: number
}

interface SheetLike {
  getRange(row: number, col: number): RangeLike
  onScroll?(cb: (info?: ScrollInfo) => void): Disposable
  /** Current viewport scroll in pixels + first visible row/col (frozen-header aware). */
  getScrollState?(): { offsetX: number; offsetY: number; sheetViewStartRow?: number; sheetViewStartColumn?: number }
}

interface UniverApiLike {
  getActiveWorkbook(): { getActiveSheet(): SheetLike | null } | null
  onCommandExecuted(cb: (cmd: { id: string }) => void): Disposable
}

/** Univer op dispatched on any selection/scroll-affecting change. */
const SET_SELECTIONS_OP = 'sheet.operation.set-selections'
/** Univer op dispatched when the active worksheet changes (sheet tab switch). */
const SET_WORKSHEET_ACTIVE_OP = 'sheet.operation.set-worksheet-active'

export interface MarkedCell {
  row: number
  col: number
  /** Logical sheet id the comment is anchored to (badge only drawn while that sheet is active). */
  sheetId: string
  /** Resolved comments get a green badge; unresolved get orange. */
  resolved?: boolean
}

const BADGE_OPEN = '#f59e0b' // orange — unresolved
const BADGE_RESOLVED = '#16a34a' // green — resolved

export class SheetCommentMarkers {
  private readonly layer: HTMLDivElement
  private readonly mount: HTMLElement
  private readonly badges = new Map<string, HTMLDivElement>()
  private readonly disposers: Disposable[] = []
  private cells: MarkedCell[] = []
  private disposed = false
  private ro: ResizeObserver | null = null
  private rafId = 0
  private settleTimers: ReturnType<typeof setTimeout>[] = []

  constructor(
    private readonly univerAPI: UniverApiLike,
    private readonly container: HTMLElement,
    private readonly onClick?: (row: number, col: number, sheetId: string) => void,
    /**
     * Resolves the active LOGICAL sheet id. Badges whose `sheetId` differs are not drawn, so a
     * comment on Sheet2 never paints a badge over Sheet1. When omitted, all cells are drawn
     * (single-sheet callers / tests).
     */
    private readonly activeSheetId?: () => string,
  ) {
    // Mount on the STABLE ancestor (the SheetView container), same as the cursor overlay:
    // the Univer host div churns under React StrictMode, so anything drawn into it can end
    // up detached. `.octo-sheet-container` stays mounted for the sheet's lifetime.
    this.mount = this.container.parentElement ?? this.container
    this.layer = document.createElement('div')
    Object.assign(this.layer.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
      // Above the Univer grid canvases (z-index 8) so the badge hit-areas win pointer
      // events; still below Univer menus/dropdowns (1000+). The layer stays
      // pointer-events:none so only the small badges intercept, not the whole grid.
      zIndex: '9',
    } satisfies Partial<CSSStyleDeclaration>)
    if (getComputedStyle(this.mount).position === 'static') this.mount.style.position = 'relative'
    this.mount.appendChild(this.layer)

    // Reposition badges on any command that can move cells — selection, but also column
    // resize / row resize / insert / delete. scheduleRender is rAF-coalesced, so redrawing
    // on every command is cheap and keeps badges glued (e.g. while stretching a column).
    this.disposers.push(
      this.univerAPI.onCommandExecuted((cmd) => {
        // Selection and sheet-tab switches redraw immediately (a switch must swap the visible
        // badge set at once); everything else coalesces to the next frame.
        if (cmd.id === SET_SELECTIONS_OP || cmd.id === SET_WORKSHEET_ACTIVE_OP) this.render()
        else this.scheduleRender()
      }),
    )
    const sheet = this.activeSheet()
    // Reposition on scroll. Univer's onScroll (validViewportScrollInfo$) is the primary
    // signal, but it doesn't always fire for wheel; a native wheel/scroll listener on the
    // grid is the reliable backstop. Both just re-render (render pulls the live offset).
    if (sheet?.onScroll) this.disposers.push(sheet.onScroll(() => this.scheduleRender()))
    const onWheel = () => this.scheduleRenderSoon()
    this.mount.addEventListener('wheel', onWheel, { passive: true, capture: true })
    this.disposers.push({ dispose: () => this.mount.removeEventListener('wheel', onWheel, true) })

    // The grid canvas isn't at its final size/position the instant the sheet opens
    // (layout + Univer's own async render settle over the next frames). Badges drawn
    // during that window land at transient coordinates ("乱飘"). Re-lay them out on
    // every size change of the grid area until it stabilises.
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.scheduleRender())
      this.ro.observe(this.mount)
    }
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
   * Re-render across the next few frames. A wheel gesture updates Univer's scroll
   * asynchronously (over a frame or two), so a single immediate render would read a
   * stale offset and the badge would lag; a short burst keeps it glued while scrolling.
   */
  private scheduleRenderSoon(): void {
    this.scheduleRender()
    for (const ms of [30, 90, 180]) this.settleTimers.push(setTimeout(() => this.render(), ms))
  }

  /**
   * Re-lay out the badges repeatedly over the first few seconds. Two things settle
   * asynchronously after open: (a) the grid canvas may not exist yet (render() no-ops
   * until it does), and (b) once it exists the canvas still shifts DOWN as Univer's
   * toolbar / formula bar mount — a position change the ResizeObserver can't see. These
   * retries draw nothing until the grid is ready, then snap the badge to its final spot.
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
   * The main Univer grid canvas, or null if it isn't rendered/sized yet.
   *
   * getCellRect is relative to the GRID canvas's origin, so we must anchor to that one.
   * During load Univer mounts short toolbar / formula-bar canvases FIRST (height ~27px)
   * before the tall grid canvas exists — picking "the largest canvas" then anchors badges
   * to the toolbar and they float near the top ("加载时小角位置不对"). Require a grid-sized
   * canvas (tall + wide); until one exists we draw nothing.
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

  /** Offset of the Univer grid canvas relative to our overlay mount (see sheetCursors.ts). */
  private gridOffset(canvas: HTMLCanvasElement): { x: number; y: number } {
    const mountRect = this.mount.getBoundingClientRect()
    const r = canvas.getBoundingClientRect()
    return { x: r.left - mountRect.left, y: r.top - mountRect.top }
  }

  /** Update the set of commented cells and redraw. */
  setCells(cells: MarkedCell[]): void {
    this.cells = cells
    this.render()
    // Re-lay out next frame + over the following ~1.2s: on first open the grid may
    // still be settling, so the immediate pass can land at transient coordinates.
    this.scheduleRender()
    this.scheduleSettleRenders()
  }

  /**
   * On-screen rect of a cell relative to the overlay mount (`.octo-sheet-container`),
   * using the SAME geometry as the badges so an inline comment composer anchored here
   * stays aligned with the corner badge. Returns null if the grid isn't ready.
   */
  cellScreenRect(row: number, col: number): { left: number; top: number; width: number; height: number } | null {
    const sheet = this.activeSheet()
    const canvas = this.mainCanvas()
    if (!sheet || !canvas) return null
    let rect: DOMRect
    try {
      rect = sheet.getRange(row, col).getCellRect()
    } catch {
      return null
    }
    if (!rect || rect.width <= 0 || rect.height <= 0) return null
    const off = this.gridOffset(canvas)
    // Same pixel-scroll derivation as render() (getScrollState.offset is a SUB-cell offset,
    // not the total scroll), so the composer bubble stays aligned with the badge.
    // getScrollState() may THROW (SheetScrollManagerService unregistered in core preset) —
    // ?. only guards missing, not throwing. Wrap so a redi error can't crash the app.
    let scroll: { offsetX: number; offsetY: number; sheetViewStartRow?: number; sheetViewStartColumn?: number } = { offsetX: 0, offsetY: 0 }
    try {
      scroll = sheet.getScrollState?.() ?? scroll
    } catch {
      // degrade to no-scroll positioning
    }
    let scrollX = 0
    let scrollY = 0
    try {
      const origin = sheet.getRange(0, 0).getCellRect()
      const first = sheet.getRange(scroll.sheetViewStartRow ?? 0, scroll.sheetViewStartColumn ?? 0).getCellRect()
      scrollY = first.top - origin.top + (scroll.offsetY ?? 0)
      scrollX = first.left - origin.left + (scroll.offsetX ?? 0)
    } catch {
      // fall back to no-scroll positioning
    }
    return {
      left: off.x + rect.left - scrollX,
      top: off.y + rect.top - scrollY,
      width: rect.width,
      height: rect.height,
    }
  }

  private getOrCreate(key: string, row: number, col: number, sheetId: string): HTMLDivElement {
    let el = this.badges.get(key)
    // Keep the badge's sheet id current: badges are cached by `row:col` and reused, so on a
    // sheet switch a reused element must not fire the click with a stale sheet id.
    if (el) el.dataset.sheetId = sheetId
    if (!el) {
      el = document.createElement('div')
      el.className = 'octo-sheet-comment-badge'
      el.dataset.sheetId = sheetId
      // A ~14px clickable hit-area anchored to the cell's top-right corner; the visible
      // mark is the orange corner triangle drawn as a child. The layer stays
      // pointer-events:none, but the badge opts back IN so clicking it opens the thread.
      Object.assign(el.style, {
        position: 'absolute',
        width: '14px',
        height: '14px',
        pointerEvents: this.onClick ? 'auto' : 'none',
        cursor: this.onClick ? 'pointer' : 'default',
      } satisfies Partial<CSSStyleDeclaration>)
      el.title = t('docs.sheet.comment.viewBadge')
      const tri = document.createElement('div')
      Object.assign(tri.style, {
        position: 'absolute',
        top: '0',
        right: '0',
        width: '0',
        height: '0',
        borderTop: '7px solid #f59e0b',
        borderLeft: '7px solid transparent',
      } satisfies Partial<CSSStyleDeclaration>)
      el.appendChild(tri)
      if (this.onClick) {
        // Stop pointerdown from reaching the grid (so it doesn't start a selection),
        // and act on the click itself (reliable for both real users and automation).
        el.addEventListener('pointerdown', (e) => e.stopPropagation())
        el.addEventListener('mousedown', (e) => e.stopPropagation())
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          // Read the badge's live sheet id (kept current each draw) so a marker click on the
          // active sheet focuses that sheet's thread — never a same-cell thread on another sheet.
          this.onClick?.(row, col, el!.dataset.sheetId ?? '')
        })
      }
      this.layer.appendChild(el)
      this.badges.set(key, el)
    }
    return el
  }

  private render(): void {
    if (this.disposed) return
    const sheet = this.activeSheet()
    if (!sheet) return
    // If the grid canvas isn't sized/positioned yet (just-opened, still laying out),
    // don't draw at transient coordinates — the ResizeObserver will re-fire once it
    // settles. Existing badges are left in place until then.
    const canvas = this.mainCanvas()
    if (!canvas) return
    const off = this.gridOffset(canvas)
    // getCellRect is CONTENT-absolute (unaffected by scroll), so subtract the viewport
    // scroll ourselves. getScrollState gives the first visible row/col + a sub-cell offset
    // — NOT a pixel scroll — so derive the pixel scroll from the content-distance between
    // the origin cell and the first visible cell (robust to variable row/col sizes).
    // getScrollState() may THROW (SheetScrollManagerService unregistered in core preset) —
    // ?. only guards missing, not throwing. Wrap so a redi error can't crash the app.
    let scroll: { offsetX: number; offsetY: number; sheetViewStartRow?: number; sheetViewStartColumn?: number } = { offsetX: 0, offsetY: 0 }
    try {
      scroll = sheet.getScrollState?.() ?? scroll
    } catch {
      // degrade to no-scroll positioning
    }
    const startRow = scroll.sheetViewStartRow ?? 0
    const startCol = scroll.sheetViewStartColumn ?? 0
    let scrollX = 0
    let scrollY = 0
    // The frozen column-header height / row-header width are exactly A1's content-absolute
    // top/left (data starts below/right of the headers), so we get them for free and use
    // them to hide badges that scroll up/left into the header bands.
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
    const seen = new Set<string>()
    // Only draw badges for cells anchored to the CURRENTLY-ACTIVE logical sheet — a comment on
    // Sheet2 must not paint a badge over Sheet1. When no resolver is wired, draw everything.
    const active = this.activeSheetId?.()
    for (const { row, col, resolved, sheetId } of this.cells) {
      if (active != null && sheetId !== active) continue
      const key = `${row}:${col}`
      let rect: DOMRect
      try {
        rect = sheet.getRange(row, col).getCellRect()
      } catch {
        continue
      }
      if (!rect || rect.width <= 0 || rect.height <= 0) continue
      const el = this.getOrCreate(key, row, col, sheetId)
      // Recolor each render so a badge flips green the moment its comment is resolved.
      const tri = el.firstElementChild as HTMLElement | null
      if (tri) tri.style.borderTopColor = resolved ? BADGE_RESOLVED : BADGE_OPEN
      // Anchor to the cell's top-right corner, in on-screen coords (content minus scroll).
      const top = off.y + rect.top - scrollY
      const left = off.x + rect.left + rect.width - 14 - scrollX
      // Hide once the badge scrolls up/left into (or past) the frozen header bands, so it
      // never floats over the column/row headers ("挡在目录前面").
      if (top < off.y + headerH || left < off.x + rowHdrW) {
        el.style.display = 'none'
        seen.add(key)
        continue
      }
      el.style.left = `${left}px`
      el.style.top = `${top}px`
      el.style.display = 'block'
      seen.add(key)
    }
    for (const [key, el] of this.badges) {
      if (!seen.has(key)) {
        el.remove()
        this.badges.delete(key)
      }
    }
  }

  /** Force a redraw (e.g. after the container resizes). */
  refresh(): void {
    this.render()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.rafId) cancelAnimationFrame(this.rafId)
    for (const t of this.settleTimers) clearTimeout(t)
    this.ro?.disconnect()
    for (const d of this.disposers) {
      try {
        d.dispose()
      } catch {
        // ignore
      }
    }
    this.layer.remove()
    this.badges.clear()
  }
}
