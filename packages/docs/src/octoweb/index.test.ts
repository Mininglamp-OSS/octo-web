import { describe, it, expect } from 'vitest'
import { apiClient, wrapHostClient, setWKApp, onNavMenuActivated } from './index.ts'
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

  // Regression (yujiawei P1 #1): the host APIClient rejects with `{ error, msg, status, code, … }`
  // — NOT an axios-style `{ response }`. Docs error handlers all read `err.response?.status` /
  // `err.response.data?.error`, so without re-wrapping the rejection EVERY production error branch
  // (members 404, attachments 400, versions 409, delete classification) silently died while tests
  // (which inject an axios-style mock) stayed green. The seam must lift the rejection into `.response`.
  it('wrapHostClient re-wraps a host-style rejection into an axios { response } error', async () => {
    // Mirror the REAL host rejection (dmworkbase APIClient response interceptor): the original
    // axios error (with its `{ response: { status, data } }`) nested under `.error`, plus the
    // host's flattened `status` / `msg` / `code` fields.
    const hostRejection = {
      error: { response: { status: 404, data: { error: 'user_not_found' } } },
      msg: 'not found',
      status: 404,
      code: 'user_not_found',
    }
    const host = {
      get: async () => Promise.reject(hostRejection),
      post: async () => Promise.reject(hostRejection),
      put: async () => Promise.reject(hostRejection),
      patch: async () => Promise.reject(hostRejection),
      delete: async () => Promise.reject(hostRejection),
    } as unknown as APIClient

    const wrapped = wrapHostClient(host)
    await expect(wrapped.get('/docs')).rejects.toMatchObject({
      response: { status: 404, data: { error: 'user_not_found' } },
    })
    await expect(wrapped.post('/docs', {})).rejects.toMatchObject({
      response: { status: 404, data: { error: 'user_not_found' } },
    })
  })

  it('wrapHostClient surfaces the host status when the rejection has no axios response (timeout/network)', async () => {
    // Timeout / network: axios error has no `.response`, but the host normalized an HTTP status.
    const host = {
      get: async () => Promise.reject({ error: new Error('timeout'), msg: 'timeout', status: 408 }),
    } as unknown as APIClient
    await expect(wrapHostClient(host).get('/docs')).rejects.toMatchObject({ response: { status: 408 } })
  })

  it('wrapHostClient passes an already axios-style rejection through untouched', async () => {
    // The injected test mock rejects axios-style directly — it must not be double-wrapped.
    const axiosErr = { response: { status: 400, data: { error: 'invalid_request' } } }
    const host = {
      get: async () => Promise.reject(axiosErr),
    } as unknown as APIClient
    await expect(wrapHostClient(host).get('/docs')).rejects.toBe(axiosErr)
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

// XIN-1165: the docs NavRail entry must re-render like a direct `/docs` load. The host emits
// `wk:nav-menu-activated` on every NavRail click; DocsHome subscribes through this seam to
// re-assert its right pane after `onMenuClick` popToRoot()'d it (a return visit does not remount
// DocsHome). The seam must fire ONLY for the docs menu and clean up on unsubscribe.
describe('onNavMenuActivated seam', () => {
  it('invokes the callback only when the docs menu is activated, and unsubscribes cleanly', () => {
    const wk = createMockWKApp()
    setWKApp(wk)

    let hits = 0
    const off = onNavMenuActivated('docs', () => {
      hits += 1
    })
    expect(wk.mockMittBus.navMenuActivatedListenerCount()).toBe(1)

    // A different menu's activation must NOT trigger the docs callback.
    wk.mockMittBus.emitNavMenuActivated('chat')
    expect(hits).toBe(0)

    // The docs menu's activation does.
    wk.mockMittBus.emitNavMenuActivated('docs')
    wk.mockMittBus.emitNavMenuActivated('docs')
    expect(hits).toBe(2)

    // After unsubscribe, no more listeners and no more callbacks.
    off()
    expect(wk.mockMittBus.navMenuActivatedListenerCount()).toBe(0)
    wk.mockMittBus.emitNavMenuActivated('docs')
    expect(hits).toBe(2)
  })

  it('returns a no-op unsubscribe when the host exposes no event bus', () => {
    // Bus-less shape: getWKApp() falls back to it, mittBus is undefined → no throw, no listener.
    setWKApp({ mittBus: undefined } as unknown as Parameters<typeof setWKApp>[0])
    const off = onNavMenuActivated('docs', () => {
      throw new Error('should never fire without a bus')
    })
    expect(() => off()).not.toThrow()
  })
})
