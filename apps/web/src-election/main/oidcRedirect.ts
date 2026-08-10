export type OidcCallbackPath = '/login' | '/oidc/bind'

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
  const query = { ...callback.query }
  if (callback.path === '/oidc/bind') query.__octo_route = '/oidc/bind'
  query.sid = sid
  return query
}
