// Read-only placeholder view for a `docType==='html_ppt'` (Bento slide-deck) document.
//
// R1 SCOPE (XIN-1501): this is the routing shell only. `html_ppt` is a first-class, B-owned
// document type whose editor/preview/present surfaces and `/api/v1/ppt/**` source endpoints land
// in later rings (R2+). Until those endpoints are deployed this component renders a static,
// self-contained "coming soon" placeholder.
//
// WHY A DEDICATED COMPONENT (no-fallback contract): an `html_ppt` row must NEVER fall through to
// the Tiptap `EditorShell` — a Bento deck has no Yjs/ProseMirror payload and no Hocuspocus collab
// room, so the rich-text editor would report "not found" and, worse, could mint a Hocuspocus token
// against a PPT documentName (which the backend rejects with 422, see octo-docs-backend #152). This
// component is the explicit peer branch that keeps PPT off both the editor and the collab-token
// path. It fetches nothing and opens no socket.

import { t } from '../octoweb/index.ts'
import './PptDocView.css'

export interface PptDocViewProps {
  /** Doc id of the slide deck (used only for the stable React key at the call site today). */
  docId: string
  /** Owning space — carried for parity with HtmlDocView / SheetView and future source scoping. */
  space?: string
  /** octo-doc slug when it differs from docId; unused in the R1 placeholder. */
  slug?: string
  /** Deck title, when the caller resolved one. */
  title?: string
}

/**
 * R1 read-only placeholder. Intentionally free of any editing chrome, collab wiring, or network
 * calls — it exists so the docs list / deep-link / right-pane routing has a concrete PPT surface to
 * land on instead of silently defaulting to the rich-text editor.
 */
export function PptDocView({ title }: PptDocViewProps): React.ReactElement {
  return (
    <div className="octo-doc octo-ppt-view octo-theme" role="region" aria-label={t('docs.ppt.viewTitle')}>
      <div className="octo-ppt-view-state">
        <p className="octo-ppt-view-kind">{t('docs.ppt.viewTitle')}</p>
        {title && title.trim() && <p className="octo-ppt-view-title">{title.trim()}</p>}
        <p className="octo-ppt-view-hint">{t('docs.ppt.previewComingSoon')}</p>
      </div>
    </div>
  )
}
