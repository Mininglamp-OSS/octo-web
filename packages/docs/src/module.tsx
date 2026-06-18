// This module is registered in apps/web/src/index.tsx via
//   import { DocsModule } from '@octo/docs'
//   WKApp.shared.registerModule(new DocsModule())
// alongside BaseModule / LoginModule / ContactsModule — same pattern as the other modules.

import {
  Component,
  useEffect,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
} from 'react'
import { getWKApp, i18n, t, Menus } from './octoweb/index.ts'
import type { IModule } from './octoweb/index.ts'
import { InviteAcceptPage } from './invite/InviteAcceptPage.tsx'
import zhCN from './i18n/zh-CN.json'
import enUS from './i18n/en-US.json'

/** Lightweight fallback shown while the heavy editor chunk loads. */
function DocsLoadingFallback(): ReactElement {
  return <div className="octo-doc octo-loading">{t('docs.state.loading')}</div>
}

/** NavRail icon for the Docs entry (document-with-lines glyph). */
function DocsIcon({ active }: { active?: boolean }): ReactElement {
  const color = active ? 'var(--wk-brand-primary, #7C5CFC)' : 'currentColor'
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
      <line x1="8" y1="9" x2="10" y2="9" />
    </svg>
  )
}

/**
 * Error boundary around the docs editor. Without it a render throw inside the editor subtree
 * bubbles up and tears down the host tree. We surface the failure (console.error with the
 * error and the React componentStack, so it shows up in diagnostics) and render a recoverable
 * message instead. The chunk-load failure is handled separately in DocsHomeRoute (a rejected
 * dynamic import is not a render throw, so it never reaches this boundary).
 */
class DocsErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[docs] editor failed to load', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return <div className="octo-doc octo-error">{t('docs.state.error')}</div>
    }
    return this.props.children
  }
}

/**
 * The main `/docs` route — the heavy editor (Tiptap + Yjs + Hocuspocus) is code-split so it
 * doesn't inflate the host's first paint, but we load it with a manual dynamic `import()`
 * driven by useState/useEffect rather than React.lazy + Suspense.
 *
 * Why not React.lazy/Suspense: the octo-web host (apps/web Pages/Main) drives re-renders
 * through a MobX-style store — `vm.notifyListener()` and `WKApp.menus.setRefresh =
 * () => this.forceUpdate()` fire often, and MainContentLeft re-renders the active route on
 * each one. Those run at React's normal/sync priority, ABOVE React 18's low-priority Suspense
 * RetryLane. Because the host hands the route back as a single cached element, every one of
 * those re-renders bails out at this component (oldProps === newProps) WITHOUT descending into
 * the Suspense subtree — so the only thing that can commit the resolved lazy child is the
 * retry lane, which the steady stream of higher-priority host renders keeps deferring. The
 * editor chunk downloads but the Suspense boundary never gets a clean commit, leaving the UI
 * pinned on DocsLoadingFallback forever (DocsHome's listDocs / collab-token never run).
 *
 * Driving the load with useState sidesteps all of that: when the import resolves, setLoaded()
 * schedules an update ON THIS fiber, which React renders and commits regardless of how the
 * parent reconciles — no dependency on Suspense's ping/retry under a hostile host.
 */
function DocsHomeRoute(): ReactElement {
  const [Loaded, setLoaded] = useState<ComponentType | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    import('./pages/DocsHome.tsx')
      .then((m) => {
        // Store the component itself — wrap in a thunk so useState's updater form doesn't
        // call it as a state reducer.
        if (active) setLoaded(() => m.DocsHome)
      })
      .catch((err) => {
        console.error('[docs] editor chunk failed to load', err)
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [])

  if (failed) {
    return <div className="octo-doc octo-error">{t('docs.state.error')}</div>
  }
  if (!Loaded) {
    return <DocsLoadingFallback />
  }
  return (
    <DocsErrorBoundary>
      <Loaded />
    </DocsErrorBoundary>
  )
}

// Build the `/docs` route element ONCE and reuse the same instance for every
// WKApp.route.get('/docs') call. The host (apps/web Pages/Main) is a MobX observer that
// re-invokes the route handler on every re-render and renders whatever it returns; a stable
// element instance lets React bail out of those unrelated re-renders and preserves the
// DocsHomeRoute fiber (so its useState load-state survives host re-renders and the chunk is
// fetched once). The load itself no longer depends on this bailout for correctness — the
// useState update commits regardless — but keeping the element stable avoids needless churn.
const docsHomeRouteElement = <DocsHomeRoute />

// Parse the `:token` segment from `/docs/invite/:token` (self-built RouteManager passes no
// params in the contract example, so the route component reads it from the path).
function tokenFromPath(): string {
  if (typeof window === 'undefined') return ''
  const m = window.location.pathname.match(/\/docs\/invite\/([^/?#]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

// The invite-accept page is small (no editor bundle), so it stays eager — only the main
// editor route below is code-split.
function InviteAcceptRoute(): ReactElement {
  return <InviteAcceptPage token={tokenFromPath()} />
}

/**
 * Docs module (frontend-design §11.2). Registered once via
 * `WKApp.shared.registerModule(new DocsModule())` in apps/web/src/index.tsx — same pattern as
 * BaseModule / LoginModule / ContactsModule.
 */
export class DocsModule implements IModule {
  id(): string {
    return 'docs'
  }

  init(): void {
    // Register the `docs` i18n namespace (parallel zh-CN / en-US resource trees).
    i18n.registerNamespace('docs', {
      'zh-CN': zhCN,
      'en-US': enUS,
    })

    const wk = getWKApp()
    // Self-built RouteManager (NOT react-router).
    wk.route.register('/docs', () => docsHomeRouteElement)
    wk.route.register('/docs/invite/:token', () => <InviteAcceptRoute />)

    // Register the Docs entry in the octo-web NavRail (sidebar). Without this the
    // /docs route is registered but unreachable: the main view is menu-driven
    // (MainContentLeft renders the route whose `routePath === currentMenus.routePath`),
    // so with no `docs` menu the route never becomes the active view and the app
    // falls back to the chat shell — including on a hard `/docs` deep-link, because
    // MainVM.didMount only activates a route when it matches a registered menu's
    // routePath. Registering the menu fixes both the missing entry AND deep-link
    // mounting. Pattern mirrors MatterModule / dmworksummary. sort=4002 places it
    // after contacts(4000)/matter(4001) and before summary(5000).
    wk.menus.register(
      'docs',
      () => new Menus('docs', '/docs', t('docs.menu.title'), <DocsIcon />, <DocsIcon active />),
      4002,
    )
  }
}
