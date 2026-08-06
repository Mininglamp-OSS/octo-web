// Same-origin Bento container for the html_ppt peer surfaces (R3-F1, XIN-1495 / XIN-1583).
//
// Bento is a single-HTML slide engine that runs its own JS. We host it in a SAME-ORIGIN iframe and
// hand it its bootstrap over an origin-checked `postMessage` handshake (bootstrapTransfer.ts) rather
// than baking source or asset credentials into the frame `src`. This component is the peer mount
// point — it is deliberately NOT wired through EditorShell (a Bento deck has no Yjs/ProseMirror
// payload and no Hocuspocus room; mounting it through the rich-text host would mint a collab token
// against a PPT documentName the backend rejects) and it requests NO Hocuspocus token.
//
// EXPOSURE GATE: this container consumes LIVE backend source, so it is only ever mounted by a caller
// that has already checked PPT_SOURCE_ENABLED. Until the backend R3-B1 source/bootstrap layer merges
// that flag defaults OFF and this component does not mount; the gated shell is shown instead. As
// defense in depth the container still re-validates that `frameSrc` is same-origin before rendering
// the iframe, so a misconfigured caller can never point the frame at a cross-origin document.

import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../octoweb/index.ts'
import {
  serveBootstrap,
  currentOrigin,
  type PptBootstrap,
  type PptBootstrapMode,
} from './bootstrapTransfer.ts'
import './BentoContainer.css'

export interface BentoContainerProps {
  /** The bootstrap payload served to the frame when it requests it (origin-checked handshake). */
  bootstrap: PptBootstrap
  /**
   * Same-origin URL of the Bento host document to load into the iframe. Validated same-origin here;
   * a cross-origin / malformed value renders the error state instead of the frame.
   */
  frameSrc: string
  /** Accessible frame title (deck title when known). */
  title: string
  className?: string
}

/** Whether `url` resolves to the current document's own origin (defense-in-depth frame-src gate). */
function isSameOriginUrl(url: string): boolean {
  const origin = currentOrigin()
  if (origin.length === 0) return false
  try {
    return new URL(url, origin).origin === origin
  } catch {
    return false
  }
}

/**
 * Per-mode iframe sandbox. Bento needs `allow-scripts` to run and `allow-same-origin` to reach the
 * same-origin bootstrap channel; `present` additionally needs `allow-fullscreen` for the fullscreen
 * present affordance. The editor additionally allows same-origin form/clipboard interactions Bento
 * uses for text editing. No `allow-top-navigation` — the deck can never navigate the host away.
 */
function sandboxForMode(mode: PptBootstrapMode): string {
  const base = 'allow-scripts allow-same-origin'
  if (mode === 'present') return `${base} allow-fullscreen`
  return base
}

/**
 * Mount a same-origin Bento frame and answer its origin-checked bootstrap request with `bootstrap`.
 *
 * The `serveBootstrap` listener is attached for this container's lifetime and only ever replies to a
 * SAME-ORIGIN request whose docId matches this deck — a cross-origin message is dropped without a
 * reply (see bootstrapTransfer.ts). The bootstrap is also pushed proactively once the frame's
 * `onLoad` fires, covering a frame that renders before it wires its own request listener.
 */
export function BentoContainer({
  bootstrap,
  frameSrc,
  title,
  className,
}: BentoContainerProps): React.ReactElement {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [rejectedCount, setRejectedCount] = useState(0)
  const sameOrigin = useMemo(() => isSameOriginUrl(frameSrc), [frameSrc])

  useEffect(() => {
    if (!sameOrigin) return
    const dispose = serveBootstrap({
      provide: (request) => (request.docId === bootstrap.docId ? bootstrap : null),
      // Surface cross-origin/malformed attempts for observability; the count is diagnostic only.
      onReject: () => setRejectedCount((n) => n + 1),
    })
    return dispose
  }, [bootstrap, sameOrigin])

  if (!sameOrigin) {
    return (
      <div className="octo-ppt-frame-state octo-ppt-frame-state--error" role="alert">
        {t('docs.ppt.frameOriginError')}
      </div>
    )
  }

  return (
    <iframe
      ref={iframeRef}
      className={className ?? 'octo-ppt-frame'}
      // Same-origin, first-party Bento host. Scripts + same-origin are required for the engine and
      // the bootstrap channel; present adds fullscreen. See sandboxForMode.
      sandbox={sandboxForMode(bootstrap.mode)}
      allow="fullscreen"
      title={title}
      src={frameSrc}
      // Diagnostic attribute only (never read by the frame) so a test / debugger can see whether any
      // cross-origin handshake was rejected during this mount.
      data-ppt-rejected={rejectedCount}
    />
  )
}
