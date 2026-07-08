import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { getWKApp, getRouteRight, onSpaceChanged, t } from '../octoweb/index.ts'
import { EditorShell } from '../editor/EditorShell.tsx'
import { SheetView } from '../sheet/SheetView.tsx'
import { parseXlsxToMatrix, pendingSheetImports } from '../sheet/xlsxImport.ts'
import '../editor/styles.css'
import {
  DEFAULT_DOC_SPACE,
  DEFAULT_DOC_FOLDER,
  DEFAULT_DOC_ID,
  DOC_TARGET_STORAGE_KEY,
} from '../config.ts'
import { listDocs, createDoc, getDoc, type DocListItem } from './docsApi.ts'
import { useMemberNames } from '../members/useMemberNames.ts'
import { createInvite, buildInviteUrl } from '../invite/api.ts'
import { canManage, type Role } from '../auth/roles.ts'
import { formatRelative, formatAbsolute } from '../versions/format.ts'

export interface DocTarget {
  space: string
  folder: string
  doc: string
  docId: string
}

/**
 * A dropdown menu rendered in a body portal at fixed coords, so it is never clipped by an
 * ancestor's `overflow` (the docs list panel scrolls, which was cutting off inline menus).
 * A full-screen transparent backdrop closes it on outside click.
 */
function PortalMenu({
  at,
  onClose,
  children,
}: {
  at: { left: number; top: number }
  onClose: () => void
  children: React.ReactNode
}) {
  return createPortal(
    <>
      <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000 }} />
      <div
        role="menu"
        style={{
          position: 'fixed',
          left: at.left,
          top: at.top,
          zIndex: 1001,
          background: '#fff',
          color: '#333',
          border: '1px solid #dadce0',
          borderRadius: 8,
          boxShadow: '0 6px 18px rgba(0,0,0,0.16)',
          padding: 6,
          minWidth: 160,
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  )
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
const TARGET_STORAGE_KEY = DOC_TARGET_STORAGE_KEY

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
  selectedDocId,
  onSelect,
  reloadToken,
}: {
  space: string
  folder: string
  selectedDocId: string | null
  onSelect: (docId: string, docType?: string) => void
  reloadToken?: number
}): React.ReactElement {
  const [items, setItems] = useState<DocListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newMenuAt, setNewMenuAt] = useState<{ left: number; top: number } | null>(null)
  const [importMenuAt, setImportMenuAt] = useState<{ left: number; top: number } | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  // Client-side pin (置顶) — persisted in localStorage; pinned docs sort to the top.
  const [pinned, setPinned] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(window.localStorage.getItem('octo.docs.pinned') || '[]'))
    } catch {
      return new Set<string>()
    }
  })
  // Right-click context menu anchor (like 企业微信's list menu): { docId, role, x, y } | null.
  const [menu, setMenu] = useState<{ docId: string; role: Role; x: number; y: number } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const togglePin = (id: string) => {
    setPinned((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        window.localStorage.setItem('octo.docs.pinned', JSON.stringify([...next]))
      } catch {
        // ignore storage failures — pinning is a client-side convenience
      }
      return next
    })
  }

  // Share link = an invite link that GRANTS access (a bare /docs?doc= URL only works
  // for existing members). Create one and copy it to the clipboard. The link grants
  // READER access — a "copy link" must never silently hand out write access; elevating
  // a share to writer is a deliberate action, not the default. (Backend also requires
  // admin to create invites; the menu entry is gated on canManage below to match.)
  const copyShareLink = async (id: string) => {
    try {
      const inv = await createInvite(id, { role: 'reader' })
      const url = buildInviteUrl(inv.inviteToken)
      await navigator.clipboard?.writeText(url)
      setNotice(t('docs.sheet.linkCopied'))
      window.setTimeout(() => setNotice(null), 2000)
    } catch {
      setNotice(t('docs.sheet.linkFailed'))
      window.setTimeout(() => setNotice(null), 2000)
    }
  }

  // Stale-response guard (XIN-417). Switching Space bumps `space`, which recreates `reload` and
  // fires a fresh listDocs — but the previous Space's request may still be in flight. listDocs
  // resolves in network order, not call order, so an older-Space response can land AFTER the
  // newer one and its unconditional setItems would render the wrong Space's documents into the
  // current page (exactly the class of bug this PR fixes). We stamp each reload with a monotonic
  // sequence and only let the LATEST reload's response touch state; superseded responses are
  // dropped. A ref (not state) so it survives re-renders without itself triggering one.
  const reloadSeq = useRef(0)

  const reload = useCallback(() => {
    const seq = ++reloadSeq.current
    setLoading(true)
    setError(null)
    listDocs({ spaceId: space || undefined, folderId: folder || undefined, sort: 'updatedAt:desc' })
      .then((res) => {
        // A newer reload has superseded this one (e.g. the Space changed again while this
        // request was in flight) — drop the stale response so it can't overwrite the current list.
        if (seq !== reloadSeq.current) return
        setItems(res?.items ?? [])
      })
      .catch((err) => {
        if (seq !== reloadSeq.current) return
        // Don't swallow the failure: surface it so a first-load error is diagnosable
        // (and offer a retry below) instead of a silently sticky error state.
        console.error('[docs] list failed', err)
        setError(t('docs.state.error'))
      })
      .finally(() => {
        // Keep the spinner up until the latest reload settles; a stale request finishing first
        // must not clear loading while the current one is still pending.
        if (seq !== reloadSeq.current) return
        setLoading(false)
      })
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

  const onCreate = async (docType?: string) => {
    if (creating) return
    setCreating(true)
    try {
      const created = await createDoc({
        title: docType === 'sheet' ? t('docs.sheet.untitled') : t('docs.state.untitled'),
        spaceId: space || undefined,
        folderId: folder || undefined,
        docType,
      })
      // New docs land in the list; select it inline (right pane opens, list stays).
      onSelect(created.docId, docType)
      reload()
      setCreating(false)
    } catch {
      setError(t('docs.state.error'))
      setCreating(false)
    }
  }

  // "从 Excel 导入" → create a NEW sheet from the uploaded file (title = filename), then
  // stash the parsed cells for the opening SheetView to drain (see xlsxImport.ts). Import
  // never overwrites the current sheet — it always lands in its own new file.
  const onImportSheet = async (file: File) => {
    if (creating) return
    // File-size gate BEFORE reading bytes: a huge/crafted .xlsx can inflate its declared
    // extent and OOM the tab even before parse. Reject oversized files up front so we never
    // pull them into memory. 20MB comfortably covers real spreadsheets.
    const MAX_IMPORT_BYTES = 20 * 1024 * 1024
    if (file.size > MAX_IMPORT_BYTES) {
      setError(t('docs.sheet.importTooLarge'))
      return
    }
    setCreating(true)
    try {
      const result = await parseXlsxToMatrix(await file.arrayBuffer())
      if (!result.ok) {
        setError(result.reason === 'empty' ? t('docs.sheet.importEmpty') : t('docs.sheet.importError'))
        setCreating(false)
        return
      }
      const parsed = result.data
      const title = file.name.replace(/\.(xlsx|xls)$/i, '').trim() || t('docs.sheet.untitled')
      const created = await createDoc({
        title,
        spaceId: space || undefined,
        folderId: folder || undefined,
        docType: 'sheet',
      })
      pendingSheetImports.set(created.docId, parsed)
      onSelect(created.docId, 'sheet')
      reload()
      // Every visible worksheet is imported now (multi-sheet), so the only remaining caveat
      // is per-sheet truncation of an oversized grid.
      if (parsed.truncated) {
        setError(t('docs.sheet.importTruncated'))
      }
    } catch {
      setError(t('docs.state.error'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="octo-docs-list">
      <div className="octo-docs-list-header">
        <h2 className="octo-docs-list-title">{t('docs.menu.title')}</h2>
        <span
          className="octo-docs-list-new"
          style={{ display: 'inline-flex', alignItems: 'stretch', padding: 0, overflow: 'hidden' }}
        >
          <button
            type="button"
            onClick={() => onCreate()}
            disabled={creating}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              font: 'inherit',
              padding: '6px 8px 6px 12px',
              cursor: creating ? 'default' : 'pointer',
            }}
          >
            <span className="octo-docs-list-new-icon" aria-hidden="true">+</span>
            {t('docs.list.new')}
          </button>
          <button
            type="button"
            aria-label={t('docs.sheet.moreNew')}
            title={t('docs.sheet.moreNew')}
            disabled={creating}
            onClick={(e) => {
              const box = (e.currentTarget.closest('.octo-docs-list-new') as HTMLElement) ?? e.currentTarget
              const r = box.getBoundingClientRect()
              setNewMenuAt(newMenuAt ? null : { left: r.left, top: r.bottom + 6 })
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: 'transparent',
              border: 'none',
              borderLeft: '1px solid rgba(255,255,255,0.45)',
              color: 'inherit',
              padding: '0 12px',
              fontSize: 11,
              cursor: creating ? 'default' : 'pointer',
            }}
          >
            ▾
          </button>
        </span>
        {newMenuAt && (
          <PortalMenu at={newMenuAt} onClose={() => setNewMenuAt(null)}>
            <button
              type="button"
              className="octo-tb-btn"
              disabled={creating}
              style={{ display: 'block', width: '100%', textAlign: 'left' }}
              onClick={() => {
                setNewMenuAt(null)
                void onCreate('sheet')
              }}
            >
              ▦ {t('docs.sheet.new')}
            </button>
          </PortalMenu>
        )}
        <button
          type="button"
          className="octo-docs-list-new"
          disabled={creating}
          title={t('docs.sheet.import')}
          aria-haspopup="menu"
          aria-expanded={importMenuAt != null}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setImportMenuAt(importMenuAt ? null : { left: r.left, top: r.bottom + 6 })
          }}
        >
          {t('docs.sheet.import')}
          <span style={{ marginLeft: 6, fontSize: 9, opacity: 0.9 }}>▾</span>
        </button>
        {importMenuAt && (
          <PortalMenu at={importMenuAt} onClose={() => setImportMenuAt(null)}>
            <button
              type="button"
              className="octo-tb-btn"
              disabled={creating}
              style={{ display: 'block', width: '100%', textAlign: 'left' }}
              onClick={() => {
                setImportMenuAt(null)
                importInputRef.current?.click()
              }}
            >
              📄 {t('docs.sheet.importExcel')}
            </button>
          </PortalMenu>
        )}
        <input
          ref={importInputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onImportSheet(f)
            e.currentTarget.value = ''
          }}
        />
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
        <p className="octo-docs-list-state octo-docs-list-empty">{t('docs.state.empty')}</p>
      )}
      {!loading && !error && items.length > 0 && (
        <ul className="octo-docs-list-items">
          {[...items]
            .sort((a, b) => (pinned.has(b.docId) ? 1 : 0) - (pinned.has(a.docId) ? 1 : 0))
            .map((d) => {
            const active = d.docId === selectedDocId
            const hasTitle = !!d.title && d.title.trim().length > 0
            const label = hasTitle ? d.title : t('docs.state.untitled')
            return (
              <li
                key={d.docId}
                className={
                  active ? 'octo-docs-list-item octo-docs-list-item-active' : 'octo-docs-list-item'
                }
              >
                <button
                  type="button"
                  className="octo-docs-list-row"
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMenu({ docId: d.docId, role: d.role, x: e.clientX, y: e.clientY })
                  }}
                  onClick={() => onSelect(d.docId, d.docType)}
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
              </li>
            )
          })}
        </ul>
      )}
      {menu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 50 }}
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
          />
          <div
            className="octo-docs-ctx-menu"
            style={{
              position: 'fixed',
              left: menu.x,
              top: menu.y,
              zIndex: 51,
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,.12)',
              padding: 4,
              minWidth: 120,
              fontSize: 13,
            }}
          >
            <div
              role="menuitem"
              style={{ padding: '8px 12px', cursor: 'pointer', borderRadius: 6 }}
              onClick={() => {
                togglePin(menu.docId)
                setMenu(null)
              }}
            >
              {pinned.has(menu.docId) ? t('docs.sheet.unpin') : t('docs.sheet.pin')}
            </div>
            {canManage(menu.role) && (
              <div
                role="menuitem"
                style={{ padding: '8px 12px', cursor: 'pointer', borderRadius: 6 }}
                onClick={() => {
                  void copyShareLink(menu.docId)
                  setMenu(null)
                }}
              >
                {t('docs.sheet.copyLink')}
              </div>
            )}
          </div>
        </>
      )}
      {notice && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 60,
            background: '#111827',
            color: '#fff',
            padding: '8px 16px',
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          {notice}
        </div>
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
  // The active Space. `wk.shared.currentSpaceId` is a plain mutable field on the host WKApp, NOT
  // React state — reassigning it when the user switches Space does not re-render this component,
  // so deriving `space` inline left the list stuck on the old Space's docs until a manual reload
  // (XIN-410). Mirror it into state and re-read it whenever the host broadcasts `space-changed`
  // (see the effect below) so the switch flows through to reload/useMemberNames.
  const [space, setSpace] = useState<string>(() => wk.shared?.currentSpaceId || DEFAULT_DOC_SPACE)
  const folder = DEFAULT_DOC_FOLDER

  // The Space this component last reconciled to. The space-changed handler reads it to tell a
  // real switch from a redundant same-Space broadcast; only a real switch reconciles/refetches.
  // setSpace is only ever called from that handler, so this ref is the authoritative previous id.
  const spaceRef = useRef(space)

  // Initial selection from URL deep-link / persisted target (so a shared `/docs?doc=` or a
  // refresh opens that doc in the right pane on first paint).
  const [selectedDocId, setSelectedDocId] = useState<string | null>(() => {
    const initial = resolveDocTarget(
      typeof window !== 'undefined' ? window.location.search : '',
    )
    return initial?.docId ?? null
  })
  // Doc type of the open doc ('sheet' -> SheetView, else the Tiptap EditorShell).
  // Unknown on a deep-link/refresh until resolved via getDoc (see the mount effect).
  const [selectedDocType, setSelectedDocType] = useState<string | undefined>(undefined)

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

  // Subscribe to the host's Space-switch broadcast. On a switch the host mutates currentSpaceId
  // then emits `space-changed`; we re-read the id into state AND reconcile the open selection.
  //
  // Reconciliation (XIN-448): a switch must not carry the doc opened under the PREVIOUS Space
  // into the new one. Left as-is, buildEditor(selectedDocId) would rebuild EditorShell with the
  // OLD docId under the NEW space → a cross-Space collab session (octo:<newSpace>:<folder>:
  // <oldDoc>), a data-isolation leak — and the persisted `octo.docs.target` would restore the
  // old Space's doc on refresh. We reuse the existing "back to list" primitive so the switch
  // lands on the new Space's list (clears selectedDocId + the persisted target + mirrors the URL).
  //
  // Only a REAL switch reconciles: spaceRef gates redundant same-Space broadcasts, so one switch =
  // one reload and a duplicate broadcast is a no-op (no request storm, no doc yanked to the list).
  // The effect runs once (empty deps): getWKApp() is the stable singleton and backToList is
  // referentially stable (deps: the singleton routeRight + the []-stable buildEmptyState), so the
  // subscription never captures a stale reconciler and the onSpaceChanged cleanup stays intact.
  useEffect(() => {
    return onSpaceChanged(() => {
      const next = getWKApp().shared?.currentSpaceId || DEFAULT_DOC_SPACE
      if (next === spaceRef.current) return
      spaceRef.current = next
      setSpace(next)
      backToList()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Called after a successful delete (now from the editor detail page, Problem 4). If the deleted
  // doc is the one open in the right pane, return to the empty/list state (which also resets the
  // editor's drawer, #5 C4); always bump the reload token so the resident list refreshes.
  const onDocDeleted = useCallback(
    (docId: string) => {
      if (docId === selectedDocId) backToList()
      setListReloadToken((n) => n + 1)
    },
    [selectedDocId, backToList],
  )

  // "Open in new page" (AC-1): open the current doc as a standalone full-window `/d/:docId` link
  // in a new browser tab — the clean, shareable cold-load entry that lives outside the app shell.
  // The id only ever contains documentName-safe chars, so the built path stays a valid /d/ route.
  //
  // The link carries NO `?sid=` (XIN-513): an already-logged-in user's session is recovered from
  // storage independently of the URL — apps/web Layout runs recoverOctoSessionFromStorage on the
  // `/d` path, which scans the `token<sid>` buckets and adopts a valid stored session — so the new
  // tab opens the document directly without a login detour.
  //
  // It DOES carry `?sp=` (XIN-519 blocker 1): the doc's real space — the active DocsHome space, which
  // the resident list is scoped to, so the open document lives in it — exactly as the other two minted
  // `/d/:docId` links do (buildDocLink forward link, StandaloneDocPage Copy-link). Without `?sp` the
  // recipient's standalone preflight (`GET /docs/:docId`) has no space to address and hits the
  // cross-space guard's not_found ("该文档不存在或已被删除"), notably on the unauthenticated
  // login-return path. We read spaceRef (the authoritative current space id, kept in sync by
  // onSpaceChanged) so the callback stays deps-free. We drop only `?sid`, never `?sp`.
  const onOpenInNewPage = useCallback((id: string) => {
    if (typeof window !== 'undefined') {
      const sp = (spaceRef.current || '').trim()
      const query = sp ? `?sp=${encodeURIComponent(sp)}` : ''
      window.open(`/d/${encodeURIComponent(id)}${query}`, '_blank', 'noopener,noreferrer')
    }
  }, [])

  // Build the editor element. `onBack` (header "← back" control) is passed ONLY on the inline
  // standalone/test path; in the routeRight production path the left list is always resident, so
  // the header back button is redundant and omitted (#2). `onExit` (= backToList) is ALWAYS
  // wired so the editor can return to the empty/list state on an in-flight deletion (#1 / 4403).
  // `onDeleted` (= onDocDeleted) returns to the list + refreshes it after the editor delete entry.
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
        onDeleted={onDocDeleted}
        onOpenInNewPage={() => onOpenInNewPage(docId)}
      />
    ),
    [uid, space, folder, names, onTitleSaved, backToList, onDocDeleted, onOpenInNewPage],
  )

  // Choose the right-pane renderer by doc type: a spreadsheet ('sheet') mounts the
  // collaborative Univer SheetView; everything else uses the Tiptap EditorShell.
  const buildRightPane = useCallback(
    (docId: string, docType: string | undefined, onBack?: () => void) => {
      if (docType === 'sheet') {
        return (
          <SheetView
            key={docId}
            uid={uid}
            space={space}
            folder={folder}
            doc={docId}
            docId={docId}
            user={{ id: uid, name: names.get(uid) || uid }}
            onTitleSaved={onTitleSaved}
            onDeleted={onDocDeleted}
            onOpenInNewPage={() => onOpenInNewPage(docId)}
          />
        )
      }
      return buildEditor(docId, onBack)
    },
    [uid, space, folder, names, buildEditor],
  )

  const openDoc = useCallback(
    (docId: string, docType?: string) => {
      setSelectedDocId(docId)
      // Durable mirror (survives the host's query-wiping re-push) + shareable URL (replaceState,
      // no host re-push) — together neutralizing the `?doc=` strip should-fix.
      persistDocTarget({ space, folder, doc: docId })
      mirrorDocToUrl(docId, space, folder)
      const push = (dt: string | undefined) => {
        setSelectedDocType(dt)
        if (routeRight) {
          try {
            routeRight.replaceToRoot(buildRightPane(docId, dt) as unknown)
          } catch {
            // ignore — fall back to inline render below if the host pane rejects.
          }
        }
      }
      // Type known from the list row → render immediately; otherwise resolve it
      // (deep-link / created doc) so we pick SheetView vs EditorShell correctly.
      if (docType !== undefined) push(docType)
      else void getDoc(docId).then((m) => push(m.docType)).catch(() => push(undefined))
    },
    [space, folder, routeRight, buildRightPane],
  )

  // On mount, ALWAYS occupy the right pane so the host chat placeholder never shows through
  // (the contentRight race). If a doc is pre-selected (deep-link / persisted target) push the
  // editor; otherwise push the docs empty state. Either way the routeRight queue is non-empty
  // from first paint, so entering /docs is deterministically full-width docs — never the
  // intermittent chat-placeholder regression.
  useEffect(() => {
    if (!routeRight) return
    if (selectedDocId) {
      // Resolve the doc type first so a deep-link / refresh opens the right renderer.
      void getDoc(selectedDocId)
        .then((m) => {
          setSelectedDocType(m.docType)
          try {
            routeRight.replaceToRoot(buildRightPane(selectedDocId, m.docType) as unknown)
          } catch {
            // ignore
          }
        })
        .catch(() => {
          try {
            routeRight.replaceToRoot(buildEditor(selectedDocId) as unknown)
          } catch {
            // ignore
          }
        })
    } else {
      try {
        routeRight.replaceToRoot(buildEmptyState() as unknown)
      } catch {
        // ignore
      }
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
          selectedDocId={selectedDocId}
          onSelect={openDoc}
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
          selectedDocId={selectedDocId}
          onSelect={openDoc}
          reloadToken={listReloadToken}
        />
      </aside>
      <section className="octo-docs-split-right">
        {selectedDocId ? (
          buildRightPane(selectedDocId, selectedDocType, backToList)
        ) : (
          <div className="octo-docs-split-empty">
            <p>{t('docs.state.empty')}</p>
          </div>
        )}
      </section>
    </div>
  )
}
