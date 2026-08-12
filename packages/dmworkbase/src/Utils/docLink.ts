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
   * @deprecated Phase-1 remove-`sp` (design §5.3): ordinary document links no longer carry the
   * doc's Space. The receiver's standalone preflight now resolves the doc's Space server-side from
   * `docId` alone via `GET /docs/:docId/open-context`, so this field is IGNORED by buildDocLink and
   * no `?sp=` is emitted. The field is retained (accepted-but-unused) purely so existing callers
   * that still pass it compile unchanged during the cutover; it will be dropped once every caller
   * stops supplying it. It never was the octo `?sid` token-bucket key — see the module note above.
   */
  space?: string
  /** @deprecated Same as `space`: accepted-but-unused post Phase-1; no folder is emitted on the link. */
  folder?: string
}

/** Origin for the doc link; empty under SSR/tests so the link degrades to a bare query path. */
function origin(): string {
  return typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''
}

/**
 * Build `${origin}/d/<docId>` — the standalone doc-page share form (Phase-1 remove-`sp`, design
 * §5.3). The link carries ONLY the docId in the path and NO query: no `?sp=` (the doc's Space is
 * resolved server-side from the docId by the open-context reader) and no `?sid=` (the recipient's
 * session is recovered from storage independently of the URL, XIN-513).
 *
 * This is the single source of truth for ordinary document links; every entry point (share panel,
 * search, recent, Drive, chat card / forward, Doc / Sheet / Board, HTML) funnels through it, so the
 * `sp` removal lands everywhere at once. It deliberately does NOT touch invite-token, drive-share,
 * space-invite, PPT (`/ppt/d/:docId`) or summary (`/s/share`) links — those are separate namespaces
 * with their own auth/Space chains (design §12.4).
 *
 * The receiver opens it → the host Layout intercepts the `/d` namespace → the stored session is
 * recovered → the standalone page runs the docId-first open-context preflight → StandaloneDocPage
 * mounts the surface (reader / writer / forbidden-with-request / not-found / archived), all outside
 * the app shell and immune to the host's query-wiping re-push (the docId lives in the path).
 */
export function buildDocLink({ docId }: DocLinkTarget): string {
  return `${origin()}/d/${encodeURIComponent(docId)}`
}
