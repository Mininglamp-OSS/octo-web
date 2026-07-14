import { describe, it, expect } from 'vitest'
import { buildDocLink } from '../Utils/docLink'

describe('buildDocLink — standalone `/d/:docId` share form (bypasses the host query-wipe, XIN-450)', () => {
  it('points at the standalone `/d/<docId>` page, not the in-shell `/docs?doc=` route', () => {
    const link = buildDocLink({ docId: 'd_1', space: 'demo', folder: 'f_default' })
    expect(link).toContain('/d/d_1')
    // The doc no longer rides on a wipeable query param.
    expect(link).not.toContain('/docs?')
    expect(link).not.toContain('doc=d_1')
    // The legacy `space=`/`folder=` in-shell params are gone; the doc's real space rides on the
    // dedicated `?sp=` param instead (XIN-501), so the recipient's preflight can address the doc's
    // own space.
    expect(link).not.toContain('space=')
    expect(link).not.toContain('folder=')
  })

  it('embeds the doc real space as `?sp=` so the recipient preflight addresses the doc space (XIN-501)', () => {
    const link = buildDocLink({ docId: 'd_1', space: '105d4a60d0fc4d55a5cfc3c2d0501361' })
    expect(link).toContain('sp=105d4a60d0fc4d55a5cfc3c2d0501361')
  })

  it('never carries the token-bucket `?sid`, even when a currentSpaceId is persisted (XIN-513)', () => {
    // The link no longer mints `?sid` — an already-logged-in recipient's session is recovered from
    // storage independently of the URL. Only the doc's real space rides along, on `?sp`.
    try {
      window.localStorage.setItem('currentSpaceId', 'sp_current')
      const link = buildDocLink({ docId: 'd_1', space: '105d4a60d0fc4d55a5cfc3c2d0501361' })
      expect(link).not.toContain('sid=')
      expect(link).toContain('sp=105d4a60d0fc4d55a5cfc3c2d0501361')
    } finally {
      window.localStorage.removeItem('currentSpaceId')
    }
  })

  it('omits `?sp` when no space is provided', () => {
    expect(buildDocLink({ docId: 'd_1b' })).not.toContain('sp=')
  })

  it('works with only a docId', () => {
    expect(buildDocLink({ docId: 'd_2' })).toContain('/d/d_2')
  })

  it('never appends `?sid`, so a sid-less link works with only a docId (XIN-513)', () => {
    try {
      window.localStorage.setItem('currentSpaceId', 'sp_current')
      expect(buildDocLink({ docId: 'd_3' })).not.toContain('sid=')
    } finally {
      window.localStorage.removeItem('currentSpaceId')
    }
  })

  it('omits sid when neither the URL nor currentSpaceId provides one', () => {
    expect(buildDocLink({ docId: 'd_4' })).not.toContain('sid=')
  })
})
