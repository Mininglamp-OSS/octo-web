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
import { canForwardToChat, openDocForward, t, getWKApp } from '../octoweb/index.ts'
import { HtmlDocCommentPanel } from './HtmlDocCommentPanel.tsx'
import { HtmlMemberPanel } from './HtmlMemberPanel.tsx'
import { HtmlPresenceBar } from './HtmlPresenceBar.tsx'
import { deleteDoc } from './htmlDocAdmin.ts'
import { ConfirmModal } from '../editor/ConfirmModal.tsx'
import {
  DocMoreMenu,
  OpenNewPageIcon,
  LinkIcon,
  DeleteIcon,
  type DocMoreMenuItem,
} from '../editor/DocMoreMenu.tsx'
import { buildAnchorFromSelection, truncateAnchorText } from './htmlDocAnchor.ts'
import type { Anchor } from './htmlDocComments.ts'
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

function resolveAbsoluteOctoDocBase(): string {
  const pageOrigin =
    typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://localhost'
  return new URL(resolveOctoDocBase() || '/', `${pageOrigin}/`).href.replace(/\/+$/, '')
}

function resolveAbsoluteUrl(value: string): string {
  const pageOrigin =
    typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://localhost'
  return new URL(value || '/', `${pageOrigin}/`).href
}

function isAbsoluteOrSpecialUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) || value.startsWith('//') || value.startsWith('#')
}

// basePrefix is the octo-doc same-origin path prefix (resolveOctoDocBase, e.g. '/docs-html'),
// empty for cross-origin/override deployments. A root-relative octo-doc asset ref like
// `/d/{slug}/assets/{sha}` (the form the doc backend emits, see signAssetURLs) resolves
// against the PAGE ORIGIN and would DROP the prefix, hitting a path the nginx no longer
// proxies — re-root it under basePrefix first so it stays inside /docs-html/*. Only re-root
// when docUrl itself sits under basePrefix (i.e. the same-origin prefixed deploy); an
// absolute/override docUrl already carries the doc origin and must be left alone.
function resolveDocAssetUrl(value: string, docUrl: string, basePrefix = ''): string | null {
  if (!value || isAbsoluteOrSpecialUrl(value)) return null
  try {
    const docPath = new URL(docUrl).pathname
    const underPrefix = !!basePrefix && (docPath === basePrefix || docPath.startsWith(basePrefix + '/'))
    const rebased =
      underPrefix && value.startsWith('/d/') && !value.startsWith(basePrefix + '/') ? basePrefix + value : value
    const url = new URL(rebased, docUrl)
    return /\/assets\//.test(url.pathname) ? url.href : null
  } catch {
    return null
  }
}

function absolutizeAssetAttr(el: Element, attr: 'src' | 'href', docUrl: string, basePrefix = '') {
  const raw = el.getAttribute(attr)
  if (!raw) return
  const value = raw.trim()
  const resolved = resolveDocAssetUrl(value, docUrl, basePrefix)
  if (resolved) el.setAttribute(attr, resolved)
}

function neutralizeEditableControls(doc: Document) {
  doc.querySelectorAll('[contenteditable]').forEach((el) => {
    el.setAttribute('contenteditable', 'false')
  })
  doc.querySelectorAll('input, textarea, select, button').forEach((el) => {
    el.setAttribute('disabled', '')
  })
}

function cssAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function resolveHtmlDocAnchorText(
  anchor: Anchor | null | undefined,
  doc: Document | null | undefined
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

/**
 * srcdoc resolves relative URLs against about:srcdoc. Only octo-doc asset URLs are rewritten
 * against the real document URL, and editable controls are preserved visually but disabled.
 */
export function absolutizeDocAssetUrls(html: string, docUrl = resolveAbsoluteOctoDocBase()): string {
  if (typeof DOMParser === 'undefined') return html
  const absoluteDocUrl = resolveAbsoluteUrl(docUrl)
  // Same-origin path prefix (e.g. '/docs-html'); '' for absolute/cross-origin bases. Used to
  // re-root the backend's root-relative `/d/...` asset refs so they keep the prefix.
  const base = resolveOctoDocBase()
  const basePrefix = base.startsWith('/') ? base.replace(/\/+$/, '') : ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('img[src]').forEach((el) => absolutizeAssetAttr(el, 'src', absoluteDocUrl, basePrefix))
  doc.querySelectorAll('link[href]').forEach((el) => absolutizeAssetAttr(el, 'href', absoluteDocUrl, basePrefix))
  neutralizeEditableControls(doc)
  const doctype = doc.doctype ? `<!doctype ${doc.doctype.name}>` : ''
  return `${doctype}${doc.documentElement.outerHTML}`
}

/**
 * Inject a <base href> so relative/root-path resources (CSS background-image, srcset, url(…))
 * resolve against the real doc origin instead of about:srcdoc.
 *
 * srcDoc renders under about:srcdoc, where relative/root URLs have no meaningful base. img[src]
 * / link[href] are already absolutized by absolutizeDocAssetUrls, but CSS-referenced assets
 * (background-image, mask, etc.) are not — <base> is the single fallback that fixes them all.
 * Effective because the iframe is sandbox="allow-same-origin". Inserted at the START of <head>
 * (or synthesized before <html>/content when absent) so it wins over any later in-doc <base>.
 */
export function injectBaseHref(html: string, baseUrl: string): string {
  if (!baseUrl) return html
  // Ensure a trailing slash so a root path like /d/… resolves against the doc root, not a file.
  const href = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const baseTag = `<base href="${href.replace(/"/g, '&quot;')}">`
  const headOpen = /<head[^>]*>/i.exec(html)
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length
    return `${html.slice(0, at)}${baseTag}${html.slice(at)}`
  }
  return `${baseTag}${html}`
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
}

/**
 * Resolve the octo-doc backend base URL.
 *
 * octo-doc is a distinct deployment from the docs `/api/v1` backend, so its origin is
 * configured independently. Resolution order:
 *   1. `window.__OCTO_DOC_BASE__` — runtime injection (host config / index.html), so the
 *      same bundle points at different octo-doc origins per environment without a rebuild.
 *   2. `import.meta.env.VITE_OCTO_DOC_BASE` — build-time override.
 *   3. Default `/docs-html` — a same-origin unified prefix. All web→octo-doc traffic
 *      (render `/d/…`, and the real backend paths `/v1/comments`, `/v1/reactions`,
 *      `/v1/docs/{slug}/grants`, `/v1/docs/{slug}`, `/v1/docs/{slug}/versions`) is namespaced
 *      under this one prefix so it is easy to govern and cannot collide with SPA or other
 *      service routes. The web nginx strips `/docs-html/` with a single rewrite and forwards
 *      the remaining real path to octo-doc. A deployment where octo-doc lives elsewhere sets
 *      one of the overrides above.
 */
export function resolveOctoDocBase(): string {
  const runtime =
    typeof window !== 'undefined' ? (window as unknown as { __OCTO_DOC_BASE__?: unknown }).__OCTO_DOC_BASE__ : undefined
  if (typeof runtime === 'string' && runtime.trim()) return runtime.trim().replace(/\/+$/, '')
  const env =
    typeof import.meta !== 'undefined'
      ? (import.meta as unknown as { env?: { VITE_OCTO_DOC_BASE?: string } }).env?.VITE_OCTO_DOC_BASE
      : undefined
  if (typeof env === 'string' && env.trim()) return env.trim().replace(/\/+$/, '')
  // Same-origin unified prefix: octo-doc reverse-proxied under /docs-html (see web nginx).
  return '/docs-html'
}

/** Build the octo-doc read-only render URL: `<base>/d/{slug}/v/{version}`. */
export function buildOctoDocUrl(slug: string, version: string): string {
  const base = resolveOctoDocBase()
  return `${base}/d/${encodeURIComponent(slug)}/v/${encodeURIComponent(version)}`
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; url?: string; reason?: string }
  | { status: 'empty' }
  | { status: 'ready'; html: string; meta: OctoDocMeta | null; isAuthor: boolean }

// Minimal metadata the render page injects as window.__ODOC__ (see doc-side render).
// ⚠️ identity here is the CURRENT VIEWER's session identity (identityFromSession), NOT the
// doc creator. __ODOC__ (core.OverlayConfig) does NOT carry creator_uid — so never derive
// authorship by comparing viewer uid against identity.login (that is always the viewer =
// always true). Authorship comes from window.__ODOC_CAP__.isAuthor (see parseOdocCap).
interface OctoDocMeta {
  slug?: string
  title?: string
  version?: number
  identity?: { login?: string; name?: string } | null
  creator_uid?: string
  creator_name?: string
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

export function HtmlDocView({ docId, space, slug, version = 'latest', onDeleted }: HtmlDocViewProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  // Guards a late fetch resolve from overwriting state after the docId/slug changed.
  const reqSeq = useRef(0)
  const effectiveSlug = slug ?? docId
  // 划词评论: the anchor lifted from the last non-collapsed selection inside the read-only
  // content. Overlay state only — the content itself is never mutated / made editable.
  const [pendingAnchor, setPendingAnchor] = useState<Anchor | null>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const selectionDocRef = useRef<Document | null>(null)
  const [frameReadyTick, setFrameReadyTick] = useState(0)
  // Header UI state.
  const [membersOpen, setMembersOpen] = useState(false)
  // Comments default open (preserves prior behaviour); the 💬 button toggles the rail.
  const [commentsOpen, setCommentsOpen] = useState(true)
  // Delete flow (≡ → 删除此文档, author-only): confirm modal + in-flight/error state.
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const meta = state.status === 'ready' ? state.meta : null
  // Backend-authoritative authorship (resolveCap → window.__ODOC_CAP__.isAuthor). Do NOT compare
  // viewer uid to any __ODOC__ field: identity there is the viewer itself and creator_uid is absent,
  // so a client-side comparison would make every viewer an "author" (the invited-viewer-as-owner bug).
  const isAuthor = state.status === 'ready' ? state.isAuthor : false
  // Title: backend does not expose a human title yet → fall back to slug. Creator: prefer a
  // display name, else the creator/login uid.
  const headerTitle = meta?.title || effectiveSlug
  const headerCreator = meta?.creator_name || meta?.creator_uid || '—'
  // Author-only affordances (member management, delete) gate on the backend flag, never on uid math.
  const creatorUid = meta?.creator_uid
  const canManage = isAuthor
  // Browser-openable address for this doc (new-page / forward). window.location keeps whatever
  // route the viewer is on; buildOctoDocUrl is the canonical /d/{slug}/v/{version} fallback.
  const docUrl =
    typeof window !== 'undefined' && window.location?.href
      ? window.location.href
      : buildOctoDocUrl(effectiveSlug, version)
  const canForward = canForwardToChat()

  const doForward = useCallback(() => {
    if (!canForward) return
    // Doc-level forward: the whole document link (not a specific comment). canGrant=false — this
    // shares a read link, not an access grant.
    openDocForward({ docId, title: headerTitle, link: docUrl, canGrant: false })
  }, [canForward, docId, headerTitle, docUrl])

  const confirmDeleteDoc = useCallback(() => {
    setDeleting(true)
    setDeleteError(null)
    deleteDoc(effectiveSlug)
      .then(() => {
        setConfirmDelete(false)
        // Prefer the shell's onDeleted (returns to the list + refreshes it, mirror of SheetView);
        // only fall back to history.back() on the standalone /d/ surface where no shell is present.
        if (onDeleted) onDeleted(docId)
        else if (typeof window !== 'undefined') window.history.back()
      })
      .catch(() => setDeleteError(t('docs.state.error')))
      .finally(() => setDeleting(false))
  }, [effectiveSlug, onDeleted, docId])

  useEffect(() => {
    const seq = ++reqSeq.current
    setState({ status: 'loading' })
    setPendingAnchor(null)
    setFrameReadyTick(0)
    const url = buildOctoDocUrl(effectiveSlug, version)
    // Raw fetch (see file header): octo-doc is a separate backend; carry cookies AND the octo
    // session token so octo-doc can verify identity (author=creator) — cookies alone don't
    // cross to octo-doc; octo verifies via the `token` header (not Authorization).
    const headers: Record<string, string> = { Accept: 'text/html' }
    const octoToken = getWKApp().loginInfo?.token
    if (octoToken) headers.token = octoToken
    fetch(url, { credentials: 'include', headers })
      .then(async (res) => {
        if (seq !== reqSeq.current) return
        if (!res.ok) {
          // Diagnostic: a misconfigured octo-doc base silently resolves to the CURRENT host
          // (same-origin default), so a cross-origin deployment that forgot VITE_OCTO_DOC_BASE
          // / __OCTO_DOC_BASE__ hits the wrong host and 404s. Surface the actual URL + status
          // (and whether the base is unconfigured) to make that misconfig obvious in the console.
          console.warn(
            `[HtmlDocView] octo-doc read failed (${res.status}) for ${url}` +
              (resolveOctoDocBase()
                ? ''
                : ' — octo-doc base is unconfigured (same-origin default); set VITE_OCTO_DOC_BASE or window.__OCTO_DOC_BASE__ if octo-doc is cross-origin')
          )
          setState({ status: 'error', url, reason: `status ${res.status}` })
          return
        }
        const html = await res.text()
        if (seq !== reqSeq.current) return
        setState(
          html.trim()
            ? {
                status: 'ready',
                // Absolutize known asset attrs, then inject <base> as the catch-all so CSS-referenced
                // (background/url()) and any other relative/root resources resolve to the real origin.
                html: injectBaseHref(absolutizeDocAssetUrls(html, url), resolveAbsoluteOctoDocBase()),
                meta: parseOdocMeta(html),
                isAuthor: parseOdocCap(html),
              }
            : { status: 'empty' }
        )
      })
      .catch((err) => {
        if (seq !== reqSeq.current) return
        console.warn(
          `[HtmlDocView] octo-doc request errored for ${url}` +
            (resolveOctoDocBase()
              ? ''
              : ' — octo-doc base is unconfigured (same-origin default); set VITE_OCTO_DOC_BASE or window.__OCTO_DOC_BASE__ if octo-doc is cross-origin'),
          err
        )
        setState({ status: 'error', url, reason: 'network' })
      })
  }, [effectiveSlug, version])

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

  const handleFrameLoad = useCallback(() => {
    setFrameReadyTick((v) => v + 1)
    cleanupFrameSelectionWatcher()
    const frame = frameRef.current
    try {
      const doc = frame?.contentDocument
      if (!doc) throw new Error('missing iframe document')
      doc.addEventListener('selectionchange', onFrameSelectionChange)
      selectionDocRef.current = doc
    } catch (err) {
      console.warn('[HtmlDocView] unable to initialize iframe document hooks', err)
    }
  }, [cleanupFrameSelectionWatcher, onFrameSelectionChange])

  const resolveAnchorText = useCallback(
    (anchor: Anchor | null | undefined): string | null => {
      try {
        return resolveHtmlDocAnchorText(anchor, frameRef.current?.contentDocument)
      } catch {
        return null
      }
    },
    [frameReadyTick]
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
          the viewer avatar → 💬 comments → ⤴ forward → members → ≡ more. HTML docs are read-only so the
          title is static; the creator + created date moved into the ≡ menu head (avoids duplicating
          it in the bar). Retains octo-html-doc-header for HTML-specific CSS. */}
      <header className="octo-doc-header octo-html-doc-header">
        <div className="octo-doc-title octo-html-doc-title" title={headerTitle}>
          {headerTitle}
        </div>
        <div className="octo-doc-header-right">
          <HtmlPresenceBar />
          <button
            type="button"
            className={commentsOpen ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
            aria-pressed={commentsOpen}
            title={t('docs.toolbar.comments')}
            onClick={() => setCommentsOpen((v) => !v)}
          >
            💬 {t('docs.toolbar.comments')}
          </button>
          {/* Forward gated on canForward so it never renders as a dead no-op where the host lacks the
              conversation-select surface (the standalone /d/ page). */}
          {canForward && (
            <button
              type="button"
              className="octo-tb-btn octo-doc-forward-btn"
              title={t('docs.forward.entry')}
              onClick={doForward}
            >
              ⤴ {t('docs.forward.entry')}
            </button>
          )}
          {/* Members button is author-only: a reader has no member-management capability, so
              the entry is hidden entirely (parity with EditorShell's `{manage && …}` gate) rather
              than rendered as a click-to-empty no-op. */}
          {canManage && (
            <button
              type="button"
              className={membersOpen ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
              aria-pressed={membersOpen}
              title={t('docs.toolbar.members')}
              onClick={() => setMembersOpen((v) => !v)}
            >
              {t('docs.toolbar.members')}
            </button>
          )}
          <DocMoreMenu
            creatorName={headerCreator}
            createdAt={meta?.created_at}
            items={[
              {
                key: 'open-new-page',
                label: t('docs.standalone.openInNewPage'),
                icon: OpenNewPageIcon,
                onClick: () => window.open(docUrl, '_blank'),
              },
              ...(canForward
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
              canManage
                ? {
                    key: 'delete',
                    label: t('docs.doc.deleteEntry'),
                    icon: DeleteIcon,
                    danger: true,
                    onClick: () => {
                      setDeleteError(null)
                      setConfirmDelete(true)
                    },
                  }
                : undefined
            }
          />
        </div>
      </header>
      <ConfirmModal
        open={confirmDelete}
        title={t('docs.doc.deleteEntry')}
        message={t('docs.doc.deleteConfirm')}
        confirmLabel={t('docs.comment.delete')}
        cancelLabel={t('docs.comment.cancel')}
        danger
        busy={deleting}
        error={deleteError}
        onConfirm={confirmDeleteDoc}
        onCancel={() => setConfirmDelete(false)}
      />
      {/* Members open in a centered modal dialog (overlay + click-outside to close), matching the
          rich-doc member modal (EditorShell #A4) so HTML docs share the same floating-panel shape.
          Only the panel CONTENT differs (HtmlMemberPanel → octo-doc grants), never the shell. */}
      {membersOpen && canManage && (
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
              canManage={canManage}
              onClose={() => setMembersOpen(false)}
            />
          </div>
        </div>
      )}
      {state.status === 'loading' && (
        <div className="octo-html-doc-state" role="status">
          {t('docs.state.loading')}
        </div>
      )}
      {state.status === 'error' && (
        <div className="octo-html-doc-state octo-html-doc-state--error" role="alert">
          {t('docs.state.error')}
          {state.url && (
            // Inline the attempted octo-doc URL so a misconfigured base is diagnosable from
            // the UI (not just the console) — the request silently falls back to same-origin.
            <div className="octo-html-doc-state-detail">{state.url}</div>
          )}
        </div>
      )}
      {state.status === 'empty' && <div className="octo-html-doc-state">{t('docs.state.empty')}</div>}
      {state.status === 'ready' && (
        <div className="octo-html-doc-main" data-testid="html-doc-main">
          {/* allow-same-origin lets comments read selections; scripts stay disabled. */}
          <iframe
            ref={frameRef}
            className="octo-html-doc-frame"
            sandbox="allow-same-origin"
            title={headerTitle}
            srcDoc={state.html}
            onLoad={handleFrameLoad}
          />

          {/*
            2b EXTENSION POINT: the read-only side comment panel + "让 AI 处理" entry mount here.
            The panel is an overlay rail beside the iframe content — it is NEVER injected into the
            agent HTML, so the view stays strictly read-only. It only renders once the doc is
            readable (a comment scope needs a real slug/version).
          */}
          {commentsOpen && (
            <HtmlDocCommentPanel
              docId={docId}
              space={space}
              isAuthor={isAuthor}
              slug={effectiveSlug}
              version={version}
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
