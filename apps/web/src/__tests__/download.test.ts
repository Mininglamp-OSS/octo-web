import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { downloadFile, fallbackAnchorDownload, BLOB_DOWNLOAD_SIZE_LIMIT } from '../../../../packages/dmworkbase/src/Utils/download'

// Track anchors created by download functions
let clickedAnchors: HTMLAnchorElement[] = []
const originalCreateElement = document.createElement.bind(document)

beforeEach(() => {
    clickedAnchors = []
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: any) => {
        const el = originalCreateElement(tag, options)
        if (tag === 'a') {
            vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {})
            clickedAnchors.push(el as HTMLAnchorElement)
        }
        return el
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/fake-blob-id')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

function mockFetchSuccess(body: Uint8Array, headers?: Record<string, string>) {
    const headersObj = new Headers(headers)
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(body)
            controller.close()
        }
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        headers: headersObj,
        body: stream,
        blob: () => Promise.resolve(new Blob([body])),
    } as Response)
}

function mockFetchNullBody(blob: Blob, headers?: Record<string, string>) {
    const headersObj = new Headers(headers)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        headers: headersObj,
        body: null,
        blob: () => Promise.resolve(blob),
    } as unknown as Response)
}

function mockFetchError() {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))
}

function mockFetchHttpError() {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
    } as Response)
}

describe('BLOB_DOWNLOAD_SIZE_LIMIT', () => {
    it('should default to 500 MB', () => {
        expect(BLOB_DOWNLOAD_SIZE_LIMIT).toBe(500 * 1024 * 1024)
    })
})

describe('downloadFile', () => {
    describe('same-origin detection', () => {
        it('should use direct anchor download for same-origin URLs (no fetch)', async () => {
            const fetchSpy = vi.spyOn(globalThis, 'fetch')

            await downloadFile(`${window.location.origin}/files/doc.pdf`, 'doc.pdf')

            expect(fetchSpy).not.toHaveBeenCalled()
            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('doc.pdf')
            expect(clickedAnchors[0].href).toBe(`${window.location.origin}/files/doc.pdf`)
        })

        it('should use fetch+Blob for cross-origin URLs', async () => {
            const data = new TextEncoder().encode('hello world')
            mockFetchSuccess(data, { 'Content-Length': String(data.length) })

            await downloadFile('https://cdn.example.com/abc123_file.txt', 'file.txt')

            expect(globalThis.fetch).toHaveBeenCalledWith('https://cdn.example.com/abc123_file.txt')
            expect(URL.createObjectURL).toHaveBeenCalled()
            expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/fake-blob-id')
            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('file.txt')
            expect(clickedAnchors[0].href).toBe('blob:http://localhost/fake-blob-id')
        })
    })

    describe('URL resolution', () => {
        it('should resolve /path relative URLs as same-origin', async () => {
            const fetchSpy = vi.spyOn(globalThis, 'fetch')

            await downloadFile('/api/file/123', 'doc.pdf')

            expect(fetchSpy).not.toHaveBeenCalled()
            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('doc.pdf')
            expect(clickedAnchors[0].href).toBe(`${window.location.origin}/api/file/123`)
        })

        it('should resolve ./path relative URLs as same-origin', async () => {
            const fetchSpy = vi.spyOn(globalThis, 'fetch')

            await downloadFile('./files/doc.pdf', 'doc.pdf')

            expect(fetchSpy).not.toHaveBeenCalled()
            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('doc.pdf')
        })

        it('should resolve ../path relative URLs as same-origin', async () => {
            const fetchSpy = vi.spyOn(globalThis, 'fetch')

            await downloadFile('../files/doc.pdf', 'doc.pdf')

            expect(fetchSpy).not.toHaveBeenCalled()
            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('doc.pdf')
        })

        it('should resolve bare path relative URLs as same-origin', async () => {
            const fetchSpy = vi.spyOn(globalThis, 'fetch')

            await downloadFile('api/file/123', 'doc.pdf')

            expect(fetchSpy).not.toHaveBeenCalled()
            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('doc.pdf')
        })
    })

    describe('cross-origin fetch+Blob', () => {
        it('should download via fetch+Blob and set correct filename', async () => {
            const data = new TextEncoder().encode('hello world')
            mockFetchSuccess(data, { 'Content-Length': String(data.length) })

            await downloadFile('https://cdn.example.com/abc123_file.txt', 'file.txt')

            expect(globalThis.fetch).toHaveBeenCalledWith('https://cdn.example.com/abc123_file.txt')
            expect(URL.createObjectURL).toHaveBeenCalled()
            expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/fake-blob-id')
            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('file.txt')
            expect(clickedAnchors[0].href).toBe('blob:http://localhost/fake-blob-id')
        })

        it('should fallback to anchor-click on fetch error', async () => {
            mockFetchError()

            await downloadFile('https://cdn.example.com/file.pdf', 'report.pdf')

            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('report.pdf')
            expect(clickedAnchors[0].href).toBe('https://cdn.example.com/file.pdf')
            // Cross-origin fallback should open in new tab to avoid navigating away
            expect(clickedAnchors[0].target).toBe('_blank')
            expect(clickedAnchors[0].rel).toBe('noopener')
        })

        it('should fallback to anchor-click on HTTP error', async () => {
            mockFetchHttpError()

            await downloadFile('https://cdn.example.com/file.pdf', 'report.pdf')

            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('report.pdf')
        })
    })

    describe('size limit enforcement', () => {
        it('should skip fetch for large files when fileSize is provided', async () => {
            const fetchSpy = vi.spyOn(globalThis, 'fetch')

            await downloadFile('https://cdn.example.com/big.zip', 'big.zip', {
                fileSize: BLOB_DOWNLOAD_SIZE_LIMIT + 1,
            })

            expect(fetchSpy).not.toHaveBeenCalled()
            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('big.zip')
        })

        it('should fallback when Content-Length exceeds limit', async () => {
            const headersObj = new Headers({ 'Content-Length': '600000000' })
            const cancelMock = vi.fn().mockResolvedValue(undefined)
            const stream = { cancel: cancelMock, getReader: vi.fn() }
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                headers: headersObj,
                body: stream as any,
            } as Response)

            await downloadFile('https://cdn.example.com/huge.bin', 'huge.bin')

            expect(cancelMock).toHaveBeenCalled()
            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('huge.bin')
        })

        it('should handle Content-Length exceeds limit with null body', async () => {
            const headersObj = new Headers({ 'Content-Length': '600000000' })
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                headers: headersObj,
                body: null,
            } as unknown as Response)

            // Should NOT throw TypeError
            await downloadFile('https://cdn.example.com/huge.bin', 'huge.bin')

            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('huge.bin')
        })

        it('should abort when streaming byte count exceeds limit', async () => {
            const cancelMock = vi.fn().mockResolvedValue(undefined)
            const testLimit = 1024
            let readCount = 0
            const bigChunk = new Uint8Array(testLimit + 1)
            const reader = {
                read: vi.fn().mockImplementation(() => {
                    readCount++
                    if (readCount === 1) {
                        return Promise.resolve({ done: false, value: bigChunk })
                    }
                    return Promise.resolve({ done: true, value: undefined })
                }),
                cancel: cancelMock,
            }
            const stream = {
                getReader: () => reader,
                cancel: vi.fn(),
            }
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                headers: new Headers(),
                body: stream as any,
            } as Response)

            await downloadFile('https://cdn.example.com/big.bin', 'big.bin', {
                sizeLimit: testLimit,
            })

            expect(cancelMock).toHaveBeenCalled()
            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('big.bin')
        })

        it('should use resp.blob() fallback when body is null and blob is small', async () => {
            const blob = new Blob([new Uint8Array(1024)])
            mockFetchNullBody(blob)

            await downloadFile('https://cdn.example.com/small.bin', 'small.bin')

            expect(URL.createObjectURL).toHaveBeenCalled()
            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('small.bin')
            expect(clickedAnchors[0].href).toBe('blob:http://localhost/fake-blob-id')
        })

        it('should fallback when body is null and blob exceeds limit', async () => {
            const testLimit = 1024
            const oversizedBlob = new Blob([new Uint8Array(testLimit + 1)])
            mockFetchNullBody(oversizedBlob)

            await downloadFile('https://cdn.example.com/huge.bin', 'huge.bin', {
                sizeLimit: testLimit,
            })

            // Should use anchor fallback, not blob URL
            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('huge.bin')
            expect(clickedAnchors[0].href).toBe('https://cdn.example.com/huge.bin')
        })

        it('should respect custom sizeLimit parameter', async () => {
            const fetchSpy = vi.spyOn(globalThis, 'fetch')

            await downloadFile('https://cdn.example.com/file.bin', 'file.bin', {
                fileSize: 2000,
                sizeLimit: 1000,
            })

            expect(fetchSpy).not.toHaveBeenCalled()
            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('file.bin')
        })

        it('should allow download when fileSize is within custom sizeLimit', async () => {
            const data = new TextEncoder().encode('small')
            mockFetchSuccess(data, { 'Content-Length': String(data.length) })

            await downloadFile('https://cdn.example.com/file.bin', 'file.bin', {
                fileSize: 500,
                sizeLimit: 1000,
            })

            expect(globalThis.fetch).toHaveBeenCalled()
            expect(URL.createObjectURL).toHaveBeenCalled()
        })
    })

    describe('safety', () => {
        it('should not fetch or navigate for unsafe URLs', async () => {
            const fetchSpy = vi.spyOn(globalThis, 'fetch')

            await downloadFile('javascript:alert(1)', 'evil.txt')

            expect(fetchSpy).not.toHaveBeenCalled()
            expect(clickedAnchors).toHaveLength(0)
        })

        it('should not act on empty URL', async () => {
            const fetchSpy = vi.spyOn(globalThis, 'fetch')

            await downloadFile('', 'file.txt')

            expect(fetchSpy).not.toHaveBeenCalled()
            expect(clickedAnchors).toHaveLength(0)
        })
    })

    describe('callbacks', () => {
        it('should call onProgress with increasing values', async () => {
            const chunk1 = new Uint8Array(30)
            const chunk2 = new Uint8Array(70)
            let readCount = 0
            const reader = {
                read: vi.fn().mockImplementation(() => {
                    readCount++
                    if (readCount === 1) return Promise.resolve({ done: false, value: chunk1 })
                    if (readCount === 2) return Promise.resolve({ done: false, value: chunk2 })
                    return Promise.resolve({ done: true, value: undefined })
                }),
                cancel: vi.fn(),
            }
            const stream = { getReader: () => reader, cancel: vi.fn() }
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                headers: new Headers({ 'Content-Length': '100' }),
                body: stream as any,
            } as Response)

            const progress: number[] = []
            await downloadFile('https://cdn.example.com/f.bin', 'f.bin', {
                onProgress: (pct) => progress.push(pct),
            })

            expect(progress).toEqual([30, 100])
        })

        it('should call onStart before fetch and onEnd after success', async () => {
            const data = new TextEncoder().encode('ok')
            mockFetchSuccess(data)
            const calls: string[] = []

            await downloadFile('https://cdn.example.com/f.txt', 'f.txt', {
                onStart: () => calls.push('start'),
                onEnd: () => calls.push('end'),
            })

            expect(calls).toEqual(['start', 'end'])
        })

        it('should call onEnd even after fetch error', async () => {
            mockFetchError()
            const calls: string[] = []

            await downloadFile('https://cdn.example.com/f.txt', 'f.txt', {
                onStart: () => calls.push('start'),
                onEnd: () => calls.push('end'),
            })

            expect(calls).toEqual(['start', 'end'])
        })

        it('should call onEnd after streaming abort', async () => {
            const testLimit = 1024
            const bigChunk = new Uint8Array(testLimit + 1)
            const reader = {
                read: vi.fn()
                    .mockResolvedValueOnce({ done: false, value: bigChunk })
                    .mockResolvedValue({ done: true, value: undefined }),
                cancel: vi.fn().mockResolvedValue(undefined),
            }
            const stream = { getReader: () => reader, cancel: vi.fn() }
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                headers: new Headers(),
                body: stream as any,
            } as Response)

            const calls: string[] = []
            await downloadFile('https://cdn.example.com/big.bin', 'big.bin', {
                sizeLimit: testLimit,
                onStart: () => calls.push('start'),
                onEnd: () => calls.push('end'),
            })

            expect(calls).toEqual(['start', 'end'])
        })

        it('should not call onStart/onEnd for same-origin downloads', async () => {
            const calls: string[] = []

            await downloadFile(`${window.location.origin}/file.txt`, 'file.txt', {
                onStart: () => calls.push('start'),
                onEnd: () => calls.push('end'),
            })

            expect(calls).toEqual([])
            expect(clickedAnchors).toHaveLength(1)
        })
    })
})

describe('fallbackAnchorDownload', () => {
    it('should set target="_blank" and rel="noopener" for cross-origin URLs', () => {
        fallbackAnchorDownload('https://cdn.example.com/hash_file.pdf', 'file.pdf')

        expect(clickedAnchors).toHaveLength(1)
        expect(clickedAnchors[0].download).toBe('file.pdf')
        expect(clickedAnchors[0].href).toBe('https://cdn.example.com/hash_file.pdf')
        expect(clickedAnchors[0].target).toBe('_blank')
        expect(clickedAnchors[0].rel).toBe('noopener')
    })

    it('should not set target for same-origin URLs', () => {
        fallbackAnchorDownload(`${window.location.origin}/files/doc.pdf`, 'doc.pdf')

        expect(clickedAnchors).toHaveLength(1)
        expect(clickedAnchors[0].download).toBe('doc.pdf')
        expect(clickedAnchors[0].href).toBe(`${window.location.origin}/files/doc.pdf`)
        expect(clickedAnchors[0].target).toBe('')
    })
})
