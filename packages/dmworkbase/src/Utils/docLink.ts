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
// No `?sid=` on the link (XIN-513, boss decision + real-device evidence 2026-07-07): the app stores
// the auth token per space, keyed by `token<sid>`, but the link no longer needs to carry that key.
// An already-logged-in recipient's session is recovered from storage independently of the URL —
// apps/web Layout runs recoverOctoSessionFromStorage on the `/d` path, which (via recoverSession.ts
// findStoredSessions) scans every `token<sid>` bucket in localStorage and adopts a valid stored
// session, so a sid-less link opens the document directly without a login detour. The earlier note
// that a sid-less link bounced a signed-in user to /login described the pre-recovery state and no
// longer holds. Two edge cases stay tracked separately and are out of scope here: a multi-session /
// multi-space user's sid-less recovery may adopt the wrong space session (octo-web #551), and the
// unauthenticated login-return to `/d/:docId` (octo-web #552). The `token<sid>` bucket / recoverSession
// logic itself is untouched — only the minted link stops carrying `?sid`.

export interface DocLinkTarget {
  docId: string
  /**
   * The document's REAL space id (doc_meta.space_id — a 32-hex docs-backend space, e.g.
   * `105d4a60…`), known to the sharer at forward time (the in-shell EditorShell space prop, which
   * is the live currentSpaceId). Embedded on the link as `?sp=` (XIN-501) so the recipient's
   * standalone preflight can address `GET /docs/:docId` at the doc's own space. This is NOT the same
   * value as the octo `?sid` token-bucket key: `?sp` is the docs space the backend matches against in
   * requireDocRole's cross-space guard, whereas `?sid` (no longer minted on this link, XIN-513) only
   * scoped the token store. Optional: a link built without it degrades to the recipient resolving the
   * space from their own session.
   */
  space?: string
  folder?: string
}

/** Origin for the doc link; empty under SSR/tests so the link degrades to a bare query path. */
function origin(): string {
  return typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''
}

/**
 * Build `${origin}/d/<docId>` — the standalone doc-page share form — carrying, when available:
 *   - `?sp=<space id>`    the doc's REAL space (doc_meta.space_id) so the receiver's preflight
 *                         (`GET /docs/:docId`) addresses the doc's own space (XIN-501).
 *
 * The link deliberately carries NO `?sid=` (XIN-513): an already-logged-in recipient's session is
 * recovered from storage independently of the URL (apps/web Layout → recoverSession.ts
 * findStoredSessions scans the `token<sid>` buckets and adopts a valid session), so the token-bucket
 * sid does not need to ride on the shared link. `?sp` is still needed and DISTINCT: it is the space
 * the docs backend matches in requireDocRole's cross-space guard. XIN-497 reused `?sid` as the
 * preflight space, but a token-bucket sid never equals the doc's space_id, so the preflight 404'd
 * for every recipient (including the owner's own doc). Carrying the real space on its own `?sp` param
 * fixes that without touching the `token<sid>` logic. The receiver opens it → Layout intercepts the
 * `/d` namespace → the stored session is recovered → preflight against `?sp` → StandaloneDocPage
 * mounts the editor (reader / writer / forbidden-with-request / not-found / archived), all outside the
 * app shell and immune to the host's query-wiping re-push (the docId lives in the path, not the query).
 */
export function buildDocLink({ docId, space }: DocLinkTarget): string {
  const path = `/d/${encodeURIComponent(docId)}`
  const docSpace = (space || '').trim()
  const query = docSpace ? `?sp=${encodeURIComponent(docSpace)}` : ''
  return `${origin()}${path}${query}`
}

/** A parsed in-app document share link — the inverse of {@link buildDocLink}. */
export interface ParsedDocLink {
  docId: string
  /** The doc's own space carried by `?sp=`, or undefined when the link omits it. */
  space?: string
}

/** `/d/<docId>` — docId is a single documentName segment (A-Z a-z 0-9 _ -), optional trailing slash. */
const DOC_LINK_PATH_RE = /^\/d\/([A-Za-z0-9_-]+)\/?$/

/**
 * Parse a same-origin in-app document share link (`<origin>/d/<docId>?sp=<spaceId>`) into
 * `{ docId, space }`, or return null when `href` is not such a link. The inverse of
 * {@link buildDocLink}, used to decide whether an in-chat link click should open the doc inline in
 * the sidebar (WS-17) instead of following the anchor to a new page.
 *
 * SAME-ORIGIN ONLY: a link whose origin differs from the current one (an external site that merely
 * happens to use a `/d/…` path) is rejected, so interception never hijacks a foreign URL — it stays
 * a plain outbound link. Relative hrefs resolve against the current origin and are accepted.
 */
export function parseDocLink(href: string | undefined): ParsedDocLink | null {
  if (typeof href !== 'string' || href.length === 0) return null
  if (typeof window === 'undefined' || !window.location?.origin) return null
  let url: URL
  try {
    url = new URL(href, window.location.origin)
  } catch {
    return null
  }
  if (url.origin !== window.location.origin) return null
  const m = DOC_LINK_PATH_RE.exec(url.pathname)
  if (!m) return null
  const space = (url.searchParams.get('sp') || '').trim()
  return { docId: m[1], space: space || undefined }
}
