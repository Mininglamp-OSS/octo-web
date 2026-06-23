// Self-built file-attachment NodeView (frontend-design §3.2 / §3.5, SCHEMA-SPEC §15).
//
// Renders the durable attrs ({ attachId, fileName, mime, sizeBytes }) as a static file card:
// a type icon, the file name, a human-readable size chip, and a download control. Like the
// image NodeView it declares explicit ignoreMutation/stopEvent so its view-only DOM (and the
// async download-URL resolve) is never re-parsed as a document edit — protecting collaborative
// cursors (§3.2). The card holds NO editable content (atom node).
//
// Download reuses the EXACT signed read-URL path images use (getReadUrl → controlled,
// time-limited storage URL); base64 is never involved. Works in the read-only preview too
// (download is a read, not an edit), but no upload affordance is ever shown here.

import type { Node as PMNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/core'
import { getReadUrl } from '../attachments/api.ts'
import { formatBytes } from './FileAttachment.ts'
import { t } from '../octoweb/index.ts'

/** Pick a small glyph by mime family so the card hints at the file type without an asset pack. */
function iconForMime(mime: string | null): string {
  const m = (mime || '').toLowerCase()
  if (m.startsWith('image/')) return '🖼'
  if (m.startsWith('video/')) return '🎬'
  if (m.startsWith('audio/')) return '🎵'
  if (m === 'application/pdf') return '📕'
  if (m.includes('zip') || m.includes('compressed') || m.includes('tar') || m.includes('7z')) return '🗜'
  if (m.includes('word') || m.includes('msword') || m.includes('document')) return '📄'
  if (m.includes('sheet') || m.includes('excel') || m.includes('csv')) return '📊'
  if (m.includes('presentation') || m.includes('powerpoint')) return '📑'
  if (m.startsWith('text/')) return '📃'
  return '📎'
}

export class FileAttachmentNodeView {
  dom: HTMLElement
  private readonly docId: string
  private readonly editor: Editor
  private readonly getPos: () => number | undefined
  private node: PMNode
  private readonly iconEl: HTMLElement
  private readonly nameEl: HTMLElement
  private readonly sizeEl: HTMLElement
  private readonly downloadBtn: HTMLButtonElement
  /** Guards against double-clicks kicking off overlapping read-URL resolves. */
  private resolving = false

  constructor(node: PMNode, docId: string, editor: Editor, getPos: () => number | undefined) {
    this.node = node
    this.docId = docId
    this.editor = editor
    this.getPos = getPos

    const card = document.createElement('div')
    card.className = 'octo-file-card'
    card.setAttribute('contenteditable', 'false')

    this.iconEl = document.createElement('span')
    this.iconEl.className = 'octo-file-icon'

    const meta = document.createElement('span')
    meta.className = 'octo-file-meta'
    this.nameEl = document.createElement('span')
    this.nameEl.className = 'octo-file-name'
    this.sizeEl = document.createElement('span')
    this.sizeEl.className = 'octo-file-size'
    meta.appendChild(this.nameEl)
    meta.appendChild(this.sizeEl)

    this.downloadBtn = document.createElement('button')
    this.downloadBtn.type = 'button'
    this.downloadBtn.className = 'octo-file-download'
    this.downloadBtn.textContent = t('docs.file.download')
    this.downloadBtn.title = t('docs.file.download')
    this.downloadBtn.addEventListener('mousedown', (e) => e.preventDefault())
    this.downloadBtn.addEventListener('click', (e) => {
      e.preventDefault()
      void this.download()
    })

    card.appendChild(this.iconEl)
    card.appendChild(meta)
    card.appendChild(this.downloadBtn)
    this.dom = card
    this.render(node)
  }

  private render(node: PMNode): void {
    this.node = node
    const { fileName, mime, sizeBytes } = node.attrs as {
      fileName: string | null
      mime: string | null
      sizeBytes: number | null
    }
    this.iconEl.textContent = iconForMime(mime)
    this.nameEl.textContent = fileName || t('docs.file.unnamed')
    this.nameEl.title = fileName || ''
    const size = formatBytes(sizeBytes)
    this.sizeEl.textContent = size
    this.sizeEl.style.display = size ? '' : 'none'
    // No attachId → nothing to download (e.g. a half-built node); disable the control.
    const attachId = (node.attrs as { attachId: string | null }).attachId
    this.downloadBtn.disabled = !attachId
  }

  /** Resolve a fresh signed URL from the durable attachId and open it (same read path as images). */
  private async download(): Promise<void> {
    const attachId = (this.node.attrs as { attachId: string | null }).attachId
    if (!attachId || this.resolving) return
    this.resolving = true
    this.dom.classList.add('is-loading')
    try {
      const { url } = await getReadUrl(this.docId, attachId)
      if (typeof window !== 'undefined' && url) {
        // Open the controlled, time-limited storage URL in a new tab; never base64.
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    } catch {
      this.dom.classList.add('is-error')
    } finally {
      this.resolving = false
      this.dom.classList.remove('is-loading')
    }
  }

  update(node: PMNode): boolean {
    if (node.type.name !== 'fileAttachment') return false
    this.render(node)
    return true
  }

  selectNode(): void {
    this.dom.classList.add('is-selected')
  }

  deselectNode(): void {
    this.dom.classList.remove('is-selected')
  }

  /** All DOM here is view-only (atom, no editable content) — never re-parse it as an edit. */
  ignoreMutation(): boolean {
    return true
  }

  /** Let the download button own its click; PM still owns selection/drag of the atom. */
  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null
    return !!target?.closest('.octo-file-download')
  }
}
