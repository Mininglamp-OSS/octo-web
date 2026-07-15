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
import { listDocs, listRecentDocs, listRecentCreators } from './docsApi.ts'

const listMock = listDocs as unknown as ReturnType<typeof vi.fn>
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
  listMock.mockReset()
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

describe('useDocsView — type filter (XIN-1188, multi-select OR, both tabs)', () => {
  it('toggleType refetches the recent feed with the selected types (OR) and remembers them', async () => {
    recentMock.mockResolvedValue({ total: 0, items: [], nextCursor: null })
    const { result } = renderHook(() => useDocsView('recent', 'space', 'folder', 0))
    await waitFor(() => expect(result.current.phase).toBe('ready'))

    await act(async () => {
      result.current.toggleType('doc')
    })
    await act(async () => {
      result.current.toggleType('sheet')
    })
    expect(result.current.types).toEqual(['doc', 'sheet'])
    // last request narrowed on both kinds (OR, AND-ed with the — here empty — q/creators).
    expect(recentMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ types: ['doc', 'sheet'] }),
    )

    await act(async () => {
      result.current.clearTypes()
    })
    expect(result.current.types).toEqual([])
    expect(recentMock).toHaveBeenLastCalledWith(expect.objectContaining({ types: [] }))
  })

  it('the mine tab also carries the type filter through to listDocs', async () => {
    listMock.mockResolvedValue({ total: 0, items: [] })
    const { result } = renderHook(() => useDocsView('mine', 'space', 'folder', 0))
    await waitFor(() => expect(result.current.phase).toBe('ready'))

    await act(async () => {
      result.current.toggleType('board')
    })
    expect(listMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ owner: 'me', types: ['board'] }),
    )
  })

  it('an empty result under a type filter derives the F empty-state (clear-type CTA)', async () => {
    recentMock.mockResolvedValue({ total: 0, items: [], nextCursor: null })
    const { result } = renderHook(() => useDocsView('recent', 'space', 'folder', 0))
    await waitFor(() => expect(result.current.empty).toBe('A')) // no conditions yet

    await act(async () => {
      result.current.toggleType('sheet')
    })
    await waitFor(() => expect(result.current.empty).toBe('F'))
  })

  it('type + search together derive the combined E empty-state', async () => {
    recentMock.mockResolvedValue({ total: 0, items: [], nextCursor: null })
    const { result } = renderHook(() => useDocsView('recent', 'space', 'folder', 0))
    await waitFor(() => expect(result.current.phase).toBe('ready'))

    await act(async () => {
      result.current.setQuery('budget')
    })
    await act(async () => {
      result.current.toggleType('sheet')
    })
    await waitFor(() => expect(result.current.empty).toBe('E'))
  })
})

describe('useDocsView — creator facet candidates stay stable during selection (align with type filter)', () => {
  it('does NOT reload the creator facet on a selection toggle (creator or type), only on a q change', async () => {
    recentMock.mockResolvedValue({ total: 0, items: [], nextCursor: null })
    creatorsMock.mockResolvedValue([{ uid: 'u1', name: 'Alice' }])
    const { result } = renderHook(() => useDocsView('recent', 'space', 'folder', 0))
    await waitFor(() => expect(result.current.phase).toBe('ready'))

    // Initial load fetched the facet once (candidates track `q`, here empty).
    await waitFor(() => expect(creatorsMock).toHaveBeenCalledTimes(1))

    // Toggling a creator keeps `q`, so the open dropdown's candidate list must NOT churn — matching
    // the type filter, whose candidate set is a fixed enum that never reloads mid-select.
    await act(async () => {
      result.current.toggleCreator('u1')
    })
    expect(creatorsMock).toHaveBeenCalledTimes(1)

    // Toggling a type on the recent tab must not reload the creator facet either.
    await act(async () => {
      result.current.toggleType('doc')
    })
    expect(creatorsMock).toHaveBeenCalledTimes(1)

    // Clearing selections keeps `q` → still no facet reload.
    await act(async () => {
      result.current.clearCreators()
    })
    await act(async () => {
      result.current.clearTypes()
    })
    expect(creatorsMock).toHaveBeenCalledTimes(1)

    // A real `q` change DOES refresh the candidate set (the preserved facet semantic).
    await act(async () => {
      result.current.setQuery('plan')
    })
    await waitFor(() => expect(creatorsMock).toHaveBeenCalledTimes(2))
    expect(creatorsMock).toHaveBeenLastCalledWith('plan')

    // Selections still refetch the DOCUMENT list (only the facet fetch is decoupled).
    expect(recentMock).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'plan' }))
  })
})
