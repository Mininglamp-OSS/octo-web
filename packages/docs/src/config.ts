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

/**
 * Resolve the Hocuspocus WebSocket endpoint.
 *
 * The WS origin is delivered at runtime via the collab-token response (`collabWsUrl`, backend
 * XIN-211) and is now the ONLY source — the legacy build-time env fallback
 * (`VITE_COLLAB_WS_ENDPOINT`) has been removed. When the backend omits `collabWsUrl` (or sends a
 * blank/whitespace value) we throw so the caller fails loudly instead of silently connecting to a
 * placeholder origin. A missing WS URL is a backend misconfiguration and must be surfaced, not
 * masked.
 */
export function resolveCollabWsUrl(collabWsUrl?: string): string {
  const url = typeof collabWsUrl === 'string' ? collabWsUrl.trim() : ''
  if (url.length === 0) {
    throw new Error(
      'collab-token response is missing `collabWsUrl`: the backend did not deliver a collab ' +
        'WebSocket origin. There is no build-time fallback; the backend must emit an absolute ' +
        'WS URL. Check the docs collab-token endpoint configuration.',
    )
  }
  return url
}

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
 *
 * When the build-arg is NOT passed we fall back to DEFAULT_ASSET_HOSTS so a rebuild that
 * forgets the build-arg does not silently drop the production COS host and break image
 * rendering. An explicit VITE_DOCS_ASSET_HOSTS still wins (the passed value is used as-is),
 * so the override capability is preserved.
 */
const DEFAULT_ASSET_HOSTS = 'cdn.deepminer.com.cn'
function parseHostList(value: unknown): string[] {
  return typeof value === 'string'
    ? value
        .split(/[\s,]+/)
        .map((h) => h.trim())
        .filter((h) => h.length > 0)
    : []
}

/**
 * The host the page itself is served from (e.g. `192.168.214.189:3000`). Same-origin assets
 * are trusted by default so a deployment that serves images from its own origin (or via a
 * same-origin reverse proxy) renders them without needing an explicit VITE_DOCS_ASSET_HOSTS.
 * This is a safe addition: it only ever whitelists the page's OWN origin, never an arbitrary
 * external host. A separate object-store host (e.g. MinIO on :9000, distinct from the page
 * :3000) is NOT covered by this and still requires VITE_DOCS_ASSET_HOSTS. Empty under SSR/tests.
 */
function sameOriginHost(): string[] {
  return typeof window !== 'undefined' && window.location?.host ? [window.location.host] : []
}

export const ASSET_HOST_WHITELIST = new Set<string>([
  ...sameOriginHost(),
  'assets.octo.example.com',
  'cdn.octo.example.com',
  ...parseHostList(envOr(import.meta.env?.VITE_DOCS_ASSET_HOSTS, DEFAULT_ASSET_HOSTS)),
])
