import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchHttpClient, OidcBindHttpError } from '../http'

describe('fetchHttpClient', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('GET parses JSON on 2xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ x: 1 }),
    }) as never
    const r = await fetchHttpClient.get<{ x: number }>('/u')
    expect(r.x).toBe(1)
  })

  it('GET throws OidcBindHttpError on non-2xx with msg body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ msg: 'rate_limited' }),
    }) as never
    try {
      await fetchHttpClient.get('/u')
      throw new Error('should not reach')
    } catch (e) {
      expect(e).toBeInstanceOf(OidcBindHttpError)
      expect((e as OidcBindHttpError).status).toBe(429)
      expect((e as OidcBindHttpError).msg).toBe('rate_limited')
    }
  })

  it('GET surfaces status when body is not JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal error',
    }) as never
    try {
      await fetchHttpClient.get('/u')
    } catch (e) {
      expect((e as OidcBindHttpError).status).toBe(500)
    }
  })

  it('POST sends Content-Type: application/json with stringified body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })
    globalThis.fetch = fetchMock as never
    await fetchHttpClient.post('/u', { a: 1 })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ a: 1 }))
  })

  it('POST throws OidcBindHttpError on 410 with msg', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 410,
      text: async () => JSON.stringify({ msg: 'expired' }),
    }) as never
    await expect(fetchHttpClient.post('/u', {})).rejects.toMatchObject({
      name: 'OidcBindHttpError',
      status: 410,
      msg: 'expired',
    })
  })
})
