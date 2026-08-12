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
  '/login': new Set(['oidc_error', 'error', 'error_description', 'authcode', 'provider']),
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
  const oidcEndpointMatch = parsed.pathname.match(/^\/v1\/auth\/oidc\/((?:[a-zA-Z0-9_.!~*'()-]|%[0-9a-f]{2})+)\/(?:bind\/(?:info|verify\/password|verify\/otp\/send|verify\/otp\/check|confirm|create)|logout)$/i)
  let safeProviderSegment = false
  if (oidcEndpointMatch) {
    try {
      const decodedProviderId = decodeURIComponent(oidcEndpointMatch[1])
      // Provider IDs are one URL path segment. Encoded separators and dot
      // segments must not become valid after decoding.
      safeProviderSegment = decodedProviderId !== '' &&
        decodedProviderId !== '.' &&
        decodedProviderId !== '..' &&
        !/[\\/]/.test(decodedProviderId)
    } catch {
      safeProviderSegment = false
    }
  }
  const isOidcEndpoint = safeProviderSegment && oidcEndpointMatch !== null
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
 *
 * Literal comparison against the exact URL the renderer registered when
 *      it armed the flow. This is the preferred mode — the renderer built
 *      the URL and can hand it back verbatim, so we do not have to guess at
 *      encoding of `state`/`return_to`/`flag` query parameters or worry
 *      about backend-issued paths that differ from our client-side
 *      assumption. Both URLs are canonicalized through the WHATWG URL
 *      parser so a `+` vs `%20` in state does not spuriously fail.
 */
export function isOidcAuthorizeNavigation(
  url: string,
  expectedOrigin: string,
  providerId: string,
  authorizeUrl: string,
): boolean {
  let parsed: URL
  const normalizedExpected = parseHttpOrigin(expectedOrigin)
  if (!normalizedExpected || typeof providerId !== 'string' || providerId === '') return false
  try { parsed = new URL(url) } catch { return false }
  if (parsed.origin !== normalizedExpected) return false
  let expected: URL
  try { expected = new URL(authorizeUrl) } catch { return false }
  if (expected.origin !== normalizedExpected) return false
  // Canonicalize both sides — `URL.toString()` handles percent-encoding
  // normalization identically for both inputs.
  return parsed.toString() === expected.toString()
}

export type OidcNavigationDecision =
  | 'expired'
  | 'authorize'
  | 'same-origin'
  | 'external'
  | 'callback'
  | 'invalid-callback'

/**
 * Classify a top-level navigation while an Electron OIDC flow is armed.
 *
 * The API origin can legitimately appear more than once in a flow: the
 * authorize endpoint may redirect to the IdP and the IdP may then redirect
 * back to an API callback endpoint before the backend sends the browser to
 * `/login` or `/oidc/bind`. Only the final frontend callback belongs to the
 * renderer; intermediate same-origin API navigations must be allowed through.
 */
export function classifyOidcNavigation(input: {
  url: string
  origin: string
  providerId: string
  authorizeUrl: string
  authcode: string
  expiresAt: number
  now?: number
}): OidcNavigationDecision {
  if ((input.now ?? Date.now()) >= input.expiresAt) return 'expired'
  const callback = parseOidcCallback(input.url, input.origin)
  if (callback) {
    return isMatchingOidcCallback(callback, input.authcode, input.providerId)
      ? 'callback'
      : 'invalid-callback'
  }
  if (isOidcAuthorizeNavigation(input.url, input.origin, input.providerId, input.authorizeUrl)) {
    return 'authorize'
  }
  try {
    return new URL(input.url).origin === parseHttpOrigin(input.origin)
      ? 'same-origin'
      : 'external'
  } catch {
    return 'external'
  }
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
      //
      // Windows exposes NTFS pathnames case-insensitively. Electron may
      // hand us a drive letter in either case (see file URLs like
      // `file:///C:/...` vs `file:///c:/...`), so a strict `===` mismatch
      // would spuriously reject the shell. Fold to lowercase for the
      // filesystem-identity check; hostname is already normalized by the
      // WHATWG URL parser.
      return parsed.protocol === trusted.protocol &&
        parsed.hostname === trusted.hostname &&
        parsed.pathname.toLowerCase() === trusted.pathname.toLowerCase()
    } catch {
      return false
    }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (!devOrigin) return false
  return parsed.origin === devOrigin
}

/**
 * Validate a URL passed to `IPC_OIDC_OPEN_EXTERNAL`.
 *
 * This IPC has exactly one caller: `logoutUserInitiated` in App.tsx forwards
 * the backend-issued `end_session_url` returned by our own `/logout` endpoint.
 * A compromised renderer must NOT be able to smuggle arbitrary navigations
 * into the hidden, cookie-bearing logout window, so validation goes beyond
 * scheme checks and enforces both a build-time origin allowlist and the
 * *shape* of an OIDC end-session URL:
 *
 *   - https only (RFC 8252 §8.10 disallows plaintext for the end-session
 *     endpoint; anyone deploying an OIDC IdP over http:// is misconfigured
 *     and we refuse to relay to the OS handler for them either way);
 *   - no userinfo, no fragment (both are common obfuscation vectors);
 *   - path segment ending in `end_session`, `endsession`, `logout`, or
 *     `signout` (case-insensitive) — matches every real OIDC IdP we
 *     integrate with (Keycloak, Auth0, Azure AD, Okta, ForgeRock);
 *   - query params limited to the standard OIDC end-session set (see
 *     https://openid.net/specs/openid-connect-rpinitiated-1_0.html): any
 *     unexpected parameter is treated as smuggling and rejected.
 *
 * Kept as a pure function so the URL-shape allowlist is covered by tests
 * without spinning up Electron. If a new IdP integration needs a different
 * end-session path suffix or query parameter, extend the allowlist here
 * and add a test case — do NOT loosen the scheme, userinfo, or fragment
 * checks.
 */
const OIDC_END_SESSION_PATH_SUFFIXES = [
  'end_session',
  'endsession',
  'end-session',
  'logout',
  'signout',
  'sign-out',
] as const
const OIDC_END_SESSION_QUERY_ALLOWLIST = new Set([
  // RFC 8252 / RP-initiated logout 1.0 standard fields.
  'id_token_hint',
  'logout_hint',
  'client_id',
  'post_logout_redirect_uri',
  'state',
  'ui_locales',
  // Widely deployed vendor extensions we've observed in production. Keep
  // this list conservative: unknown params must fail closed.
  'redirect_uri',
  'returnTo',
  'return_to',
  'return_url',
  'returnUrl',
])
export function validateOpenExternalUrl(
  value: unknown,
  trustedOrigins?: ReadonlySet<string>,
): { ok: true; value: string } | { ok: false } {
  if (typeof value !== 'string' || value === '') return { ok: false }
  let parsed: URL
  try { parsed = new URL(value) } catch { return { ok: false } }
  // https only. See doc comment above for why http:// is refused.
  if (parsed.protocol !== 'https:') return { ok: false }
  // This is a main-process security boundary. Shape checks alone would still
  // allow https://attacker.example/logout to be loaded in the default session
  // with application cookies. The optional argument keeps this pure helper
  // backwards-compatible for non-Electron callers; the IPC handler always
  // supplies the build-time allowlist.
  if (trustedOrigins && !trustedOrigins.has(parsed.origin)) return { ok: false }
  // Reject embedded credentials — shell.openExternal would leak them into
  // the OS handler and system logs.
  if (parsed.username !== '' || parsed.password !== '') return { ok: false }
  // Fragments are never used by RP-initiated logout; disallow them so a
  // renderer cannot smuggle a client-side URL (e.g. `#/login`) into the
  // launched browser.
  if (parsed.hash !== '') return { ok: false }
  // Path shape: must end in a known end-session segment. `URL.pathname` is
  // already normalized (no `..`, no double slashes), so a case-insensitive
  // suffix match after stripping the trailing slash is safe.
  const path = parsed.pathname.replace(/\/$/, '').toLowerCase()
  const segments = path.split('/')
  const lastSegment = segments[segments.length - 1] ?? ''
  if (!OIDC_END_SESSION_PATH_SUFFIXES.some((s) => lastSegment === s)) return { ok: false }
  // Query allowlist. Unknown parameters fail closed — see doc comment.
  // Materialize the iterator to an array so tsconfig.e.json (which targets
  // an older ES version without downlevelIteration) can consume it.
  const searchKeys: string[] = []
  parsed.searchParams.forEach((_v, key) => { searchKeys.push(key) })
  for (const key of searchKeys) {
    if (!OIDC_END_SESSION_QUERY_ALLOWLIST.has(key)) return { ok: false }
  }
  if (trustedOrigins) {
    for (const key of ['post_logout_redirect_uri', 'redirect_uri', 'returnTo', 'return_to', 'return_url', 'returnUrl']) {
      const redirectValues = parsed.searchParams.getAll(key)
      if (redirectValues.length === 0) continue
      // Duplicate redirect params are ambiguous: the allowlist check reads the
      // first value, but some IdPs follow the last. Reject rather than guess.
      if (redirectValues.length > 1) return { ok: false }
      try {
        if (!trustedOrigins.has(new URL(redirectValues[0]).origin)) return { ok: false }
      } catch {
        return { ok: false }
      }
    }
  }
  return { ok: true, value: parsed.toString() }
}

/**
 * Cap the OIDC HTTP proxy response body size. OIDC responses are small JSON
 * objects (a few KB); anything materially larger is either a misconfigured
 * endpoint or a hostile server trying to inflate main-process memory. 2 MiB
 * is well above every real response we expect and below anything that would
 * threaten the process. Kept as a constant so tests can reference the same
 * bound without hardcoding the number.
 */
export const OIDC_HTTP_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
