import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { DocListItem, RecentDocsResult } from './docsApi.ts'

// Mock the REST layer so the test controls exactly when each append resolves.
vi.mock('./docsApi.ts', () => ({
  listDocs: vi.fn(),
  listRecentDocs: vi.fn(),
  listRecentCreators: vi.fn(),
}))

import { useDocsView } from './useDocsView.ts'
import { listRecentDocs, listRecentCreators } from './docsApi.ts'

const recentMock = listRecentDocs as unknown as ReturnType<typeof vi.fn>
const creatorsMock = listRecentCreators as unknown as ReturnType<typeof vi.fn>

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const row = (docId: string): DocListItem => ({ docId, title: docId, ownerId: 'u', role: 'admin' })

beforeEach(() => {
  recentMock.mockReset()
  creatorsMock.mockReset()
  creatorsMock.mockResolvedValue([])
})

describe('useDocsView — loadMore in-flight guard (synchronous ref, XIN-1132 review §2 / AC-6.4)', () => {
  it('drops a re-entrant loadMore fired before the first append settles (no duplicate page)', async () => {
    // First page enables pagination (nextCursor present). The append is held in flight so the guard
    // is still engaged when the second loadMore fires in the same tick.
    const append = deferred<RecentDocsResult>()
    recentMock
      .mockResolvedValueOnce({ total: 40, items: [row('d1')], nextCursor: 'c1' })
      .mockReturnValueOnce(append.promise)
      // Any THIRD request would be the bug — a duplicate append for the same cursor.
      .mockResolvedValue({ total: 40, items: [row('dup')], nextCursor: 'c9' })

    const { result } = renderHook(() => useDocsView('recent', 'space', 'folder', 0))

    await waitFor(() => expect(result.current.hasMore).toBe(true))
    expect(recentMock).toHaveBeenCalledTimes(1)

    // Two IntersectionObserver notifications in the SAME tick, before `moreStatus` state re-renders.
    // A state-based guard would let both through; the synchronous ref drops the second.
    act(() => {
      result.current.loadMore()
      result.current.loadMore()
    })
    expect(recentMock).toHaveBeenCalledTimes(2)

    // Settle the append — exactly one page is appended, in order, with no duplicate rows.
    await act(async () => {
      append.resolve({ total: 40, items: [row('d2')], nextCursor: 'c2' })
    })
    expect(result.current.items.map((i) => i.docId)).toEqual(['d1', 'd2'])
    expect(recentMock).toHaveBeenCalledTimes(2)
  })

  it('allows the next loadMore once the previous append has settled', async () => {
    recentMock
      .mockResolvedValueOnce({ total: 60, items: [row('d1')], nextCursor: 'c1' })
      .mockResolvedValueOnce({ total: 60, items: [row('d2')], nextCursor: 'c2' })
      .mockResolvedValueOnce({ total: 60, items: [row('d3')], nextCursor: 'c3' })

    const { result } = renderHook(() => useDocsView('recent', 'space', 'folder', 0))
    await waitFor(() => expect(result.current.hasMore).toBe(true))

    await act(async () => {
      result.current.loadMore()
    })
    await waitFor(() => expect(result.current.items).toHaveLength(2))

    await act(async () => {
      result.current.loadMore()
    })
    await waitFor(() => expect(result.current.items.map((i) => i.docId)).toEqual(['d1', 'd2', 'd3']))
    expect(recentMock).toHaveBeenCalledTimes(3)
  })
})
