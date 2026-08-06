// Source-URL builder for the html_ppt peer surfaces (R3-F1, XIN-1495 / XIN-1583).
//
// This assembles the backend source-endpoint URL the Bento container fetches. It is invoked ONLY
// when PPT_SOURCE_ENABLED is on — i.e. on a deployment whose backend carries the R3-B1
// source/bootstrap layer (octo-docs-backend #161).
//
// CONTRACT — the R3 LIVE path is `format=html` ONLY. Against octo-docs-backend #161 (PR open,
// mergedAt null; the PPT_SOURCE_ENABLED gate stays OFF until a deployment carries it, see config.ts)
// the endpoint shape is:
//   GET /api/v1/ppt/docs/:docId/source?mode=<published|live|draft>&version=<latest|N>&format=<bootstrap|bento|html>
// but R3 exercises only `format=html` (self-contained rendered HTML — see pptSourceClient.ts). The
// `format=bootstrap` + signed short-lived asset half is a DORMANT FORWARD CONTRACT: it is NOT
// delivered by R3, no live R3 code path requests it, and the backend PR documents it as forward
// scaffolding for a future separate-origin host page rather than a live origin-checked delivery
// channel. It stays in the vocabulary (below) so the deferred channel has a name, not because it is
// wired. The endpoint is addressed BARE-RELATIVE on the shared apiClient (baseURL `/api/v1/`), so it
// resolves to `/api/v1/ppt/docs/:docId/source` and inherits the app's auth / `X-Space-Id` / language
// interceptors — the same seam every other docs REST call uses. The backend PPT router mounts only
// `/docs` and `/docs/:docId/source`; there is NO `/ppt/frame/:id` host page, so the container fetches
// the rendered source through this endpoint (via the shared apiClient) and hosts it in a sandboxed
// opaque-origin `srcdoc` frame rather than navigating an iframe at a bespoke host route. See
// BentoContainer.tsx for the mount.
//
// The backend is the authority on what source a role may load — it enforces published-only access
// for reader/commenter contexts. The frontend never bypasses that: it resolves the FE surface mode
// to the backend `mode` vocabulary below and passes it through (and, per XIN-1615 P1-3, never asks
// for `live` on behalf of a non-writer — see PptSurfacePage).

import type { PptBootstrapMode } from './bootstrapTransfer.ts'

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
 * - `bento` / `html` — the rendered single-file Bento source the surface mounts (the live path uses
 *   `html`).
 * - `bootstrap` — the container handshake payload. The live opaque-origin container does NOT use
 *   this (see BentoContainer.tsx / bootstrapTransfer.ts: the postMessage handshake is deferred
 *   scaffolding for a future separate-origin host page), so the FE never requests `format=bootstrap`
 *   today; it stays in the vocabulary for that deferred channel.
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
 * (defaults to `html`, the rendered single-file source the live container mounts; the backend also
 * accepts `bento`/`bootstrap`).
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
  const { docId, mode, version, format = 'html' } = params
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
