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
//
// Interaction (toolbar item ⑥): when the image is selected it shows drag resize handles
// (writing the existing `width` attr) and a small floating toolbar for left/center/right
// alignment (writing the existing `align` attr). NO new attrs — both already exist in the
// schema, so this adds zero schema/version impact. Upload/presign flow is untouched.

import type { Node as PMNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/core'
import { getReadUrl } from '../attachments/api.ts'
import { sanitizeAssetUrl } from './sanitize.ts'

type Align = 'left' | 'center' | 'right'
const ALIGNMENTS: Align[] = ['left', 'center', 'right']
const MIN_WIDTH = 40

export class ImageNodeView {
  dom: HTMLElement
  private readonly img: HTMLImageElement
  private readonly docId: string
  private readonly editor: Editor
  private readonly getPos: () => number | undefined
  private node: PMNode
  /** Tracks the attachId currently being resolved so a stale async result is dropped. */
  private attachId: string | null = null
  /** The attachId an in-flight read request is for (null when none is in flight). */
  private resolvingFor: string | null = null

  constructor(node: PMNode, docId: string, editor: Editor, getPos: () => number | undefined) {
    this.node = node
    this.docId = docId
    this.editor = editor
    this.getPos = getPos
    const wrap = document.createElement('div')
    wrap.className = 'octo-image'
    // Atom node: no editable content lives inside, so the wrapper is inert.
    wrap.setAttribute('contenteditable', 'false')
    const img = document.createElement('img')
    img.alt = ''
    wrap.appendChild(img)
    this.dom = wrap
    this.img = img
    if (editor.isEditable) this.buildControls()
    this.render(node)
  }

  /** Build the (initially hidden) align toolbar + corner resize handles. View-only DOM. */
  private buildControls(): void {
    const toolbar = document.createElement('div')
    toolbar.className = 'octo-image-toolbar'
    toolbar.setAttribute('contenteditable', 'false')
    const labels: Record<Align, string> = { left: '⬱', center: '☰', right: '⇥' }
    for (const align of ALIGNMENTS) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'octo-image-align-btn'
      btn.dataset.align = align
      btn.textContent = labels[align]
      // preventDefault on mousedown keeps the node selection (so setNodeMarkup keeps targeting it).
      btn.addEventListener('mousedown', (e) => e.preventDefault())
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        this.setAttrs({ align })
      })
      toolbar.appendChild(btn)
    }
    this.dom.appendChild(toolbar)

    // Corner handles: each drags width. Right-side handles grow with +dx, left-side with -dx.
    const corners: Array<{ cls: string; dir: 1 | -1 }> = [
      { cls: 'nw', dir: -1 },
      { cls: 'ne', dir: 1 },
      { cls: 'sw', dir: -1 },
      { cls: 'se', dir: 1 },
    ]
    for (const { cls, dir } of corners) {
      const handle = document.createElement('span')
      handle.className = `octo-image-handle octo-image-handle-${cls}`
      handle.setAttribute('contenteditable', 'false')
      handle.addEventListener('mousedown', (e) => this.startResize(e, dir))
      this.dom.appendChild(handle)
    }
  }

  /** Begin a width drag from a corner handle. Live-previews on the <img>, commits on release. */
  private startResize(event: MouseEvent, dir: 1 | -1): void {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = this.img.getBoundingClientRect().width || this.img.naturalWidth || MIN_WIDTH
    const maxWidth = this.dom.parentElement?.getBoundingClientRect().width || Infinity

    const onMove = (e: MouseEvent) => {
      const next = Math.round(startWidth + dir * (e.clientX - startX))
      const clamped = Math.max(MIN_WIDTH, Math.min(next, maxWidth))
      this.img.style.width = `${clamped}px`
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const finalWidth = Math.round(this.img.getBoundingClientRect().width)
      this.setAttrs({ width: finalWidth })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  /** Commit attribute changes through a normal transaction (so collaboration syncs them). */
  private setAttrs(attrs: Partial<{ width: number; align: Align }>): void {
    const pos = this.getPos()
    if (typeof pos !== 'number') return
    const tr = this.editor.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      ...attrs,
    })
    this.editor.view.dispatch(tr)
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
    // Reflect the active alignment on the toolbar buttons.
    this.dom.querySelectorAll<HTMLButtonElement>('.octo-image-align-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.align === align)
    })
  }

  private render(node: PMNode): void {
    this.node = node
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

  /** ProseMirror selected this node (NodeSelection) — reveal the resize/align controls. */
  selectNode(): void {
    this.dom.classList.add('is-selected')
  }

  /** Selection left the node — hide the controls. */
  deselectNode(): void {
    this.dom.classList.remove('is-selected')
  }

  /** Everything this view writes — the <img> src, width/style, loading/error classes, and the
   * view-only controls — is never a document edit; never let PM's mutation observer re-parse it
   * (the node is an atom with no editable content). */
  ignoreMutation(): boolean {
    return true
  }

  /** Let the resize handles / align buttons handle their own pointer events; PM still owns
   * selection/drag of the atom elsewhere. */
  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null
    return !!target?.closest('.octo-image-handle, .octo-image-toolbar')
  }
}
