import { useEffect, useState, useCallback, useRef } from 'react'
import { getWKApp, getRouteRight, onSpaceChanged, onNavMenuActivated, t, fetchSpaceBotNames } from '../octoweb/index.ts'
import { EditorShell } from '../editor/EditorShell.tsx'
import { SheetView } from '../sheet/SheetView.tsx'
import { parseXlsxToMatrix, pendingSheetImports } from '../sheet/xlsxImport.ts'
import { BoardSession } from '../board/BoardSession.tsx'
import { HtmlDocView } from '../html/HtmlDocView.tsx'
import { isBoardDoc, isBoardIdLocally, rememberBoard } from '../board/boardStore.ts'
import { runMarkdownImport, runDocxImport, ImportContentCorruptError } from '../editor/importFlow.ts'
import '../editor/styles.css'
import {
  DEFAULT_DOC_SPACE,
  DEFAULT_DOC_FOLDER,
  DEFAULT_DOC_ID,
  DOC_TARGET_STORAGE_KEY,
} from '../config.ts'
import { createDoc, getDoc, recordDocView, type DocListItem } from './docsApi.ts'
import { useMemberNames } from '../members/useMemberNames.ts'
import { createInvite, buildInviteUrl } from '../invite/api.ts'
import { canManage, type Role } from '../auth/roles.ts'
import { formatRelative, formatAbsolute } from '../versions/format.ts'
import { PortalMenu } from './PortalMenu.tsx'
import { DocsTabs } from './DocsTabs.tsx'
import { SearchBox } from './SearchBox.tsx'
import { CreatorFilter, CreatorChips, creatorName } from './CreatorFilter.tsx'
import { TypeFilter, TypeChips } from './TypeFilter.tsx'
import { InfiniteList } from './InfiniteList.tsx'
import { useDocsView, type DocsViewKind } from './useDocsView.ts'

export interface DocTarget {
  space: string
  folder: string
  doc: string
  docId: string
  /** `'board'` opens the whiteboard shell; anything else (incl. absent) opens the rich-text editor. */
  docType?: string
  /** Present only for html docs: octo-doc body slug; absent falls back to docId. */
  octoDocSlug?: string
}

/**
 * Excel import entry visibility. #583 originally hid this per owner request ("ships next week").
 * The owner (李庆祥) has since asked in this PR (#737, §5) for the entry to be re-enabled, so the
 * flag is ON — but a formal owner sign-off ON THIS PR is still PENDING and the `needs-human-review`
 * label ensures a human maintainer confirms it before merge. Kept as a flag so it can be toggled
 * per release. Import machinery (parse + float-image + hyperlink) lives in xlsxImport/CollabSheet.
 */
const IMPORT_ENABLED = true

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
function persistDocTarget(target: {
  space: string
  folder: string
  doc: string
  docType?: string
  octoDocSlug?: string
}): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(
      TARGET_STORAGE_KEY,
      JSON.stringify({
        space: target.space,
        folder: target.folder,
        doc: target.doc,
        docType: target.docType,
        octoDocSlug: target.octoDocSlug,
      }),
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
function readDocTarget(uid?: string): DocTarget | null {
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
      // Trust a stored docType; otherwise fall back to the local board registry so a refresh
      // re-opens a board as a board even if the mirror predates the docType field.
      docType:
        typeof parsed.docType === 'string' && parsed.docType
          ? parsed.docType
          : isBoardIdLocally(parsed.doc, uid)
            ? 'board'
            : undefined,
      octoDocSlug:
        typeof parsed.octoDocSlug === 'string' && parsed.octoDocSlug
          ? parsed.octoDocSlug
          : undefined,
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
 *
 * `uid` scopes the board-kind registry lookups (P2) so a shared browser never resolves a docId to
 * a board using another user's local record; omitted (tests / boot before identity) → anon scope.
 */
export function resolveDocTarget(search: string, uid?: string): DocTarget | null {
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
  //    pathname-only re-push wipes `?doc=` (the second-blocker root cause). Addressing stays a
  //    single `?doc=` param (three-party-fixed), so the kind is resolved from the local board
  //    registry rather than a separate query param.
  if (queryDoc) {
    // The mirrored `?doc=` re-render (docUrl only carries the docId) would otherwise clobber the
    // persisted target with a docId-only value, dropping an html doc's kind/slug so HtmlDocView
    // falls back to docId and 404s against octo-doc. Inherit docType/octoDocSlug from the already
    // persisted target when it addresses the same doc; keep the board-registry fallback otherwise.
    const prev = readDocTarget(uid)
    const sameDoc = prev !== null && prev.doc === queryDoc
    const docType =
      sameDoc && prev.docType ? prev.docType : isBoardIdLocally(queryDoc, uid) ? 'board' : undefined
    const octoDocSlug = sameDoc ? prev.octoDocSlug : undefined
    const target: DocTarget = { space, folder, doc: queryDoc, docId: queryDoc, docType, octoDocSlug }
    persistDocTarget(target)
    return target
  }

  // 2. The host already wiped the query (or we navigated in-app): fall back to the mirror.
  const persisted = readDocTarget(uid)
  if (persisted) return persisted

  // 3. Deployment-configured default doc, if any.
  if (DEFAULT_DOC_ID) {
    return { space, folder, doc: DEFAULT_DOC_ID, docId: DEFAULT_DOC_ID }
  }

  return null
}

/**
 * History-state markers we stamp on the docs route's entries so a browser Back/Forward can be
 * told apart from a genuine reload/deep-link (see readDocFromHistory + the popstate handler).
 * `octoDocsDoc` tags the entry that addresses an open doc; `octoDocsList` tags the list entry
 * that sits beneath it. Kept as a small serialisable shape so it survives history.state.
 */
const HISTORY_STATE_DOC = 'octoDocsDoc'
const HISTORY_STATE_LIST = 'octoDocsList'

/** Build the `/docs?…&doc=<id>` URL for the given selection (doc addressing). */
function docUrl(docId: string, space: string, folder: string): string {
  const q = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
  q.set('space', space)
  q.set('folder', folder)
  q.set('doc', docId)
  return `/docs?${q.toString()}`
}

/** Build the `/docs` list URL (doc addressing stripped). */
function listUrl(): string {
  const q = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
  q.delete('doc')
  q.delete('docId')
  q.delete('space')
  q.delete('folder')
  const qs = q.toString()
  return qs ? `/docs?${qs}` : '/docs'
}

/**
 * Mirror the active doc to the URL (`?doc=<id>`) WITHOUT a full navigation.
 *
 * Split-pane note: opening a doc is an in-pane state change (setSelectedDoc), not a
 * `window.location.assign`. We reflect the selection into the URL so the link is
 * shareable/refreshable; neither replaceState nor pushState triggers the host RouteManager's
 * pathname-only re-push (that only fires on `popstate`/`pageshow`), so `?doc=` is not wiped
 * on open. sessionStorage remains the durable mirror for the deep-link/refresh path.
 *
 * `push` controls the history entry (XIN-1172 — the Back/reload → about:blank fix):
 *   - `push: true`  — opening a doc while none was open. We first normalise the CURRENT entry
 *     to the list, then push the doc as its OWN entry. That guarantees a list entry sits
 *     beneath the doc, so a browser Back returns to the list instead of popping past `/docs`
 *     to the tab's initial `about:blank` (the reported blank page). Before this fix opening a
 *     doc only replaceState'd the current entry, leaving no in-app entry to go Back to.
 *   - `push: false` — switching from one open doc to another: stay at the same history depth
 *     (a single doc entry over the one list entry), so Back still lands on the list.
 */
function mirrorDocToUrl(docId: string, space: string, folder: string, push: boolean): void {
  if (typeof window === 'undefined') return
  try {
    const url = docUrl(docId, space, folder)
    if (push) {
      // Normalise the current entry to the list (Back target), then push the doc entry on top.
      window.history.replaceState({ [HISTORY_STATE_LIST]: true }, '', listUrl())
      window.history.pushState({ [HISTORY_STATE_DOC]: docId }, '', url)
    } else {
      window.history.replaceState({ [HISTORY_STATE_DOC]: docId }, '', url)
    }
  } catch {
    // history unavailable: selection still works via state; just not URL-reflected.
  }
}

/**
 * Resolve which doc (if any) a history entry addresses, used by the popstate handler to decide
 * list vs doc after a browser Back/Forward. Prefers the marker we stamped on the entry
 * (`octoDocsDoc`/`octoDocsList`); falls back to the URL query when the state is absent (e.g. the
 * host RouteManager overwrote it on its own popstate re-push). Returns the docId, or null for
 * "this is the list".
 */
export function readDocFromHistory(state: unknown, search: string): string | null {
  const st = state && typeof state === 'object' ? (state as Record<string, unknown>) : null
  if (st) {
    const doc = st[HISTORY_STATE_DOC]
    if (typeof doc === 'string' && doc) return doc
    if (st[HISTORY_STATE_LIST] === true) return null
  }
  try {
    const q = new URLSearchParams(search)
    return q.get('doc') || q.get('docId') || null
  } catch {
    return null
  }
}

/** Reflect "back to list" into the URL (drop doc addressing) without a full navigation. */
function mirrorListToUrl(): void {
  if (typeof window === 'undefined') return
  try {
    window.history.replaceState({ [HISTORY_STATE_LIST]: true }, '', listUrl())
  } catch {
    // ignore
  }
}

/** Document row glyph (sheet of paper with lines) — the existing Docs list icon. */
function DocRowIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 1.5h5L12.5 5v9a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5Z"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
      />
      <path d="M9 1.5V5h3.5" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  )
}

/** Board row glyph — an Excalidraw-style sketch (overlapping square + circle) to mark whiteboards. */
function BoardRowIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="8" height="7" rx="1" stroke="currentColor" strokeWidth="1" fill="none" />
      <circle cx="10.5" cy="9.5" r="3" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  )
}

/**
 * Sheet row glyph — a grid to mark spreadsheets, visually distinct from the plain-doc and board
 * glyphs so a `docType==='sheet'` row is never mistaken for a document (XIN-1188 icon three-way).
 */
function SheetRowIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="1" stroke="currentColor" strokeWidth="1" fill="none" />
      <path d="M2 6.5h12M2 10h12M6 2.5v11M10 2.5v11" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

/**
 * HTML row glyph — a document outline with a `</>` angle-bracket mark in the center to identify a
 * web/HTML doc, drawn in the same stroked style (no fill blocks) as the doc/board/sheet glyphs so a
 * `docType==='html'` row reads as a peer of the other three kinds.
 */
function HtmlRowIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 1.5h5L12.5 5v9a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5Z"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
      />
      <path d="M9 1.5V5h3.5" stroke="currentColor" strokeWidth="1" fill="none" />
      <path d="M7 8.5 5.5 10 7 11.5M9 8.5 10.5 10 9 11.5" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Layered empty states A–F (frontend-design §5.3). Each variant carries its OWN i18n title + CTA
 * keys — A ("看", browse) and B ("建", create) are deliberately NOT merged (product MF1). C/D/F cover
 * a single "condition matched nothing" (search / creator / type) and offer that one clear
 * affordance; E is the combined bucket for ANY 2+ active conditions and renders each matching clear
 * (search / creator / type) conditionally on the active flags.
 */
function DocsEmptyState({
  kind,
  query,
  hasQuery,
  hasCreators,
  hasTypes,
  onCreate,
  onBrowseMine,
  onClearSearch,
  onClearFilter,
  onClearTypes,
}: {
  kind: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
  query: string
  hasQuery: boolean
  hasCreators: boolean
  hasTypes: boolean
  onCreate: () => void
  onBrowseMine: () => void
  onClearSearch: () => void
  onClearFilter: () => void
  onClearTypes: () => void
}): React.ReactElement {
  const kw = query.trim()
  return (
    <div className="octo-docs-list-state octo-docs-list-empty">
      {kind === 'A' && (
        <>
          <p className="octo-docs-empty-title">{t('docs.empty.recentNone')}</p>
          <button type="button" className="octo-docs-empty-cta" onClick={onBrowseMine}>
            {t('docs.empty.recentNoneCta')}
          </button>
        </>
      )}
      {kind === 'B' && (
        <>
          <p className="octo-docs-empty-title">{t('docs.empty.myDocsNone')}</p>
          <button type="button" className="octo-docs-empty-cta" onClick={onCreate}>
            {t('docs.empty.myDocsNoneCta')}
          </button>
        </>
      )}
      {kind === 'C' && (
        <>
          <p className="octo-docs-empty-title">
            {t('docs.empty.searchNone', { values: { kw } })}
          </p>
          <button type="button" className="octo-docs-empty-cta" onClick={onClearSearch}>
            {t('docs.empty.searchNoneCta')}
          </button>
        </>
      )}
      {kind === 'D' && (
        <>
          <p className="octo-docs-empty-title">{t('docs.empty.filterNone')}</p>
          <button type="button" className="octo-docs-empty-cta" onClick={onClearFilter}>
            {t('docs.empty.filterNoneCta')}
          </button>
        </>
      )}
      {kind === 'F' && (
        <>
          <p className="octo-docs-empty-title">{t('docs.empty.typeNone')}</p>
          <button type="button" className="octo-docs-empty-cta" onClick={onClearTypes}>
            {t('docs.empty.typeNoneCta')}
          </button>
        </>
      )}
      {kind === 'E' && (
        <>
          <p className="octo-docs-empty-title">{t('docs.empty.combinedNone')}</p>
          <div className="octo-docs-empty-actions">
            {hasQuery && (
              <button type="button" className="octo-docs-empty-cta" onClick={onClearSearch}>
                {t('docs.empty.searchNoneCta')}
              </button>
            )}
            {hasCreators && (
              <button type="button" className="octo-docs-empty-cta" onClick={onClearFilter}>
                {t('docs.empty.filterNoneCta')}
              </button>
            )}
            {hasTypes && (
              <button type="button" className="octo-docs-empty-cta" onClick={onClearTypes}>
                {t('docs.empty.typeNoneCta')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Document list landing — shown when `/docs` is opened without a specific doc addressed.
 * Lists documents the caller owns or is a member of (GET /api/v1/docs) and offers a
 * "new document" action (POST /api/v1/docs). Selecting/creating navigates to the editor.
 */
function DocsList({
  space,
  folder,
  uid,
  selectedDocId,
  onSelect,
  reloadToken,
  botUids,
}: {
  space: string
  folder: string
  /** Authenticated uid — scopes the board-kind registry lookups/writes (P2). */
  uid: string
  selectedDocId: string | null
  onSelect: (docId: string, docType?: string, octoDocSlug?: string) => void
  reloadToken?: number
  /** uids of every bot in the space; a row whose ownerId is here shows a bot badge. */
  botUids: Set<string>
}): React.ReactElement {
  const [creating, setCreating] = useState(false)
  const [newMenuAt, setNewMenuAt] = useState<{ left: number; top: number } | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  // Client-side pin (置顶) — persisted in localStorage; pinned docs sort to the top. Pin is a
  // "我的文档" affordance ONLY: the recent tab renders the server's `viewed_at DESC` order verbatim
  // with no client re-sort and no pin menu item (frontend-design §5.4).
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
  // Transient create/import error (distinct from a per-view list-load error). Shown as a state line
  // above the list; cleared on the next successful create/import.
  const [createError, setCreateError] = useState<string | null>(null)

  // Two tabs, each with its OWN search / creator filter / items / pagination state
  // (frontend-design §2.1). Both instances stay mounted so per-view state survives a tab switch and
  // is restored + re-sent on return (AC-2.3.2). `reloadToken` (parent rename/delete) and a Space
  // switch refetch both views. The stale-response guard now lives inside useDocsView (per view).
  const token = reloadToken ?? 0
  const recentView = useDocsView('recent', space, folder, token)
  const mineView = useDocsView('mine', space, folder, token)
  const [activeView, setActiveView] = useState<DocsViewKind>('recent')
  const view = activeView === 'recent' ? recentView : mineView

  // Creator-name fallback for the recent filter when the facet omits a name (frontend-design §3.5 /
  // §1.7): the space member-name map, else the raw uid (resolved in creatorName()).
  const names = useMemberNames(space)
  const nameFallback = useCallback((id: string) => names.get(id), [names])

  const onTab = (next: DocsViewKind) => {
    if (next === activeView) return
    setActiveView(next)
    // Restore the target view's remembered q/creators AND re-send its request (AC-2.3.2).
    ;(next === 'recent' ? recentView : mineView).reload()
  }

  // Refresh both tabs after an in-list create/import so a new doc appears without a full remount.
  const reloadViews = useCallback(() => {
    recentView.reload()
    mineView.reload()
  }, [recentView, mineView])

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

  const onCreate = async (docType?: string) => {
    if (creating) return
    setCreating(true)
    try {
      const created = await createDoc({
        title:
          docType === 'sheet'
            ? t('docs.sheet.untitled')
            : docType === 'board'
              ? t('docs.board.untitled')
              : t('docs.state.untitled'),
        spaceId: space || undefined,
        folderId: folder || undefined,
        // Pass the kind through the docType seam; the backend stamps the new doc accordingly and
        // the creator becomes admin (AC3). For boards, also record the id locally so a refresh /
        // deep-link re-opens the whiteboard even if the list response omits docType.
        docType,
      })
      if (docType === 'board') rememberBoard(created.docId, uid)
      // New docs land in the list; select it inline (right pane opens, list stays).
      onSelect(created.docId, created.docType || docType)
      reloadViews()
      setCreating(false)
    } catch {
      setCreateError(t('docs.state.error'))
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
      setCreateError(t('docs.sheet.importTooLarge'))
      return
    }
    setCreating(true)
    try {
      const result = await parseXlsxToMatrix(await file.arrayBuffer())
      if (!result.ok) {
        setCreateError(result.reason === 'empty' ? t('docs.sheet.importEmpty') : t('docs.sheet.importError'))
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
      reloadViews()
      // Every visible worksheet is imported now (multi-sheet), so the only remaining caveat
      // is per-sheet truncation of an oversized grid.
      if (parsed.truncated) {
        setCreateError(t('docs.sheet.importTruncated'))
      }
    } catch {
      setCreateError(t('docs.state.error'))
    } finally {
      setCreating(false)
    }
  }

  // Rows for the active view. mine keeps the pinned-first client sort over the server order; recent
  // renders the server's `viewed_at DESC` order verbatim (no pin re-sort — frontend-design §5.4).
  const displayItems =
    activeView === 'mine'
      ? [...mineView.items].sort(
          (a, b) => (pinned.has(b.docId) ? 1 : 0) - (pinned.has(a.docId) ? 1 : 0),
        )
      : recentView.items

  const renderRow = (d: DocListItem): React.ReactNode => {
    const active = d.docId === selectedDocId
    const hasTitle = !!d.title && d.title.trim().length > 0
    const label = hasTitle ? d.title : t('docs.state.untitled')
    const board = isBoardDoc(d, uid)
    // Kind we can assert without a round-trip: a known board (API `docType==='board'` or the
    // creator's local registry, both via isBoardDoc), an explicit `'doc'`, or an explicit `'sheet'`
    // so a known spreadsheet row opens straight into SheetView. When the list API omitted docType
    // AND we have no local board record — a NON-creator viewing a shared board — pass `undefined`
    // so openDoc resolves the authoritative kind via getDoc (the M2 routing bug).
    const knownKind: 'board' | 'doc' | 'sheet' | 'html' | undefined = board
      ? 'board'
      : d.docType === 'sheet'
        ? 'sheet'
        : d.docType === 'html'
          ? 'html'
          : d.docType === 'doc'
            ? 'doc'
            : undefined
    // Row-icon kind (visual only, always concrete): a known board, then an explicit sheet, else a
    // plain doc — the three-way distinction so a spreadsheet never renders as a document icon
    // (XIN-1188). Independent of `knownKind` above, which stays `undefined` for an unresolved
    // shared row so openDoc can still resolve the authoritative shell via getDoc.
    const iconKind: 'board' | 'sheet' | 'html' | 'doc' = board
      ? 'board'
      : d.docType === 'sheet'
        ? 'sheet'
        : d.docType === 'html'
          ? 'html'
          : 'doc'
    const kindLabel =
      iconKind === 'board'
        ? t('docs.list.kindBoard')
        : iconKind === 'sheet'
          ? t('docs.list.kindSheet')
          : iconKind === 'html'
            ? t('docs.list.kindHtml')
            : t('docs.list.kindDoc')
    // Recent rows put the creator on its OWN line, then a SINGLE merged time line reporting only
    // the LATEST event (XIN-1236 merged design). Mine rows keep the plain "updated" sub-line
    // (frontend-design §2.1 / §5.1).
    const creator =
      activeView === 'recent'
        ? creatorName(d.ownerId, recentView.creatorOptions, nameFallback)
        : ''
    // Compare the current user's view time against the document's own update time; the later of
    // the two is the event we surface. Equal / very-close / missing-update all prefer the VIEW
    // (boss decision), so the update only "wins" when it is strictly newer than the view.
    const viewedTime = d.viewedAt ? Date.parse(d.viewedAt) : NaN
    const updatedTime = d.updatedAt ? Date.parse(d.updatedAt) : NaN
    const updateIsLatest =
      activeView === 'recent' &&
      Number.isFinite(updatedTime) &&
      (!Number.isFinite(viewedTime) || updatedTime > viewedTime)
    // When the update wins, label it with WHO last updated the doc (XIN-1240 `updatedBy`={uid,name}).
    // Prefer the backend-resolved name, fall back to the space member-name map by uid, and when no
    // updater is known drop to an unnamed "更新于 X" line rather than guessing (never borrow the
    // creator's name for the updater).
    const updaterName =
      (d.updatedBy?.name || '').trim() ||
      (d.updatedBy?.uid ? nameFallback(d.updatedBy.uid) || '' : '')
    // "mine" rows keep their existing single "updated" sub-line, unchanged.
    const mineStampIso = activeView === 'mine' ? d.updatedAt : undefined
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
          onClick={() => onSelect(d.docId, knownKind, d.octoDocSlug)}
          aria-current={active ? 'true' : undefined}
        >
          <span
            className="octo-docs-list-row-icon"
            aria-label={kindLabel}
            title={kindLabel}
          >
            {iconKind === 'board' ? (
              <BoardRowIcon />
            ) : iconKind === 'sheet' ? (
              <SheetRowIcon />
            ) : iconKind === 'html' ? (
              <HtmlRowIcon />
            ) : (
              <DocRowIcon />
            )}
          </span>
          <span className="octo-docs-list-row-text">
            <span className="octo-docs-list-row-title-line">
              <span
                className={
                  hasTitle
                    ? 'octo-docs-list-row-title'
                    : 'octo-docs-list-row-title octo-docs-list-row-title-untitled'
                }
              >
                {label}
              </span>
              {botUids.has(d.ownerId) && (
                <span
                  className="octo-docs-list-row-bot-badge"
                  title={t('docs.list.botBadge')}
                  aria-label={t('docs.list.botBadge')}
                >
                  {t('docs.list.botBadge')}
                </span>
              )}
            </span>
            {activeView === 'recent' ? (
              // Recent rows: creator on its own line, then ONE merged time line showing only the
              // latest event — "<updater> 更新于 X" when the doc was updated AFTER the user last
              // viewed it, otherwise "你查看于 X". Collapsing the two timestamps into a single
              // most-recent line keeps the creator's name away from any "…于 X" time so the row can
              // never be misread as "the creator viewed it" (XIN-1236 merged design).
              <>
                {creator && (
                  <span className="octo-docs-list-row-sub octo-docs-list-row-creator">
                    {t('docs.list.createdBy')} {creator}
                  </span>
                )}
                {updateIsLatest && d.updatedAt ? (
                  <span
                    className="octo-docs-list-row-sub octo-docs-list-row-updated"
                    title={formatAbsolute(d.updatedAt)}
                  >
                    {updaterName
                      ? `${t('docs.list.updatedBy', { values: { name: updaterName } })} ${formatRelative(d.updatedAt)}`
                      : `${t('docs.list.updatedAt')} ${formatRelative(d.updatedAt)}`}
                  </span>
                ) : d.viewedAt ? (
                  <span
                    className="octo-docs-list-row-sub octo-docs-list-row-viewed"
                    title={formatAbsolute(d.viewedAt)}
                  >
                    {t('docs.list.viewedBySelf')} {formatRelative(d.viewedAt)}
                  </span>
                ) : null}
              </>
            ) : (
              mineStampIso && (
                <span className="octo-docs-list-row-sub" title={formatAbsolute(mineStampIso)}>
                  {t('docs.list.updatedAt')} {formatRelative(mineStampIso)}
                </span>
              )
            )}
          </span>
        </button>
      </li>
    )
  }

  // "从 Markdown 导入" → pick a .md file, parse it to a ProseMirror document client-side, create a
  // NEW doc (title from the H1 / filename), stash the parsed content, then open it. Import never
  // touches an existing doc — it always lands in its own new file, mirroring the Excel import flow.
  const onImportMarkdown = async () => {
    if (creating) return
    setCreating(true)
    try {
      const result = await runMarkdownImport(space || undefined, folder || undefined, t)
      onSelect(result.docId, 'doc')
      reloadViews()
    } catch (err) {
      // User-cancelled picker rejects with a benign error; only surface real failures.
      if (err instanceof ImportContentCorruptError) {
        setCreateError(t('docs.toolbar.importCorrupt'))
      } else if (err instanceof Error && /取消|cancel/i.test(err.message)) {
        // silent: user closed the file picker
      } else if (err instanceof Error && /mdOnly|Markdown|\.md/i.test(err.message)) {
        // Wrong file type picked (guard threw docs.import.mdOnly).
        setCreateError(t('docs.import.mdOnly'))
      } else {
        setCreateError(t('docs.import.mdFailed'))
      }
    } finally {
      setCreating(false)
    }
  }

  // "从 Word 导入" → pick a .docx file, create a NEW doc, POST the file to the server-side
  // importer (parses OOXML → ProseMirror JSON, uploads embedded images scoped to the new doc),
  // stash the returned content, then open it. Like every import path, it lands in its own new
  // file and never overwrites an existing doc.
  const onImportWord = async () => {
    if (creating) return
    setCreating(true)
    try {
      const result = await runDocxImport(space || undefined, folder || undefined, t)
      onSelect(result.docId, 'doc')
      reloadViews()
    } catch (err) {
      if (err instanceof ImportContentCorruptError) {
        setCreateError(t('docs.toolbar.importCorrupt'))
      } else if (err instanceof Error && /取消|cancel/i.test(err.message)) {
        // silent: user closed the file picker
      } else {
        const status = (err as { response?: { status?: number } })?.response?.status
        const body = (err as { response?: { data?: { error?: string; reason?: string } } })
          ?.response?.data
        if (status === 413) {
          // The server rejected the upload as too large / too complex (zip-bomb
          // guard, size / entry-count / compression-ratio bound).
          setCreateError(t('docs.import.wordTooLarge'))
        } else if (body?.error === 'empty_upload') {
          setCreateError(t('docs.import.wordEmpty'))
        } else if (body?.error === 'import_unsafe') {
          // Backend hit a hard safety bound; show the precise reason when known.
          const key = `docs.import.docxReason.${body.reason ?? ''}`
          const mapped = t(key)
          setCreateError(mapped === key ? t('docs.import.wordTooLarge') : mapped)
        } else {
          setCreateError(t('docs.import.wordError'))
        }
      }
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
            aria-label={t('docs.list.newMenu')}
            title={t('docs.list.newMenu')}
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
                void onCreate('board')
              }}
            >
              <span className="octo-docs-new-menu-icon" aria-hidden="true"><BoardRowIcon /></span>
              {t('docs.list.newBoard')}
            </button>
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
            {/* Import entries merged into the "New" dropdown (was a standalone "Import" button).
                Flag ON; formal owner sign-off still PENDING, gated by needs-human-review (was hidden
                in #583). Toggle via IMPORT_ENABLED. Handlers unchanged — this only moves the entry. */}
            {IMPORT_ENABLED && (
              <>
                <div
                  role="separator"
                  aria-hidden="true"
                  style={{ borderTop: '1px solid #ebebeb', margin: '6px 0' }}
                />
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={creating}
                  style={{ display: 'block', width: '100%', textAlign: 'left' }}
                  onClick={() => {
                    setNewMenuAt(null)
                    importInputRef.current?.click()
                  }}
                >
                  📄 {t('docs.sheet.importExcel')}
                </button>
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={creating}
                  style={{ display: 'block', width: '100%', textAlign: 'left' }}
                  onClick={() => {
                    setNewMenuAt(null)
                    void onImportWord()
                  }}
                >
                  📃 {t('docs.import.word')}
                </button>
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={creating}
                  style={{ display: 'block', width: '100%', textAlign: 'left' }}
                  onClick={() => {
                    setNewMenuAt(null)
                    void onImportMarkdown()
                  }}
                >
                  📝 {t('docs.import.markdown')}
                </button>
              </>
            )}
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
      <DocsTabs active={activeView} onChange={onTab} />
      <div className="octo-docs-toolbar">
        <SearchBox value={view.q} onSearch={view.setQuery} onClear={view.clearQuery} />
        {/* Creator + Type wrap together as one unit so a narrow toolbar drops the whole
            group to a second row (search stays on row 1) instead of stranding Type alone.
            On the my-docs tab the group holds only the Type filter and still lays out fine. */}
        <div className="octo-docs-filter-group">
          {activeView === 'recent' && (
            <CreatorFilter
              options={recentView.creatorOptions}
              selected={recentView.creators}
              onToggle={recentView.toggleCreator}
              nameFallback={nameFallback}
            />
          )}
          {/* Type filter lives on BOTH tabs (creator is recent-only). Uses the active view's per-tab
              types state so each tab remembers its own selection across switches. */}
          <TypeFilter selected={view.types} onToggle={view.toggleType} />
        </div>
      </div>
      {activeView === 'recent' && (
        <CreatorChips
          options={recentView.creatorOptions}
          selected={recentView.creators}
          onToggle={recentView.toggleCreator}
          onClearAll={recentView.clearCreators}
          nameFallback={nameFallback}
        />
      )}
      <TypeChips selected={view.types} onToggle={view.toggleType} onClearAll={view.clearTypes} />
      {createError && <p className="octo-docs-list-state octo-error">{createError}</p>}
      {view.phase === 'loading' && (
        <p className="octo-docs-list-state">{t('docs.state.loading')}</p>
      )}
      {view.phase === 'error' && (
        <p className="octo-docs-list-state octo-error">
          {t('docs.state.error')}
          <button type="button" className="octo-docs-list-retry" onClick={view.retry}>
            {t('docs.state.retry')}
          </button>
        </p>
      )}
      {view.phase === 'ready' && view.empty && (
        <DocsEmptyState
          kind={view.empty}
          query={view.q}
          hasQuery={view.q.trim().length > 0}
          hasCreators={view.creators.length > 0}
          hasTypes={view.types.length > 0}
          onCreate={() => void onCreate()}
          onBrowseMine={() => onTab('mine')}
          onClearSearch={view.clearQuery}
          onClearFilter={view.clearCreators}
          onClearTypes={view.clearTypes}
        />
      )}
      {view.phase === 'ready' && !view.empty && (
        <InfiniteList
          items={displayItems}
          hasMore={view.hasMore}
          moreStatus={view.moreStatus}
          resultSetId={view.resultSetId}
          onLoadMore={view.loadMore}
          renderRow={renderRow}
        />
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
            {activeView === 'mine' && (
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
            )}
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

  // Tracks the most recently requested open so an in-flight kind lookup that resolves after a
  // newer click — OR after a Space switch (see backToList) — is discarded; the latest selection
  // always wins (no stale shell from a race, no cross-Space carry from a late resolve). Declared
  // here, above backToList, so the Space-switch reconciler can invalidate a pending open token.
  const latestOpenRef = useRef<string | null>(null)

  // Initial selection from URL deep-link / persisted target (so a shared `/docs?doc=` or a
  // refresh opens that doc in the right pane on first paint).
  const initialTarget = useRef(
    resolveDocTarget(typeof window !== 'undefined' ? window.location.search : '', uid),
  )
  // Kind we can assert for the initial target WITHOUT a round-trip: an explicit stored docType,
  // or a board surfaced by this client's local registry (the creator's own board). When the
  // target carries a docId but NO assertable kind — a direct deep-link to a shared board this
  // client never created (owner opening the board link, B writer's shared link) — we DEFER the
  // shell choice to an authoritative getDoc on mount (see the mount effect below) instead of
  // seeding the rich-text editor. Seeding the editor here was the owner direct-open bug: the
  // deep-link path resolved kind from the local registry only and never fetched doc metadata, so
  // an owner direct-opening a whiteboard fell back to the Docs editor (canvas=0). This mirrors
  // what the list-open path already does (openDoc → getDoc for unknown kinds), aligning the two
  // open paths so every member lands on the whiteboard regardless of how they entered.
  // Kinds we can assert from the stored docType WITHOUT a getDoc round-trip: 'board',
  // 'sheet' (SheetView) and 'html' (read-only HtmlDocView) are all deterministic shells, so a
  // persisted/deep-link target that already carries one of them opens straight into the right
  // shell on first paint — no getDoc detour, and (for html) no risk of falling back to the
  // rich-text editor. Only a docId with an UNKNOWN kind still defers to getDoc on mount.
  const initialKnownKind: 'board' | 'doc' | 'sheet' | 'html' | undefined =
    initialTarget.current?.docType === 'board'
      ? 'board'
      : initialTarget.current?.docType === 'sheet'
        ? 'sheet'
        : initialTarget.current?.docType === 'html'
          ? 'html'
          : initialTarget.current?.docType === 'doc'
            ? 'doc'
            : undefined
  const [selectedDocId, setSelectedDocId] = useState<string | null>(
    () => (initialKnownKind ? (initialTarget.current?.docId ?? null) : null),
  )
  // The kind of the open doc (`'board'` → whiteboard shell, `'sheet'` → SheetView, else rich-text
  // editor). Tracked alongside the id so the right pane renders the correct shell across deep-link /
  // refresh. Seeded from the initial target; a deep-link/refresh whose kind is unknown is resolved
  // via getDoc (see the mount effect).
  const [selectedDocType, setSelectedDocType] = useState<string | undefined>(
    () => initialKnownKind,
  )
  const [selectedOctoDocSlug, setSelectedOctoDocSlug] = useState<string | undefined>(
    () => initialTarget.current?.octoDocSlug,
  )

  // Live mirror of selectedDocId for callbacks pushed imperatively into the host route pane. The
  // editor/sheet/board shells are pushed via routeRight.replaceToRoot in commitOpen — a ONE-TIME
  // element snapshot that bakes in whatever `onDocDeleted` closure existed at push time. Because
  // that push runs synchronously right after setSelectedDocId(X) (before the state re-render), the
  // baked-in closure still sees the PRE-open selectedDocId (null on first open, the previous doc on
  // a switch). onDocDeleted must therefore compare against this ref — the always-current id — not
  // the closed-over state, or the `docId === selectedDocId` guard never matches and the deleted
  // doc's shell is left resident in the right pane (XIN-1050).
  const selectedDocIdRef = useRef<string | null>(selectedDocId)
  useEffect(() => {
    selectedDocIdRef.current = selectedDocId
  }, [selectedDocId])
  // Companion live mirror of the open doc's KIND, read by the nav-reactivation handler below so it
  // re-pushes the right shell (editor vs board vs sheet) without a stale closure — same reason
  // selectedDocIdRef exists.
  const selectedDocTypeRef = useRef<string | undefined>(selectedDocType)
  useEffect(() => {
    selectedDocTypeRef.current = selectedDocType
  }, [selectedDocType])
  // Companion live mirror of the open doc's octo-doc slug — the nav-reactivation re-push below
  // needs it, else an html doc re-opens with slug=undefined and HtmlDocView falls back to docId,
  // 404ing against the slug-addressed octo-doc render endpoint.
  const selectedOctoDocSlugRef = useRef<string | undefined>(selectedOctoDocSlug)
  useEffect(() => {
    selectedOctoDocSlugRef.current = selectedOctoDocSlug
  }, [selectedOctoDocSlug])

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

  // Bot uids in the space, used to badge docs created by a bot in the list. Reuses the single
  // non-viewer-scoped `GET /robot/space_bots` request (same seam memberNames backfill uses) so
  // there is no per-uid fanout / extra permission. Best-effort: an empty set on failure just
  // means no badge is shown. Refetched on Space switch.
  const [botUids, setBotUids] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    let active = true
    void fetchSpaceBotNames(space)
      .then((bots) => {
        if (active) setBotUids(new Set(bots.map((b) => b.uid)))
      })
      .catch(() => {
        if (active) setBotUids(new Set())
      })
    return () => {
      active = false
    }
  }, [space])

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
    setSelectedDocType(undefined)
    setSelectedOctoDocSlug(undefined)
    // Invalidate any in-flight unknown-kind open (openDoc → getDoc still pending). Without this,
    // a Space switch (this is also the onSpaceChanged reconciler) leaves latestOpenRef pointing at
    // the previous Space's docId, so a late getDoc resolve would pass the `latestOpenRef === docId`
    // staleness guard and commitOpen the OLD doc into the NEW Space — the async twin of the
    // synchronous cross-Space carry reconciled here (XIN-448 / XIN-528).
    latestOpenRef.current = null
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
  // We read selectedDocIdRef (the live id), NOT the closed-over selectedDocId: this callback is
  // baked into the shell snapshot pushed by commitOpen before the open's state update commits, so
  // the closure's selectedDocId is stale (pre-open). Reading the ref makes the guard match the
  // actually-open doc across doc/sheet/board (XIN-1050).
  const onDocDeleted = useCallback(
    (docId: string) => {
      if (docId === selectedDocIdRef.current) backToList()
      setListReloadToken((n) => n + 1)
    },
    [backToList],
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

  // Whiteboard counterpart of buildEditor — same lifecycle wiring (exit / rename / delete), but
  // renders the Excalidraw shell. Used when the selected doc's kind is `'board'`. Unlike the M1
  // build, this goes through BoardSession so a live collab session (Y.Doc + HocuspocusProvider) is
  // opened and handed to BoardShell — without it the board ran local-only with no WebSocket (XIN-55).
  const buildBoard = useCallback(
    (docId: string, onBack?: () => void) => (
      <BoardSession
        key={docId}
        docId={docId}
        title={t('docs.state.untitled')}
        uid={uid}
        space={space}
        folder={folder}
        userName={names.get(uid) || uid}
        onBack={onBack}
        onExit={backToList}
        onTitleSaved={onTitleSaved}
        onDeleted={onDocDeleted}
        onOpenInNewPage={() => onOpenInNewPage(docId)}
      />
    ),
    [uid, space, folder, names, onTitleSaved, backToList, onDocDeleted, onOpenInNewPage],
  )

  // Choose the right-pane renderer by doc type: a spreadsheet ('sheet') mounts the collaborative
  // Univer SheetView; a whiteboard ('board') mounts the Excalidraw shell; an agent-authored
  // read-only HTML doc ('html') mounts the view-only HtmlDocView; everything else (incl.
  // unknown/absent kind) uses the Tiptap EditorShell — the safe default for legacy docs.
  const buildRightPane = useCallback(
    (
      docId: string,
      docType: string | undefined,
      onBack?: () => void,
      octoDocSlug?: string,
    ) => {
      // Read-only HTML: NO editor/collab wiring — a human may only view it (comments arrive in 2b).
      if (docType === 'html') {
        return <HtmlDocView key={docId} docId={docId} slug={octoDocSlug} space={space} onDeleted={onDocDeleted} />
      }
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
      if (docType === 'board') {
        return buildBoard(docId, onBack)
      }
      return buildEditor(docId, onBack)
    },
    [uid, space, folder, names, onTitleSaved, onDocDeleted, buildBoard, buildEditor],
  )

  // Commit an open once the doc's kind is known: set selection state, mirror the target
  // (durable sessionStorage + shareable `?doc=` URL), and push the matching shell into the host's
  // right pane. Split out from openDoc so the kind can be resolved asynchronously first.
  const commitOpen = useCallback(
    (docId: string, docType: 'board' | 'doc' | 'sheet' | 'html', octoDocSlug?: string) => {
      const htmlSlug = docType === 'html' ? octoDocSlug : undefined
      // Whether a doc was already open BEFORE this commit — read from the live ref (not the
      // closed-over state, which lags a render). Drives whether we PUSH a new history entry
      // (first open from the list) or REPLACE in place (doc → doc switch). See mirrorDocToUrl.
      const wasOpen = selectedDocIdRef.current !== null
      setSelectedDocId(docId)
      setSelectedDocType(docType)
      setSelectedOctoDocSlug(htmlSlug)
      // View ingest (frontend-design §3.4 / XIN-1098 API 1): record that this doc was opened so it
      // surfaces in "最近查看". Fire-and-forget on the open success path — read-only opens count too,
      // the call is idempotent (server UPSERTs on (uid,docId)), and a failure never blocks the open.
      void recordDocView(docId)
      // Durable mirror (survives the host's query-wiping re-push) + shareable URL. On a first open
      // we push a doc entry over a normalised list entry so a browser Back returns to the list, not
      // the tab's initial about:blank (XIN-1172).
      persistDocTarget({ space, folder, doc: docId, docType, octoDocSlug: htmlSlug })
      mirrorDocToUrl(docId, space, folder, !wasOpen)
      const push = (dt: string | undefined) => {
        setSelectedDocType(dt)
        setSelectedOctoDocSlug(dt === 'html' ? htmlSlug : undefined)
        if (routeRight) {
          try {
            routeRight.replaceToRoot(buildRightPane(docId, dt, undefined, htmlSlug) as unknown)
          } catch {
            // ignore — fall back to inline render below if the host pane rejects.
          }
        }
      }
      // Type known from the list row → render immediately; otherwise resolve it
      // (deep-link / created doc) so we pick SheetView vs BoardShell vs EditorShell correctly.
      if (docType !== undefined) push(docType)
      else void getDoc(docId).then((m) => push(m.docType)).catch(() => push(undefined))
    },
    [space, folder, routeRight, buildRightPane],
  )

  const openDoc = useCallback(
    (docId: string, docType?: string, octoDocSlug?: string) => {
      latestOpenRef.current = docId
      // Known kind — the creator's own board (API `docType` or the local registry, both surfaced
      // by isBoardDoc at the call site), an explicit `'doc'`, a `'sheet'` (created / imported /
      // known list row), or an agent-authored read-only `'html'` doc: open the right shell
      // immediately without a round-trip.
      if (docType === 'board' || docType === 'doc' || docType === 'sheet' || docType === 'html') {
        commitOpen(docId, docType, octoDocSlug)
        return
      }
      // Unknown kind: the list API omitted `docType` AND this client has no local board record.
      // That is exactly the non-creator gap — the M1 board-kind fallback (a creator-local
      // localStorage registry) cannot cover other members, so a shared board would wrongly open
      // in the rich-text editor (canvas=0). Resolve the authoritative kind from the per-doc meta
      // (GET /docs/{id}) before choosing a shell, so a board opens as a board for every member.
      // Default to the rich-text editor only when the lookup can't confirm a board (legacy docs /
      // a backend that doesn't persist docType).
      //
      // Capture the Space this open was requested under. A Space switch mid-flight advances
      // spaceRef.current (synchronously, before backToList runs), so the resolve below is
      // discarded if it lands in a different Space — belt-and-suspenders with backToList nulling
      // latestOpenRef, and it also covers a same-docId re-open across a switch (XIN-528).
      const requestedSpace = spaceRef.current
      const superseded = () =>
        latestOpenRef.current !== docId || spaceRef.current !== requestedSpace
      getDoc(docId)
        .then((meta) => {
          if (superseded()) return // superseded by a newer open or a Space switch
          // Preserve the resolved kind verbatim: a real 'sheet' must reach SheetView, a 'board'
          // the whiteboard shell, an 'html' the read-only view; everything else falls back to the
          // rich-text editor.
          commitOpen(
            docId,
            meta?.docType === 'board'
              ? 'board'
              : meta?.docType === 'sheet'
                ? 'sheet'
                : meta?.docType === 'html'
                  ? 'html'
                  : 'doc',
            meta?.octoDocSlug,
          )
        })
        .catch(() => {
          if (superseded()) return
          commitOpen(docId, 'doc')
        })
    },
    [commitOpen],
  )

  // On mount, ALWAYS occupy the right pane so the host chat placeholder never shows through
  // (the contentRight race). If a doc is pre-selected with a KNOWN kind (deep-link / persisted
  // target whose kind the registry or stored docType already settled) push the editor/board;
  // otherwise push the docs empty state. Either way the routeRight queue is non-empty from first
  // paint, so entering /docs is deterministically full-width docs — never the intermittent
  // chat-placeholder regression.
  //
  // When the initial target carries a docId but an UNKNOWN kind (a direct deep-link to a board
  // this client didn't create), we resolve the authoritative kind via openDoc → getDoc and let
  // it push the right shell once known. Until then the pane shows the empty state, not a wrongly
  // chosen editor — this is the owner direct-open fix (the deep-link path now fetches doc
  // metadata instead of falling back to the Docs editor).
  useEffect(() => {
    const needsKindResolve = !!initialTarget.current?.docId && !initialKnownKind
    if (routeRight) {
      try {
        if (selectedDocId) {
          routeRight.replaceToRoot(
            buildRightPane(selectedDocId, selectedDocType, undefined, selectedOctoDocSlug) as unknown,
          )
        } else {
          routeRight.replaceToRoot(buildEmptyState() as unknown)
        }
      } catch {
        // ignore
      }
    }
    // Resolve an unknown-kind deep-link target authoritatively, then open the matching shell.
    // openDoc(undefined) takes the getDoc branch (sheet → SheetView, board → whiteboard, else
    // editor) and commits the selection (state + durable mirror + URL), so the host's later
    // query-wiping re-render re-opens the same shell. Owner direct-open and B writer's shared link
    // converge here.
    if (needsKindResolve) {
      openDoc(initialTarget.current!.docId, undefined)
    }
    // Only on mount: subsequent selections are pushed by openDoc / backToList.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-assert docs' ownership of the right pane whenever the user RE-ENTERS via the NavRail
  // "文档" icon. This is what makes the nav-icon entry render identically to a direct/refresh
  // `/docs` load (XIN-1165). The mechanism it repairs:
  //   - apps/web Pages/Main `onMenuClick` calls `WKApp.routeRight.popToRoot()` for a non-chat
  //     menu, EMPTYING the shared right pane on every docs nav click;
  //   - but MainContentLeft keeps `/docs` mounted and only toggles `display`, so DocsHome does
  //     NOT remount and the mount-only effect above never re-runs to refill the pane;
  //   - the deep-link / hard-load activation path (MainVM.didMount / activatePendingRouteMenu)
  //     deliberately does NOT popToRoot, so a direct `/docs` always keeps the pane full.
  // Net effect before this fix: nav-icon return left the right pane empty → the host chat
  // placeholder (the always-present base layer of the right viewqueue) showed through, so the
  // two entries diverged and "开文档→返回/reload" appeared to fall back. We re-push exactly what
  // the mount effect would: the open doc's shell if one is selected (its React state survives the
  // display-toggle), otherwise the docs empty state — never leaving the queue empty. Refs keep the
  // handler reading the CURRENT selection AND the CURRENT buildRightPane (which is re-created on a
  // Space switch / member-name resolve) so a re-push never rebuilds the editor against a stale
  // Space (the cross-Space session leak reconciled in XIN-448).
  const buildRightPaneRef = useRef(buildRightPane)
  useEffect(() => {
    buildRightPaneRef.current = buildRightPane
  }, [buildRightPane])
  useEffect(() => {
    if (!routeRight) return
    return onNavMenuActivated('docs', () => {
      try {
        const id = selectedDocIdRef.current
        if (id) {
          routeRight.replaceToRoot(
            buildRightPaneRef.current(
              id,
              selectedDocTypeRef.current,
              undefined,
              selectedOctoDocSlugRef.current,
            ) as unknown,
          )
        } else {
          routeRight.replaceToRoot(buildEmptyState() as unknown)
        }
      } catch {
        // ignore — right pane unavailable
      }
      // The resident list only fetches on mount + on space/folder/reloadToken change (useDocsView),
      // so a view recorded while another tab was active never showed up on a NavRail return to docs
      // (XIN-1307 — host keeps DocsHome mounted, only toggles display). Bump the reload token here
      // so both tabs refetch. The token feeds useDocsView's existing refetch effect, which re-sends
      // each tab's remembered q/creators/types — so the current search/filter is preserved and no
      // fetch dependency array or cache layer changes. setListReloadToken is a stable setter and the
      // functional update reads the latest value, so no ref/stale-closure handling is needed.
      setListReloadToken((n) => n + 1)
    })
    // routeRight + buildEmptyState are stable (singleton + []-dep useCallback); buildRightPane is
    // read through a ref so the subscription stays mounted for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Browser Back / Forward handling (XIN-1172). Opening a doc pushes a doc history entry over a
  // list entry (see mirrorDocToUrl), so a Back pops to the list entry and fires `popstate`. Here we
  // reconcile the pane to whatever that entry addresses: a doc → (re)open it; the list → close the
  // doc AND clear the persisted target so neither this instance nor the host RouteManager's own
  // popstate re-push (which re-mounts DocsHome reading sessionStorage) re-opens the doc. Clearing
  // synchronously in the popstate dispatch — before React flushes the host's re-mount — is what
  // makes "open doc → Back → list (kept), reload → still list, never about:blank" deterministic.
  useEffect(() => {
    const onPopState = () => {
      const doc =
        typeof window !== 'undefined'
          ? readDocFromHistory(window.history.state, window.location.search)
          : null
      if (doc) {
        if (doc !== selectedDocIdRef.current) openDoc(doc)
      } else {
        clearDocTarget()
        backToList()
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [openDoc, backToList])
  // Production (routeRight present): the editor lives in the host's main pane; this route
  // slot renders ONLY the resident list (left). Tests / standalone (no routeRight): render
  // the inline CSS split-pane (left list + right editor) so the layout still works.
  if (routeRight) {
    return (
      <div className="octo-doc octo-docs-list-only">
        <DocsList
          space={space}
          folder={folder}
          uid={uid}
          selectedDocId={selectedDocId}
          onSelect={openDoc}
          reloadToken={listReloadToken}
          botUids={botUids}
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
          uid={uid}
          selectedDocId={selectedDocId}
          onSelect={openDoc}
          reloadToken={listReloadToken}
          botUids={botUids}
        />
      </aside>
      <section className="octo-docs-split-right">
        {selectedDocId ? (
          buildRightPane(selectedDocId, selectedDocType, backToList, selectedOctoDocSlug)
        ) : (
          <div className="octo-docs-split-empty">
            <p>{t('docs.state.empty')}</p>
          </div>
        )}
      </section>
    </div>
  )
}
