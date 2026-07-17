import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRefreshCommentsOnOpen, type UseDocComments } from './useDocComments.ts'

// A minimal UseDocComments stand-in — the hook only reads `.refresh`, so we stub the rest.
function makeComments(refresh: () => Promise<void>): UseDocComments {
  return {
    threads: [],
    loading: false,
    error: null,
    nextCursor: null,
    includeResolved: false,
    setIncludeResolved: () => {},
    refresh,
    loadMore: async () => {},
    createRoot: async () => {},
    reply: async () => {},
    editBody: async () => {},
    resolve: async () => {},
    remove: async () => {},
  }
}

describe('useRefreshCommentsOnOpen — refetch on panel open (XIN-1323)', () => {
  let refresh: ReturnType<typeof vi.fn<() => Promise<void>>>

  beforeEach(() => {
    refresh = vi.fn<() => Promise<void>>(async () => {})
  })

  it('does not refresh while the panel stays closed', () => {
    const comments = makeComments(refresh)
    renderHook(({ open }) => useRefreshCommentsOnOpen(comments, open), {
      initialProps: { open: false },
    })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes once on the closed → open transition', () => {
    const comments = makeComments(refresh)
    const { rerender } = renderHook(({ open }) => useRefreshCommentsOnOpen(comments, open), {
      initialProps: { open: false },
    })
    expect(refresh).not.toHaveBeenCalled()

    rerender({ open: true })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not re-refresh on re-renders while the panel stays open', () => {
    const comments = makeComments(refresh)
    const { rerender } = renderHook(({ open }) => useRefreshCommentsOnOpen(comments, open), {
      initialProps: { open: false },
    })
    rerender({ open: true })
    expect(refresh).toHaveBeenCalledTimes(1)

    // Extra renders with no open-state change must not trigger further fetches.
    rerender({ open: true })
    rerender({ open: true })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes again when the panel is closed and reopened', () => {
    const comments = makeComments(refresh)
    const { rerender } = renderHook(({ open }) => useRefreshCommentsOnOpen(comments, open), {
      initialProps: { open: false },
    })
    rerender({ open: true })
    rerender({ open: false })
    rerender({ open: true })
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('does not double-fetch when the panel starts already open (seeds prevOpen)', () => {
    const comments = makeComments(refresh)
    // A panel opened immediately (e.g. deep-linked) relies on useDocComments own mount refresh;
    // this hook must not add a second concurrent fetch on top of it.
    renderHook(({ open }) => useRefreshCommentsOnOpen(comments, open), {
      initialProps: { open: true },
    })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('reads the latest refresh via ref — no stale closure, no re-fire on identity change', () => {
    const first = vi.fn<() => Promise<void>>(async () => {})
    const second = vi.fn<() => Promise<void>>(async () => {})
    const { rerender } = renderHook(
      ({ open, refreshFn }) => useRefreshCommentsOnOpen(makeComments(refreshFn), open),
      { initialProps: { open: false, refreshFn: first } },
    )

    // refresh identity changes (as it does when docId/includeResolved change) while closed —
    // must NOT trigger a fetch on its own.
    rerender({ open: false, refreshFn: second })
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()

    // Opening now must call the CURRENT refresh, not the stale first one.
    rerender({ open: true, refreshFn: second })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
