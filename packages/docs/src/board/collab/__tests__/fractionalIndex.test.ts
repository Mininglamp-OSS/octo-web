// Fractional-index render-defence (XIN-791 / octo-docs-backend #51).
//
// Excalidraw's bundled `fractional-indexing` throws `invalid order key` on a key its grammar
// cannot parse, and `restoreElements` / `reconcileElements` call it whenever an index must be
// regenerated — so a backend-authored key that passes the shared loose `/^[A-Za-z0-9]+$/` charset
// but not Excalidraw's grammar (the zero-padded `r00000000` scheme) blanks the canvas. These cases
// lock in the validator's fidelity to that grammar and the sanitizer's strip-and-preserve-order
// behaviour, including the zero-copy fast path that leaves valid (human-drawn) scenes untouched.
import { describe, it, expect } from 'vitest'
import { isExcalidrawFractionalIndex, sanitizeFractionalIndices } from '../fractionalIndex.ts'
import { makeEl } from './helpers.ts'

describe('isExcalidrawFractionalIndex', () => {
  it('accepts real Excalidraw keys', () => {
    for (const k of ['a0', 'a1', 'a2', 'a0V', 'Zz', 'b00', 'a0V8', 'Zzol']) {
      expect(isExcalidrawFractionalIndex(k)).toBe(true)
    }
  })

  it('rejects the backend zero-padded scheme (root cause of #51)', () => {
    // head `r` claims a 19-char integer part; only 9 chars follow → unparseable by the library.
    for (const k of ['r00000000', 'r00000001', 'r00000003', 'r0000000z']) {
      expect(isExcalidrawFractionalIndex(k)).toBe(false)
    }
  })

  it('rejects malformed / non-string / empty keys', () => {
    for (const k of ['', 'r', '0', '00', 'a', 'a00', '@x', 'A'.repeat(1) + '0'.repeat(26)]) {
      expect(isExcalidrawFractionalIndex(k)).toBe(false)
    }
    expect(isExcalidrawFractionalIndex(undefined)).toBe(false)
    expect(isExcalidrawFractionalIndex(null)).toBe(false)
    expect(isExcalidrawFractionalIndex(123 as unknown)).toBe(false)
  })

  it('rejects a fractional part that ends in the smallest digit', () => {
    // Mirrors the library's `validateOrderKey` trailing-`0` rule.
    expect(isExcalidrawFractionalIndex('a0V0')).toBe(false)
    expect(isExcalidrawFractionalIndex('a0V1')).toBe(true)
  })
})

describe('sanitizeFractionalIndices', () => {
  it('returns the SAME array reference when every key is valid (fast path, no regression)', () => {
    const els = [makeEl('a', { index: 'a0' }), makeEl('b', { index: 'a1' })]
    expect(sanitizeFractionalIndices(els)).toBe(els)
  })

  it('treats an absent index as valid (fast path)', () => {
    const els = [makeEl('a', { index: undefined }), makeEl('b', { index: 'a1' })]
    expect(sanitizeFractionalIndices(els)).toBe(els)
  })

  it('drops only the invalid keys and leaves other fields (and valid keys) intact', () => {
    const els = [
      makeEl('rect', { index: 'r00000000', width: 220, height: 100 }),
      makeEl('local', { index: 'a5' }),
    ]
    const out = sanitizeFractionalIndices(els)
    const rect = out.find((e) => e.id === 'rect')!
    const local = out.find((e) => e.id === 'local')!
    expect('index' in rect).toBe(false) // stripped → Excalidraw will regenerate a valid key
    expect(rect.width).toBe(220) // untouched
    expect(rect.height).toBe(100)
    expect(local.index).toBe('a5') // valid key preserved
  })

  it('preserves the authored z-order by stable-sorting on the original key strings', () => {
    // Deliberately supply the elements out of index order (Y.Map insertion order is arbitrary).
    const els = [
      makeEl('third', { index: 'r00000003' }),
      makeEl('first', { index: 'r00000000' }),
      makeEl('second', { index: 'r00000001' }),
    ]
    const out = sanitizeFractionalIndices(els)
    expect(out.map((e) => e.id)).toEqual(['first', 'second', 'third'])
  })

  it('produces a scene with no key Excalidraw would reject', () => {
    const els = [
      makeEl('rect', { index: 'r00000000' }),
      makeEl('ellipse', { index: 'r00000001' }),
      makeEl('text', { index: 'r00000003', type: 'text' }),
    ]
    const out = sanitizeFractionalIndices(els)
    for (const el of out) {
      expect(el.index == null || isExcalidrawFractionalIndex(el.index)).toBe(true)
    }
  })
})
