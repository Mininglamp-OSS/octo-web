// Sheet cell @-mention controller (custom, OSS-only — no @univerjs-pro). Univer's built-in cell
// mention lives behind the paid collaboration plugin (IMentionIOService is nulled in
// createUniver.ts), so we implement the UX ourselves against documented facade APIs.
//
// TWO triggers, both live at once:
//   • 'inline'  — the user types `@` inside a cell (detected via the edit-visible command +
//                 the key stream). The `@` + query type into the cell naturally; the popup shows
//                 the filtered list (no search box) and the controller owns query/active. On select
//                 we commit the edit, then replace the typed `@query` with the token.
//   • 'button'  — the ribbon @ button (registered next to π in CollabSheet) calls
//                 requestSheetMentionOpen() → open(): the popup shows its OWN search box (the
//                 overlay owns query/active) and on select we append the token to the cell.
//
// The shared popup (SheetMentionOverlay) + data source (loadMentionItems / filterMentionItems) are
// identical to the doc-body editor and comments. Everything is wrapped defensively (optional
// chaining + try/catch) so a Univer API drift degrades to "no popup" rather than a crash.

import {
  type MentionItem,
  loadMentionItems,
  filterMentionItems,
} from '../mentions/source.ts'
import {
  setSheetMentionState,
  hideSheetMention,
  type SheetMentionMode,
} from './sheetMentionBridge.ts'

/** Univer operation that toggles the cell editor open/closed; its param carries `visible`. */
const SET_CELL_EDIT_VISIBLE = 'sheet.operation.set-cell-edit-visible'

interface RangeLike {
  getCellRect?: () => { left: number; top: number; width: number; height: number }
  getRange?: () => { startRow: number; startColumn: number }
}
interface SheetLike {
  getRange(row: number, col: number): RangeLike
  getActiveRange?: () => RangeLike | null
}
interface UniverApiLike {
  getActiveWorkbook(): { getActiveSheet(): SheetLike | null } | null
  onCommandExecuted(cb: (cmd: { id: string; params?: { visible?: boolean } }) => void): {
    dispose(): void
  }
}

/** Called with the picked mention + its target cell; the host (CollabSheet) inserts the chip.
 *  `ctx` tells the host how the pick happened so it can safely reconcile cell text:
 *   • inline — the user typed `@query` into the cell; host strips ONLY that trailing `@query`.
 *   • button — the ribbon button opened the picker on an existing cell; host must NOT touch its content. */
export type MentionPicked = (
  item: MentionItem,
  cell: { row: number; col: number },
  ctx: { mode: SheetMentionMode; query: string },
) => void

/**
 * Compute the cell text after stripping the trailing `@query` the inline popup mirrored.
 * Returns the new cell value (`null` = clear the cell), or `undefined` = DO NOT WRITE — leave the
 * cell untouched.
 *
 * The undefined case is the important safety guard: when the needle `@query` is NOT present in the
 * committed cell text (idx === -1) the controller-tracked query has diverged from what the cell
 * actually holds — e.g. IME/CJK composition (raw keystrokes vs composed characters), paste, or a
 * concurrent edit. Writing `''`/null there would erase the WHOLE cell (a data-loss bug), so we
 * signal "no write" instead.
 */
export function stripTrailingQuery(text: string, query: string): string | null | undefined {
  const needle = `@${query}`
  // Only strip a GENUINELY TRAILING `@query`. The inline flow guarantees this: a space closes the
  // token (onKeyDown ' ' → close()), so at pick time `@query` is the contiguous trailing run at the
  // caret. Using endsWith (not lastIndexOf) hardens against a future/desynced caller passing text
  // where `@query` also appears mid-string — e.g. "@ali notes" with query "ali": lastIndexOf would
  // wrongly strip the leading "@ali" and corrupt the cell to " notes". endsWith refuses that.
  if (!text.endsWith(needle)) return undefined // not a trailing match → do not touch the cell
  const rest = text.slice(0, text.length - needle.length)
  return rest === '' ? null : rest
}

export class SheetCellMention {
  private editing = false
  private open = false
  private mode: SheetMentionMode = 'inline'
  private query = ''
  private active = 0
  private items: MentionItem[] = []
  private cache: Promise<MentionItem[]> | null = null
  private target: { row: number; col: number } | null = null
  private pos = { x: 0, y: 0 }
  private disposed = false
  private pickTimer: ReturnType<typeof setTimeout> | null = null
  private readonly disposers: Array<() => void> = []

  constructor(
    private readonly univerAPI: UniverApiLike,
    private readonly container: HTMLElement,
    private readonly spaceId: string,
    private readonly onPick: MentionPicked,
    /** Live-role write-gate. A reader (or a writer downgraded at runtime) must not be able to open
     *  the picker or insert a chip: the Yjs binding declines to sync the drawing, so an inserted
     *  chip would become a misleading local-only phantom. Defaults to always-allowed for callers
     *  that don't pass it (tests / non-collab). CollabSheet passes `() => canEdit(currentRole)`. */
    private readonly canEditNow: () => boolean = () => true,
  ) {
    // NOTE: the ribbon-button opener + overlay select handler are module-level singletons, so they
    // are registered by SheetView keyed on the LIVE sheet instance (see wireCellMention) — NOT here.
    // Registering in the constructor breaks under React StrictMode: the throwaway instance's
    // dispose() would null the singleton the surviving instance set, so the button would do nothing.

    // Track cell-edit sessions via the command stream (avoids a direct @univerjs/sheets-ui import,
    // which isn't a declared dependency here). When editing ends, any open inline popup is stale.
    try {
      const sub = this.univerAPI.onCommandExecuted((cmd) => {
        if (cmd.id !== SET_CELL_EDIT_VISIBLE) return
        this.editing = !!cmd.params?.visible
        if (!this.editing && this.mode === 'inline') this.close()
      })
      this.disposers.push(() => sub.dispose())
    } catch {
      // onCommandExecuted unavailable/changed — the inline @ trigger just won't fire.
    }

    const onKeyDown = (e: KeyboardEvent) => this.onKeyDown(e)
    document.addEventListener('keydown', onKeyDown, true) // capture: beat the grid's nav handling
    this.disposers.push(() => document.removeEventListener('keydown', onKeyDown, true))
  }

  private load(): Promise<MentionItem[]> {
    if (!this.cache) {
      this.cache = loadMentionItems(this.spaceId).catch(() => [])
      void this.cache.then((items) => {
        this.items = items
        if (this.open) this.push()
      })
    }
    return this.cache
  }

  // ── inline trigger (type `@` in a cell) ─────────────────────────────────────
  private onKeyDown(e: KeyboardEvent): void {
    if (this.disposed) return
    if (!this.open) {
      if (this.editing && e.key === '@') {
        if (!this.canEditNow()) return // reader / downgraded writer: don't open the inline picker
        void this.load()
        this.mode = 'inline'
        this.open = true
        this.query = ''
        this.active = 0
        this.computePosition()
        this.push()
      }
      return
    }
    if (this.mode !== 'inline') return // button mode: the overlay's own input owns the keys
    if (e.key === 'Escape') {
      e.preventDefault()
      this.close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      this.movr(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      this.movr(-1)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const list = this.filtered()
      if (list.length > 0) {
        e.preventDefault()
        this.insert(list[Math.min(this.active, list.length - 1)])
      } else {
        this.close()
      }
    } else if (e.key === 'Backspace') {
      if (this.query === '') this.close()
      else {
        this.query = this.query.slice(0, -1)
        this.active = 0
        this.push()
      }
    } else if (e.key === ' ') {
      this.close() // a space ends the mention token
    } else if (e.key.length === 1) {
      this.query += e.key // also types into the cell — intended
      this.active = 0
      this.push()
    }
  }

  private filtered(): MentionItem[] {
    return filterMentionItems(this.items, this.query)
  }

  private movr(delta: number): void {
    const n = this.filtered().length
    if (n === 0) return
    this.active = (this.active + delta + n) % n
    this.push()
  }

  // ── button trigger (ribbon @ button) ────────────────────────────────────────
  /** Open the picker in button mode, anchored under the active cell. Public: called by SheetView. */
  openMenu(): void {
    if (this.disposed) return
    if (!this.canEditNow()) return // reader / downgraded writer: ribbon @ button is a no-op
    void this.load()
    const cell = this.activeCell()
    // Remember the target if there is one; if not, resolve it again at insert time. Either way we
    // still SHOW the popup (so the button always visibly responds).
    this.target = cell ? { row: cell.row, col: cell.col } : null
    this.mode = 'button'
    this.open = true
    this.query = ''
    this.active = 0
    this.computePosition()
    this.push()
  }

  /** Overlay reported a pick (click, or button-mode keyboard). Public: called by SheetView. */
  pick(item: MentionItem): void {
    if (this.disposed) return
    if (!this.canEditNow()) return // downgraded between open and pick: don't insert a phantom chip
    this.insert(item)
  }

  /** Overlay was dismissed WITHOUT a pick (Escape / click-away). Public: called by SheetView.
   *  Resets the controller's open/mode/query so the inline `@` trigger can fire again — the React
   *  popup hiding alone does NOT reset controller state. */
  closeMenu(): void {
    if (this.disposed) return
    this.close()
  }

  // ── shared ───────────────────────────────────────────────────────────────────
  private activeCell(): { sheet: SheetLike; row: number; col: number } | null {
    try {
      const sheet = this.univerAPI.getActiveWorkbook()?.getActiveSheet()
      const rng = sheet?.getActiveRange?.()?.getRange?.()
      if (!sheet || !rng) return null
      return { sheet, row: rng.startRow, col: rng.startColumn }
    } catch {
      return null
    }
  }

  /** Anchor the popup just under the active cell (viewport coords → overlay uses position:fixed). */
  private computePosition(): void {
    try {
      const cell = this.activeCell()
      const canvas = this.mainCanvas()
      if (cell && canvas) {
        const rect = cell.sheet.getRange(cell.row, cell.col).getCellRect?.()
        if (rect) {
          const cRect = canvas.getBoundingClientRect()
          this.pos = { x: cRect.left + rect.left, y: cRect.top + rect.top + rect.height }
          return
        }
      }
      const c = this.mainCanvas()?.getBoundingClientRect()
      this.pos = { x: (c?.left ?? 0) + 40, y: (c?.top ?? 0) + 40 }
    } catch {
      /* keep last position */
    }
  }

  /** Largest grid canvas in our container (skip the short toolbar / formula-bar canvases). */
  private mainCanvas(): HTMLCanvasElement | null {
    const MIN = 80
    let best: HTMLCanvasElement | null = null
    let bestArea = 0
    for (const c of this.container.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect()
      if (r.height < MIN || r.width < MIN) continue
      const area = r.width * r.height
      if (area > bestArea) {
        bestArea = area
        best = c as HTMLCanvasElement
      }
    }
    return best
  }

  private push(): void {
    setSheetMentionState({
      visible: this.open,
      mode: this.mode,
      x: this.pos.x,
      y: this.pos.y,
      items: this.items,
      query: this.query,
      active: this.active,
    })
  }

  private close(): void {
    this.open = false
    this.query = ''
    this.active = 0
    // Clear the remembered button-mode target too. Otherwise a cancelled ribbon-@ session (openMenu
    // set this.target = {A1}, then Escape/click-away → close()) would leak that cell into a LATER
    // inline `@` pick — insert()'s `this.target ?? activeCell()` would resolve the stale A1 instead
    // of the currently-edited cell, dropping the chip on the wrong cell. Every dismiss path goes
    // through close(), so nulling here covers button-Escape, inline-Escape, space, and edit-end.
    this.target = null
    hideSheetMention()
  }

  private insert(item: MentionItem): void {
    // Target: button mode remembered it at open() (may be null); otherwise (inline, or button with
    // no remembered cell) resolve the currently-active cell.
    const target =
      this.target ??
      (() => {
        const c = this.activeCell()
        return c ? { row: c.row, col: c.col } : null
      })()
    // Capture mode + query BEFORE close() wipes them — the host needs them to reconcile cell text
    // (inline: strip only the trailing `@query`; button: leave existing content untouched).
    const ctx = { mode: this.mode, query: this.query }
    this.target = null
    this.close()
    if (!target) return
    // Commit any in-progress edit (blur) so the cell editor closes before the host inserts the chip.
    try {
      ;(document.activeElement as HTMLElement | null)?.blur()
    } catch {
      /* ignore */
    }
    // Defer so the blur-triggered commit lands first, then hand off to the host (CollabSheet), which
    // drops a float-DOM mention chip and reconciles the cell text per `ctx`. Track the timer so
    // dispose() can cancel it — otherwise onPick could fire against a torn-down sheet.
    this.pickTimer = setTimeout(() => {
      this.pickTimer = null
      if (this.disposed) return
      this.onPick(item, target, ctx)
    }, 0)
  }

  dispose(): void {
    this.disposed = true
    this.target = null
    if (this.pickTimer != null) {
      clearTimeout(this.pickTimer)
      this.pickTimer = null
    }
    this.close()
    this.disposers.splice(0).forEach((d) => {
      try {
        d()
      } catch {
        /* ignore */
      }
    })
  }
}
