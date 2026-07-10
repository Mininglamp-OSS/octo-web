// Fractional-index (order key) validity — the FE half of the cross-repo contract (XIN-794/795).
//
// `isValidIndex` used to be a bare charset check (`/^[A-Za-z0-9]+$/`), so a structurally-invalid
// synthetic key like `r00000003` — head 'r' declares a 19-char integer part, the key is 9 chars —
// passed as valid, reached Excalidraw's `updateScene`, and crashed the canvas. These tests pin the
// jitterbug structural rule (a boolean port of fractional-indexing's `validateOrderKey`) that both
// the FE binding and the BE authoritative repair must agree on byte-for-byte.
import { describe, it, expect } from 'vitest'
import { isValidIndex, normalizeElement } from './normalize.ts'

describe('isValidIndex — jitterbug structural rule (XIN-795 ②-FE)', () => {
  it('rejects the synthetic r00000003 key that the old charset regex let through', () => {
    // Regression pin: the old rule returned true here, which is exactly what crashed the board.
    expect(isValidIndex('r00000003')).toBe(false)
  })

  it('rejects the whole `^r[0-9a-z]{8}$` family produced by the since-fixed BE repair', () => {
    for (const key of ['r00000000', 'r0000000z', 'rzzzzzzzz', 'r12345678']) {
      expect(isValidIndex(key)).toBe(false)
    }
  })

  it('accepts the order keys Excalidraw / fractional-indexing actually generate', () => {
    // generateNKeysBetween(null, null, n) => a0, a1, a2, ...; midpoints add a fraction (a0V);
    // the negative-integer region uses upper-case heads (Zz).
    for (const key of ['a0', 'a1', 'a2', 'a0V', 'Zz', 'a0G']) {
      expect(isValidIndex(key)).toBe(true)
    }
  })

  it('rejects non-string, empty, non-base62, sentinel, and short-integer heads', () => {
    expect(isValidIndex(undefined)).toBe(false)
    expect(isValidIndex(null)).toBe(false)
    expect(isValidIndex(42)).toBe(false)
    expect(isValidIndex('')).toBe(false)
    expect(isValidIndex('a0!')).toBe(false) // non-base62 char
    expect(isValidIndex('A00000000000000000000000000')).toBe(false) // SMALLEST_INTEGER sentinel
    expect(isValidIndex('a')).toBe(false) // head 'a' needs a 2-char integer part, key is 1 char
    expect(isValidIndex('a00')).toBe(false) // fraction may not end in the first digit ('0')
  })
})

describe('normalizeElement strips an invalid index to a clean absent state', () => {
  const base = { id: 'e1', type: 'rectangle', version: 3, versionNonce: 7 }

  it('drops a structurally-invalid index (r00000003) so repair can refill a legal key', () => {
    const out = normalizeElement({ ...base, index: 'r00000003' })
    expect(out).not.toBeNull()
    expect('index' in (out as Record<string, unknown>)).toBe(false)
  })

  it('keeps a structurally-valid index untouched', () => {
    const out = normalizeElement({ ...base, index: 'a1' })
    expect((out as Record<string, unknown>).index).toBe('a1')
  })
})
