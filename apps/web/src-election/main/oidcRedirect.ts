export type OidcCallbackPath = '/login' | '/oidc/bind'

export type OidcHttpRequest = {
  url: string
  method: 'GET' | 'POST'
  body?: unknown
  token?: string
}

// Note: `__octo_route` is intentionally NOT in this allow-list. It is injected
// by `withTrustedSessionSid` after the IdP callback has been validated, and
// must never be sourced from the IdP-controlled redirect URL — otherwise an
// attacker could steer the renderer to arbitrary code paths that key on it.
const CALLBACK_QUERY_KEYS: Record<OidcCallbackPath, ReadonlySet<string>> = {
  // `error` / `error_description` are OIDC/OAuth2 standard fields; forward them
  // so the login page can surface real backend messages instead of a generic
  // "oidc_error=1" fallback.
  '/login': new Set(['oidc_error', 'error', 'error_description']),
  '/oidc/bind': new Set(['token', 'authcode', 'return_to', 'provider']),
}

/**
 * Validate that `value` is a string containing an absolute http(s) URL, and
 * return its canonical origin. Rejects `file:`, `javascript:`, blob:, data:,
 * relative URLs, and non-string inputs. Used both at IPC boundary (to trust
 * an origin declared by the renderer) and at redirect-interception time.
 */
export function parseHttpOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.origin
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Validate the renderer-to-main OIDC HTTP request without touching Electron.
 * Keeping this pure makes the security boundary testable without importing the
 * main process and accidentally registering real ipcMain handlers.
 */
export function validateOidcHttpRequest(
  request: unknown,
  expectedOrigin: string | undefined,
): { ok: true; value: OidcHttpRequest } | { ok: false; error: string } {
  if (!request || typeof request !== 'object') return { ok: false, error: 'Invalid OIDC request' }
  const input = request as Record<string, unknown>
  if (typeof input.url !== 'string' || (input.method !== 'GET' && input.method !== 'POST')) {
    return { ok: false, error: 'Invalid OIDC request' }
  }
  let parsed: URL
  try { parsed = new URL(input.url) } catch { return { ok: false, error: 'Invalid OIDC URL' } }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Invalid OIDC URL' }
  }
  if (!expectedOrigin || parsed.origin !== expectedOrigin) {
    return { ok: false, error: 'OIDC origin is not allowed' }
  }
  const isLoginEndpoint = parsed.pathname === '/v1/user/thirdlogin/authcode' ||
    parsed.pathname === '/v1/user/thirdlogin/authstatus'
  const isOidcEndpoint = /^\/v1\/auth\/oidc\/[a-z0-9_%.-]+\/(?:bind\/(?:info|verify\/password|verify\/otp\/send|verify\/otp\/check|confirm|create)|logout)$/i.test(parsed.pathname)
  if (!isLoginEndpoint && !isOidcEndpoint) return { ok: false, error: 'OIDC endpoint is not allowed' }
  const method = input.method as 'GET' | 'POST'
  const isBindInfoEndpoint = isOidcEndpoint && parsed.pathname.endsWith('/info')
  if ((isLoginEndpoint || isBindInfoEndpoint) !== (method === 'GET')) {
    return { ok: false, error: 'Invalid OIDC method' }
  }
  const headers = input.headers && typeof input.headers === 'object'
    ? input.headers as Record<string, unknown>
    : undefined
  const token = headers?.token
  if (token !== undefined && typeof token !== 'string') return { ok: false, error: 'Invalid OIDC headers' }
  return { ok: true, value: { url: parsed.toString(), method, body: input.body, token: token as string | undefined } }
}

export function parseOidcCallback(url: string, expectedOrigin: string): {
  path: OidcCallbackPath
  query: Record<string, string>
} | undefined {
  let parsed: URL
  try { parsed = new URL(url) } catch { return undefined }
  // Compare against a normalized expected origin so callers can't accidentally
  // pass e.g. "https://api.example.com/" (trailing slash) and end up matching
  // nothing. `parseHttpOrigin` also rejects non-http(s) schemes.
  const normalizedExpected = parseHttpOrigin(expectedOrigin)
  if (!normalizedExpected) return undefined
  if (parsed.origin !== normalizedExpected) return undefined
  if (parsed.pathname !== '/login' && parsed.pathname !== '/oidc/bind') return undefined
  const query: Record<string, string> = {}
  const allowed = CALLBACK_QUERY_KEYS[parsed.pathname]
  parsed.searchParams.forEach((value, key) => { if (allowed.has(key)) query[key] = value })
  return { path: parsed.pathname, query }
}

/**
 * The first desktop navigation is the API authorize endpoint itself. It must
 * be allowed to continue to the identity provider; only the API callback
 * paths are handled by the redirect interceptor.
 */
export function isOidcAuthorizeNavigation(
  url: string,
  expectedOrigin: string,
  providerId: string,
): boolean {
  let parsed: URL
  const normalizedExpected = parseHttpOrigin(expectedOrigin)
  if (!normalizedExpected || typeof providerId !== 'string' || providerId === '') return false
  try { parsed = new URL(url) } catch { return false }
  return parsed.origin === normalizedExpected &&
    parsed.pathname === `/v1/auth/oidc/${encodeURIComponent(providerId)}/authorize`
}

/**
 * The API callback may return to /login without echoing authcode. In that
 * mode the renderer resumes the pending flow from sessionStorage and polls
 * authstatus, so the callback is still valid as long as it belongs to the
 * flow that this window armed. If the callback does echo authcode, keep the
 * strict equality check.
 */
export function isMatchingOidcCallback(
  callback: { path: OidcCallbackPath; query: Record<string, string> },
  expectedAuthcode: string,
  expectedProviderId: string,
): boolean {
  if (callback.path === '/oidc/bind') {
    // Bind callbacks carry all correlation fields. Unlike /login, accepting
    // an omitted authcode/provider would let any token URL enter the trusted
    // local bind UI while a flow is armed.
    return callback.query.authcode === expectedAuthcode &&
      callback.query.provider === expectedProviderId
  }
  const isErrorCallback = callback.path === '/login' &&
    (callback.query.oidc_error === '1' || callback.query.error !== undefined)
  if (!isErrorCallback && callback.query.authcode !== undefined && callback.query.authcode !== expectedAuthcode) {
    return false
  }
  if (callback.query.provider !== undefined && callback.query.provider !== expectedProviderId) {
    return false
  }
  return true
}

export function withTrustedSessionSid(
  callback: { path: OidcCallbackPath; query: Record<string, string> },
  sid: string,
): Record<string, string> {
  const query: Record<string, string> = { ...callback.query, sid }
  // `__octo_route` lets the renderer's bind module recognize a bind callback
  // even though the URL after `loadFile` points at `build/index.html` rather
  // than `/oidc/bind`. Injected here (not read from the IdP URL) so it is
  // always exactly the value we intend.
  if (callback.path === '/oidc/bind') query.__octo_route = '/oidc/bind'
  return query
}

/**
 * Decide whether an IPC sender frame URL comes from a trusted app-shell
 * origin. Mirrors the preload-side `isTrustedShell` rule so both boundaries
 * agree on what counts as "our renderer":
 *
 *   - packaged build: `file://` (only build/index.html reaches preload)
 *   - dev build:      the exact `--octo-dev-origin=<origin>` the main
 *                     process pushed into `additionalArguments`
 *
 * We deliberately do NOT try to match against a runtime-configured API
 * origin: the API origin is renderer-declared state (WKApp remoteConfig) and
 * can be spoofed by an attacker who already reached the IPC boundary. The
 * shell origin is main-process-controlled and therefore load-bearing.
 *
 * Rejects empty strings, non-http(s)/non-file schemes, and any frame that
 * lives at a different origin than the shell (e.g. a subframe navigated to
 * an IdP page — see `event.senderFrame.top` check at the call site).
 */
export function isTrustedSenderUrl(
  url: string | undefined,
  devOrigin: string | undefined,
  trustedFileUrl?: string,
): boolean {
  if (typeof url !== 'string' || url === '') return false
  let parsed: URL
  try { parsed = new URL(url) } catch { return false }
  // Packaged shell loads build/index.html via loadFile → file://.
  // Electron does not expose a useful origin for file URLs, so compare the
  // canonical URL against the exact packaged index document instead of
  // trusting every local file in the machine.
  if (parsed.protocol === 'file:') {
    if (!trustedFileUrl) return false
    try {
      const trusted = new URL(trustedFileUrl)
      // `loadFile(..., { query })` makes the actual sender URL include the
      // window sid and, during OIDC, callback parameters. Those are expected
      // renderer state rather than a different local document, so compare the
      // canonical file identity and deliberately ignore search/hash.
      return parsed.protocol === trusted.protocol &&
        parsed.hostname === trusted.hostname &&
        parsed.pathname === trusted.pathname
    } catch {
      return false
    }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (!devOrigin) return false
  return parsed.origin === devOrigin
}
