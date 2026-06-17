// Self-built block drag handle (frontend-design §3.2 — "self-built or evaluated";
// no Tiptap Pro / paid extension). A ProseMirror plugin renders a small handle to
// the left of the top-level block under the pointer; dragging it reorders blocks.
//
// Collaboration-safe by design: the drag uses ProseMirror's native drag/drop
// pipeline (view.dragging + a NodeSelection slice), so the move lands as ordinary
// editor transactions that y-prosemirror syncs like any other edit. We never mutate
// the doc imperatively or bypass the transaction system, and the handle widget is a
// plugin-managed DOM element outside the document, so it can't desync remote content.
//
// ignoreMutation / stopEvent: the handle lives in a decoration widget; its events are
// stopped from reaching ProseMirror except the dragstart we explicitly drive, so the
// editor's own mutation observer never sees the handle as document content.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

export const dragHandlePluginKey = new PluginKey('octoBlockDragHandle')

/** Resolve the document position of the top-level block whose rendered box contains
 * the given client coordinates. Returns null when the point is outside any block. */
export function topLevelBlockPosAt(view: EditorView, clientX: number, clientY: number): number | null {
  const coords = { left: clientX, top: clientY }
  const found = view.posAtCoords(coords)
  if (!found) return null
  // Resolve the precise position and climb to the depth-1 ancestor (a direct child
  // of the doc), returning that block's start position.
  const $pos = view.state.doc.resolve(found.pos)
  if ($pos.depth < 1) return null
  return $pos.before(1)
}

function createHandle(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'octo-drag-handle'
  el.setAttribute('draggable', 'true')
  el.setAttribute('contenteditable', 'false')
  el.setAttribute('aria-label', 'Drag to move block')
  el.textContent = '⠿'
  return el
}

/** Block drag-handle extension. */
export const BlockDragHandle = Extension.create({
  name: 'blockDragHandle',

  addProseMirrorPlugins() {
    let handle: HTMLElement | null = null
    let hoveredPos: number | null = null

    const showHandleFor = (view: EditorView, pos: number) => {
      if (!handle) return
      const node = view.state.doc.nodeAt(pos)
      if (!node) {
        handle.style.display = 'none'
        return
      }
      const dom = view.nodeDOM(pos) as HTMLElement | null
      if (!dom || !(dom instanceof HTMLElement)) {
        handle.style.display = 'none'
        return
      }
      const editorRect = (view.dom as HTMLElement).getBoundingClientRect()
      const blockRect = dom.getBoundingClientRect()
      handle.style.display = 'flex'
      handle.style.top = `${blockRect.top - editorRect.top}px`
      handle.style.left = `${blockRect.left - editorRect.left - 24}px`
      hoveredPos = pos
    }

    return [
      new Plugin({
        key: dragHandlePluginKey,
        view(view) {
          const wrapper = view.dom.parentElement
          handle = createHandle()
          handle.style.display = 'none'
          if (wrapper) {
            // The editor region is positioned; the handle is absolutely placed
            // relative to it and is NOT part of the document.
            handle.style.position = 'absolute'
            wrapper.appendChild(handle)
          }

          const onDragStart = (event: DragEvent) => {
            if (hoveredPos == null) return
            const node = view.state.doc.nodeAt(hoveredPos)
            if (!node) return
            // Select the whole block, then hand the slice to ProseMirror's native
            // drag pipeline so the default drop logic reorders it as a transaction.
            const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, hoveredPos))
            view.dispatch(tr)
            const slice = view.state.selection.content()
            view.dragging = { slice, move: true }
            if (event.dataTransfer) {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/html', '')
              const dom = view.nodeDOM(hoveredPos)
              if (dom instanceof HTMLElement) event.dataTransfer.setDragImage(dom, 0, 0)
            }
          }
          handle.addEventListener('dragstart', onDragStart)

          return {
            destroy() {
              handle?.removeEventListener('dragstart', onDragStart)
              handle?.remove()
              handle = null
            },
          }
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              const pos = topLevelBlockPosAt(view, event.clientX, event.clientY)
              if (pos == null) {
                if (handle) handle.style.display = 'none'
                hoveredPos = null
                return false
              }
              showHandleFor(view, pos)
              return false
            },
            mouseleave() {
              if (handle) handle.style.display = 'none'
              hoveredPos = null
              return false
            },
          },
        },
      }),
    ]
  },
})
