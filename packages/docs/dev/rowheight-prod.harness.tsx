// PROD-faithful row-height repro: same editor wiring as production extensions.ts (TableCellView
// node views, real editor/styles.css, wrapped in .octo-theme .octo-prose with table-layout:fixed),
// so we exercise the exact CSS the boss hit on :3000 — not the minimal harness CSS. Single peer is
// enough to observe the shrink rendering; window.__rowHeightHarness mirrors the other harness's seams.
import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { Table } from '@tiptap/extension-table'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TableRowHeight, TableRowResize } from '../src/editor/TableRowHeight.ts'
import { TableCellView } from '../src/editor/TableCellView.ts'
import '../src/editor/styles.css'

const FIELD = 'default'

function makeEditor(ydoc: Y.Doc, element: HTMLElement): Editor {
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document: ydoc, field: FIELD }),
      Table.configure({ resizable: true, handleWidth: 12, cellMinWidth: 25 }),
      TableRowHeight,
      TableHeader.extend({ addNodeView() { return ({ node }: { node: PMNode }) => new TableCellView(node, 'th') } }),
      TableCell.extend({ addNodeView() { return ({ node }: { node: PMNode }) => new TableCellView(node, 'td') } }),
      TableRowResize,
    ],
  })
}

function rowsOf(editor: Editor): { pos: number; node: PMNode }[] {
  const rows: { pos: number; node: PMNode }[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableRow') rows.push({ pos, node })
    return true
  })
  return rows
}

const DOC =
  '<p>row-height prod repro — drag the line under row 1</p>' +
  '<table><tbody>' +
  '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
  '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
  '</tbody></table>'

function Harness(): React.ReactElement {
  const refA = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!refA.current) return
    let edA: Editor | null = null
    const mountWith = (doc: string) => {
      edA?.destroy()
      refA.current!.innerHTML = ''
      const docA = new Y.Doc()
      edA = makeEditor(docA, refA.current!)
      edA.commands.insertContent(doc)
    }
    const mount = () => mountWith(DOC)
    // A doc whose row 0 is naturally TALL (several lines of content), to exercise shrinking a row
    // BELOW its content-driven height — the "height acts as min-height, content 顶住" scenario.
    const mountTall = () =>
      mountWith(
        '<p>tall-row repro</p>' +
          '<table><tbody>' +
          '<tr><td><p>line one</p><p>line two</p><p>line three</p><p>line four</p></td><td><p>c2</p></td></tr>' +
          '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
          '</tbody></table>',
      )
    const harness = {
      mount,
      mountTall,
      rowHeightA: (i: number): number | null => (rowsOf(edA!)[i]?.node.attrs.height ?? null) as number | null,
      rowRectA: (i: number) => {
        const row = rowsOf(edA!)[i]
        if (!row) return null
        const dom = edA!.view.nodeDOM(row.pos)
        if (!(dom instanceof HTMLElement)) return null
        const r = dom.getBoundingClientRect()
        return { left: r.left, top: r.top, width: r.width, height: r.height }
      },
      handleRect: () => {
        const el = document.querySelector('.octo-table-row-resize') as HTMLElement | null
        if (!el || el.style.display === 'none') return null
        const r = el.getBoundingClientRect()
        return { left: r.left, top: r.top, width: r.width, height: r.height }
      },
    }
    ;(window as unknown as { __rowHeightHarness: typeof harness }).__rowHeightHarness = harness
    return () => { edA?.destroy() }
  }, [])

  return (
    <div className="octo-theme" style={{ padding: 40, height: '100vh', boxSizing: 'border-box' }}>
      <div className="octo-prose" ref={refA} style={{ position: 'relative' }} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
