import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { titleContextStore } from '@octo/base'
import { getWKApp, t, useI18n } from '../octoweb/index.ts'
import { EditorShell } from '../editor/EditorShell.tsx'
import { SheetView } from '../sheet/SheetView.tsx'
import { BoardSession } from '../board/BoardSession.tsx'
import { HtmlDocView } from '../html/HtmlDocView.tsx'
import { PptDocView } from '../ppt/PptDocView.tsx'
import { DocTerminal, type TerminalKind } from '../editor/DocTerminal.tsx'
import { RequestAccessButton } from '../access-request/RequestAccessButton.tsx'
import { LinkIcon, type DocMoreMenuItem } from '../editor/DocMoreMenu.tsx'
import { terminalForCreateError } from '../collab/useCollabEditor.ts'
import { getOpenContext, recordDocView, type DocRequestContext } from './docsApi.ts'
import { parseDocumentName } from '../documentName/index.ts'
import { DEFAULT_DOC_SPACE, DEFAULT_DOC_FOLDER } from '../config.ts'
import { useMemberNames } from '../members/useMemberNames.ts'
import '../editor/styles.css'

/**
 * sessionStorage key holding the full standalone target (`/d/:docId` path + query) captured
 * when the page hits a 401. After the user signs in, the login flow can read this and return
 * them to the exact document link they opened (AC-11). Distinct from DocsHome's
 * `octo.docs.target` (which stores `{space, folder, doc}` for the in-shell list), so the two
 * never clobber each other.
 */
export const STANDALONE_RETURN_KEY = 'octo.docs.standaloneReturn'

/** `/d/:docId` — docId is a single documentName segment (A-Z a-z 0-9 _ -), optional trailing slash. */
const STANDALONE_PATH = /^\/d\/([A-Za-z0-9_-]+)\/?$/

/** `/s/:taskNo` — summary notification deep-link target, same segment safety as `/d/:docId`. */
const STANDALONE_SUMMARY_PATH = /^\/s\/([A-Za-z0-9_-]+)\/?$/

/** The standalone-doc URL namespace: `/d`, `/d/`, or `/d/<anything>` (top-level only). */
const STANDALONE_NAMESPACE = /^\/d(?:\/|$)/

/**
 * Extract the docId from a standalone document path (`/d/:docId`), or null when the path is not
 * a standalone doc link. Exported so the host Layout can decide whether to short-circuit into the
 * standalone page (mirroring the existing `?invite=` interception) and so it is unit-testable.
 */
export function parseStandaloneDocId(pathname: string): string | null {
  if (typeof pathname !== 'string') return null
  const m = STANDALONE_PATH.exec(pathname)
  return m ? m[1] : null
}

/**
 * Whether `pathname` lives in the standalone-doc namespace (`/d`, `/d/`, `/d/<id>`), regardless of
 * whether the id is valid. The host Layout intercepts the whole namespace — not just well-formed
 * ids — so a malformed or empty id (`/d/`, `/d/a:b`) renders the standalone not-found terminal
 * instead of silently falling through to the app shell (AC-9). Pair with parseStandaloneDocId,
 * which returns the id (or null when malformed) once the namespace has been claimed.
 */
export function isStandaloneDocPath(pathname: string): boolean {
  return typeof pathname === 'string' && STANDALONE_NAMESPACE.test(pathname)
}

/** Persist the current location so the post-login flow can bounce the user back to the doc link. */
export function persistStandaloneReturn(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(
      STANDALONE_RETURN_KEY,
      window.location.pathname + window.location.search + window.location.hash,
    )
  } catch {
    // sessionStorage unavailable (private mode / disabled): the deep-link still works on a fresh
    // open; we just can't auto-return after login.
  }
}

/**
 * Old-link compatibility cleanup (octo-web #1317). A legacy link is
 * `/d/:docId?sp=:spaceId`; the new reader locates the doc by `docId` alone and IGNORES `sp` as an
 * authoritative input, so once the doc has opened successfully we strip ONLY the
 * `sp` param from the address bar and PRESERVE everything else — `sid`, the login-return params,
 * any other query, and the hash — each of which has its own lifecycle and must not be swept away by
 * this step. Uses history.replaceState so the cleanup does not create a back-stack
 * entry. No-op when there is no `sp` (the common new-link case) or under SSR / a malformed URL.
 */
export function stripSpFromUrl(): void {
  if (typeof window === 'undefined') return
  try {
    const { pathname, search, hash } = window.location
    if (!search) return
    const parts = search.slice(1).split('&')
    const kept = parts.filter((part) => {
      const rawKey = part.slice(0, part.indexOf('=') < 0 ? undefined : part.indexOf('='))
      try {
        return decodeURIComponent(rawKey.replace(/\+/g, ' ')) !== 'sp'
      } catch {
        return rawKey !== 'sp'
      }
    })
    if (kept.length === parts.length) return
    window.history.replaceState(null, '', pathname + (kept.length ? `?${kept.join('&')}` : '') + hash)
  } catch {
    // Malformed location / history unavailable: leave the address bar as-is (harmless — `sp` is
    // ignored for resolution regardless of whether it lingers in the URL).
  }
}

/**
 * Whether `path` is a SAFE same-origin absolute path — the reusable open-redirect core.
 *
 * Open-redirect guard (hardened, XIN-392). A value that will later be fed to
 * `window.location.assign` must clear these gates, in order:
 *
 *   1. No control characters. The WHATWG URL parser SILENTLY STRIPS tab / newline / CR mid-string,
 *      so a value like `/` + "\n" + `/evil.example.com` parses to the scheme-relative
 *      `//evil.example.com` and the browser then normalizes it off-origin. The old byte-level check
 *      (only path[0]/path[1]) never saw the smuggled `//host` because the control char sat between
 *      them. Rejecting any C0 control char (and DEL) up front closes that whole class of bypass
 *      before parsing can mask it.
 *   2. Rooted absolute path. Rejecting relative values (`d/relative`) up front stops them from
 *      resolving against whatever the current document URL happens to be when the assign runs
 *      (e.g. `/login/` → `/login/d/relative`) instead of a clean `/…` route.
 *   3. Same origin. Resolve against the current origin and require `url.origin === origin`. This
 *      rejects absolute (`https://evil`), scheme-relative (`//host`), and backslash-smuggled
 *      (`/\host`) targets structurally, instead of hand-checking leading characters. A `javascript:`
 *      value fails gate 2 (no leading `/`) and never reaches parsing.
 *
 * This is the shared same-origin check reused by both the post-login return-path guard
 * (isSafeReturnPath, which adds a stricter standalone-target gate on top) and the live PPT-create
 * navigation guard (DocsHome onPptCreated) — a backend-returned editor route is trusted only when it
 * resolves same-origin.
 */
export function isSameOriginPath(path: string | null | undefined): path is string {
  if (typeof path !== 'string' || path.length === 0) return false
  if (path[0] !== '/') return false
  // Reject ANY control character before parsing — see gate 1 above.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(path)) return false
  if (typeof window === 'undefined') return false
  const origin = window.location.origin
  if (!origin) return false
  let url: URL
  try {
    url = new URL(path, origin)
  } catch {
    return false
  }
  return url.origin === origin
}

/**
 * Resolve `raw` to a same-origin path to navigate to, or `null` when it is not same-origin (P2-1).
 *
 * The difference from `isSameOriginPath` is deliberate: that guard REJECTS anything that is not a
 * rooted RELATIVE path — correct for the post-login return target, where the value is user-tamperable
 * and must be a bare `/…` path. But a backend-supplied PPT `editorUrl` may legitimately arrive as a
 * same-origin ABSOLUTE url (`http://localhost:3000/ppt/d/abc`) or a bare-relative (`d/abc`), and
 * rejecting those makes the whole create flow a dead-end: the deck exists server-side, the frontend
 * refuses to navigate, and an unedited retry reuses the same Idempotency-Key so the backend returns
 * the same refused url — the user can never reach a deck the server already made.
 *
 * So for the trusted-route path we NORMALISE instead of reject: resolve against the current origin
 * and, when the resolved origin matches AND the scheme is http(s), hand back a single-rooted
 * `pathname + search + hash` (leading slash runs collapsed to one, so the value can never be re-read
 * as scheme-relative). Cross-origin, scheme-relative (`//host`), backslash-smuggled, and non-http(s)
 * (`javascript:`, `blob:`) values still resolve off-origin, fail the scheme gate, or fail to parse,
 * and return `null` — the open-redirect protection is intact; only same-origin http(s)
 * absolute/relative inputs are additionally accepted. Control chars are rejected up front for the
 * same reason as gate 1 above (the URL parser silently strips tab/newline/CR, smuggling `//host`).
 */
export function resolveSameOriginPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(raw)) return null
  if (typeof window === 'undefined') return null
  const origin = window.location.origin
  if (!origin) return null
  let url: URL
  try {
    url = new URL(raw, origin)
  } catch {
    return null
  }
  if (url.origin !== origin) return null
  // Only real page schemes: blob:<origin>/… also reports a matching origin, but its pathname is the
  // whole inner URL, so it would be handed back as a non-navigable, non-rooted value.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  // url.pathname can itself begin with `//` — from an absolute input (`https://<origin>//evil…`),
  // a backslash-smuggled one, or a rooted `/..//evil…` whose dot-segments clamp to the root and
  // leave a doubled slash. location.assign() re-parses `//host…` as SCHEME-RELATIVE and bounces
  // cross-origin, re-opening the redirect this guard closes. Collapse the leading slash run so the
  // result is a single rooted path.
  return url.pathname.replace(/^\/+/, '/') + url.search + url.hash
}

/**
 * Whether a stashed return target is a SAFE same-origin STANDALONE link.
 *
 * Layers the standalone-target gate (P2-2) on top of the shared same-origin core: even a same-origin
 * path must resolve to `/d/:docId` or the summary notification target `/s/:taskNo`, so a tampered
 * value can't bounce the user to another same-origin page (`/settings`, `/oidc/bind`, …) after login.
 */
function isSafeReturnPath(path: string | null): path is string {
  if (!isSameOriginPath(path)) return false
  // Same-origin already proven; re-parse to inspect the pathname. `path` is a rooted same-origin
  // value here, so this parse cannot throw.
  const url = new URL(path, window.location.origin)
  return parseStandaloneDocId(url.pathname) !== null || STANDALONE_SUMMARY_PATH.test(url.pathname)
}

/**
 * Read and CLEAR the stashed standalone return target, returning it only when it is a safe
 * same-origin relative path (see isSafeReturnPath). The post-login flow calls this to bounce a
 * user who signed in from a `/d/:docId` link back to that exact document instead of the app root
 * (AC-11). Always clears the key (even on an unsafe/absent value) so a stale target can't leak into
 * a later, unrelated login. Returns null when nothing safe is stashed.
 */
export function consumeStandaloneReturn(): string | null {
  if (typeof window === 'undefined') return null
  let raw: string | null = null
  try {
    raw = window.sessionStorage.getItem(STANDALONE_RETURN_KEY)
    window.sessionStorage.removeItem(STANDALONE_RETURN_KEY)
  } catch {
    return null
  }
  return isSafeReturnPath(raw) ? raw : null
}

/**
 * Attach an octo session id to a consumed standalone return target when it carries none.
 *
 * Why (XIN-398): after the user signs in from a `/d/:docId` deep link, goMain reloads that exact
 * path. With no `?sid=`, the reloaded page's sid-keyed `load()` reads the empty-sid bucket only, so
 * a multi-session user (several stored `token{sid}` buckets) falls to `recoverOctoSessionFromStorage`
 * — which since XIN-392 P1-2 refuses to guess an identity when the choice is ambiguous, bouncing the
 * user straight back to login: a loop. Carrying the just-authenticated session's OWN sid on the
 * reload lets its sid-keyed `load()` hit the right bucket directly, so the loop never forms. This is
 * the known current identity's sid, not a guess among several — it does NOT reintroduce the pre-P1-2
 * "persist a guessed session" behavior.
 *
 * Security (XIN-392 P1-1/P2-2 must survive): `target` has already cleared isSafeReturnPath in
 * consumeStandaloneReturn (same-origin, control-char-free, resolves to `/d/:docId`). We only ADD a
 * query param, which cannot change the pathname, and the sid is percent-encoded by URLSearchParams so
 * it can never smuggle a second path/host/query. As defense in depth the rebuilt value is re-run
 * through isSafeReturnPath; anything unexpected falls back to the untouched target. A target that
 * already carries a sid is returned unchanged (the stored link may include one).
 */
export function withReturnSid(target: string, sid: string | null | undefined): string {
  if (!sid || typeof window === 'undefined') return target
  try {
    const url = new URL(target, window.location.origin)
    if (url.searchParams.has('sid')) return target
    url.searchParams.set('sid', sid)
    const rebuilt = url.pathname + url.search + url.hash
    return isSafeReturnPath(rebuilt) ? rebuilt : target
  } catch {
    return target
  }
}

/**
 * Lock glyph for the forbidden landing (XIN-505). 24×24 line icon, stroke inherits `currentColor`
 * so the surrounding icon chip drives its colour — mirrors the line-icon style used elsewhere in
 * the docs package (DocMoreMenu).
 */
function LockIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

/**
 * The VIEWER's real current space, resolved from a genuine viewer signal ONLY: the live
 * `currentSpaceId`, else the cached `currentSpaceId` localStorage key the shell persists. Returns
 * '' when neither exists — deliberately WITHOUT a DEFAULT_DOC_SPACE tail.
 *
 * This is the space recordDocView writes the "最近查看" ingest into (XIN-1237 write/read contract):
 * the backend writes and reads the recent list by X-Space-Id = the viewer's current space, so the
 * view MUST be recorded under the viewer's OWN space. Phase-1 remove-`sp` (design §5.2) no longer
 * seeds the doc's home space into the global `currentSpaceId`, so the viewer signal here stays the
 * shell's own throughout the page's life. Recording into DEFAULT_DOC_SPACE when we cannot confirm
 * the viewer is actually there would (a) write the view into a space the viewer isn't in — breaking
 * the per-space isolation the recent list relies on — and (b) still never surface in the viewer's
 * own recent list. So when there is no real viewer signal we return '' and the caller omits the
 * explicit header, letting the global interceptor decide (exactly as the in-shell entry does),
 * rather than forcing a wrong space.
 */
export function viewerCurrentSpace(currentSpaceId: string | undefined): string {
  if (currentSpaceId) return currentSpaceId
  if (typeof window !== 'undefined') {
    try {
      const cached = window.localStorage.getItem('currentSpaceId')
      if (cached) return cached
    } catch {
      // localStorage unavailable (private mode / disabled): no viewer signal → '' (omit the header).
    }
  }
  return ''
}

/**
 * The document title a 403 disclosed, or undefined. Read ONLY from a 403: the open-context preflight
 * carries `title` there and on no other status. A 404 must never yield one — that is the response
 * that hides a doc's existence, so reading a name off it would defeat the point.
 *
 * Note what the disclosure does and does not rest on. open-context locates by `docId` alone and has
 * NO same-space gate, so a 403 can reach a caller from any Space or none: the title goes to whoever
 * holds the docId and already learned the doc exists from getting 403 rather than 404. That is the
 * product decision (leader) this page implements — the chat share card already shows the same title
 * to the same link holder.
 *
 * Deliberately strict, because an error body is untrusted input: anything that is not a non-empty
 * string after trimming yields undefined, so the caller renders the page exactly as it did before
 * rather than showing "undefined" or an empty heading. Not truncated here — the full string is kept
 * so the element's `title` tooltip can show all of it, and display is bounded by CSS
 * (`-webkit-line-clamp: 2` on `.octo-standalone-forbidden-doc`) instead.
 *
 * Exported for its own unit test. The status gate cannot be observed through the rendered page — a
 * 404 renders DocTerminal, which never reads this value — so a page-level test of "a 404 shows no
 * name" passes with the gate removed and pins nothing. Testing the function directly is the only way
 * to hold it.
 */
export function forbiddenTitleFrom(err: unknown): string | undefined {
  const response = (err as { response?: { status?: number; data?: unknown } } | undefined)?.response
  if (response?.status !== 403) return undefined
  const raw = (response.data as { title?: unknown } | undefined)?.title
  if (typeof raw !== 'string') return undefined
  return raw.trim() || undefined
}

type Phase =
  | { status: 'loading' }
  | { status: 'ready'; ctx: DocRequestContext }
  /**
   * `title` is only ever set for `kind: 'forbidden'`, read from the 403 body of the open-context
   * preflight — the backend discloses it there so this page can name the document the viewer is
   * being asked to request access to. Optional on purpose: a backend that predates that disclosure,
   * or a doc whose stored title is blank, omits the field, and the page must then render exactly as
   * it did before rather than substituting a placeholder.
   */
  | { status: 'terminal'; kind: TerminalKind; title?: string }

/**
 * Standalone document page (octo-web #512) — the full-window view a shared `/d/:docId` link opens,
 * outside the app shell / NavRail. It reuses the in-shell EditorShell for collaboration parity
 * (AC-5/6) and only adds the standalone chrome: "Copy link". Sharing a link is the whole point of a
 * standalone view, so the loaded editor offers no "back to all documents" return link (XIN-416, boss
 * real-device acceptance) — users arrive here from an external chat link, not from inside the shell,
 * and a pure share page needs no entry back into the doc list. The page therefore passes NO onBack to
 * EditorShell; for the same reason the preflight error terminals (below) also render without a Back
 * link (XIN-505) — a share surface has no resident list to return to.
 *
 * "Copy link" is collapsed into the header's ≡ "more" menu (as its top row) rather than sitting as a
 * resident title-bar button, keeping the standalone header as trim as the in-shell one. The clipboard
 * behaviour is unchanged — only its position moved. Because selecting a menu row closes the menu (the
 * panel unmounts), the "Link copied" confirmation cannot live inside the row; it surfaces as a brief
 * menu-external toast rendered by this page instead (reusing the docs package's document-external
 * transient-toast convention, the same fixed overlay style as the image upload status/error toasts).
 *
 * A GET /api/v1/docs/{docId}/open-context preflight runs BEFORE the collaborative editor mounts
 * (Phase-1 remove-`sp` design §4/§5.1). It is the single deterministic gate for every boundary
 * state, needs no WebSocket, and — crucially — locates the doc by `docId` ALONE: no `?sp`, no
 * `X-Space-Id`, no client-supplied Space. It returns the canonical DocRequestContext (home Space +
 * documentName + type + role), which the page uses to address the editor LOCALLY and NEVER writes
 * into the global currentSpaceId (design §5.2, so an external link cannot pollute the shell Space):
 *   - 200          -> mount the editor from the canonical documentName; strip a legacy `?sp` from
 *                     the address bar, preserving everything else (design §8.4).
 *   - 403 forbidden (AC-7), 404 not-found (AC-10), 401 login (AC-11), 409 locked/archived (AC-12)
 *     -> render the matching terminal screen (a centered card; the forbidden landing adds Request
 *     access by docId alone, no Space, design §6.1). 409 is the archived signal the collab-token
 *     path never reports, which is exactly why the preflight exists.
 *
 * `docId` is nullable: the host Layout claims the whole `/d` namespace, so a malformed / empty id
 * (`/d/`, `/d/a:b`) arrives here as null and short-circuits to the not-found terminal instead of
 * falling through to the app shell (AC-9).
 */
export function StandaloneDocPage({
  docId,
  onSessionExpired,
}: {
  docId: string | null
  /**
   * Called when the preflight returns 401 while a token WAS loaded — i.e. the current session is
   * expired (XIN-408). The page mounts only when `WKApp.loginInfo.token` is truthy (host Layout
   * gate), so a 401 here can only mean the loaded token is stale, not that the visitor is anonymous.
   * The host clears the dead session and reloads so the standalone branch falls through to the real
   * login screen — the stashed return target then bounces the user back to this doc after sign-in.
   * When omitted (defensive / non-host callers), the page falls back to the login terminal.
   */
  onSessionExpired?: () => void
}): ReactElement {
  const wk = getWKApp()
  const { locale } = useI18n()
  const uid = wk.loginInfo?.uid ?? ''
  const [phase, setPhase] = useState<Phase>({ status: 'loading' })
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleContextOwner = useRef(Symbol('standalone-doc-title-context'))

  useEffect(() => {
    const primaryTitle = phase.status === 'ready' ? phase.ctx.title?.trim() : ''
    if (!primaryTitle) {
      titleContextStore.clear('docs', titleContextOwner.current)
      return
    }
    titleContextStore.set(
      'docs',
      {
        primaryTitle,
        moduleTitle: t('docs.menu.title'),
      },
      titleContextOwner.current,
    )
    return () => titleContextStore.clear('docs', titleContextOwner.current)
  }, [locale, phase])

  // The VIEWER's own current space, resolved from a genuine viewer signal ONLY (live
  // currentSpaceId → cached localStorage key; '' when neither). This is the space recordDocView
  // writes "最近查看" into (XIN-1237 write/read contract). Phase-1 no longer seeds the doc's home
  // space into the global currentSpaceId (design §5.2 — opening an external /d/:docId must not
  // pollute the shell's Space), so this value stays the viewer's own throughout the page's life and
  // no teardown restore is needed. Captured once via lazy null-init to keep the record path stable
  // across re-renders; '' means "no viewer signal" → the record path omits the explicit header
  // rather than writing to the deploy-default space (design §7.1).
  const viewerSpaceRef = useRef<string | null>(null)
  if (viewerSpaceRef.current === null) {
    viewerSpaceRef.current = viewerCurrentSpace(wk.shared?.currentSpaceId)
  }

  useEffect(() => {
    let cancelled = false
    // AC-9: a `/d/` link with a missing or malformed id. The Layout still routes it here (the
    // namespace is claimed) so we render the not-found terminal rather than the app shell. No
    // preflight — there is nothing valid to fetch.
    if (!docId) {
      setPhase({ status: 'terminal', kind: 'not-found' })
      return
    }
    setPhase({ status: 'loading' })
    // Phase-1 docId-first preflight (design §4/§5.1): GET /docs/:docId/open-context. NO space input
    // is sent — the backend resolves the doc from `docId` alone and returns the canonical
    // DocRequestContext (home Space + documentName + type + role). A legacy link's `?sp` is neither
    // read nor forwarded, so a wrong/stale `?sp` cannot steer resolution (design §8.3). The returned
    // context addresses the editor LOCALLY (props below); it is never written to the global
    // currentSpaceId (design §5.2).
    getOpenContext(docId)
      .then((ctx) => {
        if (cancelled) return
        setPhase({ status: 'ready', ctx })
        // Old-link compatibility: the doc opened by docId, so drop only the now-vestigial `sp` from
        // the address bar, preserving sid / login-return params / other query / hash (design §8.4).
        stripSpFromUrl()
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const kind = terminalForCreateError(err)
        if (kind === 'login') {
          // The page only mounts with a token present (Layout gate), so a 401 means the loaded
          // session is EXPIRED, not that the visitor is anonymous. Stash the deep-link target, then
          // hand off to the host to clear the dead session and reload into the real login screen —
          // instead of rendering a terminal with no way to re-authenticate (XIN-408 dead-end).
          persistStandaloneReturn()
          if (onSessionExpired) {
            onSessionExpired()
            // Do not setPhase: the host is navigating away (reload) to the login screen.
            return
          }
          // No handler wired (defensive): fall back to the login terminal below.
          setPhase({ status: 'terminal', kind })
          return
        }
        setPhase({ status: 'terminal', kind, title: forbiddenTitleFrom(err) })
      })
    return () => {
      cancelled = true
    }
  }, [docId, onSessionExpired])

  // XIN-1238 / XIN-1234: the standalone `/d/:docId` page never recorded a view, so a doc opened from
  // a chat share link never surfaced in the opener's "最近查看". Mirror the in-shell entry
  // (DocsHome.commitOpen): once the doc is READY, fire a single view ingest. It is written to the
  // VIEWER's real current space (viewerSpaceRef), per the XIN-1237 write/read space contract — never
  // the doc's home space. Phase-1 no longer seeds the doc space into currentSpaceId (design §5.2),
  // so the viewer space is simply the shell's own. When no viewer signal was resolvable
  // (viewerSpaceRef === ''), omit the explicit X-Space-Id and let the global interceptor decide,
  // exactly as the in-shell entry does — never force the deploy-default space, which would record
  // the view under a space the viewer isn't in and break per-space isolation. Guarded by docId so
  // React re-renders and strict-mode double-invocation record at most once per opened doc, matching
  // the timing of the normal entry (on open success, not in a render loop). Fire-and-forget:
  // recordDocView swallows every failure, so a failed / not-yet-deployed ingest never affects open.
  const recordedDocRef = useRef<string | null>(null)
  useEffect(() => {
    if (phase.status !== 'ready' || !docId) return
    if (recordedDocRef.current === docId) return
    recordedDocRef.current = docId
    const viewerSpace = viewerSpaceRef.current
    void recordDocView(docId, viewerSpace ? { spaceId: viewerSpace } : undefined)
  }, [phase.status, docId])

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    },
    [],
  )

  const onCopyLink = useCallback(async () => {
    if (typeof window === 'undefined') return
    try {
      // Copy the CANONICAL Phase-1 share link — origin + `/d/:docId` — with NO query at all. The
      // link no longer carries `?sp` (the reader resolves the doc's Space server-side from docId,
      // design §5.3), and it must never leak the sharer's session-scoped `?sid` (the live URL can
      // carry one, added when opening a doc in a new page / returning post-login). Rebuilding from
      // origin + pathname drops both; the recipient's own session is recovered from storage
      // independently of the link (XIN-513).
      const here = new URL(window.location.href)
      const canonical = here.origin + here.pathname
      await navigator.clipboard?.writeText(canonical)
      // Drive the menu-external "Link copied" toast (below). The menu closes on selection, so this
      // confirmation must live outside the (now-unmounted) menu panel — hence page-level state, not
      // a menu-row label. Auto-dismiss after a short interval.
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard blocked (permissions / insecure context): silently no-op; the URL bar still
      // carries the shareable link.
    }
  }, [])

  // Resolve display names for the doc's space so the presence caret shows a real name (parity
  // with the in-shell path). Space/folder/resource id come exclusively from the open-context's
  // canonical documentName (design §4/§5.2), which getOpenContext validates before ready. There is
  // no home-Space/default-folder fallback. Everything here is LOCAL addressing passed as surface
  // props; it is never written to global currentSpaceId. Derived from `phase` so it re-resolves once
  // the context lands.
  const addressing = useMemo(() => {
    if (phase.status === 'ready') {
      const ctx = phase.ctx
      if (ctx.documentName) {
        try {
          const parsed = parseDocumentName(ctx.documentName)
          if (parsed.kind === 'document' || parsed.kind === 'html' || parsed.kind === 'ppt') {
            return { space: parsed.space, folder: parsed.folder, doc: parsed.doc, board: undefined }
          }
          // A whiteboard key (octo:{space}:{folder}:wb:{board}) is authoritative for the board
          // surface just as the document key is for the editor: honor it symmetrically. Falling
          // through to DEFAULT_DOC_FOLDER here derived a DIFFERENT whiteboard key than the
          // open-context authorized for any board in a non-default folder — a wrong collab token / WS
          // room / uid-scoped cache on the cross-node/cross-user `/d/:docId` share surface (XIN-634
          // P1-a). It only worked before because in-app boards hardcode DEFAULT_DOC_FOLDER.
          if (parsed.kind === 'whiteboard') {
            return { space: parsed.space, folder: parsed.folder, doc: docId ?? '', board: parsed.board }
          }
        } catch {
          // Defensive only: getOpenContext rejects malformed canonical addressing before ready.
        }
      }
      // Unreachable defense: getOpenContext parses the canonical key and verifies its doc/home
      // Space identity before setting ready. Never guess a different room if that contract changes.
      return { space: '', folder: '', doc: '', board: undefined }
    }
    return { space: DEFAULT_DOC_SPACE, folder: DEFAULT_DOC_FOLDER, doc: docId ?? '', board: undefined }
  }, [phase, docId])

  const names = useMemberNames(addressing.space)

  if (phase.status === 'loading') {
    return (
      <div className="octo-doc octo-doc-standalone">
        <p className="octo-loading">{t('docs.state.loading')}</p>
      </div>
    )
  }

  if (phase.status === 'terminal') {
    // Standalone share-page terminals render as a centered card in the product's design language
    // (XIN-505 boss real-device requirements). A `/d/:docId` link is a self-contained share surface
    // for external recipients, not an in-app list view, so NO terminal offers a "back to all
    // documents" link (the loaded editor already omits Back per XIN-416; the terminals now match).
    // The in-shell EditorShell renders its OWN inline terminal markup and is untouched by this
    // branch, so this redesign cannot affect the in-shell scenario.
    if (phase.kind === 'forbidden' && docId) {
      // Forbidden landing (feature #511 screen 4c): a lock glyph, the heading, the document's own
      // name when the backend disclosed it, the reason line, and the reused RequestAccessButton whose
      // action is the centered primary CTA. docId is guaranteed non-null here: a null id
      // short-circuits to the not-found terminal before any preflight runs, so it can never reach a
      // forbidden terminal.
      //
      // The name sits under the heading rather than replacing it: the heading answers "what
      // happened", the name answers "which document", and leading with a name the viewer cannot open
      // would read like a broken document page. It was originally omitted altogether on the grounds
      // that a recipient without permission cannot know the real title. Product decision (leader)
      // reverses that: the page must name the document it is asking the viewer to request access to.
      // Be precise about the basis — open-context locates by docId ALONE and has no same-space gate,
      // so this screen is reachable by a caller from any Space or none; what bounds the disclosure is
      // that they already hold the docId and already learned the doc exists from getting 403 rather
      // than 404, and the chat share card that carried the link shows them the same title anyway.
      //
      // Still NEVER a placeholder: with no title in the body — an older backend, or a doc whose
      // stored title is blank — the line is omitted entirely rather than rendering 无标题 as though
      // that were the document's name.
      return (
        <div className="octo-doc-standalone octo-doc-standalone--terminal">
          <div className="octo-standalone-card octo-standalone-forbidden" role="alert">
            <span className="octo-standalone-forbidden-icon" aria-hidden="true">
              <LockIcon />
            </span>
            <h1 className="octo-standalone-card-title">{t('docs.forward.forbiddenTitle')}</h1>
            {phase.title && (
              <p className="octo-standalone-forbidden-doc" title={phase.title}>
                {phase.title}
              </p>
            )}
            <p className="octo-standalone-card-msg">{t('docs.error.permission.forbidden')}</p>
            {/* A forbidden response does not reveal the document's home Space. Keep this request
                human-only: the backend validates owned Bots against doc_meta.space_id, so a viewer
                Space header/snapshot would be both unauthoritative and incorrect. */}
            <RequestAccessButton docId={docId} />
          </div>
        </div>
      )
    }
    // not-found / locked / login: the shared DocTerminal, centered in the same card, with no Back
    // link (onBack omitted). RequestAccess is scoped to the forbidden landing only.
    return (
      <div className="octo-doc-standalone octo-doc-standalone--terminal">
        <div className="octo-standalone-card">
          <DocTerminal title={t('docs.state.untitled')} kind={phase.kind} />
        </div>
      </div>
    )
  }

  const ctx = phase.ctx
  // In the ready phase the addressed id is guaranteed non-null (a null id short-circuits to the
  // not-found terminal above); prefer the id echoed by the open-context, falling back to it.
  const editorDocId = ctx.docId || (docId as string)

  // Board-kind is resolved from the AUTHORITATIVE backend docType the preflight already carried —
  // NOT a node-local registry (XIN-530, boss real-device). A `/d/:docId` share link opens on any
  // node/session, so a board created on node A must render as a board on node B even though node
  // B's board-kind localStorage registry has never seen this docId. The standalone page has no
  // registry to lean on, which makes the backend docType the single source of truth here; anything
  // that isn't an explicit `'board'` falls through to the rich-text editor (the safe default for
  // plain docs and legacy backends that omit docType). This mirrors DocsHome's buildRightPane
  // dispatch so both open paths agree on the shell for every member.
  // Read-only HTML doc ('html'): render the view-only HtmlDocView (its content lives in octo-doc,
  // not the yjs collab store), mirroring DocsHome.buildRightPane. Without this branch an html doc
  // falls through to the collab EditorShell, which has no yjs data for it and reports "not found".
  // The preflight already ran (reader gate) and recordDocView above logged the view, so a shared
  // /d/<docId> html link opens AND lands in "recently viewed" like every other kind.
  if (ctx.docType === 'html') {
    return (
      <div className="octo-doc-standalone">
        <HtmlDocView
          key={editorDocId}
          docId={editorDocId}
          slug={ctx.octoDocSlug}
          space={addressing.space}
          creatorNicknameOnly
        />
      </div>
    )
  }
  // Bento slide-deck ('html_ppt'): render the read-only PptDocView (R1 placeholder), mirroring
  // DocsHome.buildRightPane. This is an EXPLICIT peer branch so a shared /d/<docId> PPT link does
  // NOT fall through to the collab EditorShell below — a Bento deck has no Yjs data and would 404
  // there, and the standalone editor would otherwise try to open a Hocuspocus room for it. The
  // preflight reader gate already ran and recordDocView logged the view, same as every other kind.
  if (ctx.docType === 'html_ppt') {
    return (
      <div className="octo-doc-standalone">
        <PptDocView
          key={editorDocId}
          docId={editorDocId}
          slug={ctx.octoDocSlug}
          space={addressing.space}
          title={ctx.title}
        />
      </div>
    )
  }
  if (ctx.docType === 'board') {
    // The whiteboard {board} segment is BoardSession's `docId` (it becomes octo:{space}:{folder}:
    // wb:{board}). Prefer the authoritative segment parsed from the open-context documentName so the
    // key matches what the backend authorized. getOpenContext validated this before ready.
    const boardId = addressing.board!
    return (
      <div className="octo-doc-standalone">
        <BoardSession
          key={boardId}
          docId={boardId}
          title={ctx.title || t('docs.state.untitled')}
          uid={uid}
          space={addressing.space}
          folder={addressing.folder}
          userName={names.get(uid) || uid}
          creatorNicknameOnly
        />
      </div>
    )
  }
  // "Copy link" as the first row of the header ≡ "more" menu (it used to be a resident title-bar
  // button). Selecting the row closes the menu, so the "Link copied" confirmation can't ride on the
  // row label (the panel unmounts); the label is always the action name and the success feedback is
  // shown by the menu-external toast below, driven by the unchanged onCopyLink clipboard logic.
  const moreMenuLeadItems: DocMoreMenuItem[] = [
    {
      key: 'copy-link',
      label: t('docs.standalone.copyLink'),
      icon: LinkIcon,
      onClick: () => void onCopyLink(),
    },
  ]

  return (
    <div className="octo-doc-standalone">
      {ctx.docType === 'sheet' ? (
        // A shared /d/:docId that resolves to a spreadsheet mounts the collaborative SheetView, not
        // the Tiptap EditorShell — so forwarded / open-in-new-page sheet links open correctly (parity
        // with the in-shell docType branch in DocsHome). Same standalone chrome: "Copy link" as the ≡
        // menu's top row, nickname-only creator (external surface), and no onOpenInNewPage (this IS
        // the standalone page).
        <SheetView
          key={editorDocId}
          docId={editorDocId}
          uid={uid}
          space={addressing.space}
          folder={addressing.folder}
          doc={addressing.doc}
          user={{ id: uid, name: names.get(uid) || uid }}
          moreMenuLeadItems={moreMenuLeadItems}
          creatorNicknameOnly
        />
      ) : (
        <EditorShell
          key={editorDocId}
          docId={editorDocId}
          title={ctx.title || t('docs.state.untitled')}
          uid={uid}
          space={addressing.space}
          folder={addressing.folder}
          doc={addressing.doc}
          user={{ id: uid, name: names.get(uid) || uid }}
          moreMenuLeadItems={moreMenuLeadItems}
          creatorNicknameOnly
        />
      )}
      {/* Menu-external "Link copied" toast. Lives outside EditorShell (and thus outside the ≡ menu
          panel that unmounts on selection), so the confirmation stays visible after the menu closes.
          Fixed overlay, auto-dismissed via the copied timer; matches the docs document-external toast
          style. role="status" + aria-live announces it to assistive tech without stealing focus. */}
      {copied && (
        <div className="octo-doc-standalone-toast" role="status" aria-live="polite">
          {t('docs.standalone.linkCopied')}
        </div>
      )}
    </div>
  )
}
