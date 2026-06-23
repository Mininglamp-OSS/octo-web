// Bookmark insert flow (frontend-design §3.5, SCHEMA-SPEC §15).
//
// Shared by the toolbar button and the slash command. Flow: prompt for a URL → sanitize to
// http/https ONLY (reuse the Link scheme-whitelist idea — sanitizeBookmarkUrl) → fetch the
// link-card metadata (POST /docs/{docId}/link-card) → insert a `bookmark` node carrying the
// EXACT { url, title, description, image, siteName, fetchedAt } attr set. If the OG fetch fails
// the card still inserts with just the url (graceful: title falls back to the url). The node is
// never inserted for an invalid (non-http/https) URL.

import type { Editor, Range } from '@tiptap/core'
import { fetchLinkCard, type LinkCard } from '../bookmark/api.ts'
import { sanitizeBookmarkUrl } from './sanitize.ts'
import { t } from '../octoweb/index.ts'

/** Read docId off the registered bookmark extension (threaded via buildExtensions). */
export function getBookmarkDocId(editor: Editor): string | null {
  const ext = editor.extensionManager.extensions.find((e) => e.name === 'bookmark')
  const docId = (ext?.options as { docId?: string } | undefined)?.docId
  return docId && docId.length > 0 ? docId : null
}

/**
 * Fetch the link card for `url`, falling back to a url-only card if the OG fetch fails or no
 * docId is available — so a bookmark always inserts once the URL is valid.
 */
async function resolveCard(editor: Editor, url: string): Promise<LinkCard> {
  const docId = getBookmarkDocId(editor)
  if (!docId) return { url, title: null, description: null, image: null, siteName: null, fetchedAt: null }
  try {
    return await fetchLinkCard(docId, url)
  } catch {
    return { url, title: null, description: null, image: null, siteName: null, fetchedAt: null }
  }
}

/**
 * Toolbar / slash entry point: prompt for a URL, validate, fetch metadata, insert the card.
 * `range` (slash command) is deleted before inserting, mirroring the other items.
 */
export async function promptAndInsertBookmark(editor: Editor, range?: Range): Promise<void> {
  const raw = typeof window !== 'undefined' && typeof window.prompt === 'function'
    ? window.prompt(t('docs.bookmark.prompt'))
    : null
  if (raw == null) return // dismissed
  const url = sanitizeBookmarkUrl(raw.trim())
  if (!url) {
    notifyBookmarkError(t('docs.bookmark.invalidUrl'))
    return
  }
  const status = beginBookmarkStatus(t('docs.bookmark.loading'))
  try {
    const card = await resolveCard(editor, url)
    const chain = editor.chain().focus()
    if (range) chain.deleteRange(range)
    chain.setBookmark(card).run()
  } finally {
    status.done()
  }
}

// --- transient, document-external status / error UI ---------------------------
// Live in <body>, never in the Y.Doc, so they cannot desync collab content.

function beginBookmarkStatus(text: string): { done: () => void } {
  if (typeof document === 'undefined') return { done: () => {} }
  const el = document.createElement('div')
  el.className = 'octo-bookmark-status'
  el.textContent = text
  document.body.appendChild(el)
  return { done: () => el.remove() }
}

export function notifyBookmarkError(message: string): void {
  if (typeof document === 'undefined') return
  const el = document.createElement('div')
  el.className = 'octo-bookmark-error'
  el.setAttribute('role', 'alert')
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 4000)
}
