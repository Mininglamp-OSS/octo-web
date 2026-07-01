import { describe, it, expect } from 'vitest'
import { resolveCollabWsUrl } from './config.ts'

// The collab WS origin is delivered solely at runtime via the collab-token response
// (`collabWsUrl`). The legacy build-time env fallback (VITE_COLLAB_WS_ENDPOINT) has been removed,
// so a missing/blank URL must fail loudly instead of resolving to a placeholder.
describe('resolveCollabWsUrl', () => {
  it('returns the backend-issued collabWsUrl (trimmed)', () => {
    expect(resolveCollabWsUrl('wss://collab.prod.example.com')).toBe('wss://collab.prod.example.com')
    expect(resolveCollabWsUrl('  wss://collab.prod.example.com  ')).toBe(
      'wss://collab.prod.example.com',
    )
  })

  it('throws when the backend omits collabWsUrl', () => {
    expect(() => resolveCollabWsUrl(undefined)).toThrow(/collabWsUrl/)
  })

  it('throws when collabWsUrl is empty or whitespace-only', () => {
    expect(() => resolveCollabWsUrl('')).toThrow(/collabWsUrl/)
    expect(() => resolveCollabWsUrl('   ')).toThrow(/collabWsUrl/)
  })
})
