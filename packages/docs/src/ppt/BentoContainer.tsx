// Isolated Bento container for the html_ppt peer surfaces (R3-F1, XIN-1495 / XIN-1583).
//
// Bento is a single-HTML slide engine that runs its own JS. The backend (octo-docs-backend #161)
// serves a deck's rendered source at `GET /api/v1/ppt/docs/:docId/source` and mounts NO
// `/ppt/frame/:id` host page — so we do NOT navigate an iframe at a bespoke host route. Instead we
// FETCH the rendered single-file source through the shared apiClient (pptSourceClient.ts), so the
// app's auth / `X-Space-Id` / language interceptors apply, and host that HTML in a sandboxed iframe
// via `srcdoc`.
//
// SECURITY (XIN-1608 P0): the deck HTML is user-authored and NOT end-to-end sanitized, so it may
// carry <script>, on* handlers, or javascript: URLs. A srcdoc document inherits the embedder's
// origin, so granting `allow-same-origin` alongside `allow-scripts` would let the deck's scripts run
// AS the parent origin with full access to parent-origin cookies / localStorage / DOM (a stored-XSS
// escalation). We therefore run the frame WITHOUT `allow-same-origin` (see sandboxForMode): the
// srcdoc loads in an OPAQUE origin where Bento's scripts still execute against the frame's own
// document but can touch nothing in the parent origin. This mirrors the intent of the sibling
// `packages/docs/src/html/HtmlDocView.tsx` (which isolates its unsanitized fetched HTML) while still
// letting the engine run. The deck's rendered source is delivered by the `srcdoc` injection itself —
// that is the load-bearing delivery path.
//
// The origin-checked `postMessage` handshake (bootstrapTransfer.ts) is retained UNCHANGED and stays
// fail-closed: it only ever trusts an EXACT same-origin match, so an opaque-origin frame's request
// (`event.origin === 'null'`) is rejected without a reply — the same negative control the acceptance
// matrix pins. It is forward scaffolding (a future same-origin-served host page) and issues NO
// Hocuspocus token; the P0 isolation change does not weaken its origin gate (verified by
// bootstrapTransfer.test.ts, which is sandbox-independent).
//
// This component is the peer mount point — it is deliberately NOT wired through EditorShell (a Bento
// deck has no Yjs/ProseMirror payload and no Hocuspocus room; mounting it through the rich-text host
// would mint a collab token against a PPT documentName the backend rejects) and it requests NO
// Hocuspocus token.
//
// EXPOSURE GATE: this container consumes LIVE backend source, so it is only ever mounted by a caller
// that has already checked PPT_SOURCE_ENABLED. While the flag is OFF the caller renders the gated
// shell and this component never mounts (no fetch, no frame, no token).

import { useEffect, useRef, useState } from 'react'
import { t } from '../octoweb/index.ts'
import { serveBootstrap, type PptBootstrap } from './bootstrapTransfer.ts'
import { fetchPptSourceHtml } from './pptSourceClient.ts'
import './BentoContainer.css'

export interface BentoContainerProps {
  /** The bootstrap payload served to the frame when it requests it (origin-checked handshake). */
  bootstrap: PptBootstrap
  /** Owning space, forwarded as `X-Space-Id` on the source fetch (parity with getDoc). */
  space?: string
  /** Accessible frame title (deck title when known). */
  title: string
  className?: string
}

type SourceState =
  | { status: 'loading' }
  | { status: 'ready'; html: string }
  | { status: 'error' }

/**
 * Per-mode iframe sandbox. The deck source is user-authored and NOT end-to-end sanitized, so the
 * frame runs Bento's scripts (`allow-scripts`) but DELIBERATELY WITHOUT `allow-same-origin`: the
 * srcdoc document therefore loads in an OPAQUE origin, and its scripts cannot read the parent
 * origin's cookies / localStorage / DOM (XIN-1608 P0 — Option A). Granting both `allow-scripts` and
 * `allow-same-origin` over unsanitized HTML would let the deck execute AS the parent origin, so the
 * two are never combined here. `present` additionally needs `allow-fullscreen`. No
 * `allow-top-navigation` — the deck can never navigate the host away.
 */
function sandboxForMode(mode: PptBootstrap['mode']): string {
  const base = 'allow-scripts'
  if (mode === 'present') return `${base} allow-fullscreen`
  return base
}

/**
 * Mount an isolated (opaque-origin) Bento frame (srcdoc) with the deck's fetched source and answer
 * any origin-checked bootstrap request with `bootstrap`.
 *
 * The `serveBootstrap` listener is attached for this container's lifetime and only ever replies to an
 * EXACT same-origin request whose docId matches this deck — every other message (including the
 * opaque-origin frame's own `event.origin === 'null'`) is dropped without a reply (see
 * bootstrapTransfer.ts). The handshake is thus fail-closed under the isolated sandbox.
 */
export function BentoContainer({
  bootstrap,
  space,
  title,
  className,
}: BentoContainerProps): React.ReactElement {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [rejectedCount, setRejectedCount] = useState(0)
  const [source, setSource] = useState<SourceState>({ status: 'loading' })

  // Fetch the rendered single-file source through the shared apiClient (interceptors applied). Bento
  // decks are self-contained HTML, so `format=html` returns the whole renderable deck.
  useEffect(() => {
    let cancelled = false
    setSource({ status: 'loading' })
    fetchPptSourceHtml({
      docId: bootstrap.docId,
      mode: bootstrap.mode,
      version: bootstrap.version,
      space,
    })
      .then((html) => {
        if (!cancelled) setSource({ status: 'ready', html })
      })
      .catch(() => {
        if (!cancelled) setSource({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [bootstrap.docId, bootstrap.mode, bootstrap.version, space])

  // Origin-checked handshake: answer only a same-origin request for this deck; drop everything else.
  // Attached once the frame is on the page (source ready) so the srcdoc frame is present to reply to.
  useEffect(() => {
    if (source.status !== 'ready') return
    const dispose = serveBootstrap({
      provide: (request) => (request.docId === bootstrap.docId ? bootstrap : null),
      // Surface cross-origin/malformed attempts for observability; the count is diagnostic only.
      onReject: () => setRejectedCount((n) => n + 1),
    })
    return dispose
  }, [bootstrap, source.status])

  if (source.status === 'loading') {
    return (
      <div className="octo-ppt-frame-state" role="status">
        {t('docs.ppt.loading')}
      </div>
    )
  }

  if (source.status === 'error') {
    return (
      <div className="octo-ppt-frame-state octo-ppt-frame-state--error" role="alert">
        {t('docs.ppt.loadError')}
      </div>
    )
  }

  return (
    <iframe
      ref={iframeRef}
      className={className ?? 'octo-ppt-frame'}
      // First-party Bento host: the source is fetched through the app's own apiClient and rendered
      // from `srcdoc`. The sandbox grants `allow-scripts` (the engine needs to run) but NOT
      // `allow-same-origin`, so the deck loads in an OPAQUE origin and its scripts cannot touch the
      // parent origin (XIN-1608 P0); present adds fullscreen. See sandboxForMode.
      sandbox={sandboxForMode(bootstrap.mode)}
      allow="fullscreen"
      title={title}
      srcDoc={source.html}
      // Diagnostic attribute only (never read by the frame) so a test / debugger can see whether any
      // cross-origin handshake was rejected during this mount.
      data-ppt-rejected={rejectedCount}
    />
  )
}
