import { describe, it, expect } from 'vitest'
import {
  parsePptEditorDocId,
  isPptEditorPath,
  parsePptPresentDocId,
  isPptPresentPath,
  parsePresentVersion,
} from './pptRoutes.ts'

describe('parsePptEditorDocId / isPptEditorPath', () => {
  it('extracts the docId from a well-formed editor path', () => {
    expect(parsePptEditorDocId('/ppt/d/d_abc123')).toBe('d_abc123')
    expect(parsePptEditorDocId('/ppt/d/d_abc123/')).toBe('d_abc123')
    expect(parsePptEditorDocId('/ppt/d/DECK-9_x')).toBe('DECK-9_x')
  })
  it('returns null for malformed / non-editor paths', () => {
    expect(parsePptEditorDocId('/ppt/d/')).toBeNull()
    expect(parsePptEditorDocId('/ppt/d/a:b')).toBeNull()
    expect(parsePptEditorDocId('/ppt/d/a/b')).toBeNull()
    expect(parsePptEditorDocId('/docs')).toBeNull()
    expect(parsePptEditorDocId('/d/d_abc')).toBeNull()
  })
  it('claims the whole /ppt/d namespace regardless of id validity', () => {
    expect(isPptEditorPath('/ppt/d/d_abc')).toBe(true)
    expect(isPptEditorPath('/ppt/d/')).toBe(true)
    expect(isPptEditorPath('/ppt/d')).toBe(true)
    expect(isPptEditorPath('/ppt/d/a:b')).toBe(true)
    expect(isPptEditorPath('/ppt/deck')).toBe(false)
    expect(isPptEditorPath('/pptx/d/a')).toBe(false)
    expect(isPptEditorPath('/docs/x/present')).toBe(false)
  })
})

describe('parsePptPresentDocId / isPptPresentPath', () => {
  it('matches only the exact /docs/:docId/present shape', () => {
    expect(parsePptPresentDocId('/docs/d_abc/present')).toBe('d_abc')
    expect(parsePptPresentDocId('/docs/d_abc/present/')).toBe('d_abc')
    expect(isPptPresentPath('/docs/d_abc/present')).toBe(true)
  })
  it('does NOT claim other /docs paths (app shell keeps them)', () => {
    expect(parsePptPresentDocId('/docs')).toBeNull()
    expect(parsePptPresentDocId('/docs/d_abc')).toBeNull()
    expect(parsePptPresentDocId('/docs/d_abc/present/extra')).toBeNull()
    expect(parsePptPresentDocId('/docs/a:b/present')).toBeNull()
    expect(isPptPresentPath('/docs')).toBe(false)
    expect(isPptPresentPath('/docs/d_abc')).toBe(false)
  })
})

describe('parsePresentVersion', () => {
  it('defaults to latest when absent or blank', () => {
    expect(parsePresentVersion('')).toBe('latest')
    expect(parsePresentVersion(undefined)).toBe('latest')
    expect(parsePresentVersion('?foo=bar')).toBe('latest')
    expect(parsePresentVersion('?version=latest')).toBe('latest')
  })
  it('accepts a positive integer version', () => {
    expect(parsePresentVersion('?version=1')).toBe(1)
    expect(parsePresentVersion('?version=42')).toBe(42)
  })
  it('falls back to latest for out-of-range / malformed versions', () => {
    expect(parsePresentVersion('?version=0')).toBe('latest')
    expect(parsePresentVersion('?version=-3')).toBe('latest')
    expect(parsePresentVersion('?version=1.5')).toBe('latest')
    expect(parsePresentVersion('?version=abc')).toBe('latest')
    expect(parsePresentVersion('?version=99999999999999999999')).toBe('latest')
    expect(parsePresentVersion('?version= 2 ')).toBe(2)
  })
})
