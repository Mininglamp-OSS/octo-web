/**
 * Resolve a bind-success destination without escaping the packaged Electron
 * app shell. A root-relative path such as `/` resolves to `file:///` when
 * assigned directly from a file:// document; keep the loaded index.html path
 * and only carry the destination query/hash across.
 */
export function resolveBindNavigationUrl(returnTo: string, currentHref: string): string {
  const current = new URL(currentHref)
  if (current.protocol !== 'file:') return returnTo

  const target = new URL(returnTo, 'https://octo.local')
  current.search = target.search
  current.hash = target.hash
  return current.toString()
}
