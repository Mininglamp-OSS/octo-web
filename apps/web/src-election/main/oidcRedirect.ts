export type OidcCallbackPath = '/login' | '/oidc/bind'

// Allowlist of query params that may be forwarded from the IdP/backend callback
// URL into the packaged shell. Anything outside this list is dropped so a
// hostile IdP/open-redirect can't smuggle attacker-chosen params into the
// renderer (e.g. `__octo_route=/oidc/bind&token=…` on a `/login` callback).
// Keep this list in sync with the shell entry points that actually read
// callback params: OidcResumeEffect (`oidc_error`), the bind entry
// (`token`, `authcode`, `return_to`, `provider`), and the OIDC state param.
const FORWARDABLE_QUERY_KEYS: ReadonlySet<string> = new Set([
  'code',
  'state',
  'oidc_error',
  'token',
  'authcode',
  'return_to',
  'provider',
])

export function parseOidcCallback(url: string, expectedOrigin: string): {
  path: OidcCallbackPath
  query: Record<string, string>
} | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.origin !== expectedOrigin) return undefined
  if (parsed.pathname !== '/login' && parsed.pathname !== '/oidc/bind') return undefined

  const query: Record<string, string> = {}
  parsed.searchParams.forEach((value, key) => {
    query[key] = value
  })
  return { path: parsed.pathname, query }
}

export function withTrustedSessionSid(
  callback: { path: OidcCallbackPath; query: Record<string, string> },
  sid: string,
): Record<string, string> {
  // Rebuild the query from an explicit allowlist rather than spreading the
  // callback query. Two things this closes:
  //   1. `__octo_route` — always derived from `callback.path`, never inherited
  //      from the callback query. Without this, a `/login` callback could
  //      carry `__octo_route=/oidc/bind&token=…` and land in the bind flow
  //      with a trusted sid attached.
  //   2. Any future param an IdP or open-redirect could add: dropped by
  //      default rather than silently reaching the renderer.
  const query: Record<string, string> = {}
  FORWARDABLE_QUERY_KEYS.forEach((key) => {
    const value = callback.query[key]
    if (typeof value === 'string') query[key] = value
  })
  if (callback.path === '/oidc/bind') query.__octo_route = '/oidc/bind'
  query.sid = sid
  return query
}
