import { describe, it, expect } from 'vitest'
import { withDeckSpace } from './pptLink.ts'

// P1-1 (XIN-1621): withDeckSpace is the FE producer of a PPT link that carries the deck's owning space
// as `?sp=` — the carrier resolveDeckSpace reads first on a cross-space cold open. The bug the round-5
// reviewer flagged was that NOTHING produced such a link, so these tests assert the produced link
// actually carries `?sp=`, not merely that a hand-placed `?sp=` is read back.
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

