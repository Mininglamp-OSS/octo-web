// Same-origin Bento container for the html_ppt peer surfaces (R3-F1, XIN-1495 / XIN-1583).
//
// Bento is a single-HTML slide engine that runs its own JS. The backend (octo-docs-backend #161)
// serves a deck's rendered source at `GET /api/v1/ppt/docs/:docId/source` and mounts NO
// `/ppt/frame/:id` host page — so we do NOT navigate an iframe at a bespoke host route. Instead we
// FETCH the rendered single-file source through the shared apiClient (pptSourceClient.ts), so the
// app's auth / `X-Space-Id` / language interceptors apply, and host that HTML in a SAME-ORIGIN
// iframe via `srcdoc` (a srcdoc document inherits the embedder's origin, so it is same-origin by
// construction — no cross-origin host page, no baked-in credentials in a frame `src`).
//
// The bootstrap payload (source mode/version + any short-lived asset metadata) is still handed to
// the frame over the origin-checked `postMessage` handshake (bootstrapTransfer.ts): a srcdoc frame
// with `allow-same-origin` reports `event.origin === window.location.origin`, so the same trust gate
// — and its cross-origin negative control — holds unchanged.
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
 * Per-mode iframe sandbox. Bento needs `allow-scripts` to run and `allow-same-origin` to reach the
 * same-origin bootstrap channel; `present` additionally needs `allow-fullscreen` for the fullscreen
 * present affordance. No `allow-top-navigation` — the deck can never navigate the host away.
 */
function sandboxForMode(mode: PptBootstrap['mode']): string {
  const base = 'allow-scripts allow-same-origin'
  if (mode === 'present') return `${base} allow-fullscreen`
  return base
}

/**
 * Mount a same-origin Bento frame (srcdoc) with the deck's fetched source and answer its
 * origin-checked bootstrap request with `bootstrap`.
 *
 * The `serveBootstrap` listener is attached for this container's lifetime and only ever replies to a
 * SAME-ORIGIN request whose docId matches this deck — a cross-origin message is dropped without a
 * reply (see bootstrapTransfer.ts).
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
      // Same-origin, first-party Bento host: the source is fetched through the app's own apiClient and
      // rendered from `srcdoc`, which inherits this document's origin. Scripts + same-origin are
      // required for the engine and the bootstrap channel; present adds fullscreen. See sandboxForMode.
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
