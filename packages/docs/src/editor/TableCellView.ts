// Self-built table cell NodeView (frontend-design §3.2 / SCHEMA-SPEC §4).
//
// @tiptap/extension-table ships column resizing + a default cell view, but under
// collaboration the cell DOM is touched by the resize plugin and by remote updates
// at the same time. This NodeView gives ProseMirror explicit ignoreMutation /
// stopEvent rules so:
//   - attribute/childList mutations the resize plugin makes to the cell's own
//     <td>/<th> (e.g. colwidth → inline width) are ignored by PM's mutation
//     observer instead of being parsed back as content edits (which would fight
//     remote cursors / cause desync);
//   - the editor still owns selection and content inside the cell.
//
// It renders a plain <td>/<th> with a content hole, mirroring the schema's
// toDOM, so it stays byte-compatible with the backend stub.

import type { Node as PMNode } from '@tiptap/pm/model'

export class TableCellView {
  dom: HTMLTableCellElement
  contentDOM: HTMLElement

  constructor(node: PMNode, tag: 'td' | 'th') {
    const cell = document.createElement(tag)
    this.applyAttrs(cell, node)
    this.dom = cell
    this.contentDOM = cell
  }

  private applyAttrs(cell: HTMLTableCellElement, node: PMNode) {
    const { colspan, rowspan, colwidth } = node.attrs as {
      colspan?: number
      rowspan?: number
      colwidth?: number[] | null
    }
    if (colspan && colspan !== 1) cell.setAttribute('colspan', String(colspan))
    else cell.removeAttribute('colspan')
    if (rowspan && rowspan !== 1) cell.setAttribute('rowspan', String(rowspan))
    else cell.removeAttribute('rowspan')
    if (colwidth && colwidth.length) {
      cell.setAttribute('data-colwidth', colwidth.join(','))
      const total = colwidth.reduce((a, b) => a + (b || 0), 0)
      if (total > 0) cell.style.width = `${total}px`
    } else {
      cell.removeAttribute('data-colwidth')
      cell.style.width = ''
    }
  }

  /** Re-apply cell attributes on node update without recreating the DOM (keeps
   * the content hole and any in-flight remote selection stable). */
  update(node: PMNode): boolean {
    if (node.type.name !== 'tableCell' && node.type.name !== 'tableHeader') return false
    this.applyAttrs(this.dom, node)
    return true
  }

  /** Ignore mutations to the cell element's own attributes/style (the resize
   * plugin and update() write width/colspan here) and to non-content subtrees,
   * so PM's mutation observer does not re-parse them as document edits. PM still
   * sees real content mutations inside contentDOM. The argument is ProseMirror's
   * ViewMutationRecord (a DOM MutationRecord or a {type:'selection'} marker). */
  ignoreMutation(mutation: { type: string; target: Node }): boolean {
    if (mutation.type === 'selection') return false
    if (mutation.type === 'attributes') {
      return mutation.target === this.dom
    }
    // Let ProseMirror handle character/content mutations inside the cell.
    return false
  }

  /** Let every event flow to ProseMirror. In particular the column-resize-handle
   * mousedown MUST reach prosemirror-tables' columnResizing plugin
   * (handleDOMEvents.mousedown) — stopping it here short-circuits eventBelongsToView
   * so the drag never starts (the handle shows on hover but the column can't be
   * dragged). Content mutations that resizing makes to the cell are already handled
   * by ignoreMutation above, so nothing needs to be suppressed at the event level. */
  stopEvent(): boolean {
    return false
  }
}
