import { describe, it, expect } from 'vitest'
import { setWKApp } from './octoweb/index.ts'
import { createMockWKApp } from './octoweb/mock.ts'
import { DocsModule } from './module.tsx'

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
})
