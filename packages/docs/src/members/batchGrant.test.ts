import { describe, it, expect } from 'vitest'
import { settleWithConcurrency, DEFAULT_GRANT_CONCURRENCY } from './batchGrant.ts'

describe('settleWithConcurrency (task #5 bounded fan-out)', () => {
  it('preserves input order and settles each task independently', async () => {
    const results = await settleWithConcurrency([1, 2, 3, 4], async (n) => {
      if (n === 2) throw new Error('boom-2')
      return n * 10
    })
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : r.reason.message))).toEqual([
      10,
      'boom-2',
      30,
      40,
    ])
  })

  it('never exceeds the concurrency cap of in-flight tasks', async () => {
    let inFlight = 0
    let peak = 0
    const items = Array.from({ length: 20 }, (_v, i) => i)
    await settleWithConcurrency(
      items,
      async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 1))
        inFlight--
      },
      4,
    )
    expect(peak).toBeLessThanOrEqual(4)
  })

  it('defaults the cap to 8', async () => {
    let inFlight = 0
    let peak = 0
    const items = Array.from({ length: 30 }, (_v, i) => i)
    await settleWithConcurrency(items, async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
    })
    expect(DEFAULT_GRANT_CONCURRENCY).toBe(8)
    expect(peak).toBeLessThanOrEqual(8)
  })

  it('handles an empty list without spawning a worker', async () => {
    expect(await settleWithConcurrency([], async () => 1)).toEqual([])
  })
})
