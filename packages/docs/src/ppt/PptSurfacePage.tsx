// Full-window html_ppt peer surface — the shared engine behind the editor route (`/ppt/d/:docId`)
// and the present route (`/docs/:docId/present`). R3-F1, XIN-1495 / XIN-1583.
//
// Both routes mount OUTSIDE the app shell (like the standalone `/d/:docId` page) and both must honor
// the no-fallthrough contract: a Bento deck never reaches the Tiptap `EditorShell` and never mints a
// Hocuspocus token. This component is that peer host.
//
// EXPOSURE GATE (R3-B1): the surface consumes LIVE backend source, so it is gated behind
// PPT_SOURCE_ENABLED. While the flag is OFF (default, until the backend R3-B1 source/bootstrap layer
// merges) it renders a "not yet available" shell and performs NO network I/O — no preflight, no
// source fetch, no token. The route still resolves here (so a deep link lands on the PPT shell, never
// the rich-text editor), it simply shows the gated state. When a deployment whose backend carries
// R3-B1 flips the flag on, the SAME component runs the reader preflight and mounts the Bento
// container.

import { useEffect, useState, type ReactElement } from 'react'
import { getWKApp, t } from '../octoweb/index.ts'
import { PPT_SOURCE_ENABLED } from '../config.ts'
import { canEdit as roleCanEdit } from '../auth/roles.ts'
import { getDoc, HTML_PPT_DOC_TYPE, type DocMeta } from '../pages/docsApi.ts'
import { DocTerminal, type TerminalKind } from '../editor/DocTerminal.tsx'
import { terminalForCreateError } from '../collab/useCollabEditor.ts'
import { BentoContainer } from './BentoContainer.tsx'
import { buildPptBootstrap } from './pptSource.ts'
import type { PptBootstrapMode } from './bootstrapTransfer.ts'
import './PptSurface.css'

type Phase =
  | { status: 'loading' }
  | { status: 'ready'; meta: DocMeta }
  | { status: 'terminal'; kind: TerminalKind }

export interface PptSurfacePageProps {
  /** Deck id, or null when the route claimed a malformed/empty id (→ not-found shell). */
  docId: string | null
  /** `'editor'` for `/ppt/d/:docId`, `'present'` for `/docs/:docId/present`. */
  mode: Extract<PptBootstrapMode, 'editor' | 'present'>
  /** Present-route version; ignored for the editor (which always edits latest). */
  version?: 'latest' | number
  /** Called on a 401 with a token loaded (expired session) — host clears + reloads into login. */
  onSessionExpired?: () => void
}

/** Centered state card (loading / gated / terminal), inside the full-window surface chrome. */
function SurfaceState({
  mode,
  children,
}: {
  mode: PptSurfacePageProps['mode']
  children: ReactElement | ReactElement[]
}): ReactElement {
  return (
    <div
      className={`octo-ppt-surface octo-theme${mode === 'present' ? ' octo-ppt-surface--present' : ''}`}
      role="region"
      aria-label={t('docs.ppt.viewTitle')}
    >
      <div className="octo-ppt-surface-body">
        <div className="octo-ppt-surface-state">{children}</div>
      </div>
    </div>
  )
}

/**
 * Resolve the owning space for a PPT deep-link's by-space reads (getDoc preflight + source fetch).
 *
 * The PPT surfaces mount via the host Layout's EARLY RETURN, before the app-shell logic that
 * restores `currentSpaceId` from localStorage runs — so on a cross-space cold deep-link the live
 * `WKApp.shared.currentSpaceId` is still empty. Mirror the standalone branches: prefer the live
 * value, else the cached `currentSpaceId` localStorage key the shell persists. Returns '' when there
 * is no signal at all, in which case the caller omits the explicit header and lets the global request
 * interceptor decide (exactly as an in-shell entry does) rather than forcing a wrong space.
 */
export function resolveDeckSpace(): string {
  const live = getWKApp().shared?.currentSpaceId
  if (live) return live
  if (typeof window !== 'undefined') {
    try {
      const cached = window.localStorage.getItem('currentSpaceId')
      if (cached) return cached
    } catch {
      // localStorage unavailable (private mode / disabled): no signal → '' (omit the header).
    }
  }
  return ''
}

export function PptSurfacePage({ docId, mode, version, onSessionExpired }: PptSurfacePageProps): ReactElement {
  const gated = !PPT_SOURCE_ENABLED
  // Resolve the owning space for the cross-space cold deep-link. Both PPT routes mount via the
  // Layout EARLY RETURN — before the app shell restores currentSpaceId — so the live value is often
  // empty on a fresh tab. Mirror the standalone branches (Layout ~L421 / StandaloneDocPage) by
  // falling back to the cached `currentSpaceId` localStorage key the shell persists, so the by-space
  // reads below are scoped instead of unscoped (XIN-1608 P1). '' → omit the header and let the global
  // interceptor decide, exactly as an in-shell entry would.
  const space = resolveDeckSpace()
  const [phase, setPhase] = useState<Phase>({ status: 'loading' })

  useEffect(() => {
    // Gated (default) or malformed id: no preflight, no network. Render the shell directly.
    if (gated) return
    let cancelled = false
    if (!docId) {
      setPhase({ status: 'terminal', kind: 'not-found' })
      return
    }
    setPhase({ status: 'loading' })
    getDoc(docId, space ? { spaceId: space } : undefined)
      .then((meta) => {
        if (!cancelled) setPhase({ status: 'ready', meta })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const kind = terminalForCreateError(err)
        if (kind === 'login' && onSessionExpired) {
          onSessionExpired()
          return
        }
        setPhase({ status: 'terminal', kind })
      })
    return () => {
      cancelled = true
    }
  }, [gated, docId, space, onSessionExpired])

  // Gated shell — the only state that ships until R3-B1 merges.
  if (gated) {
    return (
      <SurfaceState mode={mode}>
        <p className="octo-ppt-surface-state-kind">{t('docs.ppt.viewTitle')}</p>
        <p className="octo-ppt-surface-state-hint">
          {mode === 'present' ? t('docs.ppt.presentComingSoon') : t('docs.ppt.editorComingSoon')}
        </p>
      </SurfaceState>
    )
  }

  // Null id (route claimed a malformed link): not-found shell, never the app shell / rich editor.
  if (!docId) {
    return (
      <SurfaceState mode={mode}>
        <DocTerminal title={t('docs.state.untitled')} kind="not-found" />
      </SurfaceState>
    )
  }

  if (phase.status === 'loading') {
    return (
      <SurfaceState mode={mode}>
        <p className="octo-ppt-surface-state-hint" role="status">
          {t('docs.state.loading')}
        </p>
      </SurfaceState>
    )
  }

  if (phase.status === 'terminal') {
    return (
      <SurfaceState mode={mode}>
        <DocTerminal title={t('docs.state.untitled')} kind={phase.kind} />
      </SurfaceState>
    )
  }

  const meta = phase.meta
  // No-fallthrough guard: only a confirmed Bento deck mounts the container. Any other kind (a link
  // that resolved to a plain doc/sheet/board/html) renders an error rather than silently opening the
  // rich-text editor — the R1 contract the whole PPT branch defends.
  if (meta.docType !== HTML_PPT_DOC_TYPE) {
    return (
      <SurfaceState mode={mode}>
        <DocTerminal title={meta.title || t('docs.state.untitled')} kind="not-found" />
      </SurfaceState>
    )
  }

  const deckId = meta.docId || docId
  const resolvedVersion: 'latest' | number = mode === 'present' ? version ?? 'latest' : 'latest'
  // Editor edits the live/draft the caller's role permits (backend enforces what that role may load);
  // present is always read-only published, so canEdit is false there.
  const canEdit = mode === 'editor' ? Boolean(meta.role && roleCanEdit(meta.role)) : false

  return (
    <div
      className={`octo-ppt-surface octo-theme${mode === 'present' ? ' octo-ppt-surface--present' : ''}`}
      role="region"
      aria-label={meta.title || t('docs.ppt.viewTitle')}
    >
      <div className="octo-ppt-surface-body">
        <BentoContainer
          bootstrap={buildPptBootstrap({ docId: deckId, mode, version: resolvedVersion, canEdit })}
          space={space || undefined}
          title={meta.title || t('docs.ppt.viewTitle')}
        />
      </div>
    </div>
  )
}
