// Minimal bounded-concurrency batch helper for member/grant fan-out (task #5).
//
// The member + HTML grant panels add many uids at once (people + snapshot Bots). Running them as a
// single unbounded `Promise.allSettled(map(...))` opens N connections in one burst; this caps the
// in-flight count so a large snapshot can't hammer the backend. Each task settles independently so
// one failure never aborts the rest — the caller reports the exact failed subset by index.

/** Default in-flight cap for a grant fan-out. */
export const DEFAULT_GRANT_CONCURRENCY = 8

/**
 * Run `task(item, index)` over `items` with at most `limit` in flight, preserving input order in
 * the returned settled results (results[i] corresponds to items[i]). Never rejects: a task that
 * throws is captured as a `rejected` settlement, mirroring `Promise.allSettled` semantics.
 */
export async function settleWithConcurrency<T, R>(
  items: readonly T[],
  task: (item: T, index: number) => Promise<R>,
  limit: number = DEFAULT_GRANT_CONCURRENCY,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length)
  const cap = Math.max(1, Math.floor(limit))
  let next = 0
  async function worker(): Promise<void> {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, worker))
  return results
}
