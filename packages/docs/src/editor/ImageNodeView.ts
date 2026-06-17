// Self-built image NodeView (frontend-design §3.2 / §3.5, SCHEMA-SPEC §2).
//
// Like TableCellView, this NodeView gives ProseMirror explicit ignoreMutation /
// stopEvent rules so the async display-URL refresh and the loading/error swaps are
// treated as view-only DOM and never re-parsed as document edits — otherwise the
// mutation observer would fight remote cursors / desync collaboration (§3.2).
//
// The Y.Doc only ever holds the durable `attachId` plus a (possibly stale) signed
// `src`. Signed GET URLs expire, so whenever an attachId is present we re-resolve a
// fresh URL via the read endpoint at render time and refresh the <img> in place.
// All candidate URLs pass through sanitizeAssetUrl (scheme + storage-host whitelist,
// §3.7), so a `data:` / off-whitelist src is refused — base64 is never loaded.

import type { Node as PMNode } from '@tiptap/pm/model'
import { getReadUrl } from '../attachments/api.ts'
import { sanitizeAssetUrl } from './sanitize.ts'

export class ImageNodeView {
  dom: HTMLElement
  private readonly img: HTMLImageElement
  private readonly docId: string
  /** Tracks the attachId currently being resolved so a stale async result is dropped. */
  private attachId: string | null = null
  /** The attachId an in-flight read request is for (null when none is in flight). */
  private resolvingFor: string | null = null

  constructor(node: PMNode, docId: string) {
    this.docId = docId
    const wrap = document.createElement('div')
    wrap.className = 'octo-image'
    // Atom node: no editable content lives inside, so the wrapper is inert.
    wrap.setAttribute('contenteditable', 'false')
    const img = document.createElement('img')
    img.alt = ''
    wrap.appendChild(img)
    this.dom = wrap
    this.img = img
    this.render(node)
  }

  private applyLayout(node: PMNode): void {
    const { alt, title, width, align } = node.attrs as {
      alt: string | null
      title: string | null
      width: number | string | null
      align: string | null
    }
    if (alt != null) this.img.setAttribute('alt', String(alt))
    else this.img.removeAttribute('alt')
    if (title != null) this.img.setAttribute('title', String(title))
    else this.img.removeAttribute('title')
    if (width != null) this.img.style.width = typeof width === 'number' ? `${width}px` : String(width)
    else this.img.style.width = ''
    // Alignment is presentational only; the CSS keys off data-align.
    if (align != null) this.dom.setAttribute('data-align', align)
    else this.dom.removeAttribute('data-align')
  }

  private render(node: PMNode): void {
    this.applyLayout(node)
    const { attachId, src } = node.attrs as { attachId: string | null; src: string | null }
    this.attachId = attachId
    if (attachId) {
      // Show the cached src immediately (if usable) while we refresh the signed URL.
      this.resolveFromAttach(attachId, src)
    } else {
      this.setSrc(src)
    }
  }

  /** Set the <img> src through the asset whitelist; refuse data:/off-whitelist URLs. */
  private setSrc(raw: string | null): void {
    const safe = sanitizeAssetUrl(raw)
    if (safe) {
      this.dom.classList.remove('is-loading', 'is-error')
      this.img.src = safe
    } else if (raw != null) {
      // A non-null but unusable URL (e.g. data: or off-whitelist) is an error state.
      this.dom.classList.add('is-error')
    }
  }

  private resolveFromAttach(attachId: string, cachedSrc: string | null): void {
    if (cachedSrc) this.setSrc(cachedSrc)
    // Skip only if a request for THIS SAME attachId is already in flight; when the
    // attachId changed underneath us we must start a fresh resolve (otherwise the
    // new node would never get its signed URL refreshed).
    if (this.resolvingFor === attachId) return
    this.resolvingFor = attachId
    if (!cachedSrc) this.dom.classList.add('is-loading')
    getReadUrl(this.docId, attachId)
      .then((res) => {
        if (this.attachId !== attachId) return // node changed underneath us
        this.setSrc(res.url)
      })
      .catch(() => {
        if (this.attachId === attachId && !cachedSrc) this.dom.classList.add('is-error')
      })
      .finally(() => {
        if (this.resolvingFor === attachId) this.resolvingFor = null
        if (this.attachId === attachId) this.dom.classList.remove('is-loading')
      })
  }

  /** Re-apply attrs / refresh src on node update without recreating the DOM. */
  update(node: PMNode): boolean {
    if (node.type.name !== 'image') return false
    this.render(node)
    return true
  }

  /** Everything this view writes — the <img> src, width/style, loading/error classes
   * — is view-only; never let PM's mutation observer re-parse it as a document edit
   * (the node is an atom with no editable content). */
  ignoreMutation(): boolean {
    return true
  }

  /** No interactive sub-DOM to protect; let PM own selection/drag of the atom. */
  stopEvent(): boolean {
    return false
  }
}
