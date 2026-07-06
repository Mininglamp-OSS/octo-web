import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { getWKApp, t } from '../octoweb/index.ts'
import { EditorShell } from '../editor/EditorShell.tsx'
import { DocTerminal, type TerminalKind } from '../editor/DocTerminal.tsx'
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

/** Preserve the octo session id (`?sid=`) across an in-app navigation when present. */
function withSid(path: string): string {
  if (typeof window === 'undefined') return path
  try {
    const sid = new URLSearchParams(window.location.search).get('sid')
    if (!sid) return path
    return path + (path.includes('?') ? '&' : '?') + `sid=${encodeURIComponent(sid)}`
  } catch {
    return path
  }
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

type Phase =
  | { status: 'loading' }
  | { status: 'ready'; meta: DocMeta }
  | { status: 'terminal'; kind: TerminalKind }

/**
 * Standalone document page (octo-web #512) — the full-window view a shared `/d/:docId` link opens,
 * outside the app shell / NavRail. It reuses the in-shell EditorShell for collaboration parity
 * (AC-5/6) and only adds the standalone chrome: a Back control and "Copy link". Sharing a link is
 * the whole point of a standalone view, so there is no "back into the app" action — users arrive
 * here from an external chat link, not from inside the shell.
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
 *     -> render the matching terminal screen (Back only). 409 is the archived signal the
 *     collab-token path never reports, which is exactly why the preflight exists.
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

  // Resolve the standalone space ONCE, from the SAME source the room-addressing fallback uses
  // (standaloneFallbackSpace: live currentSpaceId → cached localStorage → deploy default). Both the
  // preflight's explicit X-Space-Id header and the EditorShell room fallback read this one value, so
  // preflight and room can never address different spaces (the bug: a bare preflight got 400/404 and
  // fell to the not-found terminal even for the user's own last space).
  const preflightSpace = standaloneFallbackSpace(wk.shared?.currentSpaceId)

  // Defense in depth (does NOT gate the primary fix above): the standalone page mounts via the
  // Layout early-return, before the app shell restores currentSpaceId from localStorage, so any
  // in-shell-shared logic the EditorShell touches would see an empty space. If — and only if — the
  // live space is empty and a cached value exists, seed it from the same cached key. Never overwrite
  // a real current space, so in-shell mounts (where it is already set) are unaffected.
  useEffect(() => {
    const shared = wk.shared
    if (!shared || shared.currentSpaceId) return
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

  // Back / return-to-list: from a full-window standalone view there is no resident list to fall
  // back to, so route to the in-shell docs home (the natural "all documents" destination).
  const onBack = useCallback(() => {
    if (typeof window !== 'undefined') window.location.assign(withSid('/docs'))
  }, [])

  const onCopyLink = useCallback(async () => {
    if (typeof window === 'undefined') return
    try {
      await navigator.clipboard?.writeText(window.location.href)
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
    return (
      <div className="octo-doc-standalone">
        <DocTerminal title={t('docs.state.untitled')} kind={phase.kind} onBack={onBack} />
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
      <EditorShell
        key={editorDocId}
        docId={editorDocId}
        title={meta.title || t('docs.state.untitled')}
        uid={uid}
        space={addressing.space}
        folder={addressing.folder}
        doc={addressing.doc}
        user={{ id: uid, name: names.get(uid) || uid }}
        onBack={onBack}
        moreMenuLeadItems={moreMenuLeadItems}
        creatorNicknameOnly
      />
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
