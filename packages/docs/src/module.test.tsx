import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { setWKApp } from './octoweb/index.ts'
import { createMockWKApp, MockRemoteConfig } from './octoweb/mock.ts'
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

  describe('docs_on appconfig gate', () => {
    it('hides the NavRail entry (factory returns undefined) when docs_on is false', () => {
      // Default fail-safe: docs-backend may not be deployed yet, so with docs_on=false the
      // factory returns undefined and MenusManager.invokes() filters it out — no entry shown.
      const wk = createMockWKApp(undefined, new MockRemoteConfig(false))
      setWKApp(wk)
      new DocsModule().init()
      // The factory IS registered (so it re-evaluates on refresh), but yields nothing now.
      expect(wk.mockMenus.menus.has('docs')).toBe(true)
      expect(wk.mockMenus.menus.get('docs')!()).toBeUndefined()
    })

    it('shows the NavRail entry when docs_on is true', () => {
      const wk = createMockWKApp(undefined, new MockRemoteConfig(true))
      setWKApp(wk)
      new DocsModule().init()
      const menu = wk.mockMenus.menus.get('docs')!() as { routePath: string } | undefined
      expect(menu?.routePath).toBe('/docs')
    })

    it('re-evaluates from hidden to shown when docs_on flips after appconfig arrives', () => {
      // appconfig is async: at init() docs_on is still false, so the entry is hidden. When the
      // backend later reports docs_on=true, the module refreshes the NavRail and the factory now
      // yields the menu. This is the real boot ordering the listeners exist for.
      const rc = new MockRemoteConfig(false)
      const wk = createMockWKApp(undefined, rc)
      setWKApp(wk)
      new DocsModule().init()
      expect(wk.mockMenus.menus.get('docs')!()).toBeUndefined()

      // Backend enables docs after deployment is ready → first-load listener fires a refresh.
      rc.docsOn = true
      rc.emitLoad()
      expect(wk.mockMenus.refreshCount).toBeGreaterThan(0)
      const menu = wk.mockMenus.menus.get('docs')!() as { routePath: string } | undefined
      expect(menu?.routePath).toBe('/docs')
    })

    it('refreshes the NavRail on a later appconfig change (docs_on toggled off)', () => {
      const rc = new MockRemoteConfig(true)
      const wk = createMockWKApp(undefined, rc)
      setWKApp(wk)
      new DocsModule().init()
      expect((wk.mockMenus.menus.get('docs')!() as { routePath: string }).routePath).toBe('/docs')

      // Ops turns docs off again → change listener refreshes, factory now hides the entry.
      rc.docsOn = false
      rc.emitChange()
      expect(wk.mockMenus.refreshCount).toBeGreaterThan(0)
      expect(wk.mockMenus.menus.get('docs')!()).toBeUndefined()
    })

    it('refreshes immediately when appconfig already resolved before init (#536 P2)', () => {
      // Registration-order independent: if the docs module initializes AFTER the first appconfig
      // load resolved, addListener would return a noop (fires only for pre-load subscribers), so
      // the entry would wait for an unrelated later change. init() must honor requestSuccess and
      // reflect the current docs_on right away.
      const rc = new MockRemoteConfig(true)
      rc.emitLoad() // first appconfig load resolves → requestSuccess=true, before init()
      expect(rc.requestSuccess).toBe(true)
      const wk = createMockWKApp(undefined, rc)
      setWKApp(wk)
      new DocsModule().init()
      // Entry reflects docs_on now, without waiting for a further emitLoad/emitChange.
      expect(wk.mockMenus.refreshCount).toBeGreaterThan(0)
      expect((wk.mockMenus.menus.get('docs')!() as { routePath: string }).routePath).toBe('/docs')
    })

    it('does not accumulate duplicate config listeners across repeat init() (#536 P2)', () => {
      // HMR / re-registration calls init() again on the same instance. The listeners must be
      // rebound idempotently (old ones dropped first), not stacked — else each appconfig change
      // fires refreshMenus N times.
      const rc = new MockRemoteConfig(false)
      const wk = createMockWKApp(undefined, rc)
      setWKApp(wk)
      const mod = new DocsModule()
      mod.init()
      mod.init()
      mod.init()
      // Exactly one change listener remains regardless of how many times init() ran.
      expect(rc.changeListenerCount()).toBe(1)
      const before = wk.mockMenus.refreshCount
      rc.docsOn = true
      rc.emitChange()
      expect(wk.mockMenus.refreshCount).toBe(before + 1) // one refresh, not three
    })
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

  it('captures a /docs?doc=<id> deep-link into sessionStorage on init() so it survives the host query-wipe (XIN-328)', () => {
    // A forwarded-doc link is `${origin}/docs?...&doc=<docId>`, but the host RouteManager's
    // pageshow/popstate handler re-pushes pathname-only and re-stamps the URL to `/docs?sid=…`,
    // wiping `?doc=` before the code-split DocsHome mounts. init() must stash the target BEFORE
    // that re-push (same window as normalizeInviteDeepLink) so resolveDocTarget's persisted-target
    // fallback opens the document instead of the empty list.
    window.history.replaceState(null, '', '/docs?space=s_1&folder=f_1&doc=d_forwarded')
    try {
      const wk = createMockWKApp()
      setWKApp(wk)
      new DocsModule().init()
      const raw = window.sessionStorage.getItem('octo.docs.target')
      expect(raw).toBeTruthy()
      expect(JSON.parse(raw!)).toEqual({ space: 's_1', folder: 'f_1', doc: 'd_forwarded' })
    } finally {
      window.history.replaceState(null, '', '/docs')
      try {
        window.sessionStorage.removeItem('octo.docs.target')
      } catch {
        // ignore
      }
    }
  })

  it('does NOT stash a doc target when /docs is opened without a doc query (XIN-328)', () => {
    // A plain `/docs` visit must not seed the mirror, or it would wrongly reopen a stale doc.
    window.history.replaceState(null, '', '/docs')
    try {
      window.sessionStorage.removeItem('octo.docs.target')
      const wk = createMockWKApp()
      setWKApp(wk)
      new DocsModule().init()
      expect(window.sessionStorage.getItem('octo.docs.target')).toBeNull()
    } finally {
      window.history.replaceState(null, '', '/docs')
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
