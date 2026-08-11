import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import {
  getCollabTokenEntry,
  getCollabToken,
  disposeToken,
  tokenCacheKey,
  __resetTokenCacheForTests,
} from './collabToken.ts'

let wk: ReturnType<typeof createMockWKApp>
let api: MockApiClient

function tokenResponse(role = 'writer', epoch = 1, token = 'jwt-1') {
  return {
    data: {
      token,
      expiresAt: Date.now() + 5 * 60_000,
      role,
      permission_epoch: epoch,
    },
    status: 200,
  }
}

beforeEach(() => {
  __resetTokenCacheForTests()
  wk = createMockWKApp({ uid: 'u_self', token: 'octo-session' })
  api = wk.apiClient
  setWKApp(wk)
})

describe('collab-token cache', () => {
  it('caches per `${uid}::${documentName}` and reuses unexpired tokens', async () => {
    api.responder = () => tokenResponse()
    const a = await getCollabTokenEntry('octo:s:f:d1')
    const b = await getCollabTokenEntry('octo:s:f:d1')
    expect(a).toBe(b)
    expect(api.calls.filter((c) => c.url === '/docs/collab-token')).toHaveLength(1)
  })

  it('uses tokenCacheKey form `${uid}::${documentName}`', () => {
    expect(tokenCacheKey('u_self', 'octo:s:f:d1')).toBe('u_self::octo:s:f:d1::legacy')
    expect(tokenCacheKey('u_self', 'octo:s:f:d1', 'd1')).toBe('u_self::octo:s:f:d1::doc:d1')
  })

  it('coalesces concurrent issuance into a single in-flight request', async () => {
    let resolveFn: (v: ReturnType<typeof tokenResponse>) => void = () => {}
    api.responder = () =>
      new Promise((resolve) => {
        resolveFn = resolve
      })
    const p1 = getCollabTokenEntry('octo:s:f:d2')
    const p2 = getCollabTokenEntry('octo:s:f:d2')
    resolveFn(tokenResponse())
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBe(r2)
    expect(api.calls).toHaveLength(1)
  })

  it('returns only the token string from getCollabToken', async () => {
    api.responder = () => tokenResponse('reader', 3, 'jwt-xyz')
    expect(await getCollabToken('octo:s:f:d3')).toBe('jwt-xyz')
  })

  it('drops a stale token when uid changes mid-issuance', async () => {
    let resolveFn: (v: ReturnType<typeof tokenResponse>) => void = () => {}
    api.responder = () =>
      new Promise((resolve) => {
        resolveFn = resolve
      })
    const p = getCollabTokenEntry('octo:s:f:d4')
    // Account switches while the request is in flight.
    wk.loginInfo.uid = 'u_other'
    resolveFn(tokenResponse())
    await expect(p).rejects.toThrow(/uid changed/)
  })

  it('re-issues after disposeToken (e.g. on downgrade)', async () => {
    api.responder = () => tokenResponse()
    await getCollabTokenEntry('octo:s:f:d5')
    disposeToken('octo:s:f:d5')
    await getCollabTokenEntry('octo:s:f:d5')
    expect(api.calls).toHaveLength(2)
  })

  it('rejects an invalid role from the backend', async () => {
    api.responder = () => ({
      data: { token: 't', expiresAt: Date.now() + 60_000, role: 'superuser', permission_epoch: 1 },
      status: 200,
    })
    await expect(getCollabTokenEntry('octo:s:f:d6')).rejects.toThrow(/invalid role/)
  })

  it('passes through collabWsUrl when the backend provides it', async () => {
    api.responder = () => ({
      data: {
        token: 'jwt-ws',
        expiresAt: Date.now() + 60_000,
        role: 'writer',
        permission_epoch: 1,
        collabWsUrl: 'wss://collab.prod.example.com',
      },
      status: 200,
    })
    const entry = await getCollabTokenEntry('octo:s:f:dws')
    expect(entry.collabWsUrl).toBe('wss://collab.prod.example.com')
  })

  it('leaves collabWsUrl undefined when the backend omits the key', async () => {
    api.responder = () => tokenResponse()
    const entry = await getCollabTokenEntry('octo:s:f:dnows')
    expect(entry.collabWsUrl).toBeUndefined()
  })

  it('aborts the in-flight request on disposeToken', async () => {
    const abortSpy = vi.fn()
    api.responder = (_m, _u, _b, config) => {
      config?.signal?.addEventListener('abort', abortSpy)
      return new Promise(() => {}) // never resolves
    }
    void getCollabTokenEntry('octo:s:f:d7')
    await Promise.resolve()
    disposeToken('octo:s:f:d7')
    expect(abortSpy).toHaveBeenCalled()
  })
})

describe('collab-token docId-first issuance (design §7.1)', () => {
  it('POSTs to /docs/:docId/collab-token with no redundant client locator body', async () => {
    api.responder = () => tokenResponse('writer', 2, 'jwt-docid')
    const entry = await getCollabTokenEntry('octo:s:f:d_x', 'd_x')
    expect(entry.token).toBe('jwt-docid')
    // The docId-scoped endpoint is used — NOT the legacy /docs/collab-token.
    const call = api.calls.find((c) => c.method === 'post')
    expect(call?.url).toBe('/docs/d_x/collab-token')
    expect(api.calls.some((c) => c.url === '/docs/collab-token')).toBe(false)
    // The backend derives documentName and home Space from the path docId.
    expect(call?.body).toEqual({})
    expect(call?.config).toMatchObject({ suppressSpaceId: true })
  })

  it('percent-encodes the docId in the path', async () => {
    api.responder = () => tokenResponse()
    await getCollabTokenEntry('octo:s:f:d_slash', 'a b')
    const call = api.calls.find((c) => c.method === 'post')
    expect(call?.url).toBe('/docs/a%20b/collab-token')
  })

  it('falls back to the legacy endpoint and sends documentName when no docId is supplied', async () => {
    api.responder = () => tokenResponse()
    await getCollabTokenEntry('octo:s:f:d_legacy')
    const call = api.calls.find((c) => c.method === 'post')
    expect(call?.url).toBe('/docs/collab-token')
    expect(call?.body).toEqual({ documentName: 'octo:s:f:d_legacy' })
    expect(call?.config?.suppressSpaceId).toBeUndefined()
  })

  it('keeps docId and legacy endpoint cache identities separate', async () => {
    api.responder = () => tokenResponse()
    const a = await getCollabTokenEntry('octo:s:f:d_cache', 'd_cache')
    // A legacy request must not reuse a token issued under the docId-first contract.
    const b = await getCollabTokenEntry('octo:s:f:d_cache')
    expect(a).not.toBe(b)
    expect(api.calls.filter((c) => c.method === 'post')).toHaveLength(2)
  })

  it('getCollabToken forwards the docId to the docId-scoped endpoint', async () => {
    api.responder = () => tokenResponse('reader', 1, 'jwt-str')
    expect(await getCollabToken('octo:s:f:d_g', 'd_g')).toBe('jwt-str')
    expect(api.calls.find((c) => c.method === 'post')?.url).toBe('/docs/d_g/collab-token')
  })

  it('re-issues a docId-first token after disposing the matching cache slot', async () => {
    api.responder = () => tokenResponse()
    await getCollabTokenEntry('octo:s:f:d_dispose', 'd_dispose')
    disposeToken('octo:s:f:d_dispose', { docId: 'd_dispose' })
    await getCollabTokenEntry('octo:s:f:d_dispose', 'd_dispose')
    expect(api.calls.filter((c) => c.url === '/docs/d_dispose/collab-token')).toHaveLength(2)
  })

  it('aborts an in-flight docId-first issuance when its matching slot is disposed', async () => {
    const abortSpy = vi.fn()
    api.responder = (_m, _u, _b, config) => {
      config?.signal?.addEventListener('abort', abortSpy)
      return new Promise(() => {})
    }
    void getCollabTokenEntry('octo:s:f:d_abort', 'd_abort')
    await Promise.resolve()
    disposeToken('octo:s:f:d_abort', { docId: 'd_abort' })
    expect(abortSpy).toHaveBeenCalledOnce()
  })

  it('keeps a reissued docId-first request cached when the disposed request settles late', async () => {
    const resolvers: Array<(v: ReturnType<typeof tokenResponse>) => void> = []
    api.responder = () => new Promise((resolve) => resolvers.push(resolve))

    const stale = getCollabTokenEntry('octo:s:f:d_race', 'd_race')
    await Promise.resolve()
    disposeToken('octo:s:f:d_race', { docId: 'd_race' })
    const replacement = getCollabTokenEntry('octo:s:f:d_race', 'd_race')
    await Promise.resolve()

    resolvers[1](tokenResponse('writer', 2, 'jwt-fresh'))
    await expect(replacement).resolves.toMatchObject({ token: 'jwt-fresh' })
    resolvers[0](tokenResponse('writer', 1, 'jwt-stale'))
    await expect(stale).rejects.toThrow(/disposed/)

    expect(await getCollabToken('octo:s:f:d_race', 'd_race')).toBe('jwt-fresh')
    expect(api.calls.filter((c) => c.url === '/docs/d_race/collab-token')).toHaveLength(2)
  })
})
