// File-attachment node (SCHEMA-SPEC §15 / SCHEMA_VERSION 14; frontend-design §3.5).
//
// No official Tiptap extension exists, so this is a self-built BLOCK ATOM node modelled on
// the image node: a leaf rendered as a file card (icon + name + human size + download). The
// node is BYTE-ALIGNED to the backend `fileAttachment` node — the attr set is EXACTLY
// { attachId, fileName, mime, sizeBytes } (the PM-frozen contract), each riding on a `data-*`
// attribute so it round-trips through the Y.Doc and re-parses faithfully in the read-only
// preview:
//
//   attachId  ↔ data-attach-id
//   fileName  ↔ data-file-name
//   mime      ↔ data-mime
//   sizeBytes ↔ data-size-bytes   (serialized as a decimal string, parsed back to a number)
//
// Each attribute is emitted ONLY when its value is non-null (mirrors the image node's
// "emit only when != null" rule). Upload reuses the existing presign flow (attachments/api.ts);
// download reuses the same signed read-URL path images use — base64 never enters the Y.Doc.

import { Node, mergeAttributes } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { FileAttachmentNodeView } from './FileAttachmentNodeView.ts'

export interface FileAttachmentAttrs {
  attachId: string | null
  fileName: string | null
  mime: string | null
  sizeBytes: number | null
}

export interface FileAttachmentOptions {
  /** Doc id used for the presign/read REST paths (threaded via buildExtensions). */
  docId: string
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fileAttachment: {
      /** Insert a file-attachment card from an already-uploaded attachment. */
      setFileAttachment: (attrs: Partial<FileAttachmentAttrs>) => ReturnType
    }
  }
}

/**
 * Human-readable byte size (e.g. 1536 → "1.5 KB", 3 → "3 B"). Returns '' for a null /
 * negative / non-finite size so the card simply omits the size chip. Sub-1024 stays in
 * bytes; thereafter steps through KB/MB/GB/TB with one decimal under 10 and rounded above.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value)
  return `${rounded} ${units[i]}`
}

export const FileAttachment = Node.create<FileAttachmentOptions>({
  name: 'fileAttachment',
  group: 'block',
  // Self-contained leaf: selected/dragged as a unit, no editable content inside.
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { docId: '' }
  },

  addAttributes() {
    return {
      attachId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-attach-id'),
        renderHTML: (attrs) =>
          attrs.attachId == null ? {} : { 'data-attach-id': attrs.attachId },
      },
      fileName: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-file-name'),
        renderHTML: (attrs) =>
          attrs.fileName == null ? {} : { 'data-file-name': attrs.fileName },
      },
      mime: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-mime'),
        renderHTML: (attrs) => (attrs.mime == null ? {} : { 'data-mime': attrs.mime }),
      },
      sizeBytes: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute('data-size-bytes')
          if (raw == null || raw === '') return null
          const n = Number(raw)
          return Number.isFinite(n) ? n : null
        },
        renderHTML: (attrs) =>
          attrs.sizeBytes == null ? {} : { 'data-size-bytes': String(attrs.sizeBytes) },
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-file-attachment]' }]
  },

  renderHTML({ HTMLAttributes }) {
    // HTMLAttributes already carries only the non-null attrs (each per-attribute renderHTML
    // returns {} for null), matching the backend "set each attribute only when != null" rule.
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-file-attachment': '', class: 'octo-file-attachment' }),
    ]
  },

  addNodeView() {
    const docId = this.options.docId
    const editor = this.editor
    return ({ node, getPos }) => new FileAttachmentNodeView(node, docId, editor, getPos)
  },

  addCommands() {
    return {
      setFileAttachment:
        (attrs) =>
        ({ state, commands }) => {
          // When the current selection is a NodeSelection — a block atom such as a just-
          // uploaded image, which stays selected after insertion — a plain insertContent
          // REPLACES that node, so inserting a file would delete the selected image
          // (XIN-144). Insert the card immediately AFTER the selected node instead, so the
          // image is preserved. A normal text cursor / range still inserts at the selection.
          const { selection } = state
          if (selection instanceof NodeSelection) {
            return commands.insertContentAt(selection.to, { type: this.name, attrs })
          }
          return commands.insertContent({ type: this.name, attrs })
        },
    }
  },
})
