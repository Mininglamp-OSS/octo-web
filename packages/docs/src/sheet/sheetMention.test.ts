import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { stripTrailingQuery, SheetCellMention } from './sheetMention.ts'
import {
  requestSheetMentionClose,
  setSheetMentionCloser,
  hideSheetMention,
  setSheetMentionState,
  getSheetMentionState,
  subscribeSheetMention,
} from './sheetMentionBridge.ts'

// The controller lazily loads candidates through the shared source; stub it so the target-lifecycle
// tests below stay deterministic and offline (we drive picks directly via ctrl.pick()).
vi.mock('../mentions/source.ts', () => ({
  loadMentionItems: vi.fn(async () => []),
  filterMentionItems: (items: unknown[]) => items,
  MAX_PER_SOURCE: 8,
}))

// ─── Blocker 1: inline @query strip must never erase a cell it can't reconcile ───
describe('stripTrailingQuery (inline cell-text reconcile)', () => {
  it('strips a bare trailing @query → clears the cell (null)', () => {
    // user typed only "@ali" then picked → nothing should remain
    expect(stripTrailingQuery('@ali', 'ali')).toBeNull()
  })

  it('strips ONLY the trailing @query, preserving the prefix', () => {
    expect(stripTrailingQuery('owner: @ali', 'ali')).toBe('owner: ')
  })

  it('strips the LAST @query when several are present', () => {
    expect(stripTrailingQuery('@bob and @ali', 'ali')).toBe('@bob and ')
  })

  it('handles an empty query (bare @) → clears the cell', () => {
    expect(stripTrailingQuery('@', '')).toBeNull()
  })

  it('returns undefined (DO NOT WRITE) when the needle is absent — the data-loss guard', () => {
    // query/cell desync (IME/CJK composition, paste, concurrent edit): the committed cell text
    // has no "@张三", so we must NOT rewrite it — undefined means "leave the cell untouched".
    expect(stripTrailingQuery('重要数据不能丢', '张三')).toBeUndefined()
  })

  it('returns undefined for a non-empty cell whose query never matched', () => {
    expect(stripTrailingQuery('formula result 42', 'ali')).toBeUndefined()
  })
})

// ─── Blocker 2: dismissing the overlay must drive the controller's close(), not just hide state ───
describe('requestSheetMentionClose (overlay dismiss → controller)', () => {
  beforeEach(() => {
    setSheetMentionCloser(null)
    hideSheetMention()
  })

  it('routes to the registered controller closer (so controller open/mode reset)', () => {
    const closer = vi.fn()
    setSheetMentionCloser(closer)
    requestSheetMentionClose()
    expect(closer).toHaveBeenCalledTimes(1)
  })

  it('falls back to a plain state-hide when no controller is registered', () => {
    setSheetMentionState({
      visible: true,
      mode: 'inline',
      x: 0,
      y: 0,
      items: [],
      query: '',
      active: 0,
    })
    expect(getSheetMentionState().visible).toBe(true)
    requestSheetMentionClose() // no closer set → must still hide
    expect(getSheetMentionState().visible).toBe(false)
  })

  it('notifies subscribers when the fallback hide fires', () => {
    setSheetMentionState({
      visible: true,
      mode: 'button',
      x: 1,
      y: 2,
      items: [],
      query: 'q',
      active: 0,
    })
    const cb = vi.fn()
    const unsub = subscribeSheetMention(cb)
    requestSheetMentionClose()
    expect(cb).toHaveBeenCalled()
    unsub()
  })
})

// ─── Blocker 3: a cancelled button-@ session must NOT leak its target into a later inline pick ───
// Repro (reviewers Steve/Jerry-Xin + lml2468, head 283be929): ribbon-@ on A1 → dismiss → move to C5
// → inline @name → pick → the chip must land on C5, not the stale A1. Root cause was close() not
// clearing this.target (only insert()/dispose() did). Fixed by nulling this.target in close().
describe('SheetCellMention target lifecycle (stale-target wrong-cell insert)', () => {
  const EDIT_CMD = 'sheet.operation.set-cell-edit-visible'

  // Minimal Univer facade: a movable active cell + a capturable command stream.
  function makeHarness() {
    let cell = { row: 0, col: 0 }
    let cmdCb: ((cmd: { id: string; params?: { visible?: boolean } }) => void) | null = null
    const univerAPI = {
      getActiveWorkbook: () => ({
        getActiveSheet: () => ({
          getRange: () => ({}),
          getActiveRange: () => ({
            getRange: () => ({ startRow: cell.row, startColumn: cell.col }),
          }),
        }),
      }),
      onCommandExecuted: (cb: (cmd: { id: string; params?: { visible?: boolean } }) => void) => {
        cmdCb = cb
        return { dispose: () => { cmdCb = null } }
      },
    }
    return {
      univerAPI,
      moveTo: (row: number, col: number) => { cell = { row, col } },
      setEditing: (visible: boolean) =>
        cmdCb?.({ id: EDIT_CMD, params: { visible } }),
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the remembered target on dismiss → inline pick lands on the CURRENT cell', () => {
    const h = makeHarness()
    const onPick = vi.fn()
    const ctrl = new SheetCellMention(
      h.univerAPI as never,
      document.createElement('div'),
      'space-1',
      onPick,
    )

    // 1. Ribbon-@ opens button mode on A1 (0,0), remembering it as the target.
    h.moveTo(0, 0)
    ctrl.openMenu()
    // 2. Dismiss without picking → close() must now clear the remembered target.
    ctrl.closeMenu()
    // 3. Move to C5 (4,2) and start an inline @ mention there.
    h.moveTo(4, 2)
    h.setEditing(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '@' }))
    // 4. Pick a candidate → insert() resolves the target.
    ctrl.pick({ id: 'u1', label: 'Alice', type: 'user' })
    vi.runAllTimers()

    expect(onPick).toHaveBeenCalledTimes(1)
    const cellArg = onPick.mock.calls[0][1]
    // With the fix the chip lands on C5; the bug would have inserted it on the stale A1 {0,0}.
    expect(cellArg).toEqual({ row: 4, col: 2 })

    ctrl.dispose()
  })
})

// ─── Blocker P1-2: readers (and runtime-demoted writers) must NOT be able to open/pick a mention ───
// Reviewers Jerry-Xin + lml2468, head fa5098db: the mention path had NO role gate, so a reader could
// trigger the popup and "insert" a chip — but the Yjs write gate silently drops the write, leaving a
// misleading local-only phantom chip. Fix: SheetCellMention takes a `canEditNow()` predicate that gates
// the inline `@` trigger, openMenu(), and pick(). This test locks that behaviour in.
describe('SheetCellMention role gate (readers cannot open/pick mentions)', () => {
  const EDIT_CMD = 'sheet.operation.set-cell-edit-visible'

  function makeHarness() {
    let cell = { row: 0, col: 0 }
    let cmdCb: ((cmd: { id: string; params?: { visible?: boolean } }) => void) | null = null
    const univerAPI = {
      getActiveWorkbook: () => ({
        getActiveSheet: () => ({
          getRange: () => ({}),
          getActiveRange: () => ({
            getRange: () => ({ startRow: cell.row, startColumn: cell.col }),
          }),
        }),
      }),
      onCommandExecuted: (cb: (cmd: { id: string; params?: { visible?: boolean } }) => void) => {
        cmdCb = cb
        return { dispose: () => { cmdCb = null } }
      },
    }
    return {
      univerAPI,
      moveTo: (row: number, col: number) => { cell = { row, col } },
      setEditing: (visible: boolean) => cmdCb?.({ id: EDIT_CMD, params: { visible } }),
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reader (canEditNow=false): openMenu() and pick() do NOT fire onPick', () => {
    const h = makeHarness()
    const onPick = vi.fn()
    const ctrl = new SheetCellMention(
      h.univerAPI as never,
      document.createElement('div'),
      'space-1',
      onPick,
      () => false, // reader
    )

    h.moveTo(0, 0)
    ctrl.openMenu()
    // Even if a pick were somehow requested, the gate must swallow it.
    ctrl.pick({ id: 'u1', label: 'Alice', type: 'user' })
    vi.runAllTimers()
    expect(onPick).not.toHaveBeenCalled()

    // Inline `@` while editing must also be gated (no popup / no onPick down the line).
    h.moveTo(1, 1)
    h.setEditing(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '@' }))
    ctrl.pick({ id: 'u2', label: 'Bob', type: 'user' })
    vi.runAllTimers()
    expect(onPick).not.toHaveBeenCalled()

    ctrl.dispose()
  })

  it('writer (canEditNow=true): pick() fires onPick as normal', () => {
    const h = makeHarness()
    const onPick = vi.fn()
    const ctrl = new SheetCellMention(
      h.univerAPI as never,
      document.createElement('div'),
      'space-1',
      onPick,
      () => true, // writer
    )

    h.moveTo(2, 3)
    h.setEditing(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '@' }))
    ctrl.pick({ id: 'u1', label: 'Alice', type: 'user' })
    vi.runAllTimers()

    expect(onPick).toHaveBeenCalledTimes(1)
    ctrl.dispose()
  })
})

