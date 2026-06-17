import { describe, it, expect } from 'vitest'
import { createPreviewGuard } from './previewGuard.ts'

// Stale-preview race guard (#4 §1.4 / Steve review): when the user previews version
// A then quickly previews B, a SLOW response for A that resolves AFTER B must not
// be applied — otherwise the panel shows #A's content under a "Preview #B" header
// and could mislead an admin's restore decision. The guard's begin()/isCurrent()
// must let only the latest request apply.

describe('createPreviewGuard — last-write-wins', () => {
  it('only the latest request isCurrent()', () => {
    const g = createPreviewGuard()
    const a = g.begin()
    const b = g.begin()
    expect(a.isCurrent()).toBe(false) // superseded by b
    expect(b.isCurrent()).toBe(true)
  })

  it('a single request stays current until superseded', () => {
    const g = createPreviewGuard()
    const a = g.begin()
    expect(a.isCurrent()).toBe(true)
    const b = g.begin()
    expect(a.isCurrent()).toBe(false)
    expect(b.isCurrent()).toBe(true)
  })

  it('out-of-order resolution: slow A (clicked first) must NOT apply over fast B', async () => {
    const g = createPreviewGuard()

    // Simulate the onPreview apply path: each request records what it WOULD apply
    // only if still current when its (out-of-order) response resolves.
    let applied: string | null = null
    const applyIfCurrent = (value: string, isCurrent: () => boolean) => {
      if (isCurrent()) applied = value
    }

    // Click A (slow), then click B (fast) — B resolves first, A resolves later.
    const reqA = g.begin()
    const reqB = g.begin()

    const slowA = new Promise<void>((r) => setTimeout(r, 30)).then(() =>
      applyIfCurrent('A', reqA.isCurrent),
    )
    const fastB = new Promise<void>((r) => setTimeout(r, 5)).then(() =>
      applyIfCurrent('B', reqB.isCurrent),
    )

    await Promise.all([slowA, fastB])

    // B is the latest selection; A's late response must have been discarded.
    expect(applied).toBe('B')
  })

  it('rapid A→B→C: only C applies even if all resolve out of order', async () => {
    const g = createPreviewGuard()
    let applied: string | null = null
    const applyIfCurrent = (v: string, isCurrent: () => boolean) => {
      if (isCurrent()) applied = v
    }
    const a = g.begin()
    const b = g.begin()
    const c = g.begin()
    await Promise.all([
      new Promise<void>((r) => setTimeout(r, 20)).then(() => applyIfCurrent('A', a.isCurrent)),
      new Promise<void>((r) => setTimeout(r, 10)).then(() => applyIfCurrent('B', b.isCurrent)),
      new Promise<void>((r) => setTimeout(r, 15)).then(() => applyIfCurrent('C', c.isCurrent)),
    ])
    expect(applied).toBe('C')
  })
})
