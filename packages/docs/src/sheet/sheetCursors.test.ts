import { describe, it, expect, afterEach } from 'vitest'
import { SheetCursorOverlay } from './sheetCursors.ts'

// Non-empty, deterministic cell rect so render() positions (and doesn't skip) the box.
function fakeRect(row: number, col: number): DOMRect {
  const top = 100 + row * 20
  const left = 50 + col * 60
  return { top, left, width: 60, height: 20, right: left + 60, bottom: top + 20, x: left, y: top, toJSON() {} } as DOMRect
}

function makeSheet() {
  return {
    getSheetId: () => 's1',
    getActiveRange: () => ({ getRange: () => ({ startRow: 0, startColumn: 0 }), getCellRect: () => fakeRect(0, 0) }),
    getRange: (row: number, col: number) => ({ getRange: () => ({ startRow: row, startColumn: col }), getCellRect: () => fakeRect(row, col) }),
    getScrollState: () => ({ offsetX: 0, offsetY: 0, sheetViewStartRow: 0, sheetViewStartColumn: 0 }),
    onScroll: () => ({ dispose() {} }),
  }
}

function makeUniver(sheet: ReturnType<typeof makeSheet>) {
  return {
    getActiveWorkbook: () => ({ getActiveSheet: () => sheet }),
    onCommandExecuted: () => ({ dispose() {} }),
  }
}

class FakeAwareness {
  clientID = 1
  states = new Map<number, { user?: { id?: string; name?: string; color?: string }; cell?: { row: number; col: number } }>()
  private handlers: Array<() => void> = []
  getStates() {
    return this.states
  }
  setLocalStateField() {}
  on(_e: 'change', cb: () => void) {
    this.handlers.push(cb)
  }
  off(_e: 'change', cb: () => void) {
    this.handlers = this.handlers.filter((h) => h !== cb)
  }
  emit() {
    for (const h of this.handlers) h()
  }
}

/** A container holding a grid-sized canvas so the overlay's mainCanvas() gate passes in jsdom. */
function makeContainer(): HTMLElement {
  const container = document.createElement('div') // detached → mount === container
  const canvas = document.createElement('canvas')
  canvas.getBoundingClientRect = () =>
    ({ width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} }) as DOMRect
  container.appendChild(canvas)
  return container
}

/** The overlay draws each cursor box as a direct child of its layer (the direct-child <div>). */
function cursorBoxes(container: HTMLElement): HTMLElement[] {
  const layer = container.querySelector(':scope > div')
  return layer ? (Array.from(layer.children) as HTMLElement[]) : []
}

describe('SheetCursorOverlay dedupe', () => {
  let overlay: SheetCursorOverlay | null = null
  afterEach(() => {
    overlay?.dispose()
    overlay = null
  })

  it('collapses multiple sessions of the same uid to a single cursor (multi-tab / stale ghost)', () => {
    const container = makeContainer()
    const aw = new FakeAwareness()
    // self (client 1, uid A) — never rendered
    aw.states.set(1, { user: { id: 'A', name: 'Me', color: '#111' }, cell: { row: 0, col: 0 } })
    // two sessions of the SAME remote user B, at different cells
    aw.states.set(2, { user: { id: 'B', name: '测试用户2', color: '#27AE60' }, cell: { row: 1, col: 3 } })
    aw.states.set(3, { user: { id: 'B', name: '测试用户2', color: '#27AE60' }, cell: { row: 5, col: 3 } })

    overlay = new SheetCursorOverlay(makeUniver(makeSheet()) as never, aw as never, container)

    const boxes = cursorBoxes(container).filter((b) => b.style.display !== 'none')
    expect(boxes).toHaveLength(1)
    // Kept the most-recent session (highest clientID = 3 → row 5, content top 200).
    expect(boxes[0].style.top).toBe('200px')
  })

  it('never renders the local user own other tab (same uid as self)', () => {
    const container = makeContainer()
    const aw = new FakeAwareness()
    aw.states.set(1, { user: { id: 'A', name: 'Me', color: '#111' }, cell: { row: 0, col: 0 } })
    // a second tab of MYSELF (uid A, different clientID) — must not show as a collaborator
    aw.states.set(2, { user: { id: 'A', name: 'Me', color: '#111' }, cell: { row: 3, col: 2 } })

    overlay = new SheetCursorOverlay(makeUniver(makeSheet()) as never, aw as never, container)

    expect(cursorBoxes(container).filter((b) => b.style.display !== 'none')).toHaveLength(0)
  })

  it('renders one cursor per distinct collaborator', () => {
    const container = makeContainer()
    const aw = new FakeAwareness()
    aw.states.set(1, { user: { id: 'A', name: 'Me', color: '#111' }, cell: { row: 0, col: 0 } })
    aw.states.set(2, { user: { id: 'B', name: 'User B', color: '#27AE60' }, cell: { row: 1, col: 1 } })
    aw.states.set(3, { user: { id: 'C', name: 'User C', color: '#2D9CDB' }, cell: { row: 2, col: 2 } })

    overlay = new SheetCursorOverlay(makeUniver(makeSheet()) as never, aw as never, container)

    expect(cursorBoxes(container).filter((b) => b.style.display !== 'none')).toHaveLength(2)
  })

  it('draws nothing until the grid canvas is ready, then snaps in on the next render', () => {
    const container = document.createElement('div') // NO grid canvas yet (still loading)
    const aw = new FakeAwareness()
    aw.states.set(1, { user: { id: 'A', name: 'Me', color: '#111' }, cell: { row: 0, col: 0 } })
    aw.states.set(2, { user: { id: 'B', name: '测试用户1', color: '#27AE60' }, cell: { row: 1, col: 3 } })

    overlay = new SheetCursorOverlay(makeUniver(makeSheet()) as never, aw as never, container)
    // Grid not painted → the mainCanvas() gate suppresses the cursor (no stray box before load).
    expect(cursorBoxes(container).filter((b) => b.style.display !== 'none')).toHaveLength(0)

    // Grid canvas mounts (Univer finished laying out) → a re-render snaps the cursor in.
    const canvas = document.createElement('canvas')
    canvas.getBoundingClientRect = () =>
      ({ width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} }) as DOMRect
    container.appendChild(canvas)
    overlay.refresh()

    expect(cursorBoxes(container).filter((b) => b.style.display !== 'none')).toHaveLength(1)
  })
})
