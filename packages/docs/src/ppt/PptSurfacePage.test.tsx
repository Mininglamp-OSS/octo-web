import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'

// Keep the heavy collab runtime out of this render: PptSurfacePage only needs terminalForCreateError.
vi.mock('../collab/useCollabEditor.ts', () => ({
  terminalForCreateError: () => 'not-found',
}))

// Spy getDoc so the gated path can be asserted to perform NO preflight; keep the other exports real.
const { getDoc } = vi.hoisted(() => ({ getDoc: vi.fn() }))
vi.mock('../pages/docsApi.ts', async () => {
  const actual = await vi.importActual<typeof import('../pages/docsApi.ts')>('../pages/docsApi.ts')
  return { ...actual, getDoc }
})

import { PptSurfacePage } from './PptSurfacePage.tsx'

// Default build: PPT_SOURCE_ENABLED OFF. Both peer routes render the gated "coming soon" shell and
// perform NO network I/O (no preflight) — the state that ships until backend R3-B1 merges.
describe('PptSurfacePage — source gated OFF (default)', () => {
  beforeEach(() => {
    setWKApp(createMockWKApp())
    getDoc.mockReset()
  })
  afterEach(() => cleanup())

  it('editor mode shows the gated editor notice, mounts no frame, and runs no preflight', () => {
    const { container } = render(<PptSurfacePage docId="d_1" mode="editor" />)
    expect(screen.getByText('docs.ppt.editorComingSoon')).toBeTruthy()
    expect(container.querySelector('iframe')).toBeNull()
    expect(getDoc).not.toHaveBeenCalled()
  })

  it('present mode shows the gated present notice', () => {
    render(<PptSurfacePage docId="d_1" mode="present" version="latest" />)
    expect(screen.getByText('docs.ppt.presentComingSoon')).toBeTruthy()
    expect(getDoc).not.toHaveBeenCalled()
  })
})
