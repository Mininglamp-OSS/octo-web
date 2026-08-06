import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import type { DocMeta } from '../pages/docsApi.ts'

// Flag-ON build (backend R3-B1 present): the peer routes run the reader preflight and mount the
// Bento container for a confirmed html_ppt deck. Mock config.ts with PPT_SOURCE_ENABLED ON.
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

function meta(over: Partial<DocMeta>): DocMeta {
  return { docId: 'd_1', title: 'Deck', docType: 'html_ppt', role: 'writer', ...over } as DocMeta
}

describe('PptSurfacePage — source gated ON', () => {
  beforeEach(() => {
    setWKApp(createMockWKApp())
    getDoc.mockReset()
  })
  afterEach(() => cleanup())

  it('mounts the Bento container for a confirmed html_ppt deck (editor mode)', async () => {
    getDoc.mockResolvedValue(meta({ docId: 'd_1' }))
    const { container } = render(<PptSurfacePage docId="d_1" mode="editor" />)
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull())
    const frame = container.querySelector('iframe')
    expect(frame?.getAttribute('src')).toContain('/ppt/frame/d_1')
    expect(frame?.getAttribute('src')).toContain('mode=editor')
    expect(getDoc).toHaveBeenCalledWith('d_1')
  })

  it('addresses the requested published version in present mode', async () => {
    getDoc.mockResolvedValue(meta({ docId: 'd_1', role: 'reader' }))
    const { container } = render(<PptSurfacePage docId="d_1" mode="present" version={3} />)
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull())
    const src = container.querySelector('iframe')?.getAttribute('src') ?? ''
    expect(src).toContain('mode=present')
    expect(src).toContain('version=3')
  })

  it('never falls through to a frame for a non-html_ppt doc (no-fallthrough contract)', async () => {
    getDoc.mockResolvedValue(meta({ docType: 'doc' }))
    const { container } = render(<PptSurfacePage docId="d_1" mode="editor" />)
    await waitFor(() => expect(getDoc).toHaveBeenCalled())
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('renders the not-found shell (no frame) for a null id', () => {
    const { container } = render(<PptSurfacePage docId={null} mode="present" version="latest" />)
    expect(container.querySelector('iframe')).toBeNull()
    expect(getDoc).not.toHaveBeenCalled()
  })
})
