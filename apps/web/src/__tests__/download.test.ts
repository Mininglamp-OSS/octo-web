import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { downloadFile, getPresignedDownloadUrl } from '../../../../packages/dmworkbase/src/Utils/download'

import WKApp from '../../../../packages/dmworkbase/src/App'

// Mock WKApp.apiClient
vi.mock('../../../../packages/dmworkbase/src/App', () => ({
    default: {
        apiClient: {
            get: vi.fn(),
        },
    },
}))

// Track anchors created by download functions
let clickedAnchors: HTMLAnchorElement[] = []
let originalCreateElement: typeof document.createElement

beforeEach(() => {
    clickedAnchors = []
    originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: any) => {
        const el = originalCreateElement(tag, options)
        if (tag === 'a') {
            vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {})
            clickedAnchors.push(el as HTMLAnchorElement)
        }
        return el
    })
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('downloadFile', () => {
    describe('same-origin anchor download', () => {
        it('should create anchor with download attribute for same-origin URLs', async () => {
            await downloadFile(`${window.location.origin}/files/doc.pdf`, 'doc.pdf')

            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].href).toBe(`${window.location.origin}/files/doc.pdf`)
            expect(clickedAnchors[0].download).toBe('doc.pdf')
            expect(clickedAnchors[0].target).toBe('')
            expect(clickedAnchors[0].rel).toBe('')
        })

        it('should not set target="_blank" for same-origin URLs', async () => {
            await downloadFile(`${window.location.origin}/file.txt`, 'file.txt')

            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].target).toBe('')
        })

        it('should not fetch for same-origin URLs', async () => {
            await downloadFile(`${window.location.origin}/files/doc.pdf`, 'doc.pdf')

            expect(WKApp.apiClient.get).not.toHaveBeenCalled()
        })
    })

    describe('cross-origin anchor download', () => {
        it('should set target="_blank" and rel="noopener" for cross-origin URLs', async () => {
            vi.mocked(WKApp.apiClient.get).mockResolvedValue({ url: 'https://cdn.example.com/abc123_file.pdf?signed=1', filename: 'file.pdf' })

            await downloadFile('https://cdn.example.com/abc123_file.pdf', 'file.pdf')

            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('file.pdf')
            expect(clickedAnchors[0].target).toBe('_blank')
            expect(clickedAnchors[0].rel).toBe('noopener')
        })

        it('should call presigned download API for cross-origin URLs', async () => {
            vi.mocked(WKApp.apiClient.get).mockResolvedValue({ url: 'https://cdn.example.com/signed-url', filename: 'file.txt' })

            await downloadFile('https://cdn.example.com/file.txt', 'file.txt')

            expect(WKApp.apiClient.get).toHaveBeenCalledWith(
                expect.stringContaining('file/download/url?path=')
            )
            expect(clickedAnchors[0].href).toBe('https://cdn.example.com/signed-url')
        })

        it('should fall back to original URL when presigned API fails', async () => {
            vi.mocked(WKApp.apiClient.get).mockRejectedValue(new Error('network error'))

            await downloadFile('https://cdn.example.com/file.txt', 'file.txt')

            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].href).toBe('https://cdn.example.com/file.txt')
        })

        it('should not add response-content-disposition to cross-origin URLs', async () => {
            vi.mocked(WKApp.apiClient.get).mockResolvedValue({ url: 'https://cdn.example.com/signed', filename: 'file.pdf' })

            await downloadFile('https://cdn.example.com/abc123_file.pdf', 'file.pdf')

            expect(clickedAnchors[0].href).not.toContain('response-content-disposition')
        })
    })

    describe('URL resolution', () => {
        it('should resolve /path relative URLs as same-origin', async () => {
            await downloadFile('/api/file/123', 'doc.pdf')

            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].href).toBe(`${window.location.origin}/api/file/123`)
            expect(clickedAnchors[0].download).toBe('doc.pdf')
            expect(clickedAnchors[0].target).toBe('')
        })

        it('should resolve ./path relative URLs as same-origin', async () => {
            await downloadFile('./files/doc.pdf', 'doc.pdf')

            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('doc.pdf')
            expect(clickedAnchors[0].target).toBe('')
        })

        it('should resolve ../path relative URLs as same-origin', async () => {
            await downloadFile('../files/doc.pdf', 'doc.pdf')

            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('doc.pdf')
            expect(clickedAnchors[0].target).toBe('')
        })

        it('should resolve bare path relative URLs as same-origin', async () => {
            await downloadFile('api/file/123', 'doc.pdf')

            expect(clickedAnchors).toHaveLength(1)
            expect(clickedAnchors[0].download).toBe('doc.pdf')
            expect(clickedAnchors[0].target).toBe('')
        })
    })

    describe('isSafeUrl check', () => {
        it('should not create anchor for javascript: URLs', async () => {
            await downloadFile('javascript:alert(1)', 'evil.txt')

            expect(clickedAnchors).toHaveLength(0)
        })

        it('should not act on empty URL', async () => {
            await downloadFile('', 'file.txt')

            expect(clickedAnchors).toHaveLength(0)
        })

        it('should not act on invalid URL', async () => {
            // URL constructor with a bad scheme + no base should throw
            await downloadFile('not://[invalid', 'file.txt')

            expect(clickedAnchors).toHaveLength(0)
        })
    })
})

describe('getPresignedDownloadUrl', () => {
    it('should return signed URL from API response', async () => {
        vi.mocked(WKApp.apiClient.get).mockResolvedValue({ url: 'https://cdn.example.com/signed-url', filename: 'test.pdf' })

        const result = await getPresignedDownloadUrl('https://cdn.example.com/test.pdf', 'test.pdf')

        expect(result).toBe('https://cdn.example.com/signed-url')
        expect(WKApp.apiClient.get).toHaveBeenCalledWith(
            'file/download/url?path=https%3A%2F%2Fcdn.example.com%2Ftest.pdf&filename=test.pdf'
        )
    })

    it('should encode Unicode filenames in API request', async () => {
        vi.mocked(WKApp.apiClient.get).mockResolvedValue({ url: 'https://cdn.example.com/signed', filename: '测试.png' })

        await getPresignedDownloadUrl('https://cdn.example.com/image.png', '测试.png')

        expect(WKApp.apiClient.get).toHaveBeenCalledWith(
            expect.stringContaining('filename=%E6%B5%8B%E8%AF%95.png')
        )
    })

    it('should fall back to original URL on API error', async () => {
        vi.mocked(WKApp.apiClient.get).mockRejectedValue(new Error('500'))

        const result = await getPresignedDownloadUrl('https://cdn.example.com/test.pdf', 'test.pdf')

        expect(result).toBe('https://cdn.example.com/test.pdf')
    })

    it('should fall back to original URL when response has no url field', async () => {
        vi.mocked(WKApp.apiClient.get).mockResolvedValue({})

        const result = await getPresignedDownloadUrl('https://cdn.example.com/test.pdf', 'test.pdf')

        expect(result).toBe('https://cdn.example.com/test.pdf')
    })
})
