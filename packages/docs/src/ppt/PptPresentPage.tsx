// Present route page (`/docs/:docId/present?version=latest|N`). R3-F1, XIN-1495 / XIN-1583.
//
// A top-level, full-window present surface the host Layout intercepts (only the exact
// `/docs/:docId/present` shape — every other `/docs...` path stays with the app shell). Read-only:
// present always loads the PUBLISHED version the `?version=` query selects (default latest), never a
// draft, and mounts the Bento container in `present` mode with fullscreen allowed. Live source is
// gated behind PPT_SOURCE_ENABLED (default OFF pending backend R3-B1); until then this renders the
// gated "not yet available" shell.

import { type ReactElement } from 'react'
import { PptSurfacePage } from './PptSurfacePage.tsx'

export function PptPresentPage({
  docId,
  version,
  onSessionExpired,
}: {
  docId: string | null
  version: 'latest' | number
  onSessionExpired?: () => void
}): ReactElement {
  return (
    <PptSurfacePage docId={docId} mode="present" version={version} onSessionExpired={onSessionExpired} />
  )
}
