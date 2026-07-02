import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { getWKApp, t } from '../octoweb/index.ts'
import { EditorShell } from '../editor/EditorShell.tsx'
import { DocTerminal, type TerminalKind } from '../editor/DocTerminal.tsx'
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
function persistStandaloneReturn(): void {
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
export function StandaloneDocPage({ docId }: { docId: string | null }): ReactElement {
  const wk = getWKApp()
  const uid = wk.loginInfo?.uid ?? ''
  const [phase, setPhase] = useState<Phase>({ status: 'loading' })
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    getDoc(docId)
      .then((meta) => {
        if (!cancelled) setPhase({ status: 'ready', meta })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const kind = terminalForCreateError(err)
        // Session expired / not signed in: stash the link so login can return here (AC-11).
        if (kind === 'login') persistStandaloneReturn()
        setPhase({ status: 'terminal', kind })
      })
    return () => {
      cancelled = true
    }
  }, [docId])

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
  // caller's current space. Derived from `phase` so it re-resolves once the doc meta lands.
  const addressing = useMemo(() => {
    const fallbackSpace = wk.shared?.currentSpaceId || DEFAULT_DOC_SPACE
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
    return { space: fallbackSpace, folder: DEFAULT_DOC_FOLDER, doc: docId ?? '' }
  }, [phase, wk.shared, docId])

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
  const headerRight = (
    <div className="octo-doc-standalone-actions">
      <button
        type="button"
        className="octo-tb-btn octo-doc-copy-link"
        onClick={() => void onCopyLink()}
      >
        🔗 {copied ? t('docs.standalone.linkCopied') : t('docs.standalone.copyLink')}
      </button>
    </div>
  )

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
        headerRight={headerRight}
      />
    </div>
  )
}
