export type OidcCallbackPath = '/login' | '/oidc/bind'

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
