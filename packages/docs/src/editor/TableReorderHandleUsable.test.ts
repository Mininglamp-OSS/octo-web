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
    handle.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
    // Move over row 1 with NO `buttons` set (defaults to 0) — this is the automation / synthetic
    // path. Before the fix the guard aborted here; now the reorder proceeds.
    stubPos = insideCell(editor, 0, 0)
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 9, clientY: 9 }))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    expect(grid(editor)[0]).toEqual(['r3c1', 'r3c2'])
  })

  it('still aborts a genuine release outside the window: held move, then an unheld move (FAIL-1 preserved)', () => {
    editor = mount(TABLE_3x2)
    const before = grid(editor)
    hoverCell(editor, 2, 0)
    const handle = host?.querySelector('.octo-table-reorder--row')
    if (!handle) throw new Error('row handle not rendered')
    handle.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
    // A real held-button move (buttons:1) arms the drag...
    stubPos = insideCell(editor, 0, 0)
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 9, clientY: 9, buttons: 1 }))
    // ...then the pointer re-enters with the button released outside the window (buttons:0): abort.
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 9, clientY: 9, buttons: 0 }))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    expect(grid(editor)).toEqual(before)
  })
})
