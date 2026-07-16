import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { TableMap } from '@tiptap/pm/tables'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TableRowHeight, TableRowResize, ROW_HANDLE_BAND } from './TableRowHeight.ts'

// XIN-1244 / #823 RC2: an INTERRUPTED row-height drag must be a pure abort — zero commit, the row's
// height attr unchanged — exactly as TableReorderHandle FAIL-1 (#76) guards the reorder. These tests
// drive the real document/window listeners the plugin installs (mousemove arms the handle → mousedown
// begins the drag → document mousemove drags → an interruption) and assert the row height is never
// committed. jsdom has no layout, so `posAtCoords` is pointed at a chosen cell and every rect reads as
// zero — harmless, because the handlers still resolve the target row through the stub. The positive
// control proves this harness CAN commit a height on a real mouseup, so the interruption tests
// genuinely show the commit was suppressed.
//
// The headline regression is "release outside the window, then move back in": the pointer leaves
// mid-drag and the button is released OUTSIDE the window. The drag now runs on POINTER events and the
// handle captures the pointer at drag start, so the terminal pointerup is delivered to us with
// out-of-viewport coordinates — we abort on that (a release outside the window is an interruption, not a
// drop) instead of committing the last tracked height. Pointercancel/blur/Escape and a fallback
// buttons===0 check on the document pointermove cover the remaining interruption paths.

const TABLE_2x2 =
  '<table><tbody>' +
  '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
  '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
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
      TableRowHeight,
      TableHeader,
      TableCell,
      TableRowResize,
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

/** The `height` attr of the Nth tableRow in document order (null = no explicit height). */
function rowHeight(ed: Editor, n: number): number | null {
  const rows: PMNode[] = []
  ed.state.doc.descendants((node) => {
    if (node.type.name === 'tableRow') rows.push(node)
    return true
  })
  if (!rows[n]) throw new Error(`no tableRow #${n}`)
  return (rows[n].attrs.height ?? null) as number | null
}

// Mutable target for the stubbed posAtCoords.
let stubPos = 0
function pointPosAt(ed: Editor): void {
  ;(ed.view as unknown as { posAtCoords: (c: { left: number; top: number }) => { pos: number; inside: number } }).posAtCoords =
    () => ({ pos: stubPos, inside: stubPos })
}

/** Arm a row-height drag on row `srcRow`, then move (button held) to a new Y so a fresh height is
 * pending. Leaves the drag in flight. clientX stays outside the column-resize band (> ROW_HANDLE_BAND
 * from a cell edge, whose rect is 0 in jsdom) so the row handle arms instead of deferring to columns;
 * clientY sits within the bottom band of the row (rect bottom is 0 in jsdom, so a small Y arms it).
 * The drag now runs on POINTER events (pointerdown/pointermove/pointerup) with the handle capturing the
 * pointer, so the terminal release is delivered even outside the window (#823 RC2 / XIN-1252). */
const PID = 7
function armRowResize(ed: Editor, srcRow: number, toY: number): void {
  pointPosAt(ed)
  stubPos = insideCell(ed, srcRow, 0)
  const x = ROW_HANDLE_BAND + 40
  // 1. hover the row's bottom band → placeHandle arms the row (hover stays a mousemove).
  ed.view.dom.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: 0, bubbles: true }))
  // 2. press the row-resize handle (primary button, clientY 0 = drag start) → beginDrag.
  const handle = host?.querySelector('.octo-table-row-resize')
  if (!handle) throw new Error('row-resize handle not rendered')
  handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: PID, button: 0, buttons: 1, clientX: x, clientY: 0, bubbles: true }))
  // 3. drag down with the button held → establishes pointerHeldSeen and a pending height.
  document.dispatchEvent(new PointerEvent('pointermove', { pointerId: PID, clientX: x, clientY: toY, buttons: 1 }))
}

describe('row-resize interrupt guard: an interrupted drag never commits a stale height', () => {
  it('positive control: a real pointerup inside the window DOES commit the new height', () => {
    editor = mount(TABLE_2x2)
    expect(rowHeight(editor, 0)).toBeNull()
    armRowResize(editor, 0, 60)
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: PID, clientX: ROW_HANDLE_BAND + 40, clientY: 60, bubbles: true }))
    // The drop committed: the dragged row now carries an explicit height.
    expect(rowHeight(editor, 0)).toBe(60)
  })

  it('release OUTSIDE the window (pointerup past the viewport edge) aborts: no stale height committed', () => {
    editor = mount(TABLE_2x2)
    armRowResize(editor, 0, 60)
    // The headline real-machine path: the pointer left the viewport mid-drag and the button was released
    // OUTSIDE the window. Pointer capture routes that terminal pointerup to us with out-of-viewport
    // coordinates — we must treat it as an interruption and commit nothing, not write the last (stale)
    // tracked height. Before the fix the mouseup at any location committed it.
    document.dispatchEvent(
      new PointerEvent('pointerup', { pointerId: PID, clientX: ROW_HANDLE_BAND + 40, clientY: window.innerHeight + 500, bubbles: true }),
    )
    // A stray mouseup afterwards must be inert — the drag is no longer armed.
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    expect(rowHeight(editor, 0)).toBeNull()
  })

  it('release-outside-then-return (buttons === 0 on re-entry) aborts: no stale height committed', () => {
    editor = mount(TABLE_2x2)
    armRowResize(editor, 0, 60)
    // Fallback path (no live pointer capture): the pointer re-enters with no button pressed — the release
    // happened outside and was never delivered as a pointerup. The buttons===0 move aborts the drag.
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: PID, clientX: ROW_HANDLE_BAND + 40, clientY: 120, buttons: 0 }))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: PID, clientX: ROW_HANDLE_BAND + 40, clientY: 120, buttons: 0 }))
    expect(rowHeight(editor, 0)).toBeNull()
  })

  it('a stray plain mouseup during a drag never commits (only a genuine pointerup can drop)', () => {
    editor = mount(TABLE_2x2)
    armRowResize(editor, 0, 60)
    // The old mouse-driven drag committed on ANY document mouseup — the exact stray event a recovered
    // outside-window release delivers. The pointer-driven drag ignores plain mouseups entirely.
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    expect(rowHeight(editor, 0)).toBeNull()
    // …and the genuine pointerup that follows a real drop still commits.
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: PID, clientX: ROW_HANDLE_BAND + 40, clientY: 60, bubbles: true }))
    expect(rowHeight(editor, 0)).toBe(60)
  })

  it('pointercancel aborts: table row height unchanged, later pointerup is inert', () => {
    editor = mount(TABLE_2x2)
    armRowResize(editor, 0, 60)
    document.dispatchEvent(new Event('pointercancel'))
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: PID, clientX: ROW_HANDLE_BAND + 40, clientY: 60, bubbles: true }))
    expect(rowHeight(editor, 0)).toBeNull()
  })

  it('window blur aborts: table row height unchanged, later pointerup is inert', () => {
    editor = mount(TABLE_2x2)
    armRowResize(editor, 0, 60)
    window.dispatchEvent(new Event('blur'))
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: PID, clientX: ROW_HANDLE_BAND + 40, clientY: 60, bubbles: true }))
    expect(rowHeight(editor, 0)).toBeNull()
  })

  it('Escape aborts: table row height unchanged, later pointerup is inert', () => {
    editor = mount(TABLE_2x2)
    armRowResize(editor, 0, 60)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: PID, clientX: ROW_HANDLE_BAND + 40, clientY: 60, bubbles: true }))
    expect(rowHeight(editor, 0)).toBeNull()
  })
})
