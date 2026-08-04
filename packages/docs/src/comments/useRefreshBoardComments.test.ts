import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, renderHook } from '@testing-library/react'
import { useRefreshBoardComments, type UseDocComments } from './useDocComments.ts'

function makeComments(refresh: () => Promise<void>): UseDocComments {
  return {
    threads: [],
    loading: false,
    loadingThreadIds: new Set(),
    error: null,
    nextCursor: null,
    includeResolved: false,
    setIncludeResolved: () => {},
    refresh,
    loadMore: async () => {},
    loadThread: async () => true,
    createRoot: async () => ({ ok: true, error: null }),
    reply: async () => ({ ok: true, error: null }),
    editBody: async () => ({ ok: true, error: null }),
    resolve: async () => ({ ok: true, error: null }),
    remove: async () => ({ ok: true, error: null }),
  }
}

describe('useRefreshBoardComments', () => {
  let refresh: ReturnType<typeof vi.fn<() => Promise<void>>>

  beforeEach(() => {
    refresh = vi.fn<() => Promise<void>>(async () => {})
  })

  it('does not duplicate the mount refresh on first connection, then recovers after a later disconnect', () => {
    const comments = makeComments(refresh)
    const { rerender } = renderHook(
      ({ open, connected }) => useRefreshBoardComments(comments, open, connected),
      { initialProps: { open: true, connected: false } },
    )
    rerender({ open: true, connected: true })
    expect(refresh).not.toHaveBeenCalled()
    rerender({ open: true, connected: false })
    rerender({ open: true, connected: true })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not fetch on reconnect while closed because the next open edge owns recovery', () => {
    const comments = makeComments(refresh)
    const { rerender } = renderHook(
      ({ connected }) => useRefreshBoardComments(comments, false, connected),
      { initialProps: { connected: false } },
    )
    rerender({ connected: true })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes the open drawer when the window regains focus, but not while hidden', () => {
    const comments = makeComments(refresh)
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    visibility.mockReturnValue('hidden')
    renderHook(() => useRefreshBoardComments(comments, true, true))
    fireEvent.focus(window)
    expect(refresh).not.toHaveBeenCalled()
    visibility.mockReturnValue('visible')
    fireEvent.focus(window)
    expect(refresh).toHaveBeenCalledTimes(1)
    visibility.mockRestore()
  })

  it('reads the latest recovery callback without re-firing on identity changes', () => {
    const first = vi.fn<() => Promise<void>>(async () => {})
    const second = vi.fn<() => Promise<void>>(async () => {})
    const { rerender } = renderHook(
      ({ fn }) => useRefreshBoardComments(makeComments(fn), true, true),
      { initialProps: { fn: first } },
    )
    rerender({ fn: second })
    fireEvent.focus(window)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
  it('recovers on a real second reconnect even if the drawer was closed during the first', () => {
    const comments = makeComments(refresh)
    const { rerender } = renderHook(
      ({ open, connected }) => useRefreshBoardComments(comments, open, connected),
      { initialProps: { open: true, connected: true } },
    )
    rerender({ open: false, connected: false })
    rerender({ open: false, connected: true })
    expect(refresh).not.toHaveBeenCalled()
    rerender({ open: true, connected: true })
    rerender({ open: true, connected: false })
    rerender({ open: true, connected: true })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('retries an offline mount failure on the first successful connection', () => {
    const failed = { ...makeComments(refresh), error: 'Failed to load comments.' }
    const { rerender } = renderHook(
      ({ connected }) => useRefreshBoardComments(failed, true, connected),
      { initialProps: { connected: false } },
    )
    rerender({ connected: true })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

})
