// Merge-time repair pass (selection B, XIN-24) driven by the shared `normalizeElement`.
//
// The FE repair pass runs the SHARED rule set from @octo/whiteboard-schema over a merged scene,
// for LOCAL RENDER ONLY (never written back). These cases exercise the binding-consistency
// repairs the shared rule realises:
//   M-8  one-sided / dangling boundElements  → pruned against the surviving-id set
//   M-3  dangling frameId                     → cleared
//   M-5  dangling containerId (orphaned bound-text whose container was deleted) → cleared
//   M-2  dangling image→file reference        → element dropped (unrenderable)
//   plus unrenderable-type drop, numeric clamps, idempotence, unknown-field passthrough (M-12).
//
// Note (FE/BE split): graph-level WRITE repair (fractional-index reassignment, file GC) is
// backend-authoritative (`repairLiveDoc`) and reaches the FE over the wire; the FE pass only makes
// the local render self-consistent and never writes to the Y.Doc. `startBinding`/`endBinding` are
// NOT pruned by the shared rule set on either side (carried through verbatim; Excalidraw renders a
// stale endpoint harmlessly), so the FE does not add divergent logic for them. `containerId` IS
// cleared when dangling as of WB_SCHEMA_VERSION 2 (M-5), the same shape as the `frameId` rule.
import { describe, it, expect } from 'vitest'
import { repairForRender } from '../repair.ts'
import { makeEl } from './helpers.ts'

describe('repairForRender (shared normalizeElement)', () => {
  it('M-8: prunes a one-sided boundElements reference to a missing element', () => {
    const els = [
      makeEl('shape', {
        boundElements: [
          { id: 'text1', type: 'text' }, // present below → kept
          { id: 'ghost', type: 'arrow' }, // missing → pruned
        ],
      } as never),
      makeEl('text1', { type: 'text' }),
    ]
    const out = repairForRender(els)
    const shape = out.find((e) => e.id === 'shape')!
    expect(shape.boundElements).toEqual([{ id: 'text1', type: 'text' }])
  })

  it('M-3: clears a dangling frameId', () => {
    const out = repairForRender([makeEl('a', { frameId: 'gone' })])
    expect(out.find((e) => e.id === 'a')!.frameId).toBeNull()
  })

  it('M-5: clears a dangling containerId on an orphaned bound text (container deleted)', () => {
    // Bound text references a container that is not present in the scene → containerId nulled.
    const out = repairForRender([makeEl('label', { type: 'text', containerId: 'gone' } as never)])
    expect(out.find((e) => e.id === 'label')!.containerId).toBeNull()
  })

  it('M-5: keeps containerId when the container element survives', () => {
    const els = [
      makeEl('box'),
      makeEl('label', { type: 'text', containerId: 'box' } as never),
    ]
    const out = repairForRender(els)
    expect(out.find((e) => e.id === 'label')!.containerId).toBe('box')
  })

  it('M-5: dropping the container (e.g. dangling image) orphans its bound text → containerId cleared', () => {
    // The container is an image whose fileId is dangling, so it is dropped in pass 1; the bound
    // text then references a non-surviving id and its containerId is cleared in pass 2.
    const els = [
      makeEl('pic', { type: 'image', fileId: 'gone' }),
      makeEl('label', { type: 'text', containerId: 'pic' } as never),
    ]
    const out = repairForRender(els, new Set(['present']))
    expect(out.map((e) => e.id)).not.toContain('pic')
    expect(out.find((e) => e.id === 'label')!.containerId).toBeNull()
  })

  it('M-5: containerId clearing is idempotent', () => {
    const els = [makeEl('label', { type: 'text', containerId: 'gone' } as never)]
    const once = repairForRender(els)
    const twice = repairForRender(once)
    expect(twice).toEqual(once)
    expect(twice.find((e) => e.id === 'label')!.containerId).toBeNull()
  })

  it('M-2: drops an image whose fileId is dangling (unrenderable binding)', () => {
    const els = [
      makeEl('img1', { type: 'image', fileId: 'present' }),
      makeEl('img2', { type: 'image', fileId: 'gone' }),
    ]
    const out = repairForRender(els, new Set(['present']))
    const ids = out.map((e) => e.id)
    expect(ids).toContain('img1')
    expect(ids).not.toContain('img2')
  })

  it('drops unrenderable (unknown-type) elements, keeps valid ones', () => {
    const out = repairForRender([makeEl('good'), makeEl('bad', { type: 'wormhole' } as never)])
    expect(out.map((e) => e.id)).toEqual(['good'])
  })

  it('clamps non-finite numerics and out-of-range opacity', () => {
    const out = repairForRender([makeEl('a', { x: NaN, width: -5, opacity: 999 } as never)])
    const a = out[0] as Record<string, unknown>
    expect(a.x).toBe(0)
    expect(a.width).toBe(0)
    expect(a.opacity).toBe(100)
  })

  it('is idempotent: repair(repair(x)) === repair(x)', () => {
    const els = [makeEl('a', { x: NaN, frameId: 'gone' } as never), makeEl('b', { type: 'text' })]
    const once = repairForRender(els)
    const twice = repairForRender(once)
    expect(twice).toEqual(once)
  })

  it('preserves unknown fields and does not mutate input (M-12)', () => {
    const el = makeEl('a', { future: { k: 1 } } as never)
    const out = repairForRender([el])
    expect((out[0] as Record<string, unknown>).future).toEqual({ k: 1 })
    expect(out[0]).not.toBe(el)
  })
})
