// Real-browser two-peer harness for the table row/column reorder concurrency guard
// (octo-docs-backend#76 / XIN-1225). Companion to dev/presence.harness.tsx.
//
// WHY a real browser: the reorder is DOM/pointer driven and the concurrency guard runs inside the
// ProseMirror plugin's `state.apply` on every transaction that lands during a drag. jsdom unit tests
// call the guard's pure functions directly and stayed green, yet real-browser TC01 (a collaborator
// edits prose OUTSIDE the dragged table) and TC02 (a collaborator edits an identical SECOND table)
// STILL false-aborted the reorder. Only a real drag (real mouse buttons) with a genuine concurrent
// transaction arriving mid-drag reproduces that, which is exactly what the strong verification gate
// on XIN-1225 requires.
//
// The harness mounts TWO real collaborative editors (A = the peer the user drags on, B = the remote
// collaborator) bound to two Y.Docs bridged the way HocuspocusProvider relays updates over the wire:
// every local Y update is applied to the other doc as a remote update, so B's edit reaches A as a
// real remote transaction while A holds a drag. `window.__reorderHarness` exposes the seams the
// Playwright driver (dev/run-reorder.mjs) needs; `window.__reorderAbortDebug` (armed by the driver)
// captures the guard's per-transaction decision. Dev-only.

import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { TableMap, moveTableRow } from '@tiptap/pm/tables'
import { TextSelection } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { setWKApp } from '../src/octoweb/index.ts'
import { createMockWKApp } from '../src/octoweb/mock.ts'
import { TableReorderHandle } from '../src/editor/TableReorderHandle.ts'

// i18n / WKApp seam — the reorder-conflict toast calls t(); wire the mock so it resolves in dev.
setWKApp(createMockWKApp({ uid: 'u_reorder', token: 'dev' }))

const FIELD = 'default'

function makeEditor(ydoc: Y.Doc, element: HTMLElement): Editor {
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document: ydoc, field: FIELD }),
      Table.configure({ resizable: true, handleWidth: 12, cellMinWidth: 25 }),
      TableRow,
      TableHeader,
      TableCell,
      TableReorderHandle,
    ],
  })
}

/** Relay every local Y update from `from` into `to`, tagged so it is not echoed back — the same
 *  incremental relay HocuspocusProvider performs over the WS. */
function bridge(from: Y.Doc, to: Y.Doc, tag: string): () => void {
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === 'bridge') return
    Y.applyUpdate(to, update, 'bridge')
  }
  void tag
  from.on('update', onUpdate)
  return () => from.off('update', onUpdate)
}

function firstTable(editor: Editor): { node: PMNode; pos: number } {
  let node: PMNode | null = null
  let pos = -1
  editor.state.doc.descendants((n, p) => {
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

function nthTable(editor: Editor, n: number): { node: PMNode; pos: number } {
  const found: { node: PMNode; pos: number }[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'table') {
      found.push({ node, pos })
      return false
    }
    return true
  })
  if (!found[n]) throw new Error(`no table #${n}`)
  return found[n]
}

/** Cell text as a row × col grid from the first table. */
function gridOf(editor: Editor): string[][] {
  const { node } = firstTable(editor)
  const map = TableMap.get(node)
  const out: string[][] = []
  for (let r = 0; r < map.height; r++) {
    const row: string[] = []
    for (let c = 0; c < map.width; c++) {
      const cell = node.nodeAt(map.map[r * map.width + c])
      row.push(cell ? cell.textContent : '')
    }
    out.push(row)
  }
  return out
}

// Documents used by the scenarios. A single table with prose around it (TC01), and two byte-identical
// tables (TC02). Row labels rNcM so a reorder is observable in the grid.
const DOC_SINGLE =
  '<p>heading paragraph — edit me from the other peer</p>' +
  '<table><tbody>' +
  '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
  '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
  '<tr><td><p>r3c1</p></td><td><p>r3c2</p></td></tr>' +
  '</tbody></table>' +
  '<p>trailing paragraph</p>'

const DOC_TWINS =
  '<table><tbody>' +
  '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
  '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
  '<tr><td><p>r3c1</p></td><td><p>r3c2</p></td></tr>' +
  '</tbody></table>' +
  '<p>between the two identical tables</p>' +
  '<table><tbody>' +
  '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
  '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
  '<tr><td><p>r3c1</p></td><td><p>r3c2</p></td></tr>' +
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

    const mount = (html: string) => {
      offA?.()
      offB?.()
      edA?.destroy()
      edB?.destroy()
      refA.current!.innerHTML = ''
      refB.current!.innerHTML = ''
      const docA = new Y.Doc()
      const docB = new Y.Doc()
      edA = makeEditor(docA, refA.current!)
      // Seed on A via a real transaction so ySyncPlugin writes it into the Y.Doc, then fork B.
      edA.commands.insertContent(html)
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), 'bridge')
      edB = makeEditor(docB, refB.current!)
      offA = bridge(docA, docB, 'A→B')
      offB = bridge(docB, docA, 'B→A')
      return { edA, edB }
    }

    // Remote edit helpers run on peer B and propagate to A over the bridge as a real transaction.
    const remoteProseEdit = () => {
      // TC01: edit prose OUTSIDE any table (inside the leading paragraph, position 3).
      edB!.view.dispatch(edB!.state.tr.insertText('EDITED', 3))
    }
    const remoteSecondTableEdit = () => {
      // TC02: edit a cell of the SECOND (identical) table — never the dragged first table.
      const t1 = nthTable(edB!, 1)
      const m1 = TableMap.get(t1.node)
      const inside = t1.pos + 1 + m1.map[0] + 1
      edB!.view.dispatch(edB!.state.tr.insertText('X', inside))
    }
    const remoteReorderFirstTable = () => {
      // TC03: reorder the SAME (dragged) first table on the remote peer — a real structural conflict.
      const { node, pos } = firstTable(edB!)
      const map = TableMap.get(node)
      const $in = edB!.state.doc.resolve(pos + 1 + map.map[1 * map.width + 0] + 1)
      edB!.view.dispatch(edB!.state.tr.setSelection(TextSelection.near($in)))
      moveTableRow({ from: 1, to: 0 })(edB!.state, edB!.view.dispatch)
    }

    const harness = {
      mountSingle: () => {
        mount(DOC_SINGLE)
      },
      mountTwins: () => {
        mount(DOC_TWINS)
      },
      // TC08: a freshly-created document whose only content is a table (the "new document / table
      // context" path). No surrounding prose, table at document position 0.
      mountNewDoc: () => {
        mount(
          '<table><tbody>' +
            '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
            '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
            '<tr><td><p>r3c1</p></td><td><p>r3c2</p></td></tr>' +
            '</tbody></table>',
        )
      },
      gridA: () => gridOf(edA!),
      gridB: () => gridOf(edB!),
      remoteProseEdit,
      remoteSecondTableEdit,
      remoteReorderFirstTable,
      // Bounding rect of a cell in editor A (row,col), for the driver to hover/drag against.
      cellRectA: (row: number, col: number): { left: number; top: number; width: number; height: number } | null => {
        const { node, pos } = firstTable(edA!)
        const map = TableMap.get(node)
        const cellPos = pos + 1 + map.map[row * map.width + col]
        const dom = edA!.view.nodeDOM(cellPos)
        if (!(dom instanceof HTMLElement)) return null
        const r = dom.getBoundingClientRect()
        return { left: r.left, top: r.top, width: r.width, height: r.height }
      },
      // Bounding rect of the visible row/col reorder handle (null when hidden).
      handleRect: (kind: 'row' | 'col'): { left: number; top: number; width: number; height: number } | null => {
        const el = document.querySelector(`.octo-table-reorder--${kind}`) as HTMLElement | null
        if (!el || el.style.display === 'none') return null
        const r = el.getBoundingClientRect()
        return { left: r.left, top: r.top, width: r.width, height: r.height }
      },
    }
    ;(window as unknown as { __reorderHarness: typeof harness }).__reorderHarness = harness

    return () => {
      offA?.()
      offB?.()
      edA?.destroy()
      edB?.destroy()
    }
  }, [])

  return (
    <div style={{ display: 'flex', gap: 8, height: '100vh', padding: 40, boxSizing: 'border-box', font: '14px system-ui' }}>
      <div style={{ flex: 1, position: 'relative', padding: '48px 24px 24px 48px', overflow: 'auto', border: '2px solid #2f9e44' }}>
        <div style={{ position: 'absolute', top: 4, left: 8, color: '#2f9e44' }}>A (drag here)</div>
        <div ref={refA} style={{ position: 'relative' }} />
      </div>
      <div style={{ flex: 1, position: 'relative', padding: '48px 24px 24px 48px', overflow: 'auto', border: '2px solid #1971c2' }}>
        <div style={{ position: 'absolute', top: 4, left: 8, color: '#1971c2' }}>B (remote collaborator)</div>
        <div ref={refB} style={{ position: 'relative' }} />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
