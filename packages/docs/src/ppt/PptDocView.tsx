// Read-only preview for a `docType==='html_ppt'` (Bento slide-deck) document.
//
// R1 (XIN-1501) shipped this as the routing shell only — a static "coming soon" placeholder — so a
// PPT row / deep-link / right-pane had a concrete surface to land on instead of silently defaulting
// to the rich-text editor. R3-F1 (XIN-1583) turns it into the real routeRight read-only PREVIEW: a
// same-origin Bento container that loads the deck's PUBLISHED source through the origin-checked
// bootstrap handshake — read-only, so `canEdit` is always false here.
//
// WHY A DEDICATED COMPONENT (no-fallback contract): an `html_ppt` row must NEVER fall through to the
// Tiptap `EditorShell` — a Bento deck has no Yjs/ProseMirror payload and no Hocuspocus collab room,
// so the rich-text editor would report "not found" and, worse, could mint a Hocuspocus token against
// a PPT documentName (which the backend rejects with 422). This is the explicit peer branch that
// keeps PPT off both the editor and the collab-token path.
//
// EXPOSURE GATE (R3-B1): the preview consumes LIVE backend source, so it is gated behind
// PPT_SOURCE_ENABLED. Until the backend R3-B1 source/bootstrap layer merges, the flag defaults OFF
// and this component renders the R1 placeholder exactly as before (fetching nothing, opening no
// frame, requesting no token) — no regression to the shipped R1/R2 behaviour. When a deployment
// whose backend carries R3-B1 flips the flag on, the same component mounts the Bento preview.

import { t } from '../octoweb/index.ts'
import { PPT_SOURCE_ENABLED } from '../config.ts'
import { BentoContainer } from './BentoContainer.tsx'
import { buildPptBootstrap } from './pptSource.ts'
import './PptDocView.css'

export interface PptDocViewProps {
  /** Doc id of the slide deck. */
  docId: string
  /** Owning space — carried for parity with HtmlDocView / SheetView and future source scoping. */
  space?: string
  /** octo-doc slug when it differs from docId; unused today. */
  slug?: string
  /** Deck title, when the caller resolved one. */
  title?: string
}

/** The R1 "coming soon" placeholder — the gated state shown until PPT_SOURCE_ENABLED (R3-B1) is on. */
function PptPreviewPlaceholder({ title }: { title?: string }): React.ReactElement {
  return (
    <div className="octo-ppt-view-state">
      <p className="octo-ppt-view-kind">{t('docs.ppt.viewTitle')}</p>
      {title && title.trim() && <p className="octo-ppt-view-title">{title.trim()}</p>}
      <p className="octo-ppt-view-hint">{t('docs.ppt.previewComingSoon')}</p>
    </div>
  )
}

/**
 * Read-only PPT preview. Renders the gated placeholder when source is off (default, pending R3-B1)
 * and the same-origin Bento preview container when it is on. Either way it opens no collab socket
 * and mints no Hocuspocus token.
 */
export function PptDocView({ docId, space, title }: PptDocViewProps): React.ReactElement {
  return (
    <div className="octo-doc octo-ppt-view octo-theme" role="region" aria-label={t('docs.ppt.viewTitle')}>
      {PPT_SOURCE_ENABLED ? (
        <BentoContainer
          bootstrap={buildPptBootstrap({ docId, mode: 'preview', version: 'latest', canEdit: false })}
          space={space}
          title={title?.trim() || t('docs.ppt.viewTitle')}
        />
      ) : (
        <PptPreviewPlaceholder title={title} />
      )}
    </div>
  )
}
