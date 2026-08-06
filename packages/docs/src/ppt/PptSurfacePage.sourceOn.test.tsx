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
    api = wk.apiClient
    api.responder = () => ({ data: DECK_HTML, status: 200 })
    setWKApp(wk)
    getDoc.mockReset()
  })
  afterEach(() => cleanup())

  it('mounts the Bento container and fetches the live editor source (editor mode)', async () => {
    getDoc.mockResolvedValue(meta({ docId: 'd_1' }))
    const { container } = render(<PptSurfacePage docId="d_1" mode="editor" />)
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull())
    const frame = container.querySelector('iframe')
    expect(frame?.getAttribute('srcdoc')).toContain('deck source')
    expect(getDoc).toHaveBeenCalledWith('d_1')
    const url = api.calls[0]?.url ?? ''
    expect(url).toContain('/ppt/docs/d_1/source')
    expect(url).not.toContain('/ppt/frame')
    const q = new URL(url, 'http://local').searchParams
    expect(q.get('mode')).toBe('live')
    expect(q.get('format')).toBe('html')
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
