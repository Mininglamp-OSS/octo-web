// Deployment-level constants (frontend-design §9.1 `@octo/docs-contract`, §11.2).
//
// docs REST endpoints are addressed BARE-RELATIVE on WKApp.apiClient and inherit its
// `/api/v1/` baseURL, resolving to `/api/v1/docs/...`. There is intentionally NO
// separate axios instance / DOCS_API_BASE — the contract finalized on bare-relative
// (frontend-design §11.2(3), boss decision 2026-06-13).

/** collab-token issuing endpoint (bare-relative -> POST /api/v1/docs/collab-token). */
export const COLLAB_TOKEN_PATH = '/docs/collab-token'

/**
 * Read a build-time env var, treating empty/whitespace-only values as "unset".
 * Vite bakes `ENV FOO=${ARG}` as an EMPTY STRING when the build-arg is not passed
 * (not `undefined`), so `?? default` would wrongly keep the empty string. Normalize
 * blank values to the fallback so a missing build-arg falls back to the default.
 */
function envOr(value: unknown, fallback: string): string {
  const s = typeof value === 'string' ? value.trim() : ''
  return s.length > 0 ? s : fallback
}

/** Hocuspocus WebSocket endpoint (provided by backend, env-specific). */
export const WS_ENDPOINT = envOr(
  import.meta.env?.VITE_COLLAB_WS_ENDPOINT,
  'wss://collab.octo.example.com',
)

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
export const DEFAULT_DOC_SPACE = envOr(import.meta.env?.VITE_DOCS_DEFAULT_SPACE, 'demo')
export const DEFAULT_DOC_FOLDER = envOr(import.meta.env?.VITE_DOCS_DEFAULT_FOLDER, 'f_default')
// DEFAULT_DOC_ID legitimately defaults to empty (no configured default doc).
export const DEFAULT_DOC_ID =
  (import.meta.env?.VITE_DOCS_DEFAULT_DOC as string | undefined)?.trim() || ''

/**
 * Octo object-storage host whitelist for image/attachment URLs (frontend-design §3.7).
 * Any host not in this set is rejected to prevent arbitrary external hotlinking.
 *
 * The presign service signs upload/render URLs whose host is environment-specific
 * (e.g. the real object-store / minio host the browser can reach). That host MUST be
 * whitelisted or sanitize.ts rejects the rendered image even when the backend signs a
 * valid URL. Configure additional hosts at build time via `VITE_DOCS_ASSET_HOSTS`
 * (comma/space-separated host list, e.g. "localhost:9000,minio.internal"). The example
 * defaults below are kept only as harmless placeholders for non-configured builds.
 */
function parseHostList(value: unknown): string[] {
  return typeof value === 'string'
    ? value
        .split(/[\s,]+/)
        .map((h) => h.trim())
        .filter((h) => h.length > 0)
    : []
}

export const ASSET_HOST_WHITELIST = new Set<string>([
  'assets.octo.example.com',
  'cdn.octo.example.com',
  ...parseHostList(import.meta.env?.VITE_DOCS_ASSET_HOSTS),
])
