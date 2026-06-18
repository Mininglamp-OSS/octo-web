import { describe, it, expect } from 'vitest'
import { terminalForCreateError } from './useCollabEditor.ts'

// Regression (2026-06-18): CollabEditor.create() awaits the collab-token exchange before
// building the editor. The create-promise rejection was previously unhandled, so a failed
// token left `instance` null and EditorShell showed "Loading document…" forever. The hook
// now maps the failure to a terminal state via terminalForCreateError.
describe('terminalForCreateError — collab-token failure -> terminal state', () => {
  it('maps 403 to forbidden (non-member)', () => {
    expect(terminalForCreateError({ response: { status: 403 } })).toBe('forbidden')
  })
  it('maps 404 to not-found (missing doc)', () => {
    expect(terminalForCreateError({ response: { status: 404 } })).toBe('not-found')
  })
  it('maps 401 to login (expired/invalid session)', () => {
    expect(terminalForCreateError({ response: { status: 401 } })).toBe('login')
  })
  it('maps 423 to locked', () => {
    expect(terminalForCreateError({ response: { status: 423 } })).toBe('locked')
  })
  it('falls back to not-found for network/unknown errors', () => {
    expect(terminalForCreateError(new Error('Network Error'))).toBe('not-found')
    expect(terminalForCreateError(undefined)).toBe('not-found')
    expect(terminalForCreateError({ response: { status: 500 } })).toBe('not-found')
  })
})
