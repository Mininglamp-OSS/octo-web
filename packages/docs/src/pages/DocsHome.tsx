import { useEffect, useState, useCallback, useRef } from 'react'
import { getWKApp, getRouteRight, t, type ApiError } from '../octoweb/index.ts'
import { EditorShell } from '../editor/EditorShell.tsx'
import '../editor/styles.css'
import { DEFAULT_DOC_SPACE, DEFAULT_DOC_FOLDER, DEFAULT_DOC_ID } from '../config.ts'
import { listDocs, createDoc, deleteDoc, type DocListItem } from './docsApi.ts'
import { canManage } from '../auth/roles.ts'
import { useMemberNames } from '../members/useMemberNames.ts'
import { formatRelative, formatAbsolute } from '../versions/format.ts'

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

/**
 * Mirror the active doc to the URL (`?doc=<id>`) WITHOUT a full navigation.
 *
 * Split-pane note: opening a doc is now an in-pane state change (setSelectedDoc), not a
 * `window.location.assign`. We still reflect the selection into the URL via
 * history.replaceState so the link is shareable/refreshable — but replaceState does NOT
 * trigger the host RouteManager's pathname-only re-push (that fires on assign/pushState),
 * so `?doc=` is no longer wiped. sessionStorage remains the durable mirror for the
 * deep-link/refresh path. This is what neutralizes the `?doc=` strip should-fix.
 */
function mirrorDocToUrl(docId: string, space: string, folder: string): void {
  if (typeof window === 'undefined') return
  try {
    const q = new URLSearchParams(window.location.search)
    q.set('space', space)
    q.set('folder', folder)
    q.set('doc', docId)
    window.history.replaceState(window.history.state, '', `/docs?${q.toString()}`)
  } catch {
    // history unavailable: selection still works via state; just not URL-reflected.
  }
}

/** Reflect "back to list" into the URL (drop doc addressing) without a full navigation. */
function mirrorListToUrl(): void {
  if (typeof window === 'undefined') return
  try {
    const q = new URLSearchParams(window.location.search)
    q.delete('doc')
    q.delete('docId')
    q.delete('space')
    q.delete('folder')
    const qs = q.toString()
    window.history.replaceState(window.history.state, '', qs ? `/docs?${qs}` : '/docs')
  } catch {
    // ignore
  }
}

/**
 * Document list landing — shown when `/docs` is opened without a specific doc addressed.
 * Lists documents the caller owns or is a member of (GET /api/v1/docs) and offers a
 * "new document" action (POST /api/v1/docs). Selecting/creating navigates to the editor.
 */
function DocsList({
  space,
  folder,
  currentUid,
  selectedDocId,
  onSelect,
  onDeleted,
  reloadToken,
}: {
  space: string
  folder: string
  currentUid: string
  selectedDocId: string | null
  onSelect: (docId: string) => void
  onDeleted?: (docId: string) => void
  reloadToken?: number
}): React.ReactElement {
  const [items, setItems] = useState<DocListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // Delete flow: which row's "⋯" menu is open, which doc is pending a confirm, and the
  // in-flight target (disables the button) + a per-list delete error banner.
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    listDocs({ spaceId: space || undefined, folderId: folder || undefined, sort: 'updatedAt:desc' })
      .then((res) => setItems(res?.items ?? []))
      .catch((err) => {
        // Don't swallow the failure: surface it so a first-load error is diagnosable
        // (and offer a retry below) instead of a silently sticky error state.
        console.error('[docs] list failed', err)
        setError(t('docs.state.error'))
      })
      .finally(() => setLoading(false))
  }, [space, folder])

  useEffect(reload, [reload])

  // Refresh the list when the parent bumps reloadToken (e.g. after a rename) so titles update.
  const firstReloadRef = useRef(true)
  useEffect(() => {
    if (firstReloadRef.current) {
      firstReloadRef.current = false
      return // initial load already handled by the mount effect above
    }
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken])

  const onCreate = async () => {
    if (creating) return
    setCreating(true)
    try {
      const created = await createDoc({
        title: t('docs.state.untitled'),
        spaceId: space || undefined,
        folderId: folder || undefined,
      })
      // New docs land in the list; select it inline (right pane opens, list stays).
      onSelect(created.docId)
      reload()
      setCreating(false)
    } catch {
      setError(t('docs.state.error'))
      setCreating(false)
    }
  }

  /** Only the owner or an admin may delete a document (#1). */
  const canDelete = (d: DocListItem) => canManage(d.role) || d.ownerId === currentUid

  // After a delete that left the document gone (200 or 404), refresh the list and tell the
  // parent so it can return to the empty state if that doc was open.
  const afterGone = (docId: string) => {
    onDeleted?.(docId)
    reload()
  }

  const doDelete = async (docId: string) => {
    setDeleteError(null)
    setDeletingId(docId)
    try {
      await deleteDoc(docId)
      afterGone(docId)
    } catch (e) {
      // Contract (DELETE /docs/{id}, C3 final): 404 → already gone (treat as deleted); 403 →
      // not admin; 409 → archived target; anything else → generic failure.
      const status = (e as ApiError).response?.status
      if (status === 404) {
        afterGone(docId)
      } else if (status === 403) {
        setDeleteError(t('docs.list.deleteForbidden'))
      } else if (status === 409) {
        setDeleteError(t('docs.list.deleteArchived'))
      } else {
        setDeleteError(t('docs.list.deleteFailed'))
      }
    } finally {
      setDeletingId(null)
      setConfirmId(null)
      setMenuOpenId(null)
    }
  }

  return (
    <div className="octo-docs-list">
      <div className="octo-docs-list-header">
        <h2 className="octo-docs-list-title">{t('docs.menu.title')}</h2>
        <button
          type="button"
          className="octo-docs-list-new"
          onClick={onCreate}
          disabled={creating}
        >
          <span className="octo-docs-list-new-icon" aria-hidden="true">+</span>
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
      {deleteError && (
        <p className="octo-docs-list-state octo-error" role="alert">
          {deleteError}
        </p>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="octo-docs-list-state octo-docs-list-empty">{t('docs.state.empty')}</p>
      )}
      {!loading && !error && items.length > 0 && (
        <ul className="octo-docs-list-items">
          {items.map((d) => {
            const active = d.docId === selectedDocId
            const hasTitle = !!d.title && d.title.trim().length > 0
            const label = hasTitle ? d.title : t('docs.state.untitled')
            const deletable = canDelete(d)
            const menuOpen = menuOpenId === d.docId
            const confirming = confirmId === d.docId
            return (
              <li
                key={d.docId}
                className={
                  active ? 'octo-docs-list-item octo-docs-list-item-active' : 'octo-docs-list-item'
                }
              >
                <div className="octo-docs-list-row-wrap">
                  <button
                    type="button"
                    className="octo-docs-list-row"
                    onClick={() => onSelect(d.docId)}
                    aria-current={active ? 'true' : undefined}
                  >
                    <span className="octo-docs-list-row-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M4 1.5h5L12.5 5v9a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5Z"
                          stroke="currentColor"
                          strokeWidth="1"
                          fill="none"
                        />
                        <path d="M9 1.5V5h3.5" stroke="currentColor" strokeWidth="1" fill="none" />
                      </svg>
                    </span>
                    <span className="octo-docs-list-row-text">
                      <span
                        className={
                          hasTitle
                            ? 'octo-docs-list-row-title'
                            : 'octo-docs-list-row-title octo-docs-list-row-title-untitled'
                        }
                      >
                        {label}
                      </span>
                      {d.updatedAt && (
                        <span
                          className="octo-docs-list-row-sub"
                          title={formatAbsolute(d.updatedAt)}
                        >
                          {t('docs.list.updatedAt')} {formatRelative(d.updatedAt)}
                        </span>
                      )}
                    </span>
                  </button>
                  {/* Owner/admin-only delete control. A "⋯" menu (not a bare button at the row
                      edge) guards against mis-clicks; the actual delete needs a second confirm. */}
                  {deletable && (
                    <div className="octo-docs-list-row-actions">
                      <button
                        type="button"
                        className="octo-docs-list-row-menu-btn"
                        title={t('docs.list.more')}
                        aria-label={t('docs.list.more')}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        onClick={() => {
                          setMenuOpenId(menuOpen ? null : d.docId)
                          setConfirmId(null)
                        }}
                      >
                        ⋯
                      </button>
                      {menuOpen && !confirming && (
                        <div className="octo-docs-list-row-menu" role="menu">
                          <button
                            type="button"
                            className="octo-docs-list-row-menu-item octo-error"
                            role="menuitem"
                            onClick={() => setConfirmId(d.docId)}
                          >
                            {t('docs.list.delete')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {confirming && (
                  <div className="octo-docs-delete-confirm" role="alertdialog" aria-label={t('docs.list.deleteConfirmTitle')}>
                    <p className="octo-docs-delete-confirm-text">{t('docs.list.deleteConfirm')}</p>
                    <div className="octo-docs-delete-confirm-actions">
                      <button
                        type="button"
                        className="octo-tb-btn"
                        disabled={deletingId === d.docId}
                        onClick={() => {
                          setConfirmId(null)
                          setMenuOpenId(null)
                        }}
                      >
                        {t('docs.list.deleteCancel')}
                      </button>
                      <button
                        type="button"
                        className="octo-tb-btn octo-docs-delete-confirm-go"
                        disabled={deletingId === d.docId}
                        onClick={() => void doDelete(d.docId)}
                      >
                        {t('docs.list.delete')}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
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
/**
 * Docs landing route (`/docs`) — split-pane layout (left list always resident, right editor).
 *
 * Selecting a list item opens the editor INLINE in the right pane via state (selectedDocId),
 * NOT a full navigation — so the left list never disappears, matching the
 * octo-smart-summary / matter list+detail layout. The selection is mirrored to `?doc=` +
 * sessionStorage (mirrorDocToUrl + persistDocTarget) for shareable/deep-link/refresh, using
 * history.replaceState (no host re-push) so `?doc=` is no longer wiped.
 */
export function DocsHome() {
  const wk = getWKApp()
  // Guard the session reads: a render throw here would only trade the silent hang for an
  // error-boundary screen, so default to '' and let the editor/list resolve identity from
  // the collab-token round-trip instead of crashing first paint.
  const uid = wk.loginInfo?.uid ?? ''
  const space = wk.shared?.currentSpaceId || DEFAULT_DOC_SPACE
  const folder = DEFAULT_DOC_FOLDER

  // Initial selection from URL deep-link / persisted target (so a shared `/docs?doc=` or a
  // refresh opens that doc in the right pane on first paint).
  const [selectedDocId, setSelectedDocId] = useState<string | null>(() => {
    const initial = resolveDocTarget(
      typeof window !== 'undefined' ? window.location.search : '',
    )
    return initial?.docId ?? null
  })

  // The host's right (main) route pane. When present (production), the editor is pushed there
  // so it fills the main content area while the list stays in the left route slot — the same
  // full-width list+detail layout Matter/Summary use. When absent (tests / standalone), we
  // fall back to rendering the editor inline in a CSS split pane.
  const routeRight = getRouteRight()

  // Bumped after a successful rename so the resident list refreshes its titles.
  const [listReloadToken, setListReloadToken] = useState(0)
  const onTitleSaved = useCallback(() => {
    setListReloadToken((n) => n + 1)
  }, [])

  // uid → display name for the space (feature #8): used to set the awareness user.name so the
  // presence avatar initial and the collaboration caret show a real name, not the raw uid.
  // Resilient: empty until resolved (or on fetch failure) → falls back to uid.
  const names = useMemberNames(space)

  // Docs-owned empty state for the right pane. CRITICAL: the host renders its default
  // contentRight (<EmptyStateIllustration/> = the chat "select a conversation" placeholder)
  // as the ALWAYS-PRESENT base layer of the right viewqueue (WKViewQueue renders
  // `{this.props.children}` beneath the imperative `queues` stack). If docs leaves the
  // routeRight queue EMPTY (e.g. on first entry with no doc selected, or after popToRoot),
  // that chat placeholder shows through — the non-deterministic "editor vs chat placeholder"
  // race. Fix: docs ALWAYS occupies routeRight (this empty state when no doc, the editor when
  // one is selected) so the queue is never empty and the chat placeholder never surfaces.
  const buildEmptyState = useCallback(
    () => (
      <div className="octo-doc octo-doc--editor octo-theme octo-docs-right-empty">
        <p>{t('docs.state.empty')}</p>
      </div>
    ),
    [],
  )

  const backToList = useCallback(() => {
    setSelectedDocId(null)
    clearDocTarget()
    mirrorListToUrl()
    if (routeRight) {
      try {
        // Replace with the docs empty state (NOT popToRoot) — popToRoot would empty the queue
        // and let the host chat placeholder show through. Keep docs owning the right pane.
        routeRight.replaceToRoot(buildEmptyState() as unknown)
      } catch {
        // ignore — right pane already cleared / unavailable
      }
    }
  }, [routeRight, buildEmptyState])

  // Build the editor element. `onBack` (header "← back" control) is passed ONLY on the inline
  // standalone/test path; in the routeRight production path the left list is always resident, so
  // the header back button is redundant and omitted (#2). `onExit` (= backToList) is ALWAYS
  // wired so the editor can return to the empty/list state on an in-flight deletion (#1 / 4403).
  const buildEditor = useCallback(
    (docId: string, onBack?: () => void) => (
      <EditorShell
        key={docId}
        docId={docId}
        title={t('docs.state.untitled')}
        uid={uid}
        space={space}
        folder={folder}
        doc={docId}
        user={{ id: uid, name: names.get(uid) || uid }}
        onBack={onBack}
        onExit={backToList}
        onTitleSaved={onTitleSaved}
      />
    ),
    [uid, space, folder, names, onTitleSaved, backToList],
  )

  const openDoc = useCallback(
    (docId: string) => {
      setSelectedDocId(docId)
      // Durable mirror (survives the host's query-wiping re-push) + shareable URL (replaceState,
      // no host re-push) — together neutralizing the `?doc=` strip should-fix.
      persistDocTarget({ space, folder, doc: docId })
      mirrorDocToUrl(docId, space, folder)
      // Full-width path: push the editor into the host's main (right) pane, list stays left.
      // No header back button here (#2) — the resident list is the way back.
      if (routeRight) {
        try {
          routeRight.replaceToRoot(buildEditor(docId) as unknown)
        } catch {
          // ignore — fall back to inline render below if the host pane rejects.
        }
      }
    },
    [space, folder, routeRight, buildEditor],
  )

  // Called by the list after a successful delete. If the deleted doc is the one open in the
  // right pane, return to the empty/list state (which also resets the editor's drawer, #5 C4).
  const onDocDeleted = useCallback(
    (docId: string) => {
      if (docId === selectedDocId) backToList()
      setListReloadToken((n) => n + 1)
    },
    [selectedDocId, backToList],
  )

  // On mount, ALWAYS occupy the right pane so the host chat placeholder never shows through
  // (the contentRight race). If a doc is pre-selected (deep-link / persisted target) push the
  // editor; otherwise push the docs empty state. Either way the routeRight queue is non-empty
  // from first paint, so entering /docs is deterministically full-width docs — never the
  // intermittent chat-placeholder regression.
  useEffect(() => {
    if (!routeRight) return
    try {
      if (selectedDocId) {
        routeRight.replaceToRoot(buildEditor(selectedDocId) as unknown)
      } else {
        routeRight.replaceToRoot(buildEmptyState() as unknown)
      }
    } catch {
      // ignore
    }
    // Only on mount: subsequent selections are pushed by openDoc / backToList.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Production (routeRight present): the editor lives in the host's main pane; this route
  // slot renders ONLY the resident list (left). Tests / standalone (no routeRight): render
  // the inline CSS split-pane (left list + right editor) so the layout still works.
  if (routeRight) {
    return (
      <div className="octo-doc octo-docs-list-only">
        <DocsList
          space={space}
          folder={folder}
          currentUid={uid}
          selectedDocId={selectedDocId}
          onSelect={openDoc}
          onDeleted={onDocDeleted}
          reloadToken={listReloadToken}
        />
      </div>
    )
  }

  return (
    <div className="octo-doc octo-docs-split">
      <aside className="octo-docs-split-left">
        <DocsList
          space={space}
          folder={folder}
          currentUid={uid}
          selectedDocId={selectedDocId}
          onSelect={openDoc}
          onDeleted={onDocDeleted}
          reloadToken={listReloadToken}
        />
      </aside>
      <section className="octo-docs-split-right">
        {selectedDocId ? (
          buildEditor(selectedDocId, backToList)
        ) : (
          <div className="octo-docs-split-empty">
            <p>{t('docs.state.empty')}</p>
          </div>
        )}
      </section>
    </div>
  )
}
