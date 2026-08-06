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
// carry <script>, on* handlers, or javascript: URLs. A srcdoc document would inherit the embedder's
// origin, so granting `allow-same-origin` alongside `allow-scripts` would let the deck's scripts run
// AS the parent origin with full access to parent-origin cookies / localStorage / DOM (a stored-XSS
// escalation). We therefore run the frame WITHOUT `allow-same-origin` (see sandboxForMode): the
// srcdoc loads in an OPAQUE origin where Bento's scripts still execute against the frame's own
// document but can touch nothing in the parent origin. This mirrors the intent of the sibling
// `packages/docs/src/html/HtmlDocView.tsx` (which isolates its unsanitized fetched HTML) while still
// letting the engine run.
//
// DELIVERY PATH: the deck's rendered source is delivered by the `srcdoc` injection ITSELF — that is
// the single, load-bearing delivery path here. There is NO postMessage bootstrap handshake in the
// live container: an opaque-origin frame's message arrives with `event.origin === 'null'`, which the
// origin gate (bootstrapTransfer.ts) can never trust, so a handshake is structurally impossible under
// this sandbox. The origin-gated bootstrap module is retained as DEFERRED scaffolding for a future
// separate-origin host page (see the P1-A discussion on XIN-1615); it is intentionally NOT wired
// here, so nothing in this component depends on a channel that cannot run.
//
// This component is the peer mount point — it is deliberately NOT wired through EditorShell (a Bento
// deck has no Yjs/ProseMirror payload and no Hocuspocus room; mounting it through the rich-text host
// would mint a collab token against a PPT documentName the backend rejects) and it requests NO
// Hocuspocus token.
//
// EXPOSURE GATE: this container consumes LIVE backend source, so it is only ever mounted by a caller
// that has already checked PPT_SOURCE_ENABLED. While the flag is OFF the caller renders the gated
// shell and this component never mounts (no fetch, no frame, no token).

import { useEffect, useState } from 'react'
import { t } from '../octoweb/index.ts'
import type { PptBootstrapMode } from './bootstrapTransfer.ts'
import { fetchPptSourceHtml } from './pptSourceClient.ts'
import './BentoContainer.css'

export interface BentoContainerProps {
  /** Deck id whose rendered source is fetched and hosted. */
  docId: string
  /**
   * Resolved source mode driving the backend `mode` mapping and the sandbox. A reader/commenter is
   * given a read-only mode (`preview`/`present` → `published`); only a writer/admin editor context
   * resolves to `editor` (→ `live`). The container never decides this — the caller does.
   */
  mode: PptBootstrapMode
  /** `'latest'` or a published `version_seq`; only serialized for the published modes. */
  version: 'latest' | number
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
function sandboxForMode(mode: PptBootstrapMode): string {
  const base = 'allow-scripts'
  if (mode === 'present') return `${base} allow-fullscreen`
  return base
}

/**
 * Mount an isolated (opaque-origin) Bento frame (srcdoc) with the deck's fetched source.
 *
 * The deck HTML is fetched through the shared apiClient (interceptors applied) and injected via
 * `srcdoc`; the frame renders entirely from that. No postMessage handshake runs here — see the file
 * header for why the opaque origin forecloses it.
 */
export function BentoContainer({
  docId,
  mode,
  version,
  space,
  title,
  className,
}: BentoContainerProps): React.ReactElement {
  const [source, setSource] = useState<SourceState>({ status: 'loading' })

  // Fetch the rendered single-file source through the shared apiClient (interceptors applied). Bento
  // decks are self-contained HTML, so `format=html` returns the whole renderable deck.
  useEffect(() => {
    let cancelled = false
    setSource({ status: 'loading' })
    fetchPptSourceHtml({ docId, mode, version, space })
      .then((html) => {
        if (!cancelled) setSource({ status: 'ready', html })
      })
      .catch(() => {
        if (!cancelled) setSource({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [docId, mode, version, space])

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
      className={className ?? 'octo-ppt-frame'}
      // First-party Bento host: the source is fetched through the app's own apiClient and rendered
      // from `srcdoc`. The sandbox grants `allow-scripts` (the engine needs to run) but NOT
      // `allow-same-origin`, so the deck loads in an OPAQUE origin and its scripts cannot touch the
      // parent origin (XIN-1608 P0); present adds fullscreen. See sandboxForMode.
      sandbox={sandboxForMode(mode)}
      allow="fullscreen"
      title={title}
      srcDoc={source.html}
    />
  )
}
