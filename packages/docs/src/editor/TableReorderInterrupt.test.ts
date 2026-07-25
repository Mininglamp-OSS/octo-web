import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { TableMap } from '@tiptap/pm/tables'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TableReorderHandle } from './TableReorderHandle.ts'

// octo-docs-backend#76 FAIL-1 (XIN-1206): an INTERRUPTED drag must be a pure abort — zero dispatch,
// the table order unchanged. These tests drive the real document/window listeners the plugin installs
// (mousedown on a handle → drag; document mousemove → drop target; then an interruption) and assert
// the document never changes. jsdom has no layout, so geometry is stubbed: `posAtCoords` is pointed at
// a chosen cell and element rects read as zero (harmless — the handlers still resolve the target cell
// through the stub). The positive control proves this harness CAN commit a reorder on a real mouseup,
// so the interruption tests genuinely show the commit was suppressed.
//
// The headline regression is "let go outside the window": the pointer leaves mid-drag, the button is
// released over another app (no document `mouseup` reaches us), and the drag was left armed so the
// NEXT stray mouseup committed a reorder the user had abandoned. The guard is a `buttons === 0` check
// in the document mousemove handler that aborts as the pointer re-enters with no button pressed.

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

// Mutable target for the stubbed posAtCoords.
let stubPos = 0
function pointPosAt(ed: Editor): void {
  ;(ed.view as unknown as { posAtCoords: (c: { left: number; top: number }) => { pos: number; inside: number } }).posAtCoords =
    () => ({ pos: stubPos, inside: stubPos })
}

/** Arm a row drag: hover the source cell (sets the handle's source), press the handle, then move
 * over the target cell so a drop target (dropIndex) is resolved. Leaves the drag in flight. */
function armRowDrag(ed: Editor, srcRow: number, dstRow: number): void {
  pointPosAt(ed)
  // 1. hover source cell → placeHandles records it as the drag source.
  stubPos = insideCell(ed, srcRow, 0)
  ed.view.dom.dispatchEvent(new MouseEvent('mousemove', { clientX: 3, clientY: 3, bubbles: true }))
  // 2. press the row handle (primary button) → beginDrag.
  const handle = host?.querySelector('.octo-table-reorder--row')
  if (!handle) throw new Error('row handle not rendered')
  handle.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
  // 3. move over the target cell (button held) → resolves a drop target.
  stubPos = insideCell(ed, dstRow, 0)
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: 9, clientY: 9, buttons: 1 }))
}

describe('FAIL-1: interrupted drag is a pure abort (no reorder)', () => {
  it('positive control: a real mouseup after the drag DOES reorder', () => {
    editor = mount(TABLE_3x2)
    armRowDrag(editor, 2, 0) // drag row 3 toward the top
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    // The drop committed: row "r3" moved above the others.
    expect(grid(editor)[0]).toEqual(['r3c1', 'r3c2'])
  })

  it('Escape aborts: table order unchanged, later mouseup is inert', () => {
    editor = mount(TABLE_3x2)
    const before = grid(editor)
    armRowDrag(editor, 2, 0)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    // A stray mouseup after the interruption must not commit anything.
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    expect(grid(editor)).toEqual(before)
  })

  it('window blur aborts: table order unchanged, later mouseup is inert', () => {
    editor = mount(TABLE_3x2)
    const before = grid(editor)
    armRowDrag(editor, 2, 0)
    window.dispatchEvent(new Event('blur'))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    expect(grid(editor)).toEqual(before)
  })

  it('pointercancel aborts: table order unchanged, later mouseup is inert', () => {
    editor = mount(TABLE_3x2)
    const before = grid(editor)
    armRowDrag(editor, 2, 0)
    document.dispatchEvent(new Event('pointercancel'))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    expect(grid(editor)).toEqual(before)
  })

  it('released outside the window (buttons === 0 on re-entry) aborts: no reorder', () => {
    editor = mount(TABLE_3x2)
    const before = grid(editor)
    armRowDrag(editor, 2, 0)
    // Pointer re-enters the window with no button pressed — the mouseup happened outside and was
    // never delivered. This is the FAIL-1 headline case: old code left the drag armed and the next
    // mouseup committed a reorder; the guard now aborts here.
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 9, clientY: 9, buttons: 0 }))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    expect(grid(editor)).toEqual(before)
  })
})
