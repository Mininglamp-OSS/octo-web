import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TableCellView } from './TableCellView.ts'

// #621-1 regression: the self-built cell NodeView must NOT stop the
// column-resize-handle mousedown. Returning true there short-circuits
// prosemirror-view's eventBelongsToView, so prosemirror-tables' columnResizing
// plugin never sees the mousedown and the column can't be dragged (the handle
// still shows on hover — matching the original bug report). It must also keep
// ignoreMutation so the resize plugin's colwidth → inline-width writes on the
// cell are not re-parsed as content edits under collaboration.

function firstCellNode(): PMNode {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content:
      '<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>',
  })
  let cell: PMNode | null = null
  editor.state.doc.descendants((node) => {
    if (!cell && (node.type.name === 'tableCell' || node.type.name === 'tableHeader')) {
      cell = node
      return false
    }
    return true
  })
  editor.destroy()
  if (!cell) throw new Error('no table cell node found in seeded document')
  return cell
}

let view: TableCellView | null = null
afterEach(() => {
  view = null
})

describe('TableCellView.stopEvent (column resize drag)', () => {
  it('returns false for a .column-resize-handle mousedown so the drag can start', () => {
    view = new TableCellView(firstCellNode(), 'td')
    const handle = document.createElement('div')
    handle.className = 'column-resize-handle'
    const event = { type: 'mousedown', target: handle } as unknown as Event
    // stopEvent is narrowed to () => boolean; call through the PM contract type
    // to express that the resize-handle event specifically is not stopped.
    const stopEvent = view.stopEvent as unknown as (e: Event) => boolean
    expect(stopEvent.call(view, event)).toBe(false)
  })

  it('does not stop ordinary in-cell events either (typing/selection flow to PM)', () => {
    view = new TableCellView(firstCellNode(), 'td')
    const event = { type: 'mousedown', target: view.dom } as unknown as Event
    const stopEvent = view.stopEvent as unknown as (e: Event) => boolean
    expect(stopEvent.call(view, event)).toBe(false)
  })

  it('still ignores attribute mutations on its own cell element (colwidth writes)', () => {
    view = new TableCellView(firstCellNode(), 'td')
    expect(view.ignoreMutation({ type: 'attributes', target: view.dom })).toBe(true)
  })
})
