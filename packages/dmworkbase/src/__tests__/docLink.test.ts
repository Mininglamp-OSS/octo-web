import { describe, it, expect } from 'vitest'
import { buildDocLink } from '../Utils/docLink'

describe('buildDocLink — standalone `/d/:docId` share form (Phase-1 no-sp reader)', () => {
  it('points at the standalone `/d/<docId>` page, not the in-shell `/docs?doc=` route', () => {
    const link = buildDocLink({ docId: 'd_1', space: 'demo', folder: 'f_default' })
    expect(link).toContain('/d/d_1')
    expect(link).not.toContain('/docs?')
    expect(link).not.toContain('doc=d_1')
    expect(link).not.toContain('space=')
    expect(link).not.toContain('folder=')
  })

  it('never emits `?sp=` even when a document space is supplied', () => {
    const link = buildDocLink({ docId: 'd_1', space: '105d4a60d0fc4d55a5cfc3c2d0501361' })
    expect(link).toBe('http://localhost:3000/d/d_1')
    expect(link).not.toContain('sp=')
  })

  it('never carries the token-bucket `?sid`, even when currentSpaceId is persisted', () => {
    try {
      window.localStorage.setItem('currentSpaceId', 'sp_current')
      const link = buildDocLink({ docId: 'd_1', space: 'space_doc' })
      expect(link).toBe('http://localhost:3000/d/d_1')
      expect(link).not.toContain('sid=')
      expect(link).not.toContain('sp=')
    } finally {
      window.localStorage.removeItem('currentSpaceId')
    }
  })

  it('works with only a docId and URL-encodes it', () => {
    expect(buildDocLink({ docId: 'd_2' })).toBe('http://localhost:3000/d/d_2')
    expect(buildDocLink({ docId: 'a b' })).toBe('http://localhost:3000/d/a%20b')
  })
})
