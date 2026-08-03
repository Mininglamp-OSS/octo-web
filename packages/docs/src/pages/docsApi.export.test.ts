import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockWKApp } from '../octoweb/mock.ts'
import { setWKApp } from '../octoweb/index.ts'
import { exportDocFile } from './docsApi.ts'

describe('authoritative backend document export route', () => {
  const get = vi.fn(async () => ({ data: new ArrayBuffer(4), status: 200 }))
  beforeEach(() => {
    get.mockClear()
    const wk = createMockWKApp()
    wk.apiClient.get = get as typeof wk.apiClient.get
    setWKApp(wk)
  })

  it.each(['md', 'docx', 'pdf'] as const)('requests %s from the unified live-Y.Doc endpoint', async (format) => {
    await exportDocFile('d_1', format)
    expect(get).toHaveBeenCalledWith(`/docs/d_1/export/file?format=${format}`, {
      responseType: 'arraybuffer',
      timeout: 120_000,
    })
  })
})
