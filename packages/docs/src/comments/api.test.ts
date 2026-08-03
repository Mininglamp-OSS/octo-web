import { describe, it, expect, beforeEach } from 'vitest'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import {
  listComments,
  getCommentThread,
  listAllCommentMarkers,
  createRootComment,
  createReply,
  editCommentBody,
  setCommentResolved,
  deleteComment,
  isUnavailableMarkerEndpoint,
} from './api.ts'

let api: MockApiClient

beforeEach(() => {
  const wk = createMockWKApp()
  api = wk.apiClient
  setWKApp(wk)
})

describe('comment API — frozen contract (feature #3 §, backend PR #5)', () => {
  it('lists threads with includeResolved/cursor/limit and maps nested replies', async () => {
    api.responder = () => ({
      data: {
        items: [{ id: 1, parentId: null, body: 'root', replies: [{ id: 2, parentId: 1, body: 'reply' }] }],
        nextCursor: 7,
      },
      status: 200,
    })
    const res = await listComments('d_1', { includeResolved: true, cursor: 5, limit: 25 })
    expect(api.calls[0]).toMatchObject({
      method: 'get',
      url: '/docs/d_1/comments?includeResolved=1&cursor=5&limit=25',
    })
    expect(res.items[0].replies[0].id).toBe(2)
    expect(res.nextCursor).toBe(7)
  })

  it('omits query params and defaults nextCursor to null', async () => {
    api.responder = () => ({ data: { items: [] }, status: 200 })
    const res = await listComments('d_1')
    expect(api.calls[0].url).toBe('/docs/d_1/comments')
    expect(res.nextCursor).toBeNull()
  })

  it('fetches one grouped thread directly for marker navigation', async () => {
    api.responder = () => ({ data: { id: 9, replies: [] }, status: 200 })
    const thread = await getCommentThread('d_1', 9)
    expect(thread.id).toBe(9)
    expect(api.calls[0].url).toBe('/docs/d_1/comments/9/thread')
  })


  it('degrades only missing/conflicting marker endpoints, not auth or network errors', () => {
    expect(isUnavailableMarkerEndpoint({ response: { status: 404 } })).toBe(true)
    expect(isUnavailableMarkerEndpoint({ response: { status: 409 } })).toBe(true)
    expect(isUnavailableMarkerEndpoint({ response: { status: 401 } })).toBe(false)
    expect(isUnavailableMarkerEndpoint(new TypeError('offline'))).toBe(false)
  })

  it('walks every lightweight marker page', async () => {
    api.responder = (_method, url) => {
      const cursor = new URL(url, 'http://local').searchParams.get('cursor')
      return cursor
        ? { data: { items: [{ id: 2, anchorStart: 'Qg==', anchorText: 'b', updatedAt: 'now' }], nextCursor: null }, status: 200 }
        : { data: { items: [{ id: 1, anchorStart: 'QQ==', anchorText: 'a', updatedAt: 'now' }], nextCursor: 1 }, status: 200 }
    }
    const markers = await listAllCommentMarkers('d_1')
    expect(markers.map((item) => item.id)).toEqual([1, 2])
    expect(api.calls.map((call) => call.url)).toEqual([
      '/docs/d_1/comments/markers?limit=100',
      '/docs/d_1/comments/markers?limit=100&cursor=1',
    ])
  })

  it('rejects a repeated or non-advancing marker cursor', async () => {
    api.responder = () => ({ data: { items: [], nextCursor: 1 }, status: 200 })
    await expect(listAllCommentMarkers('d_1')).rejects.toThrow('Invalid comment marker cursor')
    expect(api.calls).toHaveLength(2)
  })

  it('creates a ROOT comment carrying anchors and returns the new id', async () => {
    api.responder = () => ({ data: { id: 11 }, status: 200 })
    const id = await createRootComment('d_1', {
      body: 'hi',
      anchorStart: 'QQ==',
      anchorEnd: 'Qg==',
      anchorText: 'word',
    })
    expect(id).toBe(11)
    expect(api.calls[0]).toMatchObject({
      method: 'post',
      url: '/docs/d_1/comments',
      body: { body: 'hi', anchorStart: 'QQ==', anchorEnd: 'Qg==', anchorText: 'word' },
    })
  })

  it('defaults anchorText to empty string when not supplied on a root create', async () => {
    api.responder = () => ({ data: { id: 1 }, status: 200 })
    await createRootComment('d_1', { body: 'hi', anchorStart: 'a', anchorEnd: 'b' })
    expect((api.calls[0].body as { anchorText: string }).anchorText).toBe('')
  })

  it('creates a REPLY with parentId and NO anchors', async () => {
    api.responder = () => ({ data: { id: 12 }, status: 200 })
    const id = await createReply('d_1', 11, 'reply body')
    expect(id).toBe(12)
    expect(api.calls[0]).toMatchObject({
      method: 'post',
      url: '/docs/d_1/comments',
      body: { body: 'reply body', parentId: 11 },
    })
    expect((api.calls[0].body as Record<string, unknown>).anchorStart).toBeUndefined()
  })

  it('PATCHes a body edit (author branch)', async () => {
    api.responder = () => ({ data: { id: 5 }, status: 200 })
    await editCommentBody('d_1', 5, 'edited')
    expect(api.calls[0]).toMatchObject({
      method: 'patch',
      url: '/docs/d_1/comments/5',
      body: { body: 'edited' },
    })
  })

  it('PATCHes a resolved toggle (writer branch)', async () => {
    api.responder = () => ({ data: { id: 5 }, status: 200 })
    await setCommentResolved('d_1', 5, true)
    expect(api.calls[0]).toMatchObject({
      method: 'patch',
      url: '/docs/d_1/comments/5',
      body: { resolved: true },
    })
  })

  it('soft-deletes (author) without a query flag', async () => {
    api.responder = () => ({ data: { id: 5 }, status: 200 })
    await deleteComment('d_1', 5)
    expect(api.calls[0]).toMatchObject({ method: 'delete', url: '/docs/d_1/comments/5' })
  })

  it('hard-deletes (admin) with ?hard=1', async () => {
    api.responder = () => ({ data: { id: 5 }, status: 200 })
    await deleteComment('d_1', 5, true)
    expect(api.calls[0]).toMatchObject({ method: 'delete', url: '/docs/d_1/comments/5?hard=1' })
  })
})
