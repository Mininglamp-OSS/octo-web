// Read-only viewer for a `docType==='html'` document (env ring 2a).
//
// Contract:
//   - READ-ONLY: the HTML is agent-authored; a human may only read it (comments + "让 AI
//     处理" arrive in ring 2b). This component renders NO editing chrome and, via
//     sanitizeDocHtml below, strips any interactive/editable elements from the payload.
//   - INLINE (not an iframe): the published HTML is fetched and inlined into the docs
//     content region so it shares the docs width / scroll container / theme tokens.
//   - SEPARATE BACKEND: octo-doc is a distinct deployment from the same-origin Yjs
//     `/api/v1` docs backend, so we use a plain fetch (with credentials) against
//     resolveOctoDocBase() rather than the octoweb apiClient.
//
// SECURITY: the published HTML is NOT sanitized end-to-end by the backend (ring 1 only
// validates aid-replace fragments, not the whole Publish payload), so it may contain
// <script>, on* handlers, javascript: URLs, or interactive/editable controls. Every
// payload is therefore run through DOMPurify before it is inlined — see sanitizeDocHtml.

import { useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { t, getWKApp } from '../octoweb/index.ts'
import { HtmlDocCommentPanel } from './HtmlDocCommentPanel.tsx'
import { buildAnchorFromSelection } from './htmlDocAnchor.ts'
import type { Anchor } from './htmlDocComments.ts'
import './HtmlDocView.css'

// Interactive/editable elements the read-only view must never render, even if DOMPurify's
// default (script/handler) baseline would otherwise let their markup through. This enforces
// the product's "human reads, never edits" hard constraint.
const FORBID_TAGS = [
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'form',
  'label',
  'fieldset',
]
// contenteditable would make plain elements editable; autofocus/onfocus are event-ish
// affordances. (Generic on* handlers + javascript: URLs are already removed by DOMPurify's
// default profile; contenteditable must be forbidden explicitly.)
// style is forbidden: DOMPurify keeps inline style verbatim without deep-cleaning CSS values,
// leaving a CSS injection surface (url(javascript:…)/expression()/url(//evil?leak) exfil/UI
// overlay). Presentational styling belongs to octo-doc's published-page class/external CSS.
const FORBID_ATTR = ['contenteditable', 'autofocus', 'onfocus', 'style']

/**
 * Sanitize agent-authored HTML for read-only inlining.
 *
 * Relies on DOMPurify's default safe baseline (drops <script>, on* handlers and
 * javascript:/data: script URLs) and additionally strips interactive/editable elements and
 * the contenteditable attribute so the rendered doc is strictly presentational. Ordinary
 * display markup (p/div/span/headings/table/img/a/lists/code/pre/blockquote, plus
 * class/href/src) is preserved by the default allow-list; inline style is forbidden (see
 * FORBID_ATTR) to close the CSS-value injection surface DOMPurify does not deep-clean.
 */
export function sanitizeDocHtml(raw: string): string {
  return DOMPurify.sanitize(raw, {
    FORBID_TAGS,
    FORBID_ATTR,
  })
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
}

/**
 * Resolve the octo-doc backend base URL.
 *
 * octo-doc is a distinct deployment from the docs `/api/v1` backend, so its origin is
 * configured independently. Resolution order:
 *   1. `window.__OCTO_DOC_BASE__` — runtime injection (host config / index.html), so the
 *      same bundle points at different octo-doc origins per environment without a rebuild.
 *   2. `import.meta.env.VITE_OCTO_DOC_BASE` — build-time override.
 *   3. Empty string — resolve RELATIVE to the page origin (i.e. octo-doc reverse-proxied
 *      under the same host). This is a safe default; a deployment where octo-doc lives
 *      elsewhere must set one of the two overrides above.
 */
export function resolveOctoDocBase(): string {
  const runtime =
    typeof window !== 'undefined'
      ? (window as unknown as { __OCTO_DOC_BASE__?: unknown }).__OCTO_DOC_BASE__
      : undefined
  if (typeof runtime === 'string' && runtime.trim()) return runtime.trim().replace(/\/+$/, '')
  const env =
    typeof import.meta !== 'undefined'
      ? (import.meta as unknown as { env?: { VITE_OCTO_DOC_BASE?: string } }).env?.VITE_OCTO_DOC_BASE
      : undefined
  if (typeof env === 'string' && env.trim()) return env.trim().replace(/\/+$/, '')
  // Same-origin default: octo-doc proxied under the current host.
  return ''
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
  | { status: 'ready'; html: string; meta: OctoDocMeta | null }

// Minimal metadata the render page injects as window.__ODOC__ (see doc-side render).
// Used to populate the header (title/creator/version). Fields the backend does not yet
// expose (human title, creator display name) are absent and fall back gracefully.
interface OctoDocMeta {
  slug?: string
  title?: string
  version?: number
  identity?: { login?: string; name?: string } | null
  creator_uid?: string
  creator_name?: string
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

export function HtmlDocView({ docId, space, role, slug, version = 'latest' }: HtmlDocViewProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  // Guards a late fetch resolve from overwriting state after the docId/slug changed.
  const reqSeq = useRef(0)
  const effectiveSlug = slug ?? docId
  // 划词评论: the anchor lifted from the last non-collapsed selection inside the read-only
  // content. Overlay state only — the content itself is never mutated / made editable.
  const [pendingAnchor, setPendingAnchor] = useState<Anchor | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // Header UI state. Members/forward/more backends are not wired yet; these drive a
  // transient "coming soon" hint so the buttons render and are clearly present.
  const [membersOpen, setMembersOpen] = useState(false)
  const [headerNotice, setHeaderNotice] = useState<'forward' | 'more' | null>(null)
  const meta = state.status === 'ready' ? state.meta : null
  // Title: backend does not expose a human title yet → fall back to slug. Creator: prefer a
  // display name, else the creator/login uid.
  const headerTitle = meta?.title || effectiveSlug
  const headerCreator =
    meta?.creator_name || meta?.identity?.name || meta?.creator_uid || meta?.identity?.login || '—'

  useEffect(() => {
    const seq = ++reqSeq.current
    setState({ status: 'loading' })
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
              (resolveOctoDocBase() ? '' : ' — octo-doc base is unconfigured (same-origin default); set VITE_OCTO_DOC_BASE or window.__OCTO_DOC_BASE__ if octo-doc is cross-origin'),
          )
          setState({ status: 'error', url, reason: `status ${res.status}` })
          return
        }
        const html = await res.text()
        if (seq !== reqSeq.current) return
        setState(
          html.trim()
            ? { status: 'ready', html: sanitizeDocHtml(html), meta: parseOdocMeta(html) }
            : { status: 'empty' },
        )
      })
      .catch((err) => {
        if (seq !== reqSeq.current) return
        console.warn(
          `[HtmlDocView] octo-doc request errored for ${url}` +
            (resolveOctoDocBase() ? '' : ' — octo-doc base is unconfigured (same-origin default); set VITE_OCTO_DOC_BASE or window.__OCTO_DOC_BASE__ if octo-doc is cross-origin'),
          err,
        )
        setState({ status: 'error', url, reason: 'network' })
      })
  }, [effectiveSlug, version])

  // 划词评论 watcher: after each selection change, if the human selected text INSIDE the
  // read-only content region, derive an octo-doc anchor (element aid preferred, else text) and
  // surface a "评论" affordance via the comment panel's pre-targeted composer. Read-only is
  // preserved: we only READ the Selection, never mutate the DOM or set contenteditable.
  useEffect(() => {
    if (state.status !== 'ready') return
    function onSelectionChange() {
      const sel = typeof window !== 'undefined' ? window.getSelection() : null
      const container = contentRef.current
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !container) {
        setPendingAnchor(null)
        return
      }
      // Only react to selections that live inside the read-only content region.
      if (!container.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        setPendingAnchor(null)
        return
      }
      setPendingAnchor(buildAnchorFromSelection(sel))
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [state.status])

  // Auto-dismiss the transient header "coming soon" hint.
  useEffect(() => {
    if (!headerNotice) return
    const id = window.setTimeout(() => setHeaderNotice(null), 2500)
    return () => window.clearTimeout(id)
  }, [headerNotice])

  return (
    <div className="octo-doc octo-doc--editor octo-theme octo-html-doc" data-testid="html-doc-view">
      {/* Header parity with rich docs (BoardShell/EditorShell octo-doc-header): title, creator,
          forward-to-chat, members, and a more menu. HTML docs are read-only so title is static.
          Members/menu are wired as buttons now; their backends (doc_grants) land in a later pass —
          see the group discussion. Fields the render page doesn't yet expose (human title,
          creator display name) fall back to slug / login uid. */}
      <header className="octo-doc-header octo-html-doc-header">
        <div className="octo-doc-title octo-html-doc-title" title={headerTitle}>
          {headerTitle}
        </div>
        <div className="octo-doc-header-right">
          <span className="octo-html-doc-creator" title={t('docs.header.creator')}>
            {t('docs.header.creator')}: {headerCreator}
          </span>
          <button
            type="button"
            className="octo-tb-btn octo-doc-forward-btn"
            title={t('docs.forward.entry')}
            onClick={() => setHeaderNotice('forward')}
          >
            ⤴ {t('docs.forward.entry')}
          </button>
          <button
            type="button"
            className={membersOpen ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
            aria-pressed={membersOpen}
            title={t('docs.toolbar.members')}
            onClick={() => setMembersOpen((v) => !v)}
          >
            {t('docs.toolbar.members')}
          </button>
          <button
            type="button"
            className="octo-tb-btn octo-html-doc-more"
            aria-label={t('docs.toolbar.more')}
            title={t('docs.toolbar.more')}
            onClick={() => setHeaderNotice('more')}
          >
            ≡
          </button>
        </div>
      </header>
      {/* Members/forward/more backends are not wired yet — surface a transient hint so the
          buttons are visibly present (老板 asked to show the header first). */}
      {headerNotice && (
        <div className="octo-html-doc-state" role="status">
          {t('docs.header.comingSoon')}
        </div>
      )}
      {membersOpen && (
        <div className="octo-html-doc-state" role="status">
          {t('docs.header.membersComingSoon')}
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
      {state.status === 'empty' && (
        <div className="octo-html-doc-state">{t('docs.state.empty')}</div>
      )}
      {state.status === 'ready' && (
        // Read-only presentation ONLY. The payload is sanitized (sanitizeDocHtml) before it
        // is inlined — the backend does not guarantee the whole Publish HTML is safe, and the
        // sanitizer also strips interactive/editable elements to keep the view read-only.
        <div
          ref={contentRef}
          className="octo-html-doc-content"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: state.html }}
        />
      )}

      {/*
        2b EXTENSION POINT: the read-only side comment panel + "让 AI 处理" entry mount here.
        The panel is an overlay rail beside the sanitized content — it is NEVER injected into the
        sanitized HTML, so the view stays strictly read-only. It only renders once the doc is
        readable (a comment scope needs a real slug/version).
      */}
      {state.status === 'ready' && (
        <HtmlDocCommentPanel
          docId={docId}
          space={space}
          role={role}
          slug={effectiveSlug}
          version={version}
          pendingAnchor={pendingAnchor}
          onPosted={() => setPendingAnchor(null)}
        />
      )}
    </div>
  )
}
