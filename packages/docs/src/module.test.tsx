import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { setWKApp } from './octoweb/index.ts'
import { createMockWKApp } from './octoweb/mock.ts'
import { DocsModule } from './module.tsx'

// Replace the heavy editor chunk (Tiptap + Yjs + Hocuspocus) with a marker component so the
// DocsHomeRoute loading test exercises the dynamic-import → useState commit path without
// pulling the real editor into jsdom. Path matches the dynamic import in module.tsx.
vi.mock('./pages/DocsHome.tsx', () => ({
  DocsHome: () => <div data-testid="docs-home-loaded">docs-home</div>,
}))

afterEach(() => {
  cleanup()
})

describe('DocsModule (octo-web same-origin integration)', () => {
  it('has id "docs"', () => {
    expect(new DocsModule().id()).toBe('docs')
  })

  it('registers /docs and /docs/invite/:token via the RouteManager on init()', () => {
    const wk = createMockWKApp()
    setWKApp(wk)
    new DocsModule().init()
    expect(wk.route.routes.has('/docs')).toBe(true)
    expect(wk.route.routes.has('/docs/invite/:token')).toBe(true)
  })

  it('is registrable through WKApp.shared.registerModule', () => {
    const wk = createMockWKApp()
    setWKApp(wk)
    wk.shared.registerModule(new DocsModule())
    expect(wk.registeredModules.map((m) => m.id())).toContain('docs')
  })

  it('registers /docs routes via the standalone boot path (registerModule calls init)', () => {
    // Regression: the standalone vite boot only goes through registerModule (never a
    // direct init() call). registerModule must initialize the module so /docs and
    // /docs/invite/:token are registered; otherwise the first paint is "Not found".
    const wk = createMockWKApp()
    setWKApp(wk)
    wk.shared.registerModule(new DocsModule())
    expect(wk.route.routes.has('/docs')).toBe(true)
    expect(wk.route.routes.has('/docs/invite/:token')).toBe(true)
  })

  it('registers a "docs" NavRail menu pointing at /docs on init()', () => {
    // Regression (runtime test 2026-06-18): the /docs route was registered but NO
    // NavRail menu existed. The main view is menu-driven — MainContentLeft renders
    // the route whose routePath matches the active menu, and MainVM.didMount only
    // activates a route when it matches a registered menu. With no "docs" menu the
    // editor never mounted (app fell back to the chat shell) and users had no entry.
    const wk = createMockWKApp()
    setWKApp(wk)
    new DocsModule().init()
    expect(wk.mockMenus.menus.has('docs')).toBe(true)
    const menu = wk.mockMenus.menus.get('docs')!() as { routePath: string }
    expect(menu.routePath).toBe('/docs')
  })

  it('returns a STABLE /docs route element across handler invocations', () => {
    // The host (apps/web Pages/Main) is a MobX observer that re-invokes
    // WKApp.route.get('/docs') on every re-render and renders whatever it returns. A stable
    // element instance lets React bail out of those unrelated re-renders and — crucially —
    // preserves the DocsHomeRoute fiber so its useState load-state survives and the editor
    // chunk is fetched once rather than on every host re-render.
    const wk = createMockWKApp()
    setWKApp(wk)
    new DocsModule().init()
    const factory = wk.route.routes.get('/docs')!
    expect(factory()).toBe(factory())
  })

  it('normalizes a /docs/invite/:token deep-link to /docs and accepts the invite (BLOCKING-1)', () => {
    // Hard navigation/refresh to /docs/invite/:token has no menu to activate (only /docs does),
    // so the host falls back to chat and InviteAcceptPage never mounts. init() must stash the
    // token and rewrite the URL to /docs (reusing the working /docs activation), then the /docs
    // route element renders the invite-accept page while a pending token exists.
    const token = 'tkn_deeplink_123'
    window.history.replaceState(null, '', `/docs/invite/${token}`)
    try {
      const wk = createMockWKApp()
      setWKApp(wk)
      new DocsModule().init()
      // URL normalized to /docs so the host activates the existing /docs menu.
      expect(window.location.pathname).toBe('/docs')
      // The /docs route element renders the invite-accept page (not docs home) for the token.
      const factory = wk.route.routes.get('/docs')!
      render(factory() as React.ReactElement)
      // InviteAcceptPage shows its accepting/working state; docs-home marker must NOT appear.
      expect(screen.queryByTestId('docs-home-loaded')).toBeNull()
    } finally {
      window.history.replaceState(null, '', '/docs')
      try {
        window.sessionStorage.removeItem('octo.docs.pendingInvite')
      } catch {
        // ignore
      }
    }
  })

  it('shows the loading fallback, then commits DocsHome once the editor chunk resolves', async () => {
    // Regression (runtime test 2026-06-18, second pass): with React.lazy + Suspense the
    // editor chunk downloaded but the boundary never committed under the host's MobX-driven
    // re-render model (high-priority forceUpdate renders bail out at the cached route element
    // without descending, starving React 18's low-priority Suspense RetryLane), so the UI
    // stayed pinned on the loading fallback and DocsHome's listDocs / collab-token never ran.
    // The route now loads the chunk via a manual dynamic import + useState; the resolve
    // schedules an update ON the route fiber, which React commits regardless of how the host
    // re-renders. This test proves the loaded editor actually replaces the fallback.
    const wk = createMockWKApp()
    setWKApp(wk)
    new DocsModule().init()
    const element = wk.route.routes.get('/docs')!()
    render(element)
    // First paint: the lightweight loading fallback (t() stub returns the key verbatim).
    expect(screen.getByText('docs.state.loading')).toBeTruthy()
    // After the dynamic import resolves, the editor mounts in its place.
    await waitFor(() => {
      expect(screen.getByTestId('docs-home-loaded')).toBeTruthy()
    })
  })
})
