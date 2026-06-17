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
})
