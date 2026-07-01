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
    expect(tokenCacheKey('u_self', 'octo:s:f:d1')).toBe('u_self::octo:s:f:d1')
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
