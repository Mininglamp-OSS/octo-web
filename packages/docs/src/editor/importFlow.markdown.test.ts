import { beforeEach, describe, expect, it, vi } from 'vitest'

const createDoc = vi.fn()
const deleteDoc = vi.fn()
const importMarkdown = vi.fn()
const importDocx = vi.fn()
vi.mock('../pages/docsApi.ts', () => ({
  createDoc: (...args: unknown[]) => createDoc(...args),
  deleteDoc: (...args: unknown[]) => deleteDoc(...args),
  importMarkdown: (...args: unknown[]) => importMarkdown(...args),
  importDocx: (...args: unknown[]) => importDocx(...args),
}))
vi.mock('../attachments/api.ts', () => ({ copyAttachments: vi.fn(), ingestAttachments: vi.fn() }))

import { consumeImportContent, consumeImportWarnings, runDocxImport, runMarkdownImport } from './importFlow.ts'

function choose(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  input.onchange?.(new Event('change'))
}

beforeEach(() => {
  vi.clearAllMocks()
  deleteDoc.mockResolvedValue(undefined)
  sessionStorage.clear()
  document.querySelectorAll('input[type=file]').forEach((input) => input.remove())
})

describe('runMarkdownImport backend flow', () => {
  it('applies an oversized PM-shaped response without stashing content', async () => {
    const events: string[] = []
    createDoc.mockImplementation(async ({ title }: { title: string }) => {
      events.push(`create:${title}`)
      return { docId: 'd_new' }
    })
    importMarkdown.mockImplementation(async (docId: string, file: File) => {
      events.push(`import:${docId}:${file.name}`)
      return {
        doc: { type: 'doc', content: Array.from({ length: 50_000 }, () => ({ type: 'paragraph' })) },
        warnings: ['backend warning'],
      }
    })

    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const pending = runMarkdownImport('sp', 'folder')
    choose(document.querySelector('input[type=file]')!, new File(['# Hello'], 'Hello.md', { type: 'text/markdown' }))
    const result = await pending

    expect(events).toEqual(['create:Hello', 'import:d_new:Hello.md'])
    expect(result).toEqual({ docId: 'd_new', title: 'Hello', warnings: ['backend warning'] })
    expect(consumeImportContent('d_new')).toBeNull()
    expect(sessionStorage.getItem('octo-import-pm-d_new')).toBeNull()
    expect(setItem.mock.calls.some(([key]) => key === 'octo-import-pm-d_new')).toBe(false)
    expect(consumeImportWarnings('d_new')).toEqual(['backend warning'])
  })

  it('keeps concurrent picker file/title pairs race-safe', async () => {
    createDoc.mockImplementation(async ({ title }: { title: string }) => ({ docId: `d_${title}` }))
    importMarkdown.mockImplementation(async (docId: string) => ({
      doc: { type: 'doc', content: [{ type: 'paragraph', attrs: { docId } }] }, warnings: [],
    }))

    const first = runMarkdownImport()
    const second = runMarkdownImport()
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[type=file]')]
    choose(inputs[1]!, new File(['two'], 'Second.markdown'))
    choose(inputs[0]!, new File(['one'], 'First.md'))

    await expect(Promise.all([first, second])).resolves.toEqual([
      { docId: 'd_First', title: 'First', warnings: [] },
      { docId: 'd_Second', title: 'Second', warnings: [] },
    ])
    expect(importMarkdown.mock.calls.map(([docId, file]) => [docId, (file as File).name])).toEqual([
      ['d_Second', 'Second.markdown'],
      ['d_First', 'First.md'],
    ])
  })

  it('propagates apply failure and does not make content available for navigation', async () => {
    createDoc.mockResolvedValue({ docId: 'd_failed' })
    importMarkdown.mockRejectedValue(new Error('yjs_storage_failed'))

    const pending = runMarkdownImport()
    choose(document.querySelector('input[type=file]')!, new File(['large body'], 'Failed.md'))

    await expect(pending).rejects.toThrow('yjs_storage_failed')
    expect(deleteDoc).toHaveBeenCalledOnce()
    expect(deleteDoc).toHaveBeenCalledWith('d_failed')
    expect(sessionStorage.getItem('octo-import-pm-d_failed')).toBeNull()
    expect(sessionStorage.getItem('octo-import-warn-d_failed')).toBeNull()
  })

  it('applies a large DOCX without stashing returned PM content and returns its id', async () => {
    createDoc.mockResolvedValue({ docId: 'd_docx' })
    importDocx.mockResolvedValue({
      doc: { type: 'doc', content: Array.from({ length: 50_000 }, () => ({ type: 'paragraph' })) },
      warnings: [],
    })

    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const pending = runDocxImport()
    choose(document.querySelector('input[type=file]')!, new File([new Uint8Array(2_000_000)], 'Large.docx'))

    await expect(pending).resolves.toEqual({ docId: 'd_docx', title: 'Large', warnings: [] })
    expect(sessionStorage.getItem('octo-import-pm-d_docx')).toBeNull()
    expect(setItem.mock.calls.some(([key]) => key === 'octo-import-pm-d_docx')).toBe(false)
  })

  it('propagates DOCX apply/storage failure', async () => {
    createDoc.mockResolvedValue({ docId: 'd_docx_failed' })
    importDocx.mockRejectedValue(new Error('collab_write_failed'))

    const pending = runDocxImport()
    choose(document.querySelector('input[type=file]')!, new File(['zip'], 'Failed.docx'))

    await expect(pending).rejects.toThrow('collab_write_failed')
    expect(deleteDoc).toHaveBeenCalledOnce()
    expect(deleteDoc).toHaveBeenCalledWith('d_docx_failed')
    expect(sessionStorage.getItem('octo-import-pm-d_docx_failed')).toBeNull()
  })

  it('preserves the import error when cleanup also fails', async () => {
    createDoc.mockResolvedValue({ docId: 'd_cleanup_failed' })
    importMarkdown.mockRejectedValue(new Error('import_failed'))
    deleteDoc.mockRejectedValue(new Error('cleanup_failed'))

    const pending = runMarkdownImport()
    choose(document.querySelector('input[type=file]')!, new File(['body'], 'Failed.md'))

    await expect(pending).rejects.toThrow('import_failed')
    expect(deleteDoc).toHaveBeenCalledWith('d_cleanup_failed')
  })

})
