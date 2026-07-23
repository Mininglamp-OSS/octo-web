import { afterEach, describe, expect, it, vi } from 'vitest'

const { resolveAttachments } = vi.hoisted(() => ({ resolveAttachments: vi.fn() }))
vi.mock('../../attachments/api.ts', () => ({ resolveAttachments }))

import { fetchBoardFileBinaries } from '../boardFiles.ts'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect fill="#ffff00" width="40" height="40"/></svg>'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('board file rehydration', () => {
  it('reopens a stored SVG as an SVG data URL and native SVG MIME', async () => {
    resolveAttachments.mockResolvedValue({
      items: [{ attachId: 'att-svg', url: 'https://blob.test/a.svg', mime: 'image/svg+xml' }],
      notFound: [],
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob([SVG], { type: 'image/svg+xml' }),
    })))

    const [file] = await fetchBoardFileBinaries('board-1', [{
      id: 'file-svg', attachId: 'att-svg', mimeType: 'image/svg+xml',
    }])

    expect(file.id).toBe('file-svg')
    expect(file.mimeType).toBe('image/svg+xml')
    expect(file.dataURL).toMatch(/^data:image\/svg\+xml;base64,/)
    const dataURL = file.dataURL
    expect(dataURL).toBeDefined()
    expect(atob(dataURL!.slice(dataURL!.indexOf(',') + 1))).toContain('fill="#ffff00"')
  })
})
