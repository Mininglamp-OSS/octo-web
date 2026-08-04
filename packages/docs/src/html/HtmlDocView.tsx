// Read-only viewer for a `docType==='html'` document (env ring 2a).
//
// Contract: agent-authored HTML the human may only read (no editing chrome). The payload runs in a
// sandboxed iframe that may execute the doc's OWN JavaScript (issue #27) but is walled off from the
// parent. octo-doc is a separate backend, so the frame fetches via plain credentialed fetch, not
// the octoweb apiClient.
//
// SECURITY (issue #27): the Publish payload is NOT sanitized end-to-end, so it may carry <script>,
// on* handlers, javascript: URLs, or controls. The frame uses sandbox="allow-scripts" WITHOUT
// allow-same-origin (combining them defeats the sandbox — NEVER do it): doc JS runs in an opaque
// origin and cannot reach the parent DOM/credentials/origin; forms/popups/downloads/top-nav stay
// denied. This does NOT stop outbound network from doc JS — egress is an accepted capability for
// agent HTML (see htmlDocBridge threat-boundary note). Selection/anchor data crosses the
// constrained postMessage bridge (htmlDocBridge): the parent gates on event.source === the frame's
// contentWindow + a bounded schema and accepts only non-privileged UI facts.

import { useCallback, useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { canForwardToChat, t, getWKApp, getCurrentUid } from '../octoweb/index.ts'
import { getDoc, getUserName } from '../pages/docsApi.ts'
import { useMemberNames } from '../members/useMemberNames.ts'
import { startDocForward } from '../forward/startDocForward.ts'
import { avatarUrlForUid } from './htmlAvatar.ts'
import { canEdit, canManage, isRole, type Role } from '../auth/roles.ts'
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
import { isHtmlSourceDiffEnabled } from './htmlSourceDiffFeature.ts'
import { ConfirmModal } from '../editor/ConfirmModal.tsx'
import { useDocDelete } from '../editor/useDocDelete.ts'
import { DocMoreMenu, OpenNewPageIcon, LinkIcon, DeleteIcon, type DocMoreMenuItem } from '../editor/DocMoreMenu.tsx'
import { truncateAnchorText } from './htmlDocAnchor.ts'
import type { Anchor } from './htmlDocComments.ts'
import { BRIDGE_CHANNEL, isValidAid, parseBridgeInbound } from './htmlDocBridge.ts'
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

// Interactive/editable elements the read-only view must never render (enforces "human reads,
// never edits"), even though DOMPurify's default baseline would let their markup through.
const FORBID_TAGS = ['input', 'button', 'textarea', 'select', 'option', 'form', 'label', 'fieldset']
// contenteditable makes plain elements editable; autofocus/onfocus are event-ish affordances.
// style is forbidden because DOMPurify keeps inline CSS verbatim (url(javascript:)/expression()/
// exfil url() surface it does not deep-clean). Presentational styling belongs to published CSS.
const FORBID_ATTR = ['contenteditable', 'autofocus', 'onfocus', 'style']

/**
 * Legacy sanitizer for callers that still need a stripped inline fragment. DOMPurify default
 * baseline (drops script tags, on* handlers, javascript: URLs) plus FORBID_TAGS/FORBID_ATTR
 * (interactive tags, contenteditable, inline style) yields strictly presentational output.
 */
export function sanitizeDocHtml(raw: string): string {
  return DOMPurify.sanitize(raw, {
    FORBID_TAGS,
    FORBID_ATTR,
  })
}

// Escape a (bounded) aid interpolated into an attribute selector. Prefer platform CSS.escape;
// else escape every non-word char so a hostile aid can't break out of the selector.
function escapeAidForSelector(value: string): string {
  const cssApi = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS
  if (cssApi?.escape) return cssApi.escape(value)
  return value.replace(/[^\w-]/g, (c) => `\\${c}`)
}

export function resolveHtmlDocAnchorText(
  anchor: Anchor | null | undefined,
  doc: Document | null | undefined,
): string | null {
  if (!anchor) return null
  if (anchor.kind === 'text') return truncateAnchorText(anchor.text)
  if (anchor.kind !== 'element') return null
  if (!doc) return null
  try {
    const el = doc.querySelector(`[data-odoc-aid="${escapeAidForSelector(anchor.aid)}"]`)
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

// Minimal metadata the render page injects as window.__ODOC__. ⚠️ identity is the CURRENT VIEWER,
// NOT the doc creator, and __ODOC__ carries no creator_uid — so never derive authorship from it
// (that always makes the viewer the "author"). Authorship comes from __ODOC_CAP__.isAuthor.
// creator_uid/creator_name/created_at are DEPRECATED — header now reads ownerId/createdAt from
// docs-backend getDoc. Kept only so legacy payloads parse; do NOT reintroduce readers.
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

// Authorship is backend-decided (resolveCap) and inlined as window.__ODOC_CAP__ = {isAuthor: true}.
// ⚠️ That marker is a JS object literal (unquoted key), NOT JSON — parse the boolean directly;
// JSON.parse would throw and make every viewer non-author. Missing marker → not author (fail closed).
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
  const sourceDiffEnabled = isHtmlSourceDiffEnabled()
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
  const mayCommentRef = useRef(false)
  const [frameReadyTick, setFrameReadyTick] = useState(0)
  // Element-anchor display text resolved over the bridge (aid → text). The parent cannot read the
  // cross-origin iframe DOM, so it asks the frame and caches the reply here. resolveAnchorText is a
  // pure cache read; the comment panel reports which element aids are visible (post-commit) and a
  // parent effect sends one bridge request per not-yet-requested aid.
  const [anchorTextCache, setAnchorTextCache] = useState<Record<string, string | null>>({})
  const requestedAidsRef = useRef<Set<string>>(new Set())
  const pendingResolveRef = useRef<Map<string, string>>(new Map())
  // Element aids the comment panel currently renders (reported post-commit); drives the resolve
  // effect below. State (not a ref) so a new set re-runs the effect.
  const [visibleAnchorAids, setVisibleAnchorAids] = useState<string[]>([])
  // Current render generation's bridge token (from HtmlPreviewFrame). Requests carry it and replies
  // must echo it; a token mismatch drops stale / cross-document / replayed traffic.
  const bridgeTokenRef = useRef<string | null>(null)
  // Header UI state.
  const [membersOpen, setMembersOpen] = useState(false)
  // 历史版本 panel (≡ → 历史版本) + two-version diff modal state.
  const [historyOpen, setHistoryOpen] = useState(false)
  const [versions, setVersions] = useState<HtmlDocVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionsError, setVersionsError] = useState<string | null>(null)
  const [diff, setDiff] = useState<{ from: number; to: number } | null>(null)
  useEffect(() => {
    if (!sourceDiffEnabled) {
      setMode('page')
      setDiff(null)
    }
  }, [sourceDiffEnabled])
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
  // Backend-resolved role (docs-backend getDoc → resolveRole). Renamed from `role` to make the
  // distinction from the props.role explicit. null = still resolving or a fail-soft 403/404 miss;
  // all write UI stays closed until it settles (fail closed). An unknown/unexpected role string is
  // rejected by isRole() and left as null rather than trusted.
  const [resolvedRole, setResolvedRole] = useState<Role | null>(null)
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
        // Fail closed on an unknown role string: only a recognised four-role value is trusted.
        if (isRole(m?.role)) setResolvedRole(m.role)
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
  // Two independent gates, kept separate on purpose:
  //   - canManageBackend: docs-backend admin (Share/Invite/Requests). role=null → false (loading).
  //   - canOpenPanel: entry-visibility union (author OR admin); short-circuits on isAuthor while
  //     role resolves so a non-author viewer never gets a flashed entry.
  // The panel derives author-only grants from isAuthor alone; we stop forwarding legacy `canManage`
  // so a merged authority can never leak author-only slots or trigger the author-only listGrants
  // 403. Delete is likewise isAuthor-gated (its backend is author-only octo-doc /v1/docs/{slug}).
  const creatorUid = ownerId
  // Capability derivation from the backend-resolved role (fail closed while null). Single seam
  // every write affordance gates on — never viewer-uid vs __ODOC__.
  const mayComment = resolvedRole != null && resolvedRole !== 'reader'
  mayCommentRef.current = mayComment && mode === 'page'
  const mayEdit = resolvedRole != null && canEdit(resolvedRole)
  const mayManage = resolvedRole != null && canManage(resolvedRole)
  const canManageBackend = mayManage
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
    if (!canForward || !resolvedRole) return
    startDocForward({
      docId,
      title: headerTitle,
      role: resolvedRole,
      currentUid: getCurrentUid(),
      ownerId,
      space,
    })
  }, [canForward, docId, headerTitle, resolvedRole, ownerId, space])

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

  // Reset per-generation bridge state on each frame load: the new token gates all subsequent
  // traffic (prior-document requests/replies drop on mismatch) and the resolved-text cache is
  // invalidated since aids may now map to different content.
  const handleFrameLoad = useCallback((_doc: Document | null, frame: HTMLIFrameElement, token: string | null) => {
    frameRef.current = frame
    bridgeTokenRef.current = token
    requestedAidsRef.current = new Set()
    pendingResolveRef.current = new Map()
    setAnchorTextCache({})
    setFrameReadyTick((v) => v + 1)
  }, [])

  // Single window-level bridge listener. The iframe is cross-origin (no allow-same-origin) so the
  // parent gates on event.source === contentWindow + current token + a bounded schema before
  // trusting anything. Only non-privileged UI facts are accepted (a selection anchor the human
  // still submits; text we explicitly requested).
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const frame = frameRef.current
      // srcDoc frames have an opaque origin, so identity is the exact contentWindow, not origin.
      if (!frame || ev.source !== frame.contentWindow) return
      const msg = parseBridgeInbound(ev.data)
      if (!msg) return
      // Correlate to the CURRENT generation; a stale/forged token is discarded.
      if (!bridgeTokenRef.current || msg.token !== bridgeTokenRef.current) return
      if (msg.type === 'selection') {
        if (!mayCommentRef.current) return
        // Adopt only a fresh non-null anchor; a null (collapse) report is ignored so a locked
        // anchor survives the selection collapsing when the human moves to the composer.
        if (msg.anchor) setPendingAnchor(msg.anchor)
      } else if (msg.type === 'anchor-text') {
        // Accept only replies to a nonce WE issued this generation (reject stale/replayed nonces).
        const aid = pendingResolveRef.current.get(msg.nonce)
        if (!aid) return
        pendingResolveRef.current.delete(msg.nonce)
        setAnchorTextCache((prev) => ({ ...prev, [aid]: msg.text }))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // RENDER-PURE cache read: no ref writes, no scheduling. Cache misses are filled by the resolve
  // effect, which is driven by the aids the comment panel reports post-commit (onVisibleAnchors).
  const resolveAnchorText = useCallback(
    (anchor: Anchor | null | undefined): string | null => {
      if (!anchor) return null
      if (anchor.kind === 'text') return truncateAnchorText(anchor.text)
      if (anchor.kind !== 'element') return null
      const aid = anchor.aid
      if (!isValidAid(aid)) return null
      return aid in anchorTextCache ? anchorTextCache[aid] : null
    },
    [anchorTextCache],
  )

  // The comment panel reports the element aids it renders in a post-commit effect; adopt them here
  // (identity-stable when unchanged so the resolve effect below doesn't churn).
  const handleVisibleAnchorAids = useCallback((aids: string[]) => {
    setVisibleAnchorAids((prev) =>
      prev.length === aids.length && prev.every((a, i) => a === aids[i]) ? prev : aids,
    )
  }, [])

  // Post-commit resolve: send one bridge request per reported aid not yet requested/cached. Runs
  // AFTER render off reported aids, so nothing schedules during render. Each request carries the
  // current token + a unique nonce; the listener accepts only a matching-token, issued-nonce reply.
  useEffect(() => {
    const win = frameRef.current?.contentWindow
    const token = bridgeTokenRef.current
    if (!win || !token) return
    for (const aid of visibleAnchorAids) {
      if (!isValidAid(aid) || requestedAidsRef.current.has(aid) || aid in anchorTextCache) continue
      requestedAidsRef.current.add(aid)
      const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      pendingResolveRef.current.set(nonce, aid)
      try {
        win.postMessage({ channel: BRIDGE_CHANNEL, type: 'resolve-anchor-text', token, nonce, aid }, '*')
      } catch {
        // Frame gone: leave uncached so a later render retries.
        requestedAidsRef.current.delete(aid)
        pendingResolveRef.current.delete(nonce)
      }
    }
  }, [visibleAnchorAids, frameReadyTick, anchorTextCache])

  // Explicit activation: clicking a comment thread scrolls its element anchor into view and briefly
  // highlights it in the frame (non-destructive). Only element anchors carry a locatable aid; the
  // aid is validated/bounded before it crosses the bridge.
  const activateAnchor = useCallback((anchor: Anchor | null | undefined) => {
    if (!anchor || anchor.kind !== 'element' || !isValidAid(anchor.aid)) return
    const win = frameRef.current?.contentWindow
    const token = bridgeTokenRef.current
    if (!win || !token) return
    try {
      win.postMessage({ channel: BRIDGE_CHANNEL, type: 'scroll-to-anchor', token, aid: anchor.aid }, '*')
    } catch {
      /* frame gone; nothing to scroll */
    }
  }, [])

  // A permission/mode change that turns commenting off must drop any pending selection anchor.
  useEffect(() => {
    if (!mayComment || mode === 'code') setPendingAnchor(null)
  }, [mayComment, mode])

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
          {sourceDiffEnabled && <div className="octo-html-doc-modes" role="tablist" aria-label={t('docs.mode.label')}>
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
          </div>}
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
          {resolvedRole && canForward && (
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
              ...(resolvedRole && canForward
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
              role={resolvedRole}
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
              compareEnabled={sourceDiffEnabled}
              onView={handleViewVersion}
              onCompare={handleCompare}
              onClose={() => setHistoryOpen(false)}
            />
          </div>
        </div>
      )}
      {/* Two-version diff modal (code + page tabs), shared DiffResult. */}
      {sourceDiffEnabled && diff && (
        <HtmlDiffModal
          slug={effectiveSlug}
          from={String(diff.from)}
          to={String(diff.to)}
          title={headerTitle}
          onClose={() => setDiff(null)}
        />
      )}
      {/* CODE mode: raw read-only source. No iframe, no comment anchors. */}
      {sourceDiffEnabled && mode === 'code' && (
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
              mayComment={mayComment}
              mayEdit={mayEdit}
              slug={effectiveSlug}
              listVersion={viewVersion}
              mutationVersion={meta?.version}
              pendingAnchor={pendingAnchor}
              resolveAnchorText={resolveAnchorText}
              onVisibleAnchors={handleVisibleAnchorAids}
              onActivateAnchor={activateAnchor}
              onClearPendingAnchor={() => setPendingAnchor(null)}
              onPosted={() => setPendingAnchor(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}
