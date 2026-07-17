// PROD-faithful repro for XIN-1322 (column-hover row jump). Same editor wiring as production
// extensions.ts (real Table.configure({ resizable, handleWidth, cellMinWidth }), TableCellView node
// views, real editor/styles.css, wrapped in .octo-theme .octo-prose), so the browser exercises the
// exact CSS the tester hit. The defect: hovering a column's RIGHT border arms prosemirror-tables'
// columnResizing, which mounts a `.column-resize-handle` (also `.ProseMirror-widget`) DIV at the END
// of the cell's `.octo-cell-clip` content hole. A bare `:last-child` margin-zero rule then loses the
// trailing <p>, whose `margin-bottom` (1em) springs back and pushes every row ~15px taller until the
// pointer leaves the border. window.__colHoverHarness exposes the seams the runner drives.
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
      // Exact production table config (extensions.ts:242) — resizable columns with the #749 grab band.
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

// Two content-driven rows (NO explicit height → no clip; height is pure content), two columns each.
// Each cell holds two paragraphs, so the trailing <p> is unambiguous and its margin-bottom is the
// thing under test. Mixed-content cell in col 2 (a <p> then a <ul>) guards the `:last-of-type`
// over-match trap: the nth-child(of :not(widget)) rule must zero only the true trailing block.
const DOC =
  '<p>column-hover repro — hover the border between the two columns of row 1</p>' +
  '<table><tbody>' +
  '<tr>' +
  '<td><p>r1c1 line a</p><p>r1c1 line b</p></td>' +
  '<td><p>r1c2 line a</p><ul><li><p>r1c2 bullet</p></li></ul></td>' +
  '</tr>' +
  '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
  '</tbody></table>'

function Harness(): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    let ed: Editor | null = null
    const mount = () => {
      ed?.destroy()
      ref.current!.innerHTML = ''
      const ydoc = new Y.Doc()
      ed = makeEditor(ydoc, ref.current!)
      ed.commands.insertContent(DOC)
    }
    const firstCellDOM = (): HTMLElement | null => {
      const row = rowsOf(ed!)[0]
      if (!row) return null
      const dom = ed!.view.nodeDOM(row.pos)
      if (!(dom instanceof HTMLElement)) return null
      return dom.querySelector('td') as HTMLElement | null
    }
    const harness = {
      mount,
      rowRect: (i: number) => {
        const row = rowsOf(ed!)[i]
        if (!row) return null
        const dom = ed!.view.nodeDOM(row.pos)
        if (!(dom instanceof HTMLElement)) return null
        const r = dom.getBoundingClientRect()
        return { top: r.top, height: r.height }
      },
      // The x of the border between column 1 and column 2 (right edge of row-1's first cell), and a y
      // safely inside that row — where the runner parks the pointer to arm columnResizing.
      colBorderPoint: () => {
        const cell = firstCellDOM()
        if (!cell) return null
        const r = cell.getBoundingClientRect()
        return { x: r.right, y: r.top + r.height / 2 }
      },
      // Is the columnResizing widget currently mounted? (the render transient's trigger)
      hasResizeHandle: (): boolean => !!document.querySelector('.octo-prose .column-resize-handle'),
      // Diagnostic: computed margin-bottom of the LAST real <p> in row-1's first cell — the value the
      // rule protects. Stays ~0 with the fix even while a widget is mounted after it.
      lastParaMarginBottom: (): number | null => {
        const cell = firstCellDOM()
        if (!cell) return null
        const clip = cell.querySelector('.octo-cell-clip')
        if (!clip) return null
        const paras = clip.querySelectorAll(':scope > p')
        const last = paras[paras.length - 1] as HTMLElement | undefined
        if (!last) return null
        return parseFloat(getComputedStyle(last).marginBottom)
      },
    }
    ;(window as unknown as { __colHoverHarness: typeof harness }).__colHoverHarness = harness
    return () => { ed?.destroy() }
  }, [])

  return (
    <div className="octo-theme" style={{ padding: 40, height: '100vh', boxSizing: 'border-box' }}>
      <div className="octo-prose" ref={ref} style={{ position: 'relative' }} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
