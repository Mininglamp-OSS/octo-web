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
   * The document's REAL space id (doc_meta.space_id — a 32-hex docs-backend space, e.g.
   * `105d4a60…`), known to the sharer at forward time (the in-shell EditorShell space prop, which
   * is the live currentSpaceId). Embedded on the link as `?sp=` (XIN-501) so the recipient's
   * standalone preflight can address `GET /docs/:docId` at the doc's own space. This is NOT the same
   * value as `?sid` (see below): `?sid` is the short octo token-bucket key, whereas `?sp` is the
   * docs space the backend matches against in requireDocRole's cross-space guard. Optional: a link
   * built without it degrades to the recipient resolving the space from their own session.
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
 * Build `${origin}/d/<docId>` — the standalone doc-page share form — carrying, when available:
 *   - `?sid=<space sid>`  the octo token-bucket key so the receiver loads their sid-scoped token
 *                         (`token<sid>`, #511 problem 2 / login-return);
 *   - `?sp=<space id>`    the doc's REAL space (doc_meta.space_id) so the receiver's preflight
 *                         (`GET /docs/:docId`) addresses the doc's own space (XIN-501).
 *
 * The two are DISTINCT identifiers and both are needed: `?sid` keys the token store, `?sp` is the
 * space the docs backend matches in requireDocRole's cross-space guard. XIN-497 reused `?sid` as the
 * preflight space, but a token-bucket sid never equals the doc's space_id, so the preflight 404'd
 * for every recipient (including the owner's own doc). Carrying the real space on its own `?sp` param
 * fixes that without touching the `token<sid>` logic. The receiver opens it → Layout intercepts the
 * `/d` namespace → sid-scoped token loads → preflight against `?sp` → StandaloneDocPage mounts the
 * editor (reader / writer / forbidden-with-request / not-found / archived), all outside the app shell
 * and immune to the host's query-wiping re-push (the docId lives in the path, not the query).
 */
export function buildDocLink({ docId, space }: DocLinkTarget): string {
  const sid = currentSid()
  const path = `/d/${encodeURIComponent(docId)}`
  const parts: string[] = []
  if (sid) parts.push(`sid=${encodeURIComponent(sid)}`)
  const docSpace = (space || '').trim()
  if (docSpace) parts.push(`sp=${encodeURIComponent(docSpace)}`)
  const query = parts.length > 0 ? `?${parts.join('&')}` : ''
  return `${origin()}${path}${query}`
}
