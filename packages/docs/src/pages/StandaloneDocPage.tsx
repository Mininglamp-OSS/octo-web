import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { getWKApp, t } from '../octoweb/index.ts'
import { EditorShell } from '../editor/EditorShell.tsx'
import { SheetView } from '../sheet/SheetView.tsx'
import { DocTerminal, type TerminalKind } from '../editor/DocTerminal.tsx'
import { RequestAccessButton } from '../access-request/RequestAccessButton.tsx'
import { LinkIcon, type DocMoreMenuItem } from '../editor/DocMoreMenu.tsx'
import { terminalForCreateError } from '../collab/useCollabEditor.ts'
import { getDoc, type DocMeta } from './docsApi.ts'
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
      window.location.pathname + window.location.search,
    )
  } catch {
    // sessionStorage unavailable (private mode / disabled): the deep-link still works on a fresh
    // open; we just can't auto-return after login.
  }
}

/**
 * Whether a stashed return target is a SAFE same-origin link that lands on a standalone doc page.
 *
 * Open-redirect guard (hardened, XIN-392). The value lives in sessionStorage, so it is
 * attacker-influenceable, and it is later fed to `window.location.assign` — it must clear three
 * gates, in order:
 *
 *   1. No control characters. The WHATWG URL parser SILENTLY STRIPS tab / newline / CR mid-string,
 *      so a value like `/` + "\n" + `/evil.example.com` parses to the scheme-relative
 *      `//evil.example.com` and the browser then normalizes it off-origin. The old byte-level check
 *      (only path[0]/path[1]) never saw the smuggled `//host` because the control char sat between
 *      them. Rejecting any C0 control char (and DEL) up front closes that whole class of bypass
 *      before parsing can mask it.
 *   2. Same origin. Resolve against the current origin and require `url.origin === origin`. This
 *      rejects absolute (`https://evil`), scheme-relative (`//host`), and backslash-smuggled
 *      (`/\host`) targets structurally, instead of hand-checking leading characters.
 *   3. Standalone-doc target only (P2-2). Even a same-origin path must resolve to `/d/:docId`
 *      (`parseStandaloneDocId(url.pathname) !== null`), so a tampered value can't bounce the user to
 *      another same-origin page (`/settings`, `/oidc/bind`, …) after login — the post-login return
 *      is scoped to the standalone document the user actually opened.
 */
function isSafeReturnPath(path: string | null): path is string {
  if (typeof path !== 'string' || path.length === 0) return false
  // A return target must be a rooted absolute path. Rejecting relative values (`d/relative`) up
  // front stops them from resolving against whatever the current document URL happens to be when
  // window.location.assign runs (e.g. `/login/` → `/login/d/relative`) instead of a clean `/d/:id`.
  if (path[0] !== '/') return false
  // Reject ANY control character before parsing — see gate 1 above.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(path)) return false
  if (typeof window === 'undefined') return false
  const origin = window.location.origin
  let url: URL
  try {
    url = new URL(path, origin)
  } catch {
    return false
  }
  if (url.origin !== origin) return false
  return parseStandaloneDocId(url.pathname) !== null
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
    const rebuilt = url.pathname + url.search
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
 * Resolve the fallback space for the standalone editor when the preflight carries no
 * documentName to address from.
 *
 * The standalone page mounts via the host Layout's EARLY RETURN — before the app-shell logic that
 * restores `currentSpaceId` from localStorage runs (Layout's Provider branch / Main's space
 * bootstrap are both skipped). So on a cold-start cross-space deep link, `wk.shared.currentSpaceId`
 * is still empty and falling straight to DEFAULT_DOC_SPACE would mount the EditorShell against the
 * wrong room (`octo:<DEFAULT_DOC_SPACE>:f_default:docId`) → not-found / wrong document. Read the
 * cached `currentSpaceId` localStorage key (the same key the shell persists) as the middle
 * fallback so the shared link addresses the user's real last space, not the deploy default.
 */
export function standaloneFallbackSpace(currentSpaceId: string | undefined): string {
  if (currentSpaceId) return currentSpaceId
  if (typeof window !== 'undefined') {
    try {
      const cached = window.localStorage.getItem('currentSpaceId')
      if (cached) return cached
    } catch {
      // localStorage unavailable (private mode / disabled): fall back to the deploy default below.
    }
  }
  return DEFAULT_DOC_SPACE
}

/**
 * The doc's OWN space, as carried by the standalone share link's dedicated `?sp=` query param.
 *
 * buildDocLink (forward/link.ts) embeds the shared document's REAL space id as `?sp=` — the space
 * the doc actually lives in (doc_meta.space_id, a 32-hex docs-backend id), known to the sharer at
 * forward time (the in-shell EditorShell space prop = the live currentSpaceId). It is the
 * AUTHORITATIVE space for the standalone preflight, ahead of the recipient's own live/cached
 * currentSpaceId (which, for a cross-space share, is a DIFFERENT space).
 *
 * Why a DEDICATED `?sp` and NOT the link's `?sid` (XIN-501, boss real-device evidence): `?sid` is
 * the token-bucket key (`token<sid>`, #511 problem 2) — a short octo session/space id (e.g.
 * `2b60d3`), which is NOT the docs backend space_id (e.g. `105d4a60d0fc4d55a5cfc3c2d0501361`).
 * XIN-497 fed `?sid` in as X-Space-Id; the backend gates GET /docs/:docId behind requireDocRole,
 * which checks the CROSS-SPACE guard (`meta.space_id !== req.spaceId` → 404 not_found) BEFORE the
 * role guard (role `none` → 403 forbidden). Because the sid never equals the doc's space_id, that
 * preflight returned 404 for EVERY recipient — including the owner opening their OWN doc (the boss
 * regression) — and never reached the intended 403 forbidden + request-access landing. Addressing
 * the preflight from the doc's real space (`?sp`) lets the backend evaluate the caller's role in the
 * doc's space: 200 for a member/owner, 403 for a no-permission caller (→ request-access), 404 only
 * when the doc is genuinely gone. The `token<sid>` logic is untouched — `?sid` still keys the token.
 *
 * Returns '' when the link carries no `?sp=` (older links minted before XIN-501, or under SSR);
 * callers then fall back to standaloneFallbackSpace (live currentSpaceId → cached → deploy default),
 * which still addresses the doc correctly whenever the opener is already in the doc's space (the
 * owner opening their own doc, or a same-space recipient).
 */
export function standaloneLinkSpace(): string {
  if (typeof window === 'undefined') return ''
  try {
    return (new URLSearchParams(window.location.search).get('sp') || '').trim()
  } catch {
    return ''
  }
}

type Phase =
  | { status: 'loading' }
  | { status: 'ready'; meta: DocMeta }
  | { status: 'terminal'; kind: TerminalKind }

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
 * A GET /api/v1/docs/{docId} preflight runs BEFORE the collaborative editor mounts. This is the
 * single deterministic gate for every boundary state, and it needs no WebSocket:
 *   - 200          -> mount the editor.
 *   - 403 forbidden (AC-7), 404 not-found (AC-10), 401 login (AC-11), 409 locked/archived (AC-12)
 *     -> render the matching terminal screen (a centered card; the forbidden landing adds Request
 *     access, XIN-505). 409 is the archived signal the collab-token path never reports, which is
 *     exactly why the preflight exists.
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
  const uid = wk.loginInfo?.uid ?? ''
  const [phase, setPhase] = useState<Phase>({ status: 'loading' })
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Resolve the standalone space ONCE, and address BOTH the preflight's explicit X-Space-Id header
  // and the EditorShell room fallback from it, so preflight and room can never target different
  // spaces. Priority (XIN-501): the doc's real space carried by the share link's dedicated `?sp=`
  // (standaloneLinkSpace — the doc_meta.space_id embedded by buildDocLink, authoritative for a
  // `/d/:docId` deep link) → live currentSpaceId → cached localStorage → deploy default. Do NOT use
  // the link's `?sid` here: `?sid` is the token-bucket key, a short octo session/space id, not the
  // doc's space_id, so feeding it as X-Space-Id trips requireDocRole's cross-space 404 gate BEFORE
  // the role check — 404'ing every recipient, including the owner opening their own doc (XIN-497
  // regression). Older links minted without `?sp` fall through to currentSpaceId, which still
  // addresses the doc correctly when the opener is already in the doc's space (owner / same-space).
  const preflightSpace = standaloneLinkSpace() || standaloneFallbackSpace(wk.shared?.currentSpaceId)

  // Genuine defense in depth (second, independent path — NOT the only working one): the standalone
  // page mounts via the Layout early-return, before the app shell restores currentSpaceId from
  // localStorage, so any in-shell-shared logic the EditorShell touches would see an empty space. If —
  // and only if — the live space is empty and a cached value exists, seed it from the same cached key.
  // Never overwrite a real current space, so in-shell mounts (where it is already set) are unaffected.
  //
  // Both paths now really carry the space to the backend: the preflight's EXPLICIT X-Space-Id header
  // (primary — APIClient forwards config.headers since XIN-424, so it truly reaches the wire) AND this
  // seeding, which repopulates currentSpaceId so the global request interceptor injects X-Space-Id on
  // every OTHER request the shell fires. Before XIN-424 the explicit header was silently dropped by
  // APIClient, so this seeding was in fact the ONLY thing that made same-space docs open; with the
  // header fixed the two are now independent, mutually-reinforcing paths (explicit header wins per
  // request; interceptor is the fallback), which is what real defense in depth means.
  useEffect(() => {
    const shared = wk.shared
    if (!shared || shared.currentSpaceId) return
    // Prefer the doc's real space carried by the share link (`?sp=`, standaloneLinkSpace) so the
    // global interceptor injects the SAME space on the editor's follow-up requests as the preflight
    // header used (XIN-501); fall back to the cached last space when the link carries no `?sp`.
    // Never overwrite a real live space, so in-shell mounts (where it is already set) are unaffected.
    const linkSpace = standaloneLinkSpace()
    if (linkSpace) {
      shared.currentSpaceId = linkSpace
      return
    }
    if (typeof window === 'undefined') return
    try {
      const cached = window.localStorage.getItem('currentSpaceId')
      if (cached) shared.currentSpaceId = cached
    } catch {
      // localStorage unavailable: the explicit preflight header (primary fix) still carries the space.
    }
  }, [wk.shared])

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
    // Carry an explicit X-Space-Id on the preflight (docsApi getDoc): on a cold standalone deep link
    // the global interceptor's space is empty, so this resolved space is the header's only source.
    getDoc(docId, { spaceId: preflightSpace })
      .then((meta) => {
        if (!cancelled) setPhase({ status: 'ready', meta })
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
        setPhase({ status: 'terminal', kind })
      })
    return () => {
      cancelled = true
    }
  }, [docId, onSessionExpired, preflightSpace])

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    },
    [],
  )

  const onCopyLink = useCallback(async () => {
    if (typeof window === 'undefined') return
    try {
      // Copy the CANONICAL share link — origin + `/d/:docId` — carrying only the doc's real space
      // `?sp=` and NEVER the session-scoped `?sid=`. The live URL can carry `?sid=` (the sharer's
      // own token-bucket key, added when opening a doc in a new page / returning post-login); copying
      // window.location.href verbatim would leak the sharer's session id into the shared link. So we
      // rebuild from the path and re-attach ONLY `?sp` (the doc's own space, XIN-501 preflight
      // addressing), which every recipient needs and which is safe to share. The recipient's own
      // session is recovered from storage independently of the link (XIN-513), so no `?sid` is needed.
      const here = new URL(window.location.href)
      const sp = standaloneLinkSpace()
      const canonical = here.origin + here.pathname + (sp ? `?sp=${encodeURIComponent(sp)}` : '')
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
  // with the in-shell path). Space comes from the preflight documentName when available, else the
  // SAME resolved `preflightSpace` the preflight header used — so the room the editor joins matches
  // the space the preflight was authorized against. Derived from `phase` so it re-resolves once the
  // doc meta lands.
  const addressing = useMemo(() => {
    if (phase.status === 'ready' && phase.meta.documentName) {
      try {
        const parsed = parseDocumentName(phase.meta.documentName)
        if (parsed.kind === 'document') {
          return { space: parsed.space, folder: parsed.folder, doc: parsed.doc }
        }
      } catch {
        // Malformed documentName from the backend: fall back to the caller's space + default folder.
      }
    }
    return { space: preflightSpace, folder: DEFAULT_DOC_FOLDER, doc: docId ?? '' }
  }, [phase, preflightSpace, docId])

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
      // Forbidden landing (feature #511 screen 4c): a lock glyph, a non-misleading heading — NOT a
      // fake "Untitled document" title, since a recipient without permission cannot know the real
      // title — the reason line, and the reused RequestAccessButton whose action is the centered
      // primary CTA. docId is guaranteed non-null here: a null id short-circuits to the not-found
      // terminal before any preflight runs, so it can never reach a forbidden terminal.
      return (
        <div className="octo-doc-standalone octo-doc-standalone--terminal">
          <div className="octo-standalone-card octo-standalone-forbidden" role="alert">
            <span className="octo-standalone-forbidden-icon" aria-hidden="true">
              <LockIcon />
            </span>
            <h1 className="octo-standalone-card-title">{t('docs.forward.forbiddenTitle')}</h1>
            <p className="octo-standalone-card-msg">{t('docs.error.permission.forbidden')}</p>
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

  const meta = phase.meta
  // In the ready phase the addressed id is guaranteed non-null (a null id short-circuits to the
  // not-found terminal above); prefer the id echoed by the preflight, falling back to it.
  const editorDocId = meta.docId || (docId as string)
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
      {meta.docType === 'sheet' ? (
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
          title={meta.title || t('docs.state.untitled')}
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
