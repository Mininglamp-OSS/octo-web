// Bootstrap builders for the html_ppt peer surfaces (R3-F1, XIN-1495 / XIN-1583).
//
// These assemble the same-origin frame `src` and the `PptBootstrap` payload handed to the Bento
// container over the origin-checked handshake. They are invoked ONLY when PPT_SOURCE_ENABLED is on
// — i.e. on a deployment whose backend carries the R3-B1 source/bootstrap layer.
//
// ⚠️ PROVISIONAL CONTRACT (pending R3-B1 merge): the backend R3-B1 ticket
// (`feature/xin-1495-ppt-r3-source-bootstrap`) is the authority for the exact source URL shape,
// signed asset metadata, and cache semantics of the preview / editor / present payloads. It is NOT
// yet merged to main, so the URL conventions below are the frontend's best-effort placeholders
// derived from the merged R1/R2 `/api/v1/ppt/**` prefix. They are deliberately quarantined behind
// PPT_SOURCE_ENABLED (default OFF) so nothing here ships until R3-B1 lands; when it does, reconcile
// these builders with the finalized contract before flipping the flag on. Do NOT enable the flag
// against a mock/unmerged contract.

import type { PptBootstrap } from './bootstrapTransfer.ts'

/**
 * Same-origin path of the Bento host document loaded into the container iframe. Served by the
 * backend (B, Node) at the page's own origin so the origin-checked handshake and the same-origin
 * source fetch both resolve to `window.location.origin`. Provisional — see the file header.
 */
export const PPT_FRAME_PATH = '/ppt/frame'

/**
 * Bare-relative source endpoint for a deck, addressed on the docs API base (`/api/v1/ppt/...`),
 * mirroring the R2 create path convention. The backend R3-B1 layer enforces published-only access
 * for reader/commenter here; the frontend never bypasses it. Provisional — see the file header.
 */
function sourcePath(docId: string, mode: PptBootstrap['mode'], version: 'latest' | number): string {
  const v = version === 'latest' ? 'latest' : String(version)
  const id = encodeURIComponent(docId)
  return `/ppt/frame/${id}/source?mode=${mode}&version=${encodeURIComponent(v)}`
}

/**
 * Build the frame `src` for a deck's Bento host. Same-origin by construction (a rooted path resolved
 * against the current origin); the container re-validates same-origin as defense in depth.
 */
export function buildFrameSrc(docId: string, mode: PptBootstrap['mode'], version: 'latest' | number): string {
  const id = encodeURIComponent(docId)
  const v = version === 'latest' ? 'latest' : String(version)
  return `${PPT_FRAME_PATH}/${id}?mode=${mode}&version=${encodeURIComponent(v)}`
}

/**
 * Assemble the bootstrap payload served to the frame. `canEdit` distinguishes a writer/admin editor
 * context from a reader/commenter read-only one; the backend is the authority on what source that
 * role may load (draft/live vs published-only), the frontend only passes the resolved context.
 */
export function buildPptBootstrap(params: {
  docId: string
  mode: PptBootstrap['mode']
  version: 'latest' | number
  canEdit?: boolean
}): PptBootstrap {
  const { docId, mode, version, canEdit } = params
  return {
    mode,
    docId,
    version,
    sourceUrl: sourcePath(docId, mode, version),
    canEdit: canEdit ?? false,
  }
}
