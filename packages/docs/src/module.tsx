// INTEGRATION POINT (phase 3): register this module in apps/web/src/index.tsx, alongside
// the other modules, with:
//
//   import { DocsModule } from '@octo/docs'
//   WKApp.shared.registerModule(new DocsModule())
//
// Intentionally NOT wired yet — phase 3 adds that line after the Tiptap v2 -> v3 upgrade
// (phase 2). Until then the package only builds/type-checks as a standalone workspace package.

import type { ReactElement } from 'react'
import { getWKApp, type IModule } from './octoweb/index.ts'
import { InviteAcceptPage } from './invite/InviteAcceptPage.tsx'
import { DocsHome } from './pages/DocsHome.tsx'

// Parse the `:token` segment from `/docs/invite/:token` (self-built RouteManager passes no
// params in the contract example, so the route component reads it from the path).
function tokenFromPath(): string {
  if (typeof window === 'undefined') return ''
  const m = window.location.pathname.match(/\/docs\/invite\/([^/?#]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

function InviteAcceptRoute(): ReactElement {
  return <InviteAcceptPage token={tokenFromPath()} />
}

/**
 * Docs module (frontend-design §11.2). In real octo-web this lives in the `@octo/docs`
 * workspace package and is registered once via `WKApp.shared.registerModule(new DocsModule())`
 * in apps/web/src/index.tsx — same pattern as BaseModule / LoginModule / ContactsModule.
 */
export class DocsModule implements IModule {
  id(): string {
    return 'docs'
  }

  init(): void {
    const wk = getWKApp()
    // Self-built RouteManager (NOT react-router).
    wk.route.register('/docs', () => <DocsHome />)
    wk.route.register('/docs/invite/:token', () => <InviteAcceptRoute />)
    // (Optional) register a docs entry in the octo-web sidebar/nav here.
  }
}
