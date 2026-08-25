import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@douyinfe/semi-ui', () => ({ Toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('../../App', () => ({
  default: {
    apiClient: {
      get: vi.fn(),
    },
  },
}))

import { downloadFile } from '../download'
import WKApp from '../../App'

describe('downloadFile', () => {
  let capturedAnchor: HTMLAnchorElement | null = null

  beforeEach(() => {
    capturedAnchor = null
    vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
      capturedAnchor = node as HTMLAnchorElement
      ;(node as HTMLAnchorElement).click = vi.fn()
      return node
    })
    vi.spyOn(document.body, 'removeChild').mockImplementation((node: Node) => node)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls presigned API for cross-origin URLs', async () => {
    vi.mocked(WKApp.apiClient.get).mockResolvedValue({ url: 'https://cdn.example.com/signed-url', filename: 'photo.png' })

    await downloadFile('https://cdn.example.com/image.png', 'photo.png')

    expect(WKApp.apiClient.get).toHaveBeenCalledWith(
      expect.stringContaining('file/download/url?path=')
    )
    expect(capturedAnchor).not.toBeNull()
    expect(capturedAnchor!.href).toBe('https://cdn.example.com/signed-url')
  })

  it('does not add response-content-disposition to cross-origin URLs', async () => {
    vi.mocked(WKApp.apiClient.get).mockResolvedValue({ url: 'https://cdn.example.com/signed', filename: 'photo.png' })

    await downloadFile('https://cdn.example.com/image.png', 'photo.png')

    expect(capturedAnchor).not.toBeNull()
    expect(capturedAnchor!.href).not.toContain('response-content-disposition')
  })

  it('falls back to original URL when presigned API fails', async () => {
    vi.mocked(WKApp.apiClient.get).mockRejectedValue(new Error('network'))

    await downloadFile('https://cdn.example.com/image.png', 'photo.png')

    expect(capturedAnchor).not.toBeNull()
    expect(capturedAnchor!.href).toBe('https://cdn.example.com/image.png')
  })

  it('does nothing for empty URL', async () => {
    await downloadFile('', 'photo.png')
    expect(capturedAnchor).toBeNull()
  })

  it('does nothing for javascript: URL', async () => {
    await downloadFile('javascript:alert(1)', 'photo.png')
    expect(capturedAnchor).toBeNull()
  })
})
