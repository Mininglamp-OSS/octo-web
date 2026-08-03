import { beforeEach, describe, expect, it } from 'vitest'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import { setWKApp } from '../octoweb/index.ts'
import { importDocx, importMarkdown, MAX_MARKDOWN_IMPORT_BYTES } from './docsApi.ts'

let api: MockApiClient

function upload(bytes: Uint8Array): Pick<File, 'size' | 'arrayBuffer'> {
  return {
    size: bytes.byteLength,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  }
}

beforeEach(() => {
  const wk = createMockWKApp()
  api = wk.apiClient
  setWKApp(wk)
})

describe('authoritative backend Markdown import API', () => {
  it('POSTs bounded UTF-8 bytes through the authenticated host client and returns PM warnings', async () => {
    api.responder = () => ({
      status: 200,
      data: { doc: { type: 'doc', content: [{ type: 'paragraph' }] }, warnings: ['w1'] },
    })
    const bytes = new TextEncoder().encode('# 标题')
    const result = await importMarkdown('d /1', upload(bytes))

    expect(result.warnings).toEqual(['w1'])
    const call = api.calls.at(-1)!
    expect(call.method).toBe('post')
    expect(call.url).toBe('/docs/d%20%2F1/import/markdown')
    expect(Array.from(new Uint8Array(call.body as ArrayBuffer))).toEqual(Array.from(bytes))
    expect(call.config).toEqual({
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'X-Octo-Import-Apply': 'true',
      },
      timeout: 120_000,
    })
  })

  it('rejects empty, oversized, and invalid UTF-8 input before making a request', async () => {
    await expect(importMarkdown('d1', upload(new Uint8Array()))).rejects.toThrow('empty_upload')
    await expect(importMarkdown('d1', {
      size: MAX_MARKDOWN_IMPORT_BYTES + 1,
      arrayBuffer: async () => new ArrayBuffer(0),
    })).rejects.toThrow('doc_too_large')
    await expect(importMarkdown('d1', upload(new Uint8Array([0xc3, 0x28])))).rejects.toThrow('invalid_utf8')
    expect(api.calls).toHaveLength(0)
  })

  it('propagates backend status and error body for UI error mapping', async () => {
    api.responder = () => { throw { response: { status: 422, data: { error: 'import_failed' } } } }
    await expect(importMarkdown('d1', upload(new TextEncoder().encode('x')))).rejects.toMatchObject({
      response: { status: 422, data: { error: 'import_failed' } },
    })
  })

  it('requests atomic backend apply for DOCX and accepts a response without doc', async () => {
    api.responder = () => ({ status: 200, data: { warnings: ['degraded'] } })
    const result = await importDocx('doc / 2', new File([new Uint8Array(2_000_000)], 'large.docx'))

    expect(result).toEqual({ warnings: ['degraded'] })
    const call = api.calls.at(-1)!
    expect(call.url).toBe('/docs/doc%20%2F%202/import/docx')
    expect(call.config).toEqual({
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'X-Octo-Import-Apply': 'true',
      },
      timeout: 120_000,
    })
  })

  it('propagates DOCX atomic apply failures', async () => {
    api.responder = () => { throw new Error('storage_failed') }
    await expect(importDocx('d1', new File(['zip'], 'x.docx'))).rejects.toThrow('storage_failed')
  })

})
