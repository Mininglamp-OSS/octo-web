import { describe, it, expect } from 'vitest'
import { apiClient, wrapHostClient, setWKApp } from './index.ts'
import { createMockWKApp } from './mock.ts'
import type { APIClient } from './types.ts'

// Regression: the host APIClient.wrapResult() resolves to the response BODY directly, not an
// axios `{ data }` envelope. Docs call sites destructure `const { data } = await ...get()`, so
// the seam must re-wrap the host body into `{ data }`. Without it, `res.items` (DocsHome) threw
// "Cannot read properties of undefined (reading 'items')" in production.
describe('octoweb apiClient seam', () => {
  it('wrapHostClient re-wraps a body-returning host into the { data } envelope', async () => {
    const body = { total: 1, items: [{ docId: 'd1' }] }
    // Fake the REAL host: every method resolves to the BODY directly (mirrors wrapResult()).
    const host = {
      get: async () => body,
      post: async () => body,
      put: async () => body,
      patch: async () => body,
      delete: async () => body,
    } as unknown as APIClient

    const wrapped = wrapHostClient(host)
    await expect(wrapped.get('/docs')).resolves.toEqual({ data: body, status: 200 })
    await expect(wrapped.post('/docs', {})).resolves.toEqual({ data: body, status: 200 })
    await expect(wrapped.put('/docs')).resolves.toEqual({ data: body, status: 200 })
    await expect(wrapped.patch('/docs')).resolves.toEqual({ data: body, status: 200 })
    await expect(wrapped.delete('/docs')).resolves.toEqual({ data: body, status: 200 })
  })

  it('forwards path + config through to the host method', async () => {
    const calls: Array<{ url: string; config?: unknown }> = []
    const host = {
      get: async (url: string, config?: unknown) => {
        calls.push({ url, config })
        return { ok: true }
      },
    } as unknown as APIClient

    const cfg = { signal: new AbortController().signal }
    await wrapHostClient(host).get('/docs/d1', cfg)
    expect(calls).toEqual([{ url: '/docs/d1', config: cfg }])
  })

  it('returns the injected mock apiClient AS-IS (already axios-style) — no double wrap', () => {
    const wk = createMockWKApp()
    setWKApp(wk)
    // Override path must hand back the mock untouched so existing tests stay green.
    expect(apiClient()).toBe(wk.apiClient)
  })

  // Regression for the title-save bug: the seam's wrapHostClient calls `host.patch(...)`, but
  // the REAL host APIClient (dmworkbase) only had get/post/put/delete — no `patch`. Tests stayed
  // green because the host mock here *invented* a patch method. So renaming a doc threw
  // `TypeError: host.patch is not a function` at runtime (PATCH never left the browser).
  // Assert the real host class exposes every verb the seam delegates to.
  it('the REAL host APIClient exposes all verbs the seam delegates to (incl. patch)', async () => {
    const mod = (await import('../../../dmworkbase/src/Service/APIClient.ts')) as Record<string, unknown>
    // Resolve the class whether it's a named or default export.
    const RealAPIClient = (mod.APIClient ?? mod.default) as { prototype: Record<string, unknown> } | undefined
    expect(RealAPIClient, 'APIClient export').toBeTruthy()
    const proto = RealAPIClient!.prototype
    for (const verb of ['get', 'post', 'put', 'patch', 'delete']) {
      expect(typeof proto[verb], `host APIClient.${verb}`).toBe('function')
    }
  })
})
