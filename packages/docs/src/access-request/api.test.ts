import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import {
  requestAccess,
  listPendingAccessRequests,
  approveAccessRequest,
  denyAccessRequest,
  AccessRequestConflictError,
} from './api.ts'

let api: MockApiClient

beforeEach(() => {
  const wk = createMockWKApp()
  api = wk.apiClient
  setWKApp(wk)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('access-request API (screen 4c, contract 4 — pull-based, bare-relative paths)', () => {
  it('requestAccess POSTs to /docs/{docId}/access-requests', async () => {
    api.responder = () => ({ data: {}, status: 201 })
    await requestAccess('d_1')
    expect(api.calls[0]).toMatchObject({ method: 'post', url: '/docs/d_1/access-requests' })
  })

  it('surfaces a 409 as AccessRequestConflictError (already requested → not a failure)', async () => {
    api.responder = () => {
      throw { response: { status: 409 } }
    }
    await expect(requestAccess('d_1')).rejects.toBeInstanceOf(AccessRequestConflictError)
  })

  it('rethrows non-409 errors', async () => {
    api.responder = () => {
      throw { response: { status: 500 } }
    }
    await expect(requestAccess('d_1')).rejects.not.toBeInstanceOf(AccessRequestConflictError)
  })

  it('listPendingAccessRequests GETs ?status=pending and returns items (MVP pull, §4.2)', async () => {
    api.responder = () => ({
      data: { items: [{ requestId: 'r1', uid: 'u_a' }, { requestId: 'r2', uid: 'u_b' }] },
      status: 200,
    })
    const items = await listPendingAccessRequests('d_1')
    expect(items).toHaveLength(2)
    expect(api.calls[0]).toMatchObject({
      method: 'get',
      url: '/docs/d_1/access-requests?status=pending',
    })
  })

  it('missing items degrades to an empty list', async () => {
    api.responder = () => ({ data: {}, status: 200 })
    expect(await listPendingAccessRequests('d_1')).toEqual([])
  })

  it('approve POSTs the chosen role to .../approve; deny POSTs to .../deny', async () => {
    api.responder = () => ({ data: {}, status: 200 })
    await approveAccessRequest('d_1', 'r1', 'writer')
    expect(api.calls[0]).toMatchObject({
      method: 'post',
      url: '/docs/d_1/access-requests/r1/approve',
      body: { role: 'writer' },
    })
    await denyAccessRequest('d_1', 'r2')
    expect(api.calls[1]).toMatchObject({
      method: 'post',
      url: '/docs/d_1/access-requests/r2/deny',
    })
  })
})
