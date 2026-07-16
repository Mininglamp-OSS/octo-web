// PROD-faithful READ-ONLY PREVIEW row-height clip repro (SCHEMA_VERSION 19, XIN-1261). Companion to
// rowheight-prod.harness.tsx (the EDITABLE editor). The #823 CR point: a SHRUNK row (explicit height
// below its content height) rendered fine in the editor but BOUNCED BACK to content height in the
// read-only preview / version diff, because buildPreviewExtensions used to register only the height
// ATTR (a CSS minimum) — no clip decoration, no `.octo-cell-clip` wrapper. This harness mounts the
// EXACT production preview extension set (buildPreviewExtensions, editable:false), wrapped in the same
// `.octo-prose` VersionPreview uses, with the real styles.css, so the browser exercises the same CSS the
// version panel hits. window.__previewHarness exposes the seams the runner drives.
import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { buildPreviewExtensions } from '../src/editor/extensions.ts'
import '../src/editor/styles.css'

function makePreview(element: HTMLElement, content: string): Editor {
  return new Editor({
    element,
    editable: false, // read-only preview / version diff — exactly like VersionPreview.
    extensions: buildPreviewExtensions('doc-preview-test'),
    content,
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

// Row 0 is naturally TALL (four lines of content) so a 30px explicit height is well BELOW its content
// height — the exact "height acts as min-height, content 顶住" scenario, now in the read-only preview.
const TALL_CELL = '<td><p>line one</p><p>line two</p><p>line three</p><p>line four</p></td><td><p>c2</p></td>'
const SHRUNK_DOC =
  '<p>read-only preview — row 1 has an explicit height:30px below its content height</p>' +
  '<table><tbody>' +
  `<tr style="height:30px">${TALL_CELL}</tr>` +
  '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
  '</tbody></table>'
// Same table but row 0 carries NO explicit height — its natural content-driven height, the control that
// proves the shrunk render is a real clip (not a coincidence of small content).
const NATURAL_DOC =
  '<p>read-only preview — row 1 has NO explicit height (content-driven)</p>' +
  '<table><tbody>' +
  `<tr>${TALL_CELL}</tr>` +
  '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
  '</tbody></table>'

function Harness(): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    let ed: Editor | null = null
    const mountWith = (doc: string) => {
      ed?.destroy()
      ref.current!.innerHTML = ''
      ed = makePreview(ref.current!, doc)
    }
    const harness = {
      mountShrunk: () => mountWith(SHRUNK_DOC),
      mountNatural: () => mountWith(NATURAL_DOC),
      rowModelHeight: (i: number): number | null => (rowsOf(ed!)[i]?.node.attrs.height ?? null) as number | null,
      rowRect: (i: number) => {
        const row = rowsOf(ed!)[i]
        if (!row) return null
        const dom = ed!.view.nodeDOM(row.pos)
        if (!(dom instanceof HTMLElement)) return null
        const r = dom.getBoundingClientRect()
        return { top: r.top, height: r.height }
      },
      // Structural seams: does the row carry the clip class, and does the cell have the clip wrapper?
      rowHasFixedClass: (i: number): boolean => {
        const row = rowsOf(ed!)[i]
        if (!row) return false
        const dom = ed!.view.nodeDOM(row.pos)
        return dom instanceof HTMLElement && dom.classList.contains('octo-row-fixed')
      },
      cellClipCount: (): number => document.querySelectorAll('.octo-prose table td .octo-cell-clip, .octo-prose table th .octo-cell-clip').length,
    }
    ;(window as unknown as { __previewHarness: typeof harness }).__previewHarness = harness
    return () => {
      ed?.destroy()
    }
  }, [])

  return (
    <div className="octo-theme" style={{ padding: 40, height: '100vh', boxSizing: 'border-box' }}>
      <div className="octo-prose" ref={ref} style={{ position: 'relative' }} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
