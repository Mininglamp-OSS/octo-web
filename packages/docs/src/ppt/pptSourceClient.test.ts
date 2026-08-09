import { describe, it, expect, beforeEach } from 'vitest'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import { fetchPptSourceHtml } from './pptSourceClient.ts'

// The container fetches the rendered source THROUGH the shared apiClient (so the app's auth /
// X-Space-Id / language interceptors apply), against octo-docs-backend #161's real endpoint — never
// a bespoke /ppt/frame host route.

let api: MockApiClient

beforeEach(() => {
  const wk = createMockWKApp()
  api = wk.apiClient
  setWKApp(wk)
})

describe('fetchPptSourceHtml — real source endpoint through the shared apiClient', () => {
  it('GETs /ppt/docs/:id/source with the mapped mode, version and format=html', async () => {
    api.responder = () => ({ data: '<html><body>deck</body></html>', status: 200 })
    const html = await fetchPptSourceHtml({ docId: 'd_1', mode: 'preview', version: 'latest' })
    expect(html).toBe('<html><body>deck</body></html>')
    expect(api.calls).toHaveLength(1)
    const { method, url } = api.calls[0]
    expect(method).toBe('get')
    expect(url).toContain('/ppt/docs/d_1/source')
    expect(url).not.toContain('/ppt/frame')
    const q = new URL(url, 'http://local').searchParams
    expect(q.get('mode')).toBe('published')
    expect(q.get('version')).toBe('latest')
    expect(q.get('format')).toBe('html')
  })

  it('maps editor→live, forwards X-Space-Id, and omits version (published-only per backend #161)', async () => {
    api.responder = () => ({ data: '<html></html>', status: 200 })
    await fetchPptSourceHtml({ docId: 'd_1', mode: 'editor', version: 4, space: 's_9' })
    const { url, config } = api.calls[0]
    const q = new URL(url, 'http://local').searchParams
    expect(q.get('mode')).toBe('live')
    // editor→live must not send `version`; backend #161 400s an explicit version on non-published modes.
    expect(q.has('version')).toBe(false)
    expect(config?.headers?.['X-Space-Id']).toBe('s_9')
  })
})
