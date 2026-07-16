import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { TableMap } from '@tiptap/pm/tables'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TableReorderHandle } from './TableReorderHandle.ts'

// octo-docs-backend#76 handle-usability regression (XIN-1215 → XIN-1216). XIN-1206 added a
// "released outside the window" abort: a document mousemove reporting `buttons === 0` mid-drag is
// treated as an interruption. The trap it introduced: a drag whose moves do NOT carry `buttons`
// reports 0 for the WHOLE drag even though the button is logically down — a hand-built MouseEvent,
// or an automated headed-Chromium drag driven by raw CDP mouse events that omit the field. The
// first such move then cancelled a perfectly good reorder, so QA saw the reorder handle as
// "unusable" on a fresh document while a genuine held-button drag (buttons === 1) worked. The
// existing FAIL-1 suite hid the gap because its drag helper dispatches the mid-drag move with
// `buttons: 1`, exercising only the held-button path.
//
// These tests cover the path unit-42 missed: (1) the static handle actually RENDERS on a fresh
// document, and (2) a drag whose mid-drag move carries no `buttons` still initiates and reorders —
// while the genuine "release outside the window" (a held move, THEN an unheld move) still aborts,
// so the FAIL-1 fix is preserved.

const TABLE_3x2 =
  '<table><tbody>' +
  '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
  '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
  '<tr><td><p>r3c1</p></td><td><p>r3c2</p></td></tr>' +
  '</tbody></table>'

let editor: Editor | null = null
let host: HTMLElement | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
  host?.remove()
  host = null
})

function mount(content: string): Editor {
  host = document.createElement('div')
  document.body.appendChild(host)
  return new Editor({
    element: host,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TableReorderHandle,
    ],
    content,
  })
}

function firstTable(ed: Editor): { node: PMNode; pos: number } {
  let node: PMNode | null = null
  let pos = -1
  ed.state.doc.descendants((n, p) => {
    if (!node && n.type.name === 'table') {
      node = n
      pos = p
      return false
    }
    return true
  })
  if (!node) throw new Error('no table')
  return { node, pos }
}
function insideCell(ed: Editor, row: number, col: number): number {
  const { node, pos } = firstTable(ed)
  const map = TableMap.get(node)
  return pos + 1 + map.map[row * map.width + col] + 2
}
function grid(ed: Editor): string[][] {
  const { node } = firstTable(ed)
  const map = TableMap.get(node)
  const out: string[][] = []
  for (let r = 0; r < map.height; r++) {
    const rowArr: string[] = []
    for (let c = 0; c < map.width; c++) {
      const cell = node.nodeAt(map.map[r * map.width + c])
      rowArr.push(cell ? cell.textContent : '')
    }
    out.push(rowArr)
  }
  return out
}

let stubPos = 0
function pointPosAt(ed: Editor): void {
  ;(ed.view as unknown as { posAtCoords: (c: { left: number; top: number }) => { pos: number; inside: number } }).posAtCoords =
    () => ({ pos: stubPos, inside: stubPos })
}

/** Hover the source cell so `placeHandles` records it as the drag source and shows the handle. */
function hoverCell(ed: Editor, row: number, col: number): void {
  pointPosAt(ed)
  stubPos = insideCell(ed, row, col)
  ed.view.dom.dispatchEvent(new MouseEvent('mousemove', { clientX: 3, clientY: 3, bubbles: true }))
}

const PID = 9

describe('handle usability (octo-docs-backend#76 / XIN-1216)', () => {
  it('renders the static row and column handles on a fresh document when a cell is hovered', () => {
    editor = mount(TABLE_3x2)
    hoverCell(editor, 2, 0)
    const rowHandle = host?.querySelector('.octo-table-reorder--row') as HTMLElement | null
    const colHandle = host?.querySelector('.octo-table-reorder--col') as HTMLElement | null
    expect(rowHandle, 'row handle element exists').toBeTruthy()
    expect(colHandle, 'column handle element exists').toBeTruthy()
    // Hovering a cell must make them visible (not display:none) — the "handle rendered" path.
    expect(rowHandle?.style.display).not.toBe('none')
    expect(colHandle?.style.display).not.toBe('none')
  })

  it('a drag whose mid-drag move carries no `buttons` still initiates and reorders (XIN-1215)', () => {
    editor = mount(TABLE_3x2)
    hoverCell(editor, 2, 0) // hover row 3
    const handle = host?.querySelector('.octo-table-reorder--row')
    if (!handle) throw new Error('row handle not rendered')
    handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: PID, button: 0, buttons: 1, clientX: 3, clientY: 3, bubbles: true }))
    // Move over row 1 with NO `buttons` set (defaults to 0) — this is the automation / synthetic
    // path. Before the fix the guard aborted here; now the reorder proceeds.
    stubPos = insideCell(editor, 0, 0)
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: PID, clientX: 9, clientY: 9 }))
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: PID, clientX: 9, clientY: 9, bubbles: true }))
    expect(grid(editor)[0]).toEqual(['r3c1', 'r3c2'])
  })

  it('still aborts a genuine release outside the window: held move, then an unheld move (FAIL-1 preserved)', () => {
    editor = mount(TABLE_3x2)
    const before = grid(editor)
    hoverCell(editor, 2, 0)
    const handle = host?.querySelector('.octo-table-reorder--row')
    if (!handle) throw new Error('row handle not rendered')
    handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: PID, button: 0, buttons: 1, clientX: 3, clientY: 3, bubbles: true }))
    // A real held-button move (buttons:1) arms the drag...
    stubPos = insideCell(editor, 0, 0)
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: PID, clientX: 9, clientY: 9, buttons: 1 }))
    // ...then the pointer re-enters with the button released outside the window (buttons:0): abort.
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: PID, clientX: 9, clientY: 9, buttons: 0 }))
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: PID, clientX: 9, clientY: 9, bubbles: true }))
    expect(grid(editor)).toEqual(before)
  })
})

// octo-docs-backend#76 handle-discoverability + coexistence regression (XIN-1233 → XIN-1253). The
// grab handle and the #823 row-height resize bar are absolutely-positioned SIBLINGS of the editor
// DOM that sit ON TOP of the table. A hide driven by the editor's own `mouseleave` fired the moment
// the pointer crossed onto ANY such overlay (the gutter dead space, or #823's full-width bar at a
// row's bottom edge), so the handle vanished before it could be grabbed. The fix drives resting-handle
// visibility from a DOCUMENT-level mousemove that reads the pointer directly: it re-places the handle
// while the pointer resolves to a cell, keeps it while the pointer is over a plugin overlay inside the
// editor wrapper, and hides it (after a short grace period) only once the pointer genuinely leaves.
describe('handle stability / discoverability (octo-docs-backend#76 / XIN-1233, XIN-1253)', () => {
  it('hides the handle after the grace period once the pointer genuinely leaves the table', () => {
    vi.useFakeTimers()
    try {
      editor = mount(TABLE_3x2)
      hoverCell(editor, 2, 0)
      const rowHandle = host?.querySelector('.octo-table-reorder--row') as HTMLElement | null
      expect(rowHandle?.style.display).not.toBe('none')
      // Pointer moves well away from the editor (no cell, outside the editor region): schedule hide.
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 9999, clientY: 9999 }))
      // Must NOT vanish synchronously — the grace period keeps it up briefly.
      expect(rowHandle?.style.display, 'handle stays visible during the grace period').not.toBe('none')
      // After the grace period elapses with no rescue, it clears.
      vi.advanceTimersByTime(500)
      expect(rowHandle?.style.display, 'handle hides once the grace period lapses').toBe('none')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the handle visible while the pointer is over a plugin overlay on top of the table (#823 coexistence, XIN-1253)', () => {
    vi.useFakeTimers()
    try {
      editor = mount(TABLE_3x2)
      hoverCell(editor, 2, 0)
      const rowHandle = host?.querySelector('.octo-table-reorder--row') as HTMLElement | null
      if (!rowHandle) throw new Error('row handle not rendered')
      // The pointer moves onto a sibling overlay that sits ON TOP of a cell — e.g. #823's row-resize
      // bar at the row's bottom edge. No cell resolves under the pointer, but elementFromPoint is an
      // element inside the editor wrapper (here the reorder handle itself stands in for that overlay)
      // and OUTSIDE the prose. The editor's mouseleave used to hide the handle here; it must not now.
      ;(editor.view as unknown as { posAtCoords: () => null }).posAtCoords = () => null
      // jsdom does not implement elementFromPoint; stub it to report the overlay under the pointer.
      const doc = document as unknown as { elementFromPoint?: (x: number, y: number) => Element | null }
      const prev = doc.elementFromPoint
      doc.elementFromPoint = () => rowHandle
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 3, clientY: 3 }))
      vi.advanceTimersByTime(500)
      expect(rowHandle.style.display, 'handle stays put over the overlay').not.toBe('none')
      doc.elementFromPoint = prev
    } finally {
      vi.useRealTimers()
    }
  })
})
