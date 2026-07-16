import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { TableMap } from '@tiptap/pm/tables'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TableReorderHandle } from './TableReorderHandle.ts'

// octo-docs-backend#76 P1-1 / P1-2 (multi-pointer re-entrancy in the Pointer Events migration).
//
// The drag pipeline moved from mouse events to pointer events + `setPointerCapture`. Two defects the
// reviewers (yujiawei / Jerry-Xin) surfaced on that migration are exercised here:
//   P1-1 — `beginDrag` had no active-drag guard, so a second `pointerdown` (a second finger / stylus
//          on the OTHER handle, or a stray re-entry) clobbered the in-flight drag identity and leaked
//          the first pointer's capture. Fixed by `if (drag) return` at the top of `beginDrag`.
//   P1-2 — the document capture-phase `pointermove`/`pointerup`/`pointercancel` handlers gated only on
//          `!drag`/`!activeView`, not on the captured pointer id. `setPointerCapture` only retargets the
//          OWNING pointer — a second, uncaptured pointer's `pointerup` still reached `onDocUp` and ended
//          the drag mid-first-pointer. Fixed by filtering each handler on `event.pointerId ===
//          capturedPointerId` (with the null-capture / synthetic fallback preserved).
//
// jsdom has no real pointer capture, so we stub `setPointerCapture`/`releasePointerCapture` on the
// handle elements. The stub both makes `capturedPointerId` latch (so the id filter is live, as it is in
// a real browser) and records the set of currently-captured pointer ids so a capture LEAK is observable.

const TABLE_3x2 =
  '<table><tbody>' +
  '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
  '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
  '<tr><td><p>r3c1</p></td><td><p>r3c2</p></td></tr>' +
  '</tbody></table>'

let editor: Editor | null = null
let host: HTMLElement | null = null

// Pointer ids currently held via the stubbed capture, and the high-water mark of concurrent captures.
// A leaked capture (P1-1) shows up as `maxConcurrentCaptures > 1`.
const capturedIds = new Set<number>()
let maxConcurrentCaptures = 0
let originalSet: unknown
let originalRelease: unknown

beforeEach(() => {
  capturedIds.clear()
  maxConcurrentCaptures = 0
  const proto = HTMLElement.prototype as unknown as {
    setPointerCapture?: (id: number) => void
    releasePointerCapture?: (id: number) => void
  }
  originalSet = proto.setPointerCapture
  originalRelease = proto.releasePointerCapture
  proto.setPointerCapture = function (id: number) {
    capturedIds.add(id)
    if (capturedIds.size > maxConcurrentCaptures) maxConcurrentCaptures = capturedIds.size
  }
  proto.releasePointerCapture = function (id: number) {
    capturedIds.delete(id)
  }
})

afterEach(() => {
  editor?.destroy()
  editor = null
  host?.remove()
  host = null
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  proto.setPointerCapture = originalSet
  proto.releasePointerCapture = originalRelease
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
/** A document position INSIDE the (row,col) cell's paragraph — what posAtCoords is pointed at. */
function insideCell(ed: Editor, row: number, col: number): number {
  const { node, pos } = firstTable(ed)
  const map = TableMap.get(node)
  return pos + 1 + map.map[row * map.width + col] + 2
}
/** Cell text grid, read from the current TableMap. */
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

const OWNER = 5 // pointer id of the finger that owns the drag
const FOREIGN = 9 // a second, uncaptured pointer id

/** Arm a row drag on the OWNER pointer: hover the source cell, press the row handle (captures OWNER),
 * then a held move over the target cell resolves a drop. Leaves the drag in flight. */
function armRowDrag(ed: Editor, srcRow: number, dstRow: number): void {
  pointPosAt(ed)
  stubPos = insideCell(ed, srcRow, 0)
  ed.view.dom.dispatchEvent(new MouseEvent('mousemove', { clientX: 3, clientY: 3, bubbles: true }))
  const handle = host?.querySelector('.octo-table-reorder--row')
  if (!handle) throw new Error('row handle not rendered')
  handle.dispatchEvent(
    new PointerEvent('pointerdown', { pointerId: OWNER, button: 0, buttons: 1, clientX: 3, clientY: 3, bubbles: true }),
  )
  stubPos = insideCell(ed, dstRow, 0)
  document.dispatchEvent(new PointerEvent('pointermove', { pointerId: OWNER, clientX: 9, clientY: 9, buttons: 1 }))
}

describe('P1-1: beginDrag guards against a second pointer clobbering an in-flight drag', () => {
  it('a second pointerdown on the other handle is a no-op — row drag identity survives, no capture leak', () => {
    editor = mount(TABLE_3x2)
    armRowDrag(editor, 2, 0) // OWNER drags row 3 toward the top
    expect(capturedIds.has(OWNER)).toBe(true)

    // A second finger presses the COLUMN handle mid-drag. Without the guard this re-ran beginDrag,
    // overwrote drag/ordinal/capturedPointerId with a column drag and captured a second pointer while
    // the first capture was never released.
    const colHandle = host?.querySelector('.octo-table-reorder--col')
    if (!colHandle) throw new Error('col handle not rendered')
    colHandle.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: FOREIGN, button: 0, buttons: 1, clientX: 3, clientY: 3, bubbles: true }),
    )

    // No leaked capture: only one pointer was ever held at a time.
    expect(maxConcurrentCaptures).toBe(1)
    expect(capturedIds.has(FOREIGN)).toBe(false)

    // The owner releases inside the window: the ORIGINAL row drag commits (row 3 to the top), proving
    // the drag identity was not corrupted into a column drag.
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: OWNER, clientX: 9, clientY: 9, bubbles: true }))
    expect(grid(editor)[0]).toEqual(['r3c1', 'r3c2'])
  })
})

describe('P1-2: document pointer handlers ignore a foreign (uncaptured) pointer', () => {
  it('a second pointer’s pointerup does NOT end the drag; the owning pointerup still commits', () => {
    editor = mount(TABLE_3x2)
    armRowDrag(editor, 2, 0)
    const before = grid(editor)

    // A second finger lifts elsewhere in the document. Its pointerup reaches the capture-phase
    // onDocUp; without the id filter this called endDrag() and committed the reorder mid-drag.
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: FOREIGN, clientX: 40, clientY: 40, bubbles: true }))
    expect(grid(editor)).toEqual(before) // still in flight, nothing committed

    // The owning pointer's release then commits the intended reorder.
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: OWNER, clientX: 9, clientY: 9, bubbles: true }))
    expect(grid(editor)[0]).toEqual(['r3c1', 'r3c2'])
  })

  it('a foreign pointercancel does NOT abort the drag; the owning release still commits', () => {
    editor = mount(TABLE_3x2)
    armRowDrag(editor, 2, 0)

    // An unrelated pointer the OS cancels (a second finger) must not abort our drag.
    document.dispatchEvent(new PointerEvent('pointercancel', { pointerId: FOREIGN, bubbles: true }))
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: OWNER, clientX: 9, clientY: 9, bubbles: true }))
    expect(grid(editor)[0]).toEqual(['r3c1', 'r3c2'])
  })

  it('the owning pointer’s pointercancel still aborts (no reorder)', () => {
    editor = mount(TABLE_3x2)
    armRowDrag(editor, 2, 0)
    const before = grid(editor)

    document.dispatchEvent(new PointerEvent('pointercancel', { pointerId: OWNER, bubbles: true }))
    // A later release is inert — the drag was aborted.
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: OWNER, clientX: 9, clientY: 9, bubbles: true }))
    expect(grid(editor)).toEqual(before)
  })
})
