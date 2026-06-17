// This module is registered in apps/web/src/index.tsx via
//   import { DocsModule } from '@octo/docs'
//   WKApp.shared.registerModule(new DocsModule())
// alongside BaseModule / LoginModule / ContactsModule — same pattern as the other modules.

import { lazy, Suspense, type ReactElement } from 'react'
import { getWKApp, i18n, t } from './octoweb/index.ts'
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
    // (Optional) register a docs entry in the octo-web sidebar/nav here.
  }
}
