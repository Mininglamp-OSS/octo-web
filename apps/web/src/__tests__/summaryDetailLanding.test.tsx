import { describe, it, expect, vi } from 'vitest'
import { runSummaryDetailLanding, type SummaryDetailLandingDeps } from '../App/summaryDetailLanding'

/**
 * Coverage for #150: a summary-completed DM carries `${origin}/summary/detail?taskId=<id>`.
 * Clicking it opens the browser at that URL, but App boot renders the default ChatPage and
 * never consumes location — so the landing handler must call WKApp.openSummaryDetail(taskId).
 *
 * Tested against the pure `runSummaryDetailLanding` DI helper (no @octo/base module graph),
 * matching the house style of mainMenuReconcile.test.tsx. Retries run synchronously here via a
 * setRetry stub that invokes its callback immediately, so we can assert the timing fallback for
 * a not-yet-registered openSummaryDetail without real timers.
 */

function makeDeps(overrides: Partial<SummaryDetailLandingDeps>): {
  deps: SummaryDetailLandingDeps
  open: ReturnType<typeof vi.fn>
} {
  const open = vi.fn()
  const deps: SummaryDetailLandingDeps = {
    getPathname: () => '/summary/detail',
    getSearch: () => '?taskId=123',
    isLoggedIn: () => true,
    getOpenSummaryDetail: () => open,
    setRetry: (cb) => {
      cb() // synchronous retry for deterministic tests
      return 0
    },
    clearRetry: () => {},
    ...overrides,
  }
  return { deps, open }
}

describe('runSummaryDetailLanding (#150)', () => {
  it('opens the detail page when path=/summary/detail?taskId=123 and logged in', () => {
    const { deps, open } = makeDeps({})
    runSummaryDetailLanding(deps)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(123)
  })

  it('tolerates a trailing slash on the pathname', () => {
    const { deps, open } = makeDeps({ getPathname: () => '/summary/detail/' })
    runSummaryDetailLanding(deps)
    expect(open).toHaveBeenCalledWith(123)
  })

  it('does nothing when the pathname is not /summary/detail', () => {
    const { deps, open } = makeDeps({ getPathname: () => '/' })
    runSummaryDetailLanding(deps)
    expect(open).not.toHaveBeenCalled()
  })

  it('does nothing when taskId is missing', () => {
    const { deps, open } = makeDeps({ getSearch: () => '' })
    runSummaryDetailLanding(deps)
    expect(open).not.toHaveBeenCalled()
  })

  it('does nothing when taskId is non-numeric', () => {
    const { deps, open } = makeDeps({ getSearch: () => '?taskId=abc' })
    runSummaryDetailLanding(deps)
    expect(open).not.toHaveBeenCalled()
  })

  it('rejects non-canonical taskId values (0, negative, float, hex)', () => {
    for (const q of ['?taskId=0', '?taskId=-5', '?taskId=1.5', '?taskId=0x1F']) {
      const { deps, open } = makeDeps({ getSearch: () => q })
      runSummaryDetailLanding(deps)
      expect(open, `taskId query ${q} must be rejected`).not.toHaveBeenCalled()
    }
  })

  it('does nothing when the user is not logged in', () => {
    const { deps, open } = makeDeps({ isLoggedIn: () => false })
    runSummaryDetailLanding(deps)
    expect(open).not.toHaveBeenCalled()
  })

  it('retries until openSummaryDetail is registered, then stops', () => {
    let ready = false
    const open = vi.fn()
    let calls = 0
    const deps: SummaryDetailLandingDeps = {
      getPathname: () => '/summary/detail',
      getSearch: () => '?taskId=7',
      isLoggedIn: () => true,
      getOpenSummaryDetail: () => (ready ? open : undefined),
      setRetry: (cb) => {
        // Ready on the 3rd attempt; each setRetry drives the next synchronous poll.
        if (++calls === 2) ready = true
        cb()
        return calls
      },
      clearRetry: () => {},
    }
    runSummaryDetailLanding(deps)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(7)
  })

  it('gives up after the retry cap without throwing when openSummaryDetail never appears', () => {
    let calls = 0
    const deps: SummaryDetailLandingDeps = {
      getPathname: () => '/summary/detail',
      getSearch: () => '?taskId=9',
      isLoggedIn: () => true,
      getOpenSummaryDetail: () => undefined, // never registers
      setRetry: (cb) => {
        calls++
        cb()
        return calls
      },
      clearRetry: () => {},
    }
    expect(() => runSummaryDetailLanding(deps)).not.toThrow()
    // Initial attempt + retries, capped: setRetry is called (MAX_RETRIES - 1) times because
    // the final attempt hits the cap and returns without scheduling. Must be finite (no infinite loop).
    expect(calls).toBe(19)
  })

  it('cleans the URL after a successful landing', () => {
    const cleanUrl = vi.fn()
    const { deps, open } = makeDeps({ cleanUrl })
    runSummaryDetailLanding(deps)
    expect(open).toHaveBeenCalledWith(123)
    expect(cleanUrl).toHaveBeenCalledWith(123)
  })
})
