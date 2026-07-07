// Build the shareable link embedded in a forwarded doc message (feature #511, §1.2).
//
// The link points at the STANDALONE doc page `${origin}/d/:docId` (XIN-450, boss decision
// 2026-07-06), NOT the in-shell `/docs?...&doc=` route. This is the real fix for problem 2: the
// octo host's self-built RouteManager (dmworkbase Service/Route.tsx) handles `pageshow`/`popstate`
// by re-pushing `window.location.pathname` ONLY — it UNCONDITIONALLY strips the query — so a
// `?doc=` deep-link was wiped before the docs module mounted and the recipient landed on the empty
// document list / a login detour. By carrying the docId in the PATH, which the pathname-only
// re-push PRESERVES, the shared link opens the target document directly: apps/web Layout intercepts
// the whole `/d` namespace before the app shell and mounts StandaloneDocPage (which reads the id
// from the path, runs a GET /docs/{docId} preflight, then mounts the collaborative editor). When
// the recipient must sign in first, the anonymous Layout branch stashes the exact `/d/:docId`
// target in sessionStorage (`octo.docs.standaloneReturn`) and the post-login flow bounces them back
// to it — so deep-link direct-open AND login-return both land on the correct document.
//
// We build against window.location.origin the same way invite links are built
// (invite/api.ts buildInviteUrl), so the link is absolute and clickable in chat.
//
// #511 problem 2 (sid): the app stores the auth token per space, keyed by the URL's `?sid=` param
// (LoginInfo.getStorageItemForSID reads `token<sid>`, where sid = getSID() = the `?sid=` query).
// A link with no `?sid=` makes the receiver read the bare `token` key (empty) → isLogined() ===
// false → the Layout guard bounces even an already-logged-in user to /login. So we carry the
// current space's sid on the link; the receiver (a member of the same space) then loads their
// `token<sid>` and opens the document without a login detour.

export interface DocLinkTarget {
  docId: string
  /**
   * Kept for call-site compatibility (the forward entry still passes the live space/folder), but no
   * longer embedded in the link: the standalone page resolves the space from the recipient's own
   * session (live currentSpaceId → cached localStorage → deploy default) and the folder from the
   * preflight's documentName, so the addressing does not ride on the shared URL anymore.
   */
  space?: string
  folder?: string
}

/** Origin for the doc link; empty under SSR/tests so the link degrades to a bare query path. */
function origin(): string {
  return typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''
}

/**
 * The current octo space id used to scope the auth token. The docs SPA runs at `/docs?sid=<space>`,
 * so the live `?sid=` is the authoritative value; we fall back to the persisted `currentSpaceId`
 * (localStorage) when the query is unavailable. Empty under SSR/tests or when neither is present —
 * the link then degrades to the sid-less form.
 */
function currentSid(): string {
  if (typeof window === 'undefined') return ''
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('sid')
    if (fromUrl) return fromUrl
  } catch {
    // Malformed / non-browser search: fall through to the persisted space id.
  }
  try {
    return window.localStorage?.getItem('currentSpaceId') || ''
  } catch {
    return ''
  }
}

/**
 * Build `${origin}/d/<docId>` (carrying the current `sid` when available) — the standalone doc-page
 * share form. The receiver opens it → Layout intercepts the `/d` namespace → sid-scoped token loads
 * → GET /docs/{docId} preflight → StandaloneDocPage mounts the editor (reader / writer / forbidden-
 * with-request / not-found / archived), all outside the app shell and immune to the host's
 * query-wiping re-push (the docId lives in the path, not the query). docId only ever contains
 * documentName-safe chars, so the built path stays a valid `/d/:docId` route.
 */
export function buildDocLink({ docId }: DocLinkTarget): string {
  const sid = currentSid()
  const path = `/d/${encodeURIComponent(docId)}`
  const query = sid ? `?sid=${encodeURIComponent(sid)}` : ''
  return `${origin()}${path}${query}`
}
