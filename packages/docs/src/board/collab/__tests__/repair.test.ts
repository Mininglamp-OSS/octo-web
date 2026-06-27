// Repair pass (selection B, XIN-24). The merge-time binding-consistency repair runs the SHARED
// `normalizeElement` rule set from @octo/whiteboard-schema (XIN-26) for LOCAL RENDER ONLY.
//
// Until that package publishes, `normalizeElement` is an identity placeholder, so only the seam +
// unknown-field passthrough are asserted here. The graph-level cases (M-2 dangling binding / M-5
// orphan bound-text / M-8 one-sided boundElements) are `todo`: they need the real shared rule set
// to assert against, and re-enabling them is step 2 of the package-swap checklist in repair.ts.
import { describe, it, expect } from 'vitest'
import { repairForRender } from '../repair.ts'
import { makeEl } from './helpers.ts'

describe('repairForRender (seam)', () => {
  it('passes elements through preserving every field, including unknown ones (M-12)', () => {
    const els = [makeEl('a', { future: { k: 1 } } as never), makeEl('b')]
    const out = repairForRender(els)
    expect(out).toHaveLength(2)
    expect((out[0] as Record<string, unknown>).future).toEqual({ k: 1 })
  })

  it('is a pure function — does not mutate its input', () => {
    const el = makeEl('a', { x: 1 })
    const out = repairForRender([el])
    expect(out[0]).not.toBe(el) // returns a copy
    expect(el.x).toBe(1)
  })

  // ── Deferred until @octo/whiteboard-schema (XIN-26) ships the shared normalizeElement ──
  it.todo('M-2: repairs a dangling arrow binding to a deleted element')
  it.todo('M-5: re-parents or drops an orphan bound-text whose container is gone')
  it.todo('M-8: heals a one-sided boundElements reference')
  it.todo('M-7: repairs a half-present group')
  it.todo('M-3: clears a dangling frameId')
})
