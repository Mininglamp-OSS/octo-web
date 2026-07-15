import { describe, it, expect, beforeEach } from 'vitest'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import { getShareSettings, setShareSettings } from './api.ts'
import {
  isShareRole,
  isShareScope,
  normalizeShareRole,
  normalizeShareScope,
} from './shareScope.ts'

let api: MockApiClient

beforeEach(() => {
  const wk = createMockWKApp()
  api = wk.apiClient
  setWKApp(wk)
})

describe('share enums — guards + fail-safe normalization', () => {
  it('type guards accept only the wire enum values', () => {
    expect(isShareScope('restricted')).toBe(true)
    expect(isShareScope('anyone_in_space')).toBe(true)
    expect(isShareScope('public')).toBe(false)
    expect(isShareRole('read')).toBe(true)
    expect(isShareRole('edit')).toBe(true)
    expect(isShareRole('admin')).toBe(false)
  })

  it('coerces any unexpected value to the most-restrictive default (restricted/read)', () => {
    expect(normalizeShareScope('anyone_in_space')).toBe('anyone_in_space')
    expect(normalizeShareScope('bogus')).toBe('restricted')
    expect(normalizeShareScope(undefined)).toBe('restricted')
    expect(normalizeShareScope(1)).toBe('restricted')
    expect(normalizeShareRole('edit')).toBe('edit')
    expect(normalizeShareRole('bogus')).toBe('read')
    expect(normalizeShareRole(null)).toBe('read')
  })
})

describe('share API — bare-relative paths + contract (#64)', () => {
  it('GET /docs/{id}/share returns normalized settings', async () => {
    api.responder = () => ({
      data: { docId: 'd_1', shareScope: 'anyone_in_space', shareRole: 'edit' },
      status: 200,
    })
    const s = await getShareSettings('d_1')
    expect(api.calls[0]).toMatchObject({ method: 'get', url: '/docs/d_1/share' })
    expect(s).toEqual({ shareScope: 'anyone_in_space', shareRole: 'edit' })
  })

  it('GET normalizes an unexpected body down to restricted/read', async () => {
    api.responder = () => ({ data: { shareScope: 'weird', shareRole: 99 }, status: 200 })
    expect(await getShareSettings('d_1')).toEqual({ shareScope: 'restricted', shareRole: 'read' })
  })

  it('PUT anyone_in_space sends the chosen role in the body', async () => {
    api.responder = () => ({
      data: { docId: 'd_1', shareScope: 'anyone_in_space', shareRole: 'edit' },
      status: 200,
    })
    const s = await setShareSettings('d_1', 'anyone_in_space', 'edit')
    expect(api.calls[0]).toMatchObject({
      method: 'put',
      url: '/docs/d_1/share',
      body: { shareScope: 'anyone_in_space', shareRole: 'edit' },
    })
    expect(s).toEqual({ shareScope: 'anyone_in_space', shareRole: 'edit' })
  })

  it('PUT anyone_in_space with no role defaults to read (avoids 400 invalid_role)', async () => {
    api.responder = () => ({ data: { shareScope: 'anyone_in_space', shareRole: 'read' }, status: 200 })
    await setShareSettings('d_1', 'anyone_in_space')
    expect(api.calls[0].body).toEqual({ shareScope: 'anyone_in_space', shareRole: 'read' })
  })

  it('PUT restricted omits the role (backend force-persists read)', async () => {
    api.responder = () => ({ data: { shareScope: 'restricted', shareRole: 'read' }, status: 200 })
    const s = await setShareSettings('d_1', 'restricted', 'edit')
    expect(api.calls[0].body).toEqual({ shareScope: 'restricted' })
    expect(s).toEqual({ shareScope: 'restricted', shareRole: 'read' })
  })

  it('settles on the canonical response even when it differs from what was sent', async () => {
    // Backend ignores an edit role on restricted and returns read — the UI must follow the response.
    api.responder = () => ({ data: { shareScope: 'restricted', shareRole: 'read' }, status: 200 })
    expect(await setShareSettings('d_1', 'restricted')).toEqual({
      shareScope: 'restricted',
      shareRole: 'read',
    })
  })

  it('propagates a PUT failure to the caller (for rollback)', async () => {
    api.responder = () => {
      throw { response: { status: 400, data: { error: 'invalid_role' } } }
    }
    await expect(setShareSettings('d_1', 'anyone_in_space', 'read')).rejects.toBeTruthy()
  })
})
