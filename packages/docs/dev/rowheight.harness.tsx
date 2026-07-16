// Real-browser two-peer harness for the table row-height resize handle (SCHEMA_VERSION 19).
// Companion to dev/reorder.harness.tsx.
//
// WHY a real browser: the row-resize handle is DOM/pointer driven — hit-testing keys off the row's
// live bottom-edge geometry (getBoundingClientRect) and the drag runs through document-level
// mousemove/mouseup with real screen coordinates. jsdom has no layout, so a unit test can only
// exercise the setNodeMarkup transaction the drag commits (TableRowHeight.test.ts), NOT the geometry
// that connects a real drag on the row line to that transaction. This harness closes that gap with a
// real Chromium drag (page.mouse.down/move/up), reading the ProseMirror model (editor.state.doc) to
// verify the height changed and PERSISTED, and mounts a second collaborative peer to prove the height
// syncs to the other side (协作对端一致).
//
// Two real collaborative editors (A = where the user drags, B = the remote peer) are bound to two
// Y.Docs bridged the way HocuspocusProvider relays updates. `window.__rowHeightHarness` exposes the
// seams the Playwright driver (dev/run-rowheight.mjs) needs. Dev-only.

import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { Table } from '@tiptap/extension-table'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { TextSelection } from '@tiptap/pm/state'
import { TableMap, addRowBefore } from '@tiptap/pm/tables'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TableRowHeight, TableRowResize } from '../src/editor/TableRowHeight.ts'

const FIELD = 'default'

function makeEditor(ydoc: Y.Doc, element: HTMLElement): Editor {
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document: ydoc, field: FIELD }),
      Table.configure({ resizable: true, handleWidth: 12, cellMinWidth: 25 }),
      TableRowHeight,
      TableHeader,
      TableCell,
      TableRowResize,
    ],
  })
}

/** Relay every local Y update from `from` into `to`, tagged so it is not echoed back — the same
 *  incremental relay HocuspocusProvider performs over the WS. */
function bridge(from: Y.Doc, to: Y.Doc): () => void {
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === 'bridge') return
    Y.applyUpdate(to, update, 'bridge')
  }
  from.on('update', onUpdate)
  return () => from.off('update', onUpdate)
}

/** All tableRows of the first table, in document order, with their document positions + nodes. */
function rowsOf(editor: Editor): { pos: number; node: PMNode }[] {
  const rows: { pos: number; node: PMNode }[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableRow') rows.push({ pos, node })
    return true
  })
  return rows
}

/** The first table node + the position just before it (for a concurrent structural edit). */
function firstTable(editor: Editor): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (!found && node.type.name === 'table') {
      found = { node, pos }
      return false
    }
    return true
  })
  return found
}

const DOC =
  '<p>row-height harness — drag the line under row 1</p>' +
  '<table><tbody>' +
  '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
  '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
  '</tbody></table>'

function Harness(): React.ReactElement {
  const refA = useRef<HTMLDivElement>(null)
  const refB = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!refA.current || !refB.current) return
    let edA: Editor | null = null
    let edB: Editor | null = null
    let offA: (() => void) | null = null
    let offB: (() => void) | null = null

    const mount = () => {
      offA?.()
      offB?.()
      edA?.destroy()
      edB?.destroy()
      refA.current!.innerHTML = ''
      refB.current!.innerHTML = ''
      const docA = new Y.Doc()
      const docB = new Y.Doc()
      edA = makeEditor(docA, refA.current!)
      edA.commands.insertContent(DOC)
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), 'bridge')
      edB = makeEditor(docB, refB.current!)
      offA = bridge(docA, docB)
      offB = bridge(docB, docA)
    }

    const harness = {
      mount,
      // Height attr of the Nth row on peer A / peer B (null when unset). The model comparison the
      // acceptance gate requires — read from editor.state.doc, not the DOM (immune to
      // CollaborationCaret decoration pollution, which lives in the view only).
      rowHeightA: (i: number): number | null => (rowsOf(edA!)[i]?.node.attrs.height ?? null) as number | null,
      rowHeightB: (i: number): number | null => (rowsOf(edB!)[i]?.node.attrs.height ?? null) as number | null,
      // Bounding rect of the Nth row's <tr> on peer A (for computing the bottom-edge grab point).
      rowRectA: (i: number): { left: number; top: number; width: number; height: number } | null => {
        const row = rowsOf(edA!)[i]
        if (!row) return null
        const dom = edA!.view.nodeDOM(row.pos)
        if (!(dom instanceof HTMLElement)) return null
        const r = dom.getBoundingClientRect()
        return { left: r.left, top: r.top, width: r.width, height: r.height }
      },
      // Bounding rect of the visible row-resize handle (null when hidden).
      handleRect: (): { left: number; top: number; width: number; height: number } | null => {
        const el = document.querySelector('.octo-table-row-resize') as HTMLElement | null
        if (!el || el.style.display === 'none') return null
        const r = el.getBoundingClientRect()
        return { left: r.left, top: r.top, width: r.width, height: r.height }
      },
      // First-cell text of the Nth row on peer A (to identify which row a height landed on).
      rowTextA: (i: number): string | null => rowsOf(edA!)[i]?.node.textContent ?? null,
      // Number of rows in peer A's first table.
      rowCountA: (): number => rowsOf(edA!).length,
      // Concurrent REMOTE structural edit: peer B inserts a fresh row above its first row. Used mid-drag
      // by the driver to reproduce the #823 RC race (a remote insert that shifts the dragged row while
      // A holds the drag). It bridges to A exactly like a real collaborator's edit.
      insertRowTopB: (): void => {
        if (!edB) return
        const table = firstTable(edB)
        if (!table) return
        const map = TableMap.get(table.node)
        const $inside = edB.state.doc.resolve(table.pos + 1 + map.map[0] + 1)
        edB.view.dispatch(edB.state.tr.setSelection(TextSelection.near($inside)))
        addRowBefore(edB.state, edB.view.dispatch)
      },
    }
    ;(window as unknown as { __rowHeightHarness: typeof harness }).__rowHeightHarness = harness

    return () => {
      offA?.()
      offB?.()
      edA?.destroy()
      edB?.destroy()
    }
  }, [])

  return (
    <div style={{ display: 'flex', gap: 8, height: '100vh', padding: 40, boxSizing: 'border-box', font: '14px system-ui' }}>
      <div style={{ flex: 1, position: 'relative', padding: '24px', overflow: 'auto', border: '2px solid #2f9e44' }}>
        <div style={{ position: 'absolute', top: 4, left: 8, color: '#2f9e44' }}>A (drag here)</div>
        <div ref={refA} style={{ position: 'relative' }} />
      </div>
      <div style={{ flex: 1, position: 'relative', padding: '24px', overflow: 'auto', border: '2px solid #1971c2' }}>
        <div style={{ position: 'absolute', top: 4, left: 8, color: '#1971c2' }}>B (remote collaborator)</div>
        <div ref={refB} style={{ position: 'relative' }} />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
