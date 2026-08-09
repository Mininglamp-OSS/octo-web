import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import {
  createPptDoc,
  isPptTemplate,
  MissingEditorUrlError,
  newIdempotencyKey,
  PPT_TEMPLATES,
  PPT_TITLE_MAX,
} from './createPptTask.ts'

describe('createPptTask', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes exactly the four fixed v1 templates', () => {
    expect(PPT_TEMPLATES).toEqual(['blank', 'pitch', 'report', 'lesson'])
    expect(isPptTemplate('pitch')).toBe(true)
    expect(isPptTemplate('nope')).toBe(false)
  })

  it('newIdempotencyKey returns a non-empty, unique-per-call key', () => {
    const a = newIdempotencyKey()
    const b = newIdempotencyKey()
    expect(a.length).toBeGreaterThan(0)
    expect(a).not.toBe(b)
  })

  describe('createPptDoc', () => {
    beforeEach(() => {
      const wk = createMockWKApp()
      setWKApp(wk)
    })

    it('POSTs to /ppt/docs with the template body and the Idempotency-Key header', async () => {
      const wk = createMockWKApp()
      wk.apiClient.responder = (_m, url) => {
        if (url === '/ppt/docs') {
          return { data: { data: { editorUrl: '/ppt/d/deck_1', docId: 'deck_1' } }, status: 201 }
        }
        return { data: {}, status: 200 }
      }
      setWKApp(wk)

      const result = await createPptDoc({
        title: 'Q3 review',
        templateId: 'report',
        folderId: 'f_1',
        idempotencyKey: 'key-abc',
      })

      expect(result.editorUrl).toBe('/ppt/d/deck_1')
      expect(result.docId).toBe('deck_1')
      const call = wk.apiClient.calls.find((c) => c.url === '/ppt/docs')
      expect(call).toBeTruthy()
      expect(call?.method).toBe('post')
      expect(call?.body).toEqual({ title: 'Q3 review', templateId: 'report', folderId: 'f_1' })
      expect(call?.config?.headers?.['Idempotency-Key']).toBe('key-abc')
    })

    it('omits folderId from the body when not provided', async () => {
      const wk = createMockWKApp()
      wk.apiClient.responder = () => ({ data: { data: { editorUrl: '/ppt/d/x' } }, status: 201 })
      setWKApp(wk)
      await createPptDoc({ title: 'T', templateId: 'blank', idempotencyKey: 'k' })
      const call = wk.apiClient.calls.find((c) => c.url === '/ppt/docs')
      expect(call?.body).toEqual({ title: 'T', templateId: 'blank' })
      expect((call?.body as Record<string, unknown>).folderId).toBeUndefined()
    })

    it('reads editorUrl from a flat (un-enveloped) body too', async () => {
      const wk = createMockWKApp()
      wk.apiClient.responder = () => ({ data: { editorUrl: '/ppt/d/flat' }, status: 201 })
      setWKApp(wk)
      const result = await createPptDoc({ title: 'T', templateId: 'pitch', idempotencyKey: 'k' })
      expect(result.editorUrl).toBe('/ppt/d/flat')
    })

    it('throws MissingEditorUrlError when a 201 carries no editorUrl (never fabricates a route)', async () => {
      const wk = createMockWKApp()
      wk.apiClient.responder = () => ({ data: { data: { docId: 'deck_2' } }, status: 201 })
      setWKApp(wk)
      await expect(
        createPptDoc({ title: 'T', templateId: 'lesson', idempotencyKey: 'k' }),
      ).rejects.toBeInstanceOf(MissingEditorUrlError)
    })

    it('propagates the API error so the caller can branch on status (400/etc.)', async () => {
      const wk = createMockWKApp()
      wk.apiClient.responder = () => Promise.reject({ response: { status: 400, data: { error: 'VALIDATION_ERROR' } } })
      setWKApp(wk)
      await expect(
        createPptDoc({ title: '', templateId: 'blank', idempotencyKey: 'k' }),
      ).rejects.toMatchObject({ response: { status: 400 } })
    })

    it('a retry reusing the same key sends the same Idempotency-Key (no duplicate deck)', async () => {
      const wk = createMockWKApp()
      let attempt = 0
      wk.apiClient.responder = () => {
        attempt += 1
        if (attempt === 1) return Promise.reject({ response: { status: 500 } })
        return { data: { data: { editorUrl: '/ppt/d/deck_9' } }, status: 201 }
      }
      setWKApp(wk)

      const key = 'stable-key'
      await expect(
        createPptDoc({ title: 'Deck', templateId: 'blank', idempotencyKey: key }),
      ).rejects.toBeTruthy()
      const ok = await createPptDoc({ title: 'Deck', templateId: 'blank', idempotencyKey: key })
      expect(ok.editorUrl).toBe('/ppt/d/deck_9')

      const keys = wk.apiClient.calls
        .filter((c) => c.url === '/ppt/docs')
        .map((c) => c.config?.headers?.['Idempotency-Key'])
      expect(keys).toEqual([key, key])
    })
  })

  it('caps the client title pre-check at a sane bound', () => {
    expect(PPT_TITLE_MAX).toBeGreaterThan(0)
  })
})
