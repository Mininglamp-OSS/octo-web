import { describe, it, expect, beforeEach } from 'vitest'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import {
  acceptInvite,
  createInvite,
  listInvites,
  buildInviteUrl,
  expiryFromNow,
  INVITE_EXPIRY_DEFAULT_DAYS,
  INVITE_EXPIRY_MIN_DAYS,
  INVITE_EXPIRY_MAX_DAYS,
} from './api.ts'

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

describe('invite link is built from the front-end origin (#6)', () => {
  it('buildInviteUrl uses window.location.origin + /docs/invite/<token>', () => {
    expect(buildInviteUrl('tok_abc')).toBe(`${window.location.origin}/docs/invite/tok_abc`)
  })

  it('createInvite returns the locally-built url, ignoring any backend url', async () => {
    api.responder = () => ({
      data: { inviteToken: 'tok_new', role: 'writer', url: 'https://backend.example/legacy/tok_new' },
      status: 200,
    })
    const inv = await createInvite('d_1', { role: 'writer' })
    expect(inv.url).toBe(`${window.location.origin}/docs/invite/tok_new`)
    expect(inv.inviteToken).toBe('tok_new')
  })

  it('listInvites re-derives each url from the current origin', async () => {
    api.responder = () => ({
      data: { items: [{ inviteToken: 'tok_1', role: 'reader', url: 'https://stale/tok_1' }] },
      status: 200,
    })
    const items = await listInvites('d_1')
    expect(items[0].url).toBe(`${window.location.origin}/docs/invite/tok_1`)
  })
})

describe('invite expiry (#A6)', () => {
  it('expiryFromNow returns an ISO timestamp the given number of days out', () => {
    const now = Date.parse('2026-06-23T00:00:00.000Z')
    expect(expiryFromNow(3, now)).toBe('2026-06-26T00:00:00.000Z')
  })

  it('clamps the window to 1–7 days', () => {
    const now = Date.parse('2026-06-23T00:00:00.000Z')
    expect(expiryFromNow(0, now)).toBe(expiryFromNow(INVITE_EXPIRY_MIN_DAYS, now))
    expect(expiryFromNow(99, now)).toBe(expiryFromNow(INVITE_EXPIRY_MAX_DAYS, now))
  })

  it('createInvite sends expiresInDays (default 3) and no expiresAt/maxUses', async () => {
    api.responder = () => ({ data: { inviteToken: 'tok_x', role: 'writer' }, status: 200 })
    await createInvite('d_1', { role: 'writer' })
    const body = api.calls[0].body as { expiresAt?: string; expiresInDays?: number; role?: string }
    expect(body.expiresInDays).toBe(INVITE_EXPIRY_DEFAULT_DAYS)
    // PM-decided wire contract: send the integer day count; the backend computes/clamps the
    // absolute expiry. The front end no longer sends expiresAt, nor a maxUses/unlimited default.
    expect('expiresAt' in body).toBe(false)
    expect('maxUses' in body).toBe(false)
  })

  it('createInvite clamps an out-of-range expiresInDays to the 1–7 window', async () => {
    api.responder = () => ({ data: { inviteToken: 'tok_z', role: 'reader' }, status: 200 })
    await createInvite('d_1', { role: 'reader', expiresInDays: 99 })
    const body = api.calls[0].body as { expiresInDays?: number }
    expect(body.expiresInDays).toBe(7)
  })

  it('createInvite honours an explicit expiresInDays', async () => {
    api.responder = () => ({ data: { inviteToken: 'tok_y', role: 'reader' }, status: 200 })
    await createInvite('d_1', { role: 'reader', expiresInDays: 7 })
    const body = api.calls[0].body as { expiresInDays?: number }
    expect(body.expiresInDays).toBe(7)
  })
})
