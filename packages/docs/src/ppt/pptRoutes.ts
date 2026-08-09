// Top-level route parsing for the html_ppt peer surfaces (R3-F1, XIN-1495 / XIN-1583).
//
// Two full-window PPT routes live OUTSIDE the app shell and are intercepted by the host Layout the
// same way `/d/:docId` (StandaloneDocPage) is — they must never fall through to the rich-text editor
// or the app-shell doc list:
//
//   - `/ppt/d/:docId`            — the peer PPT editor route. A backend `editorUrl` from the R2
//                                  create flow resolves to this same-origin path; the frontend
//                                  navigates there and mounts the Bento container (no EditorShell,
//                                  no Hocuspocus token).
//   - `/docs/:docId/present`     — the present route, `?version=latest|N`.
//
// Parsers here are pure (no `window`) so they are unit-testable and reusable by both the host Layout
// interception and the page components. docId shares the same single-segment safety as the
// standalone doc id (`A-Z a-z 0-9 _ -`), so a malformed id is claimed by the namespace but resolves
// to `null` and lands on the PPT not-available shell rather than silently escaping to the app shell.

/** `/ppt/d/:docId` — the peer PPT editor route (optional trailing slash). */
const PPT_EDITOR_PATH = /^\/ppt\/d\/([A-Za-z0-9_-]+)\/?$/

/** The editor URL namespace: `/ppt/d`, `/ppt/d/`, or `/ppt/d/<anything>` (top-level only). */
const PPT_EDITOR_NAMESPACE = /^\/ppt\/d(?:\/|$)/

/** `/docs/:docId/present` — the present route (optional trailing slash). */
const PPT_PRESENT_PATH = /^\/docs\/([A-Za-z0-9_-]+)\/present\/?$/

/**
 * Extract the docId from a peer editor path (`/ppt/d/:docId`), or `null` when the path is not a
 * well-formed editor link.
 */
export function parsePptEditorDocId(pathname: string): string | null {
  if (typeof pathname !== 'string') return null
  const m = PPT_EDITOR_PATH.exec(pathname)
  return m ? m[1] : null
}

/**
 * Whether `pathname` lives in the editor namespace (`/ppt/d`, `/ppt/d/`, `/ppt/d/<id>`), regardless
 * of whether the id is well-formed. The host Layout claims the whole namespace — a malformed/empty
 * id renders the PPT not-available shell instead of falling through to the app shell (mirroring the
 * `/d` standalone-namespace treatment).
 */
export function isPptEditorPath(pathname: string): boolean {
  return typeof pathname === 'string' && PPT_EDITOR_NAMESPACE.test(pathname)
}

/**
 * Extract the docId from a present path (`/docs/:docId/present`), or `null` when the path is not a
 * present link. Unlike the editor route this does NOT claim a whole namespace: `/docs` itself is the
 * app-shell doc list, so only the exact `/docs/:docId/present` shape is a present route — every other
 * `/docs...` path must keep falling through to the shell.
 */
export function parsePptPresentDocId(pathname: string): string | null {
  if (typeof pathname !== 'string') return null
  const m = PPT_PRESENT_PATH.exec(pathname)
  return m ? m[1] : null
}

/** Whether `pathname` is a present route (`/docs/:docId/present`). */
export function isPptPresentPath(pathname: string): boolean {
  return parsePptPresentDocId(pathname) !== null
}

/**
 * Resolve the `?version=` query for the present route to `'latest'` or a positive integer version
 * sequence.
 *
 * Defaults to `'latest'` whenever the param is absent, blank, or not a clean positive integer — so a
 * hand-edited `?version=0`, `?version=-3`, `?version=1.5`, `?version=abc`, or `?version=99999999999…`
 * (beyond a safe integer) falls back to the newest published version rather than requesting a
 * nonsensical one. Accepts a bare decimal integer only (no signs, no leading zeros beyond a single
 * digit is fine, no `0x`/exponent), matching the backend `version_seq` contract.
 */
export function parsePresentVersion(search: string | null | undefined): 'latest' | number {
  if (typeof search !== 'string' || search.length === 0) return 'latest'
  let raw: string | null
  try {
    raw = new URLSearchParams(search).get('version')
  } catch {
    return 'latest'
  }
  if (raw === null) return 'latest'
  const trimmed = raw.trim()
  if (trimmed === 'latest') return 'latest'
  // Bare positive integer only: reject signs, decimals, whitespace-embedded, and non-digit input.
  if (!/^[0-9]+$/.test(trimmed)) return 'latest'
  const n = Number(trimmed)
  if (!Number.isSafeInteger(n) || n < 1) return 'latest'
  return n
}
