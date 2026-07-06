import { describe, it, expect, beforeEach } from 'vitest'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import {
  listDocs,
  createDoc,
  getDoc,
  getUserName,
  updateDocTitle,
  deleteDoc,
  classifyDeleteStatus,
  deleteErrorKey,
} from './docsApi.ts'

let api: MockApiClient

beforeEach(() => {
  const wk = createMockWKApp()
  api = wk.apiClient
  setWKApp(wk)
})

describe('docs list/create API (bare-relative /docs)', () => {
  it('lists docs via GET /docs with query params', async () => {
    api.responder = () => ({
      data: {
        total: 1,
        items: [{ docId: 'd_real', title: 'CollabDoc1', ownerId: 'u0', role: 'admin', updatedAt: 't' }],
      },
      status: 200,
    })
    const res = await listDocs({ spaceId: 'sp1', folderId: 'f_default', sort: 'updatedAt:desc' })
    expect(res.items).toHaveLength(1)
    expect(res.items[0].docId).toBe('d_real')
    const call = api.calls.at(-1)!
    expect(call.method).toBe('get')
    expect(call.url).toContain('/docs?')
    expect(call.url).toContain('spaceId=sp1')
    expect(call.url).toContain('folderId=f_default')
    expect(call.url).toContain('sort=updatedAt%3Adesc')
  })

  it('omits the query string when no params are passed', async () => {
    api.responder = () => ({ data: { total: 0, items: [] }, status: 200 })
    await listDocs()
    expect(api.calls.at(-1)!.url).toBe('/docs')
  })

  it('creates a doc via POST /docs and returns the new docId', async () => {
    api.responder = () => ({
      data: {
        docId: 'd_new',
        documentName: 'octo:sp1:f_default:d_new',
        title: 'Untitled document',
        spaceId: 'sp1',
        folderId: 'f_default',
        ownerId: 'u0',
        role: 'admin',
      },
      status: 201,
    })
    const created = await createDoc({ title: 'Untitled document', spaceId: 'sp1' })
    expect(created.docId).toBe('d_new')
    const call = api.calls.at(-1)!
    expect(call.method).toBe('post')
    expect(call.url).toBe('/docs')
    expect((call.body as { title: string }).title).toBe('Untitled document')
  })

  it('fetches a single doc via GET /docs/{docId}', async () => {
    api.responder = () => ({
      data: { docId: 'd_real', title: 'Real Title', ownerId: 'u0', role: 'admin' },
      status: 200,
    })
    const meta = await getDoc('d_real')
    expect(meta.title).toBe('Real Title')
    const call = api.calls.at(-1)!
    expect(call.method).toBe('get')
    expect(call.url).toBe('/docs/d_real')
  })

  it('sends NO explicit X-Space-Id header for the in-shell getDoc (no spaceId) — the global interceptor still handles it', async () => {
    api.responder = () => ({ data: { docId: 'd_real', title: 'Real Title' }, status: 200 })
    await getDoc('d_real')
    const call = api.calls.at(-1)!
    // Unchanged behavior: no per-request config header — the global spaceIdCallback interceptor
    // injects X-Space-Id from the live currentSpaceId, exactly as before.
    expect(call.config?.headers?.['X-Space-Id']).toBeUndefined()
  })

  it('carries an explicit X-Space-Id header when getDoc is given a spaceId (standalone by-space preflight)', async () => {
    // Scope: this asserts the DOCS-SIDE contract — getDoc puts the explicit header into the request
    // config. That the header then really reaches the wire (host APIClient forwards config.headers to
    // axios, and the interceptor lets the explicit header win) is covered by the host unit test at
    // packages/dmworkbase/src/Service/__tests__/APIClient.headers.test.ts. Both halves are needed:
    // the mock seam here cannot prove the real host forwards headers (that was the XIN-424 fake-green).
    api.responder = () => ({ data: { docId: 'd_real', title: 'Real Title' }, status: 200 })
    await getDoc('d_real', { spaceId: 'space-abc' })
    const call = api.calls.at(-1)!
    expect(call.url).toBe('/docs/d_real')
    expect(call.config?.headers?.['X-Space-Id']).toBe('space-abc')
  })

  it('does not add a header for an empty spaceId (falls back to interceptor behavior)', async () => {
    api.responder = () => ({ data: { docId: 'd_real', title: 'Real Title' }, status: 200 })
    await getDoc('d_real', { spaceId: '' })
    const call = api.calls.at(-1)!
    expect(call.config?.headers?.['X-Space-Id']).toBeUndefined()
  })

  it('renames a doc via PATCH /docs/{docId} with {title}', async () => {
    api.responder = () => ({
      data: { docId: 'd_real', title: 'New Name' },
      status: 200,
    })
    const meta = await updateDocTitle('d_real', 'New Name')
    expect(meta.title).toBe('New Name')
    const call = api.calls.at(-1)!
    expect(call.method).toBe('patch')
    expect(call.url).toBe('/docs/d_real')
    expect((call.body as { title: string }).title).toBe('New Name')
  })

  it('deletes a doc via DELETE /docs/{docId}', async () => {
    api.responder = () => ({ data: {}, status: 200 })
    await deleteDoc('d_real')
    const call = api.calls.at(-1)!
    expect(call.method).toBe('delete')
    expect(call.url).toBe('/docs/d_real')
  })

  it('propagates the error (with status) when delete fails', async () => {
    api.responder = () => {
      throw { response: { status: 409 } }
    }
    await expect(deleteDoc('d_arch')).rejects.toMatchObject({ response: { status: 409 } })
  })
})

// Delete outcome classification (contract C3 final) — moved to the editor detail page but the
// 200/404/403/409 mapping is unchanged (Problem 4).
describe('classifyDeleteStatus / deleteErrorKey', () => {
  it('maps statuses to outcomes', () => {
    expect(classifyDeleteStatus(404)).toBe('gone')
    expect(classifyDeleteStatus(403)).toBe('forbidden')
    expect(classifyDeleteStatus(409)).toBe('archived')
    expect(classifyDeleteStatus(500)).toBe('failed')
    expect(classifyDeleteStatus(undefined)).toBe('failed')
  })

  it('maps non-success outcomes to i18n error keys', () => {
    expect(deleteErrorKey('forbidden')).toBe('docs.doc.deleteForbidden')
    expect(deleteErrorKey('archived')).toBe('docs.doc.deleteArchived')
    expect(deleteErrorKey('failed')).toBe('docs.doc.deleteFailed')
  })
})

describe('getUserName — creator name resolution + standalone privacy (blocker 5)', () => {
  it('prefers the verified real_name by default (in-shell editor, unchanged behavior)', async () => {
    api.responder = () => ({ data: { name: 'ada_nick', real_name: 'Ada Lovelace' }, status: 200 })
    expect(await getUserName('u_owner')).toBe('Ada Lovelace')
  })

  it('returns the nickname only when preferRealName is false (standalone shared surface)', async () => {
    // Privacy: a /d/:docId link holder must never see the creator's verified legal name.
    api.responder = () => ({ data: { name: 'ada_nick', real_name: 'Ada Lovelace' }, status: 200 })
    expect(await getUserName('u_owner', { preferRealName: false })).toBe('ada_nick')
  })

  it('falls back to the nickname when no real_name exists, in both modes', async () => {
    api.responder = () => ({ data: { name: 'ada_nick' }, status: 200 })
    expect(await getUserName('u_owner')).toBe('ada_nick')
    expect(await getUserName('u_owner', { preferRealName: false })).toBe('ada_nick')
  })

  it('returns undefined when no usable name is present (menu falls back to a short uid)', async () => {
    api.responder = () => ({ data: {}, status: 200 })
    expect(await getUserName('u_owner')).toBeUndefined()
    expect(await getUserName('u_owner', { preferRealName: false })).toBeUndefined()
  })
})
