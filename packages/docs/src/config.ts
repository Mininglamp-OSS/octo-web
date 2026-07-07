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
 * Resolve the Hocuspocus WebSocket endpoint for the doc editor.
 *
 * The WS origin is delivered at runtime via the collab-token response (`collabWsUrl`, backend
 * XIN-211) and is now the ONLY source for the doc editor — the legacy build-time env fallback
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

/**
 * Hocuspocus WebSocket endpoint for the whiteboard board session.
 *
 * The whiteboard session (`board/collab/useWhiteboardSession.ts`) is built synchronously and does
 * not await the collab-token exchange before constructing its provider, so it resolves its WS
 * origin here rather than from the token response the way the doc editor does via
 * resolveCollabWsUrl above. Both target the SAME backend WS router — the unified router resolves
 * doc names and 5-segment `:wb:` board names on one server (see the token contract note in
 * `useWhiteboardSession.ts`). There is no separate "board collab" service.
 *
 * Resolution order:
 *  1. `VITE_COLLAB_WS_ENDPOINT` (build-arg) — explicit per-environment override, used verbatim.
 *  2. Runtime origin-derived default — when the build-arg is not injected, derive the endpoint
 *     from the page's own host so the deployed bundle reaches the collab server co-located with
 *     it (`ws(s)://<page-host>:<port>`) instead of an unreachable placeholder. The collab port
 *     defaults to the Hocuspocus default 1234 and can be overridden with `VITE_COLLAB_WS_PORT`.
 *     This mirrors the same-origin asset-host trust below and the `window.location.origin`
 *     invite-link derivation — preferring a runtime-derived host over a hardcoded IP keeps the
 *     bundle multi-environment without a rebuild.
 *  3. SSR / unit-test fallback (no `window`) — localhost, never a public placeholder host.
 *
 * The previous default `wss://collab.octo.example.com` was an unreachable placeholder: any
 * deployment built without `VITE_COLLAB_WS_ENDPOINT` silently fell back to it, so every collab
 * socket failed with `net::ERR_CONNECTION_CLOSED` and real-time sync (doc + board) never worked.
 */
const DEFAULT_COLLAB_WS_PORT = '1234'

function originDerivedWsEndpoint(): string {
  if (typeof window === 'undefined' || !window.location?.hostname) {
    // SSR / unit tests: a harmless local default (never a public placeholder host).
    return `ws://localhost:${DEFAULT_COLLAB_WS_PORT}`
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const port = envOr(import.meta.env?.VITE_COLLAB_WS_PORT, DEFAULT_COLLAB_WS_PORT)
  // `window.location.hostname` returns an IPv6 literal WITHOUT brackets (e.g. `::1`). Concatenating
  // it unbracketed produces `ws://::1:1234`, an invalid authority (the browser cannot tell the
  // address colons from the port colon). RFC 3986 §3.2.2 requires an IPv6 literal to be wrapped in
  // brackets inside a URI authority; a bare IPv4/DNS host is left as-is (P2).
  const host = window.location.hostname.includes(':')
    ? `[${window.location.hostname}]`
    : window.location.hostname
  return `${proto}//${host}:${port}`
}

export const WS_ENDPOINT = envOr(import.meta.env?.VITE_COLLAB_WS_ENDPOINT, originDerivedWsEndpoint())

/**
 * Resolve the Hocuspocus WebSocket origin for a board session from the collab-token response.
 *
 * The backend-issued `collabWsUrl` is the authoritative origin (the same field the doc editor
 * treats as its single source of truth, XIN-211). The board primes the collab token before
 * building its provider (see `useWhiteboardSession.ts`) so it can honour that origin instead of
 * guessing `origin:1234` from the page host — otherwise any deployment whose authoritative collab
 * endpoint differs from `origin:1234` connects to the wrong endpoint (P1-4).
 *
 * Unlike the doc editor's `resolveCollabWsUrl` — which THROWS when the backend omits `collabWsUrl`
 * — the board falls back to the origin-derived `WS_ENDPOINT`. The board is built synchronously and
 * must still open a session on a backend that predates the `collabWsUrl` contract (compat window);
 * the origin-derived default keeps it working there. Once the backend always emits `collabWsUrl`
 * this fallback becomes dead and the board can be tightened to throw like the doc editor.
 */
export function resolveBoardWsUrl(collabWsUrl?: string): string {
  const url = typeof collabWsUrl === 'string' ? collabWsUrl.trim() : ''
  return url.length > 0 ? url : WS_ENDPOINT
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
 * sessionStorage key mirroring the doc `/docs` is currently addressing, so a `?doc=` deep-link
 * survives the host's query-wiping. Defined here (not in DocsHome) because it is read from two
 * places that must agree: DocsHome (persist/read/clear the mirror) and the module boot path
 * (captureDocTargetDeepLink), and the boot path must NOT pull the code-split editor chunk.
 */
export const DOC_TARGET_STORAGE_KEY = 'octo.docs.target'

/**
 * Capture a `/docs?doc=<id>` deep-link into sessionStorage (feature #511, XIN-328).
 *
 * A forwarded-doc link is `${origin}/docs?...&doc=<docId>`, but the octo host's self-built
 * RouteManager (dmworkbase Service/Route.tsx) handles `pageshow`/`popstate` by re-pushing
 * `window.location.pathname` ONLY — it drops the query and re-stamps the URL to `/docs?sid=…`,
 * wiping `?doc=` before the docs module mounts. The recipient's mirror is empty (they never
 * opened the doc), so resolveDocTarget fell through to the empty document list — the XIN-328
 * symptom (link opens the list, not the document).
 *
 * PRIMARY capture now lives in the inline `<script>` at the top of `apps/web/index.html`, which
 * runs during HTML parse — before this module bundle is even fetched and long before the host's
 * pageshow re-push. XIN-332 real-device tracing proved DocsModule.init() runs AFTER the re-push
 * on device (the query was already wiped by the time init ran), so we no longer depend on it.
 *
 * This function stays as a same-origin/redundant capture (still invoked from DocsModule.init and
 * from the standalone dev bootstrap in main.tsx). It writes the identical key + JSON shape as the
 * inline script, so running both is idempotent, and it emits the same observability signal
 * (`window.__OCTO_DOCS_DEEPLINK__` + console log) so a real-device trace can tell which path ran.
 * No-op when the URL carries no doc (a plain `/docs` visit).
 */
export function captureDocTargetDeepLink(): void {
  if (typeof window === 'undefined') return
  let doc = ''
  let space = DEFAULT_DOC_SPACE
  let folder = DEFAULT_DOC_FOLDER
  try {
    const q = new URLSearchParams(window.location.search)
    doc = q.get('doc') || q.get('docId') || ''
    space = q.get('space') || space
    folder = q.get('folder') || folder
  } catch {
    // Malformed / non-browser search: nothing to capture.
    return
  }
  if (!doc) return
  try {
    window.sessionStorage.setItem(DOC_TARGET_STORAGE_KEY, JSON.stringify({ space, folder, doc }))
    // Real-device observability point (XIN-332 hard gate). Mirrors the index.html marker shape so
    // Grace can see, from the console, that a capture ran and the mirror holds the target — even
    // when this secondary path (not the inline script) is the one that fired.
    ;(window as unknown as { __OCTO_DOCS_DEEPLINK__?: unknown }).__OCTO_DOCS_DEEPLINK__ = {
      captured: true,
      doc,
      source: 'module.init',
    }
    console.log('[octo.docs.deeplink] module.init capture', { captured: true, doc, space, folder })
  } catch {
    // sessionStorage unavailable (private mode / disabled): the deep-link still opens on first
    // paint if the query happens to survive; we just can't guarantee it against the host's
    // later pathname-only re-push.
  }
}

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
