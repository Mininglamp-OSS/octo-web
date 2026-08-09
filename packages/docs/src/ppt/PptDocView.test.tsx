import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import { PptDocView } from './PptDocView.tsx'

// Default build: PPT_SOURCE_ENABLED is OFF (pending backend R3-B1), so the read-only preview must
// render the R1 "coming soon" placeholder and mount NO iframe / open no network — the gated state
// that ships until source lands. (The flag-ON branch is covered in PptDocView.sourceOn.test.tsx.)
describe('PptDocView — source gated OFF (default)', () => {
  beforeEach(() => {
    setWKApp(createMockWKApp())
  })
  afterEach(() => cleanup())

  it('renders the coming-soon placeholder and no Bento frame', () => {
    const { container } = render(<PptDocView docId="d_1" title="Q3 deck" />)
    expect(screen.getByText('docs.ppt.previewComingSoon')).toBeTruthy()
    expect(screen.getByText('Q3 deck')).toBeTruthy()
    expect(container.querySelector('iframe')).toBeNull()
  })
})
