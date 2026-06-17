import { describe, it, expect, beforeEach } from 'vitest'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import { acceptInvite } from './api.ts'

let api: MockApiClient

beforeEach(() => {
  const wk = createMockWKApp()
  api = wk.apiClient
  setWKApp(wk)
})

function httpError(status: number, body?: unknown) {
  return { response: { status, data: body } }
}

describe('acceptInvite response -> UI state mapping', () => {
  it('200 -> entered with docId/documentName/role (branches a/b/c/d)', async () => {
    api.responder = () => ({
      data: { docId: 'd_1', documentName: 'octo:s:f:d_1', role: 'writer' },
      status: 200,
    })
    const r = await acceptInvite('tok')
    expect(r).toEqual({
      status: 'entered',
      docId: 'd_1',
      documentName: 'octo:s:f:d_1',
      role: 'writer',
    })
  })

  it('401 login_required -> login-required', async () => {
    api.responder = () => {
      throw httpError(401, { error: 'login_required' })
    }
    expect(await acceptInvite('tok')).toEqual({ status: 'login-required' })
  })

  it('410 invite_invalid -> invalid (terminal)', async () => {
    api.responder = () => {
      throw httpError(410, { error: 'invite_invalid' })
    }
    expect(await acceptInvite('tok')).toEqual({ status: 'invalid' })
  })

  it('rethrows other errors', async () => {
    api.responder = () => {
      throw httpError(500, { error: 'boom' })
    }
    await expect(acceptInvite('tok')).rejects.toBeTruthy()
  })

  it('posts to the bare-relative accept path', async () => {
    api.responder = () => ({ data: { docId: 'd', documentName: 'octo:s:f:d', role: 'reader' }, status: 200 })
    await acceptInvite('tok123')
    expect(api.calls[0]).toMatchObject({ method: 'post', url: '/docs/invites/tok123/accept' })
  })
})
