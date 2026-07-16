// Real-browser COEXISTENCE gate for the table reorder handle (octo-docs-backend#76 / XIN-1253).
//
// The reorder handle was reported hidden (display:none / 0x0) and un-grabbable on the real :3000
// build once it shipped in the SAME build as the row-height resize handle (#823). Root cause: both
// controls are absolutely-positioned SIBLINGS of the ProseMirror DOM inside the editor wrapper and
// sit ON TOP of the table cells; when the pointer moved onto the row-resize bar straddling a row's
// bottom edge, the editor's `mouseleave` fired and the reorder plugin hid its handles, then never
// saw the moves to bring them back. The standalone build (this file's predecessor dev/reorder.harness)
// had no such overlay, so review passed while real use failed.
//
// This harness reproduces the hazard WITHOUT depending on #823's code: a minimal stand-in plugin
// (`overlayStandIn`) renders exactly the kind of sibling overlay #823 adds — a full-width, z-index 5
// bar pinned to the hovered row's bottom edge, outside the editor DOM — so the gate exercises the
// generic "sibling overlay steals the pointer" condition the fix must survive. Real editor/styles.css
// is loaded so the reorder handle's real CSS applies. window.__coexistHarness exposes the driver seams.

import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { TableMap } from '@tiptap/pm/tables'
import type { Node as PMNode } from '@tiptap/pm/model'
import { setWKApp } from '../src/octoweb/index.ts'
import { createMockWKApp } from '../src/octoweb/mock.ts'
import { TableReorderHandle } from '../src/editor/TableReorderHandle.ts'
import '../src/editor/styles.css'

setWKApp(createMockWKApp({ uid: 'u_coexist', token: 'dev' }))

const BAND = 12

// Minimal stand-in for #823's row-height resize overlay: a full-table-width bar on the hovered row's
// bottom edge, an absolutely-positioned sibling of the ProseMirror DOM (z-index 5, on top of cells).
// It reproduces the ONLY property that matters for XIN-1253 — a sibling overlay the pointer can land
// on, which makes the editor fire mouseleave — without pulling in the real (separate-branch) plugin.
const overlayStandIn = Extension.create({
  name: 'rowResizeOverlayStandIn',
  addProseMirrorPlugins() {
    let bar: HTMLElement | null = null
    return [
      new Plugin({
        view(view) {
          const wrapper = view.dom.parentElement
          bar = document.createElement('div')
          bar.className = 'octo-row-resize-standin'
          bar.style.position = 'absolute'
          bar.style.display = 'none'
          bar.style.zIndex = '5'
          bar.style.background = 'transparent'
          if (wrapper) wrapper.appendChild(bar)
          return {
            destroy() {
              bar?.remove()
              bar = null
            },
          }
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              if (!bar) return false
              const found = view.posAtCoords({ left: event.clientX, top: event.clientY })
              if (!found) {
                bar.style.display = 'none'
                return false
              }
              const $pos = view.state.doc.resolve(found.pos)
              let rowDom: HTMLElement | null = null
              let tableDom: HTMLElement | null = null
              for (let d = $pos.depth; d > 0; d--) {
                if ($pos.node(d).type.name === 'tableRow') {
                  const dom = view.nodeDOM($pos.before(d))
                  if (dom instanceof HTMLElement) {
                    rowDom = dom
                    tableDom = dom.closest('table')
                  }
                  break
                }
              }
              if (!rowDom || !tableDom) {
                bar.style.display = 'none'
                return false
              }
              const base = (view.dom as HTMLElement).getBoundingClientRect()
              const row = rowDom.getBoundingClientRect()
              const table = tableDom.getBoundingClientRect()
              if (Math.abs(event.clientY - row.bottom) > BAND) {
                bar.style.display = 'none'
                return false
              }
              bar.style.display = 'block'
              bar.style.left = `${table.left - base.left}px`
              bar.style.top = `${row.bottom - base.top - BAND / 2}px`
              bar.style.width = `${table.width}px`
              bar.style.height = `${BAND}px`
              return false
            },
          },
        },
      }),
    ]
  },
})

const DOC =
  '<p>heading paragraph</p>' +
  '<table><tbody>' +
  '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td><td><p>r1c3</p></td></tr>' +
  '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td><td><p>r2c3</p></td></tr>' +
  '<tr><td><p>r3c1</p></td><td><p>r3c2</p></td><td><p>r3c3</p></td></tr>' +
  '</tbody></table>' +
  '<p>trailing paragraph</p>'

function makeEditor(element: HTMLElement): Editor {
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Table.configure({ resizable: true, handleWidth: 12, cellMinWidth: 25 }),
      TableRow,
      TableHeader,
      TableCell,
      TableReorderHandle,
      overlayStandIn, // registered AFTER the reorder handle, like #823's TableRowResize in the merged build
    ],
    content: DOC,
  })
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

function Harness(): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    let ed: Editor | null = null
    const mount = () => {
      ed?.destroy()
      ref.current!.innerHTML = ''
      ed = makeEditor(ref.current!)
    }
    mount()

    const harness = {
      reset: () => mount(),
      gridA: (): string[][] => {
        const { node } = firstTable(ed!)
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
      },
      cellRectA: (row: number, col: number) => {
        const { node, pos } = firstTable(ed!)
        const map = TableMap.get(node)
        const cellPos = pos + 1 + map.map[row * map.width + col]
        const dom = ed!.view.nodeDOM(cellPos)
        if (!(dom instanceof HTMLElement)) return null
        const r = dom.getBoundingClientRect()
        return { left: r.left, top: r.top, width: r.width, height: r.height }
      },
      handleRect: (kind: 'row' | 'col') => {
        const el = document.querySelector(`.octo-table-reorder--${kind}`) as HTMLElement | null
        if (!el || el.style.display === 'none') return null
        const r = el.getBoundingClientRect()
        return { left: r.left, top: r.top, width: r.width, height: r.height }
      },
    }
    ;(window as unknown as { __coexistHarness: typeof harness }).__coexistHarness = harness

    return () => {
      ed?.destroy()
    }
  }, [])

  // Real EditorShell DOM nesting so production CSS + a scroll container apply as they do live.
  return (
    <div className="octo-doc octo-doc--editor octo-theme" style={{ height: '100vh' }}>
      <div className="octo-doc-body">
        <div className="octo-doc-scroll">
          <div className="octo-editor-region">
            <div className="octo-editor-main">
              <div className="octo-prose" ref={ref} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
