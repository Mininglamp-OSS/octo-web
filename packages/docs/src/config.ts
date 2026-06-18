// Deployment-level constants (frontend-design §9.1 `@octo/docs-contract`, §11.2).
//
// docs REST endpoints are addressed BARE-RELATIVE on WKApp.apiClient and inherit its
// `/api/v1/` baseURL, resolving to `/api/v1/docs/...`. There is intentionally NO
// separate axios instance / DOCS_API_BASE — the contract finalized on bare-relative
// (frontend-design §11.2(3), boss decision 2026-06-13).

/** collab-token issuing endpoint (bare-relative -> POST /api/v1/docs/collab-token). */
export const COLLAB_TOKEN_PATH = '/docs/collab-token'

/** Hocuspocus WebSocket endpoint (provided by backend, env-specific). */
export const WS_ENDPOINT =
  (import.meta.env?.VITE_COLLAB_WS_ENDPOINT as string | undefined) ??
  'wss://collab.octo.example.com'

/** Refresh collab token when it is within this window of expiry. */
export const TOKEN_REFRESH_LEEWAY_MS = 30_000

// ── Default document addressing (frontend-design §7.2) ───────────────────────
//
// The docs-backend currently exposes only per-doc endpoints (`/docs/:docId/...`)
// — there is no list/create endpoint yet — so `/docs` cannot enumerate documents.
// DocsHome therefore opens a SPECIFIC document: it reads `space`/`folder`/`doc`
// from the URL query (`/docs?space=…&folder=…&doc=…`) and falls back to these
// deployment-configured defaults. The previous hardcoded `d_welcome` pointed at a
// document that does not exist in any DB, so the editor sat forever on
// “Loading document…” (collab-token → not_found, comments → 404) and never mounted.
// Configure these to a real, accessible doc for the target environment.
export const DEFAULT_DOC_SPACE =
  (import.meta.env?.VITE_DOCS_DEFAULT_SPACE as string | undefined) ?? 'demo'
export const DEFAULT_DOC_FOLDER =
  (import.meta.env?.VITE_DOCS_DEFAULT_FOLDER as string | undefined) ?? 'f_default'
export const DEFAULT_DOC_ID =
  (import.meta.env?.VITE_DOCS_DEFAULT_DOC as string | undefined) ?? ''

/**
 * Octo object-storage host whitelist for image/attachment URLs (frontend-design §3.7).
 * Any host not in this set is rejected to prevent arbitrary external hotlinking.
 */
export const ASSET_HOST_WHITELIST = new Set<string>([
  'assets.octo.example.com',
  'cdn.octo.example.com',
])
