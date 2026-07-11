import { describe, it, expect } from 'vitest'
import { createRaceGuard } from './raceGuard.ts'

// XIN-836 技术统一项②: the unified race guard must (1) truly abort the superseded in-flight
// request and (2) discard any response that resolves after a newer request started. These are the
// two properties the doc panel's token-only previewGuard lacked; assert both directly.

describe('createRaceGuard — primary lane (refresh / preview)', () => {
  it('marks only the latest ticket current and invalidates the previous one', () => {
    const guard = createRaceGuard()
    const first = guard.begin()
    expect(first.isCurrent()).toBe(true)

    const second = guard.begin()
    // The newer request wins last-write-wins; the earlier one is stale.
    expect(second.isCurrent()).toBe(true)
    expect(first.isCurrent()).toBe(false)
  })

  it('aborts the previous in-flight request on the wire when a new one begins', () => {
    const guard = createRaceGuard()
    const first = guard.begin()
    expect(first.signal.aborted).toBe(false)
    guard.begin()
    // Not merely ignored on arrival — the earlier fetch is cancelled.
    expect(first.signal.aborted).toBe(true)
  })
})

describe('createRaceGuard — follow-up lane (load-more)', () => {
  it('binds a follow-up to the current generation without bumping it', () => {
    const guard = createRaceGuard()
    guard.begin()
    const page = guard.beginFollowUp()
    // A page that resolves while its list is still current is applied.
    expect(page.isCurrent()).toBe(true)
  })

  it('drops a follow-up whose list was replaced by a newer primary before it landed', () => {
    const guard = createRaceGuard()
    guard.begin()
    const page = guard.beginFollowUp()
    // A filter switch / restore / delete fires a fresh primary before the page returns.
    guard.begin()
    expect(page.isCurrent()).toBe(false)
    // …and the in-flight page is aborted, not left running.
    expect(page.signal.aborted).toBe(true)
  })

  it('aborts a prior follow-up AND makes its ticket stale when a newer follow-up starts', () => {
    const guard = createRaceGuard()
    guard.begin()
    const firstPage = guard.beginFollowUp()
    const secondPage = guard.beginFollowUp()
    expect(firstPage.signal.aborted).toBe(true)
    // Regression (PM CHANGES_REQUESTED / Jerry-Xin): the superseded follow-up must NOT report
    // itself current — otherwise a load-more whose request resolved just before it was aborted
    // would still pass the isCurrent() gate and append stale / duplicate rows.
    expect(firstPage.isCurrent()).toBe(false)
    // Both belong to the current generation, so the newest page still applies.
    expect(secondPage.isCurrent()).toBe(true)
  })
})

describe('createRaceGuard — abort() cleanup', () => {
  it('aborts every in-flight request and invalidates outstanding tickets', () => {
    const guard = createRaceGuard()
    const primary = guard.begin()
    const page = guard.beginFollowUp()
    guard.abort()
    expect(primary.signal.aborted).toBe(true)
    expect(page.signal.aborted).toBe(true)
    expect(primary.isCurrent()).toBe(false)
    expect(page.isCurrent()).toBe(false)
  })
})
