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
 * Insert a bookmark card from an already-collected raw URL string: validate → fetch metadata →
 * insert the node. Shared by the toolbar's inline URL popover and the slash-command flow, so neither
 * path uses a native window.prompt (the sheet never does). `range` (slash command) is deleted before
 * inserting, mirroring the other items. Returns true when a card was inserted, false when the URL was
 * rejected — the caller (popover) uses this to keep itself open and surface the error inline.
 */
export async function insertBookmarkFromUrl(editor: Editor, raw: string, range?: Range): Promise<boolean> {
  const url = sanitizeBookmarkUrl(raw.trim())
  if (!url) {
    notifyBookmarkError(t('docs.bookmark.invalidUrl'))
    return false
  }
  const status = beginBookmarkStatus(t('docs.bookmark.loading'))
  try {
    const card = await resolveCard(editor, url)
    const chain = editor.chain().focus()
    if (range) chain.deleteRange(range)
    chain.setBookmark(card).run()
    return true
  } finally {
    status.done()
  }
}

/**
 * Slash-command entry point: still prompts via the native dialog for the `/bookmark` command path
 * (a command palette has no anchored popover to host an inline field). The toolbar button uses the
 * inline BookmarkControl popover instead — see Toolbar.tsx — so the ribbon no longer pops a system
 * dialog. Both converge on insertBookmarkFromUrl for validation + insertion.
 */
export async function promptAndInsertBookmark(editor: Editor, range?: Range): Promise<void> {
  const raw = typeof window !== 'undefined' && typeof window.prompt === 'function'
    ? window.prompt(t('docs.bookmark.prompt'))
    : null
  if (raw == null) return // dismissed
  await insertBookmarkFromUrl(editor, raw, range)
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
