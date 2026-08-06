// Source-URL and bootstrap builders for the html_ppt peer surfaces (R3-F1, XIN-1495 / XIN-1583).
//
// These assemble the backend source-endpoint URL and the `PptBootstrap` payload handed to the Bento
// container over the origin-checked handshake. They are invoked ONLY when PPT_SOURCE_ENABLED is on —
// i.e. on a deployment whose backend carries the R3-B1 source/bootstrap layer (octo-docs-backend
// #161, deployed).
//
// CONTRACT (finalized against octo-docs-backend #161, deployed and verified):
//   GET /api/v1/ppt/docs/:docId/source?mode=<published|live|draft>&version=<latest|N>&format=<bootstrap|bento|html>
// The endpoint is addressed BARE-RELATIVE on the shared apiClient (baseURL `/api/v1/`), so it
// resolves to `/api/v1/ppt/docs/:docId/source` and inherits the app's auth / `X-Space-Id` / language
// interceptors — the same seam every other docs REST call uses. The backend PPT router mounts only
// `/docs` and `/docs/:docId/source`; there is NO `/ppt/frame/:id` host page, so the container fetches
// the rendered source through this endpoint (via the shared apiClient) and mounts it same-origin
// rather than navigating an iframe at a bespoke host route. See BentoContainer.tsx for the mount.
//
// The backend is the authority on what source a role may load — it enforces published-only access
// for reader/commenter contexts. The frontend never bypasses that: it only resolves the FE surface
// mode to the backend `mode` vocabulary below and passes it through.

import type { PptBootstrap, PptBootstrapMode } from './bootstrapTransfer.ts'

/**
 * Bare-relative base for the PPT source endpoint on the shared apiClient (baseURL `/api/v1/`), so it
 * resolves to `/api/v1/ppt/docs`. Kept as a constant so the URL builder and the fetch client (and
 * their tests) address the exact same path.
 */
export const PPT_SOURCE_BASE = '/ppt/docs'

/** Backend `mode` vocabulary for the source endpoint (octo-docs-backend #161). */
export type PptBackendMode = 'published' | 'live' | 'draft'

/**
 * Backend `format` vocabulary for the source endpoint (octo-docs-backend #161):
 * - `bootstrap` — the container handshake payload (default on the backend).
 * - `bento` / `html` — the rendered single-file Bento source the surface mounts.
 */
export type PptSourceFormat = 'bootstrap' | 'bento' | 'html'

/**
 * Map an FE surface mode to the backend `mode` vocabulary.
 *
 * Rationale (reconciled with the R3 design):
 * - `preview`  → `published` — the read-only routeRight preview is a reader/commenter surface, so it
 *   loads the published source. The backend enforces published-only for that role regardless; this
 *   simply asks for the right one.
 * - `present`  → `published` — the present route is always read-only and shows a published version
 *   (the `?version=` query selects which), never a draft.
 * - `editor`   → `live` — the writer/admin editor loads the current editable working copy (`live`).
 *   R3 exposes a single editable source; `draft` is reserved for the R5 publish/version flow (out of
 *   scope here), so the editor maps to `live` rather than `draft`. The backend still gates whether
 *   the caller's role may load it.
 */
export function backendModeFor(mode: PptBootstrapMode): PptBackendMode {
  switch (mode) {
    case 'editor':
      return 'live'
    case 'preview':
    case 'present':
      return 'published'
    default: {
      // Exhaustiveness guard: this function decides published-vs-live, so a NEW PptBootstrapMode
      // must be mapped deliberately rather than silently defaulting to 'published'. A future member
      // makes `mode` non-`never` here and fails typecheck until it is handled above.
      const exhaustive: never = mode
      return exhaustive
    }
  }
}

/**
 * Build the bare-relative source URL for a deck, addressed on the shared apiClient (`/api/v1/`
 * baseURL → `/api/v1/ppt/docs/:id/source`). Emits the finalized `mode`/`version`/`format` params:
 * `mode` is the backend vocabulary resolved from the FE surface mode, `format` is sent explicitly
 * (defaults to `bootstrap`, the container handshake payload; pass `bento`/`html` for rendered
 * source).
 *
 * `version` is PUBLISHED-ONLY: octo-docs-backend #161 rejects an explicit `version` unless
 * `mode==='published'` (`parseVersion()` throws VALIDATION_ERROR/400 otherwise — the R3-B1
 * "version is published-only" rule). So it is serialized only for the published modes
 * (FE `preview`/`present`); for `editor`→`live` (and any `draft`) it is omitted entirely, which
 * is why an enabled editor source fetch no longer 400s.
 */
export function buildSourceUrl(params: {
  docId: string
  mode: PptBootstrapMode
  version: 'latest' | number
  format?: PptSourceFormat
}): string {
  const { docId, mode, version, format = 'bootstrap' } = params
  const id = encodeURIComponent(docId)
  const backendMode = backendModeFor(mode)
  const q = new URLSearchParams({
    mode: backendMode,
    format,
  })
  // Only published sources accept a `version`; live/draft must not send it (backend #161).
  if (backendMode === 'published') {
    q.set('version', version === 'latest' ? 'latest' : String(version))
  }
  return `${PPT_SOURCE_BASE}/${id}/source?${q.toString()}`
}

/**
 * Assemble the bootstrap payload served to the same-origin Bento frame over the origin-checked
 * handshake. `canEdit` distinguishes a writer/admin editor context from a reader/commenter read-only
 * one; the backend is the authority on what source that role may load (published vs live/draft), the
 * frontend only passes the resolved context. `sourceUrl` is the real backend rendered-source URL
 * (`format=bento`) so the frame can (re-)fetch the deck source through the shared apiClient.
 */
export function buildPptBootstrap(params: {
  docId: string
  mode: PptBootstrapMode
  version: 'latest' | number
  canEdit?: boolean
}): PptBootstrap {
  const { docId, mode, version, canEdit } = params
  return {
    mode,
    docId,
    version,
    sourceUrl: buildSourceUrl({ docId, mode, version, format: 'bento' }),
    canEdit: canEdit ?? false,
  }
}
