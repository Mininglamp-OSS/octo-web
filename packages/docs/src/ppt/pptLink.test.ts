import { describe, it, expect } from 'vitest'
import { withDeckSpace, buildPptPresentLink } from './pptLink.ts'

// P1-1 (XIN-1621): these builders are the FE producers of PPT links that carry the deck's owning
// space as `?sp=` — the carrier resolveDeckSpace reads first on a cross-space cold open. The bug the
// round-5 reviewer flagged was that NOTHING produced such a link, so these tests assert the produced
// link actually carries `?sp=`, not merely that a hand-placed `?sp=` is read back.
describe('withDeckSpace — stamp the deck space onto the forwarded editor link', () => {
  it('appends `?sp=` to a bare rooted editor path', () => {
    expect(withDeckSpace('/ppt/d/new_deck', '105d4a60d0fc4d55a5cfc3c2d0501361')).toBe(
      '/ppt/d/new_deck?sp=105d4a60d0fc4d55a5cfc3c2d0501361',
    )
  })

  it('preserves an existing query param and appends `sp` alongside it', () => {
    const out = withDeckSpace('/ppt/d/new_deck?foo=1', 'sp_1')
    const q = new URL(out, 'http://local').searchParams
    expect(q.get('foo')).toBe('1')
    expect(q.get('sp')).toBe('sp_1')
  })

  it('preserves a hash fragment after the appended query', () => {
    expect(withDeckSpace('/ppt/d/new_deck#slide-2', 'sp_1')).toBe('/ppt/d/new_deck?sp=sp_1#slide-2')
  })

  it('never overrides an `sp` the path already carries (backend authority wins)', () => {
    expect(withDeckSpace('/ppt/d/new_deck?sp=backend_space', 'sp_local')).toBe(
      '/ppt/d/new_deck?sp=backend_space',
    )
  })

  it('leaves the path unchanged when the space is empty / whitespace', () => {
    expect(withDeckSpace('/ppt/d/new_deck', '')).toBe('/ppt/d/new_deck')
    expect(withDeckSpace('/ppt/d/new_deck', '   ')).toBe('/ppt/d/new_deck')
    expect(withDeckSpace('/ppt/d/new_deck', null)).toBe('/ppt/d/new_deck')
    expect(withDeckSpace('/ppt/d/new_deck', undefined)).toBe('/ppt/d/new_deck')
  })
})

describe('buildPptPresentLink — present-route share link carries the deck space', () => {
  const origin = window.location.origin

  it('builds an absolute present link carrying `?sp=`', () => {
    const link = buildPptPresentLink({ docId: 'd_1', space: 'sp_1' })
    expect(link).toBe(`${origin}/docs/d_1/present?sp=sp_1`)
    // The produced link is read back by the same carrier resolveDeckSpace uses.
    expect(new URL(link).searchParams.get('sp')).toBe('sp_1')
  })

  it('adds `?version=` only for a pinned published version, not for latest', () => {
    const pinned = buildPptPresentLink({ docId: 'd_1', space: 'sp_1', version: 3 })
    const q = new URL(pinned).searchParams
    expect(q.get('sp')).toBe('sp_1')
    expect(q.get('version')).toBe('3')

    const latest = buildPptPresentLink({ docId: 'd_1', space: 'sp_1', version: 'latest' })
    expect(new URL(latest).searchParams.has('version')).toBe(false)
  })

  it('omits `?sp=` when no space is known (degrades to the route default)', () => {
    expect(buildPptPresentLink({ docId: 'd_1' })).toBe(`${origin}/docs/d_1/present`)
  })

  it('percent-encodes the docId in the path', () => {
    const link = buildPptPresentLink({ docId: 'a b', space: 'sp_1' })
    expect(link).toBe(`${origin}/docs/a%20b/present?sp=sp_1`)
  })
})
