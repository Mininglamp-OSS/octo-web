import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import {
  presignUpload,
  uploadBinary,
  getReadUrl,
  uploadImage,
  resolveAttachments,
  AttachmentRejectedError,
  type PresignResult,
} from './api.ts'

let api: MockApiClient

const PRESIGN: PresignResult = {
  attachId: 'att_99',
  objectKey: 'docs/d_1/att_99',
  bucket: 'octo-assets',
  mime: 'image/png',
  sizeBytes: 3,
  uploadUrl: 'https://storage.octo.example.com/put/att_99?sig=abc',
  headers: { 'x-amz-meta-octo': '1' },
  expiresInSec: 300,
}

beforeEach(() => {
  const wk = createMockWKApp()
  api = wk.apiClient
  setWKApp(wk)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('attachment API — bare-relative docs paths (frontend-design §3.5)', () => {
  it('presignUpload POSTs to /docs/{docId}/attachments/presign with the file metadata', async () => {
    api.responder = () => ({ data: PRESIGN, status: 200 })
    const res = await presignUpload('d_1', { fileName: 'x.png', mime: 'image/png', sizeBytes: 3 })
    expect(res.attachId).toBe('att_99')
    expect(api.calls[0]).toMatchObject({
      method: 'post',
      url: '/docs/d_1/attachments/presign',
      body: { fileName: 'x.png', mime: 'image/png', sizeBytes: 3 },
    })
  })

  it('maps a 400 presign rejection to AttachmentRejectedError carrying the reason', async () => {
    api.responder = () => {
      throw { response: { status: 400, data: { error: 'size_too_large' } } }
    }
    await expect(
      presignUpload('d_1', { fileName: 'big.png', mime: 'image/png', sizeBytes: 1 }),
    ).rejects.toMatchObject({ name: 'AttachmentRejectedError', reason: 'size_too_large' })
  })

  it('getReadUrl GETs /docs/{docId}/attachments/{attachId} and returns the signed url', async () => {
    api.responder = () => ({
      data: {
        attachId: 'att_99',
        objectKey: 'k',
        mime: 'image/png',
        sizeBytes: 3,
        url: 'https://assets.octo.example.com/att_99?sig=z',
        expiresInSec: 300,
      },
      status: 200,
    })
    const read = await getReadUrl('d_1', 'att_99')
    expect(read.url).toBe('https://assets.octo.example.com/att_99?sig=z')
    expect(api.calls[0]).toMatchObject({ method: 'get', url: '/docs/d_1/attachments/att_99' })
  })

  it('uploadBinary PUTs raw bytes to the presigned URL with headers + Content-Type, NOT via apiClient', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    await uploadBinary(PRESIGN, file)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(PRESIGN.uploadUrl)
    expect(init.method).toBe('PUT')
    expect(init.body).toBe(file)
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('image/png')
    expect(headers['x-amz-meta-octo']).toBe('1')
    // The cross-origin storage PUT must NOT carry the octo session token.
    expect('token' in headers).toBe(false)
    expect('Authorization' in headers).toBe(false)
    // And it must not be routed through apiClient.
    expect(api.calls).toHaveLength(0)
  })

  it('uploadBinary throws on a non-2xx storage response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })))
    await expect(uploadBinary(PRESIGN, new Blob(['x']))).rejects.toThrow(/403/)
  })
})

describe('uploadImage — end-to-end flow yields attachId + signed src, never base64', () => {
  it('sends SVG bytes to the dedicated validated endpoint (including empty browser MIME)', async () => {
    api.responder = () => ({ data: { attachId: 'att_svg', url: 'https://assets.octo.example.com/x.svg' }, status: 200 })
    const file = new File(['<svg/>'], 'diagram.svg', { type: '' })
    const result = await uploadImage('d_1', file)

    expect(result).toEqual({ attachId: 'att_svg', src: 'https://assets.octo.example.com/x.svg' })
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0]).toMatchObject({
      method: 'post',
      url: '/docs/d_1/attachments/svg',
      body: file,
    })
    expect(api.calls[0].config?.headers).toMatchObject({
      'Content-Type': 'image/svg+xml',
      'X-File-Name': 'diagram.svg',
    })
  })

  it('does not route a non-SVG MIME to the SVG endpoint merely because the name ends in .svg', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    api.responder = (method, url) => {
      if (method === 'post' && url.endsWith('/attachments/presign')) return { data: PRESIGN, status: 200 }
      return { data: { url: 'https://assets.octo.example.com/x' }, status: 200 }
    }
    await uploadImage('d_1', new File(['png'], 'misleading.svg', { type: 'image/png' }))
    expect(api.calls[0].url).toBe('/docs/d_1/attachments/presign')
  })

  it('presigns, PUTs the bytes, then resolves a display url', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    api.responder = (method, url) => {
      if (method === 'post' && url.endsWith('/attachments/presign')) {
        return { data: PRESIGN, status: 200 }
      }
      // read endpoint
      return {
        data: {
          attachId: 'att_99',
          objectKey: 'k',
          mime: 'image/png',
          sizeBytes: 3,
          url: 'https://assets.octo.example.com/att_99?sig=display',
          expiresInSec: 300,
        },
        status: 200,
      }
    }

    const file = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' })
    const result = await uploadImage('d_1', file)

    expect(result.attachId).toBe('att_99')
    expect(result.src).toBe('https://assets.octo.example.com/att_99?sig=display')
    // The result must never be a base64 data: URL.
    expect(result.src?.startsWith('data:')).toBe(false)
    // Order: presign (POST) then read (GET); the PUT went to storage via fetch.
    expect(api.calls.map((c) => c.method)).toEqual(['post', 'get'])
    expect(fetchMock).toHaveBeenCalledWith(PRESIGN.uploadUrl, expect.objectContaining({ method: 'PUT' }))
  })

  it('returns a null src (not an error) when the display url cannot be resolved yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    api.responder = (method, url) => {
      if (method === 'post' && url.endsWith('/attachments/presign')) {
        return { data: PRESIGN, status: 200 }
      }
      throw { response: { status: 404, data: { error: 'not_found' } } }
    }
    const file = new File([new Uint8Array([1])], 'pic.png', { type: 'image/png' })
    const result = await uploadImage('d_1', file)
    expect(result.attachId).toBe('att_99')
    expect(result.src).toBeNull()
  })
})

// Keep the explicit error type exported for the UI layer.
it('AttachmentRejectedError is an Error subclass', () => {
  expect(new AttachmentRejectedError('mime_blocked')).toBeInstanceOf(Error)
})

describe('resolveAttachments — batch signed-URL resolve (export, RES-1)', () => {
  it('POSTs { attachIds } to /docs/{docId}/attachments/resolve and parses { items, notFound }', async () => {
    api.responder = () => ({
      data: {
        items: [
          {
            attachId: 'att_1',
            url: 'https://assets.octo.example.com/att_1?sig=z',
            expiresInSec: 300,
            mime: 'image/png',
            sizeBytes: 5,
            fileName: 'a.png',
          },
        ],
        notFound: ['att_2'],
      },
      status: 200,
    })
    const res = await resolveAttachments('d_1', ['att_1', 'att_2'])
    expect(api.calls[0]).toMatchObject({
      method: 'post',
      url: '/docs/d_1/attachments/resolve',
      body: { attachIds: ['att_1', 'att_2'] },
    })
    expect(res.items).toHaveLength(1)
    expect(res.items[0].url).toBe('https://assets.octo.example.com/att_1?sig=z')
    expect(res.notFound).toEqual(['att_2'])
  })

  it('maps a 400 (attachIds_too_many / invalid_body) to AttachmentRejectedError', async () => {
    api.responder = () => {
      throw { response: { status: 400, data: { error: 'attachIds_too_many' } } }
    }
    await expect(resolveAttachments('d_1', ['x'])).rejects.toMatchObject({
      name: 'AttachmentRejectedError',
      reason: 'attachIds_too_many',
    })
  })
})
