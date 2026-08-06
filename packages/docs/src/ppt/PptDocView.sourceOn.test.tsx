import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'

// Flag-ON build: a deployment whose backend carries R3-B1 (octo-docs-backend #161) flips
// PPT_SOURCE_ENABLED on. The preview then fetches the deck's rendered source through the shared
// apiClient and mounts it in an isolated (opaque-origin) Bento container (srcdoc iframe) instead of
// the coming-soon placeholder. Mock config.ts with the flag ON (every other export real via
// importActual), mirroring the DocsHome.pptFlagOff.test.tsx pattern.
vi.mock('../config.ts', async () => {
  const actual = await vi.importActual<typeof import('../config.ts')>('../config.ts')
  return { ...actual, PPT_SOURCE_ENABLED: true }
})

// Imported AFTER the config mock so the module closes over the ON flag.
import { PptDocView } from './PptDocView.tsx'

const DECK_HTML = '<html><body>Q3 deck</body></html>'
let api: MockApiClient

describe('PptDocView — source gated ON', () => {
  beforeEach(() => {
    const wk = createMockWKApp()
    api = wk.apiClient
    api.responder = () => ({ data: DECK_HTML, status: 200 })
    setWKApp(wk)
  })
  afterEach(() => cleanup())

  it('fetches the real published source and mounts the same-origin Bento preview (read-only)', async () => {
    const { container } = render(<PptDocView docId="d_1" title="Q3 deck" />)
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull())
    const frame = container.querySelector('iframe')
    // srcdoc-hosted deck source (opaque origin — no allow-same-origin); no bespoke /ppt/frame route.
    expect(frame?.getAttribute('srcdoc')).toContain('Q3 deck')
    expect(frame?.getAttribute('src')).toBeNull()
    // Fetched the real backend source endpoint with the mapped mode + format.
    expect(api.calls).toHaveLength(1)
    const { url } = api.calls[0]
    expect(url).toContain('/ppt/docs/d_1/source')
    expect(url).not.toContain('/ppt/frame')
    const q = new URL(url, 'http://local').searchParams
    expect(q.get('mode')).toBe('published')
    expect(q.get('format')).toBe('html')
    // No placeholder hint in the mounted state.
    expect(screen.queryByText('docs.ppt.previewComingSoon')).toBeNull()
  })

  it('renders the load-error state (no frame) when the source fetch fails', async () => {
    api.responder = () => {
      throw { response: { status: 500 } }
    }
    const { container } = render(<PptDocView docId="d_1" title="Q3 deck" />)
    await waitFor(() => expect(screen.getByText('docs.ppt.loadError')).toBeTruthy())
    expect(container.querySelector('iframe')).toBeNull()
  })
})
