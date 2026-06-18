// This module is registered in apps/web/src/index.tsx via
//   import { DocsModule } from '@octo/docs'
//   WKApp.shared.registerModule(new DocsModule())
// alongside BaseModule / LoginModule / ContactsModule — same pattern as the other modules.

import { lazy, Suspense, type ReactElement } from 'react'
import { getWKApp, i18n, t, Menus } from './octoweb/index.ts'
import type { IModule } from './octoweb/index.ts'
import { InviteAcceptPage } from './invite/InviteAcceptPage.tsx'
import zhCN from './i18n/zh-CN.json'
import enUS from './i18n/en-US.json'

// Code-split the docs editor: it pulls in the whole Tiptap + Yjs + Hocuspocus bundle, which
// must NOT inflate the host app's first paint. octo-web has no global Suspense boundary (docs
// is the first code-split consumer), so the docs package provides its own boundary here rather
// than relying on the host. `DocsHome` is a named export, so adapt it to the default React.lazy
// expects.
const LazyDocsHome = lazy(() =>
  import('./pages/DocsHome.tsx').then((m) => ({ default: m.DocsHome })),
)

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

/** The main `/docs` route — the heavy editor, loaded lazily behind our own Suspense boundary. */
function DocsHomeRoute(): ReactElement {
  return (
    <Suspense fallback={<DocsLoadingFallback />}>
      <LazyDocsHome />
    </Suspense>
  )
}

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
    wk.route.register('/docs', () => <DocsHomeRoute />)
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
