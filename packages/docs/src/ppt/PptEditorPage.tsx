// Peer PPT editor route page (`/ppt/d/:docId`). R3-F1, XIN-1495 / XIN-1583.
//
// A backend `editorUrl` from the R2 create flow resolves to this same-origin path; the host Layout
// intercepts the `/ppt/d` namespace (like `/d/:docId`) and mounts this page OUTSIDE the app shell.
// It is a thin wrapper over the shared PptSurfacePage in `editor` mode — deliberately NOT the Tiptap
// EditorShell, and it requests no Hocuspocus token. Live source is gated behind PPT_SOURCE_ENABLED
// (default OFF pending backend R3-B1); until then this renders the gated "not yet available" shell.

import { type ReactElement } from 'react'
import { PptSurfacePage } from './PptSurfacePage.tsx'

export function PptEditorPage({
  docId,
  onSessionExpired,
}: {
  docId: string | null
  onSessionExpired?: () => void
}): ReactElement {
  return <PptSurfacePage docId={docId} mode="editor" onSessionExpired={onSessionExpired} />
}
