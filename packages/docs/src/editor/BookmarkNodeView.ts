// Self-built bookmark NodeView (frontend-design §3.2 / §3.5, SCHEMA-SPEC §15).
//
// Renders the link-card attrs ({ url, title, description, image, siteName, fetchedAt }) as a
// clickable link-preview card: thumbnail (when `image` is present), title (falling back to the
// url when `title` is missing), description, and site name. Clicking opens the url in a new tab.
// Missing fields degrade gracefully — no thumbnail without `image`, url-as-title without `title`.
//
// Like the image/file NodeViews it declares explicit ignoreMutation/stopEvent so its view-only
// DOM is never re-parsed as a document edit, protecting collaborative cursors (§3.2). The card
// holds NO editable content (atom node). All URLs pass through sanitizeBookmarkUrl before they
// reach the DOM (the schema already sanitized them; this is the render-boundary belt-and-braces).

import type { Node as PMNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/core'
import { sanitizeBookmarkUrl } from './sanitize.ts'

export class BookmarkNodeView {
  dom: HTMLElement
  private readonly editor: Editor
  private readonly getPos: () => number | undefined
  private node: PMNode

  constructor(node: PMNode, editor: Editor, getPos: () => number | undefined) {
    this.node = node
    this.editor = editor
    this.getPos = getPos

    const card = document.createElement('a')
    card.className = 'octo-bookmark-card'
    card.setAttribute('contenteditable', 'false')
    card.target = '_blank'
    card.rel = 'noopener noreferrer'
    // Keep the anchor from stealing the caret on mousedown so a click in the editor still
    // selects the node; the click handler below does the actual navigation.
    card.addEventListener('mousedown', (e) => e.preventDefault())
    card.addEventListener('click', (e) => {
      const href = card.getAttribute('href')
      if (!href) {
        e.preventDefault()
      }
      // With a valid href the browser opens it in a new tab (target=_blank); nothing else to do.
    })
    this.dom = card
    this.render(node)
  }

  private render(node: PMNode): void {
    this.node = node
    const attrs = node.attrs as {
      url: string | null
      title: string | null
      description: string | null
      image: string | null
      siteName: string | null
    }
    const url = sanitizeBookmarkUrl(attrs.url)
    const image = sanitizeBookmarkUrl(attrs.image)

    // Rebuild the card body each render (cheap; atom node updates are rare).
    this.dom.innerHTML = ''
    if (url) {
      this.dom.setAttribute('href', url)
      this.dom.classList.remove('is-inert')
    } else {
      this.dom.removeAttribute('href')
      this.dom.classList.add('is-inert')
    }

    if (image) {
      const thumb = document.createElement('span')
      thumb.className = 'octo-bookmark-thumb'
      const img = document.createElement('img')
      img.src = image
      img.alt = ''
      img.loading = 'lazy'
      // A broken og:image should not leave an empty box — fall back to the placeholder thumb.
      img.addEventListener('error', () => {
        thumb.className = 'octo-bookmark-thumb octo-bookmark-thumb--placeholder'
        thumb.textContent = '🌐'
      })
      thumb.appendChild(img)
      this.dom.appendChild(thumb)
    } else {
      // D2: no og:image — still show a card thumbnail (globe placeholder) so a sparse bookmark
      // never degrades into looking like a bare link.
      const thumb = document.createElement('span')
      thumb.className = 'octo-bookmark-thumb octo-bookmark-thumb--placeholder'
      thumb.textContent = '🌐'
      this.dom.appendChild(thumb)
    }

    const body = document.createElement('span')
    body.className = 'octo-bookmark-body'

    // Host derived from the url — used as the site footer and as a title fallback (D2).
    let host = ''
    if (url) {
      try {
        host = new URL(url).host
      } catch {
        host = ''
      }
    }

    const titleEl = document.createElement('span')
    const hasTitle = !!attrs.title
    titleEl.className = hasTitle ? 'octo-bookmark-title' : 'octo-bookmark-title is-url'
    // D2: prefer the OG title; else the host; else the raw url — the title line is never blank.
    titleEl.textContent = attrs.title || host || url || ''
    body.appendChild(titleEl)

    if (attrs.description) {
      const desc = document.createElement('span')
      desc.className = 'octo-bookmark-desc'
      desc.textContent = attrs.description
      body.appendChild(desc)
    }

    const site = document.createElement('span')
    site.className = 'octo-bookmark-site'
    // Prefer the explicit siteName; else the host. Only suppress when it would duplicate the title.
    const siteText = attrs.siteName || host
    if (siteText && siteText !== titleEl.textContent) {
      site.textContent = siteText
      body.appendChild(site)
    }

    this.dom.appendChild(body)
  }

  update(node: PMNode): boolean {
    if (node.type.name !== 'bookmark') return false
    this.render(node)
    return true
  }

  selectNode(): void {
    this.dom.classList.add('is-selected')
  }

  deselectNode(): void {
    this.dom.classList.remove('is-selected')
  }

  ignoreMutation(): boolean {
    return true
  }

  /** Swallow clicks on the card so the anchor navigates instead of PM treating it as an edit. */
  stopEvent(event: Event): boolean {
    return event.type === 'click' || event.type === 'mousedown'
  }
}
