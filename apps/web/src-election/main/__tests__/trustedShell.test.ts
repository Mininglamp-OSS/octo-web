import { describe, expect, it } from 'vitest'
import { createTrustedShellDocumentTracker } from '../trustedShell'

describe('trusted shell document tracking', () => {
  it('keeps the committed shell trusted when a later navigation never commits', () => {
    const tracker = createTrustedShellDocumentTracker((url) => url === 'file:///app/index.html')

    tracker.update('file:///app/index.html', true)
    // A will-navigate/mailto event is intentionally not passed to the
    // tracker. The old document is still the active document until commit.
    expect(tracker.isTrusted()).toBe(true)
  })

  it('updates trust only for committed main-frame documents', () => {
    const tracker = createTrustedShellDocumentTracker((url) => url === 'file:///app/index.html')

    tracker.update('file:///app/index.html', true)
    tracker.update('https://idp.example.com/logout', false)
    expect(tracker.isTrusted()).toBe(true)

    tracker.update('https://idp.example.com/logout', true)
    expect(tracker.isTrusted()).toBe(false)
  })
})
