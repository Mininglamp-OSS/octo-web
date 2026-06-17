import { useEffect, useState, type ReactElement } from 'react'

// Minimal standalone router that mirrors octo-web's self-built RouteManager matching:
// exact path or a `:param` segment match. octo-web provides the real RouteManager;
// this only exists so the demo is navigable without it.
function matchRoute(
  routes: Map<string, () => ReactElement>,
  pathname: string,
): (() => ReactElement) | null {
  if (routes.has(pathname)) return routes.get(pathname)!
  for (const [pattern, factory] of routes) {
    if (!pattern.includes(':')) continue
    const pSegs = pattern.split('/')
    const aSegs = pathname.split('/')
    if (pSegs.length !== aSegs.length) continue
    const ok = pSegs.every((seg, i) => seg.startsWith(':') || seg === aSegs[i])
    if (ok) return factory
  }
  return null
}

export function App({ routes }: { routes: Map<string, () => ReactElement> }) {
  const [path, setPath] = useState(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/docs',
  )

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Default to /docs.
  const target = path === '/' ? '/docs' : path
  const factory = matchRoute(routes, target)

  if (!factory) {
    return (
      <div className="octo-doc">
        <h2>Not found</h2>
        <p>
          No route for <code>{target}</code>. Try <a href="/docs">/docs</a>.
        </p>
      </div>
    )
  }
  return factory()
}
