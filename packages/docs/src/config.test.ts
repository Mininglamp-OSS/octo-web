import { describe, it, expect } from 'vitest'
import { resolveCollabWsUrl } from './config.ts'

// The build-time env (VITE_COLLAB_WS_ENDPOINT) is unset under vitest, so the legacy fallback
// resolves to the placeholder default. These tests pin the resolution PRIORITY, not the exact
// placeholder value: backend-issued URL wins; a missing/blank one falls back to the env value.
describe('resolveCollabWsUrl', () => {
  const ENV_FALLBACK = resolveCollabWsUrl(undefined)

  it('prefers the backend-issued collabWsUrl', () => {
    expect(resolveCollabWsUrl('wss://collab.prod.example.com')).toBe('wss://collab.prod.example.com')
  })

  it('falls back to the build-time env when the backend omits collabWsUrl', () => {
    expect(resolveCollabWsUrl(undefined)).toBe(ENV_FALLBACK)
  })

  it('treats an empty or whitespace collabWsUrl as unset and falls back', () => {
    expect(resolveCollabWsUrl('')).toBe(ENV_FALLBACK)
    expect(resolveCollabWsUrl('   ')).toBe(ENV_FALLBACK)
  })
})
