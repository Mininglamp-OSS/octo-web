// Read-only viewer for a `docType==='html'` document (env ring 2a).
//
// Contract:
//   - READ-ONLY: the HTML is agent-authored; a human may only read it (comments + "让 AI
//     处理" arrive in ring 2b). This component renders NO editing chrome and loads the
//     payload in a sandboxed iframe without script permission.
//   - IFRAME: the published HTML is fetched as-is and rendered by the browser so agent CSS
//     (<style>, inline style, external stylesheet links) stays intact.
//   - SEPARATE BACKEND: octo-doc is a distinct deployment from the same-origin Yjs
//     `/api/v1` docs backend, so we use a plain fetch (with credentials) against
//     resolveOctoDocBase() rather than the octoweb apiClient.
//
// SECURITY: the published HTML is NOT sanitized end-to-end by the backend (ring 1 only
// validates aid-replace fragments, not the whole Publish payload), so it may contain
// <script>, on* handlers, javascript: URLs, or interactive/editable controls. The render
// path isolates it with iframe sandbox="allow-same-origin" and never grants allow-scripts.

import { useCallback, useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { canForwardToChat, t, getWKApp, getCurrentUid } from '../octoweb/index.ts'
import { getDoc, getUserName } from '../pages/docsApi.ts'
import { useMemberNames } from '../members/useMemberNames.ts'
import { startDocForward } from '../forward/startDocForward.ts'
import { avatarUrlForUid } from './htmlAvatar.ts'
import { canManage, type Role } from '../auth/roles.ts'
import { useAccessRequests } from '../access-request/useAccessRequests.ts'
import { buildDocLink } from '../forward/link.ts'
import { HtmlDocCommentPanel } from './HtmlDocCommentPanel.tsx'
import { HtmlMemberPanel } from './HtmlMemberPanel.tsx'
import { HtmlPresenceBar } from './HtmlPresenceBar.tsx'
import { HtmlPreviewFrame, type PreviewLoadState } from './HtmlPreviewFrame.tsx'
import { HtmlSourceView } from './HtmlSourceView.tsx'
import { HtmlVersionPanel } from './HtmlVersionPanel.tsx'
import { listVersions, type HtmlDocVersion } from './htmlDocVersions.ts'
import { HtmlDiffModal } from './HtmlDiffModal.tsx'
import { ConfirmModal } from '../editor/ConfirmModal.tsx'
import { useDocDelete } from '../editor/useDocDelete.ts'
import { DocMoreMenu, OpenNewPageIcon, LinkIcon, DeleteIcon, type DocMoreMenuItem } from '../editor/DocMoreMenu.tsx'
import { buildAnchorFromSelection, truncateAnchorText } from './htmlDocAnchor.ts'
import type { Anchor } from './htmlDocComments.ts'
import {
  absolutizeDocAssetUrls,
  buildOctoDocUrl,
  injectBaseHref,
  resolveAbsoluteOctoDocBase,
  resolveOctoDocBase,
} from './htmlDocFrameHelpers.ts'
export {
  absolutizeDocAssetUrls,
  buildOctoDocUrl,
  injectBaseHref,
  resolveAbsoluteOctoDocBase,
  resolveOctoDocBase,
} from './htmlDocFrameHelpers.ts'
import './HtmlDocView.css'

// Interactive/editable elements the read-only view must never render, even if DOMPurify's
// default (script/handler) baseline would otherwise let their markup through. This enforces
// the product's "human reads, never edits" hard constraint.
const FORBID_TAGS = ['input', 'button', 'textarea', 'select', 'option', 'form', 'label', 'fieldset']
// contenteditable would make plain elements editable; autofocus/onfocus are event-ish
// affordances. (Generic on* handlers + javascript: URLs are already removed by DOMPurify's
// default profile; contenteditable must be forbidden explicitly.)
// style is forbidden: DOMPurify keeps inline style verbatim without deep-cleaning CSS values,
// leaving a CSS injection surface (url(javascript:…)/expression()/url(//evil?leak) exfil/UI
// overlay). Presentational styling belongs to octo-doc's published-page class/external CSS.
const FORBID_ATTR = ['contenteditable', 'autofocus', 'onfocus', 'style']

/**
 * Legacy sanitizer retained for callers that still need a stripped inline fragment.
 *
 * Relies on DOMPurify's default safe baseline (drops <script>, on* handlers and
 * javascript:/data: script URLs) and additionally strips interactive/editable elements and
 * the contenteditable attribute so the rendered doc is strictly presentational. Ordinary
 * display markup is preserved by the default allow-list; inline style is forbidden (see
 * FORBID_ATTR) to close the CSS-value injection surface DOMPurify does not deep-clean.
 */
export function sanitizeDocHtml(raw: string): string {
  return DOMPurify.sanitize(raw, {
    FORBID_TAGS,
    FORBID_ATTR,
  })
}

function cssAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function resolveHtmlDocAnchorText(
  anchor: Anchor | null | undefined,
  doc: Document | null | undefined,
): string | null {
  if (!anchor) return null
  if (anchor.kind === 'text') return truncateAnchorText(anchor.text)
  if (!doc) return null
  try {
    const el = doc.querySelector(`[data-odoc-aid="${cssAttrValue(anchor.aid)}"]`)
    const text = el?.textContent?.trim()
    return text ? truncateAnchorText(text) : null
  } catch {
    return null
  }
}

export interface HtmlDocViewProps {
  /** Doc id (used as the octo-doc slug when no explicit slug is supplied). */
  docId: string
  /** Owning space — carried for parity with SheetView and for the 2b comment scope. */
  space: string
  /** Caller role. Reserved for future comment gating; the 2b panel currently reads for anyone with octo-doc access. */
  role?: string
  /**
   * octo-doc slug, when it differs from docId. Defaults to docId. octo-doc addresses a
   * published doc by `/d/{slug}/v/{version}`.
   */
  slug?: string
  /** Published version to render. Defaults to `latest` (octo-doc resolves the newest). */
  version?: string
  /** Called after the doc is deleted so the shell returns to the list + refreshes it (mirror of SheetView). */
  onDeleted?: (docId: string) => void
  /**
   * Standalone /d/:docId (externally shared) surface flag. When true the creator name resolves
   * nickname-only (skips the member map, forces `preferRealName:false`) so a link holder never
   * sees the creator's verified real_name — mirrors EditorShell/BoardShell's XIN-392 P2-1 gate.
   */
  creatorNicknameOnly?: boolean
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; url?: string }
  | { status: 'empty' }
  | {
      status: 'ready'
      html: string
      meta: OctoDocMeta | null
      isAuthor: boolean
    }

// Minimal metadata the render page injects as window.__ODOC__ (see doc-side render).
// ⚠️ identity here is the CURRENT VIEWER's session identity (identityFromSession), NOT the
// doc creator. __ODOC__ (core.OverlayConfig) does NOT carry creator_uid — so never derive
// authorship by comparing viewer uid against identity.login (that is always the viewer =
// always true). Authorship comes from window.__ODOC_CAP__.isAuthor (see parseOdocCap).
//
// creator_uid / creator_name / created_at fields are DEPRECATED — the header now reads
// ownerId/createdAt from docs-backend getDoc (single source of truth, same as EditorShell).
// Interface entries retained only so a payload that still carries them parses cleanly; DO NOT
// reintroduce readers of these fields — future backends may drop them without notice.
interface OctoDocMeta {
  slug?: string
  title?: string
  version?: number
  identity?: { login?: string; name?: string } | null
  /** @deprecated use docs-backend getDoc().ownerId */
  creator_uid?: string
  /** @deprecated use docs-backend getUserName(ownerId) */
  creator_name?: string
  /** @deprecated use docs-backend getDoc().createdAt */
  created_at?: string
}

// Pull the __ODOC__ blob the render page inlines. Best-effort: a parse miss just means
// no header metadata (header still renders with slug fallback).
function parseOdocMeta(html: string): OctoDocMeta | null {
  const m = html.match(/__ODOC__\s*=\s*(\{[\s\S]*?\});/)
  if (!m) return null
  try {
    return JSON.parse(m[1]) as OctoDocMeta
  } catch {
    return null
  }
}

// Authorship is decided by the backend (resolveCap: viewer Login == doc CreatorUID → CapAuthor)
// and inlined as window.__ODOC_CAP__ = {isAuthor: true}. ⚠️ That marker is a JS object literal
// (unquoted key), NOT valid JSON — JSON.parse would throw and make EVERY viewer non-author
// (incl. the real author). Read the boolean directly. This is the only trustworthy author signal
// on the client (__ODOC__ carries no creator_uid). Missing marker → not author (fail closed).
function parseOdocCap(html: string): boolean {
  const m = html.match(/__ODOC_CAP__\s*=\s*\{[^}]*\bisAuthor\b\s*:\s*(true|false)/)
  return m?.[1] === 'true'
}

export function HtmlDocView({
  docId,
  space,
  slug,
  version = 'latest',
  onDeleted,
  creatorNicknameOnly,
}: HtmlDocViewProps) {
  // Mode toggle: page (rendered iframe) vs code (raw source). Sticky across version switches.
  const [mode, setMode] = useState<'page' | 'code'>('page')
  const modeTabRefs = useRef<Record<'page' | 'code', HTMLButtonElement | null>>({ page: null, code: null })
  // In-page version. Starts at the prop; the 历史版本 panel's 查看 repoints it without a new tab.
  const [viewVersion, setViewVersion] = useState<string>(version)
  useEffect(() => setViewVersion(version), [version])
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const effectiveSlug = slug ?? docId
  // 划词评论: the anchor lifted from the last non-collapsed selection inside the read-only
  // content. Overlay state only — the content itself is never mutated / made editable.
  const [pendingAnchor, setPendingAnchor] = useState<Anchor | null>(null)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const selectionDocRef = useRef<Document | null>(null)
  const [frameReadyTick, setFrameReadyTick] = useState(0)
  // Header UI state.
  const [membersOpen, setMembersOpen] = useState(false)
  // 历史版本 panel (≡ → 历史版本) + two-version diff modal state.
  const [historyOpen, setHistoryOpen] = useState(false)
  const [versions, setVersions] = useState<HtmlDocVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionsError, setVersionsError] = useState<string | null>(null)
  const [diff, setDiff] = useState<{ from: number; to: number } | null>(null)
  // Comments default open to preserve the existing reader behavior.
  const [commentsOpen, setCommentsOpen] = useState(true)
  const meta = state.status === 'ready' ? state.meta : null
  // Backend-authoritative authorship (resolveCap → window.__ODOC_CAP__.isAuthor). Do NOT compare
  // viewer uid to any __ODOC__ field: identity there is the viewer itself and creator_uid is absent,
  // so a client-side comparison would make every viewer an "author" (the invited-viewer-as-owner bug).
  const isAuthor = state.status === 'ready' ? state.isAuthor : false

  // Creator + role now come from docs-backend (getDoc → resolveRole), not from the inlined
  // __ODOC__ blob. Keeps HTML docs on the same data source as EditorShell/BoardShell/SheetView so
  // creator display and forward-grant capability are computed identically across doc kinds.
  // Fail-soft: 404 (裸 doc, no doc_meta) / 403 leaves everything undefined → header falls back to
  // the slug/initial and forward授权 stays greyed, without crashing.
  const [ownerId, setOwnerId] = useState<string | undefined>(undefined)
  const [createdAt, setCreatedAt] = useState<string | undefined>(undefined)
  const [role, setRole] = useState<Role | null>(null)
  useEffect(() => {
    let cancelled = false
    // standalone /d/:docId mounts before the space is restored, so the request interceptor injects
    // no X-Space-Id; pass it explicitly (same as EditorShell's getDoc call).
    const opts = space ? { spaceId: space } : undefined
    // docs-backend `/docs/{docId}` is keyed by docId — MUST NOT be effectiveSlug/slug. Standalone
    // /d/:docId passes docId=meta.docId + slug=meta.octoDocSlug as two distinct identifiers, so a
    // slug lookup 404s and silently zeroes ownerId/createdAt/role (creator display + forward授权
    // break). octo-doc render/comment/asset paths keep using effectiveSlug; only this docs-backend
    // hop is docId-keyed.
    getDoc(docId, opts)
      .then((m) => {
        if (cancelled) return
        if (typeof m?.ownerId === 'string' && m.ownerId) setOwnerId(m.ownerId)
        if (typeof m?.createdAt === 'string' && m.createdAt) setCreatedAt(m.createdAt)
        if (m?.role) setRole(m.role)
      })
      .catch(() => {
        /* fail-soft: creator/created/role stay undefined; header uses fallbacks, canGrant=false */
      })
    return () => {
      cancelled = true
    }
  }, [docId, space])

  // Resolve creator display name (parity with EditorShell): in-shell prefers the already-loaded
  // space-member map (free), then falls back to GET /users/:uid for a verified real name. The
  // standalone surface (creatorNicknameOnly) SKIPS the member map entirely and forces nickname-
  // only so a link holder never sees the creator's verified real_name (XIN-392 P2-1).
  const names = useMemberNames(space)
  const viewerName = names.get(getCurrentUid())
  const [creatorName, setCreatorName] = useState<string | undefined>(undefined)
  useEffect(() => {
    setCreatorName(undefined)
    if (!ownerId) return
    if (!creatorNicknameOnly) {
      const fromMembers = names.get(ownerId)
      if (fromMembers && fromMembers !== ownerId) {
        setCreatorName(fromMembers)
        return
      }
    }
    let cancelled = false
    getUserName(ownerId, { preferRealName: !creatorNicknameOnly })
      .then((name) => {
        if (!cancelled && name) setCreatorName(name)
      })
      .catch(() => {
        /* keep the uid fallback */
      })
    return () => {
      cancelled = true
    }
  }, [ownerId, names, creatorNicknameOnly])

  // Title: backend does not expose a human title yet → fall back to slug.
  const headerTitle = meta?.title || effectiveSlug
  // Creator display: resolved name → short uid → placeholder. Never blank, never crashes.
  const headerCreator = creatorName || (ownerId ? ownerId.slice(0, 8) : '—')
  const creatorAvatarUrl = avatarUrlForUid(ownerId)
  // Two independent gates, kept separate on purpose (合并 = UI 骗人):
  //   - canManageBackend: docs-backend admin, drives Share/Invite/Requests inside the panel.
  //     role=null (still resolving) collapses to false — the panel renders a loading placeholder
  //     for those slots rather than a half-baked admin UI.
  //   - canOpenPanel: entry-visibility union — either authority is enough to see the button and
  //     open the modal. When role is still resolving, canOpenPanel short-circuits on isAuthor so
  //     a non-author viewer never gets a flashed entry that later disappears.
  // The panel itself derives canManageAuthorGrants from isAuthor alone; we intentionally stop
  // forwarding the legacy `canManage` prop so a merged authority can never leak the author-only
  // slots (Add member / Current Members) or trigger the author-only listGrants 403.
  // The header ≡ Delete affordance is gated on isAuthor for the same reason — symmetric with the
  // grants-side hiding, so a docs-backend admin who is not the author never sees a guaranteed-403
  // affordance whose backend is octo-doc /v1/docs/{slug} (author-only).
  const creatorUid = ownerId
  const canManageBackend = role != null && canManage(role)
  const canOpenPanel = isAuthor || canManageBackend
  const pendingAccess = useAccessRequests(docId, canManageBackend)
  // Browser-openable address for forwarding this doc to chat. Build the PATH-style standalone
  // link (/d/<docId>?sp=<space>) like every other kind (buildDocLink), NOT window.location.href:
  // the in-shell address is the legacy /docs?doc= query form, whose docId is wiped by the host's
  // pathname-only route re-push, so a forwarded query link lands the recipient on the wrong page.
  // The path form carries the docId in the path (survives the re-push), routes through
  // StandaloneDocPage's html branch (reader preflight + auto recordDocView), and needs no JS rescue.
  const docUrl = buildDocLink({ docId, space })
  const canForward = canForwardToChat()

  // Forward-to-chat: unified with EditorShell/BoardShell/SheetView via startDocForward — it computes
  // canGrant = computeCanGrant(role, currentUid, ownerId) and wires the per-uid grant executor
  // against POST /docs/{docId}/forward-grant. Early-return while role is still loading so we never
  // send canGrant=false before resolveRole has spoken (mirrors EditorShell's `if (!role) return`).
  const doForward = useCallback(() => {
    if (!canForward || !role) return
    startDocForward({
      docId,
      title: headerTitle,
      role,
      currentUid: getCurrentUid(),
      ownerId,
      space,
    })
  }, [canForward, docId, headerTitle, role, ownerId, space])

  const handleDeleted = useCallback(
    (id: string) => {
      if (onDeleted) onDeleted(id)
      else if (typeof window !== 'undefined') window.history.back()
    },
    [onDeleted],
  )
  // Reuse the unified document soft-delete flow; octo-doc remains read-only content storage.
  const del = useDocDelete(docId, handleDeleted, space ? { spaceId: space } : undefined)

  // The published HTML fetch/transform/sandbox now lives in HtmlPreviewFrame (shared with the
  // page-diff tab). HtmlDocView still derives meta/cap (title + isAuthor) from the RAW source the
  // frame hands back, so header/authorship behaviour is unchanged. Reset transient view state when
  // the addressed doc/version changes.
  useEffect(() => {
    setState({ status: 'loading' })
    setPendingAnchor(null)
    setFrameReadyTick(0)
  }, [effectiveSlug, viewVersion])

  const handlePreviewState = useCallback((s: PreviewLoadState) => {
    if (s.status === 'ready') {
      setState({
        status: 'ready',
        html: s.html,
        meta: parseOdocMeta(s.raw),
        isAuthor: parseOdocCap(s.raw),
      })
    } else if (s.status === 'error') {
      setState({ status: 'error', url: s.url })
    } else {
      setState({ status: s.status })
    }
  }, [])

  // Lazy-load the version list only when the 历史版本 panel opens (abort/race guard). Newest-first.
  useEffect(() => {
    if (!historyOpen) return
    let cancelled = false
    setVersionsLoading(true)
    setVersionsError(null)
    listVersions(effectiveSlug)
      .then((vs) => {
        if (cancelled) return
        setVersions(vs)
      })
      .catch(() => {
        if (cancelled) return
        setVersionsError(t('docs.version.errorList'))
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [historyOpen, effectiveSlug])

  // 历史版本 查看: repoint the in-page view (mode preserved), close the panel. numeric → string.
  const handleViewVersion = useCallback((n: number) => {
    setViewVersion(String(n))
    setHistoryOpen(false)
  }, [])
  const handleCompare = useCallback((from: number, to: number) => {
    setDiff({ from, to })
    setHistoryOpen(false)
  }, [])

  const selectModeTab = useCallback((nextMode: 'page' | 'code') => {
    setMode(nextMode)
    modeTabRefs.current[nextMode]?.focus()
  }, [])

  const handleModeTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, currentMode: 'page' | 'code') => {
      let nextMode: 'page' | 'code' | null = null
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') nextMode = currentMode === 'page' ? 'code' : 'page'
      else if (event.key === 'Home') nextMode = 'page'
      else if (event.key === 'End') nextMode = 'code'
      if (!nextMode) return
      event.preventDefault()
      selectModeTab(nextMode)
    },
    [selectModeTab],
  )

  const onFrameSelectionChange = useCallback(() => {
    const doc = frameRef.current?.contentDocument
    const body = doc?.body
    const sel = doc?.getSelection?.() ?? doc?.defaultView?.getSelection?.() ?? null
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !body) return
    if (!body.contains(sel.getRangeAt(0).commonAncestorContainer)) return
    const anchor = buildAnchorFromSelection(sel)
    if (anchor) setPendingAnchor(anchor)
  }, [])

  const cleanupFrameSelectionWatcher = useCallback(() => {
    selectionDocRef.current?.removeEventListener('selectionchange', onFrameSelectionChange)
    selectionDocRef.current = null
  }, [onFrameSelectionChange])

  const handleFrameLoad = useCallback(
    (doc: Document | null, frame: HTMLIFrameElement) => {
      frameRef.current = frame
      setFrameReadyTick((v) => v + 1)
      cleanupFrameSelectionWatcher()
      try {
        if (!doc) throw new Error('missing iframe document')
        doc.addEventListener('selectionchange', onFrameSelectionChange)
        selectionDocRef.current = doc
      } catch (err) {
        console.warn('[HtmlDocView] unable to initialize iframe document hooks', err)
      }
    },
    [cleanupFrameSelectionWatcher, onFrameSelectionChange],
  )

  const resolveAnchorText = useCallback(
    (anchor: Anchor | null | undefined): string | null => {
      try {
        return resolveHtmlDocAnchorText(anchor, frameRef.current?.contentDocument)
      } catch {
        return null
      }
    },
    [frameReadyTick],
  )

  useEffect(() => {
    if (state.status !== 'ready') {
      cleanupFrameSelectionWatcher()
    }
  }, [cleanupFrameSelectionWatcher, state.status])

  useEffect(() => {
    return () => {
      cleanupFrameSelectionWatcher()
    }
  }, [cleanupFrameSelectionWatcher])

  return (
    <div className="octo-doc octo-doc--editor octo-theme octo-html-doc" data-testid="html-doc-view">
      {/* Header parity with rich docs (EditorShell octo-doc-header): title on the left; on the right,
          the viewer avatar, comments, forward, members, and more actions. HTML docs are read-only so the
          title is static; the creator + created date moved into the ≡ menu head (avoids duplicating
          it in the bar). Retains octo-html-doc-header for HTML-specific CSS. */}
      <header className="octo-doc-header octo-html-doc-header">
        <div className="octo-doc-title octo-html-doc-title" title={headerTitle}>
          {headerTitle}
        </div>
        <div className="octo-doc-header-right">
          {/* [页面][代码] mode switch. Semantic tablist; the mode is sticky across version switches. */}
          <div className="octo-html-doc-modes" role="tablist" aria-label={t('docs.mode.label')}>
            <button
              ref={(node) => { modeTabRefs.current.page = node }}
              type="button"
              role="tab"
              id="html-doc-mode-tab-page"
              aria-selected={mode === 'page'}
              aria-controls="html-doc-mode-panel-page"
              tabIndex={mode === 'page' ? 0 : -1}
              className={mode === 'page' ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
              onClick={() => setMode('page')}
              onKeyDown={(event) => handleModeTabKeyDown(event, 'page')}
            >
              {t('docs.mode.page')}
            </button>
            <button
              ref={(node) => { modeTabRefs.current.code = node }}
              type="button"
              role="tab"
              id="html-doc-mode-tab-code"
              aria-selected={mode === 'code'}
              aria-controls="html-doc-mode-panel-code"
              tabIndex={mode === 'code' ? 0 : -1}
              className={mode === 'code' ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
              onClick={() => setMode('code')}
              onKeyDown={(event) => handleModeTabKeyDown(event, 'code')}
            >
              {t('docs.mode.code')}
            </button>
          </div>
          <HtmlPresenceBar displayName={viewerName} />
          {/* Comments belong to the rendered page; code mode has no selection anchors, so the toggle
              is hidden there (a switch-back hint sits in the code body instead). */}
          {mode === 'page' && (
            <button
              type="button"
              className={commentsOpen ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
              aria-pressed={commentsOpen}
              title={t('docs.toolbar.comments')}
              onClick={() => setCommentsOpen((v) => !v)}
            >
              {t('docs.toolbar.comments')}
            </button>
          )}
          {/* Forward gated on canForward (no dead entry where the host lacks the conversation-select
              surface, e.g. standalone /d/) AND on role (mirrors EditorShell.tsx role && canForward:
              while role is unresolved — getDoc 404 fail-soft or still loading — the button hides
              instead of rendering a silent no-op the doForward guard would swallow). */}
          {role && canForward && (
            <button
              type="button"
              className="octo-tb-btn octo-doc-forward-btn"
              title={t('docs.forward.entry')}
              onClick={doForward}
            >
              ⤴ {t('docs.forward.entry')}
            </button>
          )}
          {/* Members panel entry: hidden entirely for viewers who can neither manage member grants
              (author) nor manage docs-backend Share/Invites/Access-Requests (admin), matching the
              two backend authorities that the panel writes against. */}
          {canOpenPanel && (
            <button
              type="button"
              className={membersOpen ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
              aria-pressed={membersOpen}
              title={t('docs.toolbar.members')}
              onClick={() => setMembersOpen((v) => !v)}
            >
              {t('docs.toolbar.members')}
              {pendingAccess.count > 0 && (
                <span className="octo-access-badge" aria-label={t('docs.forward.pendingTitle')}>
                  {pendingAccess.count}
                </span>
              )}
            </button>
          )}
          <DocMoreMenu
            creatorName={headerCreator}
            creatorAvatarUrl={creatorAvatarUrl}
            createdAt={createdAt}
            items={[
              {
                key: 'open-new-page',
                label: t('docs.standalone.openInNewPage'),
                icon: OpenNewPageIcon,
                onClick: () => window.open(docUrl, '_blank'),
              },
              {
                key: 'history',
                label: t('docs.toolbar.history'),
                icon: OpenNewPageIcon,
                onClick: () => setHistoryOpen(true),
              },
              // Twin of the toolbar Forward at :579 — same `role && canForward` gate so both
              // affordances hide together when role is unresolved (getDoc 404 fail-soft), instead of
              // leaving a dead menu row that doForward's role guard would swallow.
              ...(role && canForward
                ? [
                    {
                      key: 'forward',
                      label: t('docs.forward.entry'),
                      icon: LinkIcon,
                      onClick: doForward,
                    } as DocMoreMenuItem,
                  ]
                : []),
            ]}
            dangerItem={
              // Delete remains author-only, matching the existing HTML document UI gate.
              isAuthor
                ? {
                    key: 'delete',
                    label: t('docs.doc.deleteEntry'),
                    icon: DeleteIcon,
                    danger: true,
                    onClick: del.requestDelete,
                  }
                : undefined
            }
          />
        </div>
      </header>
      <ConfirmModal
        open={del.confirming}
        title={t('docs.doc.deleteEntry')}
        message={t('docs.doc.deleteConfirm')}
        confirmLabel={t('docs.comment.delete')}
        cancelLabel={t('docs.comment.cancel')}
        danger
        busy={del.deleting}
        onConfirm={() => void del.confirm()}
        onCancel={del.cancel}
      />
      {del.error && (
        <p className="octo-member-error" role="alert">
          {del.error}
        </p>
      )}
      {/* Members open in a centered modal dialog (overlay + click-outside to close), matching the
          rich-doc member modal (EditorShell #A4) so HTML docs share the same floating-panel shape.
          Only the panel CONTENT differs (HtmlMemberPanel → octo-doc grants), never the shell. */}
      {membersOpen && canOpenPanel && (
        <div className="octo-modal-overlay" role="presentation" onMouseDown={() => setMembersOpen(false)}>
          <div
            className="octo-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('docs.member.manage')}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <HtmlMemberPanel
              slug={effectiveSlug}
              space={space}
              creatorUid={creatorUid}
              onClose={() => setMembersOpen(false)}
              docId={docId}
              role={role}
              isAuthor={isAuthor}
              accessRequests={pendingAccess}
            />
          </div>
        </div>
      )}
      {/* History (历史版本) opens in the same centered modal shell as members. Independent HTML
          adapter (HtmlVersionPanel) — never the Yjs-bound VersionHistoryPanel. */}
      {historyOpen && (
        <div className="octo-modal-overlay" role="presentation" onMouseDown={() => setHistoryOpen(false)}>
          <div
            className="octo-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('docs.toolbar.history')}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <HtmlVersionPanel
              versions={versions}
              currentVersion={Number.isNaN(Number(viewVersion)) ? null : Number(viewVersion)}
              loading={versionsLoading}
              error={versionsError}
              onView={handleViewVersion}
              onCompare={handleCompare}
              onClose={() => setHistoryOpen(false)}
            />
          </div>
        </div>
      )}
      {/* Two-version diff modal (code + page tabs), shared DiffResult. */}
      {diff && (
        <HtmlDiffModal
          slug={effectiveSlug}
          from={String(diff.from)}
          to={String(diff.to)}
          title={headerTitle}
          onClose={() => setDiff(null)}
        />
      )}
      {/* CODE mode: raw read-only source. No iframe, no comment anchors. */}
      {mode === 'code' && (
        <div id="html-doc-mode-panel-code" role="tabpanel" aria-labelledby="html-doc-mode-tab-code" className="octo-html-doc-main octo-html-doc-main--code" data-testid="html-doc-main">
          <div className="octo-html-doc-source-wrap">
            <p className="octo-html-doc-source-hint" role="note">
              {t('docs.source.commentHint')}
            </p>
            <HtmlSourceView slug={effectiveSlug} version={viewVersion} />
          </div>
        </div>
      )}
      {/* PAGE mode: HtmlPreviewFrame owns fetch/transform/sandbox/state; HtmlDocView derives
          meta/isAuthor from the raw source it reports back and mounts the comment rail beside it. */}
      {mode === 'page' && (
        <div id="html-doc-mode-panel-page" role="tabpanel" aria-labelledby="html-doc-mode-tab-page" className="octo-html-doc-main" data-testid="html-doc-main">
          <HtmlPreviewFrame
            slug={effectiveSlug}
            version={viewVersion}
            title={headerTitle}
            onFrameLoad={handleFrameLoad}
            onStateChange={handlePreviewState}
          />
          {/*
            2b EXTENSION POINT: the read-only side comment panel + "让 AI 处理" entry mount here.
            The panel is an overlay rail beside the iframe content — it is NEVER injected into the
            agent HTML, so the view stays strictly read-only. It only renders once the doc is
            readable (a comment scope needs a real slug/version).
          */}
          {state.status === 'ready' && commentsOpen && (
            <HtmlDocCommentPanel
              docId={docId}
              space={space}
              isAuthor={isAuthor}
              slug={effectiveSlug}
              version={viewVersion}
              pendingAnchor={pendingAnchor}
              resolveAnchorText={resolveAnchorText}
              onClearPendingAnchor={() => setPendingAnchor(null)}
              onPosted={() => setPendingAnchor(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}
