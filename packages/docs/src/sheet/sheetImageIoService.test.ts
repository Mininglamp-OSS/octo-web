import { beforeEach, describe, expect, it, vi } from 'vitest'

const uploadImage = vi.fn()
vi.mock('../attachments/api.ts', () => ({ uploadImage: (...args: unknown[]) => uploadImage(...args) }))

import { SanitizedSheetImageIoService } from './sheetImageIoService.ts'

const ACTIVE_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>'
const SAFE_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'

describe('SanitizedSheetImageIoService', () => {
  beforeEach(() => {
    uploadImage.mockReset()
    vi.unstubAllGlobals()
  })

  it('stores only the backend-sanitized SVG response in Univer collaborative state', async () => {
    uploadImage.mockResolvedValue({ attachId: 'att_svg', src: 'https://assets.test/safe.svg' })
    const fetchMock = vi.fn(async () => new Response(SAFE_SVG, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const service = new SanitizedSheetImageIoService('d_1')

    const result = await service.saveImage(new File([ACTIVE_SVG], 'active.svg', { type: 'image/svg+xml' }))

    expect(uploadImage).toHaveBeenCalledTimes(1)
    expect(uploadImage.mock.calls[0]![0]).toBe('d_1')
    expect((uploadImage.mock.calls[0]![1] as File).type).toBe('image/svg+xml')
    expect(fetchMock).toHaveBeenCalledWith('https://assets.test/safe.svg', { credentials: 'omit' })
    expect(result?.source).toMatch(/^data:image\/svg\+xml;base64,/)
    const encoded = result!.source.split(',')[1]!
    expect(atob(encoded)).toContain('<rect')
    expect(atob(encoded)).not.toContain('<script')
  })

  it('content-sniffs a mislabeled SVG and still routes it through the sanitizer', async () => {
    uploadImage.mockResolvedValue({ attachId: 'att_svg', src: 'https://assets.test/safe.svg' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(SAFE_SVG, { status: 200 })))
    const service = new SanitizedSheetImageIoService('d_1')

    await service.saveImage(new File([ACTIVE_SVG], 'looks-like.png', { type: 'image/png' }))

    expect(uploadImage).toHaveBeenCalledTimes(1)
  })

  it('keeps raster images on Univer original local base64 path', async () => {
    const service = new SanitizedSheetImageIoService('d_1')
    const result = await service.saveImage(new File([new Uint8Array([137, 80, 78, 71])], 'x.png', { type: 'image/png' }))

    expect(uploadImage).not.toHaveBeenCalled()
    expect(result?.source).toMatch(/^data:image\/png;base64,/)
  })
})
