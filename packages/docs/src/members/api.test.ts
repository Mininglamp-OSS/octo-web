import { describe, it, expect, beforeEach } from 'vitest'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import {
  addOrUpdateMember,
  removeMember,
  listMembers,
  canRemoveMember,
  UserNotFoundError,
  type Member,
} from './api.ts'
import { canManage, canEdit } from '../auth/roles.ts'

let api: MockApiClient

beforeEach(() => {
  const wk = createMockWKApp()
  api = wk.apiClient
  setWKApp(wk)
})

describe('role capability matrix (frontend-design §7.5)', () => {
  it('canEdit = writer || admin', () => {
    expect(canEdit('reader')).toBe(false)
    expect(canEdit('writer')).toBe(true)
    expect(canEdit('admin')).toBe(true)
  })
  it('canManage = admin only', () => {
    expect(canManage('reader')).toBe(false)
    expect(canManage('writer')).toBe(false)
    expect(canManage('admin')).toBe(true)
  })
})

describe('member API — bare-relative paths + user_not_found', () => {
  it('lists members via GET /docs/{docId}/members', async () => {
    api.responder = () => ({
      data: { items: [{ uid: 'u1', role: 'writer', source: 'direct', grantedBy: 'u0' }] },
      status: 200,
    })
    const members = await listMembers('d_1')
    expect(members).toHaveLength(1)
    expect(api.calls[0]).toMatchObject({ method: 'get', url: '/docs/d_1/members' })
  })

  it('PUT add/update uses bare-relative path and body', async () => {
    api.responder = () => ({ data: { ok: true }, status: 200 })
    await addOrUpdateMember('d_1', 'u9', 'writer')
    expect(api.calls[0]).toMatchObject({
      method: 'put',
      url: '/docs/d_1/members',
      body: { uid: 'u9', role: 'writer' },
    })
  })

  it('surfaces 404 user_not_found as UserNotFoundError', async () => {
    api.responder = () => {
      throw { response: { status: 404, data: { error: 'user_not_found' } } }
    }
    await expect(addOrUpdateMember('d_1', 'ghost', 'reader')).rejects.toBeInstanceOf(UserNotFoundError)
  })

  it('rethrows other 404s that are not user_not_found', async () => {
    api.responder = () => {
      throw { response: { status: 404, data: { error: 'doc_not_found' } } }
    }
    await expect(addOrUpdateMember('d_1', 'u', 'reader')).rejects.not.toBeInstanceOf(UserNotFoundError)
  })

  it('DELETE removes via /docs/{docId}/members/{uid}', async () => {
    api.responder = () => ({ data: { ok: true }, status: 200 })
    await removeMember('d_1', 'u9')
    expect(api.calls[0]).toMatchObject({ method: 'delete', url: '/docs/d_1/members/u9' })
  })
})

describe('canRemoveMember — owner row disabled', () => {
  const owner: Member = { uid: 'u_owner', role: 'admin', source: 'direct', grantedBy: 'u_owner' }
  const other: Member = { uid: 'u_other', role: 'writer', source: 'direct', grantedBy: 'u_owner' }
  it('owner cannot be removed', () => {
    expect(canRemoveMember(owner, 'u_owner')).toBe(false)
  })
  it('non-owner can be removed', () => {
    expect(canRemoveMember(other, 'u_owner')).toBe(true)
  })
})
