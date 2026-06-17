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

/**
 * Octo object-storage host whitelist for image/attachment URLs (frontend-design §3.7).
 * Any host not in this set is rejected to prevent arbitrary external hotlinking.
 */
export const ASSET_HOST_WHITELIST = new Set<string>([
  'assets.octo.example.com',
  'cdn.octo.example.com',
])
