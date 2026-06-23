// Image node (SCHEMA-SPEC §2 / SCHEMA_VERSION 2; frontend-design §3.5).
//
// Extends @tiptap/extension-image (pinned 2.27.2) ONLY to keep a single Tiptap core
// instance (§2.2). The stock extension declares just src/alt/title; we override the
// full attribute set and the parse/render mapping so the node is BYTE-ALIGNED to the
// backend `image` node (the authoritative spec). The backend mapping is:
//
//   attrs (camelCase): attachId, src, alt, title, width, align  (all default null)
//   parseDOM tag:      'img[src], img[data-attach-id]'
//   parseDOM getAttrs: attachId <- data-attach-id, src <- src, alt <- alt,
//                      title <- title, width <- width, align <- data-align
//   toDOM:             <img>, setting each attribute ONLY when its value != null:
//                      data-attach-id <- attachId, src <- src, alt <- alt,
//                      title <- title, width <- width, data-align <- align
//
// Any drift here loses content when the backend Agent layer round-trips the doc.
// Base64 is never stored: only the durable attachId and a controlled storage URL.
// Pasted/dropped image files are intercepted and routed through the upload flow,
// and a data: <img> in pasted HTML is stripped before it can reach the schema.

import Image from '@tiptap/extension-image'
import { mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { ImageNodeView } from './ImageNodeView.ts'
import { collectImageFiles, uploadAndInsertImage } from './imageUpload.ts'
import { sanitizeAssetUrl } from './sanitize.ts'

export interface OctoImageOptions {
  /** Doc id used for the presign/read REST paths (threaded via buildExtensions). */
  docId: string
  /**
   * Whether to register the paste/drop upload plugin. Default true (live editor).
   * Read-only previews (version history) set this false: a static preview must not
   * carry upload side-effects even though editable:false already blocks input.
   */
  uploads: boolean
}

/** Strip `data:` <img> from pasted HTML so base64 can never be parsed into the doc. */
function stripDataImages(html: string): string {
  if (typeof document === 'undefined' || !html.includes('data:')) return html
  try {
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    parsed.querySelectorAll('img[src^="data:"]').forEach((el) => el.remove())
    return parsed.body.innerHTML
  } catch {
    return html
  }
}

export const OctoImage = Image.extend<OctoImageOptions>({
  // Self-contained leaf: selected/dragged as a unit, no editable content inside.
  atom: true,
  draggable: true,

  addOptions() {
    return {
      ...this.parent?.(),
      docId: '',
      uploads: true,
    }
  },

  // Full attr set, each mapped to/from the exact HTML attribute the backend uses,
  // emitting the attribute ONLY when its value is non-null (the per-attribute
  // renderHTML returns {} for null, so renderHTML below omits it).
  addAttributes() {
    return {
      attachId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-attach-id'),
        renderHTML: (attrs) =>
          attrs.attachId == null ? {} : { 'data-attach-id': attrs.attachId },
      },
      src: {
        // The src whitelist MUST run at BOTH the schema parse boundary and the
        // render boundary — not only in the NodeView's display layer. sanitize.ts
        // states the whitelist has to run at parse AND render time or it can be
        // bypassed: a `data:` URL parsed in (remote collab content, setContent,
        // programmatic insert, direct load) would otherwise land base64 in the
        // Y.Doc (violates "base64 never enters the Y.Doc"), and an off-whitelist
        // host rendered out (getHTML / collab serialization) would leak an
        // unvetted external URL. sanitizeAssetUrl reduces an unsafe src to null,
        // which keeps the backend-aligned "emit src only when non-null" rule
        // intact (no drift): a sanitized-away src simply renders no `src` attr.
        default: null,
        parseHTML: (el) => sanitizeAssetUrl(el.getAttribute('src')),
        renderHTML: (attrs) => {
          const safe = sanitizeAssetUrl(attrs.src as string | null)
          return safe == null ? {} : { src: safe }
        },
      },
      alt: {
        default: null,
        parseHTML: (el) => el.getAttribute('alt'),
        renderHTML: (attrs) => (attrs.alt == null ? {} : { alt: attrs.alt }),
      },
      title: {
        default: null,
        parseHTML: (el) => el.getAttribute('title'),
        renderHTML: (attrs) => (attrs.title == null ? {} : { title: attrs.title }),
      },
      width: {
        default: null,
        parseHTML: (el) => el.getAttribute('width'),
        renderHTML: (attrs) => (attrs.width == null ? {} : { width: attrs.width }),
      },
      align: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-align'),
        renderHTML: (attrs) => (attrs.align == null ? {} : { 'data-align': attrs.align }),
      },
    }
  },

  parseHTML() {
    // Same matcher as the backend parseDOM: any <img> with a src OR a data-attach-id.
    return [{ tag: 'img[src], img[data-attach-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    // HTMLAttributes already carries only the non-null attributes, so this matches
    // the backend's "set each attribute only when its value != null" toDOM rule.
    return ['img', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    const docId = this.options.docId
    const editor = this.editor
    return ({ node, getPos }) => new ImageNodeView(node, docId, editor, getPos)
  },

  addProseMirrorPlugins() {
    const docId = this.options.docId
    const editor = this.editor
    // Read-only previews disable the upload plugin entirely (no paste/drop side-effects).
    if (!this.options.uploads) return []
    return [
      new Plugin({
        key: new PluginKey('octoImagePasteDrop'),
        props: {
          handlePaste: (_view, event) => {
            const files = collectImageFiles(event.clipboardData)
            if (files.length === 0) return false
            event.preventDefault()
            for (const file of files) void uploadAndInsertImage(editor, file, { docId })
            return true
          },
          handleDrop: (view: EditorView, event) => {
            const files = collectImageFiles((event as DragEvent).dataTransfer)
            if (files.length === 0) return false
            event.preventDefault()
            // Resolve the drop point so the node lands where it was dropped.
            const at = view.posAtCoords({
              left: (event as DragEvent).clientX,
              top: (event as DragEvent).clientY,
            })
            for (const file of files) {
              void uploadAndInsertImage(editor, file, { docId, at: at?.pos })
            }
            return true
          },
          // Defensive: drop any base64 <img> from pasted HTML before PM parses it.
          transformPastedHTML: (html) => stripDataImages(html),
        },
      }),
    ]
  },
})
