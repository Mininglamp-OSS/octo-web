import { useEffect, useState, useCallback } from 'react'
import { getWKApp, t } from '../octoweb/index.ts'
import { EditorShell } from '../editor/EditorShell.tsx'
import { DEFAULT_DOC_SPACE, DEFAULT_DOC_FOLDER, DEFAULT_DOC_ID } from '../config.ts'
import { listDocs, createDoc, type DocListItem } from './docsApi.ts'

export interface DocTarget {
  space: string
  folder: string
  doc: string
  docId: string
}

/**
 * sessionStorage key holding the doc the user is currently viewing.
 *
 * Why this exists: the octo host's self-built RouteManager (dmworkbase Service/Route.tsx)
 * handles `pageshow`/`popstate` by re-pushing `window.location.pathname` ONLY — it drops the
 * query string. So immediately after we navigate to `/docs?…&doc=<id>` the host re-pushes
 * `/docs` and the browser URL collapses to `/docs?sid=…`, wiping `?doc=`. That re-push fires
 * repeatedly, each time re-rendering DocsHome with an empty query. We cannot patch the host
 * (shared infra), so we mirror the target here: a deep-link or an in-app open writes it, and
 * resolveDocTarget falls back to it whenever the query no longer carries a doc. It is cleared
 * only when the user explicitly returns to the list, so the editor stays mounted across the
 * host's pathname-only re-renders instead of flipping back to the list.
 */
const TARGET_STORAGE_KEY = 'octo.docs.target'

/** Mirror the active doc target to sessionStorage so it survives the host's query-wiping. */
function persistDocTarget(target: { space: string; folder: string; doc: string }): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(
      TARGET_STORAGE_KEY,
      JSON.stringify({ space: target.space, folder: target.folder, doc: target.doc }),
    )
  } catch {
    // sessionStorage unavailable (private mode / disabled): the deep-link still opens on
    // first paint via the query; we just can't survive the host's later query-wiping re-push.
  }
}

/** Forget the persisted target — called when the user explicitly goes back to the list. */
export function clearDocTarget(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(TARGET_STORAGE_KEY)
  } catch {
    // ignore — nothing to clear if storage is unavailable.
  }
}

/** Read the persisted target, validating the shape. Returns null when absent/malformed. */
function readDocTarget(): DocTarget | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(TARGET_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DocTarget> | null
    if (!parsed || typeof parsed.doc !== 'string' || !parsed.doc) return null
    return {
      space: typeof parsed.space === 'string' && parsed.space ? parsed.space : DEFAULT_DOC_SPACE,
      folder:
        typeof parsed.folder === 'string' && parsed.folder ? parsed.folder : DEFAULT_DOC_FOLDER,
      doc: parsed.doc,
      docId: parsed.doc,
    }
  } catch {
    return null
  }
}

/**
 * Resolve which document `/docs` should open.
 * Addressing: `/docs?space=<space>&folder=<folder>&doc=<docId>`.
 *
 * Resolution order:
 *   1. URL query (`?doc=`/`?docId=`) — a real deep-link. We persist it (see TARGET_STORAGE_KEY)
 *      so it survives the host re-pushing pathname-only and stripping the query.
 *   2. The persisted sessionStorage target — an in-app open (New / open existing), or a
 *      deep-link whose query the host has already wiped on a `pageshow`/`popstate` re-push.
 *   3. The deployment-configured default doc (VITE_DOCS_DEFAULT_DOC), if any.
 *
 * When none of these yields a doc this returns null and DocsHome renders the document list
 * instead (the backend exposes GET/POST /api/v1/docs for list/create).
 */
export function resolveDocTarget(search: string): DocTarget | null {
  let space = DEFAULT_DOC_SPACE
  let folder = DEFAULT_DOC_FOLDER
  let queryDoc = ''
  try {
    const q = new URLSearchParams(search)
    space = q.get('space') || space
    folder = q.get('folder') || folder
    queryDoc = q.get('doc') || q.get('docId') || ''
  } catch {
    // Non-browser / malformed search — fall back to persisted target / configured defaults.
  }

  // 1. Deep-link via query. Persist it so the editor stays addressable after the host's
  //    pathname-only re-push wipes `?doc=` (the second-blocker root cause).
  if (queryDoc) {
    const target: DocTarget = { space, folder, doc: queryDoc, docId: queryDoc }
    persistDocTarget(target)
    return target
  }

  // 2. The host already wiped the query (or we navigated in-app): fall back to the mirror.
  const persisted = readDocTarget()
  if (persisted) return persisted

  // 3. Deployment-configured default doc, if any.
  if (DEFAULT_DOC_ID) {
    return { space, folder, doc: DEFAULT_DOC_ID, docId: DEFAULT_DOC_ID }
  }

  return null
}

/** Build the `/docs` URL that opens a specific document, preserving octo's `sid` param. */
function docHref(docId: string, space: string, folder: string): string {
  const q = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
  q.set('space', space)
  q.set('folder', folder)
  q.set('doc', docId)
  return `/docs?${q.toString()}`
}

/** Build the `/docs` list URL — strips doc addressing while preserving octo's `sid` param. */
function listHref(): string {
  const q = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
  q.delete('doc')
  q.delete('docId')
  q.delete('space')
  q.delete('folder')
  const qs = q.toString()
  return qs ? `/docs?${qs}` : '/docs'
}

/**
 * Document list landing — shown when `/docs` is opened without a specific doc addressed.
 * Lists documents the caller owns or is a member of (GET /api/v1/docs) and offers a
 * "new document" action (POST /api/v1/docs). Selecting/creating navigates to the editor.
 */
function DocsList({ space, folder }: { space: string; folder: string }): React.ReactElement {
  const [items, setItems] = useState<DocListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    listDocs({ spaceId: space || undefined, folderId: folder || undefined, sort: 'updatedAt:desc' })
      .then((res) => setItems(res.items))
      .catch((err) => {
        // Don't swallow the failure: surface it so a first-load error is diagnosable
        // (and offer a retry below) instead of a silently sticky error state.
        console.error('[docs] list failed', err)
        setError(t('docs.state.error'))
      })
      .finally(() => setLoading(false))
  }, [space, folder])

  useEffect(reload, [reload])

  const openDoc = (docId: string) => {
    // Persist the target BEFORE navigating: the host strips `?doc=` on its first pathname-only
    // re-push, so the editor branch relies on this mirror (not the query) to stay addressable.
    persistDocTarget({ space, folder, doc: docId })
    if (typeof window !== 'undefined') window.location.assign(docHref(docId, space, folder))
  }

  const onCreate = async () => {
    if (creating) return
    setCreating(true)
    try {
      const created = await createDoc({
        title: t('docs.state.untitled'),
        spaceId: space || undefined,
        folderId: folder || undefined,
      })
      openDoc(created.docId)
    } catch {
      setError(t('docs.state.error'))
      setCreating(false)
    }
  }

  return (
    <div className="octo-doc octo-docs-list">
      <div className="octo-docs-list-header">
        <h2>{t('docs.menu.title')}</h2>
        <button type="button" onClick={onCreate} disabled={creating}>
          {t('docs.list.new')}
        </button>
      </div>
      {loading && <p className="octo-docs-list-state">{t('docs.state.loading')}</p>}
      {error && !loading && (
        <p className="octo-docs-list-state octo-error">
          {error}
          <button type="button" className="octo-docs-list-retry" onClick={reload}>
            {t('docs.state.retry')}
          </button>
        </p>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="octo-docs-list-state">{t('docs.state.empty')}</p>
      )}
      {!loading && !error && items.length > 0 && (
        <ul className="octo-docs-list-items">
          {items.map((d) => (
            <li key={d.docId}>
              <button type="button" onClick={() => openDoc(d.docId)}>
                {d.title || t('docs.state.untitled')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Docs landing route (`/docs`). uid/identity come from WKApp.loginInfo (octo session).
 * If the URL addresses a specific doc -> open the editor; otherwise render the document
 * list (open existing / create new). The editor's awareness frame is built from user.id
 * (= collab-token uid) + a palette colour via colorFromId (6-hex) in extensions.ts, so it
 * satisfies the backend validateAwarenessStates check — remote carets work once mounted.
 */
export function DocsHome() {
  const wk = getWKApp()
  // Guard the session reads: a render throw here would only trade the silent hang for an
  // error-boundary screen, so default to '' and let the editor/list resolve identity from
  // the collab-token round-trip instead of crashing first paint.
  const uid = wk.loginInfo?.uid ?? ''
  const target = resolveDocTarget(
    typeof window !== 'undefined' ? window.location.search : '',
  )

  if (!target) {
    // No doc addressed: list documents (space comes from the current octo Space, else default).
    const space = wk.shared?.currentSpaceId || DEFAULT_DOC_SPACE
    return <DocsList space={space} folder={DEFAULT_DOC_FOLDER} />
  }

  // Back to the list: forget the persisted target (otherwise resolveDocTarget keeps returning
  // it across the host's pathname-only re-pushes) and navigate to the doc-less `/docs`.
  const backToList = () => {
    clearDocTarget()
    if (typeof window !== 'undefined') window.location.assign(listHref())
  }

  return (
    <EditorShell
      docId={target.docId}
      title={t('docs.state.untitled')}
      uid={uid}
      space={target.space}
      folder={target.folder}
      doc={target.doc}
      user={{ id: uid, name: uid }}
      onBack={backToList}
    />
  )
}
