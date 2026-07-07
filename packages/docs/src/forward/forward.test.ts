import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setWKApp, openDocForward } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import { grantForward, grantForwardMany } from './api.ts'
import { buildDocLink } from './link.ts'
import { computeCanGrant, startDocForward } from './startDocForward.ts'

let api: MockApiClient
let wk: ReturnType<typeof createMockWKApp>

beforeEach(() => {
  wk = createMockWKApp({ uid: 'u_self', token: 't' })
  api = wk.apiClient
  setWKApp(wk)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('forward grant API (contract 1 — distinct forward-grant endpoint, per-uid status)', () => {
  it('POSTs to /docs/{docId}/forward-grant with { uid, role } and maps 200 → ok', async () => {
    api.responder = () => ({ data: {}, status: 200 })
    const outcome = await grantForward('d_1', 'u_a', 'reader')
    expect(outcome).toBe('ok')
    expect(api.calls[0]).toMatchObject({
      method: 'post',
      url: '/docs/d_1/forward-grant',
      body: { uid: 'u_a', role: 'reader' },
    })
  })

  it('maps 404 → not_found and 403 → forbidden (per-uid), other errors → error', async () => {
    api.responder = () => {
      throw { response: { status: 404 } }
    }
    expect(await grantForward('d', 'ghost', 'reader')).toBe('not_found')
    api.responder = () => {
      throw { response: { status: 403 } }
    }
    expect(await grantForward('d', 'x', 'writer')).toBe('forbidden')
    api.responder = () => {
      throw { response: { status: 500 } }
    }
    expect(await grantForward('d', 'y', 'reader')).toBe('error')
  })

  it('grantForwardMany aggregates N/M, de-dupes uids, and reports failures (contract 2)', async () => {
    // u_a ok, u_b 404, u_c ok; u_a appears twice (two groups) → granted once.
    api.responder = (_m, _u, body) => {
      const uid = (body as { uid: string }).uid
      if (uid === 'u_b') throw { response: { status: 404 } }
      return { data: {}, status: 200 }
    }
    const res = await grantForwardMany('d_1', ['u_a', 'u_b', 'u_c', 'u_a'], 'writer')
    expect(res.granted).toBe(2)
    expect(res.failed).toBe(1)
    expect(res.failures).toEqual(['u_b'])
    // De-duped: u_a called once, so 3 unique calls total.
    expect(api.calls.filter((c) => c.url === '/docs/d_1/forward-grant')).toHaveLength(3)
  })
})

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

  it('keeps `?sp` DISTINCT from the token-bucket `?sid` (they are different identifiers)', () => {
    try {
      window.localStorage.setItem('currentSpaceId', 'sp_current')
      const link = buildDocLink({ docId: 'd_1', space: '105d4a60d0fc4d55a5cfc3c2d0501361' })
      expect(link).toContain('sid=sp_current')
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

  it('carries the current space sid so the receiver loads their sid-scoped token (#511 problem 2)', () => {
    // No sid in the (jsdom) URL — fall back to the persisted currentSpaceId.
    try {
      window.localStorage.setItem('currentSpaceId', 'sp_current')
      expect(buildDocLink({ docId: 'd_3' })).toContain('sid=sp_current')
    } finally {
      window.localStorage.removeItem('currentSpaceId')
    }
  })

  it('omits sid when neither the URL nor currentSpaceId provides one', () => {
    expect(buildDocLink({ docId: 'd_4' })).not.toContain('sid=')
  })
})

describe('computeCanGrant — canManage(role) || owner (frontend-design §1.2)', () => {
  it('admin can grant', () => {
    expect(computeCanGrant('admin', 'u_self', undefined)).toBe(true)
  })
  it('owner (non-admin role) can grant via ownerId match', () => {
    expect(computeCanGrant('reader', 'u_self', 'u_self')).toBe(true)
    expect(computeCanGrant('writer', 'u_self', 'u_self')).toBe(true)
  })
  it('reader/writer who is not the owner cannot grant', () => {
    expect(computeCanGrant('reader', 'u_self', 'u_owner')).toBe(false)
    expect(computeCanGrant('writer', 'u_self', undefined)).toBe(false)
  })
  it('null role with no owner cannot grant', () => {
    expect(computeCanGrant(null, 'u_self', undefined)).toBe(false)
  })
})

describe('openDocForward bridge + startDocForward (§9.5 seam)', () => {
  it('delegates to the injected openDocForward with a fully-built payload (admin)', () => {
    startDocForward({
      docId: 'd_1',
      title: 'Quarterly plan',
      role: 'admin',
      currentUid: 'u_self',
      ownerId: 'u_self',
      space: 'demo',
      folder: 'f_default',
    })
    expect(wk.openDocForwardCalls).toHaveLength(1)
    const call = wk.openDocForwardCalls[0]
    expect(call.docId).toBe('d_1')
    expect(call.title).toBe('Quarterly plan')
    expect(call.canGrant).toBe(true)
    expect(call.defaultRole).toBe('reader')
    expect(call.link).toContain('/d/d_1')
    // Admin/owner gets a grantAccess executor; a non-grantor does not.
    expect(typeof call.grantAccess).toBe('function')
  })

  it('a non-admin/owner forwarder gets canGrant=false and no grant executor', () => {
    startDocForward({
      docId: 'd_2',
      title: 'Notes',
      role: 'reader',
      currentUid: 'u_self',
      ownerId: 'u_owner',
    })
    const call = wk.openDocForwardCalls[0]
    expect(call.canGrant).toBe(false)
    expect(call.grantAccess).toBeUndefined()
  })

  it('falls back to the untitled placeholder for a blank title', () => {
    startDocForward({ docId: 'd_3', title: '   ', role: 'admin', currentUid: 'u_self' })
    expect(wk.openDocForwardCalls[0].title).toBeTruthy()
  })
})
