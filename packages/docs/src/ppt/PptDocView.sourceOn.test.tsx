import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'

// Flag-ON build: a deployment whose backend carries R3-B1 flips PPT_SOURCE_ENABLED on. The preview
// then mounts the same-origin Bento container (an iframe) instead of the coming-soon placeholder.
// Mock config.ts with the flag ON (every other export real via importActual), mirroring the
// DocsHome.pptFlagOff.test.tsx pattern.
vi.mock('../config.ts', async () => {
  const actual = await vi.importActual<typeof import('../config.ts')>('../config.ts')
  return { ...actual, PPT_SOURCE_ENABLED: true }
})

// Imported AFTER the config mock so the module closes over the ON flag.
import { PptDocView } from './PptDocView.tsx'

describe('PptDocView — source gated ON', () => {
  beforeEach(() => {
    setWKApp(createMockWKApp())
  })
  afterEach(() => cleanup())

  it('mounts the same-origin Bento preview frame (read-only)', () => {
    const { container } = render(<PptDocView docId="d_1" title="Q3 deck" />)
    const frame = container.querySelector('iframe')
    expect(frame).not.toBeNull()
    // Same-origin frame src, addressed by docId, in preview mode.
    expect(frame?.getAttribute('src')).toContain('/ppt/frame/d_1')
    expect(frame?.getAttribute('src')).toContain('mode=preview')
    // No placeholder hint in the mounted state.
    expect(screen.queryByText('docs.ppt.previewComingSoon')).toBeNull()
  })
})
