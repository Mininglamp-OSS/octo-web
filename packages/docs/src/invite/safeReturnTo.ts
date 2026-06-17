// Open-redirect guard for invite login-return flow (frontend-design §12.3).
//
// returnTo must be an internal docs path only. Reject absolute URLs, protocol-relative
// `//host`, anything containing a scheme, or backslashes. Only a single leading slash
// followed by `docs/` (i.e. `/docs/...`) is allowed.

export function isSafeReturnTo(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0) return false
  // Must start with exactly one '/'.
  if (path[0] !== '/') return false
  // Reject protocol-relative `//host` and scheme-relative `/\`.
  if (path[1] === '/' || path[1] === '\\') return false
  // Reject backslashes anywhere (some browsers treat `\` as `/`).
  if (path.includes('\\')) return false
  // Reject anything that parses as having a scheme/host (e.g. embedded `http:`).
  if (/^[a-z][a-z0-9+.-]*:/i.test(path.slice(1))) return false
  // Restrict to the docs surface.
  return path === '/docs' || path.startsWith('/docs/')
}

/** Return the path if safe, otherwise a safe fallback (`/docs`). */
export function safeReturnTo(path: string): string {
  return isSafeReturnTo(path) ? path : '/docs'
}
