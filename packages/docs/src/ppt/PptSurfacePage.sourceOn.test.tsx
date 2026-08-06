import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import type { DocMeta } from '../pages/docsApi.ts'

// Flag-ON build (backend R3-B1 present, octo-docs-backend #161): the peer routes run the reader
// preflight (getDoc) and mount the Bento container for a confirmed html_ppt deck. The container then
// fetches the deck's rendered source through the shared apiClient and hosts it same-origin (srcdoc).
// Mock config.ts with PPT_SOURCE_ENABLED ON.
vi.mock('../config.ts', async () => {
  const actual = await vi.importActual<typeof import('../config.ts')>('../config.ts')
  return { ...actual, PPT_SOURCE_ENABLED: true }
})
vi.mock('../collab/useCollabEditor.ts', () => ({
  terminalForCreateError: () => 'not-found',
}))
const { getDoc } = vi.hoisted(() => ({ getDoc: vi.fn() }))
vi.mock('../pages/docsApi.ts', async () => {
  const actual = await vi.importActual<typeof import('../pages/docsApi.ts')>('../pages/docsApi.ts')
  return { ...actual, getDoc }
})

import { PptSurfacePage } from './PptSurfacePage.tsx'

const DECK_HTML = '<html><body>deck source</body></html>'
let api: MockApiClient

function meta(over: Partial<DocMeta>): DocMeta {
  return { docId: 'd_1', title: 'Deck', docType: 'html_ppt', role: 'writer', ...over } as DocMeta
}

describe('PptSurfacePage — source gated ON', () => {
  beforeEach(() => {
    const wk = createMockWKApp()
    // Cross-space cold deep-link: the surface mounts via the Layout early-return before the shell
    // restores currentSpaceId, but the standalone branch seeds it from the cached localStorage key.
    // Pin a resolved space here so the test can assert BOTH hops carry X-Space-Id (XIN-1608 P1).
    wk.shared.currentSpaceId = 'sp_1'
    api = wk.apiClient
    api.responder = () => ({ data: DECK_HTML, status: 200 })
    setWKApp(wk)
    getDoc.mockReset()
  })
  afterEach(() => cleanup())

  it('mounts the Bento container and forwards X-Space-Id on both hops (editor mode)', async () => {
    getDoc.mockResolvedValue(meta({ docId: 'd_1' }))
    const { container } = render(<PptSurfacePage docId="d_1" mode="editor" />)
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull())
    const frame = container.querySelector('iframe')
    expect(frame?.getAttribute('srcdoc')).toContain('deck source')
    // P1: the preflight is space-scoped (getDoc `{ spaceId }`), not a bare id call that pins the bug.
    expect(getDoc).toHaveBeenCalledWith('d_1', { spaceId: 'sp_1' })
    const url = api.calls[0]?.url ?? ''
    expect(url).toContain('/ppt/docs/d_1/source')
    expect(url).not.toContain('/ppt/frame')
    const q = new URL(url, 'http://local').searchParams
    expect(q.get('mode')).toBe('live')
    expect(q.get('format')).toBe('html')
    // P1: the source fetch is scoped too — BentoContainer received `space` and forwarded the header.
    const headers = (api.calls[0]?.config?.headers ?? {}) as Record<string, string>
    expect(headers['X-Space-Id']).toBe('sp_1')
  })

  // P0 (XIN-1608): the deck source is user-authored and NOT end-to-end sanitized, so the frame must
  // never run scripts in the parent origin. Pin the isolation: the sandbox may grant allow-scripts
  // but must NOT also grant allow-same-origin (Option A — opaque origin). This asserted red on head
  // 8fb959db (sandbox was `allow-scripts allow-same-origin`).
  it('isolates the deck in an opaque origin: never both allow-scripts and allow-same-origin', async () => {
    getDoc.mockResolvedValue(meta({ docId: 'd_1' }))
    const { container } = render(<PptSurfacePage docId="d_1" mode="editor" />)
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull())
    const sandbox = container.querySelector('iframe')?.getAttribute('sandbox') ?? ''
    const tokens = sandbox.split(/\s+/).filter(Boolean)
    expect(tokens).toContain('allow-scripts')
    expect(tokens).not.toContain('allow-same-origin')
  })

  it('present mode also isolates the frame in an opaque origin (keeps allow-fullscreen)', async () => {
    getDoc.mockResolvedValue(meta({ docId: 'd_1', role: 'reader' }))
    const { container } = render(<PptSurfacePage docId="d_1" mode="present" version={2} />)
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull())
    const sandbox = container.querySelector('iframe')?.getAttribute('sandbox') ?? ''
    const tokens = sandbox.split(/\s+/).filter(Boolean)
    expect(tokens).toContain('allow-scripts')
    expect(tokens).toContain('allow-fullscreen')
    expect(tokens).not.toContain('allow-same-origin')
  })

  it('fetches the requested published version in present mode', async () => {
    getDoc.mockResolvedValue(meta({ docId: 'd_1', role: 'reader' }))
    const { container } = render(<PptSurfacePage docId="d_1" mode="present" version={3} />)
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull())
    const q = new URL(api.calls[0]?.url ?? '', 'http://local').searchParams
    expect(q.get('mode')).toBe('published')
    expect(q.get('version')).toBe('3')
    expect(q.get('format')).toBe('html')
  })

  it('never falls through to a frame for a non-html_ppt doc (no-fallthrough contract)', async () => {
    getDoc.mockResolvedValue(meta({ docType: 'doc' }))
    const { container } = render(<PptSurfacePage docId="d_1" mode="editor" />)
    await waitFor(() => expect(getDoc).toHaveBeenCalled())
    expect(container.querySelector('iframe')).toBeNull()
    // No-fallthrough: a non-deck never triggers a source fetch.
    expect(api.calls).toHaveLength(0)
  })

  it('renders the not-found shell (no frame) for a null id', () => {
    const { container } = render(<PptSurfacePage docId={null} mode="present" version="latest" />)
    expect(container.querySelector('iframe')).toBeNull()
    expect(getDoc).not.toHaveBeenCalled()
  })
})
